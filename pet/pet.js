/* 斯卡蒂桌宠 — 模型与动画来自 PRTS 干员模型页 (Spine 3.8) */
(function () {
  "use strict";

  const CONFIG = window.SKADI_CONFIG;
  const bridge = window.petBridge || null;

  // ---------- DOM ----------
  const canvas = document.getElementById("pet");
  const stage = document.getElementById("stage");
  const toolbar = document.getElementById("toolbar");
  const selSkin = document.getElementById("selSkin");
  const selModel = document.getElementById("selModel");
  const selAnim = document.getElementById("selAnim");
  const selScale = document.getElementById("selScale");
  const btnPin = document.getElementById("btnPin");
  const btnQuit = document.getElementById("btnQuit");

  // ---------- 状态 ----------
  const qp = new URLSearchParams(location.search); // 可用 ?skin=&model= 指定初始模型 (调试)
  const state = {
    skin: qp.get("skin") || localStorage.getItem("skadiPet.skin") || Object.keys(CONFIG.skins)[0],
    model: qp.get("model") || localStorage.getItem("skadiPet.model") || "正面",
    anim: null,
    scale: parseFloat(localStorage.getItem("skadiPet.scale") || "0.5"),
    pinned: localStorage.getItem("skadiPet.pinned") !== "0",
  };
  if (!CONFIG.skins[state.skin]) state.skin = Object.keys(CONFIG.skins)[0];
  if (!CONFIG.skins[state.skin][state.model]) state.model = Object.keys(CONFIG.skins[state.skin])[0];

  // ---------- Spine 渲染 ----------
  const spine = window.spine;
  let gl = null,
    context = null,
    shader = null,
    batcher = null,
    mvp = null,
    renderer = null,
    assetManager = null;
  let skeleton = null,
    skelData = null,
    animState = null,
    anims = [];
  let playing = false;
  let lastFrame = 0;
  let activeAction = null; // 正在播放的一次性动作名
  let busy = false;
  let loopListener = null; // 当前循环动画的入队监听器
  let walking = false;     // 自动巡走中 (窗口由主进程移动, 暂停裁切)
  let facing = 1;          // 朝向: 1=右 (正), -1=左 (反)
  let cssW = 1, cssH = 1;  // 画布当前 CSS 尺寸 (由窗口裁剪逻辑维护)

  function initGL() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(stage.clientWidth));
    const h = Math.max(1, Math.floor(stage.clientHeight));
    cssW = w; cssH = h;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";

    if (!gl) {
      gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true }) ||
        canvas.getContext("experimental-webgl", { alpha: true });
      if (!gl) throw new Error("WebGL 不可用");
      context = new spine.webgl.ManagedWebGLRenderingContext(canvas, {
        alpha: true,
      });
      shader = spine.webgl.Shader.newTwoColoredTextured(context);
      batcher = new spine.webgl.PolygonBatcher(context);
      mvp = new spine.webgl.Matrix4();
      renderer = new spine.webgl.SkeletonRenderer(context);
      renderer.premultipliedAlpha = true;
      assetManager = new spine.webgl.AssetManager(context);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    // 世界坐标: x∈[0,w], y∈[0,h] → y=0 在画布底部 (模型脚底贴地)
    mvp.ortho2d(0, 0, w, h);
    return { w, h, dpr };
  }

  // ---------- 加载模型 ----------
  function modelFile(skin, model) {
    return CONFIG.base + CONFIG.skins[skin][model];
  }

  function loadAssets(fileBase) {
    const skelPath = fileBase + ".skel";
    const atlasPath = fileBase + ".atlas";
    // .skel: 自定义协议下 XHR arraybuffer 不可用, 改用 fetch + blob: 注入资源管理器
    const skelPromise = fetch(skelPath)
      .then((r) => {
        if (!r.ok) throw new Error("加载骨架失败 HTTP " + r.status);
        return r.arrayBuffer();
      })
      .then(
        (buf) =>
          new Promise((resolve, reject) => {
            const url = URL.createObjectURL(new Blob([buf]));
            assetManager.setRawDataURI(skelPath, url);
            assetManager.loadBinary(skelPath, () => resolve(), (p, e) =>
              reject(new Error("加载骨架失败 " + e)),
            );
          }),
      );
    // .atlas + 贴图: 由资源管理器加载 (文本 XHR 正常)
    const atlasPromise = new Promise((resolve, reject) => {
      assetManager.loadTextureAtlas(atlasPath, () => resolve(), (p, e) =>
        reject(new Error("加载贴图集失败 " + e)),
      );
    });
    return Promise.all([skelPromise, atlasPromise]);
  }

  // 模型缓存: 正面/基建 切换即时生效, 无需重复下载
  const modelCache = {};

  async function loadModel(skin, model, opts) {
    busy = true;
    try {
      const key = skin + "/" + model;
      let rec = modelCache[key];
      if (!rec) {
        const fileBase = modelFile(skin, model);
        await loadAssets(fileBase);
        const atlas = assetManager.get(fileBase + ".atlas");
        const loader = new spine.AtlasAttachmentLoader(atlas);
        const raw = assetManager.get(fileBase + ".skel");
        const isJson = raw[0] === 0x7b; // '{'
        const reader = isJson
          ? new spine.SkeletonJson(loader)
          : new spine.SkeletonBinary(loader);
        const skelData = isJson
          ? reader.readSkeletonData(new TextDecoder("utf-8").decode(raw))
          : reader.readSkeletonData(raw);
        const sk = new spine.Skeleton(skelData);
        const asd = new spine.AnimationStateData(skelData);
        asd.defaultMix = 0.12;
        const st = new spine.AnimationState(asd);
        const anims = skelData.animations
          .map((a) => a.name)
          .filter((n) => n !== "Default");
        // 基础窗口尺寸 (setup 姿态包围盒 + 留白)
        sk.scaleX = sk.scaleY = Math.max(0.05, Math.min(state.scale, 20));
        sk.setToSetupPose();
        sk.updateWorldTransform();
        const o = new spine.Vector2(), s = new spine.Vector2();
        sk.getBounds(o, s, []);
        rec = {
          skelData, skeleton: sk, animState: st, anims,
          setupW: Math.max(24, Math.ceil(s.x + TRIM_MARGIN * 2)),
          setupH: Math.max(24, Math.ceil(s.y + TRIM_MARGIN + TRIM_FLOOR)),
        };
        modelCache[key] = rec;
      }
      // 记录当前(旧)模型在画布中的底部中心, 用于换皮肤/换模型后对齐位置, 避免瞬移
      let oldCx = null, oldBottom = null;
      if (skeleton) {
        skeleton.updateWorldTransform();
        const oo = new spine.Vector2(), ss = new spine.Vector2();
        skeleton.getBounds(oo, ss, []);
        oldCx = oo.x + ss.x / 2;
        oldBottom = oo.y;
      }
      // 激活缓存模型
      skelData = rec.skelData;
      skeleton = rec.skeleton;
      animState = rec.animState;
      anims = rec.anims;
      setupW = rec.setupW;
      setupH = rec.setupH;
      loopListener = null;
      activeAction = null;
      // 朝向与缩放
      skeleton.scaleX = facing * Math.max(0.05, Math.min(state.scale, 20));
      skeleton.scaleY = Math.max(0.05, Math.min(state.scale, 20));
      state.anim = (opts && opts.anim) || pickIdleBase() || anims[0];

      // 对齐: 让新模型底部中心落在旧模型的画布位置, 裁切锚定后屏幕位置不变
      if (oldCx !== null) {
        skeleton.updateWorldTransform();
        const o2 = new spine.Vector2(), s2 = new spine.Vector2();
        skeleton.getBounds(o2, s2, []);
        skeleton.x += oldCx - (o2.x + s2.x / 2);
        skeleton.y += oldBottom - o2.y;
      }

      layoutModel(true);

      if (opts && opts.anim) {
        // 指定动画 (如巡走时强制 Move)
        setAnimation(opts.anim, !!opts.loop);
      } else {
        // 默认流程: 出场动画 → 待机
        const startName = anims.includes("Start") ? "Start" : state.anim;
        animState.setAnimation(0, startName, false);
        if (startName !== state.anim) {
          const startListener = {
            complete: (entry) => {
              if (entry.animation && entry.animation.name === startName) {
                animState.removeListener(startListener);
                playIdle();
              }
            },
          };
          animState.addListener(startListener);
        } else {
          playIdle();
        }
      }
      play();
      fillUI();
      syncTray();
    } catch (e) {
      console.error(e);
    } finally {
      busy = false;
    }
  }

  // ---------- 布局: 窗口紧贴模型 (切除透明区域) ----------
  const TRIM_MARGIN = 10; // 左右/顶部留白 (px)
  const TRIM_FLOOR = 4;   // 脚底离窗口底部 (px)
  let setupW = 0, setupH = 0; // 基础窗口尺寸 (由 setup 姿态包围盒决定, 保持稳定)
  let lastGrow = 0;           // 上次窗口扩大的时间 (用于动作结束后缩回)

  function layoutModel(force) {
    if (!skeleton) return;
    // 缩放带朝向: scaleX 为负 = 水平镜像 (面朝左)
    skeleton.scaleX = facing * Math.max(0.05, Math.min(state.scale, 20));
    skeleton.scaleY = Math.max(0.05, Math.min(state.scale, 20));
    // 基础尺寸: setup 姿态包围盒 + 留白 (固定, 避免随动画抖动)
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform();
    const o = new spine.Vector2(), s = new spine.Vector2();
    skeleton.getBounds(o, s, []);
    setupW = Math.max(24, Math.ceil(s.x + TRIM_MARGIN * 2));
    setupH = Math.max(24, Math.ceil(s.y + TRIM_MARGIN + TRIM_FLOOR));
    trimWindow(force);
  }

  // 窗口跟随模型: 锚定"模型底部中心"屏幕位置不变 (无累积漂移),
  // 尺寸 = 基础尺寸; 大动作超出时临时扩大, 结束 3s 后缩回
  function trimWindow(force) {
    if (!skeleton) return;
    const holdPos = walking || dragging; // 巡走/拖拽时窗口位置由主进程控制, 只跟随尺寸
    skeleton.updateWorldTransform();
    const o = new spine.Vector2(), s = new spine.Vector2();
    skeleton.getBounds(o, s, []);
    // 数值校验: 包围盒异常(非法/超限)时回退到基础尺寸, 防止窗口跳飞
    if (
      !Number.isFinite(o.x) || !Number.isFinite(o.y) ||
      !Number.isFinite(s.x) || !Number.isFinite(s.y) ||
      s.x <= 1 || s.y <= 1 || s.x > 8000 || s.y > 8000
    ) {
      if (cssW !== setupW || cssH !== setupH) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(setupW * dpr);
        canvas.height = Math.round(setupH * dpr);
        canvas.style.width = setupW + "px";
        canvas.style.height = setupH + "px";
        cssW = setupW; cssH = setupH;
        gl.viewport(0, 0, canvas.width, canvas.height);
        mvp.ortho2d(0, 0, setupW, setupH);
        if (bridge && bridge.setWindowBounds)
          bridge.setWindowBounds({ w: setupW, h: setupH, dx: 0, dy: 0 });
      }
      return;
    }
    const m = TRIM_MARGIN, fb = TRIM_FLOOR;
    let W = setupW, H = setupH;
    const now = performance.now();
    const needW = Math.ceil(s.x + m * 2);
    const needH = Math.ceil(s.y + m + fb);
    if (needW > W + 2 || needH > H + 2) {
      // 动作超出基础窗口 → 临时扩大
      W = Math.max(W, needW);
      H = Math.max(H, needH);
      lastGrow = now;
    } else if (now - lastGrow > 3000 && (W > setupW || H > setupH)) {
      // 大动作结束一段时间 → 缩回基础尺寸
      W = setupW;
      H = setupH;
    }
    const need = force || W !== cssW || H !== cssH;
    if (!need) return;
    // 锚定: 模型底部中心屏幕位置不变
    const cx = o.x + s.x / 2;    // 世界 x 中心
    const bottom = o.y;          // 世界底部 (y-up)
    const bottomCss = cssH - bottom; // 底部中心在旧画布 css 坐标 (y 向下)
    // 平移骨架: 底部中心 → 新画布中心, 底部 → floor
    skeleton.x += W / 2 - s.x / 2 - o.x;
    skeleton.y += fb - o.y;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    cssW = W; cssH = H;
    gl.viewport(0, 0, canvas.width, canvas.height);
    mvp.ortho2d(0, 0, W, H);
    // 窗口平移量: 让模型底部中心的屏幕位置不变 (巡走/拖拽中位置由主进程控制, 只改尺寸)
    if (bridge && bridge.setWindowBounds)
      bridge.setWindowBounds(
        holdPos
          ? { w: W, h: H, dx: 0, dy: 0 }
          : {
              w: W, h: H,
              dx: Math.round(cx - W / 2),
              dy: Math.round(bottomCss - (H - fb)),
            },
      );
  }

  // ---------- 动画控制 ----------
  function isIdleName(n) {
    return /^Idle$/i.test(n) || /^Move$/i.test(n) || /^Relax$/i.test(n) ||
      /^Sit$/i.test(n) || /^Sleep$/i.test(n);
  }
  function isActionName(n) {
    return /^Attack/i.test(n) || /^Skill/i.test(n) || /^Interact/i.test(n) ||
      /^Victory/i.test(n) || /^Defeat/i.test(n) || /^Appear/i.test(n) ||
      /^Die$/i.test(n) || /^Move$/i.test(n);
  }
  function pickIdleBase() {
    if (anims.includes("Idle")) return "Idle";
    if (anims.includes("Move")) return "Move";
    return anims[0] || null;
  }

  function setAnimation(name, loop) {
    if (!animState || !anims.includes(name)) return;
    state.anim = name;
    // 移除旧的循环监听器, 避免重复入队
    if (loopListener) {
      animState.removeListener(loopListener);
      loopListener = null;
    }
    activeAction = loop ? null : name;
    if (!loop) {
      animState.setAnimation(0, name, false);
      const l = {
        complete: (entry) => {
          if (entry.animation && entry.animation.name === name) {
            animState.removeListener(l);
            if (activeAction === name) {
              activeAction = null;
              playIdle();
            }
          }
        },
      };
      animState.addListener(l);
      return;
    }
    // 循环: 每遍播完重新入队 (避免 Spine 原生 loop 的 360° 缠绕问题)
    animState.setAnimation(0, name, false);
    loopListener = {
      complete: (entry) => {
        if (entry.animation && entry.animation.name === name)
          animState.addAnimation(0, name, false, 0);
      },
    };
    animState.addListener(loopListener);
  }

  function playIdle() {
    if (!anims.length) return;
    setAnimation(pickIdleBase(), true);
  }

  // 设置朝向: 1=右 (正), -1=左 (反). 通过负 scaleX 镜像, 保持模型中心不动
  function setFacing(right) {
    const target = right ? 1 : -1;
    if (!skeleton || target === facing) return;
    // 镜像前记录模型中心
    skeleton.updateWorldTransform();
    const o1 = new spine.Vector2(), s1 = new spine.Vector2();
    skeleton.getBounds(o1, s1, []);
    const cx1 = o1.x + s1.x / 2;
    facing = target;
    skeleton.scaleX = facing * Math.abs(skeleton.scaleX);
    skeleton.updateWorldTransform();
    // 镜像后中心可能偏移 (围绕骨骼原点翻转), 平移骨架补偿, 保持中心不动
    const o2 = new spine.Vector2(), s2 = new spine.Vector2();
    skeleton.getBounds(o2, s2, []);
    const cx2 = o2.x + s2.x / 2;
    skeleton.x += cx1 - cx2;
    trimWindow(true); // 重新裁切窗口
    console.log("facing " + (right ? "R" : "L"));
  }

  function playRandomAction() {
    if (!anims.length || busy) return;
    const candidates = anims.filter(isActionName);
    if (!candidates.length) return;
    const name = candidates[Math.floor(Math.random() * candidates.length)];
    setAnimation(name, false);
    return name;
  }

  // 待机动作轮换: 依次播放全部待机动画 (Move/Relax/Sit/Sleep...), 偶尔插播随机动作
  function scheduleIdleRotation() {
    const variety = anims.filter(isIdleName);
    let idx = 0;
    setTimeout(function tick() {
      if (!activeAction && !busy && animState && !walking && !dragging) {
        if (Math.random() < 0.35 && anims.some(isActionName)) {
          playRandomAction(); // 插播一个动作
        } else if (variety.length) {
          const next = variety[idx % variety.length];
          idx = (idx + 1) % variety.length;
          setAnimation(next, true);
        }
      }
      setTimeout(tick, 16000 + Math.random() * 12000); // 每个动作停留 16~28s
    }, 12000 + Math.random() * 8000);
  }

  // ---------- 渲染循环 ----------
  function play() {
    if (playing) return;
    playing = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }
  function frame(now) {
    if (!playing) return;
    const delta = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (animState && skeleton) {
      animState.update(delta);
      animState.apply(skeleton);
      skeleton.updateWorldTransform();
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (skeleton) {
      shader.bind();
      shader.setUniformi(spine.webgl.Shader.SAMPLER, 0);
      shader.setUniform4x4f(spine.webgl.Shader.MVP_MATRIX, mvp.values);
      batcher.begin(shader);
      renderer.draw(batcher, skeleton);
      batcher.end();
      shader.unbind();
    }
    requestAnimationFrame(frame);
  }

  // ---------- 交互 ----------
  let drag = null;
  let dragging = false;    // 用户拖拽中 (暂停裁切)
  let dragTarget = null;   // 最近一次光标屏幕坐标 (rAF 节流发送)

  function pointerDown(e) {
    dragging = true;
    drag = { sx: e.screenX, sy: e.screenY, cx: e.clientX, cy: e.clientY, moved: 0, t: performance.now() };
    if (bridge && bridge.dragStart) bridge.dragStart(e.screenX, e.screenY); // 主进程记录抓取偏移并暂停巡走
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function pointerMove(e) {
    if (!drag) return;
    drag.moved += Math.abs(e.screenX - drag.sx) + Math.abs(e.screenY - drag.sy);
    drag.sx = e.screenX; drag.sy = e.screenY;
    if (bridge) {
      dragTarget = { sx: e.screenX, sy: e.screenY }; // 只保留最新位置, 每帧发送一次
    } else {
      // 浏览器预览: 直接平移舞台
      const dx = e.clientX - drag.cx, dy = e.clientY - drag.cy;
      drag.cx = e.clientX; drag.cy = e.clientY;
      stage.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }
  function pointerUp() {
    if (!drag) return;
    const dt = performance.now() - drag.t;
    const wasDrag = drag.moved > 6 || dt > 600;
    drag = null;
    dragging = false;
    if (bridge && bridge.dragEnd) bridge.dragEnd();
    trimWindow(true); // 拖拽期间暂停了裁切, 结束后立即校正
    if (!wasDrag) openDialog(); // 单击 → 弹出余额浮窗
  }
  // 每帧发送一次光标绝对位置 (主进程按抓取偏移定位窗口); 异常不影响循环
  (function dragFlush() {
    try {
      if (dragTarget && bridge && bridge.dragTo) {
        bridge.dragTo(dragTarget.sx, dragTarget.sy);
        dragTarget = null;
      }
    } catch (e) {
      dragTarget = null;
    }
    requestAnimationFrame(dragFlush);
  })();

  function openDialog() {
    if (bridge && bridge.openDialog) bridge.openDialog();
    else playRandomAction(); // 浏览器预览: 退化为互动动作
  }

  // ---------- UI ----------
  function fillUI() {
    const skins = Object.keys(CONFIG.skins);
    selSkin.innerHTML = skins.map((s) => `<option>${s}</option>`).join("");
    selSkin.value = state.skin;
    const models = Object.keys(CONFIG.skins[state.skin] || {});
    selModel.innerHTML = models.map((m) => `<option>${m}</option>`).join("");
    selModel.value = models.includes(state.model) ? state.model : models[0];
    selAnim.innerHTML = anims.map((a) => `<option>${a}</option>`).join("");
    if (state.anim && anims.includes(state.anim)) selAnim.value = state.anim;
    selScale.value = String(state.scale);
    btnPin.textContent = state.pinned ? "📌" : "📍";
    btnPin.classList.toggle("on", state.pinned);
  }

  // 工具条已停用 (悬停不再弹出); 同款功能在托盘右键菜单中提供
  toolbar.classList.add("hidden");
  toolbar.style.display = "none";

  // 对话框(余额等)通过托盘/点击打开, 余额显示在对话框内

  // ---------- 事件绑定 ----------
  canvas.addEventListener("pointerdown", pointerDown);
  window.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);

  selSkin.addEventListener("change", () => {
    state.skin = selSkin.value;
    const models = Object.keys(CONFIG.skins[state.skin] || {});
    state.model = models[0];
    localStorage.setItem("skadiPet.skin", state.skin);
    loadModel(state.skin, state.model);
  });
  selModel.addEventListener("change", () => {
    state.model = selModel.value;
    localStorage.setItem("skadiPet.model", state.model);
    loadModel(state.skin, state.model);
  });
  selAnim.addEventListener("change", () => {
    const n = selAnim.value;
    setAnimation(n, isIdleName(n));
    syncTray();
  });
  selScale.addEventListener("change", () => {
    state.scale = parseFloat(selScale.value) || 1;
    localStorage.setItem("skadiPet.scale", String(state.scale));
    layoutModel(true);
    syncTray();
  });
  btnPin.addEventListener("click", () => {
    state.pinned = !state.pinned;
    localStorage.setItem("skadiPet.pinned", state.pinned ? "1" : "0");
    if (bridge && bridge.setAlwaysTop) bridge.setAlwaysTop(state.pinned);
    fillUI();
    syncTray();
  });
  btnQuit.addEventListener("click", () => {
    if (bridge && bridge.quit) bridge.quit();
    else window.close();
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- 托盘(Electron) 状态同步 ----------
  function syncTray() {
    if (!bridge || !bridge.setTrayState) return;
    bridge.setTrayState({
      skins: Object.keys(CONFIG.skins),
      models: Object.keys(CONFIG.skins[state.skin] || {}),
      anims,
      skin: state.skin,
      model: state.model,
      anim: state.anim,
      scale: state.scale,
      pinned: state.pinned,
    });
  }
  if (bridge && bridge.onTrayAction) {
    bridge.onTrayAction((msg) => {
      if (!msg) return;
      if (msg.type === "skin" && CONFIG.skins[msg.value]) {
        state.skin = msg.value;
        // 换皮肤时保持当前状态: 巡走中用基建+Move, 否则正面
        if (walking) {
          loadModel(state.skin, "基建", { anim: "Move", loop: true });
        } else {
          loadModel(state.skin, "正面");
        }
      } else if (msg.type === "anim" && anims.includes(msg.value)) {
        setAnimation(msg.value, isIdleName(msg.value));
        syncTray();
      } else if (msg.type === "scale") {
        state.scale = parseFloat(msg.value) || 1;
        localStorage.setItem("skadiPet.scale", String(state.scale));
        layoutModel(true);
        syncTray();
      }
    });
  }
  if (bridge && bridge.onPlayRandom) {
    bridge.onPlayRandom(() => playRandomAction());
  }
  if (bridge && bridge.onWalk) {
    bridge.onWalk((m) => {
      walking = !!(m && m.moving);
      if (walking) {
        if (m && m.vx !== undefined) setFacing(m.vx >= 0); // 面朝水平移动方向
        // 移动时强制切到基建模型组, 播放 Move 动画
        if (state.model !== "基建") {
          state.model = "基建";
          loadModel(state.skin, state.model, { anim: "Move", loop: true });
        } else {
          setAnimation("Move", true);
        }
      } else {
        // 停下恢复默认模型(正面)并待机; 正面模型固定用 Idle 待机
        const defaultModel = "正面";
        if (state.model !== defaultModel) {
          state.model = defaultModel;
          loadModel(state.skin, state.model, { anim: "Idle", loop: true });
        } else {
          playIdle();
        }
      }
    });
  }
  if (bridge && bridge.onReady) bridge.onReady();

  // ---------- 启动 ----------
  initGL(); // 先初始化 GL / 资源管理器, 再加载模型
  loadModel(state.skin, state.model).then(() => {
    // 调试: ?facing=L 强制面朝左
    if (qp.get("facing") === "L") setFacing(false);
  });
  scheduleIdleRotation(); // 待机动作轮换
  // 周期裁切窗口: 跟随模型姿态变化 (呼吸等小动作不触发, 大动作跟随; 巡走时暂停)
  setInterval(() => trimWindow(false), 250);
})();
