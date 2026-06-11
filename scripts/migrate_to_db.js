import { loadHexCardsFromFile } from "../server/hexCards.js";
import { loadAnimeCardsFromFile } from "../server/animeCards.js";
import { loadGameCardsFromFile } from "../server/gameCards.js";
import { loadChildhoodCardsFromFile } from "../server/childhoodCards.js";
import { loadYingshiCardsFromFile } from "../server/yingshiCards.js";
import { db } from "../server/db.js";

console.log("Starting database migration...");

const row = db.prepare("SELECT count(*) as count FROM cards").get();
if (row && row.count > 0) {
  console.log(`Database already has ${row.count} cards. Skipping migration.`);
  process.exit(0);
}

const insert = db.prepare("INSERT OR REPLACE INTO cards (id, mode, data) VALUES (?, ?, ?)");

db.transaction(() => {
  // 1. 海克斯
  console.log("Migrating Hextech...");
  const hexCards = loadHexCardsFromFile();
  for (const card of hexCards) {
    insert.run(card.id, "hextech", JSON.stringify(card));
  }

  // 2. 动漫
  console.log("Migrating Anime...");
  const animeCards = loadAnimeCardsFromFile();
  for (const card of animeCards) {
    insert.run(card.id, "anime", JSON.stringify(card));
  }

  // 3. 游戏
  console.log("Migrating Game...");
  const gameCards = loadGameCardsFromFile();
  for (const card of gameCards) {
    insert.run(card.id, "game", JSON.stringify(card));
  }

  // 4. 童年动画
  console.log("Migrating Childhood...");
  const childhoodCards = loadChildhoodCardsFromFile();
  for (const card of childhoodCards) {
    insert.run(card.id, "childhood", JSON.stringify(card));
  }

  // 5. 阅片无数
  console.log("Migrating Yingshi...");
  const yingshiCards = loadYingshiCardsFromFile();
  for (const card of yingshiCards) {
    insert.run(card.id, "yingshi", JSON.stringify(card));
  }
})();

const finalCount = db.prepare("SELECT count(*) as count FROM cards").get().count;
console.log(`Migration complete! Total cards in database: ${finalCount}`);
