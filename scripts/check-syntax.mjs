import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0').filter(file => /\.(?:m?js)$/.test(file) && existsSync(file));
const uniqueFiles = new Set(files);
for (const file of uniqueFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked: ${uniqueFiles.size} JavaScript files`);
