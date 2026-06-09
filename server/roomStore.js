import {
  buildTurn,
  clampSettings,
  createRoomState,
  finishRound,
  generateOptions,
  isGameComplete,
  nextTeam,
  pickRandomCard,
  sortPlayers,
  validateClue
} from "./gameLogic.js";

export const DEFAULT_ROOM_ID = "TEST";
export const FIXED_ROOM_IDS = ["TEST"];
export const HOST_NICKNAME = "管理员";

const NEXT_ROUND_DELAY_MS = 2200;
const TEAM_NAMES = {
  A: "迅捷蟹队",
  B: "石甲虫队"
};
const OPTION_QUALITY_FILTERS = new Set(["白银", "黄金", "棱彩"]);
const GAME_MODES = new Set(["hextech", "anime", "game", "childhood"]);
const RANDOM_CANDIDATE_COUNT = 200;
const RANDOM_CANDIDATE_MODES = new Set(["anime", "game", "childhood"]);
const TEAMS = ["A", "B"];
const MAX_TEAM_PLAYERS = 5;
const MAX_TEAM_GUESSERS = MAX_TEAM_PLAYERS - 1;
const MAX_CONTESTANTS = MAX_TEAM_PLAYERS * TEAMS.length;
const GAME_MODE_LABELS = {
  hextech: "海克斯玩法",
  anime: "谁是动漫糕手？",
  game: "提示位别红温",
  childhood: "不想长大"
};

export class RoomStore {
  constructor(cardCatalogs) {
    this.cardCatalogs = normalizeCardCatalogs(cardCatalogs);
    this.cards = this.cardCatalogs.hextech;
    this.rooms = new Map();
    this.playerToRoom = new Map();
    this.onRoomChange = null;

    for (const roomId of FIXED_ROOM_IDS) {
      this.rooms.set(roomId, this.createDefaultRoom(roomId));
    }
  }

  setChangeHandler(handler) {
    this.onRoomChange = handler;
  }

  createRoom({ clientId, nickname, role, socketId, gameMode, accessUser }) {
    const room = this.ensureRoom(DEFAULT_ROOM_ID);
    this.pruneWaitingRoom(room, { keepClientId: clientId });
    this.applyRequestedGameMode(room, gameMode, nickname, accessUser);
    this.assertRoleAvailable(room, role, clientId);
    const player = this.addOrUpdatePlayer(room, { clientId, nickname, role, socketId, accessUser });
    this.addMessage(room, `${player.nickname} 进入了房间`);
    this.touch(room);
    return room;
  }

  joinRoom({ roomId, clientId, nickname, role, socketId, gameMode, accessUser }) {
    const room = this.ensureRoom(roomId || DEFAULT_ROOM_ID);
    this.pruneWaitingRoom(room, { keepClientId: clientId });
    this.applyRequestedGameMode(room, gameMode, nickname, accessUser);
    this.assertRoleAvailable(room, role, clientId);
    const player = this.addOrUpdatePlayer(room, { clientId, nickname, role, socketId, accessUser });
    this.addMessage(room, `${player.nickname} 加入了房间`);
    this.touch(room);
    return room;
  }

  reconnect({ roomId, clientId, socketId }) {
    const room = this.requireRoom(roomId || DEFAULT_ROOM_ID);
    const player = this.requirePlayer(room, clientId);
    this.pruneWaitingRoom(room, { keepClientId: clientId });
    player.socketId = socketId;
    player.online = true;
    this.ensureAdmin(room, clientId);
    this.playerToRoom.set(clientId, room.id);
    this.addMessage(room, `${player.nickname} 已重新连接`);
    this.touch(room);
    return room;
  }

  leaveRoom(clientId) {
    const roomId = this.playerToRoom.get(clientId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = room.players.find((item) => item.id === clientId);
    if (!player) return null;

    this.playerToRoom.delete(clientId);
    player.socketId = null;
    player.online = false;
    player.ready = false;

    if (room.status === "waiting") {
      room.players = room.players.filter((item) => item.id !== clientId);
      if (room.adminId === clientId) room.adminId = null;
      this.ensureAdmin(room);
    }

    this.addMessage(room, `${player.nickname} 离开了房间`);
    this.touch(room);

    // 如果没有任何在线玩家，销毁房间
    const allOffline = room.players.every((p) => !p.online);
    if (allOffline) {
      for (const p of room.players) {
        this.playerToRoom.delete(p.id);
      }
      this.rooms.delete(room.id);
    }

    return room;
  }

  disconnect(clientId) {
    const roomId = this.playerToRoom.get(clientId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = room.players.find((item) => item.id === clientId);
    if (!player) return null;
    player.online = false;
    player.socketId = null;
    if (room.status === "waiting") player.ready = false;
    this.addMessage(room, `${player.nickname} 断开连接`);
    this.touch(room);

    // 如果没有任何在线玩家，销毁房间
    const allOffline = room.players.every((p) => !p.online);
    if (allOffline) {
      for (const p of room.players) {
        this.playerToRoom.delete(p.id);
      }
      this.rooms.delete(room.id);
    }

    return room;
  }

  updateSettings(adminId, patch) {
    const room = this.requirePlayerRoom(adminId);
    this.assertAdmin(room, adminId);
    const previousMode = room.gameMode;
    if (patch?.gameMode) {
      this.setRoomGameMode(room, patch.gameMode);
    }
    room.settings = this.withAllCandidateOptions(clampSettings({ ...room.settings, ...patch }), room.gameMode);
    if (previousMode !== room.gameMode) {
      this.addMessage(room, `主持人切换玩法为${gameModeLabel(room.gameMode)}`);
    } else {
      this.addMessage(room, "主持人更新了游戏设置");
    }
    this.touch(room);
    return room;
  }

  assignPlayer(adminId, targetId, assignment) {
    const room = this.requirePlayerRoom(adminId);
    this.assertAdmin(room, adminId);
    const player = this.requirePlayer(room, targetId);

    const nextRole = assignment.role ?? player.role;
    const nextTeam = assignment.team ?? player.team;
    const nextSeatRole = assignment.seatRole ?? player.seatRole;
    if (nextRole === "admin" && !isHostPlayer(player)) {
      throw new Error("需要主持人口令才能成为主持人");
    }
    this.assertRoleAvailable(room, nextRole, targetId);
    const cleanTeam = nextTeam === "A" || nextTeam === "B" ? nextTeam : null;
    const cleanSeatRole = nextSeatRole === "clue_giver" || nextSeatRole === "guesser" ? nextSeatRole : null;
    if (nextRole === "contestant" && cleanTeam && cleanSeatRole) {
      this.assertSeatCapacity(room, player, cleanTeam, cleanSeatRole);
    }

    const changesSeat =
      nextRole !== player.role ||
      nextTeam !== player.team ||
      nextSeatRole !== player.seatRole;
    if (changesSeat && room.status !== "waiting") {
      throw new Error("比赛开始后不能调整玩家席位");
    }

    if (nextRole !== "contestant") {
      player.team = null;
      player.seatRole = null;
      player.role = nextRole === "admin" ? "admin" : "spectator";
      player.ready = false;
    } else {
      player.role = "contestant";
      player.team = cleanTeam;
      player.seatRole = cleanSeatRole;
      player.ready = false;
      if (player.team && player.seatRole) {
        if (player.seatRole === "clue_giver") this.releaseExistingClueGiver(room, player.id, player.team);
      }
    }

    if (nextRole === "admin" && isHostPlayer(player) && (!room.adminId || room.adminId === player.id)) {
      room.adminId = player.id;
    }
    this.ensureAdmin(room, targetId);

    this.addMessage(room, `主持人调整了 ${player.nickname} 的席位`);
    this.maybeAutoStart(room);
    this.touch(room);
    return room;
  }

  setPlayerSeat(clientId, assignment) {
    const room = this.requirePlayerRoom(clientId);
    const player = this.requirePlayer(room, clientId);
    if (room.status !== "waiting") throw new Error("比赛开始后不能更换席位");

    const team = assignment.team === "A" || assignment.team === "B" ? assignment.team : null;
    const seatRole =
      assignment.seatRole === "clue_giver" || assignment.seatRole === "guesser"
        ? assignment.seatRole
        : null;
    if (!team || !seatRole) throw new Error("请选择有效席位");

    if (player.role === "contestant" && player.team === team && player.seatRole === seatRole) {
      return room;
    }

    if (seatRole === "clue_giver" && findClueGiver(room.players, team, player.id)) {
      throw new Error("这个席位已经有人了");
    }
    this.assertSeatCapacity(room, player, team, seatRole);

    this.assertRoleAvailable(room, "contestant", clientId);
    player.role = "contestant";
    player.team = team;
    player.seatRole = seatRole;
    player.ready = false;
    this.addMessage(room, `${player.nickname} 坐到了 ${teamName(team)}${seatLabel(seatRole)}`);
    this.touch(room);
    return room;
  }

  setSpectator(clientId) {
    const room = this.requirePlayerRoom(clientId);
    const player = this.requirePlayer(room, clientId);
    if (room.status !== "waiting" && player.role === "contestant") {
      throw new Error("比赛进行中不能离开参赛席位");
    }
    player.role = "spectator";
    player.team = null;
    player.seatRole = null;
    player.ready = false;
    this.addMessage(room, `${player.nickname} 切换为观众`);
    this.touch(room);
    return room;
  }

  setReady(clientId, ready) {
    const room = this.requirePlayerRoom(clientId);
    const player = this.requirePlayer(room, clientId);
    if (room.status !== "waiting") throw new Error("当前不能修改准备状态");
    if (player.role !== "contestant" || !player.team || !player.seatRole) {
      throw new Error("只有已经入座的参赛队员可以准备");
    }
    player.ready = Boolean(ready);
    this.addMessage(room, `${player.nickname} ${player.ready ? "已准备" : "取消准备"}`);
    this.maybeAutoStart(room);
    this.touch(room);
    return room;
  }

  kickPlayer(adminId, targetId) {
    const room = this.requirePlayerRoom(adminId);
    this.assertAdmin(room, adminId);
    const player = this.requirePlayer(room, targetId);
    room.players = room.players.filter((item) => item.id !== targetId);
    this.playerToRoom.delete(targetId);
    if (room.adminId === targetId) room.adminId = adminId;
    this.addMessage(room, `${player.nickname} 已被移出房间`);
    this.touch(room);
    return room;
  }

  startGame(adminId) {
    const room = this.requirePlayerRoom(adminId);
    this.assertAdmin(room, adminId);
    this.assertReady(room);
    this.startGameInternal(room);
    return room;
  }

  pauseGame(adminId) {
    const room = this.requirePlayerRoom(adminId);
    this.assertAdmin(room, adminId);
    if (room.status !== "playing") return room;
    room.status = "paused";
    room.pausedRemainingMs = Math.max(0, (room.turnEndsAt ?? Date.now()) - Date.now());
    this.clearTurnTimer(room);
    this.addMessage(room, "比赛已暂停");
    this.touch(room);
    return room;
  }

  resumeGame(adminId) {
    const room = this.requirePlayerRoom(adminId);
    this.assertAdmin(room, adminId);
    if (room.status !== "paused") return room;
    room.status = "playing";
    if (room.phase === "clue" || room.phase === "guess") {
      room.turnEndsAt = Date.now() + (room.pausedRemainingMs || room.settings.guessSeconds * 1000);
      this.scheduleTurnTimeout(room);
    }
    this.addMessage(room, "比赛已继续");
    this.touch(room);
    return room;
  }

  resetRoom(adminId) {
    const room = this.requirePlayerRoom(adminId);
    this.assertAdmin(room, adminId);
    this.clearTimers(room);
    const keepPlayers = room.players;
    const keepSettings = room.settings;
    const keepGameMode = room.gameMode;
    const keepCardUsageCounts = room.cardUsageCounts || {};
    const reset = createRoomState(room.id, room.adminId);
    reset.gameMode = keepGameMode;
    reset.players = keepPlayers.map((player) => {
      const isAdmin = player.id === room.adminId;
      return {
        ...player,
        role: isAdmin ? "admin" : "spectator",
        team: null,
        seatRole: null,
        ready: false,
        online: Boolean(player.online)
      };
    });
    reset.settings = this.withAllCandidateOptions(keepSettings, keepGameMode);
    reset.cardUsageCounts = { ...keepCardUsageCounts };
    reset.messages = [this.systemMessage("房间已重置")];
    this.rooms.set(room.id, reset);
    this.touch(reset);
    return reset;
  }

  adminNextRound(adminId) {
    const room = this.requirePlayerRoom(adminId);
    this.assertAdmin(room, adminId);
    if (room.phase !== "round_over") {
      throw new Error("当前不能进入下一局");
    }
    if (isGameComplete(room)) {
      room.status = "finished";
      room.phase = "finished";
      this.touch(room);
      return room;
    }
    this.startNextRound(room, nextTeam(room.firstTeam));
    return room;
  }

  adminChangeCard(adminId) {
    const room = this.requirePlayerRoom(adminId);
    this.assertAdmin(room, adminId);
    if (room.status !== "playing" || (room.phase !== "clue" && room.phase !== "guess")) {
      throw new Error("当前不能换题");
    }

    this.clearTimers(room);
    const previousCardId = room.currentCard?.id;
    const cards = this.getCandidateCards(room);
    const card = pickRandomCard(cards, room.cardUsageCounts, Math.random, previousCardId ? [previousCardId] : []);
    if (!card) throw new Error("题库为空，无法换题");

    room.currentCard = card;
    room.currentOptions = generateOptions(cards, card.id, cards.length);
    this.registerCardUse(room, card);
    room.roundTurns = [];
    room.clueHistory = [];
    room.currentClue = "";
    this.addMessage(room, `主持人已更换第 ${room.currentRound} 局题目`);
    this.startTurn(room, room.firstTeam || room.currentTurnTeam || "A");
    this.touch(room);
    return room;
  }

  clueGiverChangeCard(clientId) {
    const room = this.requirePlayerRoom(clientId);
    const player = this.requirePlayer(room, clientId);
    this.assertPlaying(room);
    if (room.phase !== "clue") throw new Error("当前不是提示阶段，无法换题");
    if (player.role !== "contestant" || player.team !== room.currentTurnTeam || player.seatRole !== "clue_giver") {
      throw new Error("只有当前队伍的提示者可以换题");
    }

    this.clearTimers(room);
    const previousCardId = room.currentCard?.id;
    const cards = this.getCandidateCards(room);
    const card = pickRandomCard(cards, room.cardUsageCounts, Math.random, previousCardId ? [previousCardId] : []);
    if (!card) throw new Error("题库为空，无法换题");

    room.currentCard = card;
    room.currentOptions = generateOptions(cards, card.id, cards.length);
    this.registerCardUse(room, card);
    room.roundTurns = [];
    room.clueHistory = [];
    room.currentClue = "";
    this.addMessage(room, `${player.nickname} 更换了第 ${room.currentRound} 局题目`);
    this.startTurn(room, room.currentTurnTeam);
    this.touch(room);
    return room;
  }

  submitClue(clientId, clue) {
    const room = this.requirePlayerRoom(clientId);
    const player = this.requirePlayer(room, clientId);
    this.assertPlaying(room);
    if (room.phase !== "clue") throw new Error("当前不是提示阶段");
    if (player.role !== "contestant" || player.team !== room.currentTurnTeam || player.seatRole !== "clue_giver") {
      throw new Error("只有当前队伍的提示者可以提交提示");
    }
    const result = validateClue(clue, room.currentCard.name);
    if (!result.valid) throw new Error(result.reason);
    room.currentClue = result.clue;
    room.clueHistory.push({
      team: player.team,
      clue: result.clue,
      playerId: player.id,
      playerName: player.nickname,
      timestamp: Date.now()
    });
    room.phase = "guess";
    room.turnStartedAt = Date.now();
    room.turnEndsAt = Date.now() + room.settings.guessSeconds * 1000;
    this.scheduleTurnTimeout(room);
    this.addMessage(room, `${teamName(player.team)}提示：${result.clue}`);
    this.touch(room);
    return room;
  }

  submitGuess(clientId, selectedAnswerId, timedOut = false) {
    const room = this.requirePlayerRoom(clientId);
    const player = this.requirePlayer(room, clientId);
    this.assertPlaying(room);
    if (room.phase !== "guess" && !timedOut) throw new Error("当前不是猜题阶段");
    if (!timedOut && (player.role !== "contestant" || player.team !== room.currentTurnTeam || player.seatRole !== "guesser")) {
      throw new Error("只有当前队伍的猜题者可以提交答案");
    }
    // 防止同一人重复提交（超时不算）
    if (!timedOut && room.guessedPlayerIds?.has(clientId)) {
      throw new Error("你已经提交过答案了");
    }

    const selected = room.currentOptions.find((option) => option.id === Number(selectedAnswerId));
    const turn = buildTurn({
      team: room.currentTurnTeam,
      clue: room.currentClue,
      selectedAnswerId,
      selectedAnswerName: selected?.name ?? "",
      answerId: room.currentCard.id,
      timedOut,
      guesserId: clientId,
      guesserName: player.nickname
    });
    room.roundTurns.push(turn);

    if (turn.isCorrect) {
      this.clearTurnTimer(room);
      finishRound(room, room.currentTurnTeam, selected?.name ?? "");
      this.addMessage(room, `${player.nickname} 猜中，本局答案是 ${room.currentCard.name}`);
      if (isGameComplete(room)) {
        room.status = "finished";
        room.phase = "finished";
        this.addMessage(room, "比赛结束");
      } else if (room.settings.autoNextRound) {
        this.scheduleNextRound(room);
      }
    } else {
      // 记录该猜题人已答过
      if (!room.guessedPlayerIds) room.guessedPlayerIds = new Set();
      room.guessedPlayerIds.add(clientId);

      // 检查同队是否还有未答过的猜题人
      const teamGuessers = room.players.filter(
        (p) => p.role === "contestant" && p.team === room.currentTurnTeam && p.seatRole === "guesser"
      );
      const hasUngessed = teamGuessers.some((p) => !room.guessedPlayerIds.has(p.id));

      if (hasUngessed && !timedOut) {
        // 同队还有人可以猜，不切换队伍
        this.addMessage(room, `${player.nickname} 猜了「${selected?.name ?? "空答案"}」，答错，同队其他猜题人可以继续猜`);
      } else {
        // 所有人都答过或超时，切换到对方队伍
        if (!timedOut) {
          this.addMessage(room, `${player.nickname} 猜了「${selected?.name ?? "空答案"}」，答错`);
        }
        this.addMessage(room, `${teamName(turn.team)}${timedOut ? "超时" : `全部答错`}，轮到 ${teamName(nextTeam(turn.team))}`);
        this.startTurn(room, nextTeam(turn.team));
      }
    }
    this.touch(room);
    return room;
  }

  setOptionQualityFilter(clientId, quality) {
    const room = this.requirePlayerRoom(clientId);
    const player = this.requirePlayer(room, clientId);
    if (player.role !== "contestant" || player.seatRole !== "guesser") {
      throw new Error("只有猜题者可以筛选候选品质");
    }
    player.optionQualityFilter = room.gameMode === "hextech" ? normalizeOptionQualityFilter(quality) : "";
    this.touch(room);
    return room;
  }

  timeoutCurrentTurn(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== "playing" || (room.phase !== "clue" && room.phase !== "guess")) return null;
    const turn = buildTurn({
      team: room.currentTurnTeam,
      clue: room.currentClue,
      selectedAnswerId: null,
      selectedAnswerName: "",
      answerId: room.currentCard.id,
      timedOut: true
    });
    room.roundTurns.push(turn);
    this.addMessage(room, `${teamName(room.currentTurnTeam)}超时，轮到 ${teamName(nextTeam(room.currentTurnTeam))}`);
    this.startTurn(room, nextTeam(room.currentTurnTeam));
    this.touch(room);
    return room;
  }

  getClientState(roomId, clientId) {
    const room = this.requireRoom(roomId);
    const player = this.requirePlayer(room, clientId);
    const { turnTimer, nextRoundTimer, candidateCardIds, ...serializableRoom } = room;
    const canSeeAnswer =
      player.seatRole === "clue_giver" ||
      (player.role === "contestant" && (room.phase === "round_over" || room.phase === "finished")) ||
      (player.role === "spectator" && room.settings.allowSpectatorsSeeAnswer);

    return {
      ...serializableRoom,
      guessedPlayerIds: room.guessedPlayerIds ? [...room.guessedPlayerIds] : [],
      players: sortPlayers(room.players).map((item) => redactPlayer(item, room.adminId)),
      currentCard: room.currentCard ? redactCard(room.currentCard, canSeeAnswer, player.seatRole !== "guesser") : null,
      currentOptions: getPlayerOptions(room.currentOptions, player).map((option) => redactOption(option, true)),
      currentOptionTotal: room.currentOptions.length,
      optionQualityFilter: normalizeOptionQualityFilter(player.optionQualityFilter),
      history: room.history.map((history) => redactHistory(history, canSeeAnswer)),
      me: redactPlayer(player, room.adminId),
      serverNow: Date.now(),
      canSeeAnswer
    };
  }

  getRoom(roomId) {
    return this.rooms.get(normalizeRoomId(roomId));
  }

  getRoomByPlayer(clientId) {
    const roomId = this.playerToRoom.get(clientId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  startNextRound(room, firstTeam) {
    this.clearTimers(room);
    const cards = this.getCandidateCards(room);
    const card = pickRandomCard(cards, room.cardUsageCounts);
    if (!card) throw new Error("题库为空，无法开始下一局");
    room.currentRound += 1;
    room.currentCard = card;
    room.currentOptions = generateOptions(cards, card.id, cards.length);
    this.registerCardUse(room, card);
    room.firstTeam = firstTeam;
    room.roundTurns = [];
    room.clueHistory = [];
    room.status = "playing";
    room.phase = "clue";
    this.addMessage(room, `第 ${room.currentRound} 局开始，${teamName(firstTeam)}先手`);
    this.startTurn(room, firstTeam);
    this.touch(room);
  }

  startTurn(room, team) {
    this.clearTurnTimer(room);
    this.resetOptionFilters(room);
    room.currentTurnTeam = team;
    room.phase = "clue";
    room.currentClue = "";
    room.guessedPlayerIds = new Set();
    room.turnStartedAt = Date.now();
    room.turnEndsAt = Date.now() + room.settings.guessSeconds * 1000;
    this.scheduleTurnTimeout(room);
  }

  scheduleTurnTimeout(room) {
    this.clearTurnTimer(room);
    const delay = Math.max(0, room.turnEndsAt - Date.now()) + 30;
    room.turnTimer = setTimeout(() => {
      this.timeoutCurrentTurn(room.id);
    }, delay);
  }

  scheduleNextRound(room) {
    this.clearNextRoundTimer(room);
    room.nextRoundAt = Date.now() + NEXT_ROUND_DELAY_MS;
    room.nextRoundTimer = setTimeout(() => {
      if (room.status === "playing" && room.phase === "round_over" && !isGameComplete(room)) {
        this.startNextRound(room, nextTeam(room.firstTeam));
      }
    }, NEXT_ROUND_DELAY_MS);
  }

  clearTimers(room) {
    this.clearTurnTimer(room);
    this.clearNextRoundTimer(room);
  }

  clearTurnTimer(room) {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }

  clearNextRoundTimer(room) {
    if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
    room.nextRoundTimer = null;
    room.nextRoundAt = null;
  }

  resetOptionFilters(room) {
    for (const player of room.players) {
      player.optionQualityFilter = "";
    }
  }

  addOrUpdatePlayer(room, { clientId, nickname, role, socketId, accessUser }) {
    const cleanNickname = String(nickname || "未命名玩家").trim().slice(0, 16);
    let player = room.players.find((item) => item.id === clientId);
    if (!player) {
      const isFirst = room.players.length === 0;
      const cleanRole = isFirst ? "admin" : "spectator";
      player = {
        id: clientId,
        nickname: cleanNickname,
        role: cleanRole,
        team: null,
        seatRole: null,
        ready: false,
        online: true,
        socketId,
        joinedAt: Date.now(),
        isAdminUser: isFirst
      };
      room.players.push(player);
    } else {
      player.nickname = cleanNickname;
      if (room.players.length === 1 && !room.adminId) {
        player.role = "admin";
        player.isAdminUser = true;
      }
      player.online = true;
      player.socketId = socketId;
    }

    if (player.isAdminUser) {
      room.adminId = player.id;
    } else if (room.adminId === player.id) {
      room.adminId = null;
      this.ensureAdmin(room);
    }

    if (player.role !== "contestant") {
      player.team = null;
      player.seatRole = null;
      player.ready = false;
    }

    this.playerToRoom.set(clientId, room.id);
    return player;
  }

  pruneWaitingRoom(room, { keepClientId = null } = {}) {
    if (room.status !== "waiting") return false;
    const removedIds = [];
    room.players = room.players.filter((player) => {
      const shouldRemove = !player.online && player.id !== keepClientId;
      if (shouldRemove) removedIds.push(player.id);
      return !shouldRemove;
    });
    for (const id of removedIds) {
      this.playerToRoom.delete(id);
    }
    if (removedIds.includes(room.adminId)) {
      room.adminId = null;
    }
    this.ensureAdmin(room, keepClientId);
    return removedIds.length > 0;
  }

  ensureAdmin(room, preferredId = null) {
    if (room.adminId && room.players.some((player) => player.id === room.adminId)) {
      const currentAdmin = room.players.find((player) => player.id === room.adminId);
      currentAdmin.role = "admin";
      currentAdmin.isAdminUser = true;
      return;
    }
    const candidates = room.players.filter((player) => player.online);
    const fallback = room.players;
    let newAdmin = null;
    if (preferredId) {
      newAdmin = room.players.find((player) => player.id === preferredId);
    }
    if (!newAdmin) {
      newAdmin = candidates[0] || fallback[0] || null;
    }
    if (newAdmin) {
      room.adminId = newAdmin.id;
      newAdmin.role = "admin";
      newAdmin.isAdminUser = true;
    } else {
      room.adminId = null;
    }
  }

  maybeAutoStart(room) {
    if (room.status !== "waiting") return false;
    if (!hasPlayableLineup(room)) return false;
    const seats = requiredSeats(room);
    if (!seats.every((player) => player.online && player.ready)) return false;
    this.startGameInternal(room);
    return true;
  }

  startGameInternal(room) {
    this.assertReady(room);
    this.clearTimers(room);
    room.settings = this.withAllCandidateOptions(room.settings, room.gameMode);
    room.candidateCardIds = this.createCandidateCardIds(room);
    room.status = "playing";
    room.currentRound = 0;
    room.score = { A: 0, B: 0 };
    room.history = [];
    room.usedCardIds = [];
    room.firstTeam = Math.random() > 0.5 ? "A" : "B";
    this.addMessage(room, `比赛开始，首局先手：${teamName(room.firstTeam)}`);
    this.startNextRound(room, room.firstTeam);
    return room;
  }

  registerCardUse(room, card) {
    room.cardUsageCounts ||= {};
    room.usedCardIds.push(card.id);
    const key = String(card.id);
    room.cardUsageCounts[key] = (Number(room.cardUsageCounts[key]) || 0) + 1;
  }

  assertRoleAvailable(room, role, clientId) {
    if (role === "contestant") {
      const contestants = room.players.filter((player) => player.role === "contestant" && player.id !== clientId);
      if (contestants.length >= MAX_CONTESTANTS) throw new Error("参赛选手已满");
    }
  }

  assertReady(room) {
    for (const team of TEAMS) {
      if (!teamHasPlayableLineup(room, team)) throw new Error(`${teamName(team)}需要 1 名提示者和至少 1 名猜题者`);
    }
  }

  assertSeatCapacity(room, player, team, seatRole) {
    const replacingClue = seatRole === "clue_giver" ? findClueGiver(room.players, team, player.id) : null;
    const teamPlayers = teamContestants(room.players, team)
      .filter((item) => item.id !== player.id)
      .filter((item) => item.id !== replacingClue?.id);
    if (teamPlayers.length >= MAX_TEAM_PLAYERS) throw new Error(`${teamName(team)}最多 ${MAX_TEAM_PLAYERS} 名参赛队员`);
    if (seatRole === "guesser") {
      const guesserCount = teamPlayers.filter((item) => item.seatRole === "guesser").length;
      if (guesserCount >= MAX_TEAM_GUESSERS) throw new Error(`${teamName(team)}最多 ${MAX_TEAM_GUESSERS} 名猜题者`);
    }
  }

  releaseExistingClueGiver(room, keepPlayerId, team) {
    for (const other of room.players) {
      if (other.id !== keepPlayerId && other.role === "contestant" && other.team === team && other.seatRole === "clue_giver") {
        other.role = "spectator";
        other.team = null;
        other.seatRole = null;
        other.ready = false;
      }
    }
  }

  assertAdmin(room, clientId) {
    if (room.adminId !== clientId) throw new Error("需要主持人权限");
  }

  assertPlaying(room) {
    if (room.status !== "playing") throw new Error("比赛未在进行中");
  }

  requirePlayerRoom(clientId) {
    const room = this.getRoomByPlayer(clientId);
    if (!room) throw new Error("玩家不在房间中");
    return room;
  }

  requireRoom(roomId) {
    const normalized = normalizeRoomId(roomId || DEFAULT_ROOM_ID);
    const room = this.rooms.get(normalized);
    if (!room) throw new Error("房间不存在");
    return room;
  }

  requirePlayer(room, clientId) {
    const player = room.players.find((item) => item.id === clientId);
    if (!player) throw new Error("玩家不存在");
    return player;
  }

  ensureRoom(roomId) {
    const normalized = normalizeRoomId(roomId || DEFAULT_ROOM_ID);
    if (!this.rooms.has(normalized)) {
      // 限制公网服务器的最大房间数，防内存消耗攻击
      if (!FIXED_ROOM_IDS.includes(normalized) && this.rooms.size >= 100) {
        throw new Error("服务器房间数量已达上限，无法创建新房间");
      }
      this.rooms.set(normalized, this.createDefaultRoom(normalized));
    }
    return this.rooms.get(normalized);
  }

  createDefaultRoom(roomId, adminId = null) {
    const room = createRoomState(roomId, adminId);
    room.settings = this.withAllCandidateOptions(room.settings, room.gameMode);
    return room;
  }

  withAllCandidateOptions(settings, gameMode = "hextech") {
    return { ...settings, optionCount: this.optionCountForMode(gameMode) };
  }

  optionCountForMode(gameMode) {
    const mode = normalizeGameMode(gameMode);
    const cards = this.getCardsForMode(mode);
    if (RANDOM_CANDIDATE_MODES.has(mode)) return Math.min(RANDOM_CANDIDATE_COUNT, cards.length);
    return cards.length;
  }

  getCardsForMode(gameMode) {
    return this.cardCatalogs[normalizeGameMode(gameMode)] || this.cardCatalogs.hextech;
  }

  createCandidateCardIds(room) {
    const cards = this.getCardsForMode(room.gameMode);
    if (!RANDOM_CANDIDATE_MODES.has(room.gameMode) || cards.length <= RANDOM_CANDIDATE_COUNT) {
      return cards.map((card) => card.id);
    }
    return shuffleCards(cards).slice(0, RANDOM_CANDIDATE_COUNT).map((card) => card.id);
  }

  getCandidateCards(room) {
    const cards = this.getCardsForMode(room.gameMode);
    const ids = new Set((room.candidateCardIds || []).map((id) => String(id)));
    if (ids.size === 0) return cards;
    return cards.filter((card) => ids.has(String(card.id)));
  }

  applyRequestedGameMode(room, requestedMode, nickname, accessUser) {
    const mode = normalizeGameMode(requestedMode);
    if (mode === room.gameMode || room.status !== "waiting") return false;
    const requesterIsHost = (accessUser === "admin") || String(accessUser).startsWith("duel") || (String(nickname || "").trim() === "夏如霜" && !accessUser);
    if (room.players.length > 0 && !requesterIsHost) return false;
    this.setRoomGameMode(room, mode);
    return true;
  }

  setRoomGameMode(room, requestedMode) {
    const mode = normalizeGameMode(requestedMode);
    if (room.gameMode === mode) return false;
    if (room.status !== "waiting") {
      throw new Error("比赛开始后不能切换玩法");
    }
    room.gameMode = mode;
    room.settings = this.withAllCandidateOptions(room.settings, mode);
    room.currentCard = null;
    room.currentOptions = [];
    room.candidateCardIds = [];
    room.usedCardIds = [];
    room.cardUsageCounts = {};
    room.history = [];
    room.roundTurns = [];
    room.clueHistory = [];
    for (const player of room.players) {
      player.ready = false;
      player.optionQualityFilter = "";
    }
    return true;
  }

  addMessage(room, text) {
    room.messages.push(this.systemMessage(text));
    room.messages = room.messages.slice(-200);
  }

  systemMessage(text) {
    return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, text, timestamp: Date.now() };
  }

  touch(room) {
    room.updatedAt = Date.now();
    if (this.onRoomChange) {
      queueMicrotask(() => this.onRoomChange(room.id));
    }
  }
}

function normalizeRoomId(roomId) {
  return String(roomId || "").trim().toUpperCase();
}

function normalizeCardCatalogs(cardCatalogs) {
  if (Array.isArray(cardCatalogs)) {
    return { hextech: cardCatalogs, anime: cardCatalogs };
  }
  return {
    hextech: Array.isArray(cardCatalogs?.hextech) ? cardCatalogs.hextech : [],
    anime: Array.isArray(cardCatalogs?.anime) ? cardCatalogs.anime : [],
    game: Array.isArray(cardCatalogs?.game) ? cardCatalogs.game : [],
    childhood: Array.isArray(cardCatalogs?.childhood) ? cardCatalogs.childhood : []
  };
}

function normalizeGameMode(gameMode) {
  const mode = String(gameMode || "hextech").trim();
  return GAME_MODES.has(mode) ? mode : "hextech";
}

function gameModeLabel(gameMode) {
  return GAME_MODE_LABELS[normalizeGameMode(gameMode)];
}

function shuffleCards(cards, random = Math.random) {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function requiredSeats(room) {
  return room.players.filter((player) => player.role === "contestant" && player.team && player.seatRole);
}

function teamContestants(players, team) {
  return players.filter((player) => player.role === "contestant" && player.team === team && player.seatRole);
}

function findClueGiver(players, team, excludeId = null) {
  return players.find((player) =>
    player.id !== excludeId &&
    player.role === "contestant" &&
    player.team === team &&
    player.seatRole === "clue_giver"
  );
}

function teamHasPlayableLineup(room, team) {
  const players = teamContestants(room.players, team);
  const clueCount = players.filter((player) => player.seatRole === "clue_giver").length;
  const guesserCount = players.filter((player) => player.seatRole === "guesser").length;
  return clueCount === 1 && guesserCount >= 1 && guesserCount <= MAX_TEAM_GUESSERS && players.length <= MAX_TEAM_PLAYERS;
}

function hasPlayableLineup(room) {
  return TEAMS.every((team) => teamHasPlayableLineup(room, team));
}

function redactPlayer(player, adminId) {
  return {
    id: player.id,
    nickname: player.nickname,
    role: player.role,
    team: player.team,
    seatRole: player.seatRole,
    ready: Boolean(player.ready),
    online: player.online,
    joinedAt: player.joinedAt,
    isAdmin: player.id === adminId
  };
}

function isHostPlayer(player) {
  return Boolean(player?.isAdminUser);
}

function redactCard(card, visible, canSeeQuality) {
  const visibleCard = visible
    ? card
    : {
        id: null,
        name: "答案已隐藏",
        description: "等待提示者给出双音节提示。",
        image: null,
        answer: null
      };

  if (canSeeQuality) return visibleCard;
  const { rarity, tags, ...withoutQuality } = visibleCard;
  return { ...withoutQuality, rarity: null, tags: [] };
}

function redactOption(option, canSeeQuality) {
  if (canSeeQuality) return option;
  const { rarity, ...withoutQuality } = option;
  return withoutQuality;
}

function getPlayerOptions(options, player) {
  const quality = normalizeOptionQualityFilter(player.optionQualityFilter);
  if (!quality) return options;
  return options.filter((option) => option.rarity === quality);
}

function normalizeOptionQualityFilter(quality) {
  const value = String(quality || "").trim();
  return OPTION_QUALITY_FILTERS.has(value) ? value : "";
}

function redactHistory(history, visible) {
  if (visible) return history;
  return {
    ...history,
    correctAnswer: "已隐藏",
    cardId: null
  };
}

function teamName(team) {
  return TEAM_NAMES[team] || `${team || "-"} 队`;
}

function seatLabel(seatRole) {
  if (seatRole === "clue_giver") return "提示者";
  if (seatRole === "guesser") return "猜题者";
  return "未分配";
}
