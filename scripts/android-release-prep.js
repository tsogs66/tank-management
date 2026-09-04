#!/usr/bin/env node
/**
 * Patch Capacitor's generated android/app/build.gradle for CI releases:
 * - versionCode / versionName from package.json
 * - release signing from the committed sideload keystore (stable signature so
 *   each new APK installs over the previous one without uninstalling)
 *
 * Run after `npx cap add android` / `npx cap sync android`.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const versionCode = major * 10000 + minor * 100 + (patch || 0);
const versionName = pkg.version;

const gradlePath = path.join(root, 'android/app/build.gradle');
if (!fs.existsSync(gradlePath)) {
  console.error('Run `npx cap add android` (or android:sync) first.');
  process.exit(1);
}

const srcKeystore = path.join(root, 'signing', 'tankchief-sideload.keystore');
const dstKeystore = path.join(root, 'android', 'app', 'sideload.keystore');
if (!fs.existsSync(srcKeystore)) {
  console.error('Missing signing/tankchief-sideload.keystore — commit the stable sideload key.');
  process.exit(1);
}
fs.mkdirSync(path.dirname(dstKeystore), { recursive: true });
fs.copyFileSync(srcKeystore, dstKeystore);

const pass = process.env.TANKCHIEF_KEYSTORE_PASS || 'tankchief';

let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);

if (!gradle.includes('signingConfigs')) {
  gradle = gradle.replace(
    /(\s+buildTypes\s*\{)/,
    `
    signingConfigs {
        release {
            storeFile file('sideload.keystore')
            storePassword System.getenv('TANKCHIEF_KEYSTORE_PASS') ?: '${pass}'
            keyAlias 'tankchief'
            keyPassword System.getenv('TANKCHIEF_KEYSTORE_PASS') ?: '${pass}'
        }
    }$1`
  );
  gradle = gradle.replace(
    /(release\s*\{\s*\n\s*minifyEnabled)/,
    'release {\n            signingConfig signingConfigs.release\n            minifyEnabled'
  );
} else if (!/signingConfig\s+signingConfigs\.release/.test(gradle)) {
  gradle = gradle.replace(
    /(release\s*\{)/,
    '$1\n            signingConfig signingConfigs.release'
  );
}

fs.writeFileSync(gradlePath, gradle);
console.log(`Android release prep: versionName=${versionName} versionCode=${versionCode} (stable sideload key)`);
