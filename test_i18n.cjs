const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const storage = new Map();
const label = {dataset:{i18n:'仓库'},textContent:'仓库'};
const placeholder = {value:'C:/项目/仓库',attributes:{'data-i18n-placeholder':'输入本地 Git 仓库路径'},
  getAttribute(name){return this.attributes[name];},setAttribute(name,value){this.attributes[name]=value;}};
const commit = {textContent:'feat: 修复中文界面'};
const document = {documentElement:{lang:'zh-CN'},title:'',querySelectorAll(selector){
  return selector === '[data-i18n]' ? [label] : selector === '[data-i18n-placeholder]' ? [placeholder] : [];
}};
const localStorage = {getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
const source = fs.readFileSync('web/i18n.js','utf8');
const context = vm.createContext({document,localStorage});
vm.runInContext(source,context);
const i18n = vm.runInContext('I18N',context);
assert.equal(i18n.locale,'zh-CN');
i18n.setLocale('en');
i18n.apply();
assert.equal(label.textContent,'Repository');
assert.equal(document.documentElement.lang,'en');
assert.equal(document.title,'Git Tree · Commit History');
assert.equal(placeholder.attributes.placeholder,'Enter a local Git repository path');
assert.equal(placeholder.value,'C:/项目/仓库','translation must preserve typed paths');
assert.equal(commit.textContent,'feat: 修复中文界面','repository content must not be translated');
assert.equal(i18n.t('导出 {hash} 记录的状态，不包含工作区未提交的修改。',{hash:'abc123'}),'Export the state recorded in abc123, excluding uncommitted changes.');
assert.match(i18n.message('目标文件夹必须不存在或为空，不会覆盖已有文件'),/Existing files will not be overwritten/);
assert.equal(i18n.message('文件夹不存在: C:/中文路径'),'Folder not found: C:/中文路径');
assert.match(i18n.message('包含 3 个子模块：仅创建空目录，不下载子模块内容。'),/3 submodules/);
// All explicit application strings and static attributes must have an English translation.
const app = fs.readFileSync('web/app.js','utf8');
const html = fs.readFileSync('web/index.html','utf8');
const keys = new Set([
  ...Array.from(app.matchAll(/\bt\("([^"\n]*)"/g),m=>m[1]),
  ...Array.from(html.matchAll(/data-i18n(?:-placeholder|-aria-label|-title)?="([^"]*)"/g),m=>m[1]),
]);
for (const key of keys) {
  if (key === '中文') continue;
  assert.doesNotMatch(i18n.t(key),/\p{Script=Han}/u,`Missing English translation for ${key}`);
}
const reloaded = vm.createContext({document,localStorage});
vm.runInContext(source,reloaded);
assert.equal(vm.runInContext('I18N.locale',reloaded),'en','language choice must persist');
i18n.setLocale('zh-CN');i18n.apply();
assert.equal(label.textContent,'仓库');
assert.equal(document.documentElement.lang,'zh-CN');
console.log(`i18n checks passed: ${keys.size} application keys, both directions, stored preference, warnings and untouched user content.`);
