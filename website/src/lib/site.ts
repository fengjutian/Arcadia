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

export const featureStats = [
  { value: '179', unit: '个', label: 'Tauri 命令' },
  { value: '26', unit: '个', label: 'SQLite 顺序迁移' },
  { value: '2', unit: '类', label: 'AI Provider' },
  { value: '0', unit: '项', label: '插件默认权限' },
];

export const featureGroups = [
  {
    id: 'browse',
    no: '01',
    title: '浏览',
    summary: '真实 WebView 标签页承载网页，标签、工作区、历史、书签与下载都围绕同一次浏览展开。',
    note: '每个标签对应一个独立子 WebView；网页内容与应用 UI 处于不同安全边界。',
    items: [
      { title: '原生多标签', body: '新建、关闭、切换与重排标签，支持标签搜索、分组、关闭同域标签和静音。', tag: '基础' },
      { title: '弹窗转为标签', body: '网页中的 target="_blank" 与 window.open() 会打开为应用内标签，而不是跳出应用。', tag: '基础' },
      { title: '工作区与会话', body: '用多个工作区拆分任务，退出后恢复会话，崩溃后可恢复，也能找回最近关闭的标签。', tag: '组织' },
      { title: '历史与书签', body: '浏览历史、书签收藏与站点检索全部保存在本地，并可在界面中清理。', tag: '本地' },
      { title: '私密标签', body: '不写入历史、关闭记录、站点权限与表单数据，关闭标签即结束本次会话。', tag: '隐私' },
      { title: '下载中心', body: 'reqwest 流式下载、Range 续传与危险文件判定，支持暂停、取消和重试。', tag: '传输' },
      { title: '媒体资源探测', body: '扫描当前页面已加载的视频、音频、HLS/DASH 清单、字幕与文档，交给下载中心处理。', tag: '传输' },
      { title: '站点权限与证书', body: '站点权限提示、证书错误拦截与一次性放行，Windows 下通过 WebView2 事件订阅实现。', tag: '安全' },
    ],
  },
  {
    id: 'library',
    no: '02',
    title: '阅读与知识库',
    summary: 'Reader 把网页还原成可读正文，保存为 Markdown 进入本地 SQLite，之后可以随时整理、导出和备份。',
    note: '不依赖任何外部服务；页面无法提取正文时会明确报错，不会生成示例内容。',
    items: [
      { title: 'Reader 正文提取', body: '用 Mozilla Readability 提取正文，再通过 Turndown 转换为 Markdown，去掉导航与广告噪音。', tag: '转换' },
      { title: '保存到本地', body: '正文、来源 URL 与结构化元数据写入桌面 SQLite，并由触发器同步 FTS5 索引。', tag: '存储' },
      { title: '星标、集合与标签', body: '用星标标记重点，用集合组织主题，用标签建立交叉索引，来源始终可追溯。', tag: '整理' },
      { title: '笔记与导出', body: '在文档上补充笔记，并将正文与笔记导出为 Markdown 文件。', tag: '整理' },
      { title: '备份与恢复', body: '支持全库导出备份与从文件恢复；升级开发预览版前可以先留一份底稿。', tag: '数据' },
      { title: '真实本地数据', body: '知识库、搜索与详情直接读取本地真实数据，不内置演示文章，也不会伪造可用状态。', tag: '原则' },
    ],
  },
  {
    id: 'ai',
    no: '03',
    title: '检索与 AI',
    summary: 'FTS5 全文检索与向量召回并行，AI 在证据之上完成摘要、翻译与跨文档问答。',
    note: 'Provider 可替换，API Key 进入系统密钥环，不写入前端包、日志或版本库。',
    items: [
      { title: 'FTS5 全文检索', body: 'unicode61 分词、bm25() 排序与前缀匹配，覆盖文档与分块两级索引。', tag: '检索' },
      { title: '混合召回', body: '分块 → Embedding → 本地向量索引 + BM25 → RRF 融合 → Reranker，词法与语义互补。', tag: 'RAG' },
      { title: '强制引用', body: '回答必须附带来源引用并通过校验，跨文档问答同样保留可回查的证据链。', tag: 'RAG' },
      { title: '页面级 AI', body: '对当前网页做流式摘要、页面问答、翻译和自动标签，无需先保存整篇内容。', tag: 'AI' },
      { title: '可替换 Provider', body: '内置 OpenAI Compatible 与 Ollama，对话模型与 Embedding 模型可以分别配置。', tag: 'AI' },
      { title: '受控 Agent', body: 'runtime / supervisor / tools / approval / budget / checkpoint 组成执行闭环，并支持 MCP 客户端接入外部工具。', tag: 'Agent' },
    ],
  },
  {
    id: 'privacy',
    no: '04',
    title: '隐私与扩展',
    summary: '浏览数据默认留在本地，请求拦截与插件运行时都建立在最小权限之上。',
    note: '请求拦截与证书处理目前在 Windows 上是真实实现；其他平台受系统 WebView 接口限制。',
    items: [
      { title: '广告与追踪拦截', body: '规则编译、匹配、WebView2 请求拦截、站点级开关与真实拦截统计。', tag: '拦截' },
      { title: '网站封杀名单', body: '命中名单后在发出请求前取消导航，并阻断站外页面嵌入的被封杀资源与直链下载。', tag: '拦截' },
      { title: '最小权限边界', body: '主窗口只申请最小 capabilities；远程网页不能直接调用应用的高权限 Tauri 命令。', tag: '边界' },
      { title: '本地优先', body: '知识库与浏览数据保存在设备上，应用不暴露入站 HTTP API，也不要求后台服务常驻。', tag: '原则' },
      { title: 'WASM 插件隔离', body: 'Wasmtime + WASI Preview 2 组件模型，默认零能力，配合 Fuel、内存上限与超时限制。', tag: '扩展' },
      { title: '可审计操作', body: 'Agent 的写入、删除与外发类工具走审批和风险分级，敏感调用写入脱敏审计日志。', tag: '审计' },
    ],
  },
];

export const platformMatrix = [
  { capability: '浏览、Reader、知识库与本地全文检索', windows: '完整可用', others: '源码构建可用' },
  { capability: '本地 AI Provider、RAG 与受控 Agent', windows: '完整可用', others: '源码构建可用' },
  { capability: '广告与追踪请求拦截', windows: '请求级拦截', others: '受 WebView 接口限制，暂为 no-op' },
  { capability: '证书错误拦截与一次性放行', windows: '已实现', others: '受 WebView 接口限制，暂为 no-op' },
  { capability: '网站封杀名单', windows: '导航前拦截，含子资源与下载', others: 'URL 轮询兜底，可能短暂延迟' },
];

export const workflow = [
  { step: '浏览', detail: '在真实 WebView 标签页中打开、整理和恢复网页。' },
  { step: '阅读', detail: '提取正文，减少页面噪音，并调用 AI 辅助理解。' },
  { step: '保存', detail: '将 Markdown、来源与元数据写入本地 SQLite。' },
  { step: '找回', detail: '通过全文搜索、标签、集合和 RAG 再次使用资料。' },
];
