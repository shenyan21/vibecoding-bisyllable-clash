import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCardsByMode } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHILDHOOD_DIR = path.join(ROOT, "data", "childhood");
const CARD_FILE = path.join(CHILDHOOD_DIR, "items.jsonl");
const COVER_DIR = path.join(CHILDHOOD_DIR, "covers");

export function loadChildhoodCards() {
  return getCardsByMode("childhood");
}

export function loadChildhoodCardsFromFile() {
  const lines = fs.readFileSync(CARD_FILE, "utf8").split(/\r?\n/).filter(Boolean);
  const coverFiles = buildCoverIndex();
  const seenNames = new Set();
  const cards = [];

  for (const [index, line] of lines.entries()) {
    const item = JSON.parse(line);
    const subjectId = Number(item.subject_id) || null;
    const displayTitle = cleanTitle(item.title);
    const primaryName = extractPrimaryName(displayTitle);
    const name = seenNames.has(primaryName) ? displayTitle : primaryName;
    if (!subjectId || !name || seenNames.has(name)) continue;
    seenNames.add(name);

    const aliases = buildAliases(displayTitle, name, item.abstract);
    const tags = buildTags(item);
    const people = splitSlashList(item.abstract_2).slice(0, 16);
    const coverFile = coverFiles.get(String(subjectId));

    cards.push({
      id: 800000 + index + 1,
      mode: "childhood",
      rank: Number(item.rank) || cards.length + 1,
      name,
      chineseName: name,
      englishName: aliases.find((alias) => /[A-Za-z]/.test(alias)) || "",
      rarity: ratingBand(item.rating),
      description: buildDescription(item, tags, people),
      image: coverFile ? `/childhood/covers/${encodeURIComponent(coverFile)}` : normalizeRemoteImage(item.cover_url),
      tags,
      answer: name,
      url: cleanText(item.subject_url),
      date: extractYear(displayTitle),
      score: Number(item.rating) || null,
      totalVotes: Number(item.rating_count) || 0,
      aliases,
      characters: people.map((person, personIndex) => ({
        id: personIndex + 1,
        name: person,
        url: ""
      }))
    });
  }

  return cards;
}

export function getChildhoodStaticDir() {
  return CHILDHOOD_DIR;
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
    const match = /^([0-9]+)_/.exec(file);
    if (match) index.set(match[1], file);
  }
  return index;
}

function cleanTitle(value) {
  return cleanText(value)
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s*\((\d{4})\)\s*$/, " ($1)")
    .trim();
}

function extractPrimaryName(title) {
  const withoutYear = title.replace(/\s*\(\d{4}\)\s*$/, "").trim();
  const [first, ...rest] = withoutYear.split(/\s+/);
  if (first && rest.length > 0 && /[\u4e00-\u9fff]/u.test(first)) return first;
  return withoutYear;
}

function extractYear(title) {
  const match = /\((\d{4})\)\s*$/.exec(title);
  return match ? match[1] : "";
}

function buildAliases(displayTitle, name, abstract) {
  const aliases = new Set();
  const titleWithoutYear = displayTitle.replace(/\s*\(\d{4}\)\s*$/, "").trim();
  if (titleWithoutYear && titleWithoutYear !== name) aliases.add(titleWithoutYear);
  for (const part of splitSlashList(abstract)) {
    if (part && part !== name && !looksLikeDuration(part)) aliases.add(part);
  }
  return [...aliases].slice(0, 16);
}

function buildTags(item) {
  const tags = new Set();
  if (item.is_tv) tags.add("剧集");
  for (const label of item.labels || []) tags.add(cleanText(label));
  for (const part of splitSlashList(item.abstract)) {
    if (!part || looksLikeDuration(part) || /[A-Za-z]/.test(part)) continue;
    if (part.length <= 12) tags.add(part);
  }
  return [...tags].filter(Boolean).slice(0, 30);
}

function buildDescription(item, tags, people) {
  const parts = [];
  if (item.abstract) parts.push(cleanText(item.abstract));
  if (Number(item.rating)) parts.push(`豆瓣评分：${Number(item.rating).toFixed(1)}`);
  if (Number(item.rating_count)) parts.push(`评价人数：${Number(item.rating_count).toLocaleString("zh-CN")}`);
  if (tags.length) parts.push(`标签：${tags.slice(0, 10).join(" / ")}`);
  if (people.length) parts.push(`相关人物：${people.slice(0, 8).join(" / ")}`);
  return parts.join("\n");
}

function ratingBand(rating) {
  const value = Number(rating) || 0;
  if (value >= 8.5) return "高分";
  if (value >= 7.8) return "热门";
  return "候选";
}

function splitSlashList(value) {
  return cleanText(value).split("/").map(cleanText).filter(Boolean);
}

function looksLikeDuration(value) {
  return /\d+\s*分钟/.test(value);
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeRemoteImage(value) {
  const image = cleanText(value);
  return /^https?:\/\//i.test(image) ? image : "";
}
