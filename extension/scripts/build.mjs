import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './sync-pricing.mjs';

const extensionDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compiler = resolve(extensionDirectory, 'node_modules/typescript/bin/tsc');

const exitCode = await new Promise((resolveExitCode, reject) => {
  const child = spawn(process.execPath, [compiler, '-p', extensionDirectory], {
    cwd: extensionDirectory,
    stdio: 'inherit'
  });
  child.once('error', reject);
  child.once('exit', code => resolveExitCode(code ?? 1));
});

process.exitCode = exitCode;
