import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.resolve(__dirname, "..", "data", "duel.db");

export const db = new Database(DB_FILE);

// 初始化 cards 表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY,
    mode TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cards_mode ON cards(mode);
`);

export function getCardsByMode(mode) {
  const stmt = db.prepare("SELECT data FROM cards WHERE mode = ?");
  const rows = stmt.all(mode);
  return rows.map((row) => JSON.parse(row.data));
}
