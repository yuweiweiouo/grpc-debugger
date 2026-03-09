import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'public', 'manifest.json');
const appVersionPath = path.join(root, 'src', 'lib', 'version.ts');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

if (!version) {
  throw new Error('package.json is missing version field');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = version;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

let appVersionFile = fs.readFileSync(appVersionPath, 'utf8');
const updatedVersionFile = appVersionFile.replace(
  /export const APP_VERSION = '.*';/,
  `export const APP_VERSION = '${version}';`
);
if (updatedVersionFile === appVersionFile) {
  throw new Error('APP_VERSION constant not found in src/lib/version.ts');
}
fs.writeFileSync(appVersionPath, updatedVersionFile, 'utf8');

console.log(`[version:sync] Synced to ${version}`);
