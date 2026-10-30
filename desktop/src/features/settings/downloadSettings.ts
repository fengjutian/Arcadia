export interface DownloadSettings {
  directory: string
  askWhereToSave: boolean
  openOfficeInBrowser: boolean
  showPanelOnStart: boolean
}

export const DOWNLOAD_SETTINGS_KEY = 'arcadia-download-settings.v1'
export const DOWNLOAD_SETTINGS_EVENT = 'arcadia-download-settings-change'
export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  directory: '',
  askWhereToSave: false,
  openOfficeInBrowser: false,
  showPanelOnStart: true,
}

export function readDownloadSettings(): DownloadSettings {
  try {
    const value = JSON.parse(localStorage.getItem(DOWNLOAD_SETTINGS_KEY) ?? '{}') as Partial<DownloadSettings>
    return {
      directory: typeof value.directory === 'string' ? value.directory : '',
      askWhereToSave: value.askWhereToSave === true,
      openOfficeInBrowser: value.openOfficeInBrowser === true,
      showPanelOnStart: value.showPanelOnStart !== false,
    }
  } catch { return DEFAULT_DOWNLOAD_SETTINGS }
}

export function writeDownloadSettings(settings: DownloadSettings): DownloadSettings {
  localStorage.setItem(DOWNLOAD_SETTINGS_KEY, JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent<DownloadSettings>(DOWNLOAD_SETTINGS_EVENT, { detail: settings }))
  return settings
}
