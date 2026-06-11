import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  Check,
  Circle,
  Clapperboard,
  Copy,
  CalendarDays,
  Eye,
  EyeOff,
  ExternalLink,
  Film,
  Gamepad2,
  HelpCircle,
  X,
  ImageOff,
  LogOut,
  LogIn,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Settings,
  Sparkles,
  Star,
  Swords,
  Tags,
  Timer,
  UserX,
  Users
} from "lucide-react";
import "./styles.css";

const socket = io();
const CLIENT_ID_KEY = "hextech-duel-client-id";
const LAST_ROOM_KEY = "hextech-duel-room-id";
const NICKNAME_KEY = "hextech-duel-nickname";
const ACCESS_TOKEN_KEY = "hextech-duel-access-token";
const ACCESS_USER_KEY = "hextech-duel-access-user";
const ACCESS_EXPIRES_KEY = "hextech-duel-access-expires";
const GAME_MODE_KEY = "hextech-duel-game-mode";
const FIXED_ROOMS = ["TEST"];
const DEFAULT_ROOM_ID = "TEST";
const GAME_MODES = [
  { value: "hextech", label: "海克斯玩法", title: "海克斯双音节对抗", joinLabel: "加入海克斯玩法" },
  { value: "anime", label: "谁是动漫糕手？", title: "谁是动漫糕手？", joinLabel: "加入动漫糕手" },
  { value: "game", label: "提示位别红温", title: "提示位别红温", joinLabel: "加入提示位别红温" },
  { value: "childhood", label: "不想长大", title: "不想长大", joinLabel: "加入不想长大" },
  { value: "yingshi", label: "阅片无数", title: "阅片无数", joinLabel: "加入阅片无数" }
];
const TEAM_META = {
  A: { name: "迅捷蟹队", shortName: "迅捷蟹", side: "潮汐蓝" },
  B: { name: "石甲虫队", shortName: "石甲虫", side: "岩甲金" }
};
const TEAMS = ["A", "B"];
const MAX_TEAM_GUESSERS = 4;
const SEAT_OPTIONS = [
  { key: "A:clue_giver", team: "A", seatRole: "clue_giver", label: "迅捷蟹队提示者" },
  { key: "A:guesser", team: "A", seatRole: "guesser", label: "迅捷蟹队猜题者" },
  { key: "B:clue_giver", team: "B", seatRole: "clue_giver", label: "石甲虫队提示者" },
  { key: "B:guesser", team: "B", seatRole: "guesser", label: "石甲虫队猜题者" },
  { key: "spectator", team: null, seatRole: null, label: "观众" }
];
const RULE_IMAGES = [
  "ChatGPT Image 2026年6月4日 17_38_12 (1).png",
  "ChatGPT Image 2026年6月4日 17_38_12 (2).png",
  "ChatGPT Image 2026年6月4日 17_38_12 (3).png",
  "ChatGPT Image 2026年6月4日 17_38_13 (4).png"
].map((name, index) => ({
  name,
  src: `/hextech/${encodeURIComponent(name)}`,
  alt: `海克斯双音节对抗规则介绍 ${index + 1}`
}));
const QUALITY_FILTERS = [
  { value: "", label: "全部" },
  { value: "白银", label: "白银" },
  { value: "黄金", label: "黄金" },
  { value: "棱彩", label: "棱彩" }
];
const PINYIN_COLLATOR = new Intl.Collator("zh-Hans-CN-u-co-pinyin", {
  numeric: true,
  sensitivity: "base"
});
const mediaCandidateUiState = new Map();

function App() {
  const [clientId] = useState(getClientId);
  const [access, setAccess] = useState(getInitialAccess);
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState(null);
  const roomRef = useRef(null);
  const leavingRoomRef = useRef(false);
  const [error, setError] = useState("");
  const [lastRoomId, setLastRoomId] = useState(getInitialRoomId);
  const [publicUrl, setPublicUrl] = useState("");
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    if (!room) {
      const key = `hextech-home-announcement-shown`;
      const shown = sessionStorage.getItem(key);
      if (!shown) {
        setAnnouncementOpen(true);
        sessionStorage.setItem(key, "true");
      }
    }
  }, [room]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    fetch("/api/public-config")
      .then((response) => response.ok ? response.json() : {})
      .then((config) => setPublicUrl(config.publicBaseUrl || ""))
      .catch(() => setPublicUrl(""));
  }, []);

  const request = useCallback((event, payload = {}) => {
    if (event === "room:join" || event === "room:create" || event === "room:reconnect") {
      leavingRoomRef.current = false;
    }
    setError("");
    return new Promise((resolve, reject) => {
      const authedPayload = access?.token ? { ...payload, accessToken: access.token } : payload;
      socket.emit(event, authedPayload, (reply) => {
        if (!reply?.ok) {
          const message = reply?.error || "操作失败";
          setError(message);
          if (message.includes("访问验证")) {
            clearStoredAccess();
            setAccess(null);
          }
          reject(new Error(message));
          return;
        }
        resolve(reply);
      });
    });
  }, [access?.token]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const savedRoom = localStorage.getItem(LAST_ROOM_KEY);
      if (savedRoom && access?.token && !roomRef.current && !leavingRoomRef.current) {
        request("room:reconnect", { clientId, roomId: savedRoom }).catch(() => {
          localStorage.removeItem(LAST_ROOM_KEY);
        });
      }
    };
    const onDisconnect = () => setConnected(false);
    const onState = (nextRoom) => {
      if (leavingRoomRef.current) return;
      setRoom(nextRoom);
      setLastRoomId(nextRoom.id);
      localStorage.setItem(LAST_ROOM_KEY, nextRoom.id);
    };
    const onError = (msg) => {
      setError(String(msg || "连接错误"));
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onState);
    socket.on("error", onError);
    if (socket.connected) onConnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onState);
      socket.off("error", onError);
    };
  }, [access?.token, clientId, request]);

  function handleAccessGranted(nextAccess) {
    const session = {
      token: nextAccess.token,
      username: nextAccess.username,
      expiresAt: nextAccess.expiresAt
    };
    localStorage.setItem(ACCESS_TOKEN_KEY, session.token);
    localStorage.setItem(ACCESS_USER_KEY, session.username);
    localStorage.setItem(ACCESS_EXPIRES_KEY, String(session.expiresAt));
    setAccess(session);
  }

  function leaveLocalRoom() {
    leavingRoomRef.current = true;
    setError("");
    socket.emit("room:leave", {}, () => {});
    roomRef.current = null;
    localStorage.removeItem(LAST_ROOM_KEY);
    setRoom(null);
    setLastRoomId(DEFAULT_ROOM_ID);
  }

  if (!access?.token) {
    return <AccessScreen onAccessGranted={handleAccessGranted} />;
  }

  if (!room) {
    return (
      <>
        <HomeScreen
          clientId={clientId}
          connected={connected}
          error={error}
          lastRoomId={lastRoomId}
          request={request}
          onOpenAnnouncement={() => setAnnouncementOpen(true)}
          onOpenFeedback={() => setFeedbackOpen(true)}
        />
        {announcementOpen && <AnnouncementModal onClose={() => setAnnouncementOpen(false)} />}
        {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
      </>
    );
  }

  if (room.status === "waiting") {
    return (
      <LobbyScreen
        connected={connected}
        error={error}
        publicUrl={publicUrl}
        request={request}
        room={room}
        leaveLocalRoom={leaveLocalRoom}
      />
    );
  }

  return (
    <GameRoomScreen
      connected={connected}
      error={error}
      setError={setError}
      publicUrl={publicUrl}
      request={request}
      room={room}
      leaveLocalRoom={leaveLocalRoom}
    />
  );
}

function AccessScreen({ onAccessGranted }) {
  const [password, setPassword] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captcha, setCaptcha] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadCaptcha = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch("/api/access/captcha", { cache: "no-store" });
      if (!response.ok) throw new Error("验证码加载失败");
      setCaptcha(await response.json());
      setCaptchaAnswer("");
    } catch (error) {
      setError(error.message || "验证码加载失败");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/access/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          captchaId: captcha?.captchaId,
          captchaAnswer
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "访问验证失败");
      onAccessGranted(data);
    } catch (error) {
      const message = error.message || "访问验证失败";
      await loadCaptcha();
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="access-shell">
      <section className="access-panel">
        <div className="access-copy">
          <div className="brand-mark"><ShieldCheck size={30} /></div>
          <h1>访问验证</h1>
          <p>计算验证码即可直接进入游戏。主持人口令可选（普通玩家留空）。</p>
        </div>
        <form className="access-form" onSubmit={submit}>
          <label>
            主持人口令（普通玩家免填）
            <input value={password} maxLength={64} type="password" placeholder="普通玩家请留空直接点进入" autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label>
            验证码
            <div className="captcha-row">
              <span className="captcha-question">{captcha?.question || "加载中..."}</span>
              <button className="icon-button" disabled={refreshing || busy} onClick={loadCaptcha} title="刷新验证码" type="button">
                <RefreshCw size={16} />
              </button>
            </div>
            <input value={captchaAnswer} inputMode="numeric" placeholder="计算输入结果" maxLength={8} onChange={(event) => setCaptchaAnswer(event.target.value)} />
          </label>
          <button className="primary wide" disabled={busy || refreshing || !captchaAnswer.trim()} type="submit">
            <LogIn size={18} /> 进入游戏
          </button>
          {error && <p className="error-line">{error}</p>}
        </form>
      </section>
    </main>
  );
}

function HomeScreen({ clientId, connected, error, lastRoomId, request, onOpenAnnouncement, onOpenFeedback }) {
  const [nickname, setNickname] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("nickname");
    return fromUrl || localStorage.getItem(NICKNAME_KEY) || "";
  });
  const [roomId, setRoomId] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("room");
    return fromUrl || localStorage.getItem(LAST_ROOM_KEY) || "";
  });
  const [gameMode, setGameMode] = useState(normalizeGameMode(localStorage.getItem(GAME_MODE_KEY)));
  const [busy, setBusy] = useState(false);
  const modeMeta = gameModeMeta(gameMode);

  useEffect(() => {
    localStorage.setItem(GAME_MODE_KEY, gameMode);
  }, [gameMode]);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search);
    const autoJoin = fromUrl.get("auto") === "true";
    if (autoJoin && nickname.trim() && roomId.trim() && connected && !busy) {
      const mockEvent = { preventDefault: () => {} };
      joinRoom(mockEvent);
    }
  }, [connected, nickname, roomId]);

  async function joinRoom(event) {
    event.preventDefault();
    const cleanNickname = String(nickname || "").trim();
    const cleanRoomId = String(roomId || "").trim().toUpperCase();
    if (!cleanNickname || !cleanRoomId) return;

    setBusy(true);
    localStorage.setItem(NICKNAME_KEY, cleanNickname);
    localStorage.setItem(LAST_ROOM_KEY, cleanRoomId);
    try {
      await request("room:join", {
        clientId,
        nickname: cleanNickname,
        roomId: cleanRoomId,
        gameMode,
        role: "spectator"
      });
    } finally {
      setBusy(false);
    }
  }

  const isValidRoom = /^(TEST|\d{4})$/i.test(roomId.trim());

  return (
    <main className={`home-shell mode-${gameMode}`}>
      <button className="announcement-trigger" onClick={onOpenAnnouncement} title="公告与玩法" type="button">
        <HelpCircle size={18} /> 公告
      </button>
      <button className="feedback-trigger" onClick={onOpenFeedback} title="意见反馈与Bug提交" type="button">
        <Send size={18} /> 反馈
      </button>
      <nav className="home-mode-switch" aria-label="玩法切换">
        {GAME_MODES.map((mode) => (
          <button
            key={mode.value}
            className={gameMode === mode.value ? "mode-button active" : "mode-button"}
            type="button"
            aria-pressed={gameMode === mode.value}
            onClick={() => setGameMode(mode.value)}
          >
            {modeIcon(mode.value, 17)}
            {mode.label}
          </button>
        ))}
      </nav>
      <section className="home-panel">
        <div className="home-copy">
          <div className="brand-mark">{modeIcon(gameMode, 30)}</div>
          <h1>{modeMeta.title}</h1>
          <p>
            {homeModeDescription(gameMode)}
          </p>
        </div>

        <form className="home-form" onSubmit={joinRoom}>
          <label>
            昵称
            <input value={nickname} maxLength={16} onChange={(event) => setNickname(event.target.value)} placeholder="输入你的昵称" />
          </label>
          <label>
            房间号
            <input value={roomId} maxLength={12} onChange={(event) => setRoomId(event.target.value)} placeholder="请输入四位数字房间号（例如 1234）" />
          </label>
          <button className="primary wide" disabled={!connected || busy || !nickname.trim() || !isValidRoom} type="submit">
            <Play size={18} /> 创建或加入房间
          </button>
          {!connected && <p className="error-line">正在连接实时服务...</p>}
          {error && <p className="error-line">{error}</p>}
        </form>
      </section>
      {isMediaMode(gameMode) ? <MediaPosterWaterfall mode={gameMode} /> : <HexRuleGallery />}
    </main>
  );
}

function HexRuleGallery() {
  return (
    <section className="rule-gallery" aria-label="规则介绍">
      <div className="section-heading">
        <h2>规则介绍</h2>
        <span>四人对抗 · 双音节提示 · 先猜先得</span>
      </div>
      <div className="rule-grid">
        {RULE_IMAGES.map((image) => (
          <figure className="rule-card" key={image.name}>
            <img src={image.src} alt={image.alt} loading="lazy" />
          </figure>
        ))}
      </div>
    </section>
  );
}

function MediaPosterWaterfall({ mode }) {
  const [posters, setPosters] = useState([]);
  const meta = mediaModeCopy(mode);

  useEffect(() => {
    let active = true;
    fetch(`/api/${mode}/posters?limit=96`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { posters: [] })
      .then((data) => {
        if (active) setPosters(Array.isArray(data.posters) ? data.posters : []);
      })
      .catch(() => {
        if (active) setPosters([]);
      });
    return () => {
      active = false;
    };
  }, [mode]);

  const columns = useMemo(() => {
    const columnCount = 6;
    return Array.from({ length: columnCount }, (_, column) =>
      posters.filter((_, index) => index % columnCount === column)
    );
  }, [posters]);

  return (
    <section className="anime-waterfall" aria-label={`${meta.itemLabel}海报瀑布流`}>
      <div className="section-heading">
        <h2>{meta.poolTitle}</h2>
        <span>每次开局随机 200 个 · 多列滚动预览</span>
      </div>
      <div className="poster-wall">
        {columns.map((column, index) => (
          <div className={`poster-column poster-column-${index}`} key={index}>
            <div className="poster-track">
              {[...column, ...column].map((poster, posterIndex) => (
                <figure className="poster-tile" key={`${poster.id}-${posterIndex}`}>
                  <PosterImage src={poster.image} name={poster.name} />
                  <figcaption>
                    <strong>{poster.name}</strong>
                    <span>{formatScore(poster.score)} · {poster.date || "未知日期"}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LobbyScreen({ connected, error, publicUrl, request, room, leaveLocalRoom }) {
  const [hostOpen, setHostOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const isAdmin = Boolean(room.me?.isAdmin);
  const occupiedSeats = getRequiredSeatPlayers(room).length;
  const readySeats = getRequiredSeatPlayers(room).filter((player) => player.ready).length;
  const canReady = room.me.role === "contestant" && room.me.team && room.me.seatRole;

  async function toggleReady() {
    await request("player:ready", { ready: !room.me.ready });
  }

  async function shareRoom() {
    await copyRoomLink(room.id, publicUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1400);
  }

  return (
    <main className="party-shell lobby-shell">
      <RoomTopbar
        room={room}
        connected={connected}
        remainingSeconds={0}
        stageLabel="等待准备"
        isAdmin={isAdmin}
        hostOpen={hostOpen}
        shareCopied={shareCopied}
        onShare={shareRoom}
        onLeave={leaveLocalRoom}
        onToggleHost={() => setHostOpen((open) => !open)}
      />
      {error && <div className="toast">{error}</div>}

      <section className="lobby-grid">
        <div className="lobby-main">
          <div className="lobby-hero">
            <div>
              <span className="muted-label">房间 {room.id}</span>
              <h2>队伍席位</h2>
            </div>
            <div className="ready-meter">
              <strong>{readySeats}/{occupiedSeats || 10}</strong>
              <span>已准备</span>
            </div>
          </div>
          <TeamSeatBoard room={room} request={request} mode="lobby" />
          <div className="lobby-action">
            {canReady ? (
              <button className={room.me.ready ? "ready-button active" : "ready-button"} onClick={toggleReady} type="button">
                {room.me.ready ? <Check size={20} /> : <Circle size={20} />}
                {room.me.ready ? "已准备" : "准备"}
              </button>
            ) : (
              <button className="ready-button" disabled type="button">先选择一个参赛席位</button>
            )}
            <div className="progress-copy">
              <strong>{occupiedSeats}/10 席已入座</strong>
              <span>每队 1 名提示者和至少 1 名猜题者，全员准备后自动开始</span>
            </div>
          </div>
        </div>

        <aside className="lobby-side">
          <CurrentPlayers room={room} />
          <MessageRail messages={room.messages} compact />
        </aside>
      </section>

      <HostDrawer
        open={hostOpen}
        room={room}
        request={request}
        onClose={() => setHostOpen(false)}
      />
    </main>
  );
}

function SidebarStatus({ room, remainingSeconds }) {
  const clues = room.clueHistory || [];
  const timerText = room.status === "playing" && room.phase !== "round_over" ? `${remainingSeconds}s` : "--";
  const me = room.me;
  const isMyTurn = me?.role === "contestant"
    && me?.team === room.currentTurnTeam
    && room.status === "playing"
    && (room.phase === "clue" || room.phase === "guess");
  return (
    <div className="sidebar-status">
      <div className="sidebar-timer">
        <Timer size={16} />
        <span>{timerText}</span>
        <span className={`turn-light ${isMyTurn ? "active" : ""}`} title={isMyTurn ? "轮到你了" : ""} />
      </div>
      <ClueTimeline clues={clues} />
    </div>
  );
}

function GameRoomScreen({ connected, error, setError, publicUrl, request, room, leaveLocalRoom }) {
  const [hostOpen, setHostOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const remainingSeconds = useCountdown(room.turnEndsAt, room.serverNow);
  const viewState = deriveViewState(room);
  const isAdmin = Boolean(room.me?.isAdmin);

  async function shareRoom() {
    await copyRoomLink(room.id, publicUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1400);
  }

  return (
    <main className={`party-shell game-shell mode-${room.gameMode} state-${viewState}`}>
      <RoomTopbar
        room={room}
        connected={connected}
        stageLabel={viewStateLabel(viewState, room)}
        isAdmin={isAdmin}
        hostOpen={hostOpen}
        shareCopied={shareCopied}
        onShare={shareRoom}
        onLeave={leaveLocalRoom}
        onToggleHost={() => setHostOpen((open) => !open)}
      />
      {error && <div className="toast">{error}</div>}
      {isMediaMode(room.gameMode) && <TeamRail room={room} horizontal />}

      <section className={isMediaMode(room.gameMode) ? "game-layout anime-game-layout" : "game-layout"}>
        {isMediaMode(room.gameMode) ? (
          <SidebarStatus room={room} remainingSeconds={remainingSeconds} />
        ) : (
          <TeamRail room={room}>
            <SidebarStatus room={room} remainingSeconds={remainingSeconds} />
          </TeamRail>
        )}
        <GameStage room={room} request={request} remainingSeconds={remainingSeconds} viewState={viewState} />
        <MessageRail messages={room.messages} />
      </section>

      <ActionDock room={room} request={request} remainingSeconds={remainingSeconds} clearError={() => setError("")} />

      <HostDrawer
        open={hostOpen}
        room={room}
        request={request}
        onClose={() => setHostOpen(false)}
      />
    </main>
  );
}

function RoomTopbar({ room, connected, stageLabel, isAdmin, hostOpen, shareCopied, onShare, onLeave, onToggleHost }) {
  return (
    <header className="room-topbar">
      <div className="top-pill strong">房间 {room.id} · {gameModeLabel(room.gameMode)}</div>
      <div className="top-pill">第 {room.currentRound || 0}/{room.settings.totalRounds} 局</div>
      <div className="top-score">
        <span className="team-a">{teamShortName("A")} {room.score.A}</span>
        <span>:</span>
        <span className="team-b">{room.score.B} {teamShortName("B")}</span>
      </div>
      <div className="top-pill stage-pill">{stageLabel}</div>
      <button className="top-button" onClick={onShare} type="button"><Copy size={16} /> {shareCopied ? "已复制房间链接" : `房间号: ${room.id}`}</button>
      <button className="top-button" onClick={onLeave} type="button"><LogOut size={16} /> 返回首页</button>
      {isAdmin && (
        <button className={hostOpen ? "top-button active" : "top-button"} onClick={onToggleHost} type="button">
          <Settings size={16} /> 主持人面板
        </button>
      )}
      <span className={connected ? "connection-dot online" : "connection-dot offline"} title={connected ? "已连接" : "离线"} />
    </header>
  );
}

function TeamSeatBoard({ room, request, mode = "game" }) {
  const [pendingSeatKey, setPendingSeatKey] = useState(null);
  const isHorizontal = mode === "game-horizontal";
  const hideEmptySeats = isHorizontal;

  return (
    <div className={mode === "lobby" ? "seat-board lobby-seat-board" : isHorizontal ? "seat-board horizontal-seat-board" : "seat-board"}>
      {TEAMS.map((team) => {
        const clueGiver = findSeat(room.players, team, "clue_giver");
        const guessers = findGuessers(room.players, team);
        const guesserSlots = Array.from({ length: MAX_TEAM_GUESSERS }, (_, index) => ({
          slotIndex: index + 1,
          player: guessers[index] || null
        })).filter((slot) => !hideEmptySeats || slot.player);
        return (
        <section key={team} className={`team-card team-${team.toLowerCase()}`}>
          <div className="team-card-head">
            <strong>{teamName(team)}</strong>
            <span>{guessers.length + (clueGiver ? 1 : 0)}/5</span>
          </div>
          {(!hideEmptySeats || clueGiver) && (
            <SeatCard
              team={team}
              seatRole="clue_giver"
              player={clueGiver}
              room={room}
              request={request}
              interactive={mode === "lobby"}
              pendingSeatKey={pendingSeatKey}
              onPendingSeatChange={setPendingSeatKey}
            />
          )}
          {guesserSlots.map(({ slotIndex, player }) => (
            <SeatCard
              key={`${team}-guesser-${slotIndex}`}
              team={team}
              seatRole="guesser"
              slotIndex={slotIndex}
              player={player}
              room={room}
              request={request}
              interactive={mode === "lobby"}
              pendingSeatKey={pendingSeatKey}
              onPendingSeatChange={setPendingSeatKey}
            />
          ))}
        </section>
        );
      })}
    </div>
  );
}

function SeatCard({ team, seatRole, slotIndex = null, player, room, request, interactive, pendingSeatKey, onPendingSeatChange }) {
  const isMine = player?.id === room.me.id;
  const seatKey = `${team}:${seatRole}:${slotIndex || 1}`;
  const isPending = pendingSeatKey === seatKey;
  const isActing =
    room.status === "playing" &&
    room.currentTurnTeam === team &&
    ((room.phase === "clue" && seatRole === "clue_giver") || (room.phase === "guess" && seatRole === "guesser"));
  const canTake = interactive && room.status === "waiting" && !player;
  const seatBusy = Boolean(pendingSeatKey);

  async function takeSeat() {
    if (seatBusy) return;
    onPendingSeatChange(seatKey);
    try {
      await request("player:seat", { team, seatRole });
    } finally {
      onPendingSeatChange(null);
    }
  }

  async function becomeSpectator() {
    await request("player:spectator");
  }

  return (
    <div className={isActing ? "seat-card acting" : "seat-card"}>
      <div className="seat-icon">{seatRole === "clue_giver" ? <Sparkles size={18} /> : <Swords size={18} />}</div>
      <div className="seat-body">
        <span>
          {seatLabel(seatRole)}
          {slotIndex && <span className="seat-slot">#{slotIndex}</span>}
        </span>
        <strong>{player?.nickname || "空席"}</strong>
        {player && (
          <small>
            {player.isAdmin ? "主持人 · " : ""}
            {player.ready ? "已准备" : room.status === "waiting" ? "未准备" : isActing ? "行动中" : "待命"}
          </small>
        )}
      </div>
      {isActing && <span className="action-mark">行动</span>}
      {canTake && <button className="mini-button" disabled={seatBusy} onClick={takeSeat} type="button">{isPending ? "入座中" : "坐这里"}</button>}
      {interactive && isMine && <button className="mini-button ghost" onClick={becomeSpectator} type="button">旁观</button>}
    </div>
  );
}

function CurrentPlayers({ room }) {
  const sorted = [...room.players].sort((a, b) => (b.score || 0) - (a.score || 0));
  return (
    <section className="side-section">
      <h2><Users size={18} /> 当前玩家</h2>
      <div className="current-player-list">
        {sorted.map((player) => (
          <div key={player.id} className="current-player">
            <span className={player.online ? "status-dot online" : "status-dot offline"} />
            <div>
              <div className="player-name-row">
                <strong>{player.nickname}</strong>
                <span className="player-score">{player.score || 0}</span>
              </div>
              <small>{playerText(player)}</small>
            </div>
            {player.ready && <Check size={16} className="ready-check" />}
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamRail({ room, horizontal = false, children }) {
  return (
    <aside className={horizontal ? "team-rail horizontal-team-rail" : "team-rail"}>
      {!horizontal && children}
      <TeamSeatBoard room={room} request={() => Promise.resolve()} mode={horizontal ? "game-horizontal" : "game"} />
    </aside>
  );
}

function GameStage({ room, request, remainingSeconds, viewState }) {
  const lastTurn = room.roundTurns?.at(-1);
  const lastHistory = room.history?.at(-1);
  const hidden = !room.canSeeAnswer;
  const isMediaAnswerMode = isMediaMode(room.gameMode);
  const canViewGuesserOptions =
    room.me.role === "contestant" &&
    room.me.seatRole === "guesser" &&
    (room.phase === "clue" || room.phase === "guess") &&
    room.currentOptions.length > 0;
  const canViewClueOptions =
    isMediaAnswerMode &&
    room.me.role === "contestant" &&
    room.me.seatRole === "clue_giver" &&
    (room.phase === "clue" || room.phase === "guess") &&
    room.currentOptions.length > 0;
  const canSubmitGuess =
    room.status === "playing" &&
    room.phase === "guess" &&
    room.me.team === room.currentTurnTeam &&
    room.me.seatRole === "guesser";
  const canChangeCard =
    room.status === "playing" &&
    room.phase === "clue" &&
    room.me.role === "contestant" &&
    room.me.team === room.currentTurnTeam &&
    room.me.seatRole === "clue_giver";

  function handleChangeCard() {
    request("turn:changeCard");
  }

  return (
    <section className={canViewGuesserOptions || canViewClueOptions ? "main-stage guesser-stage" : "main-stage"}>

      {canViewGuesserOptions ? (
        isMediaAnswerMode ? (
          <MediaAnswerBoard room={room} request={request} remainingSeconds={remainingSeconds} canSubmit={canSubmitGuess} />
        ) : (
          <AnswerBoard room={room} request={request} remainingSeconds={remainingSeconds} canSubmit={canSubmitGuess} />
        )
      ) : (
        <>
          {isMediaAnswerMode ? <MediaTitleCard card={room.currentCard} hidden={hidden} mode={room.gameMode} canChangeCard={canChangeCard} onChangeCard={handleChangeCard} /> : <HexRuneCard card={room.currentCard} hidden={hidden} canChangeCard={canChangeCard} onChangeCard={handleChangeCard} />}

          {canViewClueOptions && (
            <MediaAnswerBoard room={room} request={request} remainingSeconds={remainingSeconds} canSubmit={false} viewerRole="clue_giver" />
          )}

          {!canViewClueOptions && <div className={`judgement-banner ${viewState}`}>
            {viewState === "round_result" || viewState === "game_over" ? (
              <>
                <strong>{lastHistory?.winnerTeam ? `${teamName(lastHistory.winnerTeam)}拿下本局` : "本局结束"}</strong>
                <span>答案：{lastHistory?.correctAnswer || room.currentCard?.name || "未知"}</span>
              </>
            ) : lastTurn ? (
              <>
                <strong>{lastTurn.isCorrect ? "判定正确" : lastTurn.timedOut ? "超时换边" : room.phase === "guess" ? "答错，等待同队" : "判定错误"}</strong>
                <span>{lastTurn.isCorrect ? lastTurn.selectedAnswerName : lastTurn.guesserName ? `${lastTurn.guesserName}：${lastTurn.selectedAnswerName || "空答案"}` : (lastTurn.selectedAnswerName || "未提交答案")}</span>
              </>
            ) : (
              <>
                <strong>{viewStateLabel(viewState, room)}</strong>
                <span>{stageHelpText(room)}</span>
              </>
            )}
          </div>}

          {!canViewClueOptions && <div className="visibility-line">
            {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
            <span>{hidden ? "答案对当前身份隐藏" : "当前身份可见答案"}</span>
          </div>}
        </>
      )}
    </section>
  );
}

function ClueTimeline({ clues }) {
  return (
    <section className="clue-timeline" aria-label="共享提示">
      <div className="clue-timeline-head">
        <span className="muted-label">共享提示</span>
        <strong>{clues.length}</strong>
      </div>
      <div className="clue-chip-list">
        {clues.length === 0 ? (
          <span className="clue-placeholder">等待第一条提示</span>
        ) : (
          clues.map((item, index) => (
            <span className={`clue-chip team-${String(item.team || "").toLowerCase()}`} key={`${item.timestamp}-${index}`}>
              <small>{teamShortName(item.team)}</small>
              {item.clue}
            </span>
          ))
        )}
      </div>
    </section>
  );
}

function HexRuneCard({ card, hidden, canChangeCard, onChangeCard }) {
  const hasCard = Boolean(card);
  const displayName = !hasCard ? "等待抽题" : hidden ? "???" : card.name;
  const rarity = card?.rarity || "";
  const description = card?.description || "四名参赛队员准备后，系统会自动抽取海克斯符文。";

  return (
    <article className={`hex-rune-card ${qualityClass(rarity)} ${hidden ? "hidden-answer" : ""}`}>
      {canChangeCard && (
        <button className="change-card-button" onClick={onChangeCard} type="button" title="换一道题">
          <RefreshCw size={16} /> 换题
        </button>
      )}
      <div className="hex-top">
        <div className="hex-art-frame">
          {card?.image && !hidden ? <RuneIcon src={card.image} name={card.name} className="hex-rune-art" /> : <div className="hex-question">?</div>}
        </div>
        <div className="hex-title-block">
          {rarity && <span className="rarity-tag">{rarity}</span>}
          <h2>{displayName}</h2>
        </div>
      </div>
      <div className="hex-divider" />
      <p>{description}</p>
    </article>
  );
}

function MediaTitleCard({ card, hidden, mode, canChangeCard, onChangeCard }) {
  const hasCard = Boolean(card);
  const displayName = !hasCard ? "等待抽题" : hidden ? "???" : card.name;
  const meta = mediaModeCopy(card?.mode || mode);
  const tags = card?.tags || [];
  const detailItems = mediaDetailItems(card);

  return (
    <article className={`anime-title-card ${hidden ? "hidden-answer" : ""}`}>
      {canChangeCard && (
        <button className="change-card-button" onClick={onChangeCard} type="button" title="换一道题">
          <RefreshCw size={16} /> 换题
        </button>
      )}
      <div className="anime-title-poster">
        {!hidden && card?.image ? <PosterImage src={card.image} name={card.name} /> : <div className="poster-question">?</div>}
      </div>
      <div className="anime-title-body">
        <div className="anime-title-head">
          <span className="muted-label">{meta.clueLabel}</span>
          <h2>{displayName}</h2>
        </div>
        {!hidden && hasCard ? (
          <>
            {card.mode === "game" && <GameNamePair card={card} />}
            <div className="anime-meta-grid">
              <span><Star size={15} /> {formatScore(card.score)}</span>
              <span><CalendarDays size={15} /> {card.date || "未知日期"}</span>
              {card.mode !== "game" && <span><Users size={15} /> {formatVotes(card.totalVotes)}</span>}
            </div>
            <div className="anime-tag-list">
              {tags.slice(0, 12).map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <p>{card.description || "暂无详细信息"}</p>
            {detailItems.length > 0 && (
              <div className="character-strip">
                {detailItems.slice(0, 8).map((item) => <span key={item}>{item}</span>)}
              </div>
            )}
            {card.url && (
              <a className="detail-link" href={card.url} target="_blank" rel="noreferrer">
                <ExternalLink size={16} /> {meta.linkLabel}
              </a>
            )}
          </>
        ) : (
          <p>等待提示者查看题目并给出双音节提示。</p>
        )}
      </div>
    </article>
  );
}

function MediaAnswerBoard({ room, request, remainingSeconds, canSubmit = true, viewerRole = "guesser" }) {
  const meta = mediaModeCopy(room.gameMode);
  const stateKey = `${room.id}:${room.gameMode}-candidates`;
  const initialUi = mediaCandidateUiState.get(stateKey) || {};
  const [selected, setSelected] = useState(initialUi.selected ?? null);
  const [search, setSearch] = useState(initialUi.search ?? "");
  const [activeTag, setActiveTag] = useState(initialUi.activeTag ?? "");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [excludedIds, setExcludedIds] = useState(new Set());
  const [viewTab, setViewTab] = useState("candidates");
  const optionTotal = room.currentOptionTotal || room.currentOptions.length;
  const tagFilters = useMemo(() => buildMediaTagFilters(room.currentOptions, room.gameMode), [room.currentOptions, room.gameMode]);
  const filteredOptions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return room.currentOptions
      .filter((option) => !activeTag || (option.tags || []).includes(activeTag))
      .filter((option) => {
        if (!keyword) return true;
        const haystack = [
          option.name,
          option.chineseName,
          option.englishName,
          option.date,
          ...(option.aliases || []),
          ...(option.platforms || []),
          ...(option.tags || []),
          ...(option.characters || []).map((character) => character.name)
        ].join(" ").toLowerCase();
        return haystack.includes(keyword);
      })
      .sort((a, b) => compareChinesePinyin(a.name, b.name) || Number(a.id) - Number(b.id));
  }, [activeTag, room.currentOptions, search]);
  const visibleOptions = useMemo(
    () => filteredOptions.filter((o) => !excludedIds.has(o.id)),
    [filteredOptions, excludedIds]
  );
  const excludedOptions = useMemo(
    () => filteredOptions.filter((o) => excludedIds.has(o.id)),
    [filteredOptions, excludedIds]
  );
  const selectedOption = useMemo(
    () => room.currentOptions.find((option) => option.id === selected && !excludedIds.has(option.id)) || visibleOptions[0] || null,
    [visibleOptions, room.currentOptions, selected, excludedIds]
  );

  useEffect(() => {
    mediaCandidateUiState.set(stateKey, { selected, search, activeTag });
  }, [activeTag, search, selected, stateKey]);

  useEffect(() => {
    if (!tagsOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setTagsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [tagsOpen]);

  useEffect(() => {
    const selectedExists = room.currentOptions.some((option) => option.id === selected);
    if ((!selected || !selectedExists) && filteredOptions[0]) {
      setSelected(filteredOptions[0].id);
    } else if (selected && !selectedExists) {
      setSelected(null);
    }
  }, [filteredOptions, room.currentOptions, selected]);

  useEffect(() => {
    setExcludedIds(new Set());
    setViewTab("candidates");
  }, [room.currentRound]);

  function excludeOption(id) {
    setExcludedIds((prev) => new Set(prev).add(id));
    if (selected === id) {
      const remaining = visibleOptions.filter((o) => o.id !== id);
      setSelected(remaining[0]?.id || null);
    }
  }

  function restoreOption(id) {
    setExcludedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function submit() {
    const answerId = selectedOption?.id;
    if (!canSubmit || !answerId) return;
    setBusy(true);
    try {
      await request("turn:guess", { answerId });
    } catch {
      // App-level request handler already surfaces the error toast.
    } finally {
      setBusy(false);
    }
  }

  function chooseTag(tag) {
    setActiveTag(tag);
    setTagsOpen(false);
  }

  return (
    <section className={busy ? "anime-answer-board judging" : "anime-answer-board"}>
      <div className="anime-answer-head">
        <div>
          <span className="muted-label">{canSubmit ? "你来猜" : viewerRole === "clue_giver" ? "提示者候选参考" : "候选列表"}</span>
          <h2>{busy ? "判定中" : canSubmit ? meta.chooseLabel : "查看候选"}</h2>
        </div>
        <div className="answer-board-meta">
          <strong>{visibleOptions.length}/{optionTotal}</strong>
          <span>{activeTag || "全部候选"}{excludedIds.size > 0 ? ` · 已排除${excludedIds.size}` : ""}</span>
        </div>
      </div>

      <div className="anime-selected-detail">
        {selectedOption ? (
          <>
            <div className="anime-detail-cover">
              <PosterImage src={selectedOption.image} name={selectedOption.name} />
            </div>
            <div className="anime-detail-copy">
              <h3>{selectedOption.name}</h3>
              {selectedOption.mode === "game" && <GameNamePair card={selectedOption} compact />}
              <div className="anime-meta-grid compact">
                <span><Star size={14} /> {formatScore(selectedOption.score)}</span>
                <span><CalendarDays size={14} /> {selectedOption.date || "未知日期"}</span>
                {selectedOption.mode !== "game" && <span><Users size={14} /> {formatVotes(selectedOption.totalVotes)}</span>}
              </div>
              <div className="anime-tag-list compact">
                {(selectedOption.tags || []).slice(0, 10).map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              {(selectedOption.characters || []).length > 0 && (
                <div className="character-strip compact">
                  {selectedOption.characters.slice(0, 8).map((character) => <span key={`${character.id}-${character.name}`}>{character.name}</span>)}
                </div>
              )}
              {selectedOption.url && (
                <a className="detail-link compact" href={selectedOption.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} /> {meta.linkLabel}
                </a>
              )}
            </div>
          </>
        ) : (
          <div className="empty-options">{meta.emptyText}</div>
        )}
      </div>

      <div className="anime-answer-tools">
        <label className="answer-search anime-search">
          <span><Search size={14} /> 搜索</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={meta.searchPlaceholder} />
        </label>
        <div className="anime-filter-row">
          <button className="anime-tag-trigger" onClick={() => setTagsOpen(true)} type="button">
            <Tags size={15} /> 标签筛选
          </button>
          <span className="anime-active-filter">{activeTag || "全部候选"}</span>
          {activeTag && (
            <button className="anime-clear-filter" onClick={() => chooseTag("")} type="button">
              清除
            </button>
          )}
        </div>
      </div>

      {tagsOpen && (
        <div className="tag-popover-backdrop" onClick={() => setTagsOpen(false)}>
          <div className="tag-popover-card" role="dialog" aria-modal="true" aria-label="选择候选标签" onClick={(event) => event.stopPropagation()}>
            <div className="tag-popover-head">
              <div>
                <span className="muted-label">候选标签</span>
                <h3>选择一个筛选标签</h3>
              </div>
              <button className="icon-button" onClick={() => setTagsOpen(false)} type="button">×</button>
            </div>
            <div className="anime-tag-tabs" role="group" aria-label={`按标签筛选候选${meta.itemLabel}`}>
              <button className={!activeTag ? "anime-tag-tab active" : "anime-tag-tab"} onClick={() => chooseTag("")} type="button">
                <Tags size={14} /> 全部
              </button>
              {tagFilters.map((tag) => (
                <button key={tag} className={activeTag === tag ? "anime-tag-tab active" : "anime-tag-tab"} onClick={() => chooseTag(tag)} type="button">
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="candidate-tabs">
        <button className={viewTab === "candidates" ? "candidate-tab active" : "candidate-tab"} onClick={() => setViewTab("candidates")} type="button">
          候选 ({visibleOptions.length})
        </button>
        <button className={viewTab === "excluded" ? "candidate-tab active" : "candidate-tab"} onClick={() => setViewTab("excluded")} type="button">
          已排除 ({excludedOptions.length})
        </button>
      </div>
      <div className="anime-candidate-list">
        {viewTab === "candidates" ? (
          <>
            {visibleOptions.map((option) => (
              <button
                key={`${option.id}-${option.name}`}
                className={selectedOption?.id === option.id ? "anime-candidate selected" : "anime-candidate"}
                onClick={() => setSelected(option.id)}
                type="button"
              >
                <PosterImage src={option.image} name={option.name} />
                <span>{candidateDisplayName(option)}</span>
                <small>{formatCandidateMeta(option)}</small>
                <span className="exclude-btn" onClick={(e) => { e.stopPropagation(); excludeOption(option.id); }}><X size={14} /></span>
              </button>
            ))}
            {visibleOptions.length === 0 && <div className="empty-options">{excludedOptions.length > 0 ? "全部已排除" : meta.emptyText}</div>}
          </>
        ) : (
          <>
            {excludedOptions.map((option) => (
              <div
                key={`${option.id}-${option.name}`}
                className="anime-candidate excluded"
              >
                <PosterImage src={option.image} name={option.name} />
                <span>{candidateDisplayName(option)}</span>
                <small>{formatCandidateMeta(option)}</small>
                <button className="restore-btn" onClick={() => restoreOption(option.id)} type="button">恢复</button>
              </div>
            ))}
            {excludedOptions.length === 0 && <div className="empty-options">暂无排除的候选</div>}
          </>
        )}
      </div>

      <div className="answer-board-footer">
        <div>
          <strong>共享提示 {room.clueHistory?.length || 0} 条</strong>
          <span>{canSubmit ? `剩余 ${remainingSeconds}s` : viewerRole === "clue_giver" ? "提示者仅查看，不提交答案" : "等待行动时可以查看候选"}</span>
        </div>
        <button className="primary submit-guess" disabled={!canSubmit || !selectedOption || busy} onClick={submit} type="button">
          <Send size={18} /> {canSubmit ? "提交答案" : "等待可提交"}
        </button>
      </div>
    </section>
  );
}

function ActionDock({ room, request, remainingSeconds, clearError }) {
  const me = room.me;
  const guessedPlayerIds = new Set(room.guessedPlayerIds || []);
  const hasGuessed = guessedPlayerIds.has(me.id);
  const canClue = room.status === "playing" && room.phase === "clue" && me.team === room.currentTurnTeam && me.seatRole === "clue_giver";
  const canGuess = room.status === "playing" && room.phase === "guess" && me.team === room.currentTurnTeam && me.seatRole === "guesser" && !hasGuessed;

  if (room.status === "finished" || room.phase === "finished") {
    return <ResultDock room={room} final />;
  }
  if (room.phase === "round_over") {
    return <ResultDock room={room} />;
  }
  if (canClue) {
    return <ClueDock request={request} remainingSeconds={remainingSeconds} clearError={clearError} />;
  }
  if (canGuess) {
    return null;
  }
  return <ProgressDock room={room} remainingSeconds={remainingSeconds} hasGuessed={hasGuessed} />;
}

function ClueDock({ request, remainingSeconds, clearError }) {
  const [clue, setClue] = useState("");
  const [busy, setBusy] = useState(false);
  const [clueError, setClueError] = useState("");
  const canSubmit = Boolean(clue.trim());

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setClueError("");
    try {
      await request("turn:clue", { clue: clue.trim() });
      setClue("");
    } catch (err) {
      setClueError(err?.message || "提示不合法");
      clearError();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="action-dock clue-dock" onSubmit={submit}>
      <div className="dock-title">
        <div>
          <strong>提示输入</strong>
          <small>20字以内，点击提交后判定为两位有效提示</small>
        </div>
        <span>{remainingSeconds}s</span>
      </div>
      <div className="clue-dock-input-row">
        {clueError && <div className="clue-error">{clueError}</div>}
        <input
          value={clue}
          maxLength={20}
          onChange={(event) => { setClue(Array.from(event.target.value).slice(0, 20).join("")); setClueError(""); }}
          placeholder="随便输入，提交后判定"
          autoFocus
        />
      </div>
      <button className="primary" disabled={busy || !canSubmit} type="submit"><Send size={18} /> 提交提示</button>
    </form>
  );
}

function AnswerBoard({ room, request, remainingSeconds, canSubmit = true }) {
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [excludedIds, setExcludedIds] = useState(new Set());
  const [viewTab, setViewTab] = useState("candidates");
  const qualityFilter = room.optionQualityFilter || "";
  const optionTotal = room.currentOptionTotal || room.currentOptions.length;
  const filteredOptions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return room.currentOptions
      .filter((option) => !keyword || option.name.toLowerCase().includes(keyword))
      .sort((a, b) => compareChinesePinyin(a.name, b.name) || Number(a.id) - Number(b.id));
  }, [room.currentOptions, search]);

  const visibleOptions = useMemo(
    () => filteredOptions.filter((o) => !excludedIds.has(o.id)),
    [filteredOptions, excludedIds]
  );
  const excludedOptions = useMemo(
    () => filteredOptions.filter((o) => excludedIds.has(o.id)),
    [filteredOptions, excludedIds]
  );

  useEffect(() => {
    setSelected(null);
    setSearch("");
  }, [room.currentRound, room.currentTurnTeam, room.currentClue]);

  useEffect(() => {
    setExcludedIds(new Set());
    setViewTab("candidates");
  }, [room.currentRound]);

  useEffect(() => {
    if (selected && (excludedIds.has(selected) || !filteredOptions.some((option) => option.id === selected))) {
      setSelected(visibleOptions[0]?.id || null);
    }
  }, [filteredOptions, visibleOptions, selected, excludedIds]);

  function excludeOption(id) {
    setExcludedIds((prev) => new Set(prev).add(id));
    if (selected === id) {
      const remaining = visibleOptions.filter((o) => o.id !== id);
      setSelected(remaining[0]?.id || null);
    }
  }

  function restoreOption(id) {
    setExcludedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function changeQualityFilter(nextQuality) {
    if (nextQuality === qualityFilter) return;
    setSelected(null);
    await request("options:filter", { quality: nextQuality });
  }

  async function submit() {
    if (!canSubmit || !selected) return;
    setBusy(true);
    try {
      await request("turn:guess", { answerId: selected });
    } catch {
      // App-level request handler already surfaces the error toast.
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={busy ? "answer-board judging" : "answer-board"}>
      <div className="answer-board-head">
        <div>
          <span className="muted-label">{canSubmit ? "你来猜" : "候选列表"}</span>
          <h2>{busy ? "判定中" : canSubmit ? "选择符文" : "查看候选"}</h2>
        </div>
        <div className="answer-board-meta">
          <strong>{visibleOptions.length}/{optionTotal}</strong>
          <span>{qualityFilter ? `${qualityFilter}筛选` : "全部候选"}{excludedIds.size > 0 ? ` · 已排除${excludedIds.size}` : ""}</span>
        </div>
      </div>
      <div className="answer-board-tools">
        <div className="answer-tools">
          <label className="answer-search">
            <span><Search size={14} /> 搜索</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="符文名称" />
          </label>
          <div className="quality-tabs" role="group" aria-label="按品质筛选候选符文">
            {QUALITY_FILTERS.map((quality) => (
              <button
                key={quality.label}
                className={quality.value === qualityFilter ? "quality-tab active" : "quality-tab"}
                onClick={() => changeQualityFilter(quality.value)}
                type="button"
              >
                <span className={`quality-swatch ${qualityClass(quality.value)}`} aria-hidden="true" />
                {quality.label}
              </button>
            ))}
          </div>
        </div>
        <span className="answer-board-hint">品质筛选由服务端处理；悬停候选符文可查看描述。</span>
      </div>
      <div className="candidate-tabs">
        <button className={viewTab === "candidates" ? "candidate-tab active" : "candidate-tab"} onClick={() => setViewTab("candidates")} type="button">
          候选 ({visibleOptions.length})
        </button>
        <button className={viewTab === "excluded" ? "candidate-tab active" : "candidate-tab"} onClick={() => setViewTab("excluded")} type="button">
          已排除 ({excludedOptions.length})
        </button>
      </div>
      <div className="answer-grid answer-grid-main">
        {viewTab === "candidates" ? (
          <>
            {visibleOptions.map((option) => (
              <button
                key={`${option.id}-${option.name}`}
                className={selected === option.id ? "answer-button selected" : "answer-button"}
                onClick={() => setSelected(option.id)}
                title={`${option.name}\n${option.description || "暂无描述"}`}
                type="button"
              >
                <RuneIcon src={option.image} name={option.name} />
                <span>{option.name}</span>
                <span className="exclude-btn" onClick={(e) => { e.stopPropagation(); excludeOption(option.id); }}><X size={14} /></span>
              </button>
            ))}
            {visibleOptions.length === 0 && <div className="empty-options">{excludedOptions.length > 0 ? "全部已排除" : "没有匹配的符文"}</div>}
          </>
        ) : (
          <>
            {excludedOptions.map((option) => (
              <div
                key={`${option.id}-${option.name}`}
                className="answer-button excluded"
                title={`${option.name}\n${option.description || "暂无描述"}`}
              >
                <RuneIcon src={option.image} name={option.name} />
                <span>{option.name}</span>
                <button className="restore-btn" onClick={() => restoreOption(option.id)} type="button">恢复</button>
              </div>
            ))}
            {excludedOptions.length === 0 && <div className="empty-options">暂无排除的符文</div>}
          </>
        )}
      </div>
      <div className="answer-board-footer">
        <div>
          <strong>共享提示 {room.clueHistory?.length || 0} 条</strong>
          <span>{canSubmit ? `剩余 ${remainingSeconds}s` : "等待行动时不能提交"}</span>
        </div>
        <button className="primary submit-guess" disabled={!canSubmit || !selected || busy} onClick={submit} type="button">
          <Send size={18} /> {canSubmit ? "提交答案" : "等待可提交"}
        </button>
      </div>
    </section>
  );
}

function RuneIcon({ src, name, className = "" }) {
  const [broken, setBroken] = useState(!src);

  useEffect(() => {
    setBroken(!src);
  }, [src]);

  if (broken) {
    return (
      <span className={className ? `rune-icon-fallback ${className}` : "rune-icon-fallback"} aria-label={`${name || "符文"}图标缺失`}>
        <ImageOff size={22} />
      </span>
    );
  }

  return <img className={className} src={src} alt="" onError={() => setBroken(true)} />;
}

function PosterImage({ src, name, className = "" }) {
  const [broken, setBroken] = useState(!src);

  useEffect(() => {
    setBroken(!src);
  }, [src]);

  if (broken) {
    return (
      <span className={className ? `poster-fallback ${className}` : "poster-fallback"} aria-label={`${name || "条目"}海报缺失`}>
        <ImageOff size={24} />
      </span>
    );
  }

  return <img className={className} src={src} alt="" onError={() => setBroken(true)} />;
}

function ProgressDock({ room, remainingSeconds, hasGuessed = false }) {
  const me = room.me;
  const isMyTeamTurn = me.team === room.currentTurnTeam && me.seatRole === "guesser" && hasGuessed;
  return (
    <section className="action-dock progress-dock">
      <div>
        <strong>当前进度</strong>
        <span>{room.currentTurnTeam ? `${teamName(room.currentTurnTeam)} · ${phaseLabel(room.phase)}` : phaseLabel(room.phase)}</span>
      </div>
      <div>
        <strong>{isMyTeamTurn ? "已提交答案，等待队友" : `共享提示 ${room.clueHistory?.length || 0} 条`}</strong>
        <span>{room.status === "playing" ? `剩余 ${remainingSeconds}s` : "观战中"}</span>
      </div>
    </section>
  );
}

function ResultDock({ room, final = false }) {
  const last = room.history.at(-1);
  return (
    <section className="action-dock result-dock">
      <div>
        <strong>{final ? finalWinnerText(room.score) : last?.winnerTeam ? `${teamName(last.winnerTeam)}赢得本局` : "本局结算"}</strong>
        <span>比分 {teamShortName("A")} {room.score.A} : {room.score.B} {teamShortName("B")}</span>
      </div>
      <div>
        <strong>正确答案</strong>
        <span>{last?.correctAnswer || room.currentCard?.name || "未知"}</span>
      </div>
    </section>
  );
}

function MessageRail({ messages, compact = false }) {
  const listRef = useRef(null);
  const latest = messages.slice(compact ? -20 : -200);
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [latest.length, compact]);
  return (
    <aside className={compact ? "message-rail compact" : "message-rail"}>
      <h2><Timer size={18} /> 消息流</h2>
      <div className="message-list" ref={listRef}>
        {latest.length === 0 && <p className="muted">暂无消息</p>}
        {latest.map((message) => (
          <div key={message.id} className="message-row">
            <span>{formatTime(message.timestamp)}</span>
            <p>{message.text}</p>
          </div>
        ))}
      </div>
    </aside>
  );
}

function HostDrawer({ open, room, request, onClose }) {
  const [draft, setDraft] = useState({ ...room.settings, gameMode: room.gameMode });
  const canChangeCard = room.status === "playing" && (room.phase === "clue" || room.phase === "guess");

  useEffect(() => {
    setDraft({ ...room.settings, gameMode: room.gameMode });
  }, [room.settings, room.gameMode]);

  if (!open || !room.me?.isAdmin) return null;

  function updateDraft(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <aside className="host-drawer">
      <div className="drawer-head">
        <div>
          <span className="muted-label">主持人</span>
          <h2>游戏设置</h2>
        </div>
        <button className="icon-button" onClick={onClose} type="button">×</button>
      </div>

      <div className="host-actions">
        <button className="primary" onClick={() => request("game:start")} disabled={room.status !== "waiting"} type="button"><Play size={16} /> 开始</button>
        {room.status === "paused" ? (
          <button onClick={() => request("game:resume")} type="button"><Play size={16} /> 继续</button>
        ) : (
          <button onClick={() => request("game:pause")} disabled={room.status !== "playing"} type="button"><Pause size={16} /> 暂停</button>
        )}
        <button onClick={() => request("game:reset")} type="button"><RotateCcw size={16} /> 重置</button>
        <button disabled={!canChangeCard} onClick={() => request("game:changeCard")} type="button"><Sparkles size={16} /> 换题</button>
      </div>

      <div className="drawer-mode-switch" role="group" aria-label="玩法设置">
        {GAME_MODES.map((mode) => (
          <button
            key={mode.value}
            className={draft.gameMode === mode.value ? "mode-button active" : "mode-button"}
            disabled={room.status !== "waiting"}
            onClick={() => updateDraft("gameMode", mode.value)}
            type="button"
          >
            {modeIcon(mode.value, 15)}
            {mode.label}
          </button>
        ))}
      </div>

      <div className="settings-grid">
        <label>总局数<input type="number" min="1" max="25" value={draft.totalRounds} onChange={(event) => updateDraft("totalRounds", event.target.value)} /></label>
        <label>倒计时<input type="number" min="10" max="180" value={draft.guessSeconds} onChange={(event) => updateDraft("guessSeconds", event.target.value)} /></label>
        <label>候选范围<input value={optionScopeLabel(room)} readOnly /></label>
      </div>
      <label className="toggle-line">
        <input type="checkbox" checked={draft.allowSpectatorsSeeAnswer} onChange={(event) => updateDraft("allowSpectatorsSeeAnswer", event.target.checked)} />
        观众可见答案
      </label>
      <label className="toggle-line">
        <input type="checkbox" checked={draft.autoNextRound} onChange={(event) => updateDraft("autoNextRound", event.target.checked)} />
        自动进入下一局
      </label>
      <button onClick={() => request("admin:settings", draft)} type="button">保存设置</button>

      <div className="drawer-section">
        <h3>玩家席位</h3>
        <div className="assign-list">
          {room.players.map((player) => (
            <AdminPlayerRow key={player.id} player={player} request={request} isSelf={player.id === room.me.id} />
          ))}
        </div>
      </div>

    </aside>
  );
}

function AdminPlayerRow({ player, request, isSelf }) {
  function assign(role, team = null, seatRole = null) {
    request("admin:assign", { targetId: player.id, assignment: { role, team, seatRole } });
  }

  return (
    <div className="assign-row">
      <div>
        <strong>{player.nickname}</strong>
        <small>{playerText(player)}</small>
      </div>
      <div className="assign-buttons">
        <button onClick={() => assign("contestant", "A", "clue_giver")} type="button">蟹提</button>
        <button onClick={() => assign("contestant", "A", "guesser")} type="button">蟹猜</button>
        <button onClick={() => assign("contestant", "B", "clue_giver")} type="button">石提</button>
        <button onClick={() => assign("contestant", "B", "guesser")} type="button">石猜</button>
        <button onClick={() => assign("spectator")} type="button">观众</button>
        {!isSelf && <button className="danger" onClick={() => request("admin:kick", { targetId: player.id })} type="button"><UserX size={14} /></button>}
      </div>
    </div>
  );
}

function useCountdown(turnEndsAt, serverNow) {
  const [now, setNow] = useState(Date.now());
  const [clockSkew, setClockSkew] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (serverNow) setClockSkew(Number(serverNow) - Date.now());
  }, [serverNow]);
  if (!turnEndsAt) return 0;
  return Math.max(0, Math.ceil((turnEndsAt - (now + clockSkew)) / 1000));
}

function getClientId() {
  const fromUrl = new URLSearchParams(window.location.search).get("clientId");
  if (fromUrl) {
    return fromUrl;
  }
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    clientId = createClientId();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

function getInitialAccess() {
  return { token: "dummy-token", username: "guest", expiresAt: Date.now() + 86400000 };
}

function clearStoredAccess() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(ACCESS_USER_KEY);
  localStorage.removeItem(ACCESS_EXPIRES_KEY);
}

function createClientId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getInitialRoomId() {
  const fromUrl = new URLSearchParams(window.location.search).get("room");
  return normalizeFixedRoom(fromUrl || localStorage.getItem(LAST_ROOM_KEY) || DEFAULT_ROOM_ID);
}

function normalizeFixedRoom(value) {
  const roomId = String(value || DEFAULT_ROOM_ID).trim().toUpperCase();
  return FIXED_ROOMS.includes(roomId) ? roomId : DEFAULT_ROOM_ID;
}

function normalizeGameMode(value) {
  const mode = String(value || "hextech").trim();
  return GAME_MODES.some((item) => item.value === mode) ? mode : "hextech";
}

function gameModeMeta(value) {
  return GAME_MODES.find((mode) => mode.value === normalizeGameMode(value)) || GAME_MODES[0];
}

function gameModeLabel(value) {
  return gameModeMeta(value).label;
}

function modeIcon(value, size = 17) {
  const mode = normalizeGameMode(value);
  if (mode === "anime") return <Film size={size} />;
  if (mode === "game") return <Gamepad2 size={size} />;
  if (mode === "childhood") return <Sparkles size={size} />;
  if (mode === "yingshi") return <Clapperboard size={size} />;
  return <Swords size={size} />;
}

function isMediaMode(value) {
  const mode = normalizeGameMode(value);
  return mode === "anime" || mode === "game" || mode === "childhood" || mode === "yingshi";
}

function homeModeDescription(value) {
  const mode = normalizeGameMode(value);
  if (mode === "anime") {
    return "从 Bangumi 动画题库中每次随机抽出 200 个候选，提示者查看题目详情，猜题者通过搜索、标签筛选和详情面板锁定答案。";
  }
  if (mode === "game") {
    return "从游戏题库中每次随机抽出 200 个候选，提示者查看游戏中文名、英文名和详情，猜题者通过搜索、标签筛选和详情面板锁定答案。";
  }
  if (mode === "childhood") {
    return "从童年动画题库中每次随机抽出 200 个候选，提示者查看豆瓣条目、评分和相关人物，猜题者通过名称、标签和人物搜索锁定答案。";
  }
  if (mode === "yingshi") {
    return "从 406 部影视题库中每次随机抽出 200 个候选，涵盖电影与剧集，提示者查看豆瓣条目详情，猜题者通过名称、标签、导演和演员搜索锁定答案。";
  }
  return "固定房间、四席准备、自动开局。主持人权限会保留在你的账号上，入座参赛或旁观都不影响右上角主持人面板。";
}

function mediaModeCopy(value) {
  const mode = normalizeGameMode(value);
  if (mode === "childhood") {
    return {
      itemLabel: "童年动画",
      poolTitle: "童年动画候选池",
      clueLabel: "提示童年动画",
      chooseLabel: "选择童年动画",
      searchPlaceholder: "名称、标签、相关人物",
      linkLabel: "打开豆瓣条目",
      emptyText: "没有匹配的童年动画"
    };
  }
  if (mode === "game") {
    return {
      itemLabel: "游戏",
      poolTitle: "游戏候选池",
      clueLabel: "提示游戏",
      chooseLabel: "选择游戏",
      searchPlaceholder: "中文名、英文名、标签、平台",
      linkLabel: "打开游戏详情",
      emptyText: "没有匹配的游戏"
    };
  }
  if (mode === "yingshi") {
    return {
      itemLabel: "影视",
      poolTitle: "阅片无数候选池",
      clueLabel: "提示影视",
      chooseLabel: "选择影视",
      searchPlaceholder: "名称、标签、导演、演员",
      linkLabel: "打开豆瓣条目",
      emptyText: "没有匹配的影视"
    };
  }
  return {
    itemLabel: "动画",
    poolTitle: "动画候选池",
    clueLabel: "提示动画",
    chooseLabel: "选择动画",
    searchPlaceholder: "名称、标签、角色",
    linkLabel: "打开 Bangumi 条目",
    emptyText: "没有匹配的动画"
  };
}

function optionScopeLabel(room) {
  if (room.gameMode === "anime") return `随机动画（${room.settings.optionCount}）`;
  if (room.gameMode === "game") return `随机游戏（${room.settings.optionCount}）`;
  if (room.gameMode === "childhood") return `随机童年动画（${room.settings.optionCount}）`;
  if (room.gameMode === "yingshi") return `随机影视（${room.settings.optionCount}）`;
  return `全部符文（${room.settings.optionCount}）`;
}

function findSeat(players, team, seatRole) {
  return players.find((player) => player.role === "contestant" && player.team === team && player.seatRole === seatRole);
}

function findGuessers(players, team) {
  return players.filter((player) => player.role === "contestant" && player.team === team && player.seatRole === "guesser");
}

function getRequiredSeatPlayers(room) {
  return room.players.filter((player) => player.role === "contestant" && player.team && player.seatRole);
}

function playerText(player) {
  const host = player.isAdmin ? "主持人 · " : "";
  if (player.role === "contestant") return `${host}${teamName(player.team)}${seatLabel(player.seatRole)}`;
  if (player.role === "admin") return `${host}主持人`;
  return `${host}观众`;
}

function teamName(team) {
  return TEAM_META[team]?.name || `${team || "-"} 队`;
}

function teamShortName(team) {
  return TEAM_META[team]?.shortName || team || "-";
}

function seatLabel(seatRole) {
  if (seatRole === "clue_giver") return "提示者";
  if (seatRole === "guesser") return "猜题者";
  return "未入座";
}

function phaseLabel(phase) {
  if (phase === "clue") return "提示输入";
  if (phase === "guess") return "猜题";
  if (phase === "round_over") return "本局结算";
  if (phase === "finished") return "比赛结束";
  return "等待";
}

function deriveViewState(room) {
  if (room.status === "waiting") return "waiting";
  if (room.status === "finished" || room.phase === "finished") return "game_over";
  if (room.phase === "round_over") return "round_result";
  if (room.phase === "guess") return "guessing";
  if (room.phase === "clue") return "clue_input";
  return "waiting";
}

function viewStateLabel(viewState, room) {
  if (room.status === "paused") return "暂停中";
  if (viewState === "waiting") return "等待";
  if (viewState === "clue_input") return "提示输入";
  if (viewState === "guessing") return "猜题中";
  if (viewState === "judging") return "判定中";
  if (viewState === "round_result") return "本局结算";
  if (viewState === "game_over") return "比赛结束";
  return phaseLabel(room.phase);
}

function stageHelpText(room) {
  if (room.phase === "clue") return `${teamName(room.currentTurnTeam)}提示者正在输入`;
  if (room.phase === "guess") return `${teamName(room.currentTurnTeam)}猜题者正在选择答案`;
  return "等待下一步";
}

function qualityClass(rarity) {
  if (rarity === "棱彩") return "quality-prismatic";
  if (rarity === "黄金") return "quality-gold";
  if (rarity === "白银") return "quality-silver";
  return "quality-unknown";
}

function buildMediaTagFilters(options, mode) {
  const ignored = mode === "anime" ? new Set(["日本", "TV"]) : mode === "childhood" || mode === "yingshi" ? new Set(["可播放"]) : new Set();
  const counts = new Map();
  for (const option of options || []) {
    for (const tag of option.tags || []) {
      const value = String(tag || "").trim();
      if (!value || ignored.has(value)) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || compareChinesePinyin(a[0], b[0]))
    .map(([tag]) => tag);
}

function mediaDetailItems(card) {
  if (!card) return [];
  if (card.mode === "game") return card.platforms || [];
  return (card.characters || []).map((character) => character.name).filter(Boolean);
}

function candidateDisplayName(option) {
  if (option.mode === "game") return option.chineseName || option.name;
  return option.name;
}

function GameNamePair({ card, compact = false }) {
  const chineseName = card?.chineseName || "";
  const englishName = card?.englishName || card?.name || "";
  return (
    <div className={compact ? "game-name-pair compact" : "game-name-pair"}>
      <span>中文名：{chineseName || "未收录"}</span>
      <span>英文名：{englishName || "未收录"}</span>
    </div>
  );
}

function formatScore(score) {
  const value = Number(score);
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(1)}分` : "暂无评分";
}

function formatCandidateMeta(option) {
  if (option.mode === "game") {
    const platforms = option.platforms || [];
    return platforms[0] || option.date || formatScore(option.score);
  }
  return formatScore(option.score);
}

function formatVotes(totalVotes) {
  const value = Number(totalVotes) || 0;
  if (!value) return "暂无人数";
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万人`;
  return `${value.toLocaleString("zh-CN")}人`;
}

function compareChinesePinyin(a, b) {
  return PINYIN_COLLATOR.compare(String(a ?? ""), String(b ?? ""));
}

function finalWinnerText(score) {
  if (score.A === score.B) return `比赛结束，双方 ${score.A}:${score.B} 战平`;
  const winner = score.A > score.B ? "A" : "B";
  return `比赛结束，${teamName(winner)}获胜，比分 ${score.A}:${score.B}`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

async function copyRoomLink(roomId, publicUrl = "") {
  const base = String(publicUrl || window.location.origin).replace(/\/+$/, "");
  const path = window.location.pathname === "/" ? "" : window.location.pathname;
  const url = `${base}${path}?room=${roomId}`;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
  }
  return url;
}

function AnnouncementModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content announcement-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="brand-mark"><Sparkles size={22} /></div>
          <h2>公告 & 玩法说明</h2>
          <button className="close-button" onClick={onClose} type="button">×</button>
        </div>
        <div className="modal-body">
          <section className="announcement-section">
            <h3>📖 双音节对抗赛玩法</h3>
            <p>
              提示者每次提示一个<strong>双音节词语</strong>，支持如<strong>“叠层”“平a”“13”“mm”</strong>等提示方式。
            </p>
            <p>
              猜题者需要在候选列表中找到并选中对应答案提交。<strong>双方队伍共享提示</strong>。
            </p>
          </section>
          
          <section className="announcement-section">
            <h3>🚀 v1.6 版本更新内容</h3>
            <ul>
              <li>📺 <strong>童年题库品质净化</strong>：从 811 条精简至 406 条核心热门与高评分作品，补齐 25 部作品首播年份，告别"未知日期"。</li>
              <li>🖼️ <strong>封面加载彻底修复</strong>：全部封面改为本地存储，彻底解决豆瓣防盗链导致的图片无法显示问题。</li>
              <li>💡 <strong>提示验证体验优化</strong>：提示不通过时错误信息直接显示在输入框左侧，不再跳到页面顶部。</li>
              <li>🔔 <strong>轮次指示灯</strong>：倒计时旁新增指示灯，轮到你提示或猜题时自动亮起，一目了然。</li>
              <li>🗂️ <strong>已删除条目归档</strong>：被筛除的条目及封面统一归档到 deleted 文件夹，方便后续恢复。</li>
            </ul>
          </section>

          <section className="announcement-section">
            <h3>🚀 v1.5 版本更新内容</h3>
            <ul>
              <li>🎮 <strong>题库品质全面净化</strong>：筛选并精简保留 388 款核心热门与高评分游戏，补齐 315 款游戏中文译名及 145 处空缺介绍，彻底消除乱码和英文缺失。</li>
              <li>🖼️ <strong>高清封面升级</strong>：接入 Steam 官方 CDN 更新 292 款高清封面图，彻底删除 549 张低清晰度及冗余的本地封面图片，显著优化图片加载质量。</li>
              <li>⚡ <strong>界面布局现代优化</strong>：输入区全局置底，新增左侧固定悬浮状态栏（实时展示倒计时与提示历史），彻底修复频繁入座/旁观拉伸大厅高度的视觉 Bug。</li>
              <li>🛡️ <strong>稳定性与限流放行</strong>：移除动态海报的懒加载以杜绝偶现白屏；对静态图片资源和 Socket 握手豁免 IP 限流计数，免除并发大流量下的 429 误判拦截。</li>
              <li>🔄 <strong>对局重置逻辑重构</strong>：重置房间时强制全员（除主持人外）重设为观众席并清空准备状态，保障新对局的整洁公平。</li>
            </ul>
          </section>

          <section className="announcement-section">
            <h3>🚀 v1.4 版本更新内容</h3>
            <ul>
              <li>🎉 新增游戏、童年经典动漫题库，玩法选择更多样。</li>
              <li>👥 支持 2v3 多人对决，最多支持 5v5 多人对抗。</li>
              <li>🏠 新增自定义房间功能，亲友组队更轻松。</li>
            </ul>
          </section>

          <section className="announcement-section warning-section">
            <h3>💡 提示</h3>
            <p>🌟 v1.6 已全面修复童年题库图片加载与日期缺失问题，祝您游戏愉快！</p>
          </section>
        </div>
        <div className="modal-footer">
          <button className="primary wide" onClick={onClose} type="button">我知道了</button>
        </div>
      </div>
    </div>
  );
}

function FeedbackModal({ onClose }) {
  const [nickname, setNickname] = useState(() => localStorage.getItem("hextech-duel-nickname") || "");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });

  async function handleSubmit(e) {
    e.preventDefault();
    const cleanNickname = nickname.trim();
    const cleanContent = content.trim();

    if (!cleanNickname) {
      setStatus({ type: "error", message: "请输入您的昵称" });
      return;
    }
    if (!cleanContent) {
      setStatus({ type: "error", message: "反馈内容不能为空" });
      return;
    }
    if (cleanContent.length < 5) {
      setStatus({ type: "error", message: "为了我们能更好理解，反馈内容请至少输入 5 个字" });
      return;
    }

    setSubmitting(true);
    setStatus({ type: "", message: "" });

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: cleanNickname, content: cleanContent }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "提交失败，请稍后再试");
      }

      setStatus({ type: "success", message: data.message || "感谢反馈！您的建议已成功提交。" });
      localStorage.setItem("hextech-duel-nickname", cleanNickname);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setStatus({ type: "error", message: err.message || "提交失败，网络异常" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content feedback-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="brand-mark"><Send size={22} /></div>
          <h2>BUG 反馈与建议</h2>
          <button className="close-button" onClick={onClose} type="button">×</button>
        </div>
        <form onSubmit={handleSubmit} className="feedback-form">
          <div className="modal-body">
            <label>
              您的昵称
              <input
                type="text"
                placeholder="请输入昵称"
                maxLength={16}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                disabled={submitting}
              />
            </label>
            <label>
              反馈与建议内容
              <textarea
                placeholder="请详细描述您遇到的 BUG、改进建议或其他想法..."
                maxLength={1000}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={submitting}
              />
            </label>

            {status.message && (
              <div className={`feedback-status ${status.type}`}>
                {status.message}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="primary wide submit-btn" type="submit" disabled={submitting}>
              {submitting ? "正在提交..." : "提交反馈"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
