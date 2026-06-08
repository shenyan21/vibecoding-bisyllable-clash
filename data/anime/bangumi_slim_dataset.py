#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bangumi 动画 collects 排序精简数据集爬取器。

只输出字段：
  order, url, name_cn, date, score, total_votes, cover_large, tags, characters

数据来源：
  - 列表页 /anime/browser/?sort=collects&page=N：确定 order 与 subject url
  - 官方 API /v0/subjects/{id}：name_cn/date/score/total_votes/cover_large/tags
  - 条目 HTML /subject/{id}：角色中文名（角色列表里的 a.thumbTip title 通常是中文名）

安装：
  pip install requests beautifulsoup4 tqdm

示例：
  python bangumi_slim_dataset.py --pages 1 --limit 24 --delay 0.3 --out data/test_slim
  python bangumi_slim_dataset.py --pages 30 --limit 720 --delay 0.3 --out data/bangumi_slim
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

WEB_BASE = "https://bgm.tv"
API_BASE = "https://api.bgm.tv"

USER_AGENT = os.getenv(
    "BGM_USER_AGENT",
    "KhalilJalage/AnimeDatasetResearch/0.3 (https://github.com/khaliljalage; mailto:khaliljalage@gmail.com)",
)

FIELDS = [
    "order",
    "url",
    "name_cn",
    "date",
    "score",
    "total_votes",
    "cover_large",
    "tags",
    "characters",
]


def abs_url(u: str | None, base: str = WEB_BASE) -> str | None:
    if not u:
        return None
    u = u.strip()
    if u.startswith("//"):
        return "https:" + u
    return urljoin(base, u)


def only_int(s: str | None) -> int | None:
    if not s:
        return None
    m = re.search(r"\d+", s.replace(",", ""))
    return int(m.group(0)) if m else None


def clean_text(node) -> str:
    return node.get_text(" ", strip=True) if node else ""


class Client:
    def __init__(self, out: Path, delay: float, timeout: float, no_cache: bool = False):
        self.delay = delay
        self.timeout = timeout
        self.no_cache = no_cache
        self.cache_dir = out / "cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.s = requests.Session()
        self.s.headers.update({
            "User-Agent": USER_AGENT,
            "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
        })
        token = os.getenv("BANGUMI_TOKEN")
        if token:
            self.s.headers.update({"Authorization": f"Bearer {token}"})

    def cache_path(self, url: str, suffix: str) -> Path:
        safe = re.sub(r"[^a-zA-Z0-9_.-]+", "_", url).strip("_")[:180]
        return self.cache_dir / f"{safe}.{suffix}"

    def sleep(self):
        if self.delay > 0:
            time.sleep(self.delay + random.random() * min(0.2, self.delay))

    def get(self, url: str, *, accept_json: bool = False) -> requests.Response:
        headers = {"Accept": "application/json"} if accept_json else {}
        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                r = self.s.get(url, timeout=(self.timeout, self.timeout), headers=headers)
                if r.status_code in (429, 500, 502, 503, 504):
                    wait = min(30, 2 ** attempt) + random.random()
                    print(f"[retry] HTTP {r.status_code}, wait {wait:.1f}s: {url}", file=sys.stderr)
                    time.sleep(wait)
                    continue
                return r
            except requests.RequestException as e:
                last_error = e
                wait = min(30, 2 ** attempt) + random.random()
                print(f"[retry] {type(e).__name__}, wait {wait:.1f}s: {url}", file=sys.stderr)
                time.sleep(wait)
        raise RuntimeError(f"GET failed after retries: {url}; last_error={last_error}")

    def text(self, url: str) -> str:
        p = self.cache_path(url, "html")
        if p.exists() and not self.no_cache:
            return p.read_text("utf-8", errors="ignore")
        r = self.get(url)
        r.raise_for_status()
        r.encoding = r.apparent_encoding or "utf-8"
        txt = r.text
        p.write_text(txt, "utf-8")
        self.sleep()
        return txt

    def json(self, url: str) -> Any | None:
        p = self.cache_path(url, "json")
        if p.exists() and not self.no_cache:
            return json.loads(p.read_text("utf-8"))
        r = self.get(url, accept_json=True)
        if r.status_code in (401, 403, 404):
            print(f"[skip api] HTTP {r.status_code}: {url}", file=sys.stderr)
            return None
        r.raise_for_status()
        data = r.json()
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
        self.sleep()
        return data


def browser_url(page: int) -> str:
    return f"{WEB_BASE}/anime/browser/?sort=collects&page={page}"


def parse_list_subject_ids(html: str) -> list[int]:
    soup = BeautifulSoup(html, "html.parser")
    ids: list[int] = []
    seen: set[int] = set()
    for li in soup.select("#browserItemList > li, ul.browserFull > li, li.item"):
        a = li.select_one('a[href^="/subject/"]') or li.select_one('a[href*="/subject/"]')
        if not a:
            continue
        sid = only_int(a.get("href"))
        if sid and sid not in seen:
            seen.add(sid)
            ids.append(sid)
    return ids


def tag_names_from_subject(subject: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for t in subject.get("tags") or []:
        if isinstance(t, dict):
            name = str(t.get("name") or "").strip()
        else:
            name = str(t).strip()
        if name and name not in out:
            out.append(name)
    return out


def parse_character_cn_from_subject_html(html: str) -> list[dict[str, Any]]:
    """从条目页角色介绍区域取中文角色名。

    Bangumi 条目页角色列表里，缩略图链接通常形如：
      <a href="/character/87968" title="后藤一里" class="thumbTip">...
    其中 title 是中文名；旁边 a.title 常是日文原名。
    """
    soup = BeautifulSoup(html, "html.parser")
    chars: list[dict[str, Any]] = []
    seen: set[str] = set()
    for li in soup.select("ul.crtList > li.item, #browserItemList.crtList > li.item"):
        thumb = li.select_one('a.thumbTip[href^="/character/"]')
        title_a = li.select_one('a.title[href^="/character/"]')
        link = thumb or title_a
        if not link:
            continue
        cid = only_int(link.get("href"))
        # 优先 thumbTip 的 title，这是示例 HTML 中的中文名；没有就回退到显示文本。
        name_cn = (thumb.get("title") if thumb else None) or clean_text(title_a) or clean_text(link)
        name_cn = name_cn.strip()
        if not name_cn:
            continue
        key = f"{cid or ''}:{name_cn}"
        if key in seen:
            continue
        seen.add(key)
        chars.append({
            "id": cid,
            "name": name_cn,
            "url": abs_url(link.get("href")),
        })
    return chars


def make_record(order: int, sid: int, subject: dict[str, Any], characters: list[dict[str, Any]]) -> dict[str, Any]:
    rating = subject.get("rating") or {}
    images = subject.get("images") or {}
    name_cn = (subject.get("name_cn") or "").strip() or (subject.get("name") or "").strip()
    return {
        "order": order,
        "url": f"{WEB_BASE}/subject/{sid}",
        "name_cn": name_cn,
        "date": subject.get("date") or None,
        "score": rating.get("score"),
        "total_votes": rating.get("total"),
        "cover_large": images.get("large") or images.get("common") or images.get("medium"),
        "tags": tag_names_from_subject(subject),
        "characters": characters,
    }


def csv_row(record: dict[str, Any]) -> dict[str, Any]:
    row = dict(record)
    row["tags"] = ";".join(record.get("tags") or [])
    row["characters"] = ";".join([c.get("name", "") for c in record.get("characters") or [] if c.get("name")])
    return row


def run_check(client: Client):
    print(f"User-Agent: {USER_AGENT}")
    tests = [
        (browser_url(1), False),
        (f"{API_BASE}/v0/subjects/328609", True),
        (f"{WEB_BASE}/subject/328609", False),
    ]
    for url, is_json in tests:
        t0 = time.time()
        try:
            r = client.get(url, accept_json=is_json)
            print(f"OK {r.status_code:3} {time.time() - t0:5.2f}s {url}")
        except Exception as e:
            print(f"FAIL {type(e).__name__}: {url}\n  {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=30, help="列表页页数，30 页约 720 条")
    ap.add_argument("--limit", type=int, default=720, help="最多抓多少条")
    ap.add_argument("--delay", type=float, default=0.3, help="每个实际网络请求后的等待秒数")
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("--out", default="data/bangumi_slim")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    client = Client(out, args.delay, args.timeout, args.no_cache)

    if args.check:
        run_check(client)
        return

    subject_ids: list[int] = []
    seen: set[int] = set()
    for page in tqdm(range(1, args.pages + 1), desc="list pages"):
        url = browser_url(page)
        print(f"\n[fetch list] {url}", file=sys.stderr)
        html = client.text(url)
        ids = parse_list_subject_ids(html)
        print(f"[list page {page}] found {len(ids)} subjects", file=sys.stderr)
        for sid in ids:
            if sid not in seen:
                seen.add(sid)
                subject_ids.append(sid)
                if len(subject_ids) >= args.limit:
                    break
        if len(subject_ids) >= args.limit:
            break

    ids_path = out / "subject_ids_collects_order.json"
    ids_path.write_text(json.dumps(subject_ids, ensure_ascii=False, indent=2), "utf-8")
    print(f"\nCollected {len(subject_ids)} subject ids -> {ids_path}")

    jsonl_path = out / "bangumi_slim_dataset.jsonl"
    json_path = out / "bangumi_slim_dataset.json"
    csv_path = out / "bangumi_slim_dataset.csv"

    records: list[dict[str, Any]] = []
    with jsonl_path.open("w", encoding="utf-8") as fw:
        for order, sid in enumerate(tqdm(subject_ids, desc="details"), start=1):
            subject = client.json(f"{API_BASE}/v0/subjects/{sid}") or {}
            try:
                html = client.text(f"{WEB_BASE}/subject/{sid}")
                characters = parse_character_cn_from_subject_html(html)
            except Exception as e:
                print(f"[character html failed] subject {sid}: {e}", file=sys.stderr)
                characters = []
            record = make_record(order, sid, subject, characters)
            records.append(record)
            fw.write(json.dumps(record, ensure_ascii=False) + "\n")

    json_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), "utf-8")
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fc:
        w = csv.DictWriter(fc, fieldnames=FIELDS)
        w.writeheader()
        for rec in records:
            w.writerow(csv_row(rec))

    print("Wrote:")
    print(f"  {jsonl_path}")
    print(f"  {json_path}")
    print(f"  {csv_path}")
    print(f"  {ids_path}")


if __name__ == "__main__":
    main()
