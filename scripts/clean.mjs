import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const output of [
  'WebGal/packages/parser/build',
  'WebGal/packages/webgal/dist',
  'WebGAL_Terre/packages/editor-preview-protocol/dist',
  'WebGAL_Terre/packages/terre2/dist',
  'WebGAL_Terre/packages/origine2/dist',
  'apps/desktop/build',
  'apps/mobile/android/build',
  'apps/mobile/android/app/build',
  'apps/mobile/ios/App/build',
]) {
  rmSync(path.join(root, output), { recursive: true, force: true });
}
