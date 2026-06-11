import express from "express";
import http from "node:http";
import nodemailer from "nodemailer";
import path from "node:path";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import { getAnimeStaticDir, loadAnimeCards } from "./animeCards.js";
import { getChildhoodStaticDir, loadChildhoodCards } from "./childhoodCards.js";
import { getGameStaticDir, loadGameCards } from "./gameCards.js";
import { getHextechStaticDir, loadHexCards } from "./hexCards.js";
import { getYingshiStaticDir, loadYingshiCards } from "./yingshiCards.js";
import { DEFAULT_ROOM_ID, RoomStore } from "./roomStore.js";

const PORT = Number(process.env.PORT || 8787);
const isProduction = process.env.NODE_ENV === "production";
const cards = loadHexCards();
const animeCards = loadAnimeCards();
const gameCards = loadGameCards();
const childhoodCards = loadChildhoodCards();
const yingshiCards = loadYingshiCards();
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

if (PORT === 80) {
  try {
    const secondaryServer = http.createServer(app);
    io.attach(secondaryServer);
    secondaryServer.listen(8787, () => {
      console.log("Secondary Hextech duel server listening on port 8787");
    });
  } catch (err) {
    console.error("Failed to start secondary server on 8787:", err.message);
  }
}

const store = new RoomStore({ hextech: cards, anime: animeCards, game: gameCards, childhood: childhoodCards, yingshi: yingshiCards });

// 基于内存的轻量级 IP 限流防刷器
const ipLimits = new Map();
setInterval(() => {
  ipLimits.clear();
}, 60000); // 每分钟清空计数

app.use((req, res, next) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  
  // 排除静态文件与素材请求，避免图片加载被限流拦截
  const path = req.path;
  if (
    path.startsWith("/anime/") ||
    path.startsWith("/game/") ||
    path.startsWith("/childhood/") ||
    path.startsWith("/yingshi/") ||
    path.startsWith("/hextech/") ||
    path.startsWith("/assets/") ||
    path.startsWith("/socket.io/") ||
    path === "/favicon.ico"
  ) {
    return next();
  }

  const count = ipLimits.get(ip) || 0;
  if (count > 300) { // 每个 IP 每分钟最多 300 次 API/页面请求
    res.status(429).send("Too Many Requests (您的请求过于频繁，已被系统防御性拦截，请一分钟后再试)");
    return;
  }
  ipLimits.set(ip, count + 1);
  next();
});

app.use(express.json({ limit: "16kb" }));
app.use("/hextech", express.static(getHextechStaticDir()));
app.use("/anime", express.static(getAnimeStaticDir()));
app.use("/game", express.static(getGameStaticDir()));
app.use("/childhood", express.static(getChildhoodStaticDir()));
app.use("/yingshi", express.static(getYingshiStaticDir()));
app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});
app.get("/api/cards/count", (req, res) => {
  res.json({ count: cards.length, hextech: cards.length, anime: animeCards.length, game: gameCards.length, childhood: childhoodCards.length, yingshi: yingshiCards.length });
});
app.get("/api/anime/posters", (req, res) => {
  const limit = clampInt(req.query.limit, 24, 160, 96);
  res.json({
    posters: animeCards.slice(0, limit).map((card) => ({
      id: card.id,
      name: card.name,
      image: card.image,
      score: card.score,
      date: card.date
    }))
  });
});
app.get("/api/game/posters", (req, res) => {
  const limit = clampInt(req.query.limit, 24, 160, 96);
  res.json({
    posters: gameCards.slice(0, limit).map((card) => ({
      id: card.id,
      name: card.name,
      image: card.image,
      score: card.score,
      date: card.date
    }))
  });
});
app.get("/api/childhood/posters", (req, res) => {
  const limit = clampInt(req.query.limit, 24, 160, 96);
  res.json({
    posters: childhoodCards.slice(0, limit).map((card) => ({
      id: card.id,
      name: card.name,
      image: card.image,
      score: card.score,
      date: card.date
    }))
  });
});
app.get("/api/yingshi/posters", (req, res) => {
  const limit = clampInt(req.query.limit, 24, 160, 96);
  res.json({
    posters: yingshiCards.slice(0, limit).map((card) => ({
      id: card.id,
      name: card.name,
      image: card.image,
      score: card.score,
      date: card.date
    }))
  });
});
  app.post("/api/feedback", async (req, res) => {
    const { nickname, content } = req.body;
    const cleanNickname = String(nickname || "").trim();
    const cleanContent = String(content || "").trim();

    if (!cleanNickname || !cleanContent) {
      return res.status(400).json({ error: "昵称和反馈内容不能为空" });
    }

    console.log(`[Feedback] 收到建议/BUG反馈 - 昵称: ${cleanNickname}, 内容: ${cleanContent}`);

    const smtpUser = process.env.SMTP_USER || "";
    const smtpPass = process.env.SMTP_PASS || ""; // 授权码
    const smtpHost = process.env.SMTP_HOST || "smtp.qq.com";
    const smtpPort = parseInt(process.env.SMTP_PORT || "465");

    if (!smtpUser || !smtpPass) {
      console.warn("[Feedback] 未配置环境变量 SMTP_USER 或 SMTP_PASS，跳过邮件发送。反馈已记录在控制台。");
      return res.json({ 
        ok: true, 
        message: "反馈提交成功！(当前服务器未配置发信邮箱，已记录在系统后台)" 
      });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });

      await transporter.sendMail({
        from: `"反馈系统" <${smtpUser}>`,
        to: "2326138323@qq.com",
        subject: `【双音节猜题反馈】来自 ${cleanNickname} 的反馈`,
        text: `用户昵称: ${cleanNickname}\n反馈内容:\n${cleanContent}`,
        html: `
          <div style="padding: 20px; font-family: sans-serif; background: #0b1725; color: #eef6ff; border-radius: 8px; border: 1px solid rgba(123, 151, 184, 0.26);">
            <h2 style="color: #12d7d0; margin-bottom: 20px; border-bottom: 1px solid rgba(123, 151, 184, 0.16); padding-bottom: 10px;">双音节猜题 - 新反馈提示</h2>
            <p style="margin: 10px 0;"><strong style="color: #91a7bc;">用户昵称：</strong> ${cleanNickname}</p>
            <p style="margin: 10px 0;"><strong style="color: #91a7bc;">反馈内容：</strong></p>
            <div style="background: #07111d; padding: 15px; border: 1px solid rgba(123, 151, 184, 0.26); border-radius: 6px; white-space: pre-wrap; color: #eef6ff; font-size: 14px; line-height: 1.6;">${cleanContent}</div>
            <hr style="border: none; border-top: 1px solid rgba(123, 151, 184, 0.16); margin: 20px 0;" />
            <small style="color: #5f7488; display: block; text-align: center;">此邮件由系统自动发出，请勿直接回复。</small>
          </div>
        `
      });

      return res.json({ ok: true, message: "反馈提交成功，邮件已即时发送给开发者！" });
    } catch (error) {
      console.error("[Feedback] 邮件发送失败:", error);
      return res.status(500).json({ error: `提交失败，邮件发送异常: ${error.message}` });
    }
  });

  app.get("/api/public-config", (req, res) => {
    const host = req.headers.host;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  let baseUrl = "";
  if (host) {
    baseUrl = `${protocol}://${host}`;
  } else {
    baseUrl = getPublicBaseUrl();
  }
  res.json({
    publicBaseUrl: normalizeBaseUrl(baseUrl)
  });
});



if (!isProduction) {
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      allowedHosts: true,
      hmr: { server: httpServer }
    },
    appType: "spa"
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static("dist"));
}

store.setChangeHandler((roomId) => emitRoom(roomId));

io.on("connection", (socket) => {
  // 安全防护：限制最大同时在线人数（35人）及单 IP 并发连接（5个）
  const MAX_CONCURRENT_USERS = 35;
  const activeCount = io.sockets.sockets.size;
  if (activeCount > MAX_CONCURRENT_USERS) {
    socket.emit("error", "服务器当前已满员（最大允许 35 人同时在线），请稍后再试！");
    socket.disconnect(true);
    return;
  }

  const clientIp = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address || "unknown";
  let ipConnCount = 0;
  for (const [_, s] of io.sockets.sockets) {
    const sIp = s.handshake.headers["x-forwarded-for"] || s.handshake.address || "unknown";
    if (sIp === clientIp) {
      ipConnCount++;
    }
  }
  if (ipConnCount > 5) {
    socket.emit("error", "您的网络连接数过于频繁，单 IP 最大允许 5 个连接！");
    socket.disconnect(true);
    return;
  }

  socket.on("room:create", (payload, reply) => {
    run(reply, () => {
      const access = requireAccess(payload);
      socket.data.accessUser = access.username;
      
      const nickname = String(payload.nickname || "").trim();
      validateNickname(nickname);

      const room = store.createRoom({
        clientId: requireClientId(payload),
        nickname,
        role: payload.role || "admin",
        gameMode: payload.gameMode,
        socketId: socket.id,
        accessUser: access.username
      });
      socket.data.clientId = payload.clientId;
      socket.data.roomId = room.id;
      socket.join(room.id);
      emitRoom(room.id);
      return { roomId: room.id };
    });
  });

  socket.on("room:join", (payload, reply) => {
    run(reply, () => {
      const access = requireAccess(payload);
      socket.data.accessUser = access.username;
      
      const roomId = String(payload.roomId || DEFAULT_ROOM_ID).trim().toUpperCase();
      validateRoomId(roomId);
      const nickname = String(payload.nickname || "").trim();
      validateNickname(nickname);

      const room = store.joinRoom({
        roomId,
        clientId: requireClientId(payload),
        nickname,
        role: payload.role || "spectator",
        gameMode: payload.gameMode,
        socketId: socket.id,
        accessUser: access.username
      });
      socket.data.clientId = payload.clientId;
      socket.data.roomId = room.id;
      socket.join(room.id);
      emitRoom(room.id);
      return { roomId: room.id };
    });
  });

  socket.on("room:reconnect", (payload, reply) => {
    run(reply, () => {
      const access = requireAccess(payload);
      socket.data.accessUser = access.username;
      
      const roomId = String(payload.roomId || DEFAULT_ROOM_ID).trim().toUpperCase();
      validateRoomId(roomId);

      const room = store.reconnect({
        roomId,
        clientId: requireClientId(payload),
        socketId: socket.id
      });
      socket.data.clientId = payload.clientId;
      socket.data.roomId = room.id;
      socket.join(room.id);
      emitRoom(room.id);
      return { roomId: room.id };
    });
  });

  socket.on("room:leave", (payload, reply) => {
    run(reply, () => {
      const roomId = socket.data.roomId;
      const room = socket.data.clientId ? store.leaveRoom(socket.data.clientId) : null;
      if (roomId) socket.leave(roomId);
      socket.data.clientId = null;
      socket.data.roomId = null;
      if (room) emitRoom(room.id);
      return {};
    });
  });

  socket.on("player:seat", (payload, reply) => {
    run(reply, () => {
      const room = store.setPlayerSeat(requireSocketClient(socket), payload || {});
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("player:spectator", (payload, reply) => {
    run(reply, () => {
      const room = store.setSpectator(requireSocketClient(socket));
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("player:ready", (payload, reply) => {
    run(reply, () => {
      const room = store.setReady(requireSocketClient(socket), Boolean(payload?.ready));
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("admin:settings", (payload, reply) => {
    run(reply, () => {
      const room = store.updateSettings(requireSocketClient(socket), payload);
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("admin:assign", (payload, reply) => {
    run(reply, () => {
      const room = store.assignPlayer(requireSocketClient(socket), payload.targetId, payload.assignment || {});
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("admin:kick", (payload, reply) => {
    run(reply, () => {
      const room = store.kickPlayer(requireSocketClient(socket), payload.targetId);
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("game:start", (payload, reply) => {
    run(reply, () => {
      const room = store.startGame(requireSocketClient(socket));
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("game:pause", (payload, reply) => {
    run(reply, () => {
      const room = store.pauseGame(requireSocketClient(socket));
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("game:resume", (payload, reply) => {
    run(reply, () => {
      const room = store.resumeGame(requireSocketClient(socket));
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("game:reset", (payload, reply) => {
    run(reply, () => {
      const room = store.resetRoom(requireSocketClient(socket));
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("game:nextRound", (payload, reply) => {
    run(reply, () => {
      const room = store.adminNextRound(requireSocketClient(socket));
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("game:changeCard", (payload, reply) => {
    run(reply, () => {
      const room = store.adminChangeCard(requireSocketClient(socket));
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("turn:changeCard", (payload, reply) => {
    run(reply, () => {
      const room = store.clueGiverChangeCard(requireSocketClient(socket));
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("turn:clue", (payload, reply) => {
    run(reply, () => {
      const room = store.submitClue(requireSocketClient(socket), payload.clue);
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("turn:guess", (payload, reply) => {
    run(reply, () => {
      const room = store.submitGuess(requireSocketClient(socket), payload.answerId);
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("options:filter", (payload, reply) => {
    run(reply, () => {
      const room = store.setOptionQualityFilter(requireSocketClient(socket), payload?.quality);
      emitRoom(room.id);
      return {};
    });
  });

  socket.on("disconnect", () => {
    if (!socket.data.clientId) return;
    const room = store.disconnect(socket.data.clientId);
    if (room) emitRoom(room.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Hextech duel server: http://127.0.0.1:${PORT}`);
});

function emitRoom(roomId) {
  const room = store.getRoom(roomId);
  if (!room) return;
  for (const player of room.players) {
    if (!player.socketId || !player.online) continue;
    io.to(player.socketId).emit("room:state", store.getClientState(roomId, player.id));
  }
}

function run(reply, fn) {
  try {
    const data = fn();
    if (typeof reply === "function") reply({ ok: true, ...data });
  } catch (error) {
    if (typeof reply === "function") reply({ ok: false, error: error.message });
  }
}

function requireClientId(payload) {
  const clientId = String(payload?.clientId || "").trim();
  if (!clientId) throw new Error("缺少玩家标识");
  return clientId;
}

function requireSocketClient(socket) {
  if (!socket.data.clientId) throw new Error("尚未加入房间");
  return socket.data.clientId;
}

function requireAccess(payload) {
  return { username: "guest" };
}

function getPublicBaseUrl() {
  return normalizeBaseUrl(process.env.PUBLIC_BASE_URL) || "http://39.105.218.65";
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function validateRoomId(roomId) {
  if (!/^(TEST|\d{4})$/.test(roomId)) {
    throw new Error("无效的房间号，限4位数字");
  }
}

function validateNickname(nickname) {
  if (!nickname || nickname.length > 16) {
    throw new Error("昵称长度限制为1-16位");
  }
  if (/[<>&"'/]/u.test(nickname)) {
    throw new Error("昵称中不能包含特殊字符");
  }
}
