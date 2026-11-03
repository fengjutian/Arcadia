import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { Alert, Button, Card, Space, Tag, Typography, message } from '../../components/ui'
import { CheckCircleOutlined, ExportOutlined, GlobalOutlined, ReloadOutlined } from '../../components/ui/icons'
import {
  getDefaultBrowserStatus,
  openDefaultAppsSettings,
  registerAsDefaultBrowser,
  type DefaultBrowserStatus,
} from '../../services/defaultBrowser'

/**
 * One-line description of the current default browser. Kept pure so the three
 * states (default / another browser / unreadable) are testable without the
 * desktop runtime.
 */
export function defaultBrowserLabel(status: DefaultBrowserStatus | null): string {
  if (!status) return t("正在读取默认浏览器…")
  if (!status.platformSupported) return t("当前系统不支持在这里设置默认浏览器")
  if (status.isDefault) return t("Arcadia 已是默认浏览器")
  if (status.currentAppName) return t("当前默认浏览器：{value0}", { value0: status.currentAppName })
  if (status.currentProgId) return t("当前默认浏览器：{value0}", { value0: status.currentProgId })
  return t("尚未检测到系统默认浏览器")
}

/**
 * Default-browser settings. Windows does not allow silent takeover, so this
 * panel registers the app as a browser candidate, opens the system page, and
 * reports the real state instead of claiming success.
 */
export function DefaultBrowserSettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [status, setStatus] = useState<DefaultBrowserStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState('')

  async function refresh() {
    setRefreshing(true)
    try {
      setStatus(await getDefaultBrowserStatus())
      setError('')
    } catch (caught) {
      setError(t("读取默认浏览器状态失败：{value0}", { value0: String(caught) }))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void refresh()
    // The system Settings app runs in its own window; when the user comes back
    // the status may have changed, so re-read it instead of trusting the cache.
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function makeDefault() {
    setRegistering(true)
    setError('')
    try {
      setStatus(await registerAsDefaultBrowser())
    } catch (caught) {
      setError(t("设置默认浏览器失败：{value0}", { value0: String(caught) }))
      setRegistering(false)
      return
    }
    setRegistering(false)
    // Registration and the system page are separate steps: failing to open
    // Settings must not be reported as a failed registration.
    await openSettingsPage()
    messageApi.info(t("已打开 Windows 默认应用设置，请在「Web 浏览器」中选择 Arcadia。"))
  }

  async function openSettingsPage() {
    setError('')
    try {
      await openDefaultAppsSettings()
    } catch (caught) {
      setError(t("无法打开 Windows 默认应用设置：{value0}", { value0: String(caught) }))
    }
  }

  const registration = status?.registered ? t("已注册为系统浏览器") : t("尚未注册为系统浏览器")
  const supported = status?.platformSupported === true

  return <>{contextHolder}<Card title={<Space><GlobalOutlined/>{t("默认浏览器")}</Space>} className="settings-card default-browser-settings">
    <div className={`default-browser-status${status?.isDefault ? ' is-default' : ''}`}>
      <span className="default-browser-status__badge">{status?.isDefault ? <CheckCircleOutlined/> : <GlobalOutlined/>}</span>
      <div className="default-browser-status__copy">
        <Typography.Title level={4}>{defaultBrowserLabel(status)}</Typography.Title>
        <Typography.Paragraph type="secondary">{t("从其他应用或系统打开的网页链接会交给默认浏览器。")}</Typography.Paragraph>
      </div>
      <Tag color={status?.isDefault ? 'green' : 'default'}>{status?.isDefault ? t("已设为默认") : t("未设为默认")}</Tag>
    </div>
    <div className="advanced-setting-row">
      <div>
        <Typography.Text strong>{t("将 Arcadia 设为默认浏览器")}</Typography.Text>
        <Typography.Paragraph type="secondary">{t("Windows 要求由你本人确认默认应用：点击后 Arcadia 会注册为可选浏览器，并打开系统默认应用设置。")}</Typography.Paragraph>
      </div>
      <Space wrap>
        <Button type="primary" loading={registering} disabled={!supported || status?.isDefault} onClick={() => void makeDefault()}>{t("设为默认浏览器")}</Button>
        <Button icon={<ReloadOutlined/>} loading={refreshing} onClick={() => void refresh()}>{t("刷新状态")}</Button>
      </Space>
    </div>
    <div className="default-browser-footer">
      <Typography.Text type="secondary">{t("注册状态：{value0}", { value0: registration })}</Typography.Text>
      {supported && <Button type="link" icon={<ExportOutlined/>} onClick={() => void openSettingsPage()}>{t("仅打开 Windows 默认应用设置")}</Button>}
    </div>
    {supported && <Alert type="info" showIcon message={t("在系统设置中完成最后一步")} description={t("在「默认应用」中搜索 Arcadia，把「Web 浏览器」设为 Arcadia；回到本页后状态会自动刷新。")}/>}
    {error && <Typography.Text type="danger">{error}</Typography.Text>}
  </Card></>
}
