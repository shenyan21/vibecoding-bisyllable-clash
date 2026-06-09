import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadChildhoodCardsFromFile } from "../server/childhoodCards.js";
import { db } from "../server/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHILDHOOD_DIR = path.join(ROOT, "data", "childhood");

const SCRAPED_FILE = path.join(CHILDHOOD_DIR, "scraped_items.jsonl");
const SEARCH_FILE = path.join(CHILDHOOD_DIR, "search_items.jsonl");

// 读取两个文件
const scrapedLines = fs.readFileSync(SCRAPED_FILE, "utf8").split(/\r?\n/).filter(Boolean);
const searchLines = fs.readFileSync(SEARCH_FILE, "utf8").split(/\r?\n/).filter(Boolean);

const scrapedItems = scrapedLines.map((l) => JSON.parse(l));
const searchItems = searchLines.map((l) => JSON.parse(l));

// 用 subject_id 做合并：scraped 优先（有更完整的详情信息）
const mergedMap = new Map();
for (const item of searchItems) {
  mergedMap.set(String(item.subject_id), item);
}
let replaced = 0;
let added = 0;
for (const item of scrapedItems) {
  const sid = String(item.subject_id);
  if (mergedMap.has(sid)) {
    mergedMap.set(sid, item); // scraped 数据更完整，覆盖
    replaced++;
  } else {
    mergedMap.set(sid, item);
    added++;
  }
}

console.log(`search_items: ${searchItems.length}, scraped_items: ${scrapedItems.length}`);
console.log(`Replaced: ${replaced}, Added: ${added}, Total merged: ${mergedMap.size}`);

// 写回 search_items.jsonl（保持原顺序：先 search 的原始顺序，再 appended 的新项）
const originalOrder = searchItems.map((i) => String(i.subject_id));
const appendedIds = [...mergedMap.keys()].filter((id) => !originalOrder.includes(id));
const finalOrder = [...originalOrder, ...appendedIds];

const mergedLines = finalOrder.map((id) => JSON.stringify(mergedMap.get(id)));
fs.writeFileSync(SEARCH_FILE, mergedLines.join("\n") + "\n", "utf8");
console.log(`Written ${mergedLines.length} items to search_items.jsonl`);

// 更新数据库中的 childhood 卡牌
const insert = db.prepare("INSERT OR REPLACE INTO cards (id, mode, data) VALUES (?, ?, ?)");
const childhoodCards = loadChildhoodCardsFromFile();

db.transaction(() => {
  for (const card of childhoodCards) {
    insert.run(card.id, "childhood", JSON.stringify(card));
  }
})();

const count = db.prepare("SELECT count(*) as count FROM cards WHERE mode = 'childhood'").get().count;
console.log(`Database updated: ${count} childhood cards`);
