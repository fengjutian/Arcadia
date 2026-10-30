export const site = {
  name: 'Arcadia',
  description: '把网页浏览、正文阅读、本地知识库、检索与 AI 辅助放进同一个桌面工作流。',
  url: 'https://arcadia-browser.netlify.app',
  repository: 'https://github.com/fengjutian/browser',
  releases: 'https://github.com/fengjutian/browser/releases',
};

export const capabilities = [
  { no: '01', title: '原生多标签浏览', body: '地址搜索、标签分组与搜索、工作区、会话恢复、历史、书签和下载中心，都在同一个桌面窗口中完成。' },
  { no: '02', title: '阅读并保存网页', body: '用 Readability 提取正文，转换为 Markdown 后保存到本地知识库；支持星标、标签、集合、笔记与导出。' },
  { no: '03', title: '检索与引用问答', body: '通过 SQLite FTS5 全文搜索与混合召回找回资料，并基于当前网页或知识库进行摘要、翻译和带引用问答。' },
  { no: '04', title: '隐私与可控扩展', body: '提供私密标签、站点权限、广告与追踪拦截、网站封杀名单，以及默认零能力的 WASM 插件权限模型。' },
];

export const workflow = [
  { step: '浏览', detail: '在真实 WebView 标签页中打开、整理和恢复网页。' },
  { step: '阅读', detail: '提取正文，减少页面噪音，并调用 AI 辅助理解。' },
  { step: '保存', detail: '将 Markdown、来源与元数据写入本地 SQLite。' },
  { step: '找回', detail: '通过全文搜索、标签、集合和 RAG 再次使用资料。' },
];
