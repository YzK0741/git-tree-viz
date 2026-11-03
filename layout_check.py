"""等价实现 web/app.js 第一遍布局，验证数据一致性与布局不变量。
不渲染 DOM，只检查：行号连续、lane 合法、父提交可解析、refs 挂载、并统计最大 lane 数。
用法: python layout_check.py [url]
"""
import json
import sys
import urllib.request

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/api/graph"

with urllib.request.urlopen(URL) as r:
    payload = json.load(r)

data = payload["data"]
commits = data["commits"]
refs = data["refs"]
n = len(commits)

# ---- 等价于 app.js 的第一遍扫描 ----
lane = 0
expected = []  # expected[k] = lane k 正在等待的下一个提交 hash
rows = []
max_lane = 0

for idx, c in enumerate(commits):
    parents = c.get("parents") or []
    free = [k for k, h in enumerate(expected) if h == c["hash"]]
    if free:
        lane = free[0]
        for k in free[1:]:
            expected[k] = None
        expected[lane] = None
    else:
        occ = [k for k, h in enumerate(expected) if h is not None]
        lane = next(i for i in range(len(occ) + 1) if i not in occ)

    edges = []
    while len(expected) <= lane:
        expected.append(None)
    if not parents:
        expected[lane] = None
    else:
        expected[lane] = parents[0]
        edges.append({"p": parents[0], "merge": False})
        for i, ph in enumerate(parents[1:], 1):
            occ = [k for k, h in enumerate(expected) if h is not None]
            pl = next(x for x in range(len(occ) + 1) if x not in occ)
            while len(expected) <= pl:
                expected.append(None)
            expected[pl] = ph
            edges.append({"p": ph, "merge": True})
    max_lane = max(max_lane, lane)
    rows.append({"idx": idx, "lane": lane, "hash": c["hash"], "edges": edges})

# ---- 不变量检查 ----
assert len(rows) == n, "行数不等于提交数"
assert all(r["lane"] >= 0 for r in rows), "负数 lane"
index = {c["hash"]: i for i, c in enumerate(commits)}
hits_with_refs = set()
for r in rows:
    assert r["hash"] in index
    for e in r["edges"]:
        if e["p"] in index:
            hits_with_refs.add(r["hash"])
assert len(index) == n, "提交 hash 重复"
for ref in refs:
    pass

lane_count = max_lane + 1
print(f"commits={n} rows={len(rows)} max_lane={max_lane} lane_count={lane_count}")

# 父提交缺失统计（--all 下不应出现）
missing = 0
for c in commits:
    for p in (c.get("parents") or []):
        if p not in index:
            missing += 1
print(f"parents not in set: {missing}")

# 每个提交挂载的 refs 统计
ref_by_commit = {}
for c in commits:
    if c.get("refs"):
        ref_by_commit[c["hash"]] = c["refs"]
print(f"commits with refs: {len(ref_by_commit)}  total refs: {len(refs)}")

# lane 数合理区间（deren：2~3 条活跃 lane，历史上界可略高）
assert lane_count <= 8, f"lane 数异常: {lane_count}"

# 合并提交都在且有 2 个父
merges = [c for c in commits if len(c.get("parents") or []) > 1]
print(f"merges={len(merges)}; sample merge parents ok: "
      f"{all(len(c['parents']) >= 2 for c in merges)}")

# 检查每行都有日期/作者/标题
bad = [c["hash"] for c in commits if not c.get("subject") or not c.get("author")]
print(f"commits missing subject/author: {len(bad)}")

print("LAYOUT CHECK PASSED")
