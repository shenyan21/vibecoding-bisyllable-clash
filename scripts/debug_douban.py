"""调试脚本：检查豆瓣搜索页DOM结构"""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

PROFILE_DIR = Path(__file__).resolve().parents[1] / ".tmp" / "douban_browser_profile"
OUT_FILE = Path(__file__).resolve().parents[1] / ".tmp" / "debug_output.txt"

def main():
    lines = []
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=False,
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        )
        page = context.new_page()
        page.goto("https://www.douban.com/search?cat=1002&q=%E7%A5%9E%E9%AD%84", wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(3000)
        
        # 保存完整HTML
        full_html = page.content()
        html_file = Path(__file__).resolve().parents[1] / ".tmp" / "search_page.html"
        html_file.parent.mkdir(parents=True, exist_ok=True)
        html_file.write_text(full_html, encoding="utf-8")
        lines.append(f"Full HTML saved to {html_file}, size={html_file.stat().st_size}")
        
        # 检查搜索结果
        results = page.query_selector_all("div.result")
        lines.append(f"Found {len(results)} div.result elements")
        
        if results:
            r = results[0]
            # 链接
            links = r.query_selector_all("a")
            for a in links[:10]:
                href = a.get_attribute("href") or ""
                text = (a.inner_text() or "").strip()[:80]
                lines.append(f"  LINK: [{text}] -> {href[:150]}")
            
            # 文本内容
            text = r.inner_text()
            lines.append(f"  RESULT TEXT: {text[:800]}")
            
            # HTML中的subject链接
            html = r.inner_html()
            subjects = re.findall(r"subject/(\d+)", html)
            lines.append(f"  SUBJECT_IDS in HTML: {subjects}")
            
            # 所有href
            all_hrefs = re.findall(r'href=["\x27]([^"\x27>]+)["\x27]', html)
            lines.append(f"  ALL HREFS: {all_hrefs[:10]}")
            
            # 各元素
            rn = r.query_selector("span.rating_nums")
            lines.append(f"  RATING: {rn.inner_text() if rn else 'NOT_FOUND'}")
            pl = r.query_selector("span.pl")
            lines.append(f"  PL: {pl.inner_text() if pl else 'NOT_FOUND'}")
            meta = r.query_selector("div.meta")
            lines.append(f"  META: {meta.inner_text() if meta else 'NOT_FOUND'}")
            cat = r.query_selector("span.cat")
            lines.append(f"  CAT: {cat.inner_text() if cat else 'NOT_FOUND'}")
            playable = r.query_selector("span.playable")
            lines.append(f"  PLAYABLE: {playable.inner_text() if playable else 'NOT_FOUND'}")
        else:
            lines.append("No div.result found")
            # 尝试其他选择器
            for sel in [".result-list", ".item-root", ".search-result", "[class*=result]"]:
                els = page.query_selector_all(sel)
                if els:
                    lines.append(f"  Found {len(els)} elements with selector: {sel}")
            body_text = page.query_selector("body").inner_text()[:500] if page.query_selector("body") else ""
            lines.append(f"  BODY: {body_text}")
        
        context.close()
    
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"Debug output saved to {OUT_FILE}")

if __name__ == "__main__":
    main()
