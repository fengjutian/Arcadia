import { t } from '../../i18n'
import type { SuggestionItem } from './suggestionProvider'

const SOURCE_LABELS: Record<SuggestionItem['source'], string> = {
  'open-tab':t("已打开"),
  history:t("历史"),
  bookmark:t("书签"),
  search:t("搜索"),
}

export function renderSuggestion(item: SuggestionItem) {
  const sourceLabel = SOURCE_LABELS[item.source]
  return(
    <div className="address-suggestion">
      <b>{item.title || item.url}</b>
      <small>{item.url}</small>
      <span className={`address-suggestion__source address-suggestion__source--${item.source}`}>{sourceLabel}</span>
    </div>)

}