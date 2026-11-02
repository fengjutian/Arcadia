# 国际化（i18n）

Arcadia 桌面端第一批支持两种界面语言：

| 语言 | BCP 47 | 说明 |
| --- | --- | --- |
| 简体中文 | `zh-CN` | 默认语言，也是消息 id 的源语言 |
| English | `en-US` | 英文界面 |

语言可在 **设置 → 通用 → 语言** 中切换。选择会写入 `localStorage`（`arcadia-locale`），随后窗口重新加载；重新加载后会回到设置页，主窗口与浮动助手窗口通过 `storage` 事件保持同步。首次启动默认使用简体中文，不做系统语言自动探测。

## 设计

翻译采用 gettext 风格的 **消息 id = 简体中文源文**：

```ts
import { t } from '../../i18n'

t('保存')
t('已保存 {count} 篇文档', { count: 3 })
```

- 中文是规范语言，不需要词典；`t()` 直接内插占位符并返回源文。
- 英文词典按 id 查找；缺失或空字符串时回退到中文源文，因此迁移与翻译可以分步进行，界面不会出现空标签。
- 英文条目可以是 `{ one, other }`，`t()` 用 `vars.count` 选择单复数：

```ts
// i18n/en-US/example.ts
export const example: Messages = {
  '共 {count} 篇文档': { one: '{count} document', other: '{count} documents' },
}
```

### 为什么切换语言要重新加载

不少模块在导入时构造常量（快捷键表、主题预设、搜索引擎列表、设置页签等）并调用 `t()`。这些常量不会因 React 重渲染而重新求值，所以语言选择会持久化后调用 `window.location.reload()`。`setLocale(locale)` 只切换内存状态，供测试或外部命令使用；`changeLocale(locale)` 才会重新加载。设置页在触发切换前通过 `rememberViewForReload('settings')` 记录路由，重新加载后由 `AppRouter` 一次性恢复，因此用户不会在切换语言后突然回到浏览器页。

## 代码结构

```text
desktop/src/i18n/
├── index.ts          # t / translate、locale 持久化、useLocale、日期与数字格式化
├── types.ts          # Locale、Messages、MessageVars、LOCALE_LABELS
├── i18n.test.ts      # 运行时、词典完整性、源码残留中文检查
└── en-US/
    ├── index.ts      # 合并各领域词典
    ├── common.ts     # 通用词汇与 UI 基础组件
    ├── shell.ts      # 应用外壳、导航、命令栏
    ├── browser.ts    # 浏览器、标签、下载、历史、书签、任务
    ├── library.ts    # 知识库、文档、笔记、归档
    ├── search.ts     # 本地搜索与 AI 搜索
    ├── assistant.ts  # AI 助手、摘要、翻译、Agent
    ├── settings.ts   # 设置页
    ├── privacy.ts    # 隐私、封禁名单、隐私数据导出
    ├── mcp.ts        # MCP 与插件
    └── skillhub.ts   # SkillHub
```

词典按领域拆分，既方便扩展，也避免多人同时编辑同一个大文件。

### 在代码中使用

```tsx
import { t } from '../i18n'

<Button>{t('保存')}</Button>
<Input placeholder={t('搜索网站或用户名')} />
messageApi.success(t('已导出 {value0} 条记录', { value0: count }))
```

约定：

- 占位符统一写作 `{value0}`、`{value1}`（模板字符串自动迁移时按表达式顺序编号）或语义化的 `{count}`。
- 英文翻译必须保留与源文完全相同的占位符集合。
- 不要翻译品牌与技术名词：Arcadia、AI、MCP、WebView、SQLite、OpenAI、Ollama、PDF、URL、JSON、快捷键组合等。
- 中文全角标点在英文中转换为半角标点；省略号保留 `…`。

### 日期、时间与数字

需要按界面语言格式化时使用：

```ts
import { formatDateTime, formatNumber } from '../../i18n'

formatDateTime(entry.visitedAt)
formatNumber(document.wordCount)
```

部分遗留位置仍直接调用 `toLocaleString()`（跟随操作系统区域设置）。迁移这些位置时替换为上述 helper 即可。

## 维护脚本

```bash
cd desktop

# 检查：缺失 / 空翻译 / 失效 id
node scripts/i18n-catalog.mjs

# 为源码中新增的 t('...') 生成空占位条目（保留已有翻译）
node scripts/i18n-catalog.mjs --init
```

`scripts/i18n-codemod.mjs` 是首次迁移使用的一次性 Babel codemod，会把 JSX 文本、字符串字面量与模板字符串包装为 `t()`。当前源码已完成迁移，通常不再需要运行它；若要迁移新模块，先阅读脚本顶部的跳过规则。

## 测试门禁

`src/i18n/i18n.test.ts` 会：

1. 扫描源码中所有 `t()` / `translate()` 调用，断言每个 id 都有非空英文翻译；
2. 断言英文条目没有中文字符、占位符与 id 完全一致、拆分词典之间没有冲突翻译；
3. 断言词典里没有源码已不再使用的失效 id；
4. 扫描所有 `.ts` / `.tsx`，断言除白名单（模型提示词、与模型输出比较的哨兵字符串、字体名、站点分类键等数据）外没有未包装的中文 UI 文本。

新增 UI 文案后如果忘记翻译，测试会直接失败并列出缺失 id。

## 当前范围与限制

- **前端 UI 已覆盖**：浏览器外壳、知识库、搜索、AI 助手、设置、隐私、MCP、插件、SkillHub、共享 UI 组件。
- **Rust 后端错误信息尚未国际化**：Tauri command 返回的错误仍是中文，会在 toast 或表单中原样展示。后续可通过错误码 + 前端映射逐步收敛。
- **AI 生成内容不随界面语言变化**：模型提示词、引用标记、模型输出继续遵循文档/用户语言；界面语言只决定应用自身的标签与提示。
- **官网（`website/`）暂未接入**该 i18n 运行时。
- `NewTabPage` 原先自带的 `new-tab-locale` 开关已移除，统一使用应用级语言设置。
