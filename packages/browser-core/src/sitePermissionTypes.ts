export type SitePermissionKind =
  | 'camera'
  | 'microphone'
  | 'location'
  | 'notifications'
  | 'clipboard'

export type SitePermissionValue = 'allow' | 'deny' | 'ask'

export interface SitePermissionRule {
  origin: string
  camera: SitePermissionValue
  microphone: SitePermissionValue
  location: SitePermissionValue
  notifications: SitePermissionValue
  clipboard: SitePermissionValue
}

export interface LegacySitePermissionRule {
  origin: string
  camera?: boolean
  microphone?: boolean
  location?: boolean
  notifications?: boolean
  clipboard?: boolean
}
