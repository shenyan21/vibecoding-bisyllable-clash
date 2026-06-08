import argparse
import json
import shutil
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import re


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JSON = ROOT / "data" / "hextech" / "hextech.json"
DEFAULT_IMAGE_DIR = ROOT / "data" / "hextech" / "image"
DEFAULT_AUGMENTS = ROOT / ".tmp" / "hextech" / "cherry-augments.zh_cn.json"
CDRAGON_ASSET_BASES = [
    "https://raw.communitydragon.org/latest/game",
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default",
]

MANUAL_ALIASES_BY_ID = {
    1136: ["slaparound_icon", "slaparound"],
    1318: ["Upgrade_Zhonya's", "upgradezh"],
    1321: ["Gash", "darksteeltalons"],
    1323: ["Cruelty"],
    1324: ["Protein_Shake", "proteinshake"],
    1325: ["Glass_Cannon", "glasscannon"],
    1327: ["Adamant"],
    1329: ["Biggest_Snowball_Ever", "biggestsnowballever"],
    1330: ["ReEnergize", "mobiuscoil"],
    1331: ["Empyrean_Promise", "empyreampromise"],
    1336: ["Upgrade_Infinity_Edge", "upgradeie"],
    1337: ["King_Me"],
    1338: ["Upgrade_Hubris"],
    1339: ["Laser_Heal", "laseheal", "laserheal"],
    1340: ["Upgrade_Mikael's_Blessing", "upgrademikaelsblessing"],
    1341: ["Hat_on_a_Hat", "hatonahat"],
    1342: ["Snowball_Upgrade"],
    1343: ["sneakerhead"],
    1344: ["Final_Form", "finalform"],
    1346: ["Vampirism", "vampired"],
    1347: ["Poltergeist"],
    1348: ["Flash_2", "flash2"],
    1349: ["Ultimate_Awakening", "zerohour"],
    1361: ["quest_voidimmolation", "questvoidimmolation"],
    1372: ["I'm_a_Baby_Kitty_Where_is_Mama", "babykitty"],
    1386: ["youspinmerightround"],
    1390: ["phenomenalevil", "aramphenomenalevil"],
    1409: ["poroblast", "poro_blaster"],
    1411: ["upgrade_thornmail", "Upgrade_Collector"],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Map crawled Hextech images to card JSON entries.")
    parser.add_argument("--json", type=Path, default=DEFAULT_JSON)
    parser.add_argument("--image-dir", type=Path, default=DEFAULT_IMAGE_DIR)
    parser.add_argument("--augments", type=Path, default=DEFAULT_AUGMENTS)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--download-missing", action="store_true")
    return parser.parse_args()


def normalize_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def stem_key(value: object) -> str:
    stem = Path(str(value or "")).stem
    stem = re.sub(r"(_small|_large)$", "", stem, flags=re.I)
    stem = re.sub(r"\.mayhem_new_augments$", "", stem, flags=re.I)
    return normalize_key(stem)


def source_stem(value: object) -> str:
    return Path(str(value or "").split("?")[0]).stem


def cdragon_asset_urls(asset_path: str) -> list[str]:
    path = asset_path.replace("\\", "/")
    path = path.replace("/lol-game-data/assets/ASSETS/", "/assets/")
    path = path.replace("/lol-game-data/assets/assets/", "/assets/")
    return [base + path.lower() for base in CDRAGON_ASSET_BASES]


def add_candidate(index: dict[str, list[tuple[Path, int]]], key: str, path: Path, priority: int) -> None:
    if not key:
        return
    values = index.setdefault(key, [])
    if not any(existing == path for existing, _priority in values):
        values.append((path, priority))


def build_image_index(image_dir: Path, raw_items_by_id: dict[int, dict]) -> dict[str, list[tuple[Path, int]]]:
    index: dict[str, list[tuple[Path, int]]] = {}
    for path in image_dir.glob("*"):
        if not path.is_file():
            continue
        add_candidate(index, stem_key(path.name), path, 30)
        if path.stem.isdigit():
            item = raw_items_by_id.get(int(path.stem))
            if item:
                add_candidate(index, stem_key(item.get("augmentSmallIconPath", "")), path, 10)
    return index


def card_keys(card: dict, raw_item: dict | None) -> list[str]:
    keys = []
    if raw_item:
        keys.append(stem_key(raw_item.get("augmentSmallIconPath", "")))
    keys.append(stem_key(source_stem(card.get("sourceImage", ""))))
    keys.extend(stem_key(alias) for alias in MANUAL_ALIASES_BY_ID.get(int(card["id"]), []))
    return list(dict.fromkeys(key for key in keys if key))


def choose_candidate(candidates: list[tuple[Path, int]]) -> Path:
    def score(item: tuple[Path, int]) -> tuple[int, int, int]:
        path, priority = item
        has_alpha = int(not path.stem.isdigit())
        size = path.stat().st_size if path.exists() else 0
        return (priority, has_alpha, size)

    return max(candidates, key=score)[0]


def download_asset(urls: list[str], dest: Path) -> bool:
    for url in urls:
        request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urlopen(request, timeout=30) as response:
                data = response.read()
            if len(data) < 128:
                continue
            dest.write_bytes(data)
            return True
        except (HTTPError, URLError, TimeoutError, OSError):
            continue
    return False


def write_cards(path: Path, cards: list[dict]) -> None:
    backup = path.with_suffix(path.suffix + ".bak")
    if not backup.exists():
        shutil.copy2(path, backup)
    path.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    json_path = args.json.resolve()
    image_dir = args.image_dir.resolve()
    augments_path = args.augments.resolve()

    cards = json.loads(json_path.read_text(encoding="utf-8"))
    raw_items = json.loads(augments_path.read_text(encoding="utf-8"))
    raw_items_by_id = {int(item.get("id", -1)): item for item in raw_items}
    image_dir.mkdir(parents=True, exist_ok=True)

    image_index = build_image_index(image_dir, raw_items_by_id)
    resolved: list[tuple[dict, Path]] = []
    missing: list[tuple[dict, dict | None]] = []

    for card in cards:
        raw_item = raw_items_by_id.get(int(card["id"]))
        candidates: list[tuple[Path, int]] = []
        for key in card_keys(card, raw_item):
            candidates.extend(image_index.get(key, []))
        if candidates:
            resolved.append((card, choose_candidate(candidates)))
            continue
        missing.append((card, raw_item))

    downloaded = 0
    if missing and args.download_missing:
        still_missing = []
        for card, raw_item in missing:
            if not raw_item:
                still_missing.append((card, raw_item))
                continue
            dest = image_dir / f"{source_stem(card.get('sourceImage'))}.png"
            urls = cdragon_asset_urls(raw_item.get("augmentSmallIconPath", ""))
            if download_asset(urls, dest):
                downloaded += 1
                resolved.append((card, dest))
            else:
                still_missing.append((card, raw_item))
        missing = still_missing

    changed = 0
    for card, path in resolved:
        local_path = f"image/{path.name}"
        if card.get("image") != local_path:
            card["image"] = local_path
            changed += 1

    print(f"cards={len(cards)} resolved={len(resolved)} missing={len(missing)} downloaded={downloaded} changed={changed}")
    if missing:
        for card, raw_item in missing:
            print(f"missing {card.get('id')} {card.get('name')} {raw_item.get('augmentSmallIconPath') if raw_item else ''}")
    if changed and not args.dry_run:
        write_cards(json_path, cards)
        print(f"updated_json={json_path}")
    elif args.dry_run:
        print("dry_run=true")

    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
