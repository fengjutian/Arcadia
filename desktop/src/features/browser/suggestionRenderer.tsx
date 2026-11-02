import { t } from '../../i18n'
import type { SuggestionItem } from './suggestionProvider'

const SOURCE_LABELS: Record<SuggestionItem['source'], string> = {
  'open-tab':t("\u5DF2\u6253\u5F00"),
  history:t("\u5386\u53F2"),
  bookmark:t("\u4E66\u7B7E"),
  search:t("\u641C\u7D22"),
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