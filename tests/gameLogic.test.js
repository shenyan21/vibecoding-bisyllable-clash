import test from "node:test";
import assert from "node:assert/strict";
import { generateOptions, nextTeam, pickRandomCard, validateClue } from "../server/gameLogic.js";
import { RoomStore } from "../server/roomStore.js";

const cards = [
  { id: 1, name: "星界躯体", rarity: "棱彩", description: "测试描述", image: "/hextech/a.png", tags: [], answer: "星界躯体" },
  { id: 2, name: "火力全开", rarity: "黄金", description: "测试描述", image: "/hextech/b.png", tags: [], answer: "火力全开" },
  { id: 3, name: "巨像勇气", rarity: "白银", description: "测试描述", image: "/hextech/c.png", tags: [], answer: "巨像勇气" },
  { id: 4, name: "闪现升级", rarity: "黄金", description: "测试描述", image: "/hextech/d.png", tags: [], answer: "闪现升级" },
  { id: 5, name: "法术连打", rarity: "白银", description: "测试描述", image: "/hextech/e.png", tags: [], answer: "法术连打" }
];

test("generateOptions includes answer, avoids duplicates and respects count", () => {
  const options = generateOptions(cards, 3, 4, () => 0.42);
  assert.equal(options.length, 4);
  assert.equal(new Set(options.map((item) => item.id)).size, 4);
  assert.ok(options.some((item) => item.id === 3));

  const allOptions = generateOptions(cards, 3, 999, () => 0.42);
  assert.equal(allOptions.length, cards.length);
  assert.equal(new Set(allOptions.map((item) => item.id)).size, cards.length);
});

test("validateClue accepts two-syllable Chinese and short game terms", () => {
  assert.equal(validateClue("叠层", "星界躯体").valid, true);
  assert.equal(validateClue("平A", "星界躯体").valid, true);
  assert.equal(validateClue("平a", "星界躯体").valid, true);
  assert.equal(validateClue("A1", "星界躯体").valid, true);
  assert.equal(validateClue("1a", "星界躯体").valid, true);
  assert.equal(validateClue("aB", "星界躯体").valid, true);
  assert.equal(validateClue("叠8", "星界躯体").valid, true);
  assert.equal(validateClue("", "星界躯体").valid, false);
  assert.equal(validateClue("星火", "星界躯体").valid, false);
  assert.equal(validateClue("过长提示词", "星界躯体").valid, false);
  assert.equal(validateClue("平AA", "星界躯体").valid, false);
  assert.equal(validateClue("平-", "星界躯体").valid, false);
});

test("pickRandomCard prefers cards with fewer appearances", () => {
  assert.equal(pickRandomCard(cards, { 1: 2, 2: 1, 3: 1, 4: 0, 5: 0 }, () => 0).id, 4);
  assert.equal(pickRandomCard(cards, { 1: 2, 2: 1, 3: 1, 4: 0, 5: 0 }, () => 0.99).id, 5);
  assert.notEqual(pickRandomCard(cards, {}, () => 0, [1]).id, 1);
});

test("nextTeam swaps first mover between teams", () => {
  assert.equal(nextTeam("A"), "B");
  assert.equal(nextTeam("B"), "A");
});

test("room flow switches turn after wrong guess and finishes round after correct guess", () => {
  const store = new RoomStore(cards);
  const room = store.createRoom({ clientId: "admin", nickname: "夏如霜", role: "admin", socketId: "s0" });
  store.joinRoom({ roomId: room.id, clientId: "a1", nickname: "A提", role: "contestant", socketId: "s1" });
  store.joinRoom({ roomId: room.id, clientId: "a2", nickname: "A猜", role: "contestant", socketId: "s2" });
  store.joinRoom({ roomId: room.id, clientId: "b1", nickname: "B提", role: "contestant", socketId: "s3" });
  store.joinRoom({ roomId: room.id, clientId: "b2", nickname: "B猜", role: "contestant", socketId: "s4" });
  store.assignPlayer("admin", "a1", { role: "contestant", team: "A", seatRole: "clue_giver" });
  store.assignPlayer("admin", "a2", { role: "contestant", team: "A", seatRole: "guesser" });
  store.assignPlayer("admin", "b1", { role: "contestant", team: "B", seatRole: "clue_giver" });
  store.assignPlayer("admin", "b2", { role: "contestant", team: "B", seatRole: "guesser" });
  store.updateSettings("admin", { totalRounds: 2, optionCount: 3, autoNextRound: false });
  assert.equal(store.getRoom(room.id).settings.optionCount, cards.length);

  store.startGame("admin");
  assert.equal(store.getRoom(room.id).currentOptions.length, cards.length);
  const firstTeam = store.getRoom(room.id).currentTurnTeam;
  const firstClue = firstTeam === "A" ? "a1" : "b1";
  const firstGuesser = firstTeam === "A" ? "a2" : "b2";
  const wrongOption = store.getRoom(room.id).currentOptions.find((option) => option.id !== store.getRoom(room.id).currentCard.id);

  store.submitClue(firstClue, "护盾");
  const clueGiverState = store.getClientState(room.id, firstClue);
  const guesserState = store.getClientState(room.id, firstGuesser);
  assert.deepEqual(guesserState.clueHistory.map((item) => item.clue), ["护盾"]);
  assert.equal(guesserState.currentOptions.length, cards.length);
  assert.ok(guesserState.currentOptions.every((option) => option.rarity));
  assert.ok(guesserState.currentOptions.every((option) => option.description));
  assert.equal(guesserState.currentCard.rarity, null);
  assert.equal(clueGiverState.currentOptions.length, cards.length);
  assert.ok(clueGiverState.currentOptions.every((option) => option.rarity));
  assert.equal(clueGiverState.currentCard.rarity, store.getRoom(room.id).currentCard.rarity);
  store.setOptionQualityFilter(firstGuesser, "黄金");
  const filteredGuesserState = store.getClientState(room.id, firstGuesser);
  assert.equal(filteredGuesserState.currentOptionTotal, cards.length);
  assert.equal(filteredGuesserState.optionQualityFilter, "黄金");
  assert.ok(filteredGuesserState.currentOptions.length > 0);
  assert.ok(filteredGuesserState.currentOptions.every((option) => option.rarity === "黄金"));
  assert.equal(filteredGuesserState.currentCard.rarity, null);
  store.submitGuess(firstGuesser, wrongOption.id);
  // With only one guesser per team, wrong answer means all guessers tried → switch turn
  assert.equal(store.getRoom(room.id).currentTurnTeam, nextTeam(firstTeam));
  assert.equal(store.getRoom(room.id).phase, "clue");
  assert.equal(store.getClientState(room.id, firstGuesser).optionQualityFilter, "");
  assert.deepEqual(store.getRoom(room.id).clueHistory.map((item) => item.clue), ["护盾"]);
  store.setOptionQualityFilter(firstGuesser, "白银");
  const waitingGuesserState = store.getClientState(room.id, firstGuesser);
  assert.equal(waitingGuesserState.optionQualityFilter, "白银");
  assert.ok(waitingGuesserState.currentOptions.every((option) => option.rarity === "白银"));

  const secondTeam = store.getRoom(room.id).currentTurnTeam;
  const secondClue = secondTeam === "A" ? "a1" : "b1";
  const secondGuesser = secondTeam === "A" ? "a2" : "b2";
  const answerId = store.getRoom(room.id).currentCard.id;

  store.submitClue(secondClue, "叠层");
  assert.deepEqual(store.getClientState(room.id, secondGuesser).clueHistory.map((item) => item.clue), ["护盾", "叠层"]);
  store.submitGuess(secondGuesser, answerId);
  assert.equal(store.getRoom(room.id).phase, "round_over");
  assert.equal(store.getRoom(room.id).score[secondTeam], 1);

  const nextFirst = nextTeam(store.getRoom(room.id).firstTeam);
  store.adminNextRound("admin");
  assert.equal(store.getRoom(room.id).firstTeam, nextFirst);
  store.clearTimers(store.getRoom(room.id));
});

test("admin can replace the current card without advancing the round", () => {
  const store = new RoomStore(cards);
  const room = store.createRoom({ clientId: "admin", nickname: "夏如霜", role: "admin", socketId: "s0" });
  store.joinRoom({ roomId: room.id, clientId: "a1", nickname: "A提", role: "contestant", socketId: "s1" });
  store.joinRoom({ roomId: room.id, clientId: "a2", nickname: "A猜", role: "contestant", socketId: "s2" });
  store.joinRoom({ roomId: room.id, clientId: "b1", nickname: "B提", role: "contestant", socketId: "s3" });
  store.joinRoom({ roomId: room.id, clientId: "b2", nickname: "B猜", role: "contestant", socketId: "s4" });
  store.assignPlayer("admin", "a1", { role: "contestant", team: "A", seatRole: "clue_giver" });
  store.assignPlayer("admin", "a2", { role: "contestant", team: "A", seatRole: "guesser" });
  store.assignPlayer("admin", "b1", { role: "contestant", team: "B", seatRole: "clue_giver" });
  store.assignPlayer("admin", "b2", { role: "contestant", team: "B", seatRole: "guesser" });

  store.startGame("admin");
  const before = store.getRoom(room.id);
  const firstCardId = before.currentCard.id;
  const firstTeam = before.firstTeam;
  const clueGiver = firstTeam === "A" ? "a1" : "b1";
  store.submitClue(clueGiver, "zz");

  const changed = store.adminChangeCard("admin");

  assert.equal(changed.currentRound, 1);
  assert.notEqual(changed.currentCard.id, firstCardId);
  assert.equal(changed.phase, "clue");
  assert.equal(changed.currentTurnTeam, firstTeam);
  assert.deepEqual(changed.clueHistory, []);
  assert.deepEqual(changed.roundTurns, []);
  assert.equal(changed.currentOptions.length, cards.length);
  assert.equal(changed.cardUsageCounts[String(firstCardId)], 1);
  assert.equal(changed.cardUsageCounts[String(changed.currentCard.id)], 1);
  store.clearTimers(changed);
});

test("answer options are sorted by Chinese pinyin", () => {
  const options = generateOptions(cards, 3, 999, () => 0.42);
  assert.deepEqual(options.map((item) => item.name), ["法术连打", "火力全开", "巨像勇气", "闪现升级", "星界躯体"]);
});

test("new rooms default to all cards as answer options", () => {
  const store = new RoomStore(cards);
  const room = store.createRoom({ clientId: "admin", nickname: "夏如霜", role: "admin", socketId: "s0" });
  store.joinRoom({ roomId: room.id, clientId: "a1", nickname: "A提", role: "contestant", socketId: "s1" });
  store.joinRoom({ roomId: room.id, clientId: "a2", nickname: "A猜", role: "contestant", socketId: "s2" });
  store.joinRoom({ roomId: room.id, clientId: "b1", nickname: "B提", role: "contestant", socketId: "s3" });
  store.joinRoom({ roomId: room.id, clientId: "b2", nickname: "B猜", role: "contestant", socketId: "s4" });
  store.assignPlayer("admin", "a1", { role: "contestant", team: "A", seatRole: "clue_giver" });
  store.assignPlayer("admin", "a2", { role: "contestant", team: "A", seatRole: "guesser" });
  store.assignPlayer("admin", "b1", { role: "contestant", team: "B", seatRole: "clue_giver" });
  store.assignPlayer("admin", "b2", { role: "contestant", team: "B", seatRole: "guesser" });

  assert.equal(store.getRoom(room.id).settings.optionCount, cards.length);
  assert.equal(store.getRoom(room.id).settings.allowSpectatorsSeeAnswer, true);
  store.startGame("admin");
  assert.equal(store.getRoom(room.id).currentOptions.length, cards.length);
  store.clearTimers(store.getRoom(room.id));
});

test("anime mode creates a fresh 200-title candidate pool with Bangumi details", () => {
  const animeCards = Array.from({ length: 240 }, (_, index) => ({
    id: 10000 + index,
    mode: "anime",
    rank: index + 1,
    name: `动画作品${String(index + 1).padStart(3, "0")}`,
    rarity: index % 2 ? "热门" : "高分",
    description: `动画测试描述${index + 1}`,
    image: `/anime/covers/${index + 1}.jpg`,
    tags: [index % 2 ? "校园" : "科幻", "TV"],
    answer: `动画作品${String(index + 1).padStart(3, "0")}`,
    url: `https://bgm.tv/subject/${10000 + index}`,
    date: "2024-01-01",
    score: 8.1,
    totalVotes: 1200,
    characters: [{ id: index + 1, name: `角色${index + 1}`, url: `https://bgm.tv/character/${index + 1}` }]
  }));
  const store = new RoomStore({ hextech: cards, anime: animeCards });
  const room = store.createRoom({ clientId: "admin", nickname: "夏如霜", role: "admin", socketId: "s0", gameMode: "anime" });
  store.joinRoom({ roomId: room.id, clientId: "a1", nickname: "A提", role: "contestant", socketId: "s1" });
  store.joinRoom({ roomId: room.id, clientId: "a2", nickname: "A猜", role: "contestant", socketId: "s2" });
  store.joinRoom({ roomId: room.id, clientId: "b1", nickname: "B提", role: "contestant", socketId: "s3" });
  store.joinRoom({ roomId: room.id, clientId: "b2", nickname: "B猜", role: "contestant", socketId: "s4" });
  store.assignPlayer("admin", "a1", { role: "contestant", team: "A", seatRole: "clue_giver" });
  store.assignPlayer("admin", "a2", { role: "contestant", team: "A", seatRole: "guesser" });
  store.assignPlayer("admin", "b1", { role: "contestant", team: "B", seatRole: "clue_giver" });
  store.assignPlayer("admin", "b2", { role: "contestant", team: "B", seatRole: "guesser" });
  store.updateSettings("admin", { totalRounds: 2, autoNextRound: false });

  assert.equal(store.getRoom(room.id).gameMode, "anime");
  assert.equal(store.getRoom(room.id).settings.optionCount, 200);
  store.startGame("admin");

  const started = store.getRoom(room.id);
  assert.equal(started.currentOptions.length, 200);
  assert.ok(started.currentOptions.every((option) => option.mode === "anime"));
  assert.ok(started.currentOptions.some((option) => option.id === started.currentCard.id));
  assert.ok(started.currentOptions.every((option) => option.url?.startsWith("https://bgm.tv/subject/")));
  assert.ok(started.currentOptions.every((option) => option.tags.length > 0));

  const clueGiver = started.currentTurnTeam === "A" ? "a1" : "b1";
  const guesser = started.currentTurnTeam === "A" ? "a2" : "b2";
  const clueGiverState = store.getClientState(room.id, clueGiver);
  const guesserState = store.getClientState(room.id, guesser);
  assert.equal(clueGiverState.currentCard.url, started.currentCard.url);
  assert.equal(guesserState.currentCard.name, "答案已隐藏");
  assert.equal(guesserState.currentOptions.length, 200);
  assert.ok(guesserState.currentOptions.every((option) => option.characters.length > 0));
  store.clearTimers(started);
});

test("game mode creates a fresh 200-game candidate pool with Chinese and English names", () => {
  const gameCards = Array.from({ length: 240 }, (_, index) => ({
    id: 700000 + index,
    mode: "game",
    rank: index + 1,
    name: `游戏作品${String(index + 1).padStart(3, "0")}`,
    chineseName: `游戏作品${String(index + 1).padStart(3, "0")}`,
    englishName: `Game Title ${String(index + 1).padStart(3, "0")}`,
    rarity: index % 2 ? "热门" : "高分",
    description: `游戏测试描述${index + 1}`,
    image: `/game/covers/${index + 1}.jpg`,
    tags: [index % 2 ? "动作" : "策略", "PC"],
    answer: `游戏作品${String(index + 1).padStart(3, "0")}`,
    url: `https://example.com/game/${700000 + index}`,
    date: "2024-08-20",
    score: 8.3,
    totalVotes: 0,
    aliases: [`Game Title ${String(index + 1).padStart(3, "0")}`],
    platforms: ["PC", "PS5"],
    characters: [{ id: 1, name: "PC", url: "" }, { id: 2, name: "PS5", url: "" }]
  }));
  const store = new RoomStore({ hextech: cards, anime: cards, game: gameCards });
  const room = store.createRoom({ clientId: "admin", nickname: "夏如霜", role: "admin", socketId: "s0", gameMode: "game" });
  store.joinRoom({ roomId: room.id, clientId: "a1", nickname: "A提", role: "contestant", socketId: "s1" });
  store.joinRoom({ roomId: room.id, clientId: "a2", nickname: "A猜", role: "contestant", socketId: "s2" });
  store.joinRoom({ roomId: room.id, clientId: "b1", nickname: "B提", role: "contestant", socketId: "s3" });
  store.joinRoom({ roomId: room.id, clientId: "b2", nickname: "B猜", role: "contestant", socketId: "s4" });
  store.assignPlayer("admin", "a1", { role: "contestant", team: "A", seatRole: "clue_giver" });
  store.assignPlayer("admin", "a2", { role: "contestant", team: "A", seatRole: "guesser" });
  store.assignPlayer("admin", "b1", { role: "contestant", team: "B", seatRole: "clue_giver" });
  store.assignPlayer("admin", "b2", { role: "contestant", team: "B", seatRole: "guesser" });
  store.updateSettings("admin", { totalRounds: 2, autoNextRound: false });

  assert.equal(store.getRoom(room.id).gameMode, "game");
  assert.equal(store.getRoom(room.id).settings.optionCount, 200);
  store.startGame("admin");

  const started = store.getRoom(room.id);
  assert.equal(started.currentOptions.length, 200);
  assert.ok(started.currentOptions.every((option) => option.mode === "game"));
  assert.ok(started.currentOptions.some((option) => option.id === started.currentCard.id));
  assert.ok(started.currentOptions.every((option) => option.chineseName?.startsWith("游戏作品")));
  assert.ok(started.currentOptions.every((option) => option.englishName?.startsWith("Game Title")));
  assert.ok(started.currentOptions.every((option) => option.platforms.includes("PC")));

  const clueGiver = started.currentTurnTeam === "A" ? "a1" : "b1";
  const guesser = started.currentTurnTeam === "A" ? "a2" : "b2";
  const clueGiverState = store.getClientState(room.id, clueGiver);
  const guesserState = store.getClientState(room.id, guesser);
  assert.equal(clueGiverState.currentCard.mode, "game");
  assert.ok(clueGiverState.currentCard.chineseName.startsWith("游戏作品"));
  assert.ok(clueGiverState.currentCard.englishName.startsWith("Game Title"));
  assert.equal(guesserState.currentCard.name, "答案已隐藏");
  assert.equal(guesserState.currentOptions.length, 200);
  assert.ok(guesserState.currentOptions.every((option) => option.mode === "game"));
  store.clearTimers(started);
});

test("childhood mode creates a fresh 200-cartoon candidate pool with Douban details", () => {
  const childhoodCards = Array.from({ length: 240 }, (_, index) => ({
    id: 800000 + index,
    mode: "childhood",
    rank: index + 1,
    name: `童年动画${String(index + 1).padStart(3, "0")}`,
    chineseName: `童年动画${String(index + 1).padStart(3, "0")}`,
    englishName: "",
    rarity: index % 2 ? "热门" : "高分",
    description: `童年动画测试描述${index + 1}`,
    image: `/childhood/covers/${index + 1}.webp`,
    tags: [index % 2 ? "儿童" : "动画", "剧集"],
    answer: `童年动画${String(index + 1).padStart(3, "0")}`,
    url: `https://movie.douban.com/subject/${3200000 + index}/`,
    date: "2006",
    score: 9.1,
    totalVotes: 120000,
    aliases: [],
    characters: [{ id: 1, name: "相关人物", url: "" }]
  }));
  const store = new RoomStore({ hextech: cards, anime: cards, game: cards, childhood: childhoodCards });
  const room = store.createRoom({ clientId: "admin", nickname: "夏如霜", role: "admin", socketId: "s0", gameMode: "childhood" });
  store.joinRoom({ roomId: room.id, clientId: "a1", nickname: "A提", role: "contestant", socketId: "s1" });
  store.joinRoom({ roomId: room.id, clientId: "a2", nickname: "A猜", role: "contestant", socketId: "s2" });
  store.joinRoom({ roomId: room.id, clientId: "b1", nickname: "B提", role: "contestant", socketId: "s3" });
  store.joinRoom({ roomId: room.id, clientId: "b2", nickname: "B猜", role: "contestant", socketId: "s4" });
  store.assignPlayer("admin", "a1", { role: "contestant", team: "A", seatRole: "clue_giver" });
  store.assignPlayer("admin", "a2", { role: "contestant", team: "A", seatRole: "guesser" });
  store.assignPlayer("admin", "b1", { role: "contestant", team: "B", seatRole: "clue_giver" });
  store.assignPlayer("admin", "b2", { role: "contestant", team: "B", seatRole: "guesser" });
  store.updateSettings("admin", { totalRounds: 2, autoNextRound: false });

  assert.equal(store.getRoom(room.id).gameMode, "childhood");
  assert.equal(store.getRoom(room.id).settings.optionCount, 200);
  store.startGame("admin");

  const started = store.getRoom(room.id);
  assert.equal(started.currentOptions.length, 200);
  assert.ok(started.currentOptions.every((option) => option.mode === "childhood"));
  assert.ok(started.currentOptions.some((option) => option.id === started.currentCard.id));
  assert.ok(started.currentOptions.every((option) => option.url?.startsWith("https://movie.douban.com/subject/")));
  assert.ok(started.currentOptions.every((option) => option.tags.length > 0));

  const clueGiver = started.currentTurnTeam === "A" ? "a1" : "b1";
  const guesser = started.currentTurnTeam === "A" ? "a2" : "b2";
  const clueGiverState = store.getClientState(room.id, clueGiver);
  const guesserState = store.getClientState(room.id, guesser);
  assert.equal(clueGiverState.currentCard.mode, "childhood");
  assert.equal(clueGiverState.currentCard.url, started.currentCard.url);
  assert.equal(guesserState.currentCard.name, "答案已隐藏");
  assert.equal(guesserState.currentOptions.length, 200);
  assert.ok(guesserState.currentOptions.every((option) => option.characters.length > 0));
  store.clearTimers(started);
});

test("rooms support uneven teams with up to four guessers per team", () => {
  const store = new RoomStore(cards);
  const room = store.createRoom({ clientId: "admin", nickname: "夏如霜", role: "admin", socketId: "s0" });
  for (const [id, nickname] of [
    ["a1", "A提"],
    ["a2", "A猜"],
    ["b1", "B提"],
    ["b2", "B猜1"],
    ["b3", "B猜2"],
    ["b4", "B猜3"],
    ["b5", "B猜4"],
    ["b6", "B猜5"]
  ]) {
    store.joinRoom({ roomId: room.id, clientId: id, nickname, role: "spectator", socketId: id });
  }

  store.assignPlayer("admin", "a1", { role: "contestant", team: "A", seatRole: "clue_giver" });
  store.assignPlayer("admin", "a2", { role: "contestant", team: "A", seatRole: "guesser" });
  store.assignPlayer("admin", "b1", { role: "contestant", team: "B", seatRole: "clue_giver" });
  store.assignPlayer("admin", "b2", { role: "contestant", team: "B", seatRole: "guesser" });
  store.assignPlayer("admin", "b3", { role: "contestant", team: "B", seatRole: "guesser" });
  store.assignPlayer("admin", "b4", { role: "contestant", team: "B", seatRole: "guesser" });
  store.assignPlayer("admin", "b5", { role: "contestant", team: "B", seatRole: "guesser" });
  assert.throws(
    () => store.assignPlayer("admin", "b6", { role: "contestant", team: "B", seatRole: "guesser" }),
    /最多/
  );

  store.updateSettings("admin", { totalRounds: 2, autoNextRound: false });
  store.startGame("admin");
  const started = store.getRoom(room.id);
  const activeTeam = started.currentTurnTeam;
  const clueGiver = activeTeam === "A" ? "a1" : "b1";
  const guesser = activeTeam === "A" ? "a2" : "b3";
  store.submitClue(clueGiver, "护盾");
  store.submitGuess(guesser, started.currentCard.id);
  assert.equal(store.getRoom(room.id).score[activeTeam], 1);
  assert.equal(store.getRoom(room.id).phase, "round_over");
  store.clearTimers(store.getRoom(room.id));
});

test("admin assignment keeps one player per team seat", () => {
  const store = new RoomStore(cards);
  const room = store.createRoom({ clientId: "admin", nickname: "夏如霜", role: "admin", socketId: "s0" });
  store.joinRoom({ roomId: room.id, clientId: "a1", nickname: "A提1", role: "contestant", socketId: "s1" });
  store.joinRoom({ roomId: room.id, clientId: "a2", nickname: "A提2", role: "contestant", socketId: "s2" });
  store.assignPlayer("admin", "a1", { role: "contestant", team: "A", seatRole: "clue_giver" });
  store.assignPlayer("admin", "a2", { role: "contestant", team: "A", seatRole: "clue_giver" });

  const seats = store.getRoom(room.id).players.filter((player) => player.team === "A" && player.seatRole === "clue_giver");
  assert.equal(seats.length, 1);
  assert.equal(seats[0].id, "a2");
});

test("taking the same seat twice is idempotent", () => {
  const store = new RoomStore(cards);
  const room = store.createRoom({ clientId: "player", nickname: "Player", role: "spectator", socketId: "s0" });

  store.setPlayerSeat("player", { team: "B", seatRole: "guesser" });
  const player = store.getRoom(room.id).players.find((item) => item.id === "player");
  player.ready = true;
  const messageCount = store.getRoom(room.id).messages.length;

  store.setPlayerSeat("player", { team: "B", seatRole: "guesser" });

  assert.equal(player.ready, true);
  assert.equal(store.getRoom(room.id).messages.length, messageCount);
  assert.equal(player.team, "B");
  assert.equal(player.seatRole, "guesser");
});

test("joining a waiting room prunes stale disconnected players", () => {
  const store = new RoomStore(cards);
  const room = store.createRoom({ clientId: "old-admin", nickname: "夏如霜", role: "admin", socketId: "s0" });
  store.joinRoom({ roomId: room.id, clientId: "old-player", nickname: "旧玩家", role: "contestant", socketId: "s1" });

  store.disconnect("old-admin");
  store.disconnect("old-player");
  const joined = store.joinRoom({ roomId: room.id, clientId: "new-admin", nickname: "新主持", role: "spectator", socketId: "s2" });

  assert.deepEqual(joined.players.map((player) => player.id), ["new-admin"]);
  assert.equal(joined.adminId, "new-admin");
  assert.equal(store.getRoomByPlayer("old-admin"), null);
  assert.equal(store.getRoomByPlayer("old-player"), null);
});

test("leaveRoom removes a waiting-room host and transfers admin ownership", () => {
  const store = new RoomStore(cards);
  const room = store.createRoom({ clientId: "admin", nickname: "夏如霜", role: "admin", socketId: "s0" });
  store.joinRoom({ roomId: room.id, clientId: "guest", nickname: "观众", role: "spectator", socketId: "s1" });

  const updated = store.leaveRoom("admin");

  assert.equal(updated.players.some((player) => player.id === "admin"), false);
  assert.equal(updated.players.some((player) => player.id === "guest"), true);
  assert.equal(updated.adminId, "guest");
  assert.equal(store.getRoomByPlayer("admin"), null);
});

test("first player in the room receives host permissions", () => {
  const store = new RoomStore(cards);
  const room = store.createRoom({ clientId: "guest", nickname: "普通玩家", role: "admin", socketId: "s0" });

  assert.equal(room.adminId, "guest");
  assert.equal(room.players[0].role, "admin");
  assert.equal(store.getClientState(room.id, "guest").me.isAdmin, true);

  const updated = store.joinRoom({ roomId: room.id, clientId: "host", nickname: "夏如霜", role: "spectator", socketId: "s1" });

  assert.equal(updated.adminId, "guest");
  assert.equal(store.getClientState(room.id, "host").me.isAdmin, false);
  assert.equal(store.getClientState(room.id, "guest").me.isAdmin, true);
});

test("multiple guessers on same team can guess sequentially, wrong answer does not switch turn until all guessed", () => {
  const store = new RoomStore(cards);
  const room = store.createRoom({ clientId: "admin", nickname: "夏如霜", role: "admin", socketId: "s0" });
  store.joinRoom({ roomId: room.id, clientId: "a1", nickname: "A提", role: "contestant", socketId: "s1" });
  store.joinRoom({ roomId: room.id, clientId: "a2", nickname: "A猜1", role: "contestant", socketId: "s2" });
  store.joinRoom({ roomId: room.id, clientId: "a3", nickname: "A猜2", role: "contestant", socketId: "s3" });
  store.joinRoom({ roomId: room.id, clientId: "b1", nickname: "B提", role: "contestant", socketId: "s4" });
  store.joinRoom({ roomId: room.id, clientId: "b2", nickname: "B猜", role: "contestant", socketId: "s5" });
  store.assignPlayer("admin", "a1", { role: "contestant", team: "A", seatRole: "clue_giver" });
  store.assignPlayer("admin", "a2", { role: "contestant", team: "A", seatRole: "guesser" });
  store.assignPlayer("admin", "a3", { role: "contestant", team: "A", seatRole: "guesser" });
  store.assignPlayer("admin", "b1", { role: "contestant", team: "B", seatRole: "clue_giver" });
  store.assignPlayer("admin", "b2", { role: "contestant", team: "B", seatRole: "guesser" });
  store.updateSettings("admin", { totalRounds: 2, optionCount: 3, autoNextRound: false });
  assert.equal(store.getRoom(room.id).settings.optionCount, cards.length);

  store.startGame("admin");
  const firstTeam = store.getRoom(room.id).currentTurnTeam;

  // If A goes first, test the multi-guesser logic
  if (firstTeam === "A") {
    const wrongOption = store.getRoom(room.id).currentOptions.find((option) => option.id !== store.getRoom(room.id).currentCard.id);
    const answerId = store.getRoom(room.id).currentCard.id;

    store.submitClue("a1", "护盾");
    assert.equal(store.getRoom(room.id).phase, "guess");

    // A猜1 answers wrong — should NOT switch turn (A猜2 still hasn't guessed)
    store.submitGuess("a2", wrongOption.id);
    assert.equal(store.getRoom(room.id).currentTurnTeam, "A");
    assert.equal(store.getRoom(room.id).phase, "guess");
    assert.deepEqual(store.getClientState(room.id, "a2").guessedPlayerIds, ["a2"]);

    // Same person can't guess again
    assert.throws(() => store.submitGuess("a2", wrongOption.id), /已经提交过/);

    // A猜2 answers correctly
    store.submitGuess("a3", answerId);
    assert.equal(store.getRoom(room.id).phase, "round_over");
    assert.equal(store.getRoom(room.id).score["A"], 1);
  } else {
    // B goes first, only one guesser — wrong answer switches turn
    const wrongOption = store.getRoom(room.id).currentOptions.find((option) => option.id !== store.getRoom(room.id).currentCard.id);

    store.submitClue("b1", "护盾");
    store.submitGuess("b2", wrongOption.id);
    assert.equal(store.getRoom(room.id).currentTurnTeam, "A");
    assert.equal(store.getRoom(room.id).phase, "clue");

    // Now A's turn with 2 guessers
    const answerId = store.getRoom(room.id).currentCard.id;
    store.submitClue("a1", "叠层");
    store.submitGuess("a2", wrongOption.id);
    // A猜1 wrong, but A猜2 still can guess
    assert.equal(store.getRoom(room.id).currentTurnTeam, "A");
    assert.equal(store.getRoom(room.id).phase, "guess");
    store.submitGuess("a3", answerId);
    assert.equal(store.getRoom(room.id).phase, "round_over");
    assert.equal(store.getRoom(room.id).score["A"], 1);
  }

  store.clearTimers(store.getRoom(room.id));
});

