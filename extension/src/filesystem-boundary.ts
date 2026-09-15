import { realpath } from 'node:fs/promises';
import * as path from 'node:path';

export async function assertPathInsideRoot(rootPath: string, targetPath: string): Promise<void> {
  const realRoot = await realpath(rootPath);
  const realTargetOrParent = await nearestExistingRealPath(targetPath);
  if (!isPathInside(realRoot, realTargetOrParent)) {
    throw new Error('Resolved path cannot leave the workspace root, including through a symbolic link.');
  }
}

export function isPathInside(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function nearestExistingRealPath(targetPath: string): Promise<string> {
  let candidate = targetPath;
  while (true) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      candidate = parent;
    }
  }
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
