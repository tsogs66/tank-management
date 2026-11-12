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

/* Notes alarms: permission to notify (Android 13+), to put alarms back after a
   reboot, and the receivers that ring them. Each is added once, so running the
   prep again changes nothing. */
const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  const reminders = require('./android-reminders-java');
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  for (const perm of reminders.PERMISSIONS) {
    if (!manifest.includes(perm)) {
      manifest = manifest.replace(/<manifest([^>]*)>/, '<manifest$1>\n    <uses-permission android:name="' + perm + '" />');
    }
  }
  if (!manifest.includes('.ReminderReceiver')) {
    manifest = manifest.replace('</application>', reminders.RECEIVERS + '    </application>');
  }
  /* Without this, Android 11+ hides the calendar apps from the check that the event screen can open. */
  if (!manifest.includes('android.intent.action.INSERT')) {
    manifest = manifest.replace(
      '</manifest>',
      '    <queries>\n        <intent>\n            <action android:name="android.intent.action.INSERT" />\n'
      + '            <data android:mimeType="vnd.android.cursor.dir/event" />\n        </intent>\n    </queries>\n</manifest>'
    );
  }
  fs.writeFileSync(manifestPath, manifest);
}
console.log(`Android release prep: versionName=${versionName} versionCode=${versionCode} (stable sideload key)`);
