# 媒体资源探测 MVP

> 版本：v0.1 · 实施日期：2026-10-30 · 状态：已实现

## 目标

在不读取响应正文、不绕过站点鉴权、不处理 DRM 的前提下，让用户手动扫描当前标签页已经加载的媒体和文档资源，并把可直接访问的资源交给 Arcadia 现有下载中心。

## 本版本范围

- 从 `PerformanceResourceTiming` 读取当前文档已经产生的网络资源条目。
- 补充扫描 `video`、`audio`、`source`、`track`、`embed`、`object` 与文档链接。
- 识别视频、音频、HLS（M3U8）、DASH（MPD）、字幕、PDF 和 EPUB。
- 按 URL 去重，最多保留 200 条候选；在 UI 中展示前 20 条。
- 支持重新扫描、复制链接、交给现有下载中心下载。
- 私密标签只在内存和当前 UI 中显示，不写入数据库。

## 不在本版本范围

- 不抓取或保存响应正文，不记录 Cookie、Authorization 和请求体。
- 不绕过登录、临时签名、防盗链、付费墙或 DRM。
- 不合并 HLS/DASH 分片，也不转码音视频。
- 不保证跨域资源能够由下载器再次访问；需要 Cookie 或 Referer 的 URL 可能下载失败。
- 本版本是用户触发的快照扫描，不是持续监听器，因此仅能看到页面仍保留在 Resource Timing 缓冲区中的条目。

## 架构

```text
用户点击“扫描当前页”
        ↓
browser_resource_candidates（Rust/Tauri 命令）
        ↓ eval_json（只读脚本）
PerformanceResourceTiming + DOM 媒体元素
        ↓
前端分类、去重、命名
        ↓
资源面板 ──复制链接
        └──现有 download_start_reqwest
```

网页仍运行在独立子 WebView 中。扫描命令只返回 URL、加载发起类型和浏览器公开的大小信息；不会把网页权限提升为 Tauri 命令权限。

## 后续版本

1. Windows 接入 WebView2 `WebResourceResponseReceived`，补充状态码、Content-Type、Content-Length 与 Content-Disposition。
2. 为 HLS/DASH 增加只读清单解析，展示清晰度、码率、音轨和字幕轨。
3. 为需要请求头的资源增加受控、可审计的 Referer/User-Agent 继承；永不把 Cookie 或 Authorization 显示到 UI。
4. 将资源元数据作为用户显式选择的 AI 上下文，用于解释资源、智能命名和清单摘要；AI 不自动监听全部请求。
5. 评估 macOS/Linux 原生响应事件能力，并在 UI 中显示平台能力差异。

## 验收标准

- 普通 HTML5 视频/音频页面可以找到对应直链。
- `.m3u8`、`.mpd`、`.vtt`、`.pdf`、`.epub` 能正确分类。
- 同一 URL 不重复显示，查询参数中的敏感值不写日志或数据库。
- 无原生 WebView、内置 PDF、跨域限制或空结果时给出可理解的提示。
- 下载仍经过现有危险类型分类和下载记录体系。
