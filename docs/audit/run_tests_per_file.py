#!/usr/bin/env python3
"""Run every atlasz-tests/*.test.mjs as its own `node --test` process (3 in parallel) and record pass/fail per FILE. Writes docs/audit/test_results.json.
Needed because the single-process TAP stream does not say which file a subtest came from."""
import os, subprocess, json, re, time, sys
from concurrent.futures import ThreadPoolExecutor
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
files = sorted(f for f in os.listdir(os.path.join(root, "atlasz-tests")) if f.endswith(".test.mjs"))
def run(f):
    t = time.time()
    try:
        r = subprocess.run(["node", "--test", "atlasz-tests/" + f], cwd=root, capture_output=True, text=True, timeout=240); out = r.stdout
        g = lambda k: int((re.findall(r"^# %s (\d+)" % k, out, re.M) or ["0"])[-1])
        return f, dict(tests=g("tests"), pass_=g("pass"), fail=g("fail"), skipped=g("skipped"), cancelled=g("cancelled"), exit=r.returncode, seconds=round(time.time() - t, 1))
    except subprocess.TimeoutExpired: return f, dict(tests=0, pass_=0, fail=1, skipped=0, cancelled=0, exit=-1, seconds=240, note="TIMEOUT")
with ThreadPoolExecutor(3) as ex: res = dict(ex.map(run, files))
json.dump(res, open(os.path.join(root, "docs/audit/test_results.json"), "w"), indent=1)
print("files", len(res), "tests", sum(v["tests"] for v in res.values()), "pass", sum(v["pass_"] for v in res.values()), "fail", sum(v["fail"] for v in res.values()), "skipped", sum(v["skipped"] for v in res.values()))
