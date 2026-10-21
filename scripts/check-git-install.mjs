import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Reproduce BB's managed Git-install dependency policy, with no development tools
// or private credentials copied into the candidate plugin directory.
const directory = mkdtempSync(join(tmpdir(), 'bb-kimicode-install-'));
try {
  for (const name of ['package.json', 'package-lock.json', 'server.ts', 'host.ts', 'src', 'assets', 'skills', 'PLUGIN_OVERVIEW.md']) {
    cpSync(name, join(directory, name), { recursive: true });
  }
  execFileSync('npm', ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts'], { cwd: directory, stdio: 'inherit' });
  execFileSync('bb', ['plugin', 'build', directory], { stdio: 'inherit' });
  console.log('Clean Git-install build OK.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
