const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp', 'release');
const miniRoot = path.join(output, 'miniprogram');
if (path.dirname(output) !== path.join(root, '.tmp')) throw new Error('Invalid release output');
// DevTools may keep its project root as a working directory even after closing
// the window. Keep that directory and replace only the generated contents.
fs.mkdirSync(output, { recursive: true });
for (const entry of fs.readdirSync(output)) {
  const target = path.join(output, entry);
  if (path.dirname(target) !== output) throw new Error('Invalid release output child');
  fs.rmSync(target, { recursive: true, force: true });
}
const write = (name, content) => {
  const target = path.join(miniRoot, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};
const read = name => fs.readFileSync(path.join(root, 'miniprogram', name), 'utf8');
const compiled = new Set();
function compile(file) {
  if (compiled.has(file) || file === 'config/design-assets.ts') return;
  if (file.startsWith('../') || path.isAbsolute(file)) throw new Error('Invalid release dependency');
  compiled.add(file);
  const source = read(file).replace(/^  openDemo\(\) \{[^\n]+\},\r?\n/m, '');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  write(file.replace(/\.ts$/, '.js'), result.outputText);
  for (const [, specifier] of result.outputText.matchAll(/require\(["']([^"']+)["']\)/g)) {
    if (!specifier.startsWith('.')) throw new Error(`Unexpected release runtime package: ${specifier}`);
    compile(path.posix.normalize(path.posix.join(path.posix.dirname(file), `${specifier}.ts`)));
  }
}
compile('app.ts');
compile('pages/cloud/index.ts');
const markup = read('pages/cloud/index.wxml').replace(/\s*<!-- development-demo:start -->[\s\S]*?<!-- development-demo:end -->/, '');
if (/openDemo|设计演示/.test(markup)) throw new Error('Development UI remains in release');
write('pages/cloud/index.wxml', markup);
write('pages/cloud/index.json', read('pages/cloud/index.json'));
write('pages/cloud/index.wxss', read('pages/cloud/index.wxss').replace('@import "../index/index.wxss";', '@import "../../styles/design.wxss";'));
write('styles/design.wxss', read('pages/index/index.wxss'));
write('app.wxss', read('app.wxss'));
const app = JSON.parse(read('app.json'));
app.pages = ['pages/cloud/index'];
write('app.json', JSON.stringify(app, null, 2) + '\n');
write('sitemap.json', JSON.stringify({ desc: '小猪猪衣橱家庭共享衣物管理', rules: [{ action: 'disallow', page: '*' }] }, null, 2) + '\n');
const design = JSON.parse(read('config/design-assets.ts').replace(/^export const design = /, '').replace(/ as const;\s*$/, ''));
const keys = [...new Set([...markup.matchAll(/assets\.(\w+)/g)].map(match => match[1]))];
const assets = {};
for (const key of keys) {
  const asset = design.wardrobe[key];
  if (typeof asset !== 'string' || !asset.startsWith('/assets/figma/')) throw new Error(`Unknown release asset: ${key}`);
  assets[key] = asset;
  write(asset.slice(1), fs.readFileSync(path.join(root, 'miniprogram', asset.slice(1))));
}
write('config/design-assets.js', `exports.design = ${JSON.stringify({ wardrobe: assets })};\n`);
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
project.projectname = 'family-wardrobe-release';
delete project.cloudfunctionRoot;
project.setting.useCompilerPlugins = [];
project.packOptions = { ignore: [], include: [] };
fs.writeFileSync(path.join(output, 'project.config.json'), JSON.stringify(project, null, 2) + '\n');
const files = [];
function inventory(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) inventory(file);
    else {
      const bytes = fs.readFileSync(file);
      files.push({ path: path.relative(miniRoot, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
inventory(miniRoot);
const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
if (bytes > 2 * 1024 * 1024 || files.some(file => /\.png$|pages\/index\//.test(file.path))) throw new Error('Unexpected release package content');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify({ version: '0.2.0', revision, builtAt: new Date().toISOString(), bytes, assets: keys, files }, null, 2) + '\n');
console.log(`Release prepared: ${output}; ${files.length} files, ${bytes} bytes, ${keys.length} icons; one cloud page, no demo photos.`);
