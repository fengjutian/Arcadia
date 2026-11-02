import { Card, Select, Typography } from '../../components/ui'
import { changeLocale, getLocale, LOCALE_LABELS, SUPPORTED_LOCALES, t, type Locale } from '../../i18n'
import { rememberViewForReload } from '../../app/returnView'

/**
 * Language picker for Settings → General.
 *
 * Switching reloads the window: module-level constants in the app (shortcut
 * tables, theme presets, search engines, ...) read `t()` once at import time, so
 * a reload is the only way to guarantee every string, tooltip and window title
 * picks up the new catalog without sprinkling locale subscriptions everywhere.
 */
export function LanguageSettingsPanel() {
  const current = getLocale()
  return <Card title={t('语言')} className="settings-card language-settings-card">
    <div className="browser-setting-row">
      <div>
        <Typography.Text strong>{t('界面语言')}</Typography.Text>
        <Typography.Text type="secondary">{t('选择 Arcadia 的显示语言。更改后界面会重新加载，未保存的输入会丢失。')}</Typography.Text>
      </div>
      <Select<Locale>
        value={current}
        ariaLabel={t('界面语言')}
        options={SUPPORTED_LOCALES.map(value => ({ value, label: LOCALE_LABELS[value] }))}
        onChange={next => {
          if (next === current) return
          rememberViewForReload('settings')
          changeLocale(next as Locale)
        }}
        style={{ width: 180 }}
      />
    </div>
  </Card>
}
