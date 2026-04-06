import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const packageLockPath = path.join(root, 'package-lock.json');
const manifestPath = path.join(root, 'public', 'manifest.json');
const appVersionPath = path.join(root, 'src', 'lib', 'version.ts');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

if (!version) {
  throw new Error('package.json is missing version field');
}

if (fs.existsSync(packageLockPath)) {
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
  packageLock.version = version;

  if (packageLock.packages?.['']) {
    packageLock.packages[''].version = version;
  }

  fs.writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`, 'utf8');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = version;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const appVersionFile = fs.readFileSync(appVersionPath, 'utf8');
const appVersionPattern = /export const APP_VERSION = ['"][^'"]+['"];/;

if (!appVersionPattern.test(appVersionFile)) {
  throw new Error('APP_VERSION constant not found in src/lib/version.ts');
}

const updatedVersionFile = appVersionFile.replace(
  appVersionPattern,
  `export const APP_VERSION = '${version}';`
);
fs.writeFileSync(appVersionPath, updatedVersionFile, 'utf8');

console.log(`[version:sync] Synced to ${version}`);
