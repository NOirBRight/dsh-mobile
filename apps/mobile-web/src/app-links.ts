/** Preserve cold Capacitor deep links until bootstrap can vault them; route warm links once. */
export class AppLinkInbox {
  readonly #validate: (url: string) => string | null
  readonly #navigate: (url: string) => void
  #pending: string | undefined
  #armed = false
  #last: string | undefined

  constructor(validate: (url: string) => string | null, navigate: (url: string) => void) {
    this.#validate = validate
    this.#navigate = navigate
  }

  capture(url: string): void {
    const valid = this.#validate(url)
    if (valid === null) return
    if (!this.#armed) { this.#pending = valid; return }
    if (valid === this.#last) return
    this.#last = valid
    this.#navigate(valid)
  }

  takeInitial(launchUrl: string | undefined): string | undefined {
    const launch = launchUrl === undefined ? undefined : this.#validate(launchUrl) ?? undefined
    const selected = this.#pending ?? launch
    this.#pending = undefined
    this.#last = selected
    return selected
  }

  arm(): void { this.#armed = true }
}
