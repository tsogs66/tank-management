/*
 * Android: the generated project has the alarm classes, the manifest lets them
 * ring and survive a reboot, running the prep twice changes nothing, and the
 * Java compiles when an android.jar is at hand (ANDROID_JAR=… to opt in).
 *
 * Run: node scripts/test-android-reminders.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let fails = 0, checks = 0;
function check(label, ok) {
  checks += 1;
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}`);
  if (!ok) fails += 1;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cheng-android-'));
fs.mkdirSync(path.join(tmp, 'scripts'));
for (const f of ['android-release-prep.js', 'apply-android-bridges.js', 'android-reminders-java.js']) {
  fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(tmp, 'scripts', f));
}
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
fs.mkdirSync(path.join(tmp, 'signing'));
fs.copyFileSync(path.join(ROOT, 'signing', 'tankchief-sideload.keystore'), path.join(tmp, 'signing', 'tankchief-sideload.keystore'));
const main = path.join(tmp, 'android/app/src/main');
const pkgDir = path.join(main, 'java/cloud/tsogs/tankmanagement');
fs.mkdirSync(pkgDir, { recursive: true });
fs.writeFileSync(path.join(tmp, 'android/app/build.gradle'), 'android {\n  buildTypes {\n    release {\n      minifyEnabled false\n    }\n  }\n  versionCode 1\n  versionName "1"\n}\n');
fs.writeFileSync(path.join(main, 'AndroidManifest.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application android:label="x">\n        <activity android:name=".MainActivity" android:exported="true" />\n    </application>\n</manifest>\n');

const run = () => {
  execFileSync(process.execPath, [path.join(tmp, 'scripts/apply-android-bridges.js')], { cwd: tmp, stdio: 'pipe' });
  execFileSync(process.execPath, [path.join(tmp, 'scripts/android-release-prep.js')], { cwd: tmp, stdio: 'pipe' });
};
run();
const manifest1 = fs.readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8');
run();
const manifest2 = fs.readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8');

console.log('\nthe project');
for (const f of ['ReminderScheduler', 'ReminderReceiver', 'ReminderBootReceiver', 'ReminderBridge', 'MainActivity']) {
  check(f + '.java is generated', fs.existsSync(path.join(pkgDir, f + '.java')));
}
const activity = fs.readFileSync(path.join(pkgDir, 'MainActivity.java'), 'utf8');
check('the page can reach the bridge as ChengAndroidReminders', /addJavascriptInterface\(new ReminderBridge\(this\), "ChengAndroidReminders"\)/.test(activity));
const sched = fs.readFileSync(path.join(pkgDir, 'ReminderScheduler.java'), 'utf8');
check('alarms go to the system clock (rings in Doze, needs no exact-alarm permission)', /setAlarmClock/.test(sched));
check('the whole set is replaced on each sync', /cancel\(ctx, stored\(ctx\)\)/.test(sched));
const bridge = fs.readFileSync(path.join(pkgDir, 'ReminderBridge.java'), 'utf8');
check('the calendar hand-off opens its own event screen', /ACTION_INSERT/.test(bridge) && /Events\.CONTENT_URI/.test(bridge));
check('and asks for no calendar permission', !/READ_CALENDAR|WRITE_CALENDAR/.test(bridge + manifest1));

console.log('\nthe manifest');
for (const perm of ['POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED']) {
  check(perm + ' is requested', manifest1.includes('android.permission.' + perm));
}
check('the alarm receiver is registered, and private', /<receiver android:name="\.ReminderReceiver" android:exported="false"/.test(manifest1));
check('the boot receiver puts alarms back after a reboot and an update',
  /BOOT_COMPLETED/.test(manifest1) && /MY_PACKAGE_REPLACED/.test(manifest1));
check('the calendar app stays visible to the check on Android 11+', /android\.intent\.action\.INSERT/.test(manifest1));
check('running the prep again changes nothing', manifest1 === manifest2);
check('and adds no second receiver', (manifest2.match(/\.ReminderReceiver"/g) || []).length === 1);

console.log('\nthe Java');
const jar = process.env.ANDROID_JAR;
if (jar && fs.existsSync(jar)) {
  const stub = path.join(tmp, 'stub/androidx/appcompat/app');
  fs.mkdirSync(stub, { recursive: true });
  fs.writeFileSync(path.join(stub, 'AppCompatActivity.java'), 'package androidx.appcompat.app; public class AppCompatActivity extends android.app.Activity {}');
  const cap = process.env.CAPACITOR_JAR;
  const reminderFiles = ['ReminderScheduler', 'ReminderReceiver', 'ReminderBootReceiver', 'ReminderBridge'].map((f) => path.join(pkgDir, f + '.java'));
  const holder = path.join(pkgDir, 'MainActivity.java');
  if (!cap) fs.writeFileSync(holder, 'package cloud.tsogs.tankmanagement; public class MainActivity extends android.app.Activity {}');
  const out = path.join(tmp, 'out');
  fs.mkdirSync(out);
  let ok = true;
  try {
    execFileSync('javac', ['-d', out, '-cp', [jar, cap].filter(Boolean).join(path.delimiter), ...reminderFiles, holder, ...(cap ? [path.join(stub, 'AppCompatActivity.java')] : [])], { stdio: 'pipe' });
  } catch (e) { ok = false; console.log(String(e.stderr || e.message).slice(0, 800)); }
  check('compiles against the Android platform classes', ok);
} else {
  console.log('  skip compile (set ANDROID_JAR to an android-all jar to compile the Java)');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
