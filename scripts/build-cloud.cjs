const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, 'cloud/tsconfig.json')], { stdio: 'inherit' });
const output = path.join(root, '.cloudbuild');
const groups = ['bootstrapUser', 'families', 'familyInvites', 'members', 'garments', 'cleanupUploads', 'ai', 'wardrobe', 'cutout'];
for (const name of groups) {
  const dir = path.join(output, name);
  fs.mkdirSync(dir, { recursive: true });
  const files = ['model.js', 'service.js', 'adapter.js', 'runtime.js', 'cleanup.js', 'image.js', 'wardrobe-service.js', 'wardrobe-runtime.js', 'performance.js'];
  if (name === 'ai') files.push('ai-runtime.js', 'ai-service.js', 'deepseek.js');
  if (name === 'cutout') files.push('cutout-runtime.js', 'cutout-service.js', 'ci-cutout.js', 'photo-cutout-service.js');
  for (const file of files) fs.copyFileSync(path.join(root, '.tmp/cloud-compiled', file), path.join(dir, file));
  const entry = name === 'cleanupUploads' ? "exports.main = require('./cleanup').cleanup;\n"
    : name === 'cutout' ? "exports.main = require('./cutout-runtime').invokeCutout;\n" : name === 'ai' ? "exports.main = require('./ai-runtime').invokeAi;\n" : name === 'wardrobe' ? "exports.main = require('./wardrobe-runtime').invokeWardrobe;\n" : `exports.main = event => require('./runtime').invoke('${name}', event);\n`;
  fs.writeFileSync(path.join(dir, 'index.js'), entry);
  const dependencies = { 'wx-server-sdk': '4.0.2', 'jpeg-js': '0.4.4', pngjs: '7.0.0' };
  if (name === 'cutout') dependencies['cos-nodejs-sdk-v5'] = '3.0.0';
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `wardrobe-${name.toLowerCase()}`, version: '0.2.0', private: true, main: 'index.js', engines: { node: '>=20.19' }, dependencies }, null, 2) + '\n');
}
console.log(`Built ${groups.length} Event Functions in .cloudbuild (Nodejs20.19)`);
