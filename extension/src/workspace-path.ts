export function workspacePathParts(rawPath: string): string[] {
  const normalized = rawPath.trim().replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error('Path must be relative to the workspace root.');
  }

  const parts = normalized.split('/').filter(part => part && part !== '.');
  if (parts.some(part => part === '..')) {
    throw new Error('Path cannot leave the workspace root.');
  }
  return parts;
}
