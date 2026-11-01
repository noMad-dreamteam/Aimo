// Real OS sandbox probes; requires a local Codex CLI with named permissions.
// No agent, model, credentials or external network requests are used.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectRoot } from './runtime-files.mjs';

const temp = await mkdtemp(path.join(tmpdir(), 'aimo-permissions-'));
const suffix = path.basename(temp);
const secret = path.join(projectRoot, `.env.${suffix}`);
const script = path.join(temp, 'probe.sh');
const directories = ['src/app', 'src/coach', 'src/ai', 'tests/app', 'docs'];
try {
  await writeFile(secret, 'Harmless fixture; contains no credentials', { flag: 'wx' });
  await writeFile(script, `set -eu
role="$1"
root="$2"
suffix="$3"
/bin/cat "$root/src/app/main.js" >/dev/null
for directory in ${directories.join(' ')}; do
  allowed=no
  case "$role:$directory" in frontend:tests/app|vision:src/coach|coach-llm:src/ai|qa:docs|qa:tests/app|root:*) allowed=yes;; esac
  marker="$root/$directory/.$suffix-$role"
  if (set -C; : > "$marker") 2>/dev/null; then
    /bin/rm "$marker"
    [ "$allowed" = yes ] || { echo "Unexpected write: $role $directory"; exit 1; }
  else
    [ "$allowed" = no ] || { echo "Unexpected denial: $role $directory"; exit 1; }
  fi
done
if /bin/cat "$root/.env.$suffix" >/dev/null 2>&1; then
  echo 'Secret fixture was readable'; exit 1
fi
echo "PASS $role: file scopes and secret denial"
`);
  for (const role of ['review', 'frontend', 'vision', 'coach-llm', 'qa', 'feature', 'root']) {
    const result = spawnSync(process.env.AIMO_CODEX || 'codex', ['sandbox', '-C', projectRoot, '-P', `aimo-${role}`, '--', '/bin/sh', script, role, projectRoot, suffix], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Sandbox check failed: ${role} (${result.status})`);
  }
} finally {
  await rm(secret, { force: true });
  for (const role of ['review', 'frontend', 'vision', 'coach-llm', 'qa', 'feature', 'root']) {
    for (const directory of directories) await rm(path.join(projectRoot, directory, `.${suffix}-${role}`), { force: true });
  }
  await rm(temp, { recursive: true, force: true });
}
