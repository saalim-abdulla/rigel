import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const source = resolve(scriptDirectory, '../../data/copilot-pricing.json');
const destination = resolve(scriptDirectory, '../resources/copilot-pricing.json');

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log('Synced Copilot pricing into the VS Code extension.');
