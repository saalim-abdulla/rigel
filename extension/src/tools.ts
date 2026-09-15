import { exec } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { assertPathInsideRoot } from './filesystem-boundary';
import { workspacePathParts } from './workspace-path';

export const TOOL_NAMES = new Set([
  'rigel_readFile',
  'rigel_listFiles',
  'rigel_findFiles',
  'rigel_writeFile',
  'rigel_runCommand'
]);

const MAX_FILE_BYTES = 128 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 128 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;

interface PathInput {
  path: string;
}

interface FindFilesInput {
  glob: string;
  limit?: number;
}

interface WriteFileInput extends PathInput {
  content: string;
}

interface RunCommandInput {
  command: string;
}

export function registerTools(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('rigel_readFile', new ReadFileTool()),
    vscode.lm.registerTool('rigel_listFiles', new ListFilesTool()),
    vscode.lm.registerTool('rigel_findFiles', new FindFilesTool()),
    vscode.lm.registerTool('rigel_writeFile', new WriteFileTool()),
    vscode.lm.registerTool('rigel_runCommand', new RunCommandTool())
  );
}

class ReadFileTool implements vscode.LanguageModelTool<PathInput> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<PathInput>): Promise<vscode.LanguageModelToolResult> {
    try {
      const uri = resolveWorkspacePath(options.input.path);
      await assertInsideWorkspace(uri);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const truncated = bytes.byteLength > MAX_FILE_BYTES;
      const visible = truncated ? bytes.slice(0, MAX_FILE_BYTES) : bytes;
      return result({
        ok: true,
        path: relativePath(uri),
        content: new TextDecoder().decode(visible),
        truncated,
        totalBytes: bytes.byteLength
      });
    } catch (error) {
      return failure(error);
    }
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<PathInput>): vscode.PreparedToolInvocation {
    return { invocationMessage: `Reading ${options.input.path}` };
  }
}

class ListFilesTool implements vscode.LanguageModelTool<PathInput> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<PathInput>): Promise<vscode.LanguageModelToolResult> {
    try {
      const uri = resolveWorkspacePath(options.input.path);
      await assertInsideWorkspace(uri);
      const entries = await vscode.workspace.fs.readDirectory(uri);
      return result({
        ok: true,
        path: relativePath(uri),
        entries: entries.map(([name, type]) => ({ name, type: fileTypeName(type) }))
      });
    } catch (error) {
      return failure(error);
    }
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<PathInput>): vscode.PreparedToolInvocation {
    return { invocationMessage: `Listing ${options.input.path}` };
  }
}

class FindFilesTool implements vscode.LanguageModelTool<FindFilesInput> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<FindFilesInput>): Promise<vscode.LanguageModelToolResult> {
    try {
      const root = workspaceRoot();
      const limit = Math.max(1, Math.min(Math.floor(options.input.limit ?? 50), 200));
      const pattern = new vscode.RelativePattern(root, options.input.glob);
      const uris = await vscode.workspace.findFiles(
        pattern,
        '**/{.git,node_modules,out,dist,build}/**',
        limit
      );
      return result({
        ok: true,
        glob: options.input.glob,
        paths: uris.map(relativePath),
        limitReached: uris.length === limit
      });
    } catch (error) {
      return failure(error);
    }
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<FindFilesInput>): vscode.PreparedToolInvocation {
    return { invocationMessage: `Finding ${options.input.glob}` };
  }
}

class WriteFileTool implements vscode.LanguageModelTool<WriteFileInput> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<WriteFileInput>): Promise<vscode.LanguageModelToolResult> {
    try {
      const uri = resolveWorkspacePath(options.input.path);
      await assertInsideWorkspace(uri);
      const parent = uri.with({ path: path.posix.dirname(uri.path) });
      const content = new TextEncoder().encode(options.input.content);
      const previous = await readIfPresent(uri);
      const changedWorkspace = !previous || !Buffer.from(previous).equals(Buffer.from(content));
      if (changedWorkspace) {
        await vscode.workspace.fs.createDirectory(parent);
        await vscode.workspace.fs.writeFile(uri, content);
      }
      return result({
        ok: true,
        path: relativePath(uri),
        bytesWritten: content.byteLength,
        changedWorkspace
      });
    } catch (error) {
      return failure(error);
    }
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<WriteFileInput>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Writing ${options.input.path}`,
      confirmationMessages: {
        title: 'Allow Rigel to write this file?',
        message: `Rigel will create or replace ${options.input.path}.`
      }
    };
  }
}

class RunCommandTool implements vscode.LanguageModelTool<RunCommandInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RunCommandInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const root = workspaceRoot();
    return new Promise(resolve => {
      const child = exec(
        options.input.command,
        {
          cwd: root.uri.fsPath,
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: MAX_COMMAND_OUTPUT_BYTES
        },
        (error, stdout, stderr) => {
          cancellation.dispose();
          resolve(result({
            ok: !error,
            command: options.input.command,
            exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
            stdout: truncate(stdout, MAX_COMMAND_OUTPUT_BYTES / 2),
            stderr: truncate(stderr, MAX_COMMAND_OUTPUT_BYTES / 2),
            error: error?.message
          }));
        }
      );
      const cancellation = token.onCancellationRequested(() => child.kill());
    });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<RunCommandInput>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Running ${options.input.command}`,
      confirmationMessages: {
        title: 'Allow Rigel to run this command?',
        message: `${options.input.command}\n\nIts stdout and stderr will be returned to the active Copilot model.`
      }
    };
  }
}

function workspaceRoot(): vscode.WorkspaceFolder {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    throw new Error('Open a workspace folder before using Rigel tools.');
  }
  return root;
}

function resolveWorkspacePath(rawPath: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceRoot().uri, ...workspacePathParts(rawPath));
}

async function assertInsideWorkspace(uri: vscode.Uri): Promise<void> {
  const root = workspaceRoot();
  const supportedSchemes = new Set(['file', 'vscode-remote']);
  if (!supportedSchemes.has(root.uri.scheme) || !supportedSchemes.has(uri.scheme)) {
    throw new Error('Rigel filesystem tools currently require a file-backed workspace.');
  }
  await assertPathInsideRoot(root.uri.fsPath, uri.fsPath);
}

async function readIfPresent(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
      return undefined;
    }
    throw error;
  }
}

function relativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

function fileTypeName(type: vscode.FileType): string {
  if (type & vscode.FileType.Directory) return 'directory';
  if (type & vscode.FileType.SymbolicLink) return 'symbolic-link';
  return 'file';
}

function result(value: unknown): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(JSON.stringify(value, null, 2))
  ]);
}

function failure(error: unknown): vscode.LanguageModelToolResult {
  return result({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  });
}

function truncate(value: string, limit: number): string {
  if (Buffer.byteLength(value, 'utf8') <= limit) return value;
  return `${value.slice(0, limit)}\n[truncated]`;
}
