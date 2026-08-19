# AI写着玩
# 斯卡蒂桌宠 (Skadi Desktop Pet)

明日方舟 **斯卡蒂** 桌宠 —— 模型与动画全部取自
[PRTS 干员模型页](https://prts.wiki/w/%E6%96%AF%E5%8D%A1%E8%92%82#%E5%B9%B2%E5%91%98%E6%A8%A1%E5%9E%8B) 所提供的内容
（`torappu.prts.wiki/assets/char_spine/char_263_skadi/` 下的官方 Spine 3.8 模型与动画）。

## 特性

- **3 套时装 × 3 种模型组**：默认 / 驭浪 WR04 / 下一顿午茶，各有 正面 / 基建 / 背面 模型
- **全部官方动画**：
  - 正面/背面：`Start` 出场、`Idle` 待机、`Attack`/`Attack_Begin`/`Attack_End` 攻击连段、`Die`
  - 基建模型：`Move` 走动、`Relax` 放松、`Sit` 坐下、`Sleep` 睡觉、`Interact` 互动
- **智能行为**：出场动画后进入待机；**待机动作轮换**（依次播放 Move/Relax/Sit/Sleep 等，偶尔插播随机动作）
- **模型组合并**：站立用正面模型（Idle/Attack），**移动时自动切换基建模型并强制播放 Move 动画**，停下自动恢复（模型已缓存，切换即时）
- **自动巡走**：在「除任务栏外的整个桌面」区域内方向式漫游，**碰到边界自动掉头**，走一段后随机停歇；手动拖拽会暂时打断
- **窗口紧贴模型**：透明区域自动裁切，尺寸稳定不抖动；大动作时窗口临时扩大再收回（默认 50% 尺寸）
- **单击弹窗**：点击桌宠弹出**透明悬浮余额**（仅显示 DeepSeek API 余额数字，点击关闭），API Key 仅存于主进程
- **自由拖拽**：按住模型拖到屏幕任意位置（窗口位置自动记忆）
- **透明无边框置顶窗口** + 系统托盘（右键菜单可随时换装/换模型/换动画/调尺寸/退出）
- **浏览器预览**：不装 Electron 也能先在浏览器里看效果

![斯卡蒂桌宠效果](screenshot.png)

## 快速开始

### 方式一：桌宠窗口（推荐）

双击 `start-pet.bat`，或手动执行：

```bash
npm install --registry=https://registry.npmmirror.com   # 首次
npm start
```

> 若 `npm install` 后 `node_modules\electron\dist` 不存在（沙箱/代理环境跳过了解压脚本），
> 可运行 `node tools/install_electron_binary.js` 手动下载解压 Electron 37.10.3。

### 方式二：浏览器预览

```bash
npm run preview    # 或 node tools/serve.js
```

然后打开 <http://localhost:8080/pet/>。浏览器里同样支持换装、换动画、单击互动，
只是拖拽变成页面内移动（真正的桌面置顶窗口需要 Electron 方式）。

## 操作

| 操作 | 效果 |
| --- | --- |
| 左键按住拖拽 | 移动桌宠（窗口位置会记忆） |
| 单击 | 弹出透明悬浮余额（点击关闭） |
| 托盘图标左键 | 显示 / 隐藏桌宠 |
| 托盘图标右键 | 菜单：换装、换模型、换动画、尺寸、退出 |

## 项目结构

```
├── assets/                  # 斯卡蒂模型资源 (3 时装 × 3 模型组 × skel/atlas/png)
│   ├── defaultskin/         #   默认时装 (正面/基建/背面)
│   ├── char_263_skadi_summer_3/   # 驭浪 WR04
│   └── char_263_skadi_marthe_5/   # 下一顿午茶
├── pet/                     # 桌宠网页应用 (Electron 渲染层, 也可浏览器预览)
│   ├── index.html
│   ├── dialog.html          # 余额对话框页面
│   ├── pet.js               # 渲染/行为/交互逻辑 (spine-webgl 运行时)
│   ├── spine-runtime.js     # Spine 3.8 WebGL 运行时 (取自 PRTS 站点构建产物)
│   ├── model-config.js      # 模型配置 (由 PRTS meta.json 生成)
│   └── style.css
├── main.js                  # Electron 主进程 (透明置顶窗口/托盘/IPC)
├── preload.js               # 安全桥接 (contextBridge)
├── tools/
│   ├── download_assets.js   # 从 PRTS 下载模型资产
│   ├── install_electron_binary.js  # 手动安装 Electron 二进制 (镜像)
│   ├── serve.js             # 浏览器预览服务器
│   └── make_icon.js         # 生成托盘图标
├── start-pet.bat            # 一键启动
└── package.json
```

## 素材来源与版权

- 模型与动画：明日方舟 (Hypergryph / Yostar)，由 [PRTS 干员模型页](https://prts.wiki/w/%E6%96%AF%E5%8D%A1%E8%92%82#%E5%B9%B2%E5%91%98%E6%A8%A1%E5%9E%8B) 提供查看，
  资产托管于 `torappu.prts.wiki/assets/char_spine/char_263_skadi/`
- Spine 运行时：`spine-webgl`（Esoteric Software，Spine 3.8 官方运行时）
- 本项目仅作个人学习/娱乐用途，请勿商用。
