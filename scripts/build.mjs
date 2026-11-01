// Package only runtime files; tests, archives and agent instructions stay in the repo.
import { mkdir, copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, runtimeFiles } from './runtime-files.mjs';

const root = projectRoot;
const dist = path.join(root, 'dist');
const files = await runtimeFiles();

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of files) {
  await mkdir(path.dirname(path.join(dist, file)), { recursive: true });
  await copyFile(path.join(root, file), path.join(dist, file));
}
await writeFile(path.join(dist, '.nojekyll'), '');

const html = await readFile(path.join(dist, 'index.html'), 'utf8');
if (!html.includes('cameraVideo') || !html.includes('src/app/main.js')) throw new Error('Missing app entry points');
console.log(`Built dist/: ${files.length} runtime files (src/, assets/, HTML, manifest, service worker)`);
