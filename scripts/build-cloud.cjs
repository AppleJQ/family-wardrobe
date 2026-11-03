const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, 'cloud/tsconfig.json')], { stdio: 'inherit' });
const output = path.join(root, '.cloudbuild');
const groups = ['bootstrapUser', 'families', 'familyInvites', 'members', 'garments', 'cleanupUploads', 'ai', 'wardrobe', 'cutout', 'multiPlatformApi', 'notebook', 'notebookReminders', 'notebookCleanup'];
for (const name of groups) {
  const dir = path.join(output, name);
  fs.mkdirSync(dir, { recursive: true });
  const files = ['model.js', 'identity.js', 'service.js', 'adapter.js', 'runtime.js', 'cleanup.js', 'image.js', 'wardrobe-service.js', 'wardrobe-runtime.js', 'performance.js'];
  if (name === 'ai') files.push('ai-runtime.js', 'ai-service.js', 'deepseek.js');
  if (['notebook', 'multiPlatformApi', 'notebookReminders', 'notebookCleanup'].includes(name)) files.push('notebook-participants.js');
  if (name === 'notebook' || name === 'multiPlatformApi') files.push('notebook-model.js', 'notebook-service.js', 'notebook-ai.js', 'notebook-reminders.js', 'deepseek.js');
  if (name === 'notebookReminders') files.push('notebook-model.js', 'notebook-reminders.js', 'notebook-reminder-runtime.js');
  if (name === 'notebookCleanup') files.push('notebook-model.js', 'notebook-reminders.js', 'notebook-cleanup.js', 'notebook-cleanup-runtime.js');
  if (name === 'notebook') files.push('notebook-runtime.js');
  if (name === 'cutout') files.push('cutout-runtime.js', 'cutout-service.js', 'ci-cutout.js', 'photo-cutout-service.js');
  if (name === 'multiPlatformApi') files.push('app-update.js', 'auth-service.js', 'gateway.js', 'multi-platform-runtime.js', 'ai-service.js', 'deepseek.js', 'cutout-service.js', 'ci-cutout.js', 'photo-cutout-service.js');
  for (const file of files) fs.copyFileSync(path.join(root, '.tmp/cloud-compiled', file), path.join(dir, file));
  const entry = name === 'cleanupUploads' ? "exports.main = require('./cleanup').cleanup;\n"
    : name === 'notebook' ? "exports.main = require('./notebook-runtime').invokeNotebook;\n"
    : name === 'notebookReminders' ? "exports.main = require('./notebook-reminder-runtime').invokeNotebookReminders;\n"
    : name === 'notebookCleanup' ? "exports.main = require('./notebook-cleanup-runtime').invokeNotebookCleanup;\n"
    : name === 'multiPlatformApi' ? "exports.main = require('./multi-platform-runtime').invokeMultiPlatform;\n"
    : name === 'cutout' ? "exports.main = require('./cutout-runtime').invokeCutout;\n" : name === 'ai' ? "exports.main = require('./ai-runtime').invokeAi;\n" : name === 'wardrobe' ? "exports.main = require('./wardrobe-runtime').invokeWardrobe;\n" : `exports.main = event => require('./runtime').invoke('${name}', event);\n`;
  fs.writeFileSync(path.join(dir, 'index.js'), entry);
  if (name === 'notebookReminders') fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    permissions: { openapi: ['subscribeMessage.send'] },
    triggers: [{ name: 'notebook-reminders-every-minute', type: 'timer', config: '0 * * * * * *' }],
  }, null, 2) + '\n');
  if (name === 'notebookCleanup') fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    triggers: [{ name: 'notebook-cleanup-every-five-minutes', type: 'timer', config: '0 */5 * * * * *' }],
  }, null, 2) + '\n');
  const dependencies = { 'wx-server-sdk': '4.0.2', 'jpeg-js': '0.4.4', pngjs: '7.0.0' };
  if (name === 'cutout' || name === 'multiPlatformApi') dependencies['cos-nodejs-sdk-v5'] = '3.0.0';
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `wardrobe-${name.toLowerCase()}`, version: '0.2.0', private: true, main: 'index.js', engines: { node: '>=20.19' }, dependencies }, null, 2) + '\n');
}
console.log(`Built ${groups.length} Event Functions in .cloudbuild (Nodejs20.19)`);
