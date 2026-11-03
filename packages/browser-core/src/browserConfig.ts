/**
 * Host configuration the browser core cannot own itself.
 *
 * The page engine and tab services are pure browser logic, but a couple of
 * decisions belong to the host application (today: whether the ad blocker is
 * enabled in settings). The app registers those providers once at startup
 * instead of the package importing app modules.
 */

export type BooleanProvider = () => boolean

const alwaysOff: BooleanProvider = () => false

let adBlockEnabledProvider: BooleanProvider = alwaysOff

/** Register the host's ad-blocker setting. Called once from the app shell. */
export function setAdBlockEnabledProvider(provider: BooleanProvider): void {
  adBlockEnabledProvider = provider
}

/** Whether the host currently has ad blocking turned on. */
export function isAdBlockEnabled(): boolean {
  try {
    return adBlockEnabledProvider()
  } catch {
    return false
  }
}
