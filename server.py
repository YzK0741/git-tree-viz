#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
git-tree-viz —— Git 提交树可视化 · 本地解析后端

零第三方依赖：只用 Python 标准库 + 系统安装的 git。

用法:
    python server.py --repo C:/path/to/repo --port 8765
然后浏览器打开 http://127.0.0.1:8765

API:
    GET /api/graph?repo=<path>   不传 repo 时使用 --repo 指定的默认仓库
    GET /                         前端页面
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(HERE, "web")

SEP = "\x1f"  # unit separator
RS = "\x1e"   # record separator
EXPORT_LOCK = threading.Lock()
EXPORTED_PATHS: set[str] = set()
TAG_LOCK = threading.RLock()
WRITE_ACCESS: dict[str, str] = {}
OWNED_TAG_PREFIX = "refs/git-tree-viz/tags/"


def _git(repo: str, *args: str, input_text: str | None = None) -> str:
    r = subprocess.run(
        ["git", "-C", repo, *args],
        capture_output=True,
        input=input_text.encode("utf-8") if input_text is not None else None,
    )
    r.stdout = r.stdout.decode("utf-8", "replace").replace("\r\n", "\n")
    r.stderr = r.stderr.decode("utf-8", "replace").replace("\r\n", "\n")
    if r.returncode != 0:
        lines = (r.stderr or "").strip().splitlines()
        raise RuntimeError(lines[-1] if lines else "git 命令失败")
    return r.stdout


def _parse_commits(repo: str) -> list[dict]:
    fmt = SEP.join(["%H", "%P", "%an", "%ae", "%aI", "%s"]) + SEP + "%b" + "%x1e"
    try:
        out = _git(
            repo, "log", "--exclude=refs/codex/*", "--exclude=refs/git-tree-viz/*", "--all",
            "--date-order", "--pretty=format:" + fmt,
        )
    except RuntimeError:
        # 旧版 git 不支持 --exclude，退回普通 --all
        out = _git(repo, "log", "--all", "--date-order", "--pretty=format:" + fmt)
    commits = []
    for rec in out.split(RS):
        rec = rec.strip("\n")
        if not rec:
            continue
        parts = rec.split(SEP)
        if len(parts) < 7:
            continue
        commits.append({
            "hash": parts[0],
            "parents": [p for p in parts[1].split() if p],
            "author": parts[2],
            "email": parts[3],
            "date": parts[4],
            "subject": parts[5],
            "body": parts[6].strip(),
        })
    return commits


def _parse_refs(repo: str) -> tuple[list[dict], dict[str, list[dict]]]:
    """返回 (refs 列表, commit hash -> refs 映射)。

    注意：for-each-ref 的 format 不支持 %x1f 转义，用 | 分隔（refname 不含 |）。
    annotated tag 的 objectname 是 tag 对象，%( *objectname ) 才是 peeled commit；
    lightweight tag 的 *objectname 为空，回退到 objectname。
    """
    out = _git(
        repo, "for-each-ref",
        "--format=%(objectname)|%(*objectname)|%(refname)|%(objecttype)|%(creatordate:iso-strict)",
    )
    refs: list[dict] = []
    ref_map: dict[str, list[dict]] = {}
    for line in out.splitlines():
        parts = line.split("|")
        if len(parts) < 5:
            continue
        obj, peeled, name, otype, cdate = parts[0], parts[1], parts[2], parts[3], parts[4]
        if name.startswith("refs/codex/"):
            continue
        if name.startswith("refs/heads/"):
            kind, short = "branch", name[len("refs/heads/"):]
        elif name.startswith("refs/tags/"):
            kind, short = "tag", name[len("refs/tags/"):]
        elif name.startswith("refs/remotes/"):
            kind, short = "remote", name[len("refs/remotes/"):]
            if short.endswith("/HEAD"):
                continue
        else:
            continue
        target = peeled or obj
        info = {"name": short, "kind": kind, "type": otype, "date": cdate}
        refs.append(info)
        ref_map.setdefault(target, []).append({"name": short, "kind": kind})
    return refs, ref_map


def load_graph(repo: str) -> dict:
    repo = os.path.abspath(repo)
    if not os.path.isdir(repo):
        raise ValueError("文件夹不存在: " + repo)
    if not os.path.exists(os.path.join(repo, ".git")):
        # 允许 worktree（.git 是文件）与 git dir 场景，交给 git 自己判断
        pass

    commits = _parse_commits(repo)
    refs, ref_map = _parse_refs(repo)
    for c in commits:
        c["refs"] = ref_map.get(c["hash"], [])

    # git log 的 --date-order 保证新→旧；再反向算最早日期
    dates = [c["date"] for c in commits if c["date"]]
    try:
        head = _git(repo, "rev-parse", "--abbrev-ref", "HEAD").strip()
    except RuntimeError:
        head = ""

    merges = sum(1 for c in commits if len(c["parents"]) > 1)
    roots = sum(1 for c in commits if not c["parents"])
    branch_count = sum(1 for r in refs if r["kind"] == "branch")
    tag_count = sum(1 for r in refs if r["kind"] == "tag")

    stats = {
        "commits": len(commits),
        "branches": branch_count,
        "tags": tag_count,
        "merges": merges,
        "roots": roots,
        "first_date": min(dates) if dates else "",
        "last_date": max(dates) if dates else "",
    }
    try:
        head_hash = _git(repo, "rev-parse", "HEAD").strip()
    except RuntimeError:
        head_hash = ""
    main_ref = next((r for name in ("main", "master", head) for r in refs
                     if r["kind"] == "branch" and r["name"] == name), None)
    main_hash = next((c["hash"] for c in commits if main_ref and any(
        r["kind"] == "branch" and r["name"] == main_ref["name"] for r in c["refs"])), head_hash)
    return {"repo": repo, "head": head, "head_hash": head_hash,
            "main_hash": main_hash, "main_branch": main_ref["name"] if main_ref else head,
            "stats": stats, "commits": commits, "refs": refs, "owned_tags": load_owned_tags(repo)}


def load_commit_metrics(repo: str) -> dict:
    """Batch all commit diff sizes; merges compare against their first parent.

    NUL-terminated paths keep spaces, tabs and Unicode filenames unambiguous.
    Binary changes count as files, but contribute no textual line count.
    """
    out = _git(repo, "log", "--exclude=refs/codex/*", "--exclude=refs/git-tree-viz/*", "--all", "--root",
               "--diff-merges=first-parent", "--no-renames", "--no-ext-diff", "--no-textconv",
               "--numstat", "-z", "--format=%x1e%H%x00")
    metrics = {}
    for record in out.split(RS):
        if not record:
            continue
        commit, _, changes = record.partition("\0")
        commit = commit.strip()
        if not re.fullmatch(r"[0-9a-fA-F]{40,64}", commit):
            continue
        added = deleted = files = 0
        for entry in changes.split("\0"):
            entry = entry.lstrip("\n")
            if not entry:
                continue
            parts = entry.split("\t", 2)
            if len(parts) != 3:
                continue
            a, d, _ = parts
            files += 1
            added += int(a) if a != "-" else 0
            deleted += int(d) if d != "-" else 0
        metrics[commit] = {"additions": added, "deletions": deleted,
                           "files": files, "edits": added + deleted}
    return metrics


def load_commit_detail(repo: str, commit: str, parent: int = 0, path: str = "") -> dict:
    if not re.fullmatch(r"[0-9a-fA-F]{7,64}", commit):
        raise ValueError("提交必须是有效的 Git 哈希")
    full = _git(repo, "rev-parse", "--verify", commit + "^{commit}").strip()
    parents = _git(repo, "show", "-s", "--format=%P", full).strip().split()
    if parent < 0 or parent >= max(1, len(parents)):
        raise ValueError("父提交不存在")
    base = parents[parent] if parents else ""
    # --root also compares a root commit against the empty tree without assuming SHA-1.
    diff = ["diff", base, full] if base else ["diff-tree", "--root", "--no-commit-id", "-r", full]
    common = ["--no-ext-diff", "--no-textconv", "--no-renames"]
    records = _git(repo, *diff, *common, "--numstat", "-z").split("\0")
    status_records = _git(repo, *diff, *common, "--name-status", "-z").split("\0")
    statuses = dict(zip(status_records[1::2], status_records[0::2]))
    files = []
    for record in records:
        if not record:
            continue
        added, deleted, filename = record.split("\t", 2)
        files.append({"path": filename, "status": statuses.get(filename, "M"),
                      "additions": None if added == "-" else int(added),
                      "deletions": None if deleted == "-" else int(deleted)})
    if path and path not in {f["path"] for f in files}:
        raise ValueError("文件不在本次变更中")
    patch = _git(repo, "--literal-pathspecs", *diff, *common, "--patch", "--no-color",
                 "--", *([path] if path else []))
    limit = 200_000
    return {"hash": full, "parents": parents, "base": base, "files": files,
            "patch": patch[:limit], "truncated": len(patch) > limit, "path": path}


def _tag_repo_key(repo: str) -> str:
    if not isinstance(repo, str) or not repo:
        raise ValueError("仓库路径无效")
    common = _git(repo, "rev-parse", "--git-common-dir").strip()
    return os.path.normcase(os.path.realpath(os.path.join(os.path.abspath(repo), common)))


def set_write_access(repo: str, enabled: bool, token: str = "") -> dict:
    if not isinstance(enabled, bool):
        raise ValueError("读写模式无效")
    key = _tag_repo_key(repo)
    with TAG_LOCK:
        if enabled:
            grant = secrets.token_urlsafe(32)
            WRITE_ACCESS[grant] = key
            return {"enabled": True, "token": grant}
        if isinstance(token, str) and WRITE_ACCESS.get(token) == key:
            WRITE_ACCESS.pop(token)
        return {"enabled": False}


def _require_write(repo: str, token: str) -> None:
    if not isinstance(token, str) or WRITE_ACCESS.get(token) != _tag_repo_key(repo):
        raise ValueError("源仓库当前为只读，请先在右上角开启读写模式")


def load_owned_tags(repo: str) -> list[dict]:
    actual = {}
    for line in _git(repo, "for-each-ref", "--format=%(refname)%00%(objectname)", "refs/tags/").splitlines():
        ref, obj = line.split("\0", 1)
        actual[ref] = obj
    result = []
    for line in _git(repo, "for-each-ref", "--format=%(refname)%00%(objectname)", OWNED_TAG_PREFIX).splitlines():
        ref, obj = line.split("\0", 1)
        name = ref[len(OWNED_TAG_PREFIX):]
        target = actual.get("refs/tags/" + name)
        result.append({"name": name, "hash": obj,
                       "status": "missing" if target is None else "unchanged" if target == obj else "changed"})
    return result


def _tag_state(repo: str) -> dict:
    refs, mapping = _parse_refs(repo)
    return {"refs": refs, "commit_refs": mapping, "owned_tags": load_owned_tags(repo)}


def _tag_transaction(repo: str, commands: list[str]) -> None:
    if commands:
        _git(repo, "update-ref", "--no-deref", "--stdin",
             input_text="start\n" + "\n".join(commands) + "\nprepare\ncommit\n")


def create_tag(repo: str, commit: str, name: str, token: str = "") -> dict:
    if not isinstance(name, str) or not name.strip():
        raise ValueError("请填写标签名称")
    name = name.strip()
    if name.startswith(("-", "refs/")) or name == "HEAD":
        raise ValueError("请输入标签短名称，例如 v1.0 或 review/important")
    with TAG_LOCK:
        _require_write(repo, token)
        source, full = _export_source(repo, commit)
        ref, marker = "refs/tags/" + name, OWNED_TAG_PREFIX + name
        _git(source, "check-ref-format", ref)
        # Tag and ownership marker are created together; neither overwrites an existing ref.
        _tag_transaction(source, [f"create {json.dumps(ref, ensure_ascii=False)} {full}",
                                  f"create {json.dumps(marker, ensure_ascii=False)} {full}"])
        return {"name": name, "hash": full, **_tag_state(source)}


def undo_all_tags(repo: str, token: str = "") -> dict:
    with TAG_LOCK:
        _require_write(repo, token)
        owned = load_owned_tags(repo)
        commands, removed, skipped, missing = [], [], [], []
        for tag in owned:
            name, obj = tag["name"], tag["hash"]
            if tag["status"] == "changed":
                skipped.append(name)
                continue
            if tag["status"] == "unchanged":
                commands.append(f"delete {json.dumps('refs/tags/' + name, ensure_ascii=False)} {obj}")
                removed.append(name)
            else:
                missing.append(name)
            commands.append(f"delete {json.dumps(OWNED_TAG_PREFIX + name, ensure_ascii=False)} {obj}")
        # Old-value checks make the whole rollback fail safely if any tag changes mid-operation.
        _tag_transaction(repo, commands)
        return {"removed": removed, "skipped": skipped, "missing": missing, **_tag_state(repo)}


def _export_source(repo: str, commit: str) -> tuple[str, str]:
    if not isinstance(repo, str) or not isinstance(commit, str) or not re.fullmatch(r"[0-9a-fA-F]{7,64}", commit):
        raise ValueError("请选择有效的提交哈希")
    source = os.path.realpath(_git(repo, "rev-parse", "--show-toplevel").strip())
    full = _git(source, "rev-parse", "--verify", commit + "^{commit}").strip()
    return source, full


def _export_tree(repo: str, commit: str) -> list[tuple[str, str, str]]:
    entries = []
    for record in _git(repo, "ls-tree", "-r", "-z", "--full-tree", commit).split("\0"):
        if record:
            meta, path = record.split("\t", 1)
            mode, _, obj = meta.split()
            entries.append((mode, obj, path))
    return entries


def load_export_info(repo: str, commit: str) -> dict:
    source, full = _export_source(repo, commit)
    entries = _export_tree(source, full)
    submodules = [path for mode, _, path in entries if mode == "160000"]
    symlinks = sum(mode == "120000" for mode, _, _ in entries)
    lfs = any("filter=lfs" in _git(source, "show", full + ":" + path)
              for mode, _, path in entries if mode in ("100644", "100755")
              and path.rsplit("/", 1)[-1] == ".gitattributes")
    warnings = []
    if submodules:
        warnings.append(f"包含 {len(submodules)} 个子模块：仅创建空目录，不下载子模块内容。")
    if lfs:
        warnings.append("此版本包含 Git LFS 规则：保留已提交的指针文件，不下载 LFS 大文件。")
    if symlinks and os.name == "nt":
        warnings.append("此版本包含符号链接：Windows 不允许创建链接时，会保留链接目标文本。")
    return {"repo": source, "hash": full, "files": sum(mode != "160000" for mode, _, _ in entries),
            "submodules": submodules, "lfs": lfs, "symlinks": symlinks, "warnings": warnings}


def _export_destination(source: str, destination: str) -> str:
    if not isinstance(destination, str) or not destination.strip() or not os.path.isabs(destination):
        raise ValueError("请输入目标文件夹的绝对路径")
    destination = os.path.abspath(destination)
    if os.path.islink(destination) or getattr(os.path, "isjunction", lambda p: False)(destination):
        raise ValueError("目标不能是符号链接或目录联接")
    resolved = os.path.realpath(destination)
    try:
        in_source = os.path.commonpath([os.path.normcase(source), os.path.normcase(resolved)]) == os.path.normcase(source)
    except ValueError:
        in_source = False
    if in_source:
        raise ValueError("请使用源仓库之外的目标文件夹")
    if not os.path.isdir(os.path.dirname(resolved)):
        raise ValueError("目标文件夹的上级目录不存在，请先创建上级目录")
    if os.path.lexists(resolved) and (not os.path.isdir(resolved) or os.listdir(resolved)):
        raise ValueError("目标文件夹必须不存在或为空，不会覆盖已有文件")
    return resolved


def _snapshot_files(source: str, commit: str, target: str) -> None:
    entries = _export_tree(source, commit)
    # Write links last so a tracked symlink cannot redirect another exported file.
    entries.sort(key=lambda entry: entry[0] == "120000")
    with subprocess.Popen(["git", "-C", source, "cat-file", "--batch"],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as proc:
        try:
            for mode, obj, relative in entries:
                parts = relative.split("/")
                if any(part in ("", ".", "..") or part.lower() == ".git" for part in parts):
                    raise ValueError("提交包含不能安全导出的文件路径")
                if os.name == "nt" and ("\\" in relative or ":" in relative
                        or any(p.rstrip(" .") != p for p in parts)
                        or getattr(os.path, "isreserved", lambda p: False)(relative)):
                    raise ValueError("提交包含 Windows 不支持的文件路径：" + relative)
                path = os.path.abspath(os.path.join(target, *parts))
                if os.path.commonpath([target, path]) != target:
                    raise ValueError("提交文件路径超出目标目录")
                if mode == "160000":
                    os.makedirs(path, exist_ok=True)
                    continue
                os.makedirs(os.path.dirname(path), exist_ok=True)
                proc.stdin.write((obj + "\n").encode("ascii"))
                proc.stdin.flush()
                header = proc.stdout.readline().split()
                if len(header) != 3 or header[1] != b"blob":
                    raise RuntimeError("无法读取提交文件：" + relative)
                size = int(header[2])
                if mode == "120000":
                    contents = proc.stdout.read(size)
                    link = os.fsdecode(contents)
                    # Links must stay inside the exported tree.
                    resolved_link = os.path.abspath(os.path.join(os.path.dirname(path), link))
                    if os.path.isabs(link) or os.path.commonpath([target, resolved_link]) != target:
                        raise ValueError("符号链接指向导出目录之外：" + relative)
                    try:
                        os.symlink(link, path)
                    except OSError:
                        if os.name != "nt":
                            raise
                        with open(path, "wb") as output:
                            output.write(contents)
                else:
                    with open(path, "wb") as output:
                        while size:
                            chunk = proc.stdout.read(min(size, 1024 * 1024))
                            if not chunk:
                                raise RuntimeError("读取文件内容中断：" + relative)
                            output.write(chunk)
                            size -= len(chunk)
                    if mode == "100755" and os.name != "nt":
                        os.chmod(path, 0o755)
                if proc.stdout.read(1) != b"\n":
                    raise RuntimeError("Git 文件流格式错误")
            proc.stdin.close()
            if proc.wait() != 0:
                raise RuntimeError("读取 Git 文件失败")
        except BaseException:
            proc.kill()
            proc.wait()
            raise


def export_commit(repo: str, commit: str, destination: str, include_git: bool = False, branch: str = "") -> dict:
    if not isinstance(include_git, bool) or not isinstance(branch, str):
        raise ValueError("导出选项无效")
    info = load_export_info(repo, commit)
    source, full = info["repo"], info["hash"]
    destination = _export_destination(source, destination)
    branch = branch.strip()
    if branch:
        if not include_git:
            raise ValueError("仅带 Git 仓库模式支持创建分支")
        _git(source, "check-ref-format", "--branch", branch)
    parent = os.path.dirname(destination)
    stage = os.path.abspath(tempfile.mkdtemp(prefix=".git-tree-export-", dir=parent))
    try:
        if include_git:
            _git(source, "clone", "--no-checkout", "--no-hardlinks", "--dissociate", "--", source, stage)
            # Do not run checkout hooks or download LFS objects in the exported repository.
            options = ["-c", "core.hooksPath=" + os.path.join(stage, ".git", "export-no-hooks"),
                       "-c", "filter.lfs.required=false", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.process="]
            _git(stage, *options, "checkout", *(["-b", branch] if branch else ["--detach"]), full)
        else:
            _snapshot_files(source, full, stage)
        with EXPORT_LOCK:
            _export_destination(source, destination)
            # Only remove an empty directory, never overwrite or recursively remove the user's target.
            if os.path.isdir(destination):
                os.rmdir(destination)
            os.rename(stage, destination)
            EXPORTED_PATHS.add(os.path.normcase(destination))
        return {"path": destination, "hash": full, "include_git": include_git,
                "branch": branch if include_git else "", "files": info["files"], "warnings": info["warnings"]}
    finally:
        # This is exclusively our generated staging directory, beside the validated destination.
        if (os.path.dirname(stage) == parent and os.path.basename(stage).startswith(".git-tree-export-")
                and os.path.isdir(stage)):
            def writable_remove(func, path, _):
                os.chmod(path, stat.S_IWRITE)
                func(path)
            shutil.rmtree(stage, onerror=writable_remove)


def open_export_folder(path: str) -> dict:
    if not isinstance(path, str):
        raise ValueError("目录无效")
    resolved = os.path.realpath(path)
    if os.path.normcase(resolved) not in EXPORTED_PATHS or not os.path.isdir(resolved):
        raise ValueError("只能打开本次服务成功导出的文件夹")
    if os.name == "nt":
        os.startfile(resolved)
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", resolved])
    return {"path": resolved}


class Handler(BaseHTTPRequestHandler):
    server_version = "GitTreeViz/0.1"

    def log_message(self, fmt, *args):  # 简约日志
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _send(self, code: int, body: bytes, ctype: str = "text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(code, data, "application/json; charset=utf-8")

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/api/graph", "/api/commit", "/api/metrics", "/api/export-info"):
            q = parse_qs(u.query)
            repo = (q.get("repo", [None])[0] or self.server.default_repo or os.getcwd())
            try:
                if u.path == "/api/commit":
                    data = load_commit_detail(repo, q.get("hash", [""])[0],
                                              int(q.get("parent", ["0"])[0]),
                                              q.get("path", [""])[0])
                elif u.path == "/api/metrics":
                    data = load_commit_metrics(repo)
                elif u.path == "/api/export-info":
                    data = load_export_info(repo, q.get("hash", [""])[0])
                else:
                    data = load_graph(repo)
                self._json({"ok": True, "data": data})
            except Exception as e:  # noqa: BLE001
                self._json({"ok": False, "error": str(e)}, 400)
            return

        # 静态文件：只允许 web/ 下的文件
        rel = u.path.lstrip("/") or "index.html"
        web_root = os.path.normpath(WEB_DIR) + os.sep
        full = os.path.normpath(os.path.join(web_root, rel))
        if not (full + os.sep).startswith(web_root):
            self._send(403, b"forbidden")
            return
        if not os.path.isfile(full):
            self._send(404, b"not found")
            return
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
            ".json": "application/json; charset=utf-8",
        }.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self._send(200, body, ctype)

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ("/api/export", "/api/open-folder", "/api/write-access", "/api/tags/create", "/api/tags/undo-all"):
            self._json({"ok": False, "error": "接口不存在"}, 404)
            return
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        try:
            hostname = urlparse("http://" + host).hostname
            if hostname not in ("127.0.0.1", "localhost", "::1") or (origin and origin != "http://" + host):
                raise ValueError("仅允许本地页面发起修改操作")
            if self.headers.get_content_type() != "application/json":
                raise ValueError("请使用 JSON 请求")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 16384:
                raise ValueError("请求大小无效")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("请求格式无效")
            repo = body.get("repo") or self.server.default_repo
            if path == "/api/write-access":
                data = set_write_access(repo, body.get("enabled"), body.get("token", ""))
            elif path == "/api/tags/create":
                data = create_tag(repo, body.get("hash", ""), body.get("name", ""), body.get("token", ""))
            elif path == "/api/tags/undo-all":
                data = undo_all_tags(repo, body.get("token", ""))
            elif path == "/api/export":
                data = export_commit(body.get("repo") or self.server.default_repo,
                                     body.get("hash", ""), body.get("destination", ""),
                                     body.get("include_git", False), body.get("branch", ""))
            else:
                data = open_export_folder(body.get("path", ""))
            self._json({"ok": True, "data": data})
        except Exception as exc:
            self._json({"ok": False, "error": str(exc)}, 400)


def main():
    ap = argparse.ArgumentParser(description="Git 提交树可视化 · 本地后端")
    ap.add_argument("--repo", default="", help="默认仓库路径（前端不传 repo 时使用）")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    default_repo = os.path.abspath(args.repo) if args.repo else ""
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.default_repo = default_repo
    print(f"git-tree-viz 已启动: http://{args.host}:{args.port}")
    if default_repo:
        print(f"默认仓库: {default_repo}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")


if __name__ == "__main__":
    main()
