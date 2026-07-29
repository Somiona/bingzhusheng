import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const linksOnly = process.argv.includes('--links-only');
const forceTerrePath = process.argv.includes('--force-terre-path');
const game = path.join(root, 'game');
const engineGameLink = path.join(root, 'WebGal/packages/webgal/public/game');
const terreRoot = path.join(root, '.terre');
const terreGameRoot = path.join(terreRoot, 'games/bingzhusheng');
const terreGameLink = path.join(terreGameRoot, 'game');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} ${args.join(' ')} failed`);
  }
}

function ensureLink(link, target) {
  mkdirSync(path.dirname(link), { recursive: true });
  if (existsSync(link) || safeLstat(link)) {
    if (!lstatSync(link).isSymbolicLink()) {
      throw new Error(`${link} exists and is not a generated link`);
    }
    if (realpathSync(link) === realpathSync(target)) return;
    throw new Error(`${link} points somewhere else; remove it manually`);
  }

  const linkTarget =
    process.platform === 'win32'
      ? path.resolve(target)
      : path.relative(path.dirname(link), target);
  symlinkSync(linkTarget, link, process.platform === 'win32' ? 'junction' : 'dir');
}

function safeLstat(target) {
  try {
    return lstatSync(target);
  } catch {
    return null;
  }
}

function hasVisibleFiles(directory) {
  return existsSync(directory) && readdirSync(directory).some((entry) => !entry.startsWith('.'));
}

function configureTerre() {
  const configRoot = path.join(homedir(), '.webgal_terre');
  const configPath = path.join(configRoot, 'config.json');
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf8'))
    : { version: '4.6.2' };
  const configuredRoot = config.userDataPath
    ? path.resolve(config.userDataPath)
    : configRoot;
  const targetRoot = path.resolve(terreRoot);
  const conflicts =
    configuredRoot !== targetRoot &&
    (Boolean(config.userDataPath) || hasVisibleFiles(path.join(configuredRoot, 'games')));

  if (conflicts && !forceTerrePath) {
    throw new Error(
      `Terre currently uses ${configuredRoot}. Re-run with --force-terre-path after checking that location.`,
    );
  }

  mkdirSync(configRoot, { recursive: true });
  if (conflicts && existsSync(configPath)) {
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    copyFileSync(configPath, `${configPath}.${stamp}.bak`);
  }
  config.userDataPath = targetRoot;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

if (!existsSync(game)) throw new Error(`Canonical game is missing: ${game}`);

ensureLink(engineGameLink, game);
ensureLink(terreGameLink, game);
for (const directory of ['templates', 'derivative-engines', 'Exported_Games']) {
  mkdirSync(path.join(terreRoot, directory), { recursive: true });
}

if (!linksOnly) {
  if (!existsSync(path.join(root, '.git'))) {
    throw new Error('Run setup from a Git clone so Git LFS can be verified');
  }
  run('git', ['lfs', 'install', '--local']);
  run('git', ['lfs', 'pull']);
  run('git', ['lfs', 'fsck']);
  if (!existsSync(path.join(root, 'node_modules/.pnpm'))) {
    throw new Error('Dependencies are missing. Run pnpm install, then pnpm setup again.');
  }
  configureTerre();
}

console.log(`Game: ${game}`);
console.log(`Terre data: ${terreRoot}`);
