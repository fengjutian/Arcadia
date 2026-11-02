import { t } from '../../i18n'
/**
 * Pure builders for the browser's right-click context menu. Each region
 * (page / selection / link / image / input) returns its own item list with
 * `enabled` flags reflecting URL safety and capability checks. The
 * component layer maps these into the local menu adapter so that the
 * state machine stays testable without rendering React.
 */
import type { ContextMenuRequest } from '../../services/nativeBrowser'
import { isAllowedExternalUrl } from '../../services/nativeBrowser'
import { classifyShellOpenUrl } from './externalSchemes'

export type ContextMenuRegion = ContextMenuRequest['kind']

export type ContextMenuAction =
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'print'
  | 'view-source'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'select-all'
  | 'search-selection'
  | 'ask-ai'
  | 'translate-selection'
  | 'screenshot-selection'
  | 'add-to-notes'
  | 'open-link-current'
  | 'open-link-new'
  | 'open-link-external'
  | 'copy-link'
  | 'open-image-new'
  | 'copy-image'
  | 'save-image'

export interface ContextMenuItem {
  action: ContextMenuAction
  label: string
  shortcut?: string
  danger?: boolean
  divider?: false
  enabled: boolean
  /** Optional inline tooltip when disabled. */
  disabledReason?: string
}

export interface ContextMenuSection {
  items: ContextMenuItem[]
}

export interface ContextMenuBuild {
  sections: ContextMenuSection[]
  request: ContextMenuRequest
}

export interface ContextMenuCapabilities {
  canGoBack: boolean
  canGoForward: boolean
  canPrint: boolean
  canAskAi: boolean
}

const ALWAYS_ENABLED = true

export function buildContextMenu(
  request: ContextMenuRequest,
  capabilities: ContextMenuCapabilities,
): ContextMenuBuild {
  switch (request.kind) {
    case 'link':
      return { request, sections: buildLinkSections(request, capabilities) }
    case 'image':
      return { request, sections: buildImageSections(request, capabilities) }
    case 'selection':
      return { request, sections: buildSelectionSections(request, capabilities) }
    case 'input':
      return { request, sections: buildInputSections(request, capabilities) }
    case 'page':
    default:
      return { request, sections: buildPageSections(request, capabilities) }
  }
}

function buildPageSections(request: ContextMenuRequest, cap: ContextMenuCapabilities): ContextMenuSection[] {
  void request
  return [
    {
      items: [
        { action: 'back', label:t("\u540E\u9000"),shortcut:'Alt+←',enabled:cap.canGoBack},
        { action: 'forward', label:t("\u524D\u8FDB"),shortcut:'Alt+→',enabled:cap.canGoForward},
        { action: 'reload', label:t("\u91CD\u65B0\u52A0\u8F7D"),shortcut:'F5',enabled:ALWAYS_ENABLED},
        { action: 'stop', label:t("\u505C\u6B62\u52A0\u8F7D"),shortcut:'Esc',enabled:ALWAYS_ENABLED},
      ],
    },
    {
      items: [
        { action: 'print', label:t("\u6253\u5370"),shortcut:'Ctrl+P',enabled:cap.canPrint},
        { action: 'view-source', label:t("\u67E5\u770B\u9875\u9762\u4FE1\u606F"),enabled:ALWAYS_ENABLED},
      ],
    },
  ]
}

function buildSelectionSections(request: ContextMenuRequest, cap: ContextMenuCapabilities): ContextMenuSection[] {
  const hasSelection = !!request.selectionText?.trim()
  return [
    {
      items: [
        { action: 'copy', label:t("\u590D\u5236"),shortcut:'Ctrl+C',enabled:ALWAYS_ENABLED},
        { action: 'search-selection', label:t("\u7528\u641C\u7D22\u5F15\u64CE\u641C\u7D22\u6240\u9009\u5185\u5BB9"),enabled:ALWAYS_ENABLED},
        { action: 'add-to-notes', label:t("\u52A0\u5165\u7B14\u8BB0"),enabled:hasSelection,disabledReason:hasSelection?undefined:t("\u8BF7\u5148\u9009\u4E2D\u6587\u672C")},
        { action: 'ask-ai', label:t("\u5411 AI \u63D0\u95EE"),enabled:cap.canAskAi,disabledReason:cap.canAskAi?undefined:t("AI \u529F\u80FD\u5C1A\u672A\u914D\u7F6E")},
        { action: 'translate-selection', label:t("\u7FFB\u8BD1\u9009\u4E2D\u5185\u5BB9"),enabled:cap.canAskAi&&hasSelection,disabledReason:cap.canAskAi?undefined:t("AI \u529F\u80FD\u5C1A\u672A\u914D\u7F6E")},
        { action: 'screenshot-selection', label:t("\u622A\u53D6\u9009\u4E2D\u533A\u57DF"),enabled:!!request.selectionRect},
      ],
    },
  ]
}

function buildLinkSections(request: ContextMenuRequest, cap: ContextMenuCapabilities): ContextMenuSection[] {
  const url = request.linkUrl ?? ''
  const allowed = isAllowedExternalUrl(url)
  const shell = classifyShellOpenUrl(url)
  return [
    {
      items: [
        { action: 'open-link-current', label:t("\u5728\u5F53\u524D\u6807\u7B7E\u6253\u5F00"),enabled:allowed,disabledReason:allowed?undefined:t("\u94FE\u63A5\u534F\u8BAE\u4E0D\u5B89\u5168")},
        { action: 'open-link-new', label:t("\u5728\u65B0\u6807\u7B7E\u6253\u5F00"),enabled:allowed,disabledReason:allowed?undefined:t("\u94FE\u63A5\u534F\u8BAE\u4E0D\u5B89\u5168")},
        { action: 'open-link-external', label:t("\u5728\u7CFB\u7EDF\u5E94\u7528\u4E2D\u6253\u5F00"),enabled:shell.shellOpenable,disabledReason:shell.shellOpenable?undefined:t("\u94FE\u63A5\u534F\u8BAE\u4E0D\u652F\u6301")},
        { action: 'copy-link', label:t("\u590D\u5236\u94FE\u63A5\u5730\u5740"),enabled:ALWAYS_ENABLED},
      ],
    },
    {
      items: [
        { action: 'print', label:t("\u6253\u5370"),shortcut:'Ctrl+P',enabled:cap.canPrint},
      ],
    },
  ]
}

function buildImageSections(request: ContextMenuRequest, cap: ContextMenuCapabilities): ContextMenuSection[] {
  const url = request.imageUrl ?? ''
  const allowed = isAllowedExternalUrl(url)
  return [
    {
      items: [
        { action: 'open-image-new', label:t("\u5728\u65B0\u6807\u7B7E\u6253\u5F00\u56FE\u7247"),enabled:allowed,disabledReason:allowed?undefined:t("\u56FE\u7247\u5730\u5740\u534F\u8BAE\u4E0D\u5B89\u5168")},
        { action: 'copy-image', label:t("\u590D\u5236\u56FE\u7247\u5730\u5740"),enabled:ALWAYS_ENABLED},
        { action: 'save-image', label:t("\u4FDD\u5B58\u56FE\u7247\u5230\u4E0B\u8F7D\u4E2D\u5FC3"),enabled:allowed,disabledReason:allowed?undefined:t("\u56FE\u7247\u5730\u5740\u534F\u8BAE\u4E0D\u5B89\u5168")},
      ],
    },
  ]
}

function buildInputSections(_request: ContextMenuRequest, _cap: ContextMenuCapabilities): ContextMenuSection[] {
  void _request; void _cap
  return [
    {
      items: [
        { action: 'cut', label:t("\u526A\u5207"),shortcut:'Ctrl+X',enabled:ALWAYS_ENABLED},
        { action: 'copy', label:t("\u590D\u5236"),shortcut:'Ctrl+C',enabled:ALWAYS_ENABLED},
        { action: 'paste', label:t("\u7C98\u8D34"),shortcut:'Ctrl+V',enabled:ALWAYS_ENABLED},
        { action: 'select-all', label:t("\u5168\u9009"),shortcut:'Ctrl+A',enabled:ALWAYS_ENABLED},
      ],
    },
  ]
}