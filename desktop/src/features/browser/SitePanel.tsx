import { t } from '../../i18n'
import { Button, Drawer, Select, Space, Switch, Typography } from '../../components/ui'
import { SITE_PERMISSION_KINDS, type SitePermissionKind, type SitePermissionRule, type SitePermissionValue } from './sitePermissions'

const PERMISSION_LABELS: Record<SitePermissionKind, string> = {
  camera: t('摄像头'),
  microphone: t('麦克风'),
  location: t('定位'),
  notifications: t('通知'),
  clipboard: t('剪贴板'),
}

const PERMISSION_VALUES: SitePermissionValue[] = ['ask', 'allow', 'deny']

/**
 * One panel for every site-level setting: permissions, blocking/filtering,
 * sleep exception, Reader preference, save destination and data clearing.
 */
export function SitePanel({
  open,
  onClose,
  url,
  adBlockEnabled,
  blockedAds,
  blockedBy,
  permissionRule,
  onChangePermission,
  sleepExcluded,
  onToggleSleep,
  autoReader,
  onToggleReader,
  readerStyle,
  onResetReaderStyle,
  routeCollectionName,
  onClearRoute,
  onClearSiteData,
  onUnblock,
}: {
  open: boolean
  onClose: () => void
  url: string
  adBlockEnabled: boolean
  blockedAds: number
  blockedBy: string | null
  permissionRule: SitePermissionRule | null
  onChangePermission: (kind: SitePermissionKind, value: SitePermissionValue) => void
  sleepExcluded: boolean
  onToggleSleep: () => void
  autoReader: boolean
  onToggleReader: () => void
  readerStyle: { fontSize?: number; width?: number; theme?: string } | null
  onResetReaderStyle: () => void
  routeCollectionName: string | null
  onClearRoute: () => void
  onClearSiteData: () => void
  onUnblock: () => void
}) {
  const host = (() => {
    try { return new URL(url).hostname.replace(/^www\./i, '') } catch { return '' }
  })()

  return <Drawer open={open} onClose={onClose} title={t("站点面板")} width={420}>
    <div className="site-panel">
      <section>
        <Typography.Title level={5}>{host || t("当前页面")}</Typography.Title>
        <Typography.Text type="secondary" className="site-panel__url">{url}</Typography.Text>
      </section>

      <section>
        <h4>{t("屏蔽与过滤")}</h4>
        <div className="site-panel__row">
          <span>{blockedBy ? t("已被封杀（规则：{value0}）", { value0: blockedBy }) : t("未被封杀")}</span>
          {blockedBy && <Button size="small" onClick={onUnblock}>{t("解除封杀")}</Button>}
        </div>
        <div className="site-panel__row">
          <span>{adBlockEnabled ? t("广告过滤已开启，本标签已过滤 {value0} 项", { value0: blockedAds }) : t("广告过滤已关闭")}</span>
        </div>
      </section>

      <section>
        <h4>{t("站点权限")}</h4>
        {SITE_PERMISSION_KINDS.map(kind => (
          <div className="site-panel__row" key={kind}>
            <span>{PERMISSION_LABELS[kind]}</span>
            <Select<SitePermissionValue>
              size="small"
              value={permissionRule?.[kind] ?? 'ask'}
              options={PERMISSION_VALUES.map(value => ({ value, label: value === 'allow' ? t("允许") : value === 'deny' ? t("拒绝") : t("询问") }))}
              onChange={value => onChangePermission(kind, value)}
            />
          </div>
        ))}
      </section>

      <section>
        <h4>{t("阅读与休眠")}</h4>
        <label className="site-panel__row">
          <span>{t("此站点不再自动休眠")}</span>
          <Switch checked={sleepExcluded} onChange={onToggleSleep}/>
        </label>
        <label className="site-panel__row">
          <span>{t("此站点自动进入阅读模式")}</span>
          <Switch checked={autoReader} onChange={onToggleReader}/>
        </label>
        <div className="site-panel__row">
          <span>{readerStyle ? t("阅读样式：字号 {value0} · 宽度 {value1}", { value0: readerStyle.fontSize ?? 18, value1: readerStyle.width ?? 760 }) : t("阅读样式：使用全局默认")}</span>
          {readerStyle && <Button size="small" type="text" onClick={onResetReaderStyle}>{t("重置")}</Button>}
        </div>
      </section>

      <section>
        <h4>{t("保存去向")}</h4>
        <div className="site-panel__row">
          <span>{routeCollectionName ? t("保存时自动加入集合：{value0}", { value0: routeCollectionName }) : t("保存时不自动加入集合")}</span>
          {routeCollectionName && <Button size="small" type="text" onClick={onClearRoute}>{t("清除")}</Button>}
        </div>
      </section>

      <Space>
        <Button danger onClick={onClearSiteData}>{t("清除共享浏览数据")}</Button>
      </Space>
    </div>
  </Drawer>
}
