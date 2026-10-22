const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const required = [
  'miniprogram/app.json',
  'miniprogram/app.ts',
  'miniprogram/pages/index/index.wxml',
  'miniprogram/pages/index/index.wxss',
  'miniprogram/pages/index/index.ts',
  'miniprogram/services/store.ts',
  'miniprogram/config/design-assets.ts',
];
for (const relative of required) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).size) throw new Error(`Missing required file: ${relative}`);
}
const assets = path.join(root, 'miniprogram/assets/figma');
const files = fs.readdirSync(assets);
if (files.length < 80) throw new Error(`Expected downloaded Figma assets, found ${files.length}`);
const assetConfig = fs.readFileSync(path.join(root, 'miniprogram/config/design-assets.ts'), 'utf8');
for (const match of assetConfig.matchAll(/\/assets\/figma\/([^"']+)/g)) {
  const file = path.join(assets, match[1]);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`Missing local asset: ${match[1]}`);
}
const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/index/index.wxml'), 'utf8');
for (const token of ['衣橱', '搭配', '试衣间', '我的', '添加衣物']) {
  if (!wxml.includes(token)) throw new Error(`Missing screen token: ${token}`);
}
const assetRefs = [...wxml.matchAll(/assets\.([a-z]+)\.([A-Za-z0-9]+)/g)];
for (const [, page, key] of assetRefs) {
  if (!assetConfig.includes(`"${key}"`)) throw new Error(`Missing Figma asset mapping: ${page}.${key}`);
}
console.log(`Project structure OK; ${files.length} local Figma assets; 8 screen states wired.`);
