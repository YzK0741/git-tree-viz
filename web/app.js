"use strict";

const t = I18N.t;

const ROW = 54, LANE = 25, LEFT = 24, PAD = 26;
const COLORS = ["#a5d9bb", "#b5a0dd", "#e2bc84", "#83bbd1", "#dc9eb5", "#bac97b"];
const $ = (id) => document.getElementById(id);
const el = Object.fromEntries(["graph", "scroller", "repoInput", "loadBtn", "stats", "detail", "detailContent", "status", "searchInput"].map(id => [id, $(id)]));
const state = {data:null, layout:null, selected:-1, matches:[], matchIndex:-1, parent:0, file:"", request:0, loading:false, filters:new Set()};
Object.assign(state, {sourceCommits:[], sourceLayout:null, sort:"date-desc", metrics:null,
  metricsPromise:null, sortRequest:0, generation:0, exportBusy:false, lastExport:null,
  writeToken:"", accessBusy:false, tagBusy:false});
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[m]));
const color = lane => COLORS[lane % COLORS.length];
const yOf = row => PAD + row * ROW + ROW / 2;
const xOf = lane => LEFT + lane * LANE;
const short = hash => hash.slice(0, 8);
const COMMIT_TYPES = {
  feat: {color:"#a5d9bb", label:"新功能"},
  fix: {color:"#ec9a95", label:"修复"},
  refactor: {color:"#bda4e8", label:"重构"},
  perf: {color:"#e7b176", label:"性能"},
  docs: {color:"#8cbce8", label:"文档"},
  test: {color:"#85d0d0", label:"测试"},
  chore: {color:"#a1aab4", label:"维护"},
  build: {color:"#a1aab4", label:"构建"},
  ci: {color:"#a1aab4", label:"持续集成"},
};

function commitType(commit) {
  const match = /^(feat|fix|refactor|perf|docs|test|chore|build|ci)(?:\([^\r\n)]+\))?(!)?:\s*/i.exec(commit.subject || "");
  const type = match ? match[1].toLowerCase() : "";
  return {type, prefix:match ? match[0] : "", ...COMMIT_TYPES[type],
    breaking:!!match?.[2] || /^BREAKING[ -]CHANGE:\s*\S/m.test(commit.body || "")};
}

function typedTitle(commit) {
  const info = commitType(commit);
  return info.type ? `<tspan fill="${info.color}" font-weight="600">${esc(info.prefix)}</tspan>${esc(commit.subject.slice(info.prefix.length))}` : esc(commit.subject || t("（无标题）"));
}

function typeBadges(commit) {
  const info = commitType(commit);
  return `${info.type ? `<span class="type-badge" style="--type-color:${info.color}">${info.type} · ${t(info.label)}</span>` : ""}${info.breaking ? `<span class="type-badge breaking-badge">! ${t("破坏性变更")}</span>` : ""}`;
}

function matchesTypeFilter(commit) {
  if (!state.filters.size) return true;
  const info = commitType(commit);
  return state.filters.has(info.type) || (state.filters.has("breaking") && info.breaking);
}

function renderTypeFilters() {
  const options = {all:{label:"全部",color:"#a1aab4"}, ...COMMIT_TYPES,
    breaking:{label:"破坏性变更",color:"#ec9a95"}};
  $("typeFilters").innerHTML = Object.entries(options).map(([type,info]) => {
    const active = type === "all" ? !state.filters.size : state.filters.has(type);
    return `<button type="button" class="filter-chip" data-type="${type}" aria-pressed="${active}" style="--type-color:${info.color}" title="${t(info.label)}${type === 'all' ? t("：清除类型筛选") : t("：点击切换，可多选")}">${type === "all" ? t("全部") : type === "breaking" ? "! BREAKING" : type}</button>`;
  }).join("");
  const total = state.data?.commits.length || 0;
  const count = state.filters.size ? (state.data?.commits || []).filter(matchesTypeFilter).length : total;
  $("filterCount").textContent = state.filters.size ? `${count}/${total}` : "";
  $("filterCount").title = state.filters.size ? t("{count} 个提交匹配，其他提交暗显", {count}) : "";
}

const SORT_LABELS = {"date-desc":"从新到旧 ↓", "date-asc":"从旧到新 ↑",
  "edits-desc":"编辑量：从大到小 ↓", "edits-asc":"编辑量：从小到大 ↑",
  "files-desc":"涉及文件：从多到少 ↓", "files-asc":"涉及文件：从少到多 ↑"};

function sortCommits(commits, mode, metrics = {}) {
  const [key, direction] = mode.split("-");
  const sign = direction === "asc" ? 1 : -1;
  const value = c => key === "date" ? (Date.parse(c.date) || 0) : metrics[c.hash]?.[key] || 0;
  // Stable ties keep the repository's original date-order, in either direction.
  return [...commits].sort((a,b) => sign * (value(a) - value(b)));
}

function layoutForOrder(commits, sourceLayout) {
  const rowOf = new Map(commits.map((c,i) => [c.hash,i]));
  const assign = commits.map(c => sourceLayout.assign[sourceLayout.rowOf.get(c.hash)]);
  const edges = [];
  commits.forEach((c,from) => c.parents.forEach((p,k) => {
    if (rowOf.has(p)) edges.push({from,to:rowOf.get(p),merge:k > 0});
  }));
  return {...sourceLayout, rowOf, assign, edges};
}

function applySort(mode) {
  const selectedHash = state.data.commits[state.selected]?.hash;
  state.data.commits = sortCommits(state.sourceCommits, mode, state.metrics || {});
  state.layout = layoutForOrder(state.data.commits, state.sourceLayout);
  state.selected = selectedHash ? state.layout.rowOf.get(selectedHash) ?? -1 : -1;
  state.sort = mode;
  $("sortSelect").value = mode;
  const timeSort = mode.startsWith("date-");
  $("mainLabel").textContent = timeSort ? `⑂ ${state.data.main_branch || "HEAD"} / ${t("主线")}` : `${t("提交列表")} / ${mode.startsWith("edits-") ? t("编辑量") : t("文件数")}`;
  if (state.selected >= 0) $("detailIndex").textContent = `${state.selected + 1} / ${state.data.commits.length}`;
  search(false);
  el.scroller.scrollTop = 0;
  scheduleRender();
}

async function changeSort(mode) {
  if (!state.data || state.loading || !SORT_LABELS[mode]) return;
  const request = ++state.sortRequest;
  const generation = state.generation;
  try {
    if (!mode.startsWith("date-") && !state.metrics) {
      $("sortStatus").textContent = t("统计变更量…");
      if (!state.metricsPromise) {
        state.metricsPromise = api("/api/metrics?repo=" + encodeURIComponent(state.data.repo));
      }
      const metrics = await state.metricsPromise;
      if (generation !== state.generation) return;
      if (state.sourceCommits.some(c => !metrics[c.hash])) {
        throw new Error(t("仓库历史已变化，请重新打开仓库后排序。"));
      }
      state.metrics = metrics;
    }
    if (request !== state.sortRequest || generation !== state.generation) return;
    applySort(mode);
  } catch (err) {
    if (request !== state.sortRequest || generation !== state.generation) return;
    state.metricsPromise = null;
    $("sortSelect").value = state.sort;
    toast(t("排序失败：") + err.message, true);
  } finally {
    if (request === state.sortRequest) $("sortStatus").textContent = "";
  }
}
let toastTimer, renderFrame;

function toast(message, error = false) {
  clearTimeout(toastTimer);
  el.status.textContent = message;
  el.status.classList.remove("hidden");
  el.status.style.borderColor = error ? "#975c62" : "";
  toastTimer = setTimeout(() => el.status.classList.add("hidden"), error ? 7000 : 2600);
}

function computeLayout(commits, mainHash) {
  const rowOf = new Map(commits.map((c, i) => [c.hash, i]));
  const mainline = new Set();
  let hash = mainHash;
  while (rowOf.has(hash) && !mainline.has(hash)) {
    mainline.add(hash);
    hash = commits[rowOf.get(hash)].parents[0];
  }
  const active = [mainHash], assign = [], edges = [];
  let maxLane = 0;
  function free() {
    // Lane zero belongs to the main branch's first-parent history.
    for (let i = 1; i < active.length; i++) if (!active[i]) return i;
    active.push(null);
    return active.length - 1;
  }
  commits.forEach((c, row) => {
    let lane = mainline.has(c.hash) ? 0 : active.findIndex((h, i) => i > 0 && h === c.hash);
    if (lane < 0) lane = free();
    active.forEach((h, i) => {if (h === c.hash) active[i] = null;});
    assign[row] = lane;
    maxLane = Math.max(maxLane, lane);
    c.parents.forEach((p, k) => {
      if (mainline.has(p)) { active[0] = p; return; }
      if (active.includes(p)) return;
      const pl = k === 0 && lane !== 0 ? lane : free();
      active[pl] = p;
      maxLane = Math.max(maxLane, pl);
    });
  });
  commits.forEach((c, row) => c.parents.forEach((p, k) => {
    if (rowOf.has(p)) edges.push({from:row, to:rowOf.get(p), merge:k > 0});
  }));
  const children = new Map();
  commits.forEach(c => c.parents.forEach(p => {
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(c.hash);
  }));
  return {assign, rowOf, maxLane, edges, children, mainline};
}

function scheduleRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {renderFrame = null; render();});
}

function render() {
  if (!state.data?.commits.length) {el.graph.innerHTML = ""; return;}
  const {commits} = state.data, {assign, maxLane, edges} = state.layout;
  const timeSort = state.sort.startsWith("date-");
  const width = el.scroller.clientWidth;
  const origin = Math.max(18, width * .40 - LEFT);
  el.graph.style.left = `${origin}px`;
  const textX = xOf(timeSort ? maxLane + 1 : 1) + 20;
  const textWidth = Math.max(200, width - origin - textX - 24);
  const svgWidth = textX + textWidth + 24;
  el.graph.setAttribute("width", svgWidth);
  el.graph.setAttribute("height", PAD * 2 + commits.length * ROW);
  const start = Math.max(0, Math.floor((el.scroller.scrollTop - PAD) / ROW) - 10);
  const end = Math.min(commits.length, Math.ceil((el.scroller.scrollTop + el.scroller.clientHeight) / ROW) + 10);
  const selected = state.selected, related = new Set([selected]);
  const filtering = state.filters.size > 0;
  const typeMatches = filtering ? commits.map(matchesTypeFilter) : null;
  if (selected >= 0) {
    const c = commits[selected];
    [...c.parents, ...(state.layout.children.get(c.hash) || [])].forEach(h => related.add(state.layout.rowOf.get(h)));
  }
  const edgeParts = [];
  for (const e of timeSort ? edges : []) {
    if (Math.max(e.from, e.to) < start || Math.min(e.from, e.to) >= end) continue;
    const x1 = xOf(assign[e.from]), x2 = xOf(assign[e.to]);
    const y1 = yOf(e.from), y2 = yOf(e.to), dy = y2 - y1;
    const d = x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${y1 + dy * .42} ${x2} ${y2 - dy * .42} ${x2} ${y2}`;
    const linked = e.from === selected || e.to === selected;
    const edgeOpacity = filtering ? (typeMatches[e.from] || typeMatches[e.to] ? .85 : .1) : (selected < 0 || linked ? .85 : .3);
    edgeParts.push(`<path d="${d}" fill="none" stroke="${color(assign[e.from])}" stroke-width="${linked ? 2.8 : 1.7}" opacity="${edgeOpacity}"${e.merge ? ' stroke-dasharray="4 3"' : ""}/>`);
  }
  const rows = [], matchSet = new Set(state.matches);
  for (let row = start; row < end; row++) {
    const c = commits[row], x = xOf(timeSort ? assign[row] : 0), y = yOf(row), isSelected = selected === row;
    const isRoot = c.parents.length === 0, isMerge = c.parents.length > 1;
    const refText = (c.refs || []).map(r => r.name).join(" · ");
    const date = (c.date || "").slice(0, 10);
    const opacity = filtering ? 1 : selected < 0 || related.has(row) ? 1 : .7;
    const filterHit = filtering && typeMatches[row];
    const rowOpacity = filtering && !filterHit ? (isSelected ? .5 : .22) : 1;
    const kind = commitType(c);
    const badgeWidth = kind.type ? kind.type.length * 6 + 16 : 0;
    const metric = state.metrics?.[c.hash];
    const metricText = metric && !state.sort.startsWith("date-") ? ` · +${metric.additions} −${metric.deletions} · ${metric.files} ${t("文件")}` : "";
    rows.push(`<g class="commit-row${isSelected ? " selected" : ""}${matchSet.has(row) ? " matched" : ""}${filterHit ? " filter-hit" : ""}" data-row="${row}" opacity="${rowOpacity}">
      <title>${esc(c.subject)}\n${esc(c.author)} · ${esc(date)}\n${c.hash}${refText ? "\n" + esc(refText) : ""}</title>
      <rect class="row-bg" x="${-Math.min(origin, 160)}" y="${y - ROW / 2 + 3}" width="${svgWidth + Math.min(origin, 160) - 6}" height="${ROW - 6}" rx="7" fill="transparent"/>
      ${isSelected ? `<circle cx="${x}" cy="${y}" r="12" fill="${color(assign[row])}" opacity=".13"/>` : ""}
      ${isRoot ? `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="2" fill="${color(assign[row])}"/>` : `<circle cx="${x}" cy="${y}" r="${isMerge ? 5.5 : 4}" fill="${isMerge ? '#101316' : color(assign[row])}" stroke="${color(assign[row])}" stroke-width="2"/>`}
      <g opacity="${opacity}">
      <text x="${textX}" y="${y - 5}" font-size="12" fill="${isSelected ? '#d5f0df' : '#dce2e5'}" clip-path="url(#titleClip)">${typedTitle(c)}</text>
      ${kind.type ? `<rect x="${textX}" y="${y + 2}" width="${badgeWidth}" height="16" rx="4" fill="${kind.color}" fill-opacity=".12"/><text x="${textX + 8}" y="${y + 13}" font-size="9" font-family="Consolas,monospace" fill="${kind.color}">${kind.type}</text>` : ""}
      <text x="${textX + (badgeWidth ? badgeWidth + 8 : 0)}" y="${y + 13}" font-size="9" fill="#88959d" font-family="Consolas,monospace" clip-path="url(#titleClip)">${kind.breaking ? '<tspan fill="#ec9a95">! BREAKING · </tspan>' : ''}${metricText ? `<tspan fill="#b8c9bf">${esc(metricText.slice(3))}</tspan> · ` : ''}<tspan fill="${color(assign[row])}">${short(c.hash)}</tspan> · ${esc(c.author)} · ${date}${refText ? ` · ${esc(refText)}` : ""}</text>
      ${c.hash === state.data.head_hash ? `<text x="${x - 14}" y="${y + 3}" text-anchor="end" fill="#a5d9bb" font-size="8" font-family="Consolas,monospace">HEAD</text>` : ""}
      </g></g>`);
  }
  el.graph.innerHTML = `<defs><clipPath id="titleClip"><rect x="${textX}" y="0" width="${textWidth}" height="${PAD * 2 + commits.length * ROW}"/></clipPath></defs><g pointer-events="none">${edgeParts.join("")}</g>${rows.join("")}`;
}

function jump(row) {
  if (row == null || row < 0) return;
  el.scroller.scrollTo({top:Math.max(0, yOf(row) - el.scroller.clientHeight / 3), left:0, behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
}

function closeDetail() {
  state.selected = -1;
  state.request++;
  document.body.classList.remove("detail-open");
  el.detail.inert = true;
  el.scroller.focus({preventScroll:true});
  scheduleRender();
}

function dateLabel(date) {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleString(I18N.locale, {hour12:false});
}

function selectCommit(row, navigate = false, restore = null) {
  if (row < 0 || row >= (state.data?.commits.length || 0)) return;
  state.selected = row;
  state.parent = restore?.parent ?? 0;
  state.file = restore?.file || "";
  state.request++;
  const c = state.data.commits[row], children = state.layout.children.get(c.hash) || [];
  const relations = (hashes, label) => hashes.length ? `<div class="section-heading">${t(label)}<small>${hashes.length} ${t("个")}</small></div><div class="relation-list">${hashes.map(h => `<button class="relation" data-hash="${h}" title="${esc(state.data.commits[state.layout.rowOf.get(h)]?.subject || h)}"${state.layout.rowOf.has(h) ? '' : ' disabled'}>↗ ${short(h)}</button>`).join("")}</div>` : "";
  $("detailIndex").textContent = `${row + 1} / ${state.data.commits.length}`;
  el.detailContent.innerHTML = `<div class="commit-kind">${c.parents.length > 1 ? t("MERGE COMMIT / 合并提交") : c.parents.length === 0 ? t("ROOT COMMIT / 根提交") : t("COMMIT / 提交")}</div>
    <h2>${esc(c.subject || t("（无标题）"))}</h2>
    ${typeBadges(c) ? `<div class="type-badges">${typeBadges(c)}</div>` : ""}
    <div id="detailRefs" class="ref-list">${refBadges(c)}</div>
    <button class="hash-button" id="copyHash" title="${c.hash}">${short(c.hash)}<small>${t("复制完整哈希 ⧉")}</small></button>
    <form id="tagForm" class="tag-form" data-hash="${c.hash}" data-repo="${esc(state.data.repo)}">
      <fieldset class="tag-fields"${!state.writeToken || state.tagBusy ? ' disabled' : ''}><label for="tagName">${t("本地标签")}</label><div class="tag-input-row"><input id="tagName" name="tagName" required spellcheck="false" placeholder="${t("例如 v1.0 或 review/important")}" aria-label="${t("新标签名称")}"><button type="submit">${t("打标签")}</button></div></fieldset>
      <p class="tag-mode-hint">${state.writeToken ? t("标签保存在本地，须手动推送到远端。") : t("打标签前，请在右上角开启“源仓库读写”。")}</p><div class="tag-feedback" role="status"></div>
    </form>
    <dl class="meta-grid"><dt>${t("作者")}</dt><dd>${esc(c.author)}<small>${esc(c.email)}</small></dd><dt>${t("时间")}</dt><dd>${esc(dateLabel(c.date))}<small>${esc(c.date)}</small></dd></dl>
    ${c.body ? `<div class="body">${esc(c.body)}</div>` : ""}
    <details class="export-panel" id="exportPanel"><summary>↗ ${t("导出此版本")}</summary>
      <form id="exportForm" data-hash="${c.hash}" data-repo="${esc(state.data.repo)}">
        <p class="muted">${t("导出 {hash} 记录的状态，不包含工作区未提交的修改。", {hash:short(c.hash)})}</p>
        <label class="export-field" for="exportDestination">${t("目标文件夹")}<input id="exportDestination" name="destination" required spellcheck="false" value="${esc(state.data.repo.replace(/[\\/]+$/, '') + '-' + short(c.hash))}" placeholder="${t("输入目标文件夹的绝对路径")}"></label>
        <p class="export-hint">${t("目录须不存在或为空，上级目录须已存在。")}</p>
        <label class="export-checkbox"><input id="exportIncludeGit" type="checkbox"> ${t("保留 .git，建立独立仓库")}</label>
        <p class="export-hint" id="exportModeHint">${t("仅导出提交中的文件，不附带 Git 历史。")}</p>
        <div id="exportBranchField" hidden><label class="export-field" for="exportBranch">${t("新分支名称（可选）")}<input id="exportBranch" spellcheck="false" placeholder="${t("例如 review/version")}"></label><p class="export-hint">${t("留空时停留在此提交（detached HEAD）。")}</p></div>
        <div id="exportWarnings" class="export-notes" role="status"></div>
        <button type="submit" class="export-submit" disabled>${state.exportBusy ? t("已有导出任务进行中…") : t("导出到目标文件夹")}</button>
        <div class="export-result" id="exportResult" role="status">${state.lastExport?.hash === c.hash && state.lastExport.repo === state.data.repo ? exportResultMarkup(state.lastExport) : ""}</div>
      </form></details>
    ${relations(c.parents, t("父提交"))}${relations(children, t("子提交"))}
    <div class="section-heading">${t("文件变更")} <div id="changeSummary" class="change-summary"></div></div>
    <div class="comparison">${t("比较基准")} ${c.parents.length > 1 ? `<select id="parentSelect" aria-label="${t("选择比较的父提交")}">${c.parents.map((p,i) => `<option value="${i}">${t("父提交 {number} · {hash}", {number:i + 1,hash:short(p)})}</option>`).join("")}</select>` : c.parents.length ? short(c.parents[0]) : t("空目录（初始提交）")}</div>
    <div id="changes"><div class="loading">${t("正在读取变更…")}</div></div>`;
  if (restore) {
    $("exportDestination").value = restore.destination;
    $("exportIncludeGit").checked = restore.includeGit;
    $("exportBranch").value = restore.branch;
    $("tagName").value = restore.tagName;
    $("exportBranchField").hidden = !restore.includeGit;
    $("exportModeHint").textContent = restore.includeGit ? t("复制独立的 Git 历史并检出此提交，不依赖源仓库的对象文件。") : t("仅导出提交中的文件，不附带 Git 历史。");
    if ($("parentSelect")) $("parentSelect").value = state.parent;
    $("exportPanel").open = restore.exportOpen;
  }
  el.detailContent.scrollTop = 0;
  document.body.classList.add("detail-open");
  el.detail.inert = false;
  if (navigate) jump(row);
  scheduleRender();
  loadChanges(state.file);
}

async function api(url, options) {
  const res = await fetch(url, options);
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (res.status === 404 && url.startsWith("/api/commit")) {
      throw new Error(t("当前运行的是旧版后端，尚不支持提交详情。请重启 server.py，或打开新版预览 http://127.0.0.1:8770。"));
    }
    throw new Error(t("服务未返回有效的 JSON 数据（HTTP {status}），请确认已启动新版 server.py。", {status:res.status}));
  }
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(I18N.message(json.error || "") || t("请求失败 ({status})", {status:res.status}));
  return json.data;
}

function post(url, body) {
  return api(url, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
}

function refBadges(commit) {
  return (commit.refs || []).map(r => `<span class="ref-pill ${r.kind}">${esc(r.name)}</span>`).join("");
}

function renderRepoStats() {
  if (!state.data) return;
  el.stats.innerHTML = [["commits","提交"],["branches","分支"],["tags","标签"],["merges","合并"]].map(([key,label]) => `<div class="stat"><b>${state.data.stats[key].toLocaleString(I18N.locale)}</b><span>${t(label)}</span></div>`).join("");
}

function updateAccessUI() {
  const writing = !!state.writeToken;
  $("languageSelect").disabled = state.tagBusy || state.exportBusy || state.accessBusy;
  $("sourceAccessLabel").textContent = writing ? t("源仓库读写") : t("源仓库只读");
  $("sourceAccessBtn").setAttribute("aria-pressed", String(writing));
  $("sourceAccessBtn").classList.toggle("write-enabled", writing);
  $("sourceAccessBtn").disabled = !state.data || state.loading || state.tagBusy || state.accessBusy;
  const owned = state.data?.owned_tags?.length || 0;
  $("ownedTagCount").textContent = owned;
  $("undoTagsBtn").disabled = !writing || !owned || state.tagBusy || state.loading;
  document.querySelectorAll(".tag-fields").forEach(fieldset => {fieldset.disabled = !writing || state.tagBusy || state.loading;});
  document.querySelectorAll(".tag-mode-hint").forEach(hint => {hint.textContent = writing ? t("标签保存在本地，须手动推送到远端。") : t("打标签前，请在右上角开启“源仓库读写”。");});
}

function resetWriteAccess() {
  const token = state.writeToken, repo = state.data?.repo;
  state.writeToken = "";
  if (token && repo) post("/api/write-access", {repo,token,enabled:false}).catch(() => {});
  if ($("writeAccessDialog").open) $("writeAccessDialog").close();
  updateAccessUI();
}

async function enableWriteAccess() {
  const repo = $("writeAccessDialog").dataset.repo;
  if (!state.data || repo !== state.data.repo || state.loading || state.tagBusy || state.accessBusy) return;
  const generation = state.generation;
  state.accessBusy = true;
  $("enableWriteBtn").disabled = true;
  $("writeAccessError").textContent = "";
  try {
    const result = await post("/api/write-access", {repo,enabled:true});
    if (repo !== state.data?.repo || generation !== state.generation || !$("writeAccessDialog").open) {
      post("/api/write-access", {repo,token:result.token,enabled:false}).catch(() => {});
      return;
    }
    state.writeToken = result.token;
    $("writeAccessDialog").close();
    toast(t("已开启源仓库读写，可创建或撤回本地标签"));
  } catch (err) {
    $("writeAccessError").textContent = err.message;
  } finally {
    state.accessBusy = false;
    $("enableWriteBtn").disabled = false;
    updateAccessUI();
  }
}

function syncTagReferences(result, repo) {
  if (repo !== state.data?.repo) return;
  state.data.refs = result.refs;
  state.data.owned_tags = result.owned_tags;
  for (const commit of state.sourceCommits) commit.refs = result.commit_refs[commit.hash] || [];
  state.data.stats.tags = result.refs.filter(ref => ref.kind === "tag").length;
  const selected = state.data.commits[state.selected];
  if (selected && $("detailRefs")) $("detailRefs").innerHTML = refBadges(selected);
  renderRepoStats();
  updateAccessUI();
  search(false);
  scheduleRender();
}

async function createSelectedTag(form) {
  if (state.tagBusy || state.loading) return;
  if (!state.writeToken) {toast(t("请先在右上角开启源仓库读写"), true); return;}
  const name = form.querySelector("input[name=tagName]").value.trim();
  if (!name) return;
  const repo = form.dataset.repo;
  if (repo !== state.data?.repo) return;
  const feedback = form.querySelector(".tag-feedback");
  state.tagBusy = true;
  feedback.textContent = t("正在创建标签…");
  updateAccessUI();
  try {
    const result = await post("/api/tags/create", {repo,hash:form.dataset.hash,name,token:state.writeToken});
    syncTagReferences(result, repo);
    feedback.textContent = t("已创建本地标签：") + result.name;
    form.querySelector("input[name=tagName]").value = "";
    toast(t("已打标签：") + result.name);
  } catch (err) {
    feedback.textContent = t("创建失败：") + err.message;
    if (!form.isConnected) toast(t("创建标签失败：") + err.message, true);
  } finally {
    state.tagBusy = false;
    updateAccessUI();
  }
}

async function undoSoftwareTags() {
  if (state.tagBusy || state.loading || !state.writeToken || !state.data?.owned_tags?.length) return;
  const repo = state.data.repo;
  state.tagBusy = true;
  updateAccessUI();
  try {
    const result = await post("/api/tags/undo-all", {repo,token:state.writeToken});
    syncTagReferences(result, repo);
    const message = t("已撤回 {count} 个本软件标签", {count:result.removed.length}) + (result.skipped.length ? t("；跳过 {count} 个已被修改的标签：", {count:result.skipped.length}) + result.skipped.join(", ") : "");
    toast(message, !!result.skipped.length);
  } catch (err) {toast(t("撤回标签失败：") + err.message, true);}
  finally {state.tagBusy = false; updateAccessUI();}
}

function exportResultMarkup(result) {
  return `<div class="export-success">✓ ${t("已导出")} ${short(result.hash)} · ${result.include_git ? t("独立 Git 仓库") : t("纯文件快照")}${result.branch ? ' · ' + esc(result.branch) : ''}<code>${esc(result.path)}</code><button type="button" class="quiet-button open-export" data-path="${esc(result.path)}">${t("打开文件夹")} ↗</button></div>`;
}

async function prepareExport(panel) {
  const form = panel.querySelector("form");
  if (!form || form.dataset.ready || form.dataset.checking) return;
  form.dataset.checking = "true";
  const notes = form.querySelector(".export-notes");
  notes.textContent = t("正在检查此版本的导出范围…");
  try {
    const info = await api("/api/export-info?" + new URLSearchParams({repo:form.dataset.repo,hash:form.dataset.hash}));
    notes.innerHTML = `<span class="muted">${t("{count} 个文件", {count:info.files.toLocaleString(I18N.locale)})}${info.submodules.length ? t(" · {count} 个子模块", {count:info.submodules.length}) : ''}</span>${info.warnings.map(w => `<p>${esc(I18N.message(w))}</p>`).join('')}`;
    form.dataset.ready = "true";
    form.querySelector(".export-submit").disabled = state.exportBusy;
  } catch (err) {
    notes.innerHTML = `<p>${t("无法检查导出范围：")}${esc(err.message)}</p><button type="button" class="quiet-button retry-export-info">${t("重试检查")}</button>`;
  } finally {
    delete form.dataset.checking;
  }
}

async function exportSelectedVersion(form) {
  if (!form.dataset.ready || state.exportBusy) return;
  const destination = form.querySelector("#exportDestination").value.trim();
  if (!destination) {toast(t("请填写目标文件夹"), true); return;}
  const includeGit = form.querySelector("#exportIncludeGit").checked;
  const payload = {repo:form.dataset.repo, hash:form.dataset.hash, destination,
    include_git:includeGit, branch:includeGit ? form.querySelector("#exportBranch").value.trim() : ""};
  const resultBox = form.querySelector(".export-result");
  state.exportBusy = true;
  updateAccessUI();
  document.querySelectorAll(".export-submit").forEach(button => {button.disabled = true; button.textContent = t("正在导出，请稍候…");});
  resultBox.innerHTML = "";
  try {
    const result = await api("/api/export", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
    state.lastExport = {...result,repo:payload.repo};
    resultBox.innerHTML = exportResultMarkup(result);
    const currentForm = $("exportForm");
    if (currentForm && currentForm !== form && currentForm.dataset.hash === result.hash && currentForm.dataset.repo === payload.repo) {
      currentForm.querySelector(".export-result").innerHTML = exportResultMarkup(result);
    }
    toast(t("导出完成：") + result.path);
  } catch (err) {
    resultBox.innerHTML = `<div class="error-box">${t("导出失败：")}${esc(err.message)}</div>`;
    if (!form.isConnected) toast(t("导出失败：") + err.message, true);
  } finally {
    state.exportBusy = false;
    updateAccessUI();
    document.querySelectorAll(".export-submit").forEach(button => {
      button.disabled = !button.closest("form").dataset.ready;
      button.textContent = t("导出到目标文件夹");
    });
  }
}

async function loadChanges(path = "", patchOnly = false) {
  const row = state.selected;
  if (row < 0) return;
  const c = state.data.commits[row], request = ++state.request;
  state.file = path;
  const target = patchOnly ? $("patchContent") : $("changes");
  if (!target) return;
  target.innerHTML = `<div class="loading">${t("正在读取差异…")}</div>`;
  if (!patchOnly) $("changeSummary").innerHTML = "";
  const params = new URLSearchParams({repo:state.data.repo, hash:c.hash, parent:state.parent, path});
  try {
    const data = await api(`/api/commit?${params}`);
    if (request !== state.request || c.hash !== state.data.commits[state.selected]?.hash) return;
    if (!patchOnly) {
      const added = data.files.reduce((n, f) => n + (f.additions || 0), 0);
      const deleted = data.files.reduce((n, f) => n + (f.deletions || 0), 0);
      $("changeSummary").innerHTML = `<span class="added">+${added}</span><span class="deleted">−${deleted}</span>`;
      target.innerHTML = data.files.length ? `<div class="file-list">${data.files.map(f => `<button class="file-button" data-file="${esc(f.path)}"><span class="file-status ${f.status}">${esc(f.status)}</span><span class="file-path">${esc(f.path)}</span><span class="file-nums">${f.additions == null ? t("二进制") : `<span class="added">+${f.additions}</span> <span class="deleted">−${f.deletions}</span>`}</span></button>`).join("")}</div><div class="section-heading"><span id="patchTitle">${t("全部差异 · {count} 个文件", {count:data.files.length})}</span><button id="allDiff" class="quiet-button">${t("查看全部")}</button></div><div id="patchContent"></div>` : `<p class="muted">${t("此提交相对此基准没有文件变更。")}</p>`;
    }
    const patchTarget = $("patchContent");
    if (patchTarget) {
      patchTarget.innerHTML = `${data.truncated ? `<p class="muted">${t("差异较大，仅显示前 200,000 个字符。可点击单个文件查看。")}</p>` : ""}<div class="patch" tabindex="0" aria-label="${t("代码差异")}">${data.patch ? data.patch.split("\n").map(line => {
        const cls = line.startsWith("@@") ? "diff-hunk" : /^(diff |index |--- |\+\+\+ )/.test(line) ? "diff-file" : line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-del" : "";
        return `<div class="diff-line ${cls}">${esc(line) || " "}</div>`;
      }).join("") : `<div class="diff-line">${t("没有文本差异")}</div>`}</div>`;
      $("patchTitle").textContent = path || t("全部差异 · {count} 个文件", {count:data.files.length});
      document.querySelectorAll(".file-button").forEach(b => b.classList.toggle("active", b.dataset.file === path));
    }
  } catch (err) {
    if (request !== state.request) return;
    target.innerHTML = `<div class="error-box">${t("无法读取差异：")}${esc(err.message)}<br><button id="retryChanges">${t("重新读取")}</button></div>`;
  }
}

async function loadGraph(repo) {
  if (state.loading || state.tagBusy) return;
  state.loading = true;
  resetWriteAccess();
  state.generation++;
  state.sortRequest++;
  $("sortStatus").textContent = "";
  $("sortSelect").disabled = true;
  state.request++;
  closeDetail();
  el.loadBtn.disabled = true;
  el.loadBtn.textContent = t("读取中…");
  try {
    const data = await api("/api/graph" + (repo ? "?repo=" + encodeURIComponent(repo) : ""));
    state.data = data;
    state.sourceCommits = [...data.commits];
    state.sourceLayout = computeLayout(data.commits, data.main_hash);
    state.metrics = null;
    state.metricsPromise = null;
    state.sort = "date-desc";
    state.layout = state.sourceLayout;
    renderTypeFilters();
    el.repoInput.value = data.repo;
    el.searchInput.value = "";
    state.matches = [];
    state.matchIndex = -1;
    $("searchCount").textContent = "";
    applySort("date-desc");
    $("repoName").textContent = data.repo.replace(/[\\/]$/, "").split(/[\\/]/).pop() || t("提交历史");
    $("repoMeta").textContent = `${data.head || t("未命名分支")} · ${data.stats.first_date?.slice(0,10) || '—'} → ${data.stats.last_date?.slice(0,10) || '—'}`;
    renderRepoStats();
    $("commitCount").textContent = data.stats.commits;
    $("mainLabel").textContent = `⑂ ${data.main_branch || "HEAD"} / ${t("主线")}`;
    el.scroller.scrollTop = 0;
    el.scroller.scrollLeft = 0;
    $("emptyState").hidden = !!data.commits.length;
    if (!data.commits.length) showEmpty(t("这里还没有提交"), t("为仓库创建第一次提交后，重新打开即可查看。"));
    render();
    if (data.repo) history.replaceState(null, "", "?repo=" + encodeURIComponent(data.repo));
  } catch (err) {
    toast(t("加载失败：") + err.message, true);
    if (!state.data) showEmpty(t("仓库尚未打开"), err.message);
  } finally {
    state.loading = false;
    updateAccessUI();
    el.loadBtn.disabled = false;
    $("sortSelect").disabled = false;
    el.loadBtn.innerHTML = `${t("打开仓库")} <span>↗</span>`;
  }
}

function showEmpty(title, message) {
  $("emptyState").hidden = false;
  $("emptyState").querySelector("h2").textContent = title;
  $("emptyState").querySelector("p").textContent = message;
}

function search(navigate = true) {
  const q = el.searchInput.value.trim().toLocaleLowerCase();
  state.matches = [];
  if (q && state.data) state.data.commits.forEach((c,i) => {
    if ([c.hash,c.author,c.email,c.subject,c.body,...(c.refs || []).map(r => r.name)].join("\n").toLocaleLowerCase().includes(q)) state.matches.push(i);
  });
  state.matchIndex = state.matches.length ? 0 : -1;
  updateSearchCount();
  if (navigate && state.matches.length) jump(state.matches[0]);
  scheduleRender();
}
function updateSearchCount() {
  $("searchCount").textContent = !el.searchInput.value.trim() ? "" : state.matches.length ? `${state.matchIndex + 1}/${state.matches.length}` : t("无结果");
}

function setLanguage(language) {
  if (state.tagBusy || state.exportBusy || state.accessBusy) return;
  const scrollerTop = el.scroller.scrollTop, scrollerLeft = el.scroller.scrollLeft;
  const detailTop = el.detailContent.scrollTop;
  const restore = state.selected < 0 ? null : {
    parent:state.parent, file:state.file,
    destination:$("exportDestination")?.value || "", includeGit:!!$("exportIncludeGit")?.checked,
    branch:$("exportBranch")?.value || "", tagName:$("tagName")?.value || "", exportOpen:!!$("exportPanel")?.open,
  };
  I18N.setLocale(language);
  I18N.apply();
  $("languageSelect").value = I18N.locale;
  renderTypeFilters();
  renderRepoStats();
  updateAccessUI();
  updateSearchCount();
  if ($("sortStatus").textContent) $("sortStatus").textContent = t("统计变更量…");
  el.loadBtn.innerHTML = state.loading ? t("读取中…") : `${t("打开仓库")} <span>↗</span>`;
  if (state.data) {
    $("mainLabel").textContent = state.sort.startsWith("date-") ? `⑂ ${state.data.main_branch || "HEAD"} / ${t("主线")}` : `${t("提交列表")} / ${state.sort.startsWith("edits-") ? t("编辑量") : t("文件数")}`;
    if (!state.data.commits.length) showEmpty(t("这里还没有提交"), t("为仓库创建第一次提交后，重新打开即可查看。"));
  } else {
    $("repoName").textContent = t("提交历史");
    $("repoMeta").textContent = t("每一条分支，都有迹可循。");
    $("mainLabel").textContent = t("主分支");
  }
  if (restore) {
    selectCommit(state.selected, false, restore);
    el.detailContent.scrollTop = detailTop;
  }
  el.scroller.scrollTop = scrollerTop;
  el.scroller.scrollLeft = scrollerLeft;
  render();
}
function nextMatch() {
  if (!state.matches.length) return;
  state.matchIndex = (state.matchIndex + 1) % state.matches.length;
  updateSearchCount();
  selectCommit(state.matches[state.matchIndex], true);
}

el.graph.addEventListener("click", e => {
  if (state.loading) return;
  const row = e.target.closest("[data-row]");
  if (row) selectCommit(Number(row.dataset.row));
});
el.scroller.addEventListener("scroll", scheduleRender, {passive:true});
new ResizeObserver(scheduleRender).observe(el.scroller);
$("closeDetail").addEventListener("click", closeDetail);
$("repoForm").addEventListener("submit", e => {e.preventDefault(); loadGraph(el.repoInput.value.trim());});
el.detailContent.addEventListener("click", async e => {
  const openButton = e.target.closest(".open-export");
  if (openButton) {
    openButton.disabled = true;
    try {await api("/api/open-folder", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:openButton.dataset.path})});}
    catch (err) {toast(t("无法打开文件夹：") + err.message, true);}
    finally {openButton.disabled = false;}
  }
  if (e.target.closest(".retry-export-info")) prepareExport(e.target.closest(".export-panel"));
  const relation = e.target.closest("button.relation[data-hash]");
  if (relation) selectCommit(state.layout.rowOf.get(relation.dataset.hash), true);
  const file = e.target.closest("[data-file]");
  if (file) loadChanges(file.dataset.file, true);
  if (e.target.closest("#allDiff")) loadChanges("", true);
  if (e.target.closest("#retryChanges")) loadChanges();
  if (e.target.closest("#copyHash")) {
    try {await navigator.clipboard.writeText(state.data.commits[state.selected].hash); toast(t("已复制完整提交哈希"));}
    catch {toast(t("复制失败，请从按钮提示中获取完整哈希"), true);}
  }
});
el.detailContent.addEventListener("change", e => {
  if (e.target.id === "exportIncludeGit") {
    $("exportBranchField").hidden = !e.target.checked;
    $("exportModeHint").textContent = e.target.checked ? t("复制独立的 Git 历史并检出此提交，不依赖源仓库的对象文件。") : t("仅导出提交中的文件，不附带 Git 历史。");
  }
  if (e.target.id === "parentSelect") {state.parent = Number(e.target.value); loadChanges();}
});
el.detailContent.addEventListener("toggle", e => {
  if (e.target.id === "exportPanel" && e.target.open) prepareExport(e.target);
}, true);
el.detailContent.addEventListener("submit", e => {
  if (e.target.id === "exportForm") {e.preventDefault(); exportSelectedVersion(e.target);}
  if (e.target.id === "tagForm") {e.preventDefault(); createSelectedTag(e.target);}
});
$("sourceAccessBtn").addEventListener("click", () => {
  if (!state.data || state.loading || state.tagBusy || state.accessBusy) return;
  if (state.writeToken) {resetWriteAccess(); toast(t("已切回源仓库只读")); return;}
  $("writeAccessRepo").textContent = state.data.repo;
  $("writeAccessDialog").dataset.repo = state.data.repo;
  $("writeAccessError").textContent = "";
  $("writeAccessDialog").showModal();
});
$("cancelWriteBtn").addEventListener("click", () => $("writeAccessDialog").close());
$("enableWriteBtn").addEventListener("click", enableWriteAccess);
$("undoTagsBtn").addEventListener("click", undoSoftwareTags);
$("languageSelect").addEventListener("change", e => setLanguage(e.target.value));
el.searchInput.addEventListener("input", search);
el.searchInput.addEventListener("keydown", e => {if (e.key === "Enter") {e.preventDefault(); nextMatch();}});
$("searchNext").addEventListener("click", nextMatch);
$("sortSelect").addEventListener("change", e => changeSort(e.target.value));
$("typeFilters").addEventListener("click", e => {
  const button = e.target.closest("[data-type]");
  if (!button) return;
  const type = button.dataset.type;
  if (type === "all") state.filters.clear();
  else if (state.filters.has(type)) state.filters.delete(type);
  else state.filters.add(type);
  renderTypeFilters();
  scheduleRender();
});
$("headBtn").addEventListener("click", () => {
  if (!state.data) return;
  const row = state.layout.rowOf.get(state.data.head_hash);
  if (row == null) toast(t("当前 HEAD 没有可显示的提交"));
  else {jump(row); if (state.selected >= 0) selectCommit(row);}
});
document.addEventListener("keydown", e => {
  if ($("writeAccessDialog").open) return;
  if (e.key === "Escape" && state.selected >= 0) {e.preventDefault(); closeDetail(); return;}
  if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) || e.target.closest("#detail")) return;
  if (e.key === "/") {e.preventDefault(); el.searchInput.focus();}
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && state.data?.commits.length) {
    e.preventDefault();
    const row = state.selected < 0 ? 0 : Math.max(0, Math.min(state.data.commits.length - 1, state.selected + (e.key === "ArrowDown" ? 1 : -1)));
    selectCommit(row, true);
  }
});

setLanguage(I18N.locale);
loadGraph(new URLSearchParams(location.search).get("repo") || "");
