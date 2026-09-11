# dsh-usage 插件架构

```
DSH Web 进程 (服务端 · Cordis 插件)                   浏览器 (客户端 · React widget)
┌────────────────────────────────────────────────┐   ┌─────────────────────────────────────────────┐
│ cordis.patch.yml → 注入 web / credentials /    │   │ __ModuleLoader__ bundle (无构建步骤)         │
│                   sessions / persistence/settings│  │                                               │
│                                                │   │ 挂在 sidebar.footer.action 槽位               │
│  lib/index.js   ── Cordis 插件主入口             │   │                                               │
│   │  apply() 注册 3 条精确路由 + 后台刷新          │   │  lib/client.js  compile 到 window.__Module  │
│   │                                               │   │        Loader__                           │
│   ├── GET /api/usage/providers ────────────┐      │   │                                               │
│   ├── GET /api/usage/balance?provider=&    │      │   │  apply(ctx)                                 │
│   └── GET /api/usage/usage                 │      │   │   • ctx.locale.register(zh/en 字典)         │
│      每路由先 rejectForeignCaller()         │      │   │   • slots.inject("sidebar.footer.action",    │
│      (GET + peer socket / Host 回环校验)     │      │   │       UsagePanel)                          │
└───────────┬──────────────────────────────────┘      └───────────────▲───────────────────────────────┘
            │                                              open URI     │
            │  ┌─────────────────────────────────┐          ┌─────────────┴─────────────┐
            │  │  createBalanceService()          │          健康/今日/月/缓存命中 持久悬浮 dock
            │  │   per-provider 内存缓存(≤5min)    │          (齿轮→面板 · 用量→usage 弹框 · 热力→heat 弹框)
            │  │   single-flight 去重              │          可拖拽 / pin / 折叠 / 隐藏 (settings.order)
            │  │   /api/usage/balance ────────────┼───────→  widget 双形态架构:
            │  │      resolveCredential→credentials seam         每个 widget = {detail, compact}
            │  │      queryBalance → balance.js scheme           WIDGET_COLUMN 分主/侧栏
            │  └──────────┬────────────────────────┘              main: balance/today/month/hit
            │             └── safe-fetch ──→ HTTPS + DNS 固定      侧栏/弹框: dual/channel/heat/recent
            │                 + 私有网段拒绝 + 1MiB 上限
            │  ┌─────────────────────────────────┐          ┌────────────────────────────┐
            │  │ collectUsage()  增量折叠          │          │ UsagePanel(坐标单一来源)     │
            │  │   live sessions: 事件 slice       │          │  useSettings→localStorage    │
            │  │   自 consumed 游标起 fold          │          │    dsh-usage:settings:v1    │
            │  │   persisted: revision/seq 比较     │          │  fetchJson:                    │
            │  │   分段读 + gap/truncate → 全量重算  │          │   └ /api/usage/{providers,   │
            │  └──────────┬────────────────────────┘          │       balance,usage}         │
            │             │ usage.js 纯折叠(同turn/step替换)  │  renderUsage 数据 → stats衍生物
            │  ┌──────────▼────────────────────────┐        │    7 widgets / 逐日 drill-down
            │  │   per-session fold 状态            │        │    24h 曲线 / 双通道对比 / 热力图
            │  │   usage-cache.json (version v4)    │        └────────────────────────────┘
            │  │   原子写(tmp+rename)               │
            │  │   单一锁 withLock()                 │
            │  │   按 DSH_HOME/storages 落盘          │
            │  └────────────────────────────────────┘
            │  ┌────────────────────────────────────┐
            │  │ startBackgroundRefresh()           │   每 5 分钟(启动即跑):
            │  │   balance刷新 + collectUsage +      │   └─→ Claude: claude.js 增量聚合
            │  │   Claude(collectClaude)             │        目录 ~/.claude/projects JSONL
            │  └────────────────────────────────────┘        只存数字+游标 → usage-cache-claude.json
```

## 设计要点

### 两端分工
- **服务端（`lib/` 一整套 Cordis 插件）负责“数据在哪里、谁有权读”**：回环安全边界、凭据解析、增量聚合、缓存、上游余额请求、Claude 数字聚合。只暴露 3 条只读回环 GET。
- **客户端（`lib/client.js`）只做“展示与交互”**：无构建步骤的 `__ModuleLoader__` bundle（手写 react-jsx-runtime），靠 web worker `/api` 拉数据，UI 状态与自定义都持久化在 localStorage —— 客户端从不接触凭据、从不存 token 之上的原始文本。

### 服务分层（折叠六层 + 快照服务层）
1. **边界层** `rejectForeignCaller()` —— 路由守卫，仅回环 peer socket + GET。
2. **余额服务层** `createBalanceService()` —— 供应商枚举、内存缓存/单飞、`balance.js` scheme 规范化。
3. **用量折叠层** `lib/usage.js` —— Cordis 无关的纯函数：按日/模型/24h 桶，同 turn/step 替换语义。
4. **增量缓存层** `collectUsage()` —— live/persisted 双来源、revision 游标、原子落盘 `usage-cache.json`。持久会话枚举优先 `listSnapshots()`（带 revision、不读事件字节；JSONL 后端的 `list()` 返回裸 header 无 revision，用它会导致每请求全量重读）；读存量优先后端 `readFrom(id, fromSeq)` 后缀读，回退 `open/read/close`。仅在折叠状态真正变化时 `saveCache`（脏标记），空闲稳态不写盘。
4b. **物化快照服务层** `usagePayload()` —— `/api/usage/usage` 命中 TTL（默认 = 5 min 刷新周期）直接返回上次算好的 `{days,total,claude}`，跳过折叠与 Claude 扫描；`?refresh=1` 或后台周期强制重算并回灌。纯服务层缓存，不改折叠语义。
5. **Claude 通道层** `lib/claude.js` —— JSONL 增量，只折叠数字+游标（双通道对比的第二条腿）。
6. **上游安全请求层** `lib/safe-fetch.js` —— HTTPS、DNS 预解析与固定、私有网段拒绝、1MiB 上限。

### 客户端的三处弹框
三弹框共用于同一 `computeBoxAnchor()` 锚点角：齿轮→余额面板(`boxStyle` 固定高)，用量按钮→用量弹框(`boxStyle`)，热力图按钮→热力图弹框(`heatBoxStyle`，高度由内容定)。recent/heatmap 属 `POPUP_WIDGETS`，只渲染在各自弹框，不驻留主面板列。

### 安全红线在架构上的体现
- 全部上游余额走 `safe-fetch`，凭据只经 `credentials` seam 在请求时解析 → 永不进响应/缓存/日志。
- Claude 只聚合数字，对话文本不落盘、不进浏览器。
- 三端点 /api 精确路由、peer-socket 回环校验，绝不向 LAN/公网开放。

## 变更影响面
- **服务端改动**（`lib/index.js` 等）需重启 `dsh web`；**纯客户端改动**（`lib/client.js`）则硬刷新即可。
- 服务端 `CACHE_VERSION` 升级（当前 = v4）会令 `usage-cache.json` 整体失效重算；Claude cache 版本独立。TTL 快照与脏标记落盘是服务层改动，**不**触发升版。
