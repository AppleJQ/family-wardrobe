const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..', 'apps', 'uniapp');
if (Number(process.versions.node.split('.')[0]) < 22 || (Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) < 12)) {
  console.error('uni-app 5.33 requires Node.js >=22.12. Select a supported Node version before building.');
  process.exit(1);
}
const platforms = { h5: 'h5', weixin: 'mp-weixin', android: 'app', harmony: 'app-harmony' };
const requested = process.argv[2] || 'all';
const targets = requested === 'all' ? Object.keys(platforms) : [requested];
if (targets.some(target => !platforms[target])) throw new Error('Choose all, h5, weixin, android or harmony');
for (const target of targets) {
  const platform = platforms[target];
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules', '@dcloudio', 'vite-plugin-uni', 'bin', 'uni.js'), 'build', '-p', platform], { cwd: root, encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  // Some native compiler failures return exit 0. Require its success marker and real output.
  const output = path.join(root, 'dist', 'build', platform);
  const entry = target === 'h5' ? 'index.html' : target === 'weixin' ? 'app.json' : 'app-service.js';
  if (result.error || result.status !== 0 || !/DONE\s+Build complete/.test(result.stdout || '') || !fs.existsSync(path.join(output, entry))) {
    console.error(`${target}: resource compilation failed; an exit code alone does not confirm a native build.`);
    process.exit(1);
  }
  console.log(`${target}: resources verified at ${output}`);
}
console.log('Resource compilation complete. Android APK and Harmony APP signing require HBuilderX and their native SDKs.');
