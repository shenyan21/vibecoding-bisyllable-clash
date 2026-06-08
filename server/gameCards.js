import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCardsByMode } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GAME_DIR = path.join(ROOT, "data", "game");
const CARD_FILE = path.join(GAME_DIR, "games.json");

export function loadGameCards() {
  return getCardsByMode("game");
}

export function loadGameCardsFromFile() {
  const raw = JSON.parse(fs.readFileSync(CARD_FILE, "utf8"));
  const seenNames = new Set();
  const cards = [];

  for (const [index, item] of raw.entries()) {
    const englishName = cleanText(item.english_name);
    const chineseName = cleanText(item.chinese_name);
    const name = chineseName || englishName;
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);

    const aliases = [englishName, chineseName].filter((alias) => alias && alias !== name);
    const platforms = Array.isArray(item.platforms) ? item.platforms.map(cleanText).filter(Boolean).slice(0, 12) : [];
    const tags = Array.isArray(item.tags) ? item.tags.map(cleanText).filter(Boolean).slice(0, 30) : [];

    cards.push({
      id: 700000 + index + 1,
      mode: "game",
      rank: cards.length + 1,
      name,
      chineseName,
      englishName,
      rarity: ratingBand(item.rating),
      description: buildDescription(item, aliases, platforms, tags),
      image: normalizeLocalCover(item.cover_local_path),
      tags,
      answer: name,
      url: cleanText(item.info_url),
      date: cleanText(item.release_date),
      score: Number(item.rating) || null,
      totalVotes: Number(item.download_count) || 0,
      aliases,
      platforms,
      characters: platforms.map((platform, platformIndex) => ({
        id: platformIndex + 1,
        name: platform,
        url: ""
      }))
    });
  }

  return cards;
}

export function getGameStaticDir() {
  return GAME_DIR;
}

function buildDescription(item, aliases, platforms, tags) {
  const parts = [];
  if (aliases.length) parts.push(`英文名：${aliases.join(" / ")}`);
  if (item.release_date) parts.push(`发行日期：${item.release_date}`);
  if (Number(item.rating)) parts.push(`评分：${Number(item.rating).toFixed(1)}`);
  if (platforms.length) parts.push(`平台：${platforms.join(" / ")}`);
  if (tags.length) parts.push(`标签：${tags.slice(0, 10).join(" / ")}`);
  if (item.game_intro) parts.push(cleanText(item.game_intro));
  return parts.join("\n");
}

function ratingBand(rating) {
  const value = Number(rating) || 0;
  if (value >= 8.2) return "高分";
  if (value >= 7.4) return "热门";
  return "候选";
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeLocalCover(value) {
  const cover = cleanText(value).replaceAll("\\", "/").replace(/^\/+/, "");
  if (!cover) return "";
  return `/game/${cover.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}
