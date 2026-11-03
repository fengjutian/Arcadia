# 玻璃材质设计文档

> 状态：设计定稿，待实施  
> 版本：v1.0（2026-11-03）  
> 适用范围：`desktop/src/styles/glass.scss`、`desktop/src/styles/compact.scss` 中与壁纸/浮层相关的材质规则，以及 `desktop/src/components/ui/` 的浮层组件  
> 参照：Apple [Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)、[Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)、[HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、WWDC25 [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219)

## 1. 这份文档解决什么

Arcadia 已经有一套可用的玻璃表面：`glass.scss` 用一组 `--glass-*` 令牌，把卡片、侧栏、标题栏、菜单、对话框统一成了"半透明面 + 细亮边 + 斜向高光 + 环境投影"，并且只区分明暗两套配方，13 套主题自动继承。问题不在"有没有玻璃"，而在三件事：

1. **层级没有强制约束。** 现在是"哪个选择器需要，就给它加一条 backdrop-filter"，同一屏可能出现四层模糊叠在一起，浮层内部再套浮层。Apple 的规则很明确：玻璃是**功能层**，不是装饰；不要叠玻璃。
2. **厚度没有刻度。** 现有 `--glass-blur` / `-chrome` / `-overlay` 是三个散落的数值，缺少"这个组件该用哪一档"的对应关系，新增组件时只能凭感觉取值。
3. **光学只做了"半透明"。** 真正的玻璃感来自边缘：光线在厚度处被折射、聚集，形成一圈比内部更亮的边。现有实现只有 `inset 0 1px 0` 的顶部亮线，面板在复杂背景上仍偏"磨砂塑料"。

本文档给出：分层模型、材质刻度、光学配方、令牌表、组件映射、动效、可访问性、性能预算、降级策略与验收清单。**它描述的是 Arcadia 自己的材质系统，不是对 iOS 26 的复刻**——第 2.3 节说明哪些做得到、哪些不做。

## 2. 设计来源与取舍

### 2.1 Apple 的三个核心属性

Liquid Glass 是随 iOS / iPadOS / macOS 26 引入的动态材质，Apple 把它定义为"结合了玻璃光学属性与流体感的材质"，并明确它是一个**独立的功能层**，用来承载控件与导航，让下层内容保持焦点。其中与我们相关的是三点：

- **Lensing（透镜折射）。** 与旧材质"散射光线"不同，Liquid Glass 会实时弯折、聚集光线，在背景上形成位移与放大，从而在不加厚重描边的前提下把控件和内容区分开。Apple 的原话是它"通过调制光线的弯折与透镜效果来显隐"，而不是淡入淡出。
- **流体性（Dynamics）。** 材质与动效是一起设计的：交互时"瞬间弯曲并充能发光"，带有凝胶般的弹性；元素可以临时"抬起"成为玻璃，静止时保持安静。
- **自适应性（Adaptivity）。** 材质会随元素重叠、焦点状态、尺寸、外观模式、辅助功能设置而变化；系统组件自动接管这些变化。Apple 同时要求开发者"减少控件与导航上的自定义背景"，"克制使用玻璃效果"，并"在多种显示与辅助功能设置下测试"。

### 2.2 我们采纳的四条原则

| 原则 | 含义 | 对应 Apple 依据 |
| --- | --- | --- |
| 内容优先 | 玻璃只包边，不当主角；任何一屏的视觉重心必须落在内容上 | "Liquid Glass seeks to bring attention to the underlying content" |
| 一层玻璃 | 任意像素路径上最多一层模糊；玻璃内部只用填充、描边、高光 | "avoid overcrowding or layering Liquid Glass elements on top of each other" |
| 以光定形 | 用边缘光与投影区分层级，不靠加粗描边或加深底色 | Lensing：折射边缘提供分离感 |
| 始终可关 | 每种玻璃都有等价的实心形态；关掉模糊后布局与信息不减 | reduce transparency / increase contrast / 降级路径 |

### 2.3 明确不做的部分

| Apple 能力 | 我们不做 | 替代方案 |
| --- | --- | --- |
| 实时背景折射（位移贴图、放大） | Web 平台无法通用地在合成阶段采样背后像素并做位移 | 静态"边缘折射"配方：顶部亮边 + 内侧柔光 + 底部暗边，模拟厚度 |
| 形状融合（`GlassEffectContainer` 的流体合并） | 需要几何级别的 metaball 合并，CSS 无法承担 | 用同一 `transform-origin` 的展开 + 阴影/圆角过渡近似 |
| 玻璃元素的"材质化"进出场 | 动画 `backdrop-filter` 会触发整层重绘 | 只动画伪元素的 opacity 与 transform（见第 10 节） |
| 玻璃覆盖在网页内容之上 | 见第 8 节：页面是原生子 WebView，应用层采不到它的像素 | 页面区域内浮层改用厚材质 + 高不透明度填充 |

## 3. 分层模型

```text
┌───────────────────────────────────────────────────────────┐
│ L3  覆盖层 overlay   菜单 / 下拉 / 对话框 / 抽屉 / 消息条    │  最厚材质，最强投影，最高 z
├───────────────────────────────────────────────────────────┤
│ L2  功能层 chrome    标题栏 / 侧栏 / 标签条 / 工具条 / 面板   │  玻璃唯一合法区域
├───────────────────────────────────────────────────────────┤
│ L1  承托层 canvas    页面底色 + 三团 accent 光晕 / 壁纸       │  为玻璃提供可被"看见"的背景
├───────────────────────────────────────────────────────────┤
│ L0  内容层 content   网页 / 正文 / 卡片网格 / 图片           │  禁止玻璃，禁止 backdrop-filter
└───────────────────────────────────────────────────────────┘
```

**L0 内容层。** 知识库卡片、搜索结果、正文、图片都属于内容层。它们可以是半透明填充（让底层光晕透出来），但**不允许**再调用 `backdrop-filter`。现有 `glass.scss` 给 `.ui-card`、`.document-card`、`.result-card` 都加了 `blur(14px)`，这违反本模型——它们背后只有一层纯色画布，模糊不可见却要付合成成本，且让后续"把卡片放进玻璃面板"时必然出现叠层。第 15 节把这条列入改造清单。

**L1 承托层。** 由 `body[data-theme]` 的 `background-color` + 三团 `radial-gradient` 光晕，或 `data-wallpaper='on'` 时的照片构成。承托层的职责是提供**明暗与色彩变化**：如果背景是均匀的纯色，玻璃的折射边缘与投影都无从显现。这也是壁纸主题下玻璃观感最好的原因。

**L2 功能层。** 标题栏、侧栏、标签条、浏览器工具条、AI 面板、笔记面板、新建标签页工作区。规则：

- 玻璃只在这一层出现，且**同一屏最多 4 个可见模糊层**（第 12 节）。
- L2 内部的按钮、输入框、标签胶囊**不再引入新的 backdrop-filter**，只用 `--glass-fill` / `--glass-rim` 做"玻璃上的浮雕"。
- L2 与 L0 之间必须有清晰的边界：要么是 1px 边缘光，要么是投影，不能只靠"颜色更浅"。

**L3 覆盖层。** 菜单、下拉、对话框、抽屉、消息条。规则：

- 材质比 L2 更厚（更大 blur、更高填充、更强投影），因为覆盖层下方的信息更复杂。
- 覆盖层**不得**再包含带背景模糊的子面板。覆盖层里嵌套的 popover 改用"实心卡片 + 描边"。
- 覆盖层必须有不透明回退（第 13 节），因为它是阻断性交互，可读性优先于通透感。

## 4. 材质刻度

五个等级，覆盖全部组件。数值以 CSS 像素为单位，`blur` 指 `backdrop-filter` 的模糊半径；`fill` 指明色主题下的白色混合比例，暗色主题按第 6.2 节配方换算。

| 等级 | 令牌前缀 | blur | saturate | fill（亮） | fill（暗） | 典型组件 |
| --- | --- | --- | --- | --- | --- | --- |
| `mist` | `--glass-mist-*` | 0 | 100% | 46% | `rgba(255,255,255,.03)` | 标签胶囊、工具按钮的静止态、列表内的分段容器 |
| `thin` | `--glass-thin-*` | 8px | 130% | 58% | `rgba(255,255,255,.045)` | 标签页、输入框、快捷站点磁贴、小卡片 |
| `regular` | `--glass-regular-*` | 14px | 140% | 68% | `rgba(255,255,255,.055)` | 侧栏、面板、新建标签页工作区、内容卡片（填充取本级，模糊取 `mist`） |
| `thick` | `--glass-thick-*` | 22px | 145% | 78% | `rgba(255,255,255,.07)` | 标题栏、浏览器工具条、AI 面板、笔记面板 |
| `overlay` | `--glass-overlay-*` | 30px | 160% | 84% | `rgba(255,255,255,.085)` | 菜单、下拉、对话框、抽屉、消息条 |

补充规则：

- **`mist` 是不模糊档。** 它只提供填充、内亮边与极轻投影，用于"在玻璃面板内部再分层"的场景。这是"一层玻璃"原则的落地手段：需要层级时降 blur，而不是加 blur。
- **填充与模糊可以分开取档，但只允许一处破例。** 内容卡片取 `regular` 的填充与 rim、`mist` 的模糊（即 0），因为它背后只有画布，模糊不可见却要付合成成本。其余组件必须整档取用。
- **`clear` 档暂不提供。** Apple 的 clear 玻璃用于覆盖在图像上的媒体控件，并需要 35% 的暗化层来保证对比度。本产品没有"控件浮在照片上"的场景；一旦出现（如图片查看器），按第 8 节的"页面区域"规则单独设计，不进主刻度。
- **稠密网格降档。** 虚拟列表、知识库卡片网格里，滚动容器内的元素一律 `mist`；容器本身若是玻璃，也只能是 `thin`。原因见第 12 节：滚动中的模糊层是 WebView2 上最可靠的掉帧来源。

## 5. 光学配方

一个玻璃面由六层光构成，顺序即绘制顺序（自下而上）：

```text
⑥ 描边 rim        0.5–1px，上亮下暗，定义轮廓
⑤ 折射边 lens     内侧 6–12px 的柔光亮环，模拟玻璃厚度处的光聚集
④ 斜向高光 sheen  155° 线性渐变，从左上到右下衰减
③ 染色 tint       accent 以 8% 上限混入填充，让玻璃"属于这个主题"
② 半透明填充 fill 白色或白色叠加，决定通透度
① 背景模糊 blur   backdrop-filter: blur + saturate
   ──────────────── 以上整体携带三层投影（接触 / 中景 / 环境）
```

### 5.1 边缘折射（关键新增）

现有实现只有一条顶部亮线。真正的玻璃边缘应该呈现"上边缘最亮、左右次之、下边缘偏暗"的不对称，这正是光线穿过厚度时的表现。配方：

```scss
// 亮色主题
--glass-rim:
  inset 0 0 0 1px rgba(255, 255, 255, .20),   // 环形细边
  inset 0 1px 0 rgba(255, 255, 255, .92),     // 顶部亮线
  inset 0 -1px 0 rgba(24, 38, 30, .045),      // 底部厚度暗边
  inset 0 8px 14px -12px rgba(255, 255, 255, .75),  // 顶部内折射光晕
  inset 0 -10px 16px -14px rgba(24, 38, 30, .06);   // 底部内阴影

--glass-rim-strong:
  inset 0 0 0 1px rgba(255, 255, 255, .34),
  inset 0 1px 0 rgba(255, 255, 255, 1),
  inset 0 -1px 0 rgba(24, 38, 30, .06),
  inset 0 10px 18px -12px rgba(255, 255, 255, .85),
  inset 0 -12px 20px -16px rgba(24, 38, 30, .08);
```

```scss
// 暗色主题：靠"白色微粒"而非阴影表达厚度
--glass-rim:
  inset 0 0 0 1px rgba(255, 255, 255, .08),
  inset 0 1px 0 rgba(255, 255, 255, .14),
  inset 0 -1px 0 rgba(0, 0, 0, .40),
  inset 0 8px 16px -12px rgba(255, 255, 255, .10);
```

渐变描边是可选项，只给 `thick` 与 `overlay` 两档使用——大面板的直边在壁纸主题下会显得生硬：

```scss
.glass--edged::before {
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  background: linear-gradient(
    160deg,
    rgba(255, 255, 255, .90) 0%,
    rgba(255, 255, 255, .16) 34%,
    rgba(255, 255, 255, 0) 62%,
    rgba(255, 255, 255, .28) 100%
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  content: '';
}
```

### 5.2 染色

玻璃必须"被内容染色"，否则 13 套主题看起来都是同一块白色塑料。规则：

- 填充色 = `color-mix(in srgb, var(--accent) 8%, <fill>)`。8% 是上限；超过就会变成彩色玻璃，与"内容优先"冲突。12 套浅色 accent 主题 + `dark` 全部由这一条派生，不允许出现按主题写死的玻璃色。
- 只有两类元素允许更高浓度：**选中态**（accent 14–18%）与**危险操作**（`--danger` 10%）。它们的颜色承载状态语义，不是装饰。
- 壁纸主题下，染色从 `--accent` 改为从壁纸主色采样（实现上用 `--app-theme-image` 上方叠加的 `--glass-tint` 手工指定，取值写在主题定义里，不做运行时取色）。

### 5.3 投影

保留现有三层结构，但把"接触阴影"与"环境阴影"解耦，便于覆盖层单独加强：

| 层 | 亮色 | 暗色 | 作用 |
| --- | --- | --- | --- |
| 接触 | `0 1px 2px rgba(24,38,30,.05)` | `0 1px 2px rgba(0,0,0,.38)` | 贴合画布，避免"飘" |
| 中景 | `0 12px 26px -16px rgba(24,38,30,.34)` | `0 20px 40px -22px rgba(0,0,0,.68)` | 表达离地高度 |
| 环境 | `0 32px 60px -30px rgba(24,38,30,.28)` | `0 32px 70px -24px rgba(0,0,0,.8)` | 大面积柔光，覆盖层专用 |

一个约束：**投影方向统一为垂直向下，偏移不超过 2px。** 现有 `.ui-card.is-hoverable:hover` 用 `translateY(-2px)` 配合 `--glass-shadow-lift` 表示悬停，方向一致，保留。

## 6. 令牌

### 6.1 命名规则

```text
--glass-<角色>-<刻度>[-<属性>]
```

- 角色：`fill` / `rim` / `sheen` / `tint` / `shadow` / `scrim` / `ink`
- 刻度：`mist` / `thin` / `regular` / `thick` / `overlay`；无色阶的通用令牌省略刻度（如 `--glass-ease`）
- 只在 `body[data-theme]` 上定义亮色，`body[data-theme='dark']` 覆盖；**不新增按 accent 主题的规则**。这条已经在 `glass.scss` 的文件头写明，继续遵守。

### 6.2 令牌表

| 令牌 | 亮色 | 暗色 | 说明 |
| --- | --- | --- | --- |
| `--glass-blur-mist` | `0` | `0` | 不模糊 |
| `--glass-blur-thin` | `8px` | `8px` | |
| `--glass-blur-regular` | `14px` | `14px` | 原 `--glass-blur` |
| `--glass-blur-thick` | `22px` | `22px` | 原 `--glass-blur-chrome` |
| `--glass-blur-overlay` | `30px` | `30px` | 原 `--glass-blur-overlay` |
| `--glass-saturate` | `140%` | `140%` | overlay 档可局部提到 160% |
| `--glass-fill-mist` | `#fff 46%` | `rgba(255,255,255,.03)` | `color-mix` 写法 |
| `--glass-fill-thin` | `#fff 58%` | `rgba(255,255,255,.045)` | |
| `--glass-fill-regular` | `#fff 68%` | `rgba(255,255,255,.055)` | 原 `--glass-fill` |
| `--glass-fill-thick` | `#fff 78%` | `rgba(255,255,255,.07)` | 原 `--glass-fill-strong` |
| `--glass-fill-overlay` | `#fff 84%` | `rgba(255,255,255,.085)` | 新增 |
| `--glass-rim` | 见 5.1 | 见 5.1 | 替代 `--glass-bevel` + `--glass-inner` |
| `--glass-rim-strong` | 见 5.1 | 见 5.1 | 覆盖层与选中态 |
| `--glass-sheen` | 155° 白 52%→10%→0 | 150° 白 10%→3%→0 | 保留 |
| `--glass-tint` | `color-mix(in srgb, var(--accent) 8%, transparent)` | 同 | 与 fill 混合，不单独成层 |
| `--glass-edge` | `#fff 32% + --accent-border` | `rgba(255,255,255,.11)` | 单线描边（非玻璃面也用） |
| `--glass-shadow` / `-lift` / `-overlay` | 见 5.3 | 见 5.3 | 保留 |
| `--glass-scrim` | `rgba(13,26,20,.10)` | `rgba(0,0,0,.14)` | 每个玻璃面自带的压暗层（8–14%） |
| `--glass-veil` | `rgba(13,26,20,.42)` | `rgba(0,0,0,.55)` | 对话框 / 抽屉背后的大面积压暗 |
| `--glass-ink` | `color-mix(in srgb, #0b0d09 88%, var(--accent))` | `#eef3ef` | 玻璃上的主文字 |
| `--glass-ink-2` | 同色 68% | `#b7c2bb` | 次级文字 |
| `--glass-radius-sm` | `10px` | 同 | 工具按钮、消息条、小控件 |
| `--glass-radius-md` | `14px` | 同 | 输入框、搜索框、菜单容器 |
| `--glass-radius-lg` | `16px` | 同 | 内容卡片、快捷磁贴 |
| `--glass-radius-xl` | `20px` | 同 | 面板、抽屉内侧 |
| `--glass-radius-2xl` | `24px` | 同 | 对话框、抽屉、新建标签页工作区 |
| `--glass-dur-in` | `200ms` | 同 | 出现 |
| `--glass-dur-out` | `120ms` | 同 | 消失、按下 |
| `--glass-ease` | `cubic-bezier(.22, 1, .36, 1)` | 同 | 复用 `--arcadia-ease-focus` 的曲线 |

### 6.3 兼容策略

旧令牌（`--glass-fill`、`--glass-fill-strong`、`--glass-bevel`、`--glass-blur` 等）保留一个版本周期，用别名指向新刻度，避免一次性改动 `compact.scss` 里的全部引用：

```scss
body[data-theme] {
  --glass-blur: var(--glass-blur-regular);
  --glass-blur-chrome: var(--glass-blur-thick);
  --glass-fill: var(--glass-fill-regular);
  --glass-fill-strong: var(--glass-fill-thick);
  --glass-bevel: var(--glass-rim);
}
```

## 7. 形状与同心

Apple 的同心性（concentricity）规则：内层圆角必须由外层圆角**减去内边距**得出，而不是各自拍一个值。这决定了控件嵌套时看起来是"嵌进去"还是"贴上去"。

```text
r_inner = r_outer − padding，且不小于 4px
```

| 外层 | 外层半径 | 内边距 | 内层半径 |
| --- | --- | --- | --- |
| 对话框 / 抽屉 | 24px | 12px | 12px |
| 面板 | 20px | 8px | 12px |
| 内容卡片 | 16px | 8px | 8px |
| 工具条 | 14px | 6px | 8px |
| 标签胶囊 | 999px | 4px | 999px |

尺寸与间距沿用现有 4pt 网格：

- 控件高度：`28 / 32 / 36 / 44px`（对应 `sm / md / lg / xl`）。工具条内按钮默认 32px。
- 玻璃面之间的最小间距：`8px`。小于 8px 时两块玻璃的边缘光会互相污染，看起来像一块脏玻璃。
- 玻璃面到窗口边缘的距离：`≥ 12px`；贴边时改为直角并去掉该侧的投影（标题栏、侧栏属于此类）。
- 胶囊半径只用于标签、状态徽标、开关；面板一律用 10–24px 的圆角矩形。

## 8. 页面区域：本产品的硬约束

这是本文档与 Apple 指南差异最大、也最容易出错的一节。

Arcadia 的网页由**原生子 WebView** 承载：前端把 `.web-surface` 的矩形传给 `browser_set_bounds`，`WryPageEngine` 在该矩形上放置一个系统 WebView2 / WKWebView。它是**独立的原生图层**，不是应用 DOM 的一部分。

由此产生的物理事实：

1. 应用 WebView 里的 `backdrop-filter` **无法采样子 WebView 的像素**。任何绘制在页面区域之上的玻璃，模糊到的只是应用自身的透明背景，视觉上退化为"半透明色块 + 白边"，比实心填充更脏。
2. 页面区域内的浮层（右键菜单、查找条、悬浮面板、页面内提示）因此**不能依赖模糊**。它们必须使用 `--glass-fill-overlay` 级别的不透明度（≥ 92%）作为实心底，边缘光与投影保留，模糊关闭。
3. 页面区域与 chrome 的边界必须是**硬边界**：要么页面让出这条空间，要么玻璃面完全不越过它。跨边界的半透明（例如悬浮工具条压在网页上）在 WebView2 上会出现"玻璃只模糊自己"的破绽。

落地规则：

| 场景 | 做法 |
| --- | --- |
| 标题栏 / 工具条 / 侧栏 | 位于页面区域之外，正常使用 `thick` 玻璃 |
| AI 面板、笔记面板 | 占据独立的布局列，不覆盖页面；使用 `thick` |
| 右键菜单（由独立宿主渲染） | 不透明底 + 边缘光；不使用 `backdrop-filter` |
| 页面内查找条 | 同上；或改为在工具条内展开，避免进入页面区域 |
| 未来 CEF 单 surface | 页面与应用共享同一合成表面后，才允许 content-aware 玻璃；届时本节的限制改为"仍需满足对比度与性能预算" |

> 实施要求：改动任何位于 `.web-surface--native` 之上的浮层时，必须在 Windows（WebView2）与 macOS（WKWebView）各截图一次，确认没有"糊了一层灰"的观感。第 16 节的验收清单包含此项。

## 9. 色彩与文字

玻璃上的文字不是"更浅的黑色"，而是**被内容染色后的前景**：

- 主文字 `--glass-ink`，次级 `--glass-ink-2`，禁用 `#000` 与 `#fff` 纯值。
- 每个玻璃面自带一层 `--glass-scrim`（8–14% 的背景色叠加），目的是把最坏情况下的背景压到可读区间。scrim 是玻璃配方的一部分，不是额外的覆盖层。
- 对比度门槛按 WCAG 2.2 AA：正文 4.5:1，≥ 24px 或 ≥ 18.66px 粗体 3:1，非文本 UI 边界 3:1。
- 测试基准：用**最亮的壁纸**与**最花的壁纸**各测一次，而不是用纯色底测。壁纸主题（`data-wallpaper='on'`）是玻璃对比度的最坏情况。
- 状态色（成功/警告/危险）不得只靠玻璃染色表达，必须有图标或文字；色盲用户无法从 8% 的染色里读出语义。

## 10. 动效

Apple 的动效与材质是一体的：玻璃"弯曲、充能、抬起"。Web 上我们只保留能稳定跑满 60fps 的部分。

| 场景 | 时长 | 缓动 | 变化 |
| --- | --- | --- | --- |
| 悬停提亮 | 120ms | `ease-out` | `border-color`、`box-shadow`、`background-color` |
| 按下 | 90ms | `ease-out` | `transform: scale(.985)`；rim 提亮一档 |
| 抬起（hover 位移） | 180ms | `--glass-ease` | `translateY(-2px)` + `--glass-shadow-lift` |
| 出现（materialize） | 200ms | `--glass-ease` | `opacity 0→1`，`translateY(4px)→0`，`scale(.98)→1` |
| 消失 | 120ms | `ease-in` | 仅 `opacity → 0`；不位移，不动画 blur |
| 菜单展开（morph 近似） | 180ms | `--glass-ease` | `transform-origin` 指向触发点；`scale(.96)→1` |

两条硬规则：

1. **不要直接动画 `backdrop-filter`。** 半径变化会触发整层重绘。需要"从无到有"的模糊感时，把模糊放在 `::before` 上，动画它的 `opacity`（0→1），而不是动画 `blur()` 的数值。
2. **减少动态。** `prefers-reduced-motion: reduce` 下，上述位移动画全部取消，只保留 120ms 的 opacity 过渡；`materialize` 直接以终态出现。

## 11. 组件映射

| 组件 | 选择器 | 刻度 | 半径 | 备注 |
| --- | --- | --- | --- | --- |
| 标题栏 | `.app-topbar` | `thick` | 0 | 贴边，仅底部投影与内亮线 |
| 侧栏 | `.app-sider` | `thick` | 0 | 贴边；壁纸主题下改为半透明 |
| 标签条 | `.browser-tabs` | `thin` | 10px | 容器透明，标签本身是 `mist`/`thin` 胶囊 |
| 浏览器工具条 | `.browser-toolbar` | `thick` | 0 | 与标题栏共用一条模糊层，不叠加 |
| 地址栏 | `.browser-toolbar > form .ant-input-affix-wrapper` | `thin` | 999px | 聚焦时 rim 提亮，不提高 blur |
| 工具按钮 | `.browser-toolbar .ui-button` | `mist` | 10px | 悬停升到 `thin` 的填充值，不加模糊 |
| 内容卡片 | `.ui-card`、`.document-card`、`.result-card` | `regular`（无模糊） | 16px | **移除 `backdrop-filter`**，填充与 rim 保留 |
| 搜索框 | `.library-search` | `thin` | 14px | |
| 面板 | `.ai-panel`、`.notes-panel`、`.context-card` | `thick` | 20px | 独立布局列，不覆盖页面 |
| 新建标签页工作区 | `.new-tab__workspace` | `thick` | 24px | 壁纸主题下由 `compact.scss` 覆盖，需并入令牌 |
| 快捷站点磁贴 | `.quick-site` | `thin` | 16px | |
| 下拉 / 菜单 | `.ui-dropdown`、`.ui-popover` | `overlay` | 14px | 内含子菜单时改为实心 |
| 对话框 | `.ui-dialog`、`.ui-confirm` | `overlay` | 24px | 背后 `--glass-veil` 压暗 |
| 抽屉 | `.ui-drawer` | `overlay` | 24px（贴边侧为 0） | |
| 消息条 | `.ui-message` | `overlay` | 10px | 最多同时 3 条 |
| 对话框遮罩 | `.ui-dialog__backdrop` | — | — | 现有 `blur(6px)`：改为只保留 scrim 压暗，遮罩不再叠加模糊 |

## 12. 性能预算

`backdrop-filter` 的成本与"模糊面积 × 半径 × 层数"成正比，且每层都要在合成阶段重新采样背景。WebView2 上尤其明显。

| 指标 | 上限 | 测量方式 |
| --- | --- | --- |
| 单屏可见模糊层数 | 4（L2 ≤ 3，L3 ≤ 1） | DevTools Layers 面板 |
| 单个模糊半径 | 30px | 令牌约束 |
| 模糊总面积 | ≤ 40% 视口 | 目测 + Layers |
| 滚动容器内模糊层 | ≤ 1，且滚动时不得变化 | 滚动 3 秒录帧 |
| 动画中的模糊层 | 只允许 opacity/transform 变化 | Performance 面板 |
| 滚动帧率 | ≥ 55fps（1080p，集成显卡） | Chrome Tracing |

补充规则：

- 虚拟列表的每一行**禁止**使用 `backdrop-filter`；列表容器最多 `thin` 一档。
- `background-attachment: fixed` 的光晕在 WebView2 上会随窗口缩放整层重绘；窗口 resize 期间临时切回 `scroll`（用 `:root.is-resizing` 控制）。
- 避免给大面板常驻 `will-change: backdrop-filter`：它会常驻一层合成层显存。
- 大面积玻璃（抽屉、对话框）出现时，其余 L2 模糊层应临时降级为 `mist`（不加模糊），保证总预算。

## 13. 降级与关闭开关

四层降级，优先级从高到低：

1. **不支持 `backdrop-filter`**：`@supports not (...)` 下改为 90% 不透明实心底 + 保留 sheen 与 rim。现有实现已覆盖，需扩展到新增的 `mist` 档组件。
2. **`prefers-reduced-transparency: reduce`**：关闭全部模糊与 sheen，填充升到 92%，rim 保留（它是边界，不是装饰）。现有实现已覆盖，需补 `.ui-message`、`.browser-toolbar`、`.new-tab__workspace`。
3. **`prefers-contrast: more`**：rim 提升到 `--glass-rim-strong` 的 1.5 倍不透明度，`--glass-ink` 改为纯前景色，scrim 提高到 18%。当前未实现，需要新增。
4. **`forced-colors: active`（Windows 高对比度）**：关闭所有玻璃，`background: Canvas`、`border: 1px solid CanvasText`、前景 `CanvasText`。当前未实现；这是 Windows 用户最常见的可访问性设置，必须补。

另外保留诊断开关 `data-glass='off'`（已存在），用于截图对比与问题定位；它必须与上述四种降级产生一致的实心形态。

## 14. 反例清单

以下写法在本仓库中视为缺陷，代码评审直接打回：

- 在一个已经带 `backdrop-filter` 的容器里，再给子元素加 `backdrop-filter`。
- 给内容层（卡片、表格行、搜索结果项）加模糊，只为了让"卡片看起来更高级"。
- 用 `rgba(255,255,255,.1)` 这类硬编码值绕过令牌（`compact.scss` 的壁纸段目前有 21 处 `rgba()` 与 17 处 `!important`，见第 15 节）。
- 用 `!important` 覆盖玻璃属性；壁纸段现有的 `!important` 是历史包袱，新增规则不得继续沿用。
- 在页面区域（`.web-surface--native`）之上使用模糊。
- 给玻璃面加 2px 以上的实色描边来"提高辨识度"；正确做法是加 `--glass-rim-strong`。
- 用玻璃承载唯一的状态信息（例如只靠背景染色表示"已选中"）。

## 15. 改造清单

按依赖顺序执行，每步可独立评审：

1. **令牌收敛。** 在 `glass.scss` 中把第 6.2 节的刻度写全，旧令牌改为别名；删除 `--glass-inner`。
2. **壁纸段归一。** 把 `compact.scss` 第 1594–1720 行里硬编码的 `rgba(255,255,255,.52)`、`blur(30px)` 等（21 处 `rgba()`、17 处 `!important`）替换为刻度令牌，`!important` 只在必须覆盖既有 `background` 简写时保留，并逐条注释原因。
3. **内容层去模糊。** 移除 `.ui-card`、`.document-card`、`.result-card`、`.library-metric` 上的 `backdrop-filter`，保留填充、sheen、rim（视觉差异需截图对比确认可接受）。
4. **边缘折射。** 加 `--glass-rim` 与 `.glass--edged` 的渐变描边，仅用于 `thick` / `overlay`。
5. **降级补齐。** 新增 `prefers-contrast: more` 与 `forced-colors: active` 两段。
6. **样式契约测试。** 参照 `layoutContract.test.ts` 增加 `glassContract.test.ts`：断言 SCSS 中 `backdrop-filter` 出现次数不超过阈值、不存在 `blur(` 大于 30px 的字面量、内容层选择器不含 `backdrop-filter`、`@media (forced-colors: active)` 存在。
7. **跨端截图。** Windows + macOS，明/暗 × 壁纸开/关 × 2 个 accent 主题，共 16 张，归档到 `docs/`。

## 16. 验收清单

| # | 检查项 | 通过标准 |
| --- | --- | --- |
| 1 | 分层 | 任一屏没有两块玻璃在像素上重叠；内容层无模糊 |
| 2 | 刻度 | 每个玻璃组件的 blur/fill 都能对应到第 4 节的某一档，无自由数值 |
| 3 | 边缘 | 面板在纯色与壁纸背景上都能看出"上亮下暗"的边 |
| 4 | 对比度 | 最亮与最花壁纸下，正文 ≥ 4.5:1，非文本边界 ≥ 3:1 |
| 5 | 降级 | 四种降级模式各截图一次，布局无位移、无信息丢失 |
| 6 | 性能 | 1080p 滚动 ≥ 55fps；模糊层数 ≤ 4；无动画 blur |
| 7 | 页面边界 | 页面区域内浮层为不透明底，无"灰雾"观感 |
| 8 | 主题 | 13 套主题（12 个浅色 accent + `dark`）零专属规则，全部由令牌派生 |
| 9 | 焦点 | 键盘 Tab 到任一玻璃上的控件，焦点环可见且不被裁切 |
| 10 | 图标 | 每个仅图标按钮有 `aria-label` |

## 17. 参考

- Apple, [Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)（技术总览）
- Apple, [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)（控件、导航、菜单、窗口、搜索的采用指南）
- Apple, [Human Interface Guidelines: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)（"不要在内容层使用 Liquid Glass"、"克制使用"、"clear 玻璃仅用于视觉丰富背景"）
- Apple, WWDC25 [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219)（lensing、流体性、自适应与原则）
- 本仓库：[glass.scss](../desktop/src/styles/glass.scss)、[compact.scss](../desktop/src/styles/compact.scss)、[layoutContract.test.ts](../desktop/src/styles/layoutContract.test.ts)、[PageEngine](page-engine.md)
