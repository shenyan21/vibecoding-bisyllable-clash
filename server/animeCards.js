import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCardsByMode } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ANIME_DIR = path.join(ROOT, "data", "anime");
const CARD_FILE = path.join(ANIME_DIR, "bangumi_slim_dataset.json");
const COVER_DIR = path.join(ANIME_DIR, "covers");

export function loadAnimeCards() {
  return getCardsByMode("anime");
}

export function loadAnimeCardsFromFile() {
  const raw = JSON.parse(fs.readFileSync(CARD_FILE, "utf8"));
  const coverFiles = buildCoverIndex();
  const seenNames = new Set();
  const cards = [];

  for (const item of raw) {
    const id = getSubjectId(item.url);
    const name = String(item.name_cn || "").trim();
    if (!id || !name || seenNames.has(name)) continue;
    seenNames.add(name);

    const tags = Array.isArray(item.tags) ? item.tags.map(cleanText).filter(Boolean).slice(0, 30) : [];
    const characters = Array.isArray(item.characters)
      ? item.characters
          .map((character) => ({
            id: Number(character.id) || null,
            name: cleanText(character.name),
            url: cleanText(character.url)
          }))
          .filter((character) => character.name)
          .slice(0, 16)
      : [];
    const coverFile = coverFiles.get(`${Number(item.order)}:${id}`) || coverFiles.get(`id:${id}`);

    cards.push({
      id,
      mode: "anime",
      rank: Number(item.order) || cards.length + 1,
      name,
      rarity: scoreBand(item.score),
      description: buildDescription(item, tags, characters),
      image: coverFile ? `/anime/covers/${encodeURIComponent(coverFile)}` : normalizeRemoteImage(item.cover_large),
      tags,
      answer: name,
      url: cleanText(item.url),
      date: cleanText(item.date),
      score: Number(item.score) || null,
      totalVotes: Number(item.total_votes) || 0,
      characters
    });
  }

  return cards;
}

export function getAnimeStaticDir() {
  return ANIME_DIR;
}

function buildCoverIndex() {
  const index = new Map();
  let files = [];
  try {
    files = fs.readdirSync(COVER_DIR);
  } catch {
    return index;
  }

  for (const file of files) {
    const match = /^(\d+)_([0-9]+)_/.exec(file);
    if (!match) continue;
    const order = Number(match[1]);
    const id = Number(match[2]);
    index.set(`${order}:${id}`, file);
    if (!index.has(`id:${id}`)) index.set(`id:${id}`, file);
  }
  return index;
}

function getSubjectId(url) {
  const match = /\/subject\/(\d+)/.exec(String(url || ""));
  return match ? Number(match[1]) : null;
}

function buildDescription(item, tags, characters) {
  const parts = [];
  if (item.date) parts.push(`首播：${item.date}`);
  if (Number(item.score)) parts.push(`Bangumi 评分：${Number(item.score).toFixed(1)}`);
  if (Number(item.total_votes)) parts.push(`评分人数：${Number(item.total_votes).toLocaleString("zh-CN")}`);
  if (tags.length) parts.push(`标签：${tags.slice(0, 8).join(" / ")}`);
  if (characters.length) parts.push(`角色：${characters.slice(0, 6).map((character) => character.name).join(" / ")}`);
  return parts.join("\n");
}

function scoreBand(score) {
  const value = Number(score) || 0;
  if (value >= 8.2) return "高分";
  if (value >= 7.4) return "热门";
  return "候选";
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeRemoteImage(value) {
  const image = String(value || "").trim();
  return /^https?:\/\//i.test(image) ? image : "";
}
