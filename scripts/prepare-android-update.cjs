const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readApkMetadata } = require('./read-apk-metadata.cjs');

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/prepare-android-update.cjs --apk <signed.apk> --url <permanent HTTPS APK URL> [--notes <UTF-8 text file>] [--out <JSON file>]');
  process.exit(0);
}
const options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--apk', '--url', '--notes', '--out'].includes(args[index]) || !args[index + 1]) throw new Error('Invalid arguments; use --help');
  options[args[index].slice(2)] = args[index + 1];
}
if (!options.apk || !options.url) throw new Error('--apk and --url are required');
const apkPath = path.resolve(options.apk), stats = fs.statSync(apkPath);
if (!stats.isFile() || stats.size < 1 || stats.size > 256 * 1024 * 1024) throw new Error('APK must be 1 byte to 256 MB');
const apk = fs.readFileSync(apkPath), metadata = readApkMetadata(apk), url = new URL(options.url);
if (metadata.packageName !== 'com.applejq.familyhome' || !Number.isSafeInteger(metadata.versionCode) || metadata.versionCode < 1
  || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(metadata.versionName)) throw new Error('Unexpected APK package/version');
if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')
  || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || !/\.apk$/i.test(url.pathname)) throw new Error('Use a permanent public HTTPS APK URL');
const notes = options.notes ? fs.readFileSync(options.notes, 'utf8').trim() : '体验优化与问题修复';
if (notes.length > 1200) throw new Error('Release notes exceed 1200 characters');
const release = { platform: 'android', ...metadata, url: url.href, sha256: createHash('sha256').update(apk).digest('hex'), size: apk.length, notes };
const serialized = JSON.stringify(release);
if (Buffer.byteLength(serialized) > 4096) throw new Error('Release JSON exceeds 4096 bytes');
const output = path.resolve(options.out || `.tmp/app-releases/android-${metadata.versionCode}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, serialized + '\n');
console.log(`Prepared Android ${metadata.versionName}/${metadata.versionCode}: ${output}`);
console.log('No files uploaded and no release announced. Verify APK signature and URL, then set ANDROID_UPDATE_RELEASE on multiPlatformApi.');
