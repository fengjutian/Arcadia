# 网站封杀名单（Site Blacklist）方案

> 状态：已完成设计，按本文实施。最后更新：2026-10-27。
> 目标平台：Windows 为第一验收平台；macOS / Linux 提供尽力而为的降级。

## 1. 背景与目标

现有隐私模块解决的是**子资源**层面的广告/追踪器拦截：ABP 规则、`WebResourceRequested`、站点级开关和拦截统计。它不回答一个更朴素的需求：

> 我不想再看到某个网站。把它拉黑，之后无论从地址栏、收藏、历史、外部链接还是页面内跳转进来，都不要再加载它。

本方案新增**用户自管的网站封杀名单**：

- 用户可以在「设置 → 隐私 → 网站封杀」中新增、启用/停用、删除、批量导入和清空封杀项。
- 命中封杀名单的**顶级页面导航**一律不发出网络请求，直接显示应用内拦截页。
- 命中封杀名单的**子资源**（脚本、图片、iframe、XHR 等）从源头阻断，避免站外页面把被封杀站点的内容嵌进来。
- 封杀动作在 Rust 端强制执行，不依赖前端页面是否配合；前端只负责展示和编辑。
- 私密标签同样受封杀约束，但封杀命中记录不落库。

### 非目标

- 不做基于关键词/正则的全站内容过滤（这是 ABP 规则集的职责）。
- 不做家长控制、时间限制或云端同步。
- 不替换现有 `privacy_filter_lists`（规则集）语义：封杀名单是**站点级**、用户显式维护、优先级更高的名单。
- 首版不做「仅某路径/某目录」的 URL 级封杀。输入中的路径会被忽略，只保留主机名。

## 2. 用户可见行为

### 2.1 设置页

「设置 → 隐私」新增页签**「网站封杀」**，包含：

| 区块 | 行为 |
| --- | --- |
| 总开关 | 「启用网站封杀」关闭后，名单保留但不再拦截任何请求。默认开启。 |
| 子资源开关 | 「同时阻断被封杀站点的嵌入资源」默认开启；关闭后只拦顶级页面导航。 |
| 添加 | 输入域名或完整 URL，回车或点「添加」。支持 `example.com`、`https://example.com/path`、`*.example.com`、IDN（自动转 punycode）。默认同时封杀子域，可关闭「同时封杀子域」。重复项直接提示已存在。 |
| 批量导入 | 多行文本一次导入，每行一个地址；也接受逗号/分号分隔。返回「新增 / 重复 / 无效」三类计数与无效原因。 |
| 名单 | 每项显示主机名、`含子域 / 仅本站`、命中次数、最近命中时间、来源；点击范围标签可在两种范围间切换，提供启用/停用开关与删除。支持按主机名过滤。 |
| 统计 | 名单总数、启用数、累计命中次数；「清空全部」需二次确认。 |
| 最近命中 | 最近 20 条顶级页面拦截记录（主机、URL、时间、标签）。 |
| 导出 | 把启用中的主机名导出为 `.txt`（一行一个），便于迁移。 |

### 2.2 浏览器内

- 工具栏「⋯」菜单新增**「封杀此网站」**。当前页已有主机时可用；已封杀时显示为「解除封杀此网站」。
- 点击「封杀此网站」会二次确认，确认后：
  1. 主机写入名单；
  2. 当前标签立即切换到拦截页（不等待下次导航）；
  3. 提示「已封杀 example.com，可在 设置 → 隐私 中管理」。
- 命中封杀时显示**拦截页**：标题「已封杀该网站」，说明命中的规则主机、当前 URL、来源，提供：
  - **解除封杀并访问**（写入例外：从名单删除该规则后重新导航）；
  - **返回新标签页**；
  - **复制 URL**；
  - 提示可前往「设置 → 隐私 → 网站封杀」管理完整名单。
- 从被封杀站点直接触发的下载会被拒绝，并在下载中心显示一条 `blocked` 记录（原因「该下载来自已封杀的网站」）。

### 2.3 拦截页不做什么

- 不提供「本次放行」的一次性按钮。封杀是用户显式维护的强约束，绕过必须显式解除，避免误点造成泄漏。若后续需要，可作为独立需求增加「临时放行 10 分钟」。

## 3. 匹配规则

### 3.1 输入规范化

`normalize_host_input(input) -> Result<String, String>`：

1. 去掉首尾空白；空输入报错。
2. 新增项默认 `include_subdomains = true`：封杀 `example.com` 同时覆盖 `www.example.com`、`news.example.com`。设置页的「同时封杀子域」开关可以改为「仅本站」；已存在的条目可以在列表中点击范围标签切换。接受 `*.` / `.` 前缀，但不改变行为。
3. 没有 scheme 时按 `https://` 解析；有 scheme 时只接受 `http` / `https`。
4. 拒绝带用户名/密码的 URL。
5. 取 `Url::host_str()`，转小写、去掉末尾 `.`、去掉 `www.` 前缀（`www.example.com` → `example.com`）。
6. 校验：IP 字面量允许；其余主机必须至少两个标签、每段合法、总长 ≤ 253；拒绝公共后缀（`com`、`co.uk`、`com.cn` 等）以免误封整个后缀。

规范化的结果是**唯一键**：`host` 列 `UNIQUE`，重复添加返回已存在。

### 3.2 命中判定

对请求 URL 取主机名后：

```text
命中 ⇔ 全局开关开启
     且 存在启用项 r
     且 (host == r.host  或  (r.include_subdomains 且 host 以 "." + r.host 结尾))
```

- 精确规则优先；否则从完整主机名开始逐级去掉最左标签查后缀规则，首个命中即最长（最具体）规则，用于展示与统计。实现为两张哈希表（`exact` / `suffix`），单次匹配 O(标签数)，与名单规模无关。
- `www.` 已被规范化剥离，因此 `example.com` 天然覆盖 `www.example.com`；`a.b.example.com` 由默认开启的子域匹配覆盖，关闭该标志时只匹配精确主机。
- 端口、路径、查询串、片段不参与匹配。
- 匹配只针对 `http` / `https`；`about:`、`data:`、`tauri:` 等内部 URL 永不匹配。

### 3.3 优先级

封杀名单优先于广告规则集的 `@@` 例外：用户显式封杀的站点不会因为某条白名单规则而被放行。规则集与封杀名单是两层独立判断，先看封杀，再看 ABP。

## 4. 数据模型

新增迁移 **#26**（`MIGRATIONS` 只追加，不修改历史条目）：

```sql
CREATE TABLE site_blacklist (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL UNIQUE,
    include_subdomains INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',   -- manual | import | quick-block | exception
    hit_count INTEGER NOT NULL DEFAULT 0,
    last_blocked_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX idx_site_blacklist_enabled ON site_blacklist(enabled);

CREATE TABLE site_blacklist_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1,
    block_subresources INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);
INSERT INTO site_blacklist_settings(id, enabled, block_subresources, updated_at)
VALUES (1, 1, 1, 0);

CREATE TABLE site_blacklist_events (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    rule_host TEXT NOT NULL,
    url TEXT NOT NULL,
    tab_label TEXT,
    blocked_at INTEGER NOT NULL
);
CREATE INDEX idx_site_blacklist_events_blocked ON site_blacklist_events(blocked_at DESC);
```

- `host` 为规范化后的主机名，唯一。
- `source` 记录来源，便于 UI 区分（手动、批量导入、浏览器快捷封杀）。
- 命中记录只保存**顶级文档**拦截，不保存每个子资源请求；子资源拦截计入 `hit_count` 与隐私统计，避免把事件表撑爆。
- 迁移测试中的表/索引清单与文档中的迁移计数同步更新。

## 5. Rust 设计

### 5.1 模块

新增 `desktop/src-tauri/src/site_blacklist.rs`：

```text
normalize_host_input(input)     输入规范化与校验（纯函数）
host_matches(rule, host)        单条规则匹配（纯函数）
SiteRules                       只读快照：enabled / block_subresources / Vec<Rule>
snapshot()                      全局快照（RwLock<Arc<SiteRules>>）
reload(app)                     从 SQLite 重载快照，命令与启动时调用
match_url(url) / match_host(h)  返回 Option<SiteMatch>
guard_url(app, url, ...)        导航前检查，命中返回 SiteMatch
record_block(app, ...)          异步写事件表 + 累加命中计数（私密标签跳过）
```

**为什么用内存快照**：`NavigationStarting` 与 `WebResourceRequested` 都在 WebView2 的 UI/请求线程上执行，不能在那里打开 SQLite 或等待异步任务。名单规模是人工维护的（通常几十到几百条），整表快照 + `RwLock` 读足够快；写路径（增删改）在命令线程重载并替换 `Arc`。

### 5.2 命令

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `site_blacklist_list` | — | `SiteBlacklistEntry[]` |
| `site_blacklist_add` | `input`, `note?`, `source?`, `includeSubdomains?` | 新增项；重复/非法返回错误 |
| `site_blacklist_add_many` | `input`（多行文本） | `{ added, duplicates, invalid: [{input, reason}] }` |
| `site_blacklist_remove` | `id` | `()` |
| `site_blacklist_set_enabled` | `id`, `enabled` | `()` |
| `site_blacklist_set_scope` | `id`, `includeSubdomains` | `()` |
| `site_blacklist_clear` | — | 删除数量 |
| `site_blacklist_get_settings` | — | `{ enabled, blockSubresources }` |
| `site_blacklist_set_settings` | `enabled`, `blockSubresources` | `()` |
| `site_blacklist_check` | `url` | `{ matched, host, ruleHost, entryId } \| null` |
| `site_blacklist_events` | `limit?` | `SiteBlacklistEvent[]` |
| `site_blacklist_summary` | — | `{ total, enabled, hitTotal, lastBlockedAt }` |

所有写命令在事务提交后调用 `reload` 并 `emit("browser://site-blacklist-changed")`，保证同一进程内的浏览器页与设置页同步。

### 5.3 强制点

| 入口 | 处理 |
| --- | --- |
| `browser_create` | 构建 WebView 之前检查；命中直接返回 `Err("site-blocked:<host>|<rule>")`，不创建 WebView、不发出请求。 |
| `browser_navigate` | `.navigate()` 之前检查；命中返回同上错误，WebView 保持原页面。 |
| `browser_reload` | 当前 URL 命中时返回同样的错误，不触发重载。 |
| WebView2 `NavigationStarting`（Windows） | 检查 `NavigationStarting` 的 URL；命中时 `SetCancel(true)`，`emit("browser://site-blocked")`，并异步记录事件。覆盖页面内链接、重定向、表单提交、前进/后退、刷新。 |
| `WebResourceRequested`（Windows） | 子资源开关开启时，在 ABP 判定之前检查主机；命中返回 `204 No Content`，计入隐私统计。 |
| `on_new_window` | 新窗口 URL 进入前端后会走 `browser_create`，由该入口兜底；不在 Rust 侧重复判断。 |
| 前端轮询（macOS / Linux） | `browser_state` 返回的 URL 变化时，前端用同一份名单缓存判定；命中则隐藏 WebView 并显示拦截页。属于事后拦截，文档中明确标注。 |
| 下载 | 在 `on_download::Requested` 中检查下载 URL；命中则拒绝开始传输，并发出 `browser://download` 的 `blocked` 事件（不写下载历史）。 |

### 5.4 事件契约

```json
// browser://site-blocked
{
  "version": 1,
  "tabLabel": "browser-tab-3",
  "url": "https://example.com/a",
  "host": "example.com",
  "ruleHost": "example.com",
  "entryId": "7f6c…",
  "resourceType": "document"
}
```

```json
// browser://site-blacklist-changed
{ "version": 1 }
```

前端对未知字段保持兼容；事件只用于提示与立即切换拦截页，不作为唯一事实来源。

### 5.5 错误契约

导航类命令命中封杀时返回：

```text
site-blocked:<host>|<ruleHost>|<entryId>
```

前端 `classifyNavigationError` 识别该前缀并转换为 `{ kind: 'site-blocked', host, ruleHost, entryId }`，不进入网络诊断流程（避免对被封杀站点发起探测请求）。`entryId` 让拦截页可以直接解除对应规则。

### 5.6 记录与隐私

- 顶级页面命中：写 `site_blacklist_events`，`hit_count += 1`，更新 `last_blocked_at`。
- 子资源命中：只计入现有隐私统计（`privacy_block_events` / 拦截计数），不写封杀事件表，也不累加 `hit_count`，避免每个请求一次写库。
- 私密标签：不写事件、不累加计数（与 `privacy_block_events` 的现有约定一致）；拦截本身仍然生效。
- 事件表只保留最新 1000 条（`EVENT_RETENTION`）；写入与计数更新在同一个 SQLite 事务中完成。
- 记录异步执行，失败只写日志，不影响拦截结果。

## 6. 前端设计

### 6.1 文件

```text
desktop/src/api.ts                              类型 + invoke 封装
desktop/src/features/privacy/siteBlacklist.ts   名单缓存、URL 匹配、变更事件
desktop/src/features/privacy/SiteBlacklistPanel.tsx  设置页面板
desktop/src/features/browser/BrowserErrorView.tsx    新增 site-blocked 分支
desktop/src/pages/browser/BrowserPage.tsx       导航兜底、事件监听、快捷封杀
desktop/src/pages/settings/SettingsPage.tsx     新增页签
desktop/src/types.ts                            BrowserTabError 新增 kind
```

### 6.2 缓存与同步

`siteBlacklist.ts` 在首次调用时加载名单，之后：

- 任何写操作成功后本地更新缓存并派发 `arcadia-site-blacklist-changed`；
- 监听 Rust 的 `browser://site-blacklist-changed`（设置页与浏览器页都挂载时），强制重载；
- 提供 `findBlockingEntry(url)` 作为前端镜像判定，规则必须与 Rust 完全一致（有单测覆盖）。

### 6.3 BrowserPage 状态机

```text
navigate(url)
  ├─ Rust browser_create / browser_navigate 返回 site-blocked
  │    → tab.error = { kind:'site-blocked', host, ruleHost }
  │    → 隐藏该标签的原生 WebView（错误视图可见）
  └─ 其他错误 → 现有 classifyNavigationError 流程

browser://site-blocked（页面内跳转 / 重定向 / 返回前进）
  → 对应标签 tab.error = site-blocked，loading=false，隐藏 WebView
  → 记录最近命中（设置页共享事件表）

轮询发现 tab.url 命中名单（非 Windows 兜底）
  → 同上，但仅在 error 为空时触发一次，避免循环

解除封杀并访问
  → 调用 site_blacklist_remove(entryId)
  → 清除 error → navigate(url)
```

原生 WebView 是子窗口，会盖住 React 错误视图。因此**只要 `tab.error` 存在，就必须隐藏该标签的 WebView**；错误清除后再 `show`。这是本次需要补的一个既有缺口（崩溃态同样适用）。

### 6.4 菜单

浏览器「⋯」菜单是双实现：React `Dropdown`（Web 模式）与 Rust 原生菜单（Tauri Windows）。两边都要加：

```text
封杀此网站            (当前主机为空 → disabled)
解除封杀此网站        (当前主机已被封杀 → 仅显示这一项)
```

点击后走同一个前端处理函数，保证行为一致。菜单项不显示在页面内 shadow DOM 版本里（该版本用于非 Windows 平台，仍可通过地址栏与设置页操作）。

## 7. 平台差异与限制

| 能力 | Windows | macOS / Linux |
| --- | --- | --- |
| 顶级导航前置拦截 | 是（命令 + `NavigationStarting`） | 命令入口拦截；页面内跳转/重定向靠轮询事后拦截 |
| 子资源拦截 | 是（`WebResourceRequested`） | 否（现有隐私模块同为 no-op） |
| 下载拦截 | 是（`on_download`） | 是（`on_download`） |
| 快捷封杀菜单 | React + 原生菜单 | React 菜单 / 页面内菜单不含该项 |

已知限制（首版接受）：

1. Service Worker 已缓存的响应可能不经过 `WebResourceRequested`；Windows 上仍会被 `NavigationStarting` 拦下，但离线缓存可能短暂显示旧内容。
2. 非 Windows 平台在轮询间隔（约 750ms）内可能已经发出请求。
3. 单标签页内的 `blob:` / `data:` 导航不匹配名单。

## 8. 测试计划

### Rust 单元测试（`site_blacklist.rs`）

- 规范化：裸域名、带路径/查询、`www.`、`*.`、大小写、端口、IDN、IPv4、IPv6。
- 拒绝：空、纯公共后缀、`javascript:`、带账号密码、非法字符、单标签主机。
- 匹配：精确、子域、关闭子域、关闭全局开关、最长规则优先。
- 状态：`reload` 后快照生效；删除后不再命中。
- 迁移：`local_store` 现有表清单测试补充三张新表与索引；迁移版本 26 幂等。

### 前端单元测试（`siteBlacklist.test.ts`）

- `hostFromUrl` / `findBlockingEntry` 与 Rust 规则一致（含 `www`、子域、禁用项、全局关闭）。
- `classifyNavigationError("site-blocked:a.com|a.com")` 返回 `site-blocked`。
- 面板的导入结果分类（新增/重复/无效）若有纯函数，单独测试。

### 构建门禁

```bash
cd desktop && npm test && npm run build
cd desktop/src-tauri && cargo fmt -- --check && cargo check --all-targets && cargo test
```

（`cargo test` 在 Windows 上的已知阻塞若仍存在，以 `cargo check --all-targets` 为准，并在提交说明中注明。）

### 手工验收

1. 添加 `example.com`，从地址栏访问 → 立即显示拦截页，DevTools Network 无该请求。
2. 打开 `https://www.example.com` → 同样被拦（`www` 规范化 + 子域）。
3. 在正常页面点击指向 `example.com` 的链接 → 拦截页出现，原页面不被替换。
4. 页面重定向到被封杀站点 → 拦截页出现。
5. 设置页关闭总开关 → 同一地址可以打开；重新开启 → 再次拦截。
6. 关闭子资源开关 → 站外页面内嵌的被封杀 iframe 恢复加载；顶级导航仍被拦。
7. 私密标签访问 → 被拦；`site_blacklist_events` 无新增。
8. 「封杀此网站」→ 当前页立即切换拦截页；「解除封杀并访问」→ 正常打开。
9. 删除/清空名单 → 拦截立即解除，无需重启。
10. 重启应用 → 名单与开关保持，历史命中记录仍可查看。

## 9. 实施批次

| 批次 | 内容 | 可独立验证 |
| --- | --- | --- |
| 1 | 迁移 #26 + `site_blacklist.rs`（规范化/匹配/快照/命令/单测） | `cargo test site_blacklist` |
| 2 | 命令注册、启动加载、`browser_create` / `browser_navigate` 拦截、错误契约 | 地址栏访问被拦 |
| 3 | WebView2 `NavigationStarting` 取消 + 事件 + 子资源过滤 | 页面内链接/重定向被拦 |
| 4 | 前端 API/缓存/拦截页/菜单/设置页签 | `npm test` + 手工验收 |
| 5 | 文档计数、README、路线图同步 | 文档检查 |

## 10. 验收标准

- 命中封杀名单的顶级导航**不产生网络请求**（Windows，以 WebView2 请求日志为准）。
- 名单增删改、开关切换立即生效，无需重启；删除后同一 URL 可正常打开。
- 拦截页信息完整，可一键解除并访问；管理入口可达。
- 私密标签不写封杀命中记录。
- 现有隐私规则集、站点权限、广告拦截行为不回归。
- `npm test`、`npm run build`、`cargo check --all-targets`、（可用时）`cargo test` 全部通过。

## 11. 优化记录（2026-10-28）

首版上线后做了一轮不改变交互契约的优化，重点是把“每个请求都要付的代价”和“名单规模”解耦，并补齐两个实际缺口。

### 11.1 匹配性能

| 项 | 优化前 | 优化后 |
| --- | --- | --- |
| Rust 匹配 | 每次请求线性扫描全部规则，O(规则数)，并按下标排序 | `exact` / `suffix` 两张哈希表；精确命中一次查表，否则最多按标签数逐级查后缀，O(标签数) |
| 子资源 URL 解析 | 每次 `WebResourceRequested` 都 `Url::parse` | `fast_url_host` 直接切出 authority 的主机，零分配；仅导航仍走 `Url::parse` |
| 前端匹配 | 每 750ms 轮询都复制并排序整份名单 | 名单变更时编译一次索引；轮询只做 O(标签数) 查表 |
| 浏览器轮询 | 拦截页/错误页也每 750ms 调 `browser_state` | 显示错误页时暂停轮询，解除后再恢复 |
| 命中记录写入 | 两次独立写库；事件表无上限 | 计数与事件同一事务；事件表只保留最新 1000 条 |

5,000 条导入名单的匹配成本与 5 条时基本相同，`WebResourceRequested` 热路径不再随名单增长而变慢。

### 11.2 补齐的缺口

1. **下载拦截**：`on_download::Requested` 命中名单时直接拒绝传输，并发出 `blocked` 下载事件，下载中心可见，不写下载历史。
2. **范围可调**：新增 `site_blacklist_set_scope` 与「同时封杀子域」开关；列表里的 `含子域 / 仅本站` 可点击切换。此前 `include_subdomains` 只能恒为 true。
3. **菜单可用性**：快捷封杀会关闭当前 WebView，因此 `nativeMode` 变为 false；「解除封杀此网站」不再依赖原生 WebView，拦截页与菜单都能解除。
4. **拦截页文案**：不再断言“没有发出任何请求”（macOS / Linux 的轮询兜底是事后拦截），改为“应用已阻止该网站继续加载”。

### 11.3 新增测试

- Rust：`exact_only_scope_does_not_cover_children`、`fast_host_handles_authority_forms`、`indexed_lookup_scales_without_linear_scan`。
- 前端：exact-only 规则、数组顺序无关的最具体规则、2,000 条名单的匹配结果一致性。
- 结果：`site_blacklist` 14 个单测全部通过，Rust 全量 243 个用例通过；前端 468 个用例通过；`npm run build` 与 `cargo check --all-targets` 通过。
