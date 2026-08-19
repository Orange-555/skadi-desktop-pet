const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, protocol } = require("electron");
const path = require("path");
const fs = require("fs");

// 自定义协议须在 app ready 前注册为 standard/secure, 否则 CSP 'self' 与 fetch 不可用
protocol.registerSchemesAsPrivileged([
  {
    scheme: "pet",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const ROOT = __dirname;
const PET_DIR = path.join(ROOT, "pet");
const ASSET_DIR = path.join(ROOT, "assets");
const ICON = path.join(ROOT, "icon.png");

const log = (...a) => {
  if (!process.env.DEBUG_PET) return;
  try { fs.appendFileSync(path.join(ROOT, "debug.log"), new Date().toISOString() + " " + a.join(" ") + "\n"); } catch (_) {}
};

let win = null;
let tray = null;
let trayState = null; // 由渲染进程同步的当前状态
let quiting = false;

// 兜底: 强制给窗口设置 WS_EX_TOOLWINDOW, 确保任务栏不显示图标
// (部分 Electron 版本 skipTaskbar 不设置该标志, 这里直接操作原生窗口)
function forceHideTaskbar(winRef) {
  try {
    if (!winRef || winRef.isDestroyed()) return;
    const hwnd = winRef.getNativeWindowHandle().readUInt32LE(0);
    const script =
      "Add-Type 'using System;using System.Runtime.InteropServices;public class TWX{[DllImport(\"user32.dll\")]public static extern int GetWindowLong(IntPtr h,int i);[DllImport(\"user32.dll\")]public static extern int SetWindowLong(IntPtr h,int i,int v);}';" +
      `$h=[IntPtr]${hwnd};$e=[TWX]::GetWindowLong($h,-20);[TWX]::SetWindowLong($h,-20,($e -bor 0x80))|Out-Null;`;
    const { spawn } = require("child_process");
    spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: "ignore",
      windowsHide: true,
    });
    log("toolwindow forced for hwnd " + hwnd);
  } catch (e) {
    log("forceHideTaskbar failed " + e.message);
  }
}

// ---------- 自定义协议: 服务 pet/ 与 assets/ 下的本地文件 ----------
app.whenReady().then(() => {
  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".skel": "application/octet-stream",
    ".atlas": "text/plain; charset=utf-8",
  };
  protocol.handle("pet", async (request) => {
    const u = new URL(request.url);
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    if (!rel) rel = "index.html";
    // pet://app/... → pet/ 目录; pet://app/assets/... → assets/ 目录
    const base = rel.startsWith("assets/") ? ASSET_DIR : PET_DIR;
    const relToBase = rel.startsWith("assets/") ? rel.slice("assets/".length) : rel;
    const file = path.normalize(path.join(base, relToBase));
    if (!file.startsWith(base)) return new Response("forbidden", { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    } catch (_) {
      return new Response("not found", { status: 404 });
    }
  });
});

function createWindow() {
  log("createWindow");  win = new BrowserWindow({
    width: 240,
    height: 300,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true, // 任务栏不显示, 仅托盘图标
    backgroundColor: "#00000000",
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 默认放到主显示器右下角
  const { workArea } = screen.getPrimaryDisplay();
  const saved = loadPos();
  const x = saved ? saved.x : workArea.x + workArea.width - 260;
  const y = saved ? saved.y : workArea.y + workArea.height - 330;
  win.setPosition(Math.round(x), Math.round(y));

  const initQ = process.env.PET_INIT || "";
  win.loadURL("pet://app/index.html" + (initQ ? "?" + initQ : ""));
  win.setAlwaysOnTop(true, "screen-saver");
  win.setSkipTaskbar(true); // 任务栏不显示, 仅托盘图标 (显式调用确保生效)
  setTimeout(() => forceHideTaskbar(win), 800); // 原生窗口就绪后强制 TOOLWINDOW 兜底

  // 调试/预览: CAPTURE_PET=1 时加载后截图保存并退出
  if (process.env.CAPTURE_PET) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const img1 = await win.webContents.capturePage();
          fs.writeFileSync(path.join(ROOT, "shot1.png"), img1.toPNG());
          if (process.env.CAPTURE_PET === "2") {
            setTimeout(async () => {
              const img2 = await win.webContents.capturePage();
              fs.writeFileSync(path.join(ROOT, "shot2.png"), img2.toPNG());
              log("two shots saved");
              app.exit(0);
            }, 3000);
          } else {
            fs.writeFileSync(path.join(ROOT, "screenshot.png"), img1.toPNG());
            log("screenshot saved");
            app.exit(0);
          }
        } catch (e) {
          log("capture failed " + e.message);
          app.exit(1);
        }
      }, 8000);
    });
  }

  win.on("close", () => {
    log("window close");
    savePos(win.getPosition());
  });
  win.on("closed", () => { log("window closed"); win = null; });
  win.webContents.on("render-process-gone", (_e, d) => log("renderer gone", JSON.stringify(d)));
  win.webContents.on("console-message", (_e, lvl, msg) => log("renderer:", lvl, msg));
  win.webContents.on("did-fail-load", (_e, code, desc) => log("did-fail-load", code, desc));
  log("window created");
}

// ---------- 位置记忆 ----------
const posFile = () => path.join(app.getPath("userData"), "pet-pos.json");
function loadPos() {
  try { return JSON.parse(fs.readFileSync(posFile(), "utf8")); } catch (_) { return null; }
}
function savePos([x, y]) {
  try { fs.writeFileSync(posFile(), JSON.stringify({ x, y })); } catch (_) {}
}

// ---------- IPC ----------
ipcMain.on("pet:move", (_e, { dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + (dx || 0)), Math.round(y + (dy || 0)));
  // 用户手动拖拽: 暂停自动巡走
  lastUserDrag = Date.now();
  if (walkInterval) { stopWalk(); scheduleWalk(); }
});
ipcMain.on("pet:set-always-top", (_e, v) => {
  if (win) win.setAlwaysOnTop(!!v, "screen-saver");
});
ipcMain.on("pet:quit", () => {
  quiting = true;
  app.quit();
});
ipcMain.on("pet:set-tray", (_e, s) => {
  trayState = s;
  rebuildTray();
});
// 渲染进程请求裁切窗口: 窗口跟随模型大小, 锚定模型底部中心屏幕位置不变
ipcMain.on("pet:set-bounds", (_e, { w, h, dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  const [nx, ny] = clampToDisplays(x + (dx || 0), y + (dy || 0));
  win.setBounds({
    x: nx,
    y: ny,
    width: Math.max(40, Math.round(w || 40)),
    height: Math.max(40, Math.round(h || 40)),
  });
  log("set-bounds dx=" + dx + " dy=" + dy + " → pos " + nx + "," + ny + " size " + Math.round(w) + "x" + Math.round(h));
  followDialog();
});
// 余额浮窗: 点击桌宠切换显示/隐藏 (打开时再点则关闭)
ipcMain.on("pet:open-dialog", () => {
  if (dialogWin && !dialogWin.isDestroyed()) {
    dialogWin.close(); // 已显示 → 再次点击消失
  } else {
    showDialog();      // 未显示 → 点击出现
  }
});
ipcMain.on("pet:dialog-action", (_e, t) => {
  if (t === "play-random" && win && !win.isDestroyed())
    win.webContents.send("pet:play-random");
  if (t === "close-dialog" && dialogWin && !dialogWin.isDestroyed())
    dialogWin.close();
});
ipcMain.handle("pet:get-state", () => trayState);
ipcMain.handle("pet:get-visible", () => !!win && win.isVisible());

// 余额浮窗跟随人物: 每次桌宠窗口移动/缩放后, 把浮窗贴到人物上方
function followDialog() {
  if (!dialogWin || dialogWin.isDestroyed() || !win || win.isDestroyed()) return;
  if (!dialogWin.isVisible()) return;
  const { workArea } = screen.getPrimaryDisplay();
  const [px, py] = win.getPosition();
  const [pw, ph] = win.getSize();
  const [dw, dh] = dialogWin.getSize();
  let dx = Math.round(px + (pw - dw) / 2); // 水平居中于人物
  let dy = Math.round(py - dh - 6);        // 人物上方
  if (dy < workArea.y) dy = py + ph + 6;   // 上方放不下 → 下方
  if (dy + dh > workArea.y + workArea.height) dy = Math.max(workArea.y, py + ph + 6);
  dx = Math.min(Math.max(dx, workArea.x + 4), workArea.x + workArea.width - dw - 4);
  dialogWin.setPosition(dx, dy);
}

// 位置安全钳制: 防止任何异常值把窗口移到屏幕外/无穷远
function clampToDisplays(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    // 非法数值 → 回到当前有效位置
    if (win && !win.isDestroyed()) {
      const [cx, cy] = win.getPosition();
      return [Number.isFinite(cx) ? cx : 0, Number.isFinite(cy) ? cy : 0];
    }
    return [0, 0];
  }
  const ds = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of ds) {
    minX = Math.min(minX, d.workArea.x);
    minY = Math.min(minY, d.workArea.y);
    maxX = Math.max(maxX, d.workArea.x + d.workArea.width);
    maxY = Math.max(maxY, d.workArea.y + d.workArea.height);
  }
  const [ww, wh] = win && !win.isDestroyed() ? win.getSize() : [240, 300];
  return [
    Math.round(Math.min(Math.max(x, minX), Math.max(minX, maxX - ww))),
    Math.round(Math.min(Math.max(y, minY), Math.max(minY, maxY - wh))),
  ];
}

// ---------- IPC ----------
let dragOffset = null; // 拖拽时: 光标相对窗口的抓取偏移
ipcMain.on("pet:drag-start", (_e, { sx, sy }) => {
  if (win) {
    const [wx, wy] = win.getPosition();
    dragOffset = { x: sx - wx, y: sy - wy };
  }
  // 用户开始拖拽: 立即暂停自动巡走
  lastUserDrag = Date.now();
  if (walkInterval) { stopWalk(); scheduleWalk(); }
});
ipcMain.on("pet:drag-move", (_e, { sx, sy }) => {
  if (!win || !dragOffset) return;
  // 绝对定位: 窗口 = 光标 - 抓取偏移 (无累积误差, 事件稀疏也能跟到位)
  const [nx, ny] = clampToDisplays(sx - dragOffset.x, sy - dragOffset.y);
  win.setPosition(nx, ny);
  followDialog();
});
ipcMain.on("pet:drag-end", () => {
  dragOffset = null;
});
ipcMain.on("pet:move", (_e, { dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  const [nx, ny] = clampToDisplays(x + (dx || 0), y + (dy || 0));
  win.setPosition(nx, ny);
  followDialog();
  // 用户手动拖拽: 暂停自动巡走
  lastUserDrag = Date.now();
  if (walkInterval) { stopWalk(); scheduleWalk(); }
});

// ---------- 自动巡走 (活动范围: 除任务栏外的整个桌面 = 系统工作区) ----------
let walkTimer = null;
let walkInterval = null;
let lastUserDrag = 0;
const WALK_SPEED = 130; // px/s
const WALK_MARGIN = 12;

// 所有显示器工作区的并集 (巡走范围, 自动排除任务栏)
function walkBounds() {
  const [ww, wh] = win ? win.getSize() : [240, 300];
  const ds = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of ds) {
    minX = Math.min(minX, d.workArea.x + WALK_MARGIN);
    minY = Math.min(minY, d.workArea.y + WALK_MARGIN);
    maxX = Math.max(maxX, d.workArea.x + d.workArea.width - ww - WALK_MARGIN);
    maxY = Math.max(maxY, d.workArea.y + d.workArea.height - wh - WALK_MARGIN);
  }
  return { minX, minY, maxX, maxY };
}

function stopWalk() {
  if (walkInterval) { clearInterval(walkInterval); walkInterval = null; }
  if (win && !win.isDestroyed()) win.webContents.send("pet:walk", { moving: false });
}

// 方向式漫游: 随机方向匀速行走, 撞到桌面边界自动掉头 (反弹), 走一段后停下休息
function startWalk() {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) { scheduleWalk(); return; }
  const { minX, minY, maxX, maxY } = walkBounds();
  if (maxX <= minX || maxY <= minY) { scheduleWalk(); return; }
  let angle = Math.random() * Math.PI * 2;
  let vx = Math.cos(angle);
  let vy = Math.sin(angle);
  // 方向太接近竖直/水平也无妨; 避免无限贴近某方向
  if (Math.abs(vx) < 0.15) vx = vx < 0 ? -0.15 : 0.15;
  if (Math.abs(vy) < 0.15) vy = vy < 0 ? -0.15 : 0.15;
  const dur = 6000 + Math.random() * 10000; // 走 6~16s
  const t0 = Date.now();
  let [x, y] = win.getPosition();
  const sendDir = () => win.webContents.send("pet:walk", { moving: true, vx });
  log("walk start dir " + vx.toFixed(2) + "," + vy.toFixed(2) + " dur " + (dur / 1000).toFixed(1) + "s");
  sendDir();
  walkInterval = setInterval(() => {
    if (!win || win.isDestroyed()) { stopWalk(); return; }
    if (!win.isVisible()) { stopWalk(); scheduleWalk(); return; }
    if (Date.now() - t0 >= dur) { stopWalk(); scheduleWalk(); return; }
    const step = (WALK_SPEED * 50) / 1000; // 每 50ms 的步长
    let nx = x + vx * step;
    let ny = y + vy * step;
    let bounced = false;
    // 边界掉头: 越过边界则反弹方向, 位置钳在边界上
    if (nx < minX) { nx = minX; vx = Math.abs(vx); bounced = true; }
    else if (nx > maxX) { nx = maxX; vx = -Math.abs(vx); bounced = true; }
    if (ny < minY) { ny = minY; vy = Math.abs(vy); }
    else if (ny > maxY) { ny = maxY; vy = -Math.abs(vy); }
    x = nx; y = ny;
    win.setPosition(Math.round(x), Math.round(y));
    followDialog(); // 浮窗跟随人物
    if (bounced) sendDir(); // 水平掉头 → 通知渲染层翻转朝向
  }, 50);
}

function scheduleWalk() {
  clearTimeout(walkTimer);
  const delay = 12000 + Math.random() * 18000; // 走完休息 12~30s
  walkTimer = setTimeout(() => {
    // 用户刚手动拖过, 稍后再自动走
    if (Date.now() - lastUserDrag < 8000) { scheduleWalk(); return; }
    startWalk();
  }, delay);
}

// ---------- DeepSeek API 余额 ----------
const BALANCE_POLL_MS = 60000;
let balanceData = null;

function deepseekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    const y = fs.readFileSync(
      path.join(require("os").homedir(), ".dsh", ".credentials.yaml"),
      "utf8",
    );
    const m = y.match(/DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s]+)/);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

async function fetchBalance() {
  const key = deepseekKey();
  if (!key) return null;
  try {
    const r = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: "Bearer " + key, Accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    balanceData = {
      available: !!j.is_available,
      ts: Date.now(),
      infos: (j.balance_infos || []).map((i) => ({
        currency: i.currency,
        total: parseFloat(i.total_balance || 0),
        granted: parseFloat(i.granted_balance || 0),
        toppedUp: parseFloat(i.topped_up_balance || 0),
      })),
    };
    return balanceData;
  } catch (_) {
    return null;
  }
}

function pushBalance() {
  if (!balanceData) return;
  if (win && !win.isDestroyed()) win.webContents.send("pet:balance", balanceData);
  if (dialogWin && !dialogWin.isDestroyed()) dialogWin.webContents.send("pet:balance", balanceData);
}

ipcMain.handle("pet:get-balance", async () => {
  if (balanceData && Date.now() - balanceData.ts < BALANCE_POLL_MS)
    return balanceData;
  return await fetchBalance();
});

// ---------- 余额/信息对话框 ----------
let dialogWin = null;
function showDialog() {
  if (dialogWin && !dialogWin.isDestroyed()) {
    dialogWin.show();
    dialogWin.focus();
    return;
  }
  dialogWin = new BrowserWindow({
    width: 180,
    height: 64,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  dialogWin.loadURL("pet://app/dialog.html");
  dialogWin.setSkipTaskbar(true);
  setTimeout(() => forceHideTaskbar(dialogWin), 800);
  dialogWin.on("closed", () => { dialogWin = null; });
  // 跟随人物: 打开后贴到人物上方
  setTimeout(() => followDialog(), 200);
  // 调试: CAPTURE_DIALOG=1 时截图对话框后退出
  if (process.env.CAPTURE_DIALOG) {
    dialogWin.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const info = await dialogWin.webContents.executeJavaScript(
            `({ w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth,
               sh: document.documentElement.scrollHeight, bg: getComputedStyle(document.body).backgroundColor,
               total: (document.getElementById('total')||{}).textContent })`,
          );
          log("dialog info " + JSON.stringify(info) + " winSize " + JSON.stringify(dialogWin.getSize()) + " bounds " + JSON.stringify(dialogWin.getBounds()));
          const img = await dialogWin.webContents.capturePage();
          fs.writeFileSync(path.join(ROOT, "shot_dialog.png"), img.toPNG());
          log("dialog screenshot saved " + img.getSize().width + "x" + img.getSize().height);
        } catch (e) {
          log("dialog capture failed " + e.message);
        }
        app.exit(0);
      }, 2000);
    });
  }
}

// ---------- 托盘 ----------
function sendToRenderer(msg) {
  if (win && !win.isDestroyed()) win.webContents.send("tray:action", msg);
}

function rebuildTray() {
  if (!tray || !trayState) return;
  const s = trayState;
  const template = [
    { label: `斯卡蒂 · ${s.skin}`, enabled: false },
    { type: "separator" },
    {
      label: "时装",
      submenu: s.skins.map((k) => ({
        label: k,
        type: "radio",
        checked: k === s.skin,
        click: () => sendToRenderer({ type: "skin", value: k }),
      })),
    },
    // 模型组已合并: 站立用正面模型, 移动时自动切换基建模型并播 Move 动画
    {
      label: "动画",
      submenu: (s.anims || []).map((k) => ({
        label: k + (k === s.anim ? " ✓" : ""),
        type: "radio",
        checked: k === s.anim,
        click: () => sendToRenderer({ type: "anim", value: k }),
      })),
    },
    {
      label: "尺寸",
      submenu: [0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => ({
        label: `${Math.round(v * 100)}%`,
        type: "radio",
        checked: Math.abs(v - s.scale) < 1e-6,
        click: () => sendToRenderer({ type: "scale", value: String(v) }),
      })),
    },
    { type: "separator" },
    {
      label: "显示 / 隐藏",
      click: () => {
        if (!win) return;
        if (win.isVisible()) win.hide();
        else win.show();
      },
    },
    {
      label: "退出",
      click: () => { quiting = true; app.quit(); },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(`斯卡蒂桌宠 — ${s.skin} / ${s.model} / ${s.anim}`);
}

// ---------- 启动 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) { win.show(); win.focus(); }
  });
  app.whenReady().then(() => {
    log("whenReady 2");
    tray = new Tray(nativeImage.createFromPath(ICON));
    tray.on("click", () => {
      if (!win) return;
      if (win.isVisible()) {
        win.hide();
        stopWalk();
        if (dialogWin && !dialogWin.isDestroyed()) dialogWin.hide();
      } else {
        win.show();
        scheduleWalk();
        if (dialogWin && !dialogWin.isDestroyed()) { dialogWin.show(); followDialog(); }
      }
    });
    createWindow();
    scheduleWalk(); // 启动后开始自动巡走
    // 调试: PET_OPEN_DIALOG=1 时启动即打开余额浮窗
    if (process.env.PET_OPEN_DIALOG) {
      win.webContents.once("did-finish-load", () => setTimeout(showDialog, 3000));
    }
    // 调试: CAPTURE_DIALOG=1 时自动打开对话框用于截图
    if (process.env.CAPTURE_DIALOG) {
      win.webContents.once("did-finish-load", () => {
        setTimeout(() => showDialog(), 4000);
      });
    }
    // 余额: 启动即拉取, 之后每分钟刷新
    fetchBalance().then(pushBalance);
    setInterval(async () => {
      await fetchBalance();
      pushBalance();
    }, BALANCE_POLL_MS);
  });
  app.on("window-all-closed", () => {
    // 桌宠常驻: 关闭窗口不退出 (通过托盘退出)
  });
}
