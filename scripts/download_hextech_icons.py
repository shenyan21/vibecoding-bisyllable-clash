import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JSON = ROOT / "data" / "hextech" / "hextech.json"
DEFAULT_ICON_DIR = ROOT / "data" / "hextech" / "icons"
DEFAULT_FAIL_LOG = ROOT / ".tmp" / "hextech-icon-failures.txt"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://apexlol.info/",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download Hextech card icons and rewrite JSON image paths to local files."
    )
    parser.add_argument("--json", type=Path, default=DEFAULT_JSON, help="Input card JSON path.")
    parser.add_argument(
        "--icons-dir",
        type=Path,
        default=DEFAULT_ICON_DIR,
        help="Directory for downloaded icons.",
    )
    parser.add_argument(
        "--fail-log",
        type=Path,
        default=DEFAULT_FAIL_LOG,
        help="Text file for failed downloads.",
    )
    parser.add_argument("--timeout", type=float, default=30.0, help="Request timeout in seconds.")
    parser.add_argument("--retries", type=int, default=4, help="Attempts per icon.")
    parser.add_argument("--sleep", type=float, default=0.4, help="Delay between attempts.")
    parser.add_argument("--force", action="store_true", help="Redownload existing icon files.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned work without downloading.")
    parser.add_argument(
        "--no-write-json",
        action="store_true",
        help="Download files but do not update the JSON image fields.",
    )
    parser.add_argument(
        "--max",
        type=int,
        default=0,
        help="Limit cards processed; useful for a quick local test.",
    )
    return parser.parse_args()


def is_http_url(value: object) -> bool:
    return isinstance(value, str) and value.lower().startswith(("http://", "https://"))


def safe_filename(card: dict, url: str, used_names: set[str]) -> str:
    parsed = urlparse(url)
    name = unquote(Path(parsed.path).name).strip()
    if not name or "." not in name:
        name = f"{card.get('id', 'icon')}.webp"

    stem = "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in Path(name).stem)
    suffix = Path(name).suffix.lower() or ".webp"
    stem = "-".join(part for part in stem.split("-") if part) or str(card.get("id", "icon"))
    candidate = f"{stem}{suffix}"

    if candidate.lower() not in used_names:
        used_names.add(candidate.lower())
        return candidate

    with_id = f"{card.get('id', 'icon')}-{candidate}"
    if with_id.lower() not in used_names:
        used_names.add(with_id.lower())
        return with_id

    index = 2
    while True:
        numbered = f"{card.get('id', 'icon')}-{index}-{candidate}"
        if numbered.lower() not in used_names:
            used_names.add(numbered.lower())
            return numbered
        index += 1


def icon_url_for(card: dict) -> str:
    if is_http_url(card.get("sourceImage")):
        return card["sourceImage"]
    if is_http_url(card.get("image")):
        return card["image"]
    return ""


def read_cards(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_cards(path: Path, cards: list[dict]) -> None:
    backup = path.with_suffix(path.suffix + ".bak")
    if not backup.exists():
        shutil.copy2(path, backup)
    path.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def download(url: str, dest: Path, timeout: float, retries: int, sleep: float) -> tuple[bool, str]:
    last_error = ""
    for attempt in range(1, max(1, retries) + 1):
        try:
            request = Request(url, headers=HEADERS)
            with urlopen(request, timeout=timeout) as response:
                status = getattr(response, "status", 200)
                content_type = response.headers.get("Content-Type", "")
                data = response.read()
            if status >= 400:
                last_error = f"HTTP {status}"
            elif len(data) < 128:
                last_error = f"response too small: {len(data)} bytes"
            elif "html" in content_type.lower():
                last_error = f"unexpected content type: {content_type}"
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
                return True, ""
        except HTTPError as exc:
            last_error = f"HTTP {exc.code}: {exc.reason}"
        except URLError as exc:
            last_error = str(exc.reason)
        except TimeoutError:
            last_error = "timeout"
        except OSError as exc:
            last_error = str(exc)

        if attempt < retries:
            time.sleep(max(0.0, sleep) * attempt)
    return False, last_error


def main() -> int:
    args = parse_args()
    json_path = args.json.resolve()
    icons_dir = args.icons_dir.resolve()
    fail_log = args.fail_log.resolve()

    cards = read_cards(json_path)
    if args.max > 0:
        cards_to_process = cards[: args.max]
    else:
        cards_to_process = cards

    used_names: set[str] = set()
    url_to_local: dict[str, str] = {}
    planned: list[tuple[dict, str, str, Path]] = []
    for card in cards_to_process:
        url = icon_url_for(card)
        if not url:
            continue
        if url not in url_to_local:
            filename = safe_filename(card, url, used_names)
            url_to_local[url] = f"icons/{filename}"
        local_path = url_to_local[url]
        planned.append((card, url, local_path, icons_dir / Path(local_path).name))

    print(f"json={json_path}")
    print(f"icons_dir={icons_dir}")
    print(f"cards={len(cards)} planned={len(planned)}")

    if args.dry_run:
        for card, url, local_path, _dest in planned[:20]:
            print(f"dry-run: {card.get('id')} {card.get('name')} -> {local_path} <- {url}")
        if len(planned) > 20:
            print(f"dry-run: ... {len(planned) - 20} more")
        return 0

    downloaded = 0
    skipped = 0
    failed: list[str] = []
    changed = False

    for index, (card, url, local_path, dest) in enumerate(planned, start=1):
        if dest.exists() and dest.stat().st_size > 0 and not args.force:
            ok = True
            skipped += 1
        else:
            ok, error = download(url, dest, args.timeout, args.retries, args.sleep)
            if ok:
                downloaded += 1
            else:
                failed.append(f"{card.get('id')} {card.get('name')} | {url} | {error}")

        if ok and card.get("image") != local_path:
            card["image"] = local_path
            changed = True

        status = "ok" if ok else "fail"
        print(f"[{index}/{len(planned)}] {status} {card.get('id')} {card.get('name')}")

    if failed:
        fail_log.parent.mkdir(parents=True, exist_ok=True)
        fail_log.write_text("\n".join(failed) + "\n", encoding="utf-8")
        print(f"failed={len(failed)} fail_log={fail_log}", file=sys.stderr)
    elif fail_log.exists():
        fail_log.unlink()

    if changed and not args.no_write_json:
        write_cards(json_path, cards)
        print(f"updated_json={json_path}")
        print(f"backup={json_path.with_suffix(json_path.suffix + '.bak')}")
    elif changed and args.no_write_json:
        print("json update skipped by --no-write-json")

    print(f"downloaded={downloaded} skipped={skipped} failed={len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
