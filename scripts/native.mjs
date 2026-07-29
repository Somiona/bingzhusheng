import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = path.join(root, 'apps/mobile');
const requested = process.argv[2];
const platforms = requested ? [requested] : ['android', 'ios'];

if (platforms.some((platform) => !['android', 'ios'].includes(platform))) {
  throw new Error('Platform must be android or ios');
}

for (const platform of platforms) {
  if (existsSync(path.join(mobile, platform))) continue;
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(command, ['exec', 'cap', 'add', platform], {
    cwd: mobile,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`Could not create the Capacitor ${platform} project`);
  }
}
