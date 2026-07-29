import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'))).version;
const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
if (!match) throw new Error(`Invalid version: ${version}`);
const versionCode = Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3]);

for (const file of ['apps/desktop/package.json', 'apps/mobile/package.json']) {
  const absolute = path.join(root, file);
  const json = JSON.parse(readFileSync(absolute));
  json.version = version;
  writeFileSync(absolute, `${JSON.stringify(json, null, 2)}\n`);
}

const gradle = path.join(root, 'apps/mobile/android/app/build.gradle');
if (existsSync(gradle)) {
  const source = readFileSync(gradle, 'utf8')
    .replace(/versionCode \d+/, `versionCode ${versionCode}`)
    .replace(/versionName "[^"]+"/, `versionName "${version}"`);
  writeFileSync(gradle, source);
}

const xcode = path.join(root, 'apps/mobile/ios/App/App.xcodeproj/project.pbxproj');
if (existsSync(xcode)) {
  const source = readFileSync(xcode, 'utf8')
    .replaceAll(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${versionCode};`)
    .replaceAll(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
  writeFileSync(xcode, source);
}
