# 主流浏览器借鉴分析：Chrome / Edge / Firefox

> 状态：分析稿，2026-11-02
> 定位：Arc 提供的是「组织方式」（见 [开发路线图](roadmap.md) Iteration 6）；本文补充 Chrome、Edge、Firefox 在**输入、采集、阅读、标签生命周期、权限**五个面上的可迁移模式。
> 原则：只借「用户已经学会的操作」和「已经被验证的工程契约」，不借产品路线与商业绑定。

## 0. 结论

- **Chrome** 定义了输入框的模型（前缀分域、Tab 切换搜索域）、把历史变成「旅程」、阅读列表与页面高亮。
- **Edge** 定义了**采集**（Collections）、阅读舒适度（Immersive Reader）、睡眠标签、Workspaces。
- **Firefox** 定义了**边界**（容器标签、扩展权限面板）和**仪表盘**（Firefox View）。
- 三家共同的短板恰好是 Arcadia 的机会：扁平历史、模态恢复、不可读的权限文案。

## 1. Chrome

### 1.1 Omnibox 前缀与 Tab-to-search

**模式**：`@tabs`、`@bookmarks`、`@history` 用前缀切换候选来源；输入域名后按 `Tab` 切换为「在该站内搜索」。

**为什么适合本项目**：这是用户已经形成肌肉记忆的模型，不需要教学。知识库搜索第一次能和「打开网页」获得同等入口地位。

**落地**：

| 步骤 | 落点 |
| --- | --- |
| 前缀分域 `@` / `/` / `?` / `>` | 命令栏输入解析（纯函数） |
| Tab 切换搜索域 | 命令栏键盘层，`Tab` 循环 provider |
| 站内搜索 | `features/browser/searchEngine.ts` 已有 `SEARCH_ENGINE_PRESETS` 与 `renderSearchTemplate`，加「域名 → 模板」映射 |
| 自定义快捷词 | 借 Firefox 关键字书签，用户维护 `!wiki 词` |

**边界**：站内搜索模板只对已知搜索引擎生成，未知站点不要猜 URL 结构。

### 1.2 Journeys：历史聚类

**模式**：按主题/会话把历史聚成簇，给「继续浏览」。

**为什么适合本项目**：三家浏览器的历史都是扁平列表；知识浏览器可以把历史变成研究轨迹，并直接接上归档（6.2）与保存。

**落地**：`browser_history` 已有 `url / title / visited_at`，`visitStats.ts` 已有聚合。用纯函数按「会话间隔 + 域名亲和 + 标题词重合」分簇，输出「研究轨迹」视图；每簇支持「保存为集合」「问 AI 这一簇讲了什么」。不新增表。

### 1.3 阅读列表与页面高亮

**模式**：阅读列表 = 稍后读队列；高亮带颜色、存侧栏、可搜索、可回到原文。

**现状差距**：`features/notes/notes.ts` 把高亮存在 `localStorage`（上限 500），无颜色、无锚点、不进备份、不进检索。

**落地**：

- 新增「待读」状态（见 §6 的 6.14）；
- 高亮存 `{ quote, prefix, suffix, color, comment }`（W3C TextQuoteSelector 思路），比 XPath 稳，页面改版后仍能定位；
- 与 6.3「笔记落库」合并，一次迁移解决持久化、检索、备份、RAG 引用。

### 1.4 标签组是「对象」

**模式**：标签组有名字、颜色、可折叠、可保存恢复。

**现状**：`tabGrouping.ts` 只按 origin 算 `groupId` 做视觉分组 + 「关闭同域」，关掉即消失，不是组织工具。

**落地**：若做 6.4 Space，标签组是 Space 内部的第二层结构；至少要把组做成可命名、可持久化的实体，否则用户不会用它整理。

### 1.5 侧栏容器

Chrome 114 起把书签、阅读列表、历史、阅读模式收进同一个 side panel。Arc 的侧栏是常驻的，Chrome 的是可切换的容器——两者不冲突。本项目目前 AI 面板、笔记面板、下载中心各自为政，中期可考虑统一面板宿主，属布局层改造，排在 6.4 之后。

## 2. Edge

### 2.1 Collections：片段采集

**模式**：把选区、图片、链接、整页连同备注收进命名集合，导出到 Word / Excel / OneNote。

**为什么最重要**：Arcadia 的 `save` 只有「整篇正文 → Markdown」，笔记是 localStorage 里的孤立文本，**中间那层「我只要这一段」完全缺失**。知识工作者的真实行为是片段采集。

**落地**：统一「剪藏」对象

```text
{ kind: selection | image | link | page,
  content, sourceUrl, sourceTitle,
  note, collectionId, createdAt }
```

落 SQLite、进 FTS5、可导出 Markdown。它把 6.3 的笔记与现有整篇保存统一到一条管线。

**教训**：Edge 的功能入口反复变动。功能要有稳定位置，否则用户不会形成习惯。

### 2.2 Immersive Reader

**模式**：文本偏好（栏宽/行距/主题）、行聚焦、朗读、翻译、语法工具。

**落地**：

- 站点级 / 文章级阅读偏好，与 6.9 合并；
- 行聚焦：CSS + 指针跟随，成本极低；
- 朗读：WebView2 的 `speechSynthesis` 可用，但音色依赖 Edge 在线语音，**离线体验必须先验证**再决定是否承诺。

### 2.3 睡眠标签：底座已有，缺 UI

**现状**：`webview_suspend.rs` 已在 Windows 真实调用 `ICoreWebView2_3::TrySuspend`；`lruPolicy.ts` 已保护固定 / 发声 / 下载中的标签。能力齐了，但用户看不见：没有睡眠徽标、没有「为什么重新加载」、没有站点例外。

**结论**：这类机制的产品价值 80% 在可见性与可控性，不在回收本身（见 6.13）。

**边界**：能力矩阵写明拿不到单标签内存，所以「这个标签很占资源」只能用 Resource Timing 的请求量近似，不要照抄 Edge 的性能检测器文案。

### 2.4 Workspaces

命名的一组标签 + 收藏，可整体打开。验证了 6.4 的假设，并提示两个交互细节：**整体打开**、**空格子里的「添加当前标签」**。这两点应写进 6.4 验收。

## 3. Firefox

### 3.1 容器标签

**模式**：每个标签独立 cookie jar，同一站点不同身份互不串味。

**技术现实**：WebView2 有 `CreateCoreWebView2ControllerOptions` 的 `ProfileName` / `IsInPrivateModeEnabled`，但 wry 未暴露，需要 COM 自建 controller；WKWebView 可用 `WKWebsiteDataStore.nonPersistent()`。跨平台成本高，且与「每标签一个 WebView」的结构耦合。

**结论**：不承诺每个 Space 独立身份；先做「隔离会话」用于敏感研究，作为探索项。现有私密标签已覆盖部分需求。

### 3.2 扩展权限面板

**模式**：安装时用人话列出能力，运行时按需申请可选权限。

**为什么适合本项目**：`plugin_grants`、插件生命周期、升级需重新确认都已实现，缺的是**呈现**：安装时逐条列能力、升级时给「新增能力」diff、运行时按需授权。沙箱再严，用户看不懂开关就等于没有。

### 3.3 Firefox View

「最近关闭、其他设备的标签、最近浏览」放在一个仪表盘里，是 6.8「新标签页改为研究现场」的现成原型。可直接借信息分区：继续上次、最近关闭、待整理、已保存。

### 3.4 关键字书签与 PDF 标注

- 关键字书签（`!wiki 词`）→ 命令栏自定义快捷词，成本极低。
- PDF.js 支持手绘/文字标注；本项目已有 `extract_local_pdf` 与 `pdfArticle` 链路，若 PDF 进入正式范围，**标注应与文本一起抽取**，否则 PDF 只是「能看」，进不了知识库。

## 4. 三家共同的工程经验

1. **标签生命周期必须有 UI**：睡眠徽标、hover 说明、站点例外、点击即恢复。三家路径不同，但都把状态暴露给了用户。
2. **恢复会话不要用模态框**：Chrome 启动时是「恢复页面?」卡片；本项目的 `RecoveryPanel` 是模态的，崩溃后第一屏就被打断，应降级为页内卡片。
3. **站点控制收进一个面板**：三家都是「点地址栏的锁 → 一个面板看权限、Cookie、站点设置」。本项目现在散在 `sitePermissions`、`site_blacklist`、广告过滤开关、清除站点数据四处，应合并为 `<SitePanel>`。
4. **输入框收敛**：Chrome 前缀、Edge 搜索模式、Firefox 关键字，三家的心智模型一致。照做即可，不要发明新语法。

## 5. 明确不借鉴

- **Chrome**：登录即同步的绑定、标签无限堆叠、扩展「全量授权」的恐吓式文案。
- **Edge**：功能堆叠 + 资讯流注入 + Copilot 强推；入口位置反复变动。
- **Firefox**：权限疲劳、**把保存能力外包给第三方**（Pocket 已于 2025 年关停，用户的稍后读直接蒸发）、基础能力推进过慢。
- **三家共同**：扁平历史、模态恢复、不可读的权限说明。这三样恰好是知识浏览器最容易做出差异的地方。

## 6. 落地优先级

| 借鉴点 | 来源 | 并入 | 成本 |
| --- | --- | --- | --- |
| Tab-to-search + 站点模板 | Chrome / Firefox | 6.1 增补 | 低 |
| 睡眠标签 UI + 站点例外 | Edge / Chrome | 6.13 | 低 |
| 历史聚类「研究轨迹」 | Chrome Journeys | 6.2 增补 | 中低 |
| 阅读队列（待读） | Chrome Reading List | 6.14 | 低 |
| 高亮颜色 + 文本锚点 | Chrome | 6.3 增补 | 中低 |
| 剪藏片段 | Edge Collections | 6.15 | 中 |
| 统一站点面板 | 三家 | 6.16 | 中低 |
| 阅读舒适度 + 行聚焦 + 朗读 | Edge / Firefox | 6.9 扩展 | 中 |
| 命名标签组 | Chrome | 6.4 增补 | 中 |
| 插件权限面板 | Firefox | 插件批次 | 中 |
| 容器隔离 | Firefox | 探索项 | 高 |

判断：**剪藏片段**补采集缺口，**睡眠标签 UI**把已写好的引擎变成可感知能力，两者最值得先做；**命令栏**是这一切的入口，应最先落地。

## 7. 代码落点索引

| 模块 | 位置 |
| --- | --- |
| 标签条与工具栏 | `desktop/src/pages/browser/BrowserPage.tsx` |
| 标签分组 | `desktop/src/features/browser/tabGrouping.ts` |
| 搜索模板 | `desktop/src/features/browser/searchEngine.ts`、`navigation.ts` |
| 笔记 | `desktop/src/features/notes/notes.ts`、`NotesPanel.tsx` |
| 睡眠策略 | `desktop/src/features/browser/lruPolicy.ts`、`src-tauri/src/webview_suspend.rs` |
| 站点权限 / 黑名单 | `features/browser/sitePermissions.ts`、`src-tauri/src/site_blacklist.rs` |
| 插件授权 | `src-tauri/src/plugins/`、`plugin_grants` 表 |
| 历史 | `features/history/`、`browser_history` 表 |

## 8. 待验证

- WebView2 `speechSynthesis` 的离线可用性与音色来源。
- `TrySuspend` 恢复后滚动位置与表单状态是否保持（影响「睡眠」是否需要提示）。
- 站点级 `ProfileName` 隔离在 wry 当前版本是否可绕过（若可行，容器隔离成本下降）。
- PDF.js 标注数据能否与 `document_chunks` 对齐。
