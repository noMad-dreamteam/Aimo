import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export async function runtimeFiles() {
  const files = ['index.html', 'manifest.webmanifest', 'sw.js'];
  async function walk(dir) {
    for (const entry of await readdir(path.join(projectRoot, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && (/\.(?:js|css)$/.test(file) || file.endsWith('/ONNX-RUNTIME-LICENSE.txt'))) files.push(file);
    }
  }
  await walk('src');
  for (const size of [32, 180, 192, 512]) files.push(`assets/icons/app-icon-${size}.png`);
  return files.sort();
}
