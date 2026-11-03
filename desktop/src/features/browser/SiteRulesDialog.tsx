import { t } from '@arcadia/i18n'
import { Button, Modal, Select, Switch, Tag, Typography } from '@arcadia/ui'
import { removeSiteRoute, setSiteRouteEnabled, type SiteRoute } from './siteRoutes'

/**
 * Manage every site rule in one place: pause without deleting, remove, and see
 * which collection a host saves into.
 */
export function SiteRulesDialog({
  open,
  onClose,
  routes,
  collectionNames,
  spaces = [],
  onChange,
}: {
  open: boolean
  onClose: () => void
  routes: SiteRoute[]
  collectionNames: ReadonlyMap<string, string>
  spaces?: ReadonlyArray<{ id: string; name: string }>
  onChange: (routes: SiteRoute[]) => void
}) {
  return <Modal open={open} title={t("站点规则")} onCancel={onClose} footer={<Button onClick={onClose}>{t("关闭")}</Button>}>
    {routes.length === 0
      ? <Typography.Text type="secondary">{t("还没有站点规则。在浏览器菜单里把当前站点保存到集合，就会生成一条。")}</Typography.Text>
      : <div className="site-rules">
          {[...routes].sort((left, right) => left.host.localeCompare(right.host)).map(route => (
            <div className="site-rules__row" key={route.host}>
              <div className="site-rules__main">
                <b>{route.host}</b>
                <small>
                  {route.collectionId ? t("保存到集合：{value0}", { value0: collectionNames.get(route.collectionId) ?? route.collectionId }) : t("保存时不自动加入集合")}
                </small>
              </div>
              {route.autoReader && <Tag>{t("自动阅读")}</Tag>}
              {spaces.length > 0 && <Select
                size="small"
                value={route.spaceId ?? 'none'}
                ariaLabel={t("所属 Space")}
                options={[{ value: 'none', label: t("不指定") }, ...spaces.map(space => ({ value: space.id, label: space.name }))]}
                onChange={value => onChange(routes.map(item => item.host === route.host ? { ...item, spaceId: value === 'none' ? null : String(value) } : item))}
              />}
              <Switch checked={route.enabled} onChange={enabled => onChange(setSiteRouteEnabled(routes, route.host, enabled))}/>
              <Button size="small" type="text" danger onClick={() => onChange(removeSiteRoute(routes, route.host))}>{t("删除")}</Button>
            </div>
          ))}
        </div>}
  </Modal>
}
