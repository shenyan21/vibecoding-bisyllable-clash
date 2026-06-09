export const TEAMS = ["A", "B"];

export const DEFAULT_SETTINGS = {
  totalRounds: 5,
  guessSeconds: 45,
  optionCount: 24,
  allowSpectatorsSeeAnswer: true,
  autoNextRound: true
};

const QUALITY_ORDER = {
  "白银": 1,
  "黄金": 2,
  "棱彩": 3
};
const PINYIN_COLLATOR = new Intl.Collator("zh-Hans-CN-u-co-pinyin", {
  numeric: true,
  sensitivity: "base"
});

export function nextTeam(team) {
  return team === "A" ? "B" : "A";
}

export function clampSettings(settings) {
  return {
    totalRounds: clampInt(settings.totalRounds, 1, 25, DEFAULT_SETTINGS.totalRounds),
    guessSeconds: clampInt(settings.guessSeconds, 10, 180, DEFAULT_SETTINGS.guessSeconds),
    optionCount: clampInt(settings.optionCount, 8, 300, DEFAULT_SETTINGS.optionCount),
    allowSpectatorsSeeAnswer: Boolean(settings.allowSpectatorsSeeAnswer),
    autoNextRound: Boolean(settings.autoNextRound)
  };
}

export function createRoomState(roomId, adminId = null) {
  return {
    id: roomId,
    gameMode: "hextech",
    status: "waiting",
    adminId,
    players: [],
    settings: { ...DEFAULT_SETTINGS },
    currentRound: 0,
    currentCard: null,
    currentOptions: [],
    currentTurnTeam: null,
    firstTeam: null,
    phase: "waiting",
    currentClue: "",
    clueHistory: [],
    turnStartedAt: null,
    turnEndsAt: null,
    guessedPlayerIds: [],
    score: { A: 0, B: 0 },
    history: [],
    roundTurns: [],
    usedCardIds: [],
    candidateCardIds: [],
    cardUsageCounts: {},
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function generateOptions(cards, answerId, count = DEFAULT_SETTINGS.optionCount, random = Math.random) {
  const answer = cards.find((card) => card.id === Number(answerId));
  if (!answer) {
    throw new Error("answer card not found");
  }

  if (count >= cards.length) {
    return sortCardsByPinyin(cards).map(toOption);
  }

  const pool = shuffle(
    cards.filter((card) => card.id !== answer.id),
    random
  ).slice(0, Math.max(0, count - 1));

  return sortCardsByPinyin([answer, ...pool]).map(toOption);
}

export function pickRandomCard(cards, usageCounts = {}, random = Math.random, excludeIds = []) {
  if (cards.length === 0) return null;
  const excluded = new Set(excludeIds.map(Number));
  let candidates = cards.filter((card) => !excluded.has(Number(card.id)));
  if (candidates.length === 0) candidates = cards;

  const usage = normalizeUsageCounts(usageCounts);
  const minUsage = Math.min(...candidates.map((card) => usage.get(Number(card.id)) ?? 0));
  const leastUsed = candidates.filter((card) => (usage.get(Number(card.id)) ?? 0) === minUsage);
  return leastUsed[Math.floor(random() * leastUsed.length)];
}

export function validateClue(clue, answerName) {
  const value = String(clue ?? "").trim().replace(/\s+/g, "");
  if (!value) {
    return { valid: false, reason: "提示不能为空" };
  }

  if (!/^[\u4e00-\u9fffA-Za-z0-9]{2}$/u.test(value)) {
    return { valid: false, reason: "提示只能由两个字符组成，每个字符可为单个汉字、英文字母或数字" };
  }

  const answerChars = new Set(
    Array.from(String(answerName ?? "").replace(/[^\u4e00-\u9fffA-Za-z0-9]/gu, ""))
  );
  const repeatedChar = Array.from(value).find((char) => answerChars.has(char));
  if (repeatedChar) {
    return { valid: false, reason: `提示不能包含答案中的字或字符：${repeatedChar}` };
  }

  const normalizedClue = normalizeText(value);
  const normalizedAnswer = normalizeText(answerName);
  if (normalizedClue && normalizedAnswer.includes(normalizedClue)) {
    return { valid: false, reason: "提示不能直接包含答案名称中的连续关键字" };
  }

  return { valid: true, clue: value };
}

export function buildTurn({ team, clue, selectedAnswerId, selectedAnswerName, answerId, timedOut = false, guesserId = null, guesserName = "" }) {
  const isCorrect = !timedOut && Number(selectedAnswerId) === Number(answerId);
  return {
    team,
    clue: clue || "",
    selectedAnswerId: selectedAnswerId ? Number(selectedAnswerId) : null,
    selectedAnswerName: selectedAnswerName || "",
    isCorrect,
    timedOut,
    guesserId,
    guesserName,
    timestamp: Date.now()
  };
}

export function finishRound(room, winnerTeam, finalAnswer) {
  room.history.push({
    roundIndex: room.currentRound,
    cardId: room.currentCard.id,
    winnerTeam,
    firstTeam: room.firstTeam,
    turns: room.roundTurns,
    clues: room.clueHistory,
    finalAnswer,
    correctAnswer: room.currentCard.name,
    finishedAt: Date.now()
  });
  if (winnerTeam) {
    room.score[winnerTeam] += 1;
  }
  room.phase = "round_over";
  room.currentTurnTeam = null;
  room.currentClue = "";
  room.turnStartedAt = null;
  room.turnEndsAt = null;
}

export function isGameComplete(room) {
  return room.history.length >= room.settings.totalRounds;
}

export function sortPlayers(players) {
  return [...players].sort((a, b) => {
    const roleRank = { admin: 0, contestant: 1, spectator: 2 };
    const teamRank = { A: 0, B: 1, null: 2, undefined: 2 };
    const seatRank = { clue_giver: 0, guesser: 1, null: 2, undefined: 2 };
    return (
      (roleRank[a.role] ?? 3) - (roleRank[b.role] ?? 3) ||
      (teamRank[a.team] ?? 2) - (teamRank[b.team] ?? 2) ||
      (seatRank[a.seatRole] ?? 2) - (seatRank[b.seatRole] ?? 2) ||
      compareChinesePinyin(a.nickname, b.nickname)
    );
  });
}

export function compareChinesePinyin(a, b) {
  return PINYIN_COLLATOR.compare(String(a ?? ""), String(b ?? ""));
}

function sortCardsByPinyin(cards) {
  return [...cards].sort((a, b) => compareChinesePinyin(a.name, b.name) || Number(a.id) - Number(b.id));
}

function toOption(card) {
  return {
    id: card.id,
    mode: card.mode,
    rank: card.rank,
    name: card.name,
    chineseName: card.chineseName || "",
    englishName: card.englishName || "",
    description: card.description,
    rarity: card.rarity,
    image: card.image,
    tags: card.tags || [],
    url: card.url || "",
    date: card.date || "",
    score: card.score ?? null,
    totalVotes: card.totalVotes || 0,
    aliases: card.aliases || [],
    platforms: card.platforms || [],
    characters: card.characters || []
  };
}

function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]/gu, "");
}

function normalizeUsageCounts(usageCounts) {
  if (Array.isArray(usageCounts)) {
    const counts = new Map();
    for (const id of usageCounts) {
      const key = Number(id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  const counts = new Map();
  for (const [id, count] of Object.entries(usageCounts || {})) {
    counts.set(Number(id), Number(count) || 0);
  }
  return counts;
}

export function compareQuality(a, b) {
  return (QUALITY_ORDER[a] ?? 9) - (QUALITY_ORDER[b] ?? 9);
}
