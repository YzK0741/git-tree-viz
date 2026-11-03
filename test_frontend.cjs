// Exercise the real graph algorithm and API error handling without a browser dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
function element() {
  return {value:'', innerHTML:'', textContent:'', disabled:false, style:{}, dataset:{},
    listeners:{}, classList:{add(){},remove(){},toggle(){}},
    addEventListener(type,handler){(this.listeners[type] ||= []).push(handler);},
    setAttribute(){}, focus(){}, showModal(){this.open=true;},close(){this.open=false;},querySelector(){return element();}};
}
const document = {documentElement:{lang:'zh-CN'},getElementById(id){if(!elements.has(id)) elements.set(id,element()); return elements.get(id);},
  addEventListener(){}, body:element(), querySelectorAll(){return [];}};
const context = vm.createContext({document, console, URLSearchParams, setTimeout, clearTimeout,
  requestAnimationFrame(){return 1;}, ResizeObserver:class{observe(){}},
  location:{search:''}, history:{replaceState(){}},
  fetch:async () => ({ok:true,status:200,headers:{get(){return 'application/json';}},
    json:async () => ({ok:true,data:{repo:'test',head:'main',stats:{commits:0},commits:[],refs:[]}})})});
vm.runInContext(fs.readFileSync('web/i18n.js','utf8'), context);
vm.runInContext(fs.readFileSync('web/app.js','utf8'), context);
const commits = [
  {hash:'feature',parents:['base']},
  {hash:'main',parents:['base']},
  {hash:'base',parents:['root']},
  {hash:'root',parents:[]},
];
context.fixture = commits;
const layout = vm.runInContext('computeLayout(fixture, "main")', context);
assert.equal(layout.assign[1],0,'main tip must stay on the center lane');
assert.equal(layout.assign[2],0,'main first-parent history must stay centered');
assert.equal(layout.assign[3],0,'root must stay centered');
assert.notEqual(layout.assign[0],0,'feature branch must use another lane');
assert.deepEqual(Array.from(layout.children.get('base')),['feature','main']);
assert.equal(layout.edges.length,3);
(async () => {
  // Let the initial load settle before substituting the failed endpoint.
  await new Promise(resolve=>setTimeout(resolve,0));
  context.sortFixture = [
    {hash:'a',date:'2026-11-01T10:00:00+08:00'},
    {hash:'b',date:'2026-11-03T10:00:00+08:00'},
    {hash:'c',date:'2026-11-02T10:00:00+08:00'},
  ];
  context.metricsFixture = {a:{edits:20,files:1},b:{edits:5,files:3},c:{edits:10,files:2}};
  assert.equal(vm.runInContext('typeof sortCommits',context),'function');
  for (const [mode,expected] of [['date-desc','bca'],['date-asc','acb'],['edits-desc','acb'],['edits-asc','bca'],['files-desc','bca'],['files-asc','acb']]) {
    context.sortMode=mode;
    assert.equal(vm.runInContext('sortCommits(sortFixture, sortMode, metricsFixture).map(c=>c.hash).join("")',context),expected);
  }
  assert.equal(context.sortFixture.map(c=>c.hash).join(''),'abc','sorting must not mutate source history');
  context.reverseFixture = [...commits].reverse();
  context.originalLayout = layout;
  const reversedLayout = vm.runInContext('layoutForOrder(reverseFixture, originalLayout)',context);
  assert.equal(reversedLayout.assign[reversedLayout.rowOf.get('main')],0,'sorting preserves main lane');
  assert.equal(reversedLayout.edges.length,3,'sorting preserves every parent edge');
  assert.ok(reversedLayout.edges.every(e=>e.from > e.to),'reverse order supports upward parent edges');
  vm.runInContext(`
    state.sourceCommits = sortFixture.map(c=>({...c,parents:[],refs:[]}));
    state.data = {commits:[...state.sourceCommits]};
    state.sourceLayout = computeLayout(state.sourceCommits,'a');
    state.layout = state.sourceLayout;
    state.selected = 0;
    state.metrics = metricsFixture;
    state.filters.add('fix');
    applySort('files-desc');
  `,context);
  assert.equal(vm.runInContext('state.data.commits[state.selected].hash',context),'a','sorting preserves selected commit identity');
  assert.equal(vm.runInContext('state.filters.has("fix")',context),true,'sorting preserves type filters');
  vm.runInContext('state.filters.clear(); state.selected = -1',context);
  context.filterFixture = [
    {subject:'feat(ui): add filters',body:''},
    {subject:'fix!: change API',body:''},
    {subject:'ordinary message',body:'BREAKING CHANGE: removed field'},
    {subject:'docs: guide',body:''},
  ];
  assert.equal(vm.runInContext('typeof matchesTypeFilter',context),'function');
  assert.deepEqual(Array.from(vm.runInContext('filterFixture.map(matchesTypeFilter)',context)),[true,true,true,true]);
  vm.runInContext('state.filters.add("feat"); state.filters.add("fix")',context);
  assert.deepEqual(Array.from(vm.runInContext('filterFixture.map(matchesTypeFilter)',context)),[true,true,false,false]);
  vm.runInContext('state.filters.clear(); state.filters.add("breaking")',context);
  assert.deepEqual(Array.from(vm.runInContext('filterFixture.map(matchesTypeFilter)',context)),[false,true,true,false]);
  vm.runInContext(`
    state.data = {commits:filterFixture.map((c,i)=>({...c,hash:'hash'+i,parents:i < 3 ? ['hash'+(i+1)] : [],refs:[],author:'Author',date:'2026-11-03'}))};
    state.layout = computeLayout(state.data.commits,'hash0');
    Object.assign(el.scroller,{clientWidth:1200,clientHeight:600,scrollTop:0});
    render();
  `,context);
  const filteredSvg = elements.get('graph').innerHTML;
  assert.equal((filteredSvg.match(/data-row=/g) || []).length,4,'filtering must keep every graph row');
  assert.match(filteredSvg,/data-row="0" opacity="0\.22"/,'nonmatching node must dim');
  assert.match(filteredSvg,/filter-hit" data-row="1" opacity="1"/,'matching node must highlight');
  assert.match(filteredSvg,/filter-hit" data-row="2" opacity="1"/,'body breaking marker must highlight');
  assert.doesNotMatch(filteredSvg,/<path d=/,'non-time ranking hides parent edges');
  vm.runInContext('state.sort = "date-desc"; render()',context);
  assert.match(elements.get('graph').innerHTML,/<path d=/,'time order restores parent edges');
  vm.runInContext('state.filters.clear()',context);
  vm.runInContext('render()',context);
  assert.doesNotMatch(elements.get('graph').innerHTML,/opacity="0\.22"/,'clearing filters restores nodes');
  const exportNodes = {
    '#exportDestination':{value:'C:/exports/version'},
    '#exportIncludeGit':{checked:true},
    '#exportBranch':{value:'review/version'},
    '.export-result':{innerHTML:''}, '.export-notes':{innerHTML:''}, '.export-submit':{disabled:true},
  };
  context.formFixture = {dataset:{repo:'C:/repo',hash:'1234567890'},isConnected:true,querySelector:s=>exportNodes[s]};
  context.panelFixture = {querySelector:()=>context.formFixture};
  context.fetch = async (url,options) => {
    if (url.startsWith('/api/export-info')) return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{files:2,submodules:[],warnings:['LFS pointer files retained']}})};
    context.exportPayload = JSON.parse(options.body);
    assert.equal(options.method,'POST');
    assert.equal(options.headers['Content-Type'],'application/json');
    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{path:context.exportPayload.destination,hash:'1234567890',include_git:context.exportPayload.include_git,branch:context.exportPayload.branch}})};
  };
  await vm.runInContext('prepareExport(panelFixture)',context);
  assert.equal(context.formFixture.dataset.ready,'true');
  assert.equal(exportNodes['.export-submit'].disabled,false);
  assert.match(exportNodes['.export-notes'].innerHTML,/LFS pointer/);
  await vm.runInContext('exportSelectedVersion(formFixture)',context);
  assert.equal(context.exportPayload.include_git,true);
  assert.equal(context.exportPayload.branch,'review/version');
  assert.match(exportNodes['.export-result'].innerHTML,/打开文件夹/);
  exportNodes['#exportIncludeGit'].checked=false;
  await vm.runInContext('exportSelectedVersion(formFixture)',context);
  assert.equal(context.exportPayload.branch,'','snapshot must not send a branch name');
  assert.equal(vm.runInContext('state.exportBusy',context),false);
  // Export forms carry data-hash for the export request; controls inside them
  // must not be mistaken for the parent/child commit navigation buttons.
  context.navigationCalls = 0;
  const originalSelectCommit = vm.runInContext('selectCommit',context);
  context.selectCommit = () => {context.navigationCalls++;};
  const checkbox = {id:'exportIncludeGit',checked:true,
    closest:selector => selector === '[data-hash]' ? context.formFixture : null};
  await elements.get('detailContent').listeners.click[0]({target:checkbox});
  assert.equal(context.navigationCalls,0,'checkbox clicks must not reselect the commit and rebuild the form');
  elements.get('detailContent').listeners.change[0]({target:checkbox});
  assert.equal(elements.get('exportBranchField').hidden,false,'checking Git mode shows branch input');
  checkbox.checked=false;
  elements.get('detailContent').listeners.change[0]({target:checkbox});
  assert.equal(elements.get('exportBranchField').hidden,true,'unchecking Git mode hides branch input');
  const relationButton = {dataset:{hash:'hash0'}};
  await elements.get('detailContent').listeners.click[0]({target:{
    closest:selector => selector === 'button.relation[data-hash]' ? relationButton : null,
  }});
  assert.equal(context.navigationCalls,1,'real parent/child navigation buttons must still work');
  context.selectCommit = originalSelectCommit;
  vm.runInContext(`state.data.repo='C:/repo'; state.data.owned_tags=[]; state.writeToken=''; state.loading=false`,context);
  let accessRequests=0;
  context.fetch = async (url,options) => {
    accessRequests++;
    const body=JSON.parse(options.body);
    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:body.enabled ? {enabled:true,token:'test-write-token'} : {enabled:false}})};
  };
  await vm.runInContext('createSelectedTag({})',context);
  assert.equal(accessRequests,0,'read-only mode must not send tag writes');
  elements.get('sourceAccessBtn').listeners.click[0]();
  assert.equal(elements.get('writeAccessDialog').open,true,'switch must show warning first');
  assert.equal(accessRequests,0,'showing warning must not enable write access');
  await vm.runInContext('enableWriteAccess()',context);
  assert.equal(vm.runInContext('state.writeToken',context),'test-write-token');
  assert.equal(elements.get('writeAccessDialog').open,false);
  elements.get('sourceAccessBtn').listeners.click[0]();
  assert.equal(vm.runInContext('state.writeToken',context),'','switching back must clear access immediately');
  await new Promise(resolve=>setTimeout(resolve,0));
  vm.runInContext(`
    state.writeToken='test-write-token';
    state.selected=0;
    state.data.stats={commits:4,branches:1,tags:0,merges:0};
    state.sourceCommits=[...state.data.commits];
  `,context);
  const tagInput={value:'review/test'}, tagFeedback={textContent:''};
  context.tagFormFixture={dataset:{repo:'C:/repo',hash:'hash0'},isConnected:true,
    querySelector:selector=>selector === 'input[name=tagName]' ? tagInput : tagFeedback};
  context.fetch=async (url,options)=>{
    const body=JSON.parse(options.body);
    assert.equal(body.token,'test-write-token');
    const creating=url === '/api/tags/create';
    const refs=creating ? [{name:'review/test',kind:'tag'}] : [];
    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{
      name:'review/test',refs,commit_refs:creating ? {hash0:refs} : {},
      owned_tags:creating ? [{name:'review/test',hash:'hash0',status:'unchanged'}] : [],
      removed:['review/test'],skipped:[],missing:[],
    }})};
  };
  await vm.runInContext('createSelectedTag(tagFormFixture)',context);
  assert.equal(vm.runInContext('state.data.stats.tags',context),1);
  assert.equal(elements.get('ownedTagCount').textContent,1);
  assert.match(elements.get('detailRefs').innerHTML,/review\/test/);
  await vm.runInContext('undoSoftwareTags()',context);
  assert.equal(vm.runInContext('state.data.stats.tags',context),0);
  assert.equal(elements.get('ownedTagCount').textContent,0);
  assert.equal(elements.get('undoTagsBtn').disabled,true);
  for (const id of ['exportDestination','exportIncludeGit','exportBranch','tagName','exportPanel']) document.getElementById(id);
  elements.get('exportDestination').value='C:/我的/导出';
  elements.get('exportIncludeGit').checked=true;
  elements.get('exportBranch').value='中文/review';
  elements.get('tagName').value='审阅/待查';
  elements.get('exportPanel').open=true;
  elements.get('scroller').scrollTop=456;
  elements.get('detailContent').scrollTop=123;
  context.fetch=async (url)=>{
    assert.ok(url.startsWith('/api/commit'),'changing language must not write to the repository');
    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data:{files:[],patch:''}})};
  };
  vm.runInContext('state.data.commits[0].subject="feat(ui): 新增中文"; state.filters.add("feat"); setLanguage("en")',context);
  assert.equal(document.documentElement.lang,'en');
  assert.equal(vm.runInContext('state.writeToken',context),'test-write-token','language switch must preserve write access');
  assert.equal(vm.runInContext('state.filters.has("feat")',context),true);
  assert.equal(elements.get('exportDestination').value,'C:/我的/导出');
  assert.equal(elements.get('exportIncludeGit').checked,true);
  assert.equal(elements.get('exportBranch').value,'中文/review');
  assert.equal(elements.get('tagName').value,'审阅/待查');
  assert.equal(elements.get('exportPanel').open,true);
  assert.equal(elements.get('scroller').scrollTop,456);
  assert.equal(elements.get('detailContent').scrollTop,123);
  assert.match(elements.get('detailContent').innerHTML,/Export this version/);
  assert.match(elements.get('detailContent').innerHTML,/Destination folder/);
  assert.match(elements.get('detailContent').innerHTML,/feat\(ui\): 新增中文/);
  vm.runInContext('setLanguage("zh-CN")',context);
  assert.equal(document.documentElement.lang,'zh-CN');
  assert.match(elements.get('detailContent').innerHTML,/导出此版本/);
  await new Promise(resolve=>setTimeout(resolve,0));
  context.fetch = async () => ({status:404, ok:false, headers:{get(){return 'text/plain';}}, json(){throw new Error('JSON parser must not run');}});
  await assert.rejects(vm.runInContext('api("/api/commit?hash=1234567")',context),/旧版后端/);
  await assert.rejects(vm.runInContext('api("/api/graph")',context),/HTTP 404/);
  clearTimeout(vm.runInContext('toastTimer',context));
  console.log('Frontend checks passed: sorting, filtering, exports, checkbox regression, write gate, tags, bilingual UI and preserved form/navigation state.');
})().catch(err=>{console.error(err);process.exitCode=1;});
