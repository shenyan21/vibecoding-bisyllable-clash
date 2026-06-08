import json
import re
import subprocess
import sys
from html import unescape
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "hextech"
TMP_DIR = ROOT / ".tmp" / "hextech"

BASE = "https://raw.communitydragon.org/latest"
APEXLOL_IMAGE_BASE = "https://apexlol.info/images/hextech"
CHERRY_AUGMENTS_URL = f"{BASE}/plugins/rcp-be-lol-game-data/global/zh_cn/v1/cherry-augments.json"
STRINGTABLE_URL = f"{BASE}/game/zh_cn/data/menu/en_us/lol.stringtable.json"

RARITY_MAP = {
    "kSilver": "白银",
    "kGold": "黄金",
    "kPrismatic": "棱彩",
    "kBronze": "青铜",
}

EXTRA_SLUG_VARIANTS_BY_ID = {
    1317: ["upgrade_cutlass"],
    1318: ["upgrade_zh"],
    1319: ["upgrade_immolate"],
    1320: ["upgrade_collector"],
    1321: ["gash"],
    1330: ["reenergize"],
    1331: ["empyreanpromise"],
    1336: ["upgrade_ie"],
    1338: ["upgrade_hubris"],
    1339: ["laserheal"],
    1343: ["quest_sneakerhead"],
    1346: ["vampirism"],
    1349: ["ultimateawakening"],
    1411: ["upgrade_thornmail", "upgradethornmail"],
    1996: ["upgrade_sheen"],
    2018: ["purist_caster", "puristcaster"],
    2026: ["killsecured"],
}


def curl_download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "curl.exe",
        "--ssl-no-revoke",
        "-L",
        "-A",
        "Mozilla/5.0",
        "--retry",
        "5",
        "--retry-all-errors",
        "--connect-timeout",
        "20",
        "--fail",
        "-o",
        str(dest),
        url,
    ]
    subprocess.run(cmd, check=True)


def load_or_download(url: str, dest: Path) -> Path:
    if not dest.exists() or dest.stat().st_size == 0:
        curl_download(url, dest)
    return dest


def clean_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    value = unescape(value)
    value = value.replace("\u200a", "")
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"\{\{[^}]+\}\}", "", value)
    value = re.sub(r"\{[^}]+\}", "", value)
    value = value.replace("\r", "\n")
    value = re.sub(r"\n{3,}", "\n\n", value)
    value = re.sub(r"[ \t]+", " ", value)
    return value.strip()


def clean_display_text(value: object) -> str:
    text = clean_text(value)
    text = re.sub(r"%i:[^%]+%", "", text)
    text = re.sub(r"@\s*f\d+\s*@", "", text)
    text = re.sub(r"@[^@]+@", "", text)
    text = re.sub(r"\{\{[^}]+\}\}", "", text)
    text = re.sub(r"[{}]", "", text)
    text = re.sub(r"\bundefined\b", "", text, flags=re.I)
    text = re.sub(r"\s+%", "%", text)
    text = re.sub(r"(?<!\d)%", "", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"（\s*）", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s+([。！？；，、：])", r"\1", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    lines = [line for line in lines if not re.search(r"[：:]$", line)]
    text = "\n\n".join(lines)
    text = re.sub(r"([。！？；，、：]){2,}", r"\1", text)
    return text.strip()


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def slug_from_icon_path(icon_path: str) -> str:
    name = Path(icon_path).name
    name = re.sub(r"\.(mayhem_new_augments\.)?png$", "", name, flags=re.I)
    name = re.sub(r"_small$", "", name, flags=re.I)
    name = re.sub(r"_large$", "", name, flags=re.I)
    name = re.sub(r"^aram_", "", name, flags=re.I)
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def slug_variants(item: dict) -> list[str]:
    icon_path = str(item.get("augmentSmallIconPath", ""))
    base = slug_from_icon_path(icon_path)
    variants = list(EXTRA_SLUG_VARIANTS_BY_ID.get(int(item.get("id", -1)), []))
    variants.extend([base, normalize_key(base)])
    name = Path(icon_path).name.lower()
    if "madscientist" in name and clean_text(item.get("nameTRA", "")) == "扳机炼狱":
        variants.extend(["infernotriggered", "triggeredinferno"])
    if "missingping" in name:
        variants.extend(["missingpingaugment", "missingping"])
    if "poro-blaster" in base or "poroblast" in base:
        variants.extend(["poro_blaster", "poroblast"])
    if base.startswith("quest-"):
        variants.append(base.replace("quest-", "quest_"))
    for variant in list(variants):
        if "_" in variant:
            variants.append(normalize_key(variant))
    return [v for v in dict.fromkeys(v for v in variants if v)]


def is_hextech_kiwi(item: dict) -> bool:
    icon = str(item.get("augmentSmallIconPath", ""))
    name = str(item.get("nameTRA", ""))
    if not name or name == "？？？" or "正在完善" in name:
        return False
    icon_l = icon.lower()
    return (
        "/ux/kiwi/" in icon_l
        or "/maps/particles/kiwi/" in icon_l
        or ".mayhem_new_augments" in icon_l
        or "aram_" in Path(icon).name.lower()
    )


def load_string_entries() -> dict:
    path = load_or_download(STRINGTABLE_URL, TMP_DIR / "lol.stringtable.zh_cn.json")
    return json.loads(path.read_text(encoding="utf-8"))["entries"]


def string_value(entries: dict, keys: list[str]) -> str:
    for key in keys:
        text = clean_text(entries.get(key, ""))
        if text and "@SpellModifierDescriptionAppend@" not in text:
            return text
    return ""


def name_for(item: dict, entries: dict) -> str:
    variants = slug_variants(item)
    keys = []
    for slug in variants:
        keys.extend(
            [
                f"kiwi_aram_{slug}_name",
                f"kiwi_{slug}_name",
                f"kiwi_augment_{slug}_name",
                f"augment_{slug}_name",
            ]
        )
    return string_value(entries, keys) or clean_text(item.get("nameTRA", ""))


def effect_for(item: dict, entries: dict) -> str:
    keys = []
    for slug in slug_variants(item):
        keys.extend(
            [
                f"kiwi_aram_{slug}_summary",
                f"kiwi_aram_{slug}_tooltip_summoner",
                f"kiwi_aram_{slug}_tooltip",
                f"kiwi_{slug}_summary",
                f"kiwi_{slug}_tooltip_summoner",
                f"kiwi_{slug}_tooltip",
                f"kiwi_augment_{slug}_summary",
                f"kiwi_augment_{slug}_tooltip_summoner",
                f"kiwi_augment_{slug}_tooltip",
                f"augment_{slug}_desc",
                f"cherry_{slug}_summary",
                f"cherry_{slug}_tooltip",
                f"{normalize_key(slug)}augmentitemupgrademodifiertooltip",
                f"{normalize_key(slug)}augmentitemupgrademodifier",
            ]
        )
    return string_value(entries, keys)


def has_kiwi_aram_entry(item: dict, entries: dict) -> bool:
    return any(
        f"kiwi_aram_{slug}_name" in entries
        or f"kiwi_aram_{slug}_tooltip" in entries
        or f"kiwi_aram_{slug}_summary" in entries
        for slug in slug_variants(item)
    )


def main() -> int:
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    source_path = load_or_download(CHERRY_AUGMENTS_URL, TMP_DIR / "cherry-augments.zh_cn.json")
    all_augments = json.loads(source_path.read_text(encoding="utf-8"))
    entries = load_string_entries()

    items_by_name: dict[str, dict] = {}
    seen_ids: set[int] = set()
    for item in all_augments:
        if not (is_hextech_kiwi(item) or has_kiwi_aram_entry(item, entries)):
            continue
        item_id = int(item.get("id", -1))
        if item_id in seen_ids or item_id < 0:
            continue
        seen_ids.add(item_id)

        name = name_for(item, entries)
        if not name or name == "？？？" or "正在完善" in name:
            continue
        icon_path = str(item.get("augmentSmallIconPath", ""))
        slug = slug_from_icon_path(icon_path) or str(item_id)
        if name in items_by_name:
            continue
        image_url = f"{APEXLOL_IMAGE_BASE}/{slug}.webp"
        items_by_name[name] = {
            "id": item_id,
            "name": name,
            "quality": RARITY_MAP.get(str(item.get("rarity", "")), str(item.get("rarity", ""))),
            "effect": clean_display_text(effect_for(item, entries)),
            "image": image_url,
            "sourceImage": image_url,
        }

    items = list(items_by_name.values())
    items.sort(key=lambda x: (x["quality"], x["id"]))
    (OUT_DIR / "hextech.json").write_text(
        json.dumps(items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"items={len(items)}")
    print(OUT_DIR)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"download failed: {exc}", file=sys.stderr)
        raise
