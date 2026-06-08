#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Download Bangumi cover images from bangumi_slim_dataset.json / jsonl / csv.

Usage:
  python download_bangumi_covers.py --input data/bangumi_slim/bangumi_slim_dataset.json --out data/bangumi_slim/covers
  python download_bangumi_covers.py --input data/bangumi_slim/bangumi_slim_dataset.jsonl --out data/bangumi_slim/covers
  python download_bangumi_covers.py --input data/bangumi_slim/bangumi_slim_dataset.csv --out data/bangumi_slim/covers
"""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import re
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlparse

import requests
from tqdm import tqdm


UA = (
    "KhalilJalage/AnimeDatasetResearch/0.3 "
    "(https://github.com/khaliljalage; mailto:khaliljalage@gmail.com)"
)


def load_records(path: Path) -> List[Dict[str, Any]]:
    suffix = path.suffix.lower()

    if suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        if isinstance(data, dict) and isinstance(data.get("items"), list):
            return [x for x in data["items"] if isinstance(x, dict)]
        raise ValueError(f"Unsupported JSON structure in {path}")

    if suffix == ".jsonl":
        rows: List[Dict[str, Any]] = []
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    obj = json.loads(line)
                    if isinstance(obj, dict):
                        rows.append(obj)
        return rows

    if suffix == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))

    raise ValueError("Only .json, .jsonl, .csv are supported")


def normalize_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return "https://bgm.tv" + url
    return url


def subject_id_from_url(url: str) -> Optional[str]:
    m = re.search(r"/subject/(\d+)", url or "")
    return m.group(1) if m else None


def guess_ext(url: str, content_type: str = "") -> str:
    path = urlparse(url).path
    ext = Path(path).suffix.lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return ".jpg" if ext == ".jpeg" else ext

    if content_type:
        ext2 = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if ext2:
            return ".jpg" if ext2 == ".jpe" else ext2

    return ".jpg"


def safe_stem(record: Dict[str, Any]) -> str:
    order = str(record.get("order") or "").strip()
    sid = subject_id_from_url(str(record.get("url") or ""))
    name = str(record.get("name_cn") or "").strip()

    # Windows-safe filename.
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    name = re.sub(r"\s+", " ", name).strip()
    if len(name) > 60:
        name = name[:60].rstrip()

    parts = []
    if order:
        parts.append(order.zfill(4))
    if sid:
        parts.append(sid)
    if name:
        parts.append(name)

    return "_".join(parts) if parts else "unknown"


def download_one(
    session: requests.Session,
    url: str,
    dest_without_ext: Path,
    timeout: float,
    retries: int,
) -> Optional[Path]:
    url = normalize_url(url)
    if not url:
        return None

    # If already exists with common extension, skip.
    for ext in [".jpg", ".png", ".webp", ".gif", ".jpeg"]:
        existing = dest_without_ext.with_suffix(ext)
        if existing.exists() and existing.stat().st_size > 0:
            return existing

    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            resp = session.get(url, timeout=timeout, stream=True)
            resp.raise_for_status()

            content_type = resp.headers.get("Content-Type", "")
            ext = guess_ext(url, content_type)
            dest = dest_without_ext.with_suffix(ext)
            tmp = dest.with_suffix(dest.suffix + ".part")

            with tmp.open("wb") as f:
                for chunk in resp.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        f.write(chunk)

            if tmp.stat().st_size <= 0:
                tmp.unlink(missing_ok=True)
                raise RuntimeError("empty file")

            tmp.replace(dest)
            return dest

        except Exception as e:
            last_err = e
            time.sleep(min(2.0 * (attempt + 1), 6.0))

    raise RuntimeError(f"failed to download {url}: {last_err}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to bangumi_slim_dataset.json/jsonl/csv")
    parser.add_argument("--out", default=None, help="Output image directory. Default: <input_dir>/covers")
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--delay", type=float, default=0.2, help="Delay between successful downloads")
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--limit", type=int, default=0, help="0 means no limit")
    args = parser.parse_args()

    input_path = Path(args.input)
    records = load_records(input_path)
    if args.limit and args.limit > 0:
        records = records[: args.limit]

    out_dir = Path(args.out) if args.out else input_path.parent / "covers"
    out_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({
        "User-Agent": UA,
        "Referer": "https://bgm.tv/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    })

    manifest: List[Dict[str, Any]] = []
    ok = 0
    skipped_no_url = 0
    failed = 0

    for record in tqdm(records, desc="covers"):
        cover_url = normalize_url(str(record.get("cover_large") or ""))
        if not cover_url:
            skipped_no_url += 1
            manifest.append({
                "order": record.get("order"),
                "url": record.get("url"),
                "name_cn": record.get("name_cn"),
                "cover_large": cover_url,
                "local_cover": "",
                "status": "no_cover_url",
                "error": "",
            })
            continue

        stem = safe_stem(record)
        dest_without_ext = out_dir / stem

        try:
            local_path = download_one(
                session=session,
                url=cover_url,
                dest_without_ext=dest_without_ext,
                timeout=args.timeout,
                retries=args.retries,
            )
            ok += 1
            manifest.append({
                "order": record.get("order"),
                "url": record.get("url"),
                "name_cn": record.get("name_cn"),
                "cover_large": cover_url,
                "local_cover": str(local_path) if local_path else "",
                "status": "ok",
                "error": "",
            })
            time.sleep(args.delay)

        except Exception as e:
            failed += 1
            manifest.append({
                "order": record.get("order"),
                "url": record.get("url"),
                "name_cn": record.get("name_cn"),
                "cover_large": cover_url,
                "local_cover": "",
                "status": "failed",
                "error": str(e),
            })

    manifest_json = out_dir.parent / "cover_download_manifest.json"
    manifest_csv = out_dir.parent / "cover_download_manifest.csv"

    manifest_json.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    with manifest_csv.open("w", encoding="utf-8-sig", newline="") as f:
        fieldnames = ["order", "url", "name_cn", "cover_large", "local_cover", "status", "error"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(manifest)

    print()
    print(f"records: {len(records)}")
    print(f"downloaded or already exists: {ok}")
    print(f"no cover url: {skipped_no_url}")
    print(f"failed: {failed}")
    print(f"covers dir: {out_dir}")
    print(f"manifest json: {manifest_json}")
    print(f"manifest csv: {manifest_csv}")


if __name__ == "__main__":
    main()
