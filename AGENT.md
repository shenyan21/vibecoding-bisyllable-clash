# 双音节对抗项目接手笔记 (Agent Developer Log)

本文件给 Codex / Antigravity Agent 接手项目时阅读使用。保持改动小范围，遵从 KISS 原则，修改前先读现有结构，不要回滚已有改动。

---

## 🎯 项目定位与架构

* **项目根目录**：`E:\codex_project\hextech-bisyllable-duel`
* **技术栈**：React + Vite 前端，Express + Socket.IO 实时通信服务端。
* **玩法模式**：共有 `海克斯玩法`、`谁是动漫糕手？`、`提示位别红温`、`不想长大` 四套题库/界面，共用一个房间架构。
* **队伍与席位**：A 队 `迅捷蟹队`，B 队 `石甲虫队`。每队最高 5 人（1 名提示者 + 最多 4 名猜题者），支持不平衡席位对局（如 2v3、5v5 等）。

---

## 🔑 免密安全与房间管理设计（最新重构）

项目已经从“凭证登录模式”彻底重构为**完全公开、匿名免密**的运营模式：

1. **废弃鉴权层**：
   * 删除了原有的 `server/accessControl.js` (包含密码 Hash、Token、Captcha 生成) 和 `server/rateLimiter.js` (IP 限流) 模块。
   * 移除了 `server/index.js` 中的 `/api/access/captcha` 与 `/api/access/login` 路由。
   * 服务端 Socket 拦截器 `requireAccess` 直接透传 `{ username: "guest" }` 作为缺省身份，不再校对 token。
   * 前端直接跳过了 `AccessScreen` 鉴权屏，默认以游客身份入座。

2. **动态房间生命周期**：
   * 废弃了写死内置房间 `HKS159`，现在仅保留内置的 `TEST` 房间。
   * 允许玩家在首页输入任意 `四位数房间号`（正则校验 `/^(TEST|\d{4})$/i`）进行动态建房。
   * **无人自动销毁机制**：
     当房间内所有玩家（包含参赛者与观众）均断开连接（离线、返回首页或关闭网页）时，`RoomStore.leaveRoom()` 会评估房间玩家数。若房间人数降为 0，该房间将立即从 `RoomStore` 内存中销毁清理。

3. **创建人即为 Host 机制**：
   * 取消了“夏如霜昵称强制为主持人”规则。
   * **先到先得**：任何房间内的第一位创建者/加入者会自动获得该房间的 `admin`（管理员/主持人）身份（`RoomStore.addOrUpdatePlayer()` 自动评估）。
   * **主持人顺位转移**：
     如果当前主持人在游戏期间主动离线或退房，服务端在 `RoomStore.leaveRoom()` 及 `RoomStore.ensureAdmin()` 中会自动推选剩下的在线玩家中最早入座/进入的玩家继承为新的 Host，以确保房间设置依然可被管理。

4. **公告窗（Modal）特性**：
   * 首页（`HomeScreen`）右上角拥有毛玻璃悬浮效果的 **“公告”** 触发按钮。
   * 首页检测到新会话加载时，会通过 `sessionStorage` 控制**自动弹出公告卡片**（仅在同一标签页的首次载入时弹出，刷新网页不重复弹出）。
   * 房间内（LobbyScreen/GameRoomScreen）已不再显示公告按钮，保持界面纯净度。

---

## ⚙️ 常用本地与部署命令

```powershell
# 运行单元测试
npm.cmd test

# 执行 Vite 生产环境打包并进行 Node 服务端语法校验
npm.cmd run check

# 本地启动开发环境 (默认监听 http://127.0.0.1:8787)
npm.cmd run dev
```

---

## 🌐 公网部署与重启 (SSH/SFTP 更新工作流)

* **公网域名**：`http://www.hextech-bisyllable-duel.com`
* **公网 IP**：`39.105.218.65`（用户密码由临时对话提供，不写入仓库）
* **服务器实例目录**：`C:\apps\hextech-bisyllable-duel`
* **服务运行机制**：使用 Windows Server 的任务计划程序 `HextechBisyllableDuel`，其底层调用 `scripts\start-ip80.cmd` 启动监听 80 端口的 `node.exe` 服务。

### 普通增量部署动作 (只同步 `src` 和 `server` 目录)：
1. 本地执行 `npm.cmd test` 与 `npm.cmd run check` 确保测试及打包绿过。
2. 通过 SSH/SFTP 将本地修改的 `src/` 与 `server/` 文件夹上传覆盖至服务器对应路径下。若有被删除的文件，亦需在服务器端执行对应删除（如 `server/accessControl.js` 与 `server/rateLimiter.js`）。
3. 远程执行以下命令完成前端编译与服务重启：
   ```powershell
   cd C:\apps\hextech-bisyllable-duel
   npm run build
   Stop-ScheduledTask -TaskName HextechBisyllableDuel
   Start-ScheduledTask -TaskName HextechBisyllableDuel
   ```
4. 执行 `Invoke-RestMethod -Uri http://127.0.0.1/api/public-config` 校验服务返回值是否正常。

---

## ⚠️ 避坑与不要再次尝试的路径 (Deprecated Paths)

1. **切勿尝试 WMI 或 WinRM 自动发布**：公网服务器的 WinRM/WMI 远程连接没有稳定放行，部署应始终使用 SSH/SFTP 流程。
2. **切勿只重启不停止计划任务**：Windows 计划任务机制为 `IgnoreNew`，如果已有 Node.exe 实例在 80 端口运行，只调用 `Start-ScheduledTask` 将不会发生任何更新。必须先 `Stop` 后 `Start`。
3. **不要把测试文件留在公网服务器**：发布完毕后清理无用的测试文件（如 `tests/`）及临时脚本以确保云服务器环境的纯净度。
4. **不要再次引入任何账号密码及鉴权模块**：项目已经被设定为“完全免密”模式，任何需要鉴权的 API 都是多余的。
