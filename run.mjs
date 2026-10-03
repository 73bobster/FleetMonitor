// Runs every scenario in its own process (each needs a fresh browser environment).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
let bad = 0;
for (const s of ['manager', 'reviewer', 'noaccess', 'invite']) {
  const r = spawnSync(process.execPath, [join(here, 'smoke.mjs'), s], { encoding: 'utf8' });
  process.stdout.write(r.stdout + r.stderr);
  if (r.status !== 0) bad++;
}
console.log(bad ? `\n${bad} scenario(s) failed` : '\nAll scenarios passed');
process.exit(bad ? 1 : 0);
