import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCardsByMode } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARD_FILE = path.join(ROOT, "data", "hextech", "hextech.json");

export function loadHexCards() {
  return getCardsByMode("hextech");
}

export function loadHexCardsFromFile() {
  const raw = JSON.parse(fs.readFileSync(CARD_FILE, "utf8"));
  const seenNames = new Set();
  const cards = [];
  for (const card of raw) {
    const name = String(card.name || "").trim();
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    cards.push({
      id: Number(card.id),
      mode: "hextech",
      name,
      rarity: card.quality,
      description: card.effect,
      image: normalizeImageUrl(card.image),
      tags: [card.quality],
      answer: name
    });
  }
  return cards;
}

export function getHextechStaticDir() {
  return path.join(ROOT, "data", "hextech");
}

function normalizeImageUrl(image) {
  const value = String(image || "").replaceAll("\\", "/");
  if (/^https?:\/\//i.test(value)) return value;
  const relativePath = value.replace(/^\/+/, "").replace(/^hextech\//i, "");
  return `/hextech/${relativePath.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}
