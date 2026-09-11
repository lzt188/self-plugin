# dsh-usage 项目规则

## 结构

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | 服务端 Cordis 插件：3 个回环 GET 端点、凭据 seam、5 分钟后台刷新 |
| `lib/usage.js` | token 折叠纯函数（按日/模型/24 小时桶，同 turn/step 替换语义） |
| `lib/balance.js` | 余额 scheme 注册表（DeepSeek/OpenRouter/Moonshot/Z.ai） |
| `lib/safe-fetch.js` | 上游安全请求：HTTPS 强制、DNS 固定防 rebinding、1 MiB 上限 |
| `lib/claude.js` | Claude Code JSONL 增量聚合（只存数字+游标） |
| `lib/client.js` | 客户端 widget 体系：无构建 `__ModuleLoader__` bundle（手写 jsx-runtime） |
| `scripts/test-*.mjs` | 离线测试（balance/usage/server/client/e2e/claude） |
| `vendor/` | DSH 客户端加载器 fixture（MIT，供真实 loader 预演测试） |

## 红线

- 三个端点只接受回环 GET（peer socket 校验），绝不向公网/局域网开放。
- Claude JSONL 只聚合数字：对话文本永不落盘、永不进浏览器响应。
- 凭据只经 Harness credentials seam 解析，永不进响应/缓存/日志。
- 客户端无构建步骤：禁止引入 JSX 构建器依赖；改 `lib/client.js` 手写 `react_jsx_runtime` 调用。
- `lib/client.js` 引用的非 DSH 基础前端包必须同时写入 `dependencies` 与 `dsh.client.inject`；发布前必须在无工作区 junction 的干净 hoisted profile 中安装最终包验证。
- 不要用 PowerShell 正则替换修改 `lib/` 源码（曾因此清空过文件）；一律用编辑工具逐段修改。
- 服务端改动必须重启 `dsh web` 才生效；纯客户端改动硬刷新即可。

## 常用命令

```bash
npm run check        # 全量语法检查
npm test             # 116 个离线测试，全绿才可提交
npm run test:package # 发布依赖与 client inject 契约
node scripts/validate-claude.mjs          # 真实 ~/.claude 数据预演
node scripts/rehearse-real-usage.mjs      # 真实 ~/.dsh/sessions 预演 + 增量折叠切片不变性
node scripts/bench-usage.mjs              # 真实数据：冷/热折叠耗时 + P0/P2 读写次数与缓存 mtime 证据
node scripts/bench-reload-cost.mjs        # 量化「全量重读所有日志」的成本（P0 回归的反面证据）
node scripts/proxy-fetch.mjs <url>        # 沙箱内经 127.0.0.1:7890 代理拉取 https
node scripts/github-research.mjs          # GitHub 星数调研（走代理，带重试）
```

> `test-client` / `test-e2e` 需要 `node_modules`（jsdom + react）；本仓库未安装时它们会直接
> `ERR_MODULE_NOT_FOUND`，与 `lib/` 改动无关。

## 关键约定

- 客户端设置持久化于 localStorage `dsh-usage:settings:v1`；`defaultSettings()` 即产品预设，改动需同步 e2e 断言。
- 服务端缓存版本变更必须同步升 `CACHE_VERSION`（usage-cache.json v2 / claude cache v1），旧缓存自动失效重算。
- **插件绑定 Harness 的三个真实 API 面，改名即 500，改 `lib/` 前先对齐**：
  1. 活会话 `ctx.sessions.list()` 返回的 `Session` **没有公开 `events`**，日志私有，只能 `session.seq`（长度）+ `session.snapshotEvents(fromSeq)` 取增量；
  2. **持久会话枚举优先 `ctx.sessionPersistence.listSnapshots()`**（返回 `{ header, revision }`，revision 由 stat 派生且不读事件字节）；当前 JSONL 后端的 `list()`（`session-persistence-jsonl/src/index.ts:463`）返回**裸 `SessionHeader[]`（无 revision）**，只有 `listSnapshots()`（同文件 `:468`）带 revision——用 `list()` 会让每个持久会话 revision=undefined → 每请求全量重读（实测 ~24 s）。`list()` 仅作老后端的回退，且两种形状（裸 header / `{header,revision}` snapshot）都已在 `storedSnapshots()` 归一化；
  3. 读存量日志：若后端有 `readFrom(id, fromSeq)`（当前 JSONL 后端 `:208`，后缀读，只解析 seq≥fromSeq）优先用它；否则回退 `open(id, "read")` → `handle.read(offset)` → `handle.close()`。`readFrom` 直接返回 `{ events }`。
- **usage 端点服务层（`usagePayload()`）**：命中 TTL（`deps.usageTtlMs`，默认 = `REFRESH_MS` 5 min）直接返回物化快照，跳过折叠 + Claude 扫描；`?refresh=1` 或后台 5 分钟周期强制重算并回灌快照（`startBackgroundRefresh` 调 `usagePayload({force:true})`）。这是**纯服务层缓存**，不改折叠语义，**不需要**升 `CACHE_VERSION`。`resetUsageMemo()` 为测试 seam，`boot()` 里必须调。
- **增量落盘脏标记（P2）**：`collectUsage()` 只在真正有新折叠 / 新会话 / revision 变化 / 会话被清除时 `saveCache`，空闲稳态轮询**不写盘**。同样不改语义、不升 `CACHE_VERSION`。
- **用量样本的 v2 词汇**（与 `dsh-token-meter` 的 `tokenUsage` projection 一致）：`assistant/chunk` 已废弃（v0/v1 遗留，v2 日志里为 0 条）；usage 只在 `assistant/message`（`data.usage`，缺失时回落到 `data.stream` 里**最后**一条 `{type:"chunk",chunk:{type:"usage"}}`）和 `assistant/attempt`（**只有** stream 内嵌）上；`llm/retry-started` 必须清掉同 `(turn, step)` 的替换槽，否则重试被当作重复样本吞掉。改语义必须同步升 `CACHE_VERSION`。
- 拖拽排序用 ghost 占位方案：拖拽中不改布局，drop 时一次性提交 + FLIP 动画。
- 面板主列固定在 `WIDGET_COLUMN`（main：余额 + 四个统计格；aside 已无驻留 widget）；recent（用量记录）与 heatmap（热力图）被 `POPUP_WIDGETS` 排除，只渲染在悬浮窗按钮触发的两个独立弹框里：用量按钮 → `[data-dsh-usage-pop]`，热力图按钮 → `[data-dsh-usage-heat]`。调面板/用量弹框宽度要同步改 `PANEL_WIDTH` 与 `.u_panel`/`.u_usagePop` 的 width（三处必须一致）。
- 三个弹框锚在同一个角：left/bottom 都来自 `computeBoxAnchor()`，齿轮 → 余额面板、用量按钮 → 用量弹框用 `boxStyle`（含固定 `height` = 槽位高度）；热力图弹框用 `heatBoxStyle`（只有 `max-height:min(槽位,82vh)`，高度由内容决定）。改位置只能改 `computeBoxAnchor()`。
- 热力图几何只有一个源头：`HEAT_COLS/ROWS/CELL/GAP/GUTTER`（文件顶部 `//#region heat geometry`）。CSS 用模板串从这些常量生成（`.u_heatmapPop` 宽度 = `HEAT_POP_WIDTH`、`.u_heatBox{width:min(100%,HEAT_WIDTH)}`、grid 列 `minmax(0,1fr)`），`heatData` 的分桶也读同一批常量——改格子大小只动常量，不要再手写 px。宽槽位时格子恰好是 `HEAT_CELL`，窄槽位由 `minmax(0,1fr)` 等比收窄。
- 格子气泡（`.u_heatTip`）取代原生 `title`：`.u_heatGrid` 上挂一个委托 `mouseover`，用 `data-heat-row/col` 反查 `heatData`，只在“换格子”时 setState；位置由纯函数 `placeHeatTip()` 算（格子上方居中、贴顶翻到下方、四边 clamp），`useLayoutEffect` 里量完再定位，所以不会闪。格子只留 `role=img` + `aria-label`（重新加 `title` 就会把 1 秒延迟的系统气泡带回来）。
- 测试字典从插件 `apply()` 捕获，禁止在测试里维护字典副本。
- 悬浮窗「让位」机制：指针停在 dock 上不动 `DOCK_GHOST_MS`(900ms) 后进入 ghost（`data-ghost` + 内联 `opacity`/`pointerEvents:none`，因为 `themeStyle` 已内联 opacity，只能内联覆盖），点击直接穿到底层元素；指针移动 >6px、移出 dock、拖拽中或任一弹框打开时立即恢复。
- 用量曲线图默认只画线：面积填充只给当前聚焦曲线，网格线仅 50%/100% 两条 + 左上角 `.u_chartMax` 峰值标注；全时段为 0 的模型不进曲线/图例/hover；hover 圆点是 HTML（`.u_chartDotMark`）而非 SVG circle，因为 svg 用 `preserveAspectRatio:none` 会把圆拉成椭圆。图表几何常量 `W/H/pad*` 被 e2e 的 hover 像素断言绑定，改动要同步 `scripts/test-e2e.mjs`。
- 悬浮窗仅余额用主题色；其余信息用中性色阶。
- 可 pin 的 widget 白名单：balance/today/month/hit；其余在 `WIDGET_PINABLE` 中禁用。

## 深入文档

- 安装与外部使用：`README.md`
- 设计迭代与回退点：`git log`（关键检查点均带描述性 commit message）
