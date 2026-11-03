"use strict";

// Chinese source strings are stable translation keys. Repository content is never translated.
var I18N = (() => {
  const en = {
    "中文":"中文", "Git Tree · 提交历史":"Git Tree · Commit History", "Git Tree 首页":"Git Tree home",
    "仓库":"Repository", "输入本地 Git 仓库路径":"Enter a local Git repository path", "本地仓库路径":"Local repository path",
    "打开仓库":"Open repository", "读取中…":"Loading…", "提交历史":"Commit history",
    "每一条分支，都有迹可循。":"Every branch has a story.", "仓库统计":"Repository statistics", "历史工具":"History tools",
    "提交图谱":"Commit graph", "提交类型筛选，支持多选":"Commit type filters, multiple selection allowed",
    "排序":"Sort", "提交排序":"Commit order", "从新到旧":"Newest first", "从旧到新":"Oldest first",
    "编辑量：从大到小":"Most lines changed", "编辑量：从小到大":"Fewest lines changed", "涉及文件：从多到少":"Most files changed", "涉及文件：从少到多":"Fewest files changed",
    "搜索提交、作者、哈希…":"Search commits, authors, hashes…", "搜索提交":"Search commits", "下一个搜索结果":"Next search result", "下一个结果 / Enter":"Next result / Enter",
    "定位 HEAD":"Go to HEAD", "撤回软件标签":"Undo app tags", "撤回当前仓库中本软件创建的所有标签，保留手动标签及后来被修改的标签":"Remove all tags created by this app in this repository; preserve manual and subsequently modified tags",
    "Git 提交图谱":"Git commit graph", "主分支":"Main branch", "提交历史，使用上下方向键选择，Escape 关闭详情":"Commit history. Use arrow keys to select; Escape closes details.",
    "Git 提交关系图":"Git commit relationships", "打开一段提交历史":"Explore a repository", "在上方输入本地 Git 仓库的路径。":"Enter a local Git repository path above.",
    "提交":"Commits", "合并":"Merges", "根提交":"Root", "分支":"Branches", "标签":"Tags", "点击提交查看详情 · Esc 关闭":"Click a commit for details · Esc to close",
    "提交详情":"Commit details", "关闭提交详情":"Close commit details", "关闭 / Esc":"Close / Esc",
    "启用源仓库读写？":"Enable repository write access?",
    "开启后，可以在源仓库中创建本地 Git 标签，也可以一键撤回本软件创建的全部标签。这些操作会修改仓库的 Git 引用记录。":"This allows you to create local Git tags and remove all tags created by this app. These actions modify Git references in the source repository.",
    "不会改变工作区文件或当前分支；标签须手动推送到远端。切换仓库或刷新页面后恢复只读。":"Working files and the current branch stay unchanged. Tags must be pushed manually. Switching repositories or refreshing restores read-only mode.",
    "保持只读":"Keep read-only", "启用读写":"Enable write access", "源仓库只读":"Repository read-only", "源仓库读写":"Repository read/write",
    "新功能":"Feature", "修复":"Fix", "重构":"Refactor", "性能":"Performance", "文档":"Documentation", "测试":"Tests", "维护":"Maintenance", "构建":"Build", "持续集成":"CI",
    "（无标题）":"(Untitled)", "破坏性变更":"Breaking change", "全部":"All", "：清除类型筛选":": clear type filters", "：点击切换，可多选":": toggle; multiple selection allowed",
    "{count} 个提交匹配，其他提交暗显":"{count} matching commits; other commits are dimmed", "主线":"mainline", "提交列表":"Commit list", "编辑量":"Lines changed", "文件数":"Files changed",
    "统计变更量…":"Counting changes…", "仓库历史已变化，请重新打开仓库后排序。":"Repository history has changed. Reopen the repository before sorting.", "排序失败：":"Could not sort: ",
    "文件":"files", "个":"items", "MERGE COMMIT / 合并提交":"MERGE COMMIT", "ROOT COMMIT / 根提交":"ROOT COMMIT", "COMMIT / 提交":"COMMIT",
    "复制完整哈希 ⧉":"Copy full hash ⧉", "本地标签":"Local tag", "例如 v1.0 或 review/important":"e.g. v1.0 or review/important", "新标签名称":"New tag name", "打标签":"Create tag",
    "标签保存在本地，须手动推送到远端。":"Tags are stored locally and must be pushed manually.", "打标签前，请在右上角开启“源仓库读写”。":"Enable repository write access at the top right before creating tags.",
    "作者":"Author", "时间":"Date", "导出此版本":"Export this version", "导出 {hash} 记录的状态，不包含工作区未提交的修改。":"Export the state recorded in {hash}, excluding uncommitted changes.",
    "目标文件夹":"Destination folder", "输入目标文件夹的绝对路径":"Enter an absolute destination path", "目录须不存在或为空，上级目录须已存在。":"The destination must be empty or not exist. Its parent folder must exist.",
    "保留 .git，建立独立仓库":"Include .git as an independent repository", "仅导出提交中的文件，不附带 Git 历史。":"Export committed files only, without Git history.",
    "新分支名称（可选）":"New branch name (optional)", "例如 review/version":"e.g. review/version", "留空时停留在此提交（detached HEAD）。":"Leave blank to check out this commit with a detached HEAD.",
    "已有导出任务进行中…":"Another export is running…", "导出到目标文件夹":"Export to folder", "父提交":"Parents", "子提交":"Children", "文件变更":"Changed files", "比较基准":"Compare against",
    "选择比较的父提交":"Choose the comparison parent", "父提交 {number} · {hash}":"Parent {number} · {hash}", "空目录（初始提交）":"Empty tree (initial commit)", "正在读取变更…":"Loading changes…",
    "当前运行的是旧版后端，尚不支持提交详情。请重启 server.py，或打开新版预览 http://127.0.0.1:8770。":"The running backend is outdated. Restart server.py or open http://127.0.0.1:8770.",
    "服务未返回有效的 JSON 数据（HTTP {status}），请确认已启动新版 server.py。":"The server did not return valid JSON (HTTP {status}). Ensure the updated server.py is running.", "请求失败 ({status})":"Request failed ({status})",
    "已开启源仓库读写，可创建或撤回本地标签":"Write access enabled. Local tags can now be created or removed.", "请先在右上角开启源仓库读写":"Enable repository write access at the top right first.",
    "正在创建标签…":"Creating tag…", "已创建本地标签：":"Local tag created: ", "已打标签：":"Tag created: ", "创建失败：":"Creation failed: ", "创建标签失败：":"Could not create tag: ",
    "已撤回 {count} 个本软件标签":"Removed {count} app-created tags", "；跳过 {count} 个已被修改的标签：":"; skipped {count} modified tags: ", "撤回标签失败：":"Could not undo tags: ",
    "已导出":"Exported", "独立 Git 仓库":"Independent Git repository", "纯文件快照":"File snapshot", "打开文件夹":"Open folder", "正在检查此版本的导出范围…":"Checking export contents…",
    "{count} 个文件":"{count} files", " · {count} 个子模块":" · {count} submodules", "无法检查导出范围：":"Could not inspect export contents: ", "重试检查":"Retry check", "请填写目标文件夹":"Enter a destination folder.",
    "正在导出，请稍候…":"Exporting, please wait…", "导出完成：":"Export complete: ", "导出失败：":"Export failed: ", "正在读取差异…":"Loading diff…", "二进制":"Binary",
    "全部差异 · {count} 个文件":"Full diff · {count} files", "查看全部":"View all", "此提交相对此基准没有文件变更。":"This commit has no file changes against this base.",
    "差异较大，仅显示前 200,000 个字符。可点击单个文件查看。":"Large diff: only the first 200,000 characters are shown. Select a file to view its diff.", "代码差异":"Code diff", "没有文本差异":"No textual changes", "无法读取差异：":"Could not load diff: ", "重新读取":"Retry",
    "未命名分支":"Unnamed branch", "这里还没有提交":"No commits yet", "为仓库创建第一次提交后，重新打开即可查看。":"Create the first commit, then reopen this repository.", "加载失败：":"Could not load: ", "仓库尚未打开":"No repository open", "无结果":"No results",
    "无法打开文件夹：":"Could not open folder: ", "已复制完整提交哈希":"Full commit hash copied", "复制失败，请从按钮提示中获取完整哈希":"Copy failed. The full hash is available in the button tooltip.",
    "复制独立的 Git 历史并检出此提交，不依赖源仓库的对象文件。":"Copy independent Git history and check out this commit, without relying on source repository objects.", "已切回源仓库只读":"Repository switched back to read-only", "当前 HEAD 没有可显示的提交":"No commit is available for the current HEAD.",
    "包含 {count} 个子模块：仅创建空目录，不下载子模块内容。":"Contains {count} submodules: only empty folders are created; submodule contents are not downloaded.",
    "此版本包含 Git LFS 规则：保留已提交的指针文件，不下载 LFS 大文件。":"This version has Git LFS rules: committed pointer files are preserved; LFS objects are not downloaded.",
    "此版本包含符号链接：Windows 不允许创建链接时，会保留链接目标文本。":"This version contains symbolic links. If Windows disallows link creation, the link target is saved as text.",
    "提交必须是有效的 Git 哈希":"The commit must be a valid Git hash.", "父提交不存在":"The parent commit does not exist.", "文件不在本次变更中":"The file is not part of this change.", "仓库路径无效":"Invalid repository path.", "读写模式无效":"Invalid access mode.",
    "源仓库当前为只读，请先在右上角开启读写模式":"The source repository is read-only. Enable write access at the top right first.", "请填写标签名称":"Enter a tag name.", "请输入标签短名称，例如 v1.0 或 review/important":"Enter a short tag name, such as v1.0 or review/important.", "请选择有效的提交哈希":"Select a valid commit hash.",
    "请输入目标文件夹的绝对路径":"Enter an absolute destination path.", "目标不能是符号链接或目录联接":"The destination cannot be a symbolic link or directory junction.", "请使用源仓库之外的目标文件夹":"Choose a destination outside the source repository.", "目标文件夹的上级目录不存在，请先创建上级目录":"The parent folder does not exist. Create it first.", "目标文件夹必须不存在或为空，不会覆盖已有文件":"The destination must be empty or not exist. Existing files will not be overwritten.",
    "提交包含不能安全导出的文件路径":"This commit contains a path that cannot be safely exported.", "提交文件路径超出目标目录":"A committed file path escapes the destination.", "Git 文件流格式错误":"Invalid Git file stream.", "读取 Git 文件失败":"Could not read Git files.", "导出选项无效":"Invalid export options.", "仅带 Git 仓库模式支持创建分支":"Creating a branch requires including .git.", "目录无效":"Invalid folder.", "只能打开本次服务成功导出的文件夹":"Only folders successfully exported by this running server can be opened.", "仅允许本地页面发起修改操作":"Only local pages may request changes.", "请使用 JSON 请求":"A JSON request is required.", "请求大小无效":"Invalid request size.", "请求格式无效":"Invalid request format.", "接口不存在":"Endpoint not found.", "git 命令失败":"Git command failed.",
    "文件夹不存在: ":"Folder not found: ", "提交包含 Windows 不支持的文件路径：":"The commit contains a path unsupported by Windows: ", "无法读取提交文件：":"Could not read committed file: ", "符号链接指向导出目录之外：":"A symbolic link points outside the export folder: ", "读取文件内容中断：":"File content read interrupted: "
  };
  let language = "zh-CN";
  try {if (localStorage.getItem("git-tree-viz.language") === "en") language = "en";} catch {}
  function t(key, values = {}) {
    const text = language === "en" ? en[key] ?? key : key;
    return text.replace(/\{(\w+)\}/g, (all, name) => values[name] === undefined ? all : String(values[name]));
  }
  function message(text) {
    if (language !== "en") return text;
    if (en[text]) return en[text];
    const submodule = /^包含 (\d+) 个子模块：仅创建空目录，不下载子模块内容。$/.exec(text);
    if (submodule) return t("包含 {count} 个子模块：仅创建空目录，不下载子模块内容。", {count:submodule[1]});
    for (const prefix of ["文件夹不存在: ","提交包含 Windows 不支持的文件路径：","无法读取提交文件：","符号链接指向导出目录之外：","读取文件内容中断："]) {
      if (text.startsWith(prefix)) return en[prefix] + text.slice(prefix.length);
    }
    return text;
  }
  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(node => {node.textContent = t(node.dataset.i18n);});
    for (const attribute of ["placeholder","title","aria-label"]) {
      root.querySelectorAll(`[data-i18n-${attribute}]`).forEach(node => {node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)));});
    }
    document.documentElement.lang = language;
    document.title = t("Git Tree · 提交历史");
  }
  return {t,message,apply,get locale(){return language;},setLocale(value){
    language = value === "en" ? "en" : "zh-CN";
    try {localStorage.setItem("git-tree-viz.language", language);} catch {}
  }};
})();
