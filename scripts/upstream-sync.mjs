import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(root, 'upstream.lock.json');
const cacheDir = path.join(root, '.upstream');
const MAX_BUFFER = 256 * 1024 * 1024;

// Basename-only ignores for `diff -x` (VCS / OS noise / build artifacts).
const AUDIT_IGNORE_BASENAMES = [
  '.git',
  '.DS_Store',
  'node_modules',
  'dist',
  'dist-ssr',
  'build',
  'logs',
  'tmp',
  '.cache',
  'coverage',
];

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  if (result.error) throw result.error;
  return result;
}

function runOrFail(command, args) {
  const result = run(command, args);
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed:\n${result.stderr ?? ''}`);
  }
  return result;
}

function loadLock() {
  if (!existsSync(lockPath)) fail(`missing ${lockPath}`);
  return JSON.parse(readFileSync(lockPath, 'utf8'));
}

function saveLock(lock) {
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

function getEntry(lock, dir) {
  const entry = lock[dir];
  if (!entry) {
    fail(`unknown directory "${dir}". Known: ${Object.keys(lock).join(', ')}`);
  }
  return entry;
}

function refName(dir, ref) {
  return `refs/upstream/${dir}/${ref}`;
}

function ensureFetched(dir, entry, ref) {
  const localRef = refName(dir, ref);
  const have = run('git', ['rev-parse', '--verify', '--quiet', localRef]);
  if (have.status === 0) return localRef;
  console.log(`fetching ${entry.upstream} tag ${ref} ...`);
  runOrFail('git', [
    'fetch',
    '--depth',
    '1',
    '--no-tags',
    entry.upstream,
    `refs/tags/${ref}:${localRef}`,
  ]);
  return localRef;
}

// lock exclude entries ending with "/" match whole directories.
// NOTE: git apply matches --exclude against the path *after* --directory
// prefixing, so patterns must include the vendored dir prefix.
function excludeToApplyArgs(dir, exclude) {
  return exclude.map((entry) =>
    entry.endsWith('/')
      ? `--exclude=${dir}/${entry}*`
      : `--exclude=${dir}/${entry}`,
  );
}

function isExcluded(relPath, exclude) {
  return exclude.some((entry) =>
    entry.endsWith('/')
      ? relPath === entry.slice(0, -1) || relPath.startsWith(entry)
      : relPath === entry,
  );
}

function isGitIgnored(relPathUnderRoot) {
  const result = run('git', [
    'check-ignore',
    '--quiet',
    '--',
    relPathUnderRoot,
  ]);
  return result.status === 0;
}

// --- audit ------------------------------------------------------------------

function extractRef(ref, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const archive = spawnSync('git', ['archive', ref], {
    cwd: root,
    maxBuffer: MAX_BUFFER,
  });
  if (archive.status !== 0) fail(`git archive ${ref} failed`);
  const tar = spawnSync('tar', ['-x', '-C', dest], {
    input: archive.stdout,
    maxBuffer: MAX_BUFFER,
  });
  if (tar.status !== 0) fail(`tar extract for ${ref} failed`);
}

// Compare extracted upstream snapshot with the vendored dir.
// Returns paths relative to the vendored dir root.
function auditLocalChanges(dir, entry) {
  const baseRef = ensureFetched(dir, entry, entry.base);
  const extractRel = `.upstream/audit-${dir}`;
  extractRef(baseRef, path.join(root, extractRel));

  const diffArgs = ['-rq', extractRel, dir];
  for (const name of AUDIT_IGNORE_BASENAMES) diffArgs.push('-x', name);
  const result = run('diff', diffArgs);
  // diff exits 1 when differences exist, >1 on real errors.
  if (result.status > 1) fail(`diff failed:\n${result.stderr}`);

  const modified = [];
  const localOnly = [];
  const upstreamOnly = [];
  for (const line of (result.stdout ?? '').split('\n')) {
    if (!line) continue;
    let m = line.match(/^Files .+ and (.+) differ$/);
    if (m) {
      const rel = m[1].startsWith(`${dir}/`) ? m[1].slice(dir.length + 1) : null;
      if (rel && !isExcluded(rel, entry.exclude)) modified.push(rel);
      continue;
    }
    m = line.match(/^Only in (.+?):\s*(.+)$/);
    if (m) {
      const [, parent, name] = m;
      const rel =
        parent === extractRel || parent === dir
          ? name
          : parent.startsWith(`${extractRel}/`)
            ? `${parent.slice(extractRel.length + 1)}/${name}`
            : parent.startsWith(`${dir}/`)
              ? `${parent.slice(dir.length + 1)}/${name}`
              : null;
      if (!rel || isExcluded(rel, entry.exclude)) continue;
      if (parent === extractRel || parent.startsWith(`${extractRel}/`)) {
        upstreamOnly.push(rel);
      } else if (!isGitIgnored(`${dir}/${rel}`)) {
        localOnly.push(rel);
      }
    }
  }
  return { modified, localOnly, upstreamOnly };
}

function cmdAudit(dir) {
  const lock = loadLock();
  const entry = getEntry(lock, dir);
  const { modified, localOnly, upstreamOnly } = auditLocalChanges(dir, entry);
  console.log(`# ${dir} vs upstream ${entry.base}\n`);
  console.log(`## 本地修改过的文件 (${modified.length})`);
  modified.forEach((f) => console.log(`  M ${f}`));
  console.log(`\n## 仅本地存在 (${localOnly.length})`);
  localOnly.forEach((f) => console.log(`  L ${f}`));
  console.log(`\n## 仅上游存在、未 vendor (${upstreamOnly.length})`);
  upstreamOnly.forEach((f) => console.log(`  U ${f}`));
  console.log(
    '\n提示：仅上游存在的条目如果是刻意不 vendor 的，请加入 upstream.lock.json 的 exclude。',
  );
}

// --- check ------------------------------------------------------------------

function compareSemver(a, b) {
  const pa = a.split(/[.-]/).map((x) => (Number.isNaN(Number(x)) ? 0 : Number(x)));
  const pb = b.split(/[.-]/).map((x) => (Number.isNaN(Number(x)) ? 0 : Number(x)));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function listRemoteTags(entry) {
  const result = runOrFail('git', ['ls-remote', '--tags', entry.upstream]);
  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.match(/refs\/tags\/(.+)$/)?.[1])
    .filter((tag) => tag && !tag.endsWith('^{}') && /^\d+\.\d+\.\d+$/.test(tag))
    .sort(compareSemver);
}

function cmdCheck(dir, targetArg) {
  const lock = loadLock();
  const entry = getEntry(lock, dir);
  const tags = listRemoteTags(entry);
  const newer = tags.filter((t) => compareSemver(t, entry.base) > 0);
  console.log(`# ${dir}: 当前 base = ${entry.base}`);
  console.log(`上游可用更新: ${newer.length ? newer.join(', ') : '(无)'}`);
  const target = targetArg ?? newer[newer.length - 1];
  if (!target) return;
  if (!tags.includes(target)) fail(`上游没有 tag ${target}`);

  const baseRef = ensureFetched(dir, entry, entry.base);
  const targetRef = ensureFetched(dir, entry, target);
  const changed = runOrFail('git', ['diff', '--name-only', baseRef, targetRef])
    .stdout.split('\n')
    .filter((f) => f && !isExcluded(f, entry.exclude));

  const { modified } = auditLocalChanges(dir, entry);
  const overlap = changed.filter((f) => modified.includes(f));

  console.log(`\n# ${entry.base} -> ${target}`);
  console.log(`上游改动文件（排除 exclude 后）: ${changed.length}`);
  console.log(`本地修改文件: ${modified.length}`);
  console.log(`潜在冲突（交集 ${overlap.length}）:`);
  overlap.forEach((f) => console.log(`  ! ${f}`));
}

// --- sync -------------------------------------------------------------------

function ensureClean(dir) {
  const result = runOrFail('git', ['status', '--porcelain', '--', dir]);
  if (result.stdout.trim() !== '') {
    fail(`${dir} 有未提交改动，请先提交或 stash：\n${result.stdout}`);
  }
}

function findConflictMarkers(dir) {
  const result = run('grep', [
    '-rl',
    '--exclude-dir=node_modules',
    '--exclude-dir=dist',
    '--exclude-dir=build',
    '^<<<<<<< ',
    dir,
  ]);
  return (result.stdout ?? '').split('\n').filter(Boolean);
}

function scanPatchForLfs(patchFile) {
  const lines = readFileSync(patchFile, 'utf8').split('\n');
  const hits = [];
  let currentFile = null;
  for (const line of lines) {
    const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (m) currentFile = m[2];
    if (line.startsWith('+version https://git-lfs')) {
      hits.push(currentFile ?? '(unknown)');
    }
  }
  return hits;
}

function cmdSync(dir, target, accept) {
  const lock = loadLock();
  const entry = getEntry(lock, dir);
  if (!target) fail('用法: sync <dir> <ref> [--accept]');

  if (accept) {
    const leftover = findConflictMarkers(dir);
    if (leftover.length) {
      fail(`仍有冲突标记未解决：\n${leftover.map((f) => `  ${f}`).join('\n')}`);
    }
    entry.base = target;
    saveLock(lock);
    console.log(`已接受：${dir} base 更新为 ${target}。请提交改动。`);
    return;
  }

  ensureClean(dir);
  const baseRef = ensureFetched(dir, entry, entry.base);
  const targetRef = ensureFetched(dir, entry, target);

  mkdirSync(cacheDir, { recursive: true });
  const patchFile = path.join(
    cacheDir,
    `${dir}-${entry.base}-to-${target}.patch`,
  );
  const diff = runOrFail('git', [
    'diff',
    '--binary',
    '--find-renames',
    baseRef,
    targetRef,
  ]);
  writeFileSync(patchFile, diff.stdout);
  console.log(`补丁已生成: ${path.relative(root, patchFile)}`);

  const lfsHits = scanPatchForLfs(patchFile);
  if (lfsHits.length) {
    console.warn(
      `警告：补丁包含 LFS pointer 文件（将写入指针文本而非真实内容）：\n${lfsHits
        .map((f) => `  ${f}`)
        .join('\n')}`,
    );
  }

  const apply = run('git', [
    'apply',
    '--3way',
    '--verbose',
    `--directory=${dir}/`,
    ...excludeToApplyArgs(dir, entry.exclude),
    path.relative(root, patchFile),
  ]);
  process.stdout.write(apply.stdout ?? '');
  process.stderr.write(apply.stderr ?? '');

  const conflicts = findConflictMarkers(dir);
  if (apply.status === 0 && conflicts.length === 0) {
    console.log(
      `\n补丁已干净应用。接下来：\n` +
        `  1. pnpm install\n` +
        `  2. pnpm check（或至少 pnpm build）\n` +
        `  3. 确认无误后: node scripts/upstream-sync.mjs sync ${dir} ${target} --accept\n` +
        `  4. 提交改动`,
    );
    return;
  }
  console.error(
    `\n存在冲突或未能应用的改动，请逐个处理（冲突标记 <<<<<<< / ======= / >>>>>>>）：\n${conflicts
      .map((f) => `  ${f}`)
      .join('\n')}\n解决并验证通过后运行：node scripts/upstream-sync.mjs sync ${dir} ${target} --accept`,
  );
  process.exit(1);
}

// --- main -------------------------------------------------------------------

const [, , command, dir, ref, ...rest] = process.argv;
const accept = rest.includes('--accept');

if (command === 'audit' && dir) {
  cmdAudit(dir);
} else if (command === 'check' && dir) {
  cmdCheck(dir, ref);
} else if (command === 'sync' && dir) {
  cmdSync(dir, ref, accept);
} else {
  console.log(`用法:
  node scripts/upstream-sync.mjs audit <dir>                 审计本地相对上游 base 的改动（只读）
  node scripts/upstream-sync.mjs check <dir> [ref]           查看上游新版本与潜在冲突文件（只读）
  node scripts/upstream-sync.mjs sync <dir> <ref>            应用 base->ref 的上游补丁（三方合并）
  node scripts/upstream-sync.mjs sync <dir> <ref> --accept   验证通过后把 lock 的 base 更新为 <ref>

<dir> 取自 upstream.lock.json: ${Object.keys(loadLock()).join(', ')}`);
}
