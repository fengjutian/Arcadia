export type ChangeTag = '新增' | '改进' | '修复' | '说明';

export interface ChangeGroup {
  tag: ChangeTag;
  items: string[];
}

export interface Release {
  version: string;
  anchor: string;
  date: string;
  dateLabel: string;
  title: string;
  summary: string;
  status: 'in-progress' | 'latest' | 'released' | 'initial';
  statusLabel: string;
  groups: ChangeGroup[];
}

/**
 * 官网更新日志，按时间倒序排列。
 *
 * 只记录面向使用者的变化；版本号与日期以仓库 tag 为准
 * （v0.1.0 / v0.5.0 / v0.6.0），未发布条目跟随主分支状态更新。
 */
export const releases: Release[] = [
  {
    version: '未发布',
    anchor: 'unreleased',
    date: '2026-11-02',
    dateLabel: '2026-11-02',
    title: '统一命令栏与交互收口',
    summary: '主分支上的下一批改动：用一个命令栏串起导航与动作，同时收敛布局和滚动所有权。尚未随版本发布。',
    status: 'in-progress',
    statusLabel: '开发中',
    groups: [
      {
        tag: '新增',
        items: [
          '统一命令栏：`Ctrl/⌘ + K` 打开，在同一个输入框里搜索标签页、历史、收藏和知识库，并执行浏览器动作。',
          '命令栏支持 `@` 标签、`/` 知识库、`?` 问 AI、`>` 动作四类前缀直选，`Tab` 循环切换范围。',
          '命令解析与评分逻辑拆为纯函数，并补充 15 个测试用例。',
        ],
      },
      {
        tag: '改进',
        items: [
          '界面布局与滚动所有权收口，让侧栏和窗口 chrome 在滚动时保持固定。',
          '站点封杀名单的写路径改为内存快照整体替换，避免在 WebView 回调线程上访问 SQLite。',
        ],
      },
      {
        tag: '说明',
        items: [
          '开发中条目会继续调整，最终以 GitHub 提交记录与正式发布说明为准。',
        ],
      },
    ],
  },
  {
    version: '0.6.0',
    anchor: 'v0-6-0',
    date: '2026-10-30',
    dateLabel: '2026-10-30',
    title: '权限、工具栏与原生交互稳定性',
    summary: '在 0.5.0 的能力面上收口浏览链路：权限请求排队处理，工具栏菜单接入原生层，截图、滚动与 WebView 生命周期更稳。',
    status: 'latest',
    statusLabel: '最新版本',
    groups: [
      {
        tag: '新增',
        items: [
          '站点权限请求队列：多个权限请求依次展示与处理，私密标签复用同一套队列逻辑。',
          '浏览器原生工具栏菜单，支持页面内菜单与窗口按钮交互。',
          '标签边界与显隐命令，用于原生 WebView 与前端布局保持同步。',
        ],
      },
      {
        tag: '改进',
        items: [
          '证书与权限响应改为异步处理，完善等待超时与诊断日志。',
          '页面截图异步化，捕获前调整标签尺寸，减少截图时的界面卡顿。',
          'WebView 创建、窗口获取与私密模式清理路径更稳健。',
        ],
      },
      {
        tag: '修复',
        items: [
          '完善私密标签下的历史记录写入逻辑。',
          '修复未知标签命令的边界兜底，以及原生菜单 token 的处理。',
          '修正标签边界与可见性同步失败时的回退行为。',
        ],
      },
    ],
  },
  {
    version: '0.5.0',
    anchor: 'v0-5-0',
    date: '2026-10-29',
    dateLabel: '2026-10-29',
    title: '从阅读工具到完整浏览工作台',
    summary: '一次大跨度迭代：补齐网站封杀名单、媒体资源探测、隐私统计与下载续传，并重做本地检索和 AI 搜索体验。',
    status: 'released',
    statusLabel: '已发布',
    groups: [
      {
        tag: '新增',
        items: [
          '网站封杀名单：用户维护站点级黑名单，命中后在发出请求前取消导航，并阻断站外页面嵌入的资源与直链下载（迁移 #26）。',
          '媒体资源探测 MVP：扫描当前页面已加载的视频、音频、HLS/DASH 清单、字幕与文档，并交给下载中心。',
          '下载中心支持 Range 续传、暂停、取消与重试，并区分危险文件。',
          '隐私拦截统计、站点级开关与隐私历史记录。',
          '本地检索增强：拼音、CJK 分词、搜索别名、查询建议、结果去重与匹配原因。',
          'AI 搜索：结构化答案、引用校验、答案版本对比与恢复、缓存、流程图/时间线/图表与导出。',
          '浮动 AI 助手、对话历史管理、任务通知，以及把回答保存到知识库。',
          '密码管理器支持用户主动选择的自动填充与安全凭据处理。',
          '新标签页加入搜索引擎预设、Bing 每日壁纸、天气与工具面板。',
          '扩展主题色、下载设置与浏览器外观配置。',
        ],
      },
      {
        tag: '改进',
        items: [
          '知识库设置改为分栏与页签结构，搜索、历史与任务面板支持分页。',
          '后台标签接入 WebView2 原生挂起与恢复（TrySuspend / Resume），降低常驻内存。',
          'Windows 上补充测试二进制清单，统一 Rust 测试入口。',
        ],
      },
      {
        tag: '修复',
        items: [
          '修复 comctl32 v6 依赖导致的 Rust 测试启动失败。',
          '修正 WebView2 资源类型分类，使站外资源与封杀名单判定一致。',
          '修复历史分页、搜索结果跳转与任务面板溢出等界面问题。',
        ],
      },
    ],
  },
  {
    version: '0.1.0',
    anchor: 'v0-1-0',
    date: '2026-10-09',
    dateLabel: '2026-10-09',
    title: '第一个可运行的开发预览版',
    summary: '打通「浏览 → 提取正文 → 保存到本地 → 全文检索」的最小闭环，为后续 AI、隐私与插件能力搭好地基。',
    status: 'initial',
    statusLabel: '首个预览',
    groups: [
      {
        tag: '新增',
        items: [
          '基于 Tauri 2 与 React 19 的桌面壳，原生多标签 WebView 与地址栏导航。',
          '使用 Mozilla Readability 提取正文，并通过 Turndown 转换为 Markdown。',
          '网页正文、来源 URL 与元数据写入本地 SQLite；知识库直接读取真实数据。',
          'SQLite FTS5 全文检索（`unicode61` 分词 + `bm25()` 排序 + 前缀匹配）。',
          '阅读模式、文档详情、星标、集合、标签、笔记与 Markdown 导出。',
          '工作区、会话恢复、历史、书签、下载中心与私密标签。',
        ],
      },
      {
        tag: '说明',
        items: [
          '早期开发版本：AI Provider、隐私拦截与插件系统的部分界面仍是开发中的功能入口。',
          '项目不内置演示文章，也不会在服务不可用时展示伪造数据。',
        ],
      },
    ],
  },
];

export const releasedReleases = releases.filter((release) => release.status !== 'in-progress');
export const latestRelease = releases.find((release) => release.status === 'latest') ?? releasedReleases[0];
