"""
豆瓣童年动画/电视剧数据爬虫脚本 (Playwright版)

用法：
  方式1（交互登录）：
    python scripts/scrape_douban_childhood.py --login
    # 打开浏览器，手动登录豆瓣后自动检测保存

  方式2（自动抓取）：
    python scripts/scrape_douban_childhood.py
    # 使用已保存的登录状态自动抓取（搜索页+详情页）

  方式3（仅搜索页）：
    python scripts/scrape_douban_childhood.py --search-only
    # 仅从搜索页获取基本信息，不访问详情页（更快但信息不全）

  方式4（断点续传）：
    python scripts/scrape_douban_childhood.py --start 10
    # 从第10个条目继续

输出：
  data/childhood/scraped_items.csv
  data/childhood/scraped_items.jsonl
"""

import argparse
import csv
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote, unquote

from playwright.sync_api import sync_playwright, BrowserContext, Page

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "childhood"
INPUT_FILE = DATA_DIR / "需要补充的条目.txt"
OUTPUT_CSV = DATA_DIR / "scraped_items.csv"
OUTPUT_JSONL = DATA_DIR / "scraped_items.jsonl"
PROFILE_DIR = ROOT / ".tmp" / "douban_browser_profile"

CSV_FIELDS = [
    "rank", "source_page", "source_page_start", "subject_id", "title",
    "rating", "rating_count", "star_count", "labels", "is_tv",
    "abstract", "abstract_2", "cover_url", "subject_url", "search_url",
    "parse_source", "tpl_name"
]


def rating_to_star(rating: float) -> float:
    if not rating:
        return 0.0
    return round(rating / 2 * 2) / 2


def read_queries() -> list[str]:
    queries = []
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                match = re.match(r"^\d+[:：]\s*(.+)$", line)
                if match:
                    queries.append(match.group(1).strip())
                else:
                    queries.append(line)
    return queries


def create_context(playwright, headless: bool = False, cookie_str: str = "") -> BrowserContext:
    """创建浏览器上下文，使用持久化profile保存登录状态"""
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    browser = playwright.chromium.launch_persistent_context(
        user_data_dir=str(PROFILE_DIR),
        headless=headless,
        viewport={"width": 1280, "height": 800},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        locale="zh-CN",
    )
    if cookie_str:
        cookies = []
        for item in cookie_str.split(";"):
            item = item.strip()
            if "=" in item:
                name, value = item.split("=", 1)
                cookies.append({
                    "name": name.strip(),
                    "value": value.strip(),
                    "domain": ".douban.com",
                    "path": "/",
                })
        browser.add_cookies(cookies)
    return browser


def do_login():
    """打开浏览器让用户登录豆瓣，登录状态自动保存在持久化profile中"""
    with sync_playwright() as p:
        context = create_context(p, headless=False)
        page = context.new_page()
        page.goto("https://www.douban.com/")
        print("\n" + "=" * 60)
        print("请在浏览器中登录豆瓣")
        print("登录成功后会自动检测并保存...")
        print("=" * 60 + "\n")
        for i in range(300):
            time.sleep(2)
            try:
                logged_in = page.query_selector(".nav-user-account, a[href*='/mine']")
                if logged_in:
                    print("检测到登录成功！正在保存...")
                    time.sleep(2)
                    break
            except Exception:
                pass
        else:
            print("等待超时，尝试保存当前状态...")
        context.close()
        print("登录状态已保存到浏览器profile中")


def extract_subject_id_from_link2(url: str) -> str:
    """从豆瓣link2重定向URL中提取subject_id"""
    if not url:
        return ""
    # 直接匹配
    match = re.search(r"movie\.douban\.com/subject/(\d+)", url)
    if match:
        return match.group(1)
    # 从URL编码的参数中提取
    match = re.search(r"url=([^&]+)", url)
    if match:
        decoded = unquote(match.group(1))
        match2 = re.search(r"movie\.douban\.com/subject/(\d+)", decoded)
        if match2:
            return match2.group(1)
    return ""


def parse_search_page(page: Page, query: str) -> dict | None:
    """解析豆瓣搜索结果页面 (www.douban.com/search)，提取第一个条目"""
    url = f"https://www.douban.com/search?cat=1002&q={quote(query)}"
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(1000)
    except Exception as e:
        print(f"  [错误] 搜索页面加载失败: {e}")
        return None

    item = {
        "rank": 0,
        "source_page": 1,
        "source_page_start": 0,
        "subject_id": "",
        "title": "",
        "rating": 0.0,
        "rating_count": 0,
        "star_count": 0.0,
        "labels": [],
        "is_tv": False,
        "abstract": "",
        "abstract_2": "",
        "cover_url": "",
        "subject_url": "",
        "search_url": url,
        "parse_source": "playwright",
        "tpl_name": "search_subject",
    }

    # 找第一个搜索结果
    result = page.query_selector("div.result")
    if not result:
        print(f"  [警告] 未找到搜索结果DOM")
        return None

    # subject_id — 从link2 URL中提取
    link = result.query_selector("a[href*='douban.com/link2']")
    if link:
        href = link.get_attribute("href") or ""
        sid = extract_subject_id_from_link2(href)
        if sid:
            item["subject_id"] = sid
            item["subject_url"] = f"https://movie.douban.com/subject/{sid}/"

    # 也从 onclick 属性中提取 (sid)
    if not item["subject_id"]:
        link2 = result.query_selector("a[onclick*='sid:']")
        if link2:
            onclick = link2.get_attribute("onclick") or ""
            match = re.search(r"sid:\s*'(\d+)'", onclick)
            if not match:
                match = re.search(r"sid:\s*(\d+)", onclick)
            if match:
                item["subject_id"] = match.group(1)
                item["subject_url"] = f"https://movie.douban.com/subject/{match.group(1)}/"

    # 标题 — h3 > a
    h3_link = result.query_selector("div.content h3 a")
    if h3_link:
        item["title"] = (h3_link.inner_text() or "").strip()

    # 分类标签 [电视剧] / [电影] — h3 > span (不含 ic-mark)
    cat_span = result.query_selector("div.content h3 > span:not(.ic-mark)")
    if cat_span:
        cat_text = (cat_span.inner_text() or "").strip().strip("[]")
        item["is_tv"] = "电视剧" in cat_text or "剧集" in cat_text

    # 可播放 — span.ic-mark
    playable_span = result.query_selector("span.ic-mark")
    if playable_span:
        item["labels"].append("可播放")
    if item["is_tv"]:
        item["labels"].insert(0, "剧集")

    # 评分 — span.rating_nums
    rating_el = result.query_selector("span.rating_nums")
    if rating_el:
        try:
            item["rating"] = float((rating_el.inner_text() or "").strip())
            item["star_count"] = rating_to_star(item["rating"])
        except ValueError:
            pass

    # 评价人数 — rating-info 下的普通 span (含"人评价")
    rating_info = result.query_selector("div.rating-info")
    if rating_info:
        all_spans = rating_info.query_selector_all("span")
        for sp in all_spans:
            text = (sp.inner_text() or "").strip()
            count_match = re.search(r"(\d+)人评价", text)
            if count_match:
                item["rating_count"] = int(count_match.group(1))
                break

    # 封面图 — div.pic img
    img = result.query_selector("div.pic img")
    if img:
        item["cover_url"] = img.get_attribute("src") or ""

    # subject-cast 信息行 — span.subject-cast
    cast_span = result.query_selector("span.subject-cast")
    if cast_span:
        cast_text = (cast_span.inner_text() or "").strip()
        # 格式: "原名:神魄 / 朱珂 / 夏磊 / 2013"
        parts = [p.strip() for p in cast_text.split("/")]
        abstract_parts = []
        abstract_2_parts = []
        for part in parts:
            if part.startswith("原名:") or part.startswith("原名："):
                val = part.split(":", 1)[1].strip() or part.split("：", 1)[1].strip()
                if val:
                    abstract_parts.append(val)
            elif re.match(r"^\d{4}$", part.strip()):
                pass  # 年份
            else:
                # 导演/演员名
                abstract_2_parts.append(part)
        item["abstract"] = " / ".join(abstract_parts)
        item["abstract_2"] = " / ".join(abstract_2_parts)

    return item


def parse_subject_page(page: Page, item: dict) -> dict:
    """解析豆瓣详情页，补充完整信息"""
    if not item["subject_url"]:
        return item

    try:
        page.goto(item["subject_url"], wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(800)
    except Exception as e:
        print(f"  [警告] 详情页加载失败: {e}")
        return item

    # 封面图
    if not item["cover_url"]:
        img = page.query_selector("img[rel='v:image']")
        if img:
            item["cover_url"] = img.get_attribute("src") or ""

    # 标题
    if not item["title"]:
        title_el = page.query_selector("span[property='v:itemreviewed']")
        if title_el:
            title = (title_el.inner_text() or "").strip()
            year_el = page.query_selector("span.year")
            if year_el:
                title += " " + (year_el.inner_text() or "").strip()
            item["title"] = title

    # 评分
    if not item["rating"]:
        rating_el = page.query_selector("strong.ll.rating_num")
        if rating_el:
            try:
                item["rating"] = float((rating_el.inner_text() or "").strip())
                item["star_count"] = rating_to_star(item["rating"])
            except ValueError:
                pass

    # 评价人数
    if not item["rating_count"]:
        votes_el = page.query_selector("span[property='v:votes']")
        if votes_el:
            try:
                item["rating_count"] = int((votes_el.inner_text() or "").strip())
            except ValueError:
                pass

    # abstract 和 abstract_2 从 info 区域提取
    info_el = page.query_selector("div#info")
    if info_el:
        info_text = (info_el.inner_text() or "").strip()

        # 提取国家/地区
        country = ""
        country_match = re.search(r"制片国家/地区[:：]\s*(.+)", info_text)
        if not country_match:
            country_match = re.search(r"国家/地区[:：]\s*(.+)", info_text)
        if country_match:
            country = country_match.group(1).strip().split("\n")[0].strip()

        # 提取类型
        type_parts = []
        for genre_el in info_el.query_selector_all("span[property='v:genre']"):
            gt = (genre_el.inner_text() or "").strip()
            if gt:
                type_parts.append(gt)

        # 提取别名
        alias = ""
        alias_match = re.search(r"又名[:：]\s*(.+)", info_text)
        if alias_match:
            alias = alias_match.group(1).strip().split("\n")[0].strip()

        # 提取时长
        duration = ""
        duration_el = info_el.query_selector("span[property='v:runtime']")
        if duration_el:
            duration = (duration_el.inner_text() or "").strip()

        # 构建 abstract: 国家 / 类型 / 别名 / 时长
        abstract_parts = []
        if country:
            abstract_parts.append(country)
        abstract_parts.extend(type_parts)
        if alias:
            abstract_parts.append(alias)
        if duration:
            abstract_parts.append(duration)
        if abstract_parts:
            item["abstract"] = " / ".join(abstract_parts)

        # 构建 abstract_2: 导演 / 演员
        abstract_2_parts = []
        for a_el in info_el.query_selector_all("a[rel='v:directedBy']"):
            name = (a_el.inner_text() or "").strip()
            if name:
                abstract_2_parts.append(name)
        for a_el in info_el.query_selector_all("a[rel='v:starring']")[:6]:
            name = (a_el.inner_text() or "").strip()
            if name:
                abstract_2_parts.append(name)
        if abstract_2_parts:
            item["abstract_2"] = " / ".join(abstract_2_parts)

        # 判断是否电视剧
        if "集数" in info_text:
            item["is_tv"] = True
            if "剧集" not in item["labels"]:
                item["labels"].insert(0, "剧集")

    # 检查可播放
    play_els = page.query_selector_all("a")
    for el in play_els:
        cls = el.get_attribute("class") or ""
        if "play" in cls and "可播放" not in item["labels"]:
            item["labels"].append("可播放")
            break

    return item


def save_results(results: list[dict]):
    """保存结果到CSV和JSONL"""
    with open(OUTPUT_CSV, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for item in results:
            row = dict(item)
            row["labels"] = str(row["labels"])
            writer.writerow(row)

    with open(OUTPUT_JSONL, "w", encoding="utf-8") as f:
        for item in results:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description="豆瓣童年动画数据爬虫")
    parser.add_argument("--login", action="store_true", help="打开浏览器登录豆瓣")
    parser.add_argument("--cookie", type=str, default="", help="直接提供cookie字符串")
    parser.add_argument("--headless", action="store_true", help="无头模式运行（不显示浏览器）")
    parser.add_argument("--start", type=int, default=1, help="从第几个条目开始（用于断点续传）")
    parser.add_argument("--search-only", action="store_true", help="仅抓取搜索页，不访问详情页")
    args = parser.parse_args()

    if args.login:
        do_login()
        return 0

    queries = read_queries()
    print(f"共 {len(queries)} 个条目需要补充")

    start_idx = args.start - 1
    if start_idx > 0:
        print(f"从第 {start_idx + 1} 个条目开始")

    # 尝试加载已有结果（用于断点续传）
    results = []
    if start_idx > 0 and OUTPUT_JSONL.exists():
        with open(OUTPUT_JSONL, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    results.append(json.loads(line))
        print(f"已加载 {len(results)} 条已有结果")

    with sync_playwright() as p:
        context = create_context(p, headless=args.headless, cookie_str=args.cookie)
        page = context.new_page()

        # 先访问豆瓣首页确认登录状态
        print("正在检查豆瓣登录状态...")
        try:
            page.goto("https://www.douban.com/", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(3000)
            logged_in = page.query_selector(".nav-user-account, a[href*='/mine']")
            if logged_in:
                print("已登录，开始抓取...")
            else:
                print("未检测到登录状态，可能会被限制访问")
                if not args.headless:
                    print("请在浏览器中登录豆瓣，脚本会自动检测...")
                    for _ in range(300):
                        time.sleep(2)
                        try:
                            page.goto("https://www.douban.com/", wait_until="domcontentloaded", timeout=10000)
                            page.wait_for_timeout(2000)
                            if page.query_selector(".nav-user-account"):
                                print("检测到登录成功！开始抓取...")
                                break
                        except Exception:
                            pass
        except Exception as e:
            print(f"检查登录状态失败: {e}")

        for i in range(start_idx, len(queries)):
            query = queries[i]
            print(f"\n[{i+1}/{len(queries)}] 搜索: {query}")

            # 解析搜索页
            item = parse_search_page(page, query)
            if not item:
                print(f"  [跳过] 未找到结果")
                continue

            item["rank"] = i + 1
            print(f"  搜索: {item['title']} (id={item['subject_id']}, rating={item['rating']})")

            # 解析详情页补充信息
            if not args.search_only and item["subject_url"]:
                time.sleep(0.8)
                item = parse_subject_page(page, item)
                print(f"  详情: abstract={item['abstract'][:60]}... | abstract_2={item['abstract_2'][:60]}...")

            results.append(item)

            # 实时保存
            save_results(results)
            print(f"  已保存 ({len(results)} 条)")

            time.sleep(1)

        context.close()

    print(f"\n完成！成功获取 {len(results)}/{len(queries)} 个条目")
    print(f"CSV: {OUTPUT_CSV}")
    print(f"JSONL: {OUTPUT_JSONL}")
    return 0


if __name__ == "__main__":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n用户中断，已保存的数据不会丢失")
        raise SystemExit(1)
