import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const minDuplicateSize = 256 * 1024;
const lfsPointer = 'version https://git-lfs.github.com/spec/v1';
const gameBinaryExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.ico',
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac',
  '.mp4', '.webm', '.mov', '.mkv',
  '.ttf', '.otf', '.woff', '.woff2', '.psd', '.clip', '.skel', '.moc3',
]);

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
if (tracked.length === 0) throw new Error('No tracked files found; stage the clean tree before auditing it');

const forbidden = tracked.filter((file) =>
  /(^|\/)(node_modules|dist|dist-ssr|build|coverage|logs|\.terre|\.codegraph|\.pnpm-store)(\/|$)/.test(file) ||
  file === 'WebGal/packages/webgal/public/game' ||
  file.startsWith('WebGal/packages/webgal/public/game/') ||
  file.startsWith('WebGAL_Terre/packages/terre2/assets/templates/WebGAL_Template/'),
);
if (forbidden.length) {
  throw new Error(`Generated paths are tracked:\n${forbidden.join('\n')}`);
}

const lfsTracked = new Set(
  git(['-c', 'core.quotepath=false', 'lfs', 'ls-files', '-n'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
);

function shouldUseLfs(file) {
  const extension = path.extname(file).toLowerCase();
  return (
    (file.startsWith('game/') && gameBinaryExtensions.has(extension)) ||
    ((file.startsWith('WebGal/packages/webgal/src/assets/fonts/') ||
      file.startsWith('WebGAL_Terre/packages/origine2/src/assets/fonts/')) &&
      ['.ttf', '.otf', '.woff', '.woff2'].includes(extension)) ||
    file.startsWith('WebGAL_Terre/packages/origine2/public/wasm/')
  );
}

const missingLfs = tracked.filter((file) => shouldUseLfs(file) && !lfsTracked.has(file));
if (missingLfs.length) {
  throw new Error(`Files that must use Git LFS are stored directly in Git:\n${missingLfs.join('\n')}`);
}

const hashes = new Map();
const duplicateGroups = [];
for (const file of tracked) {
  const absolute = path.join(root, file);
  const data = readFileSync(absolute);
  if (data.subarray(0, lfsPointer.length).toString() === lfsPointer) {
    throw new Error(`Git LFS file is not hydrated: ${file}`);
  }
  if (statSync(absolute).size < minDuplicateSize) continue;
  const hash = createHash('sha256').update(data).digest('hex');
  const matches = hashes.get(hash) ?? [];
  matches.push(file);
  hashes.set(hash, matches);
}
for (const matches of hashes.values()) {
  if (matches.length > 1) duplicateGroups.push(matches);
}
if (duplicateGroups.length) {
  throw new Error(
    `Large duplicate files are tracked:\n${duplicateGroups.map((group) => group.join('\n')).join('\n\n')}`,
  );
}

console.log(`Repository audit passed: ${tracked.length} tracked files, ${lfsTracked.size} LFS objects`);
