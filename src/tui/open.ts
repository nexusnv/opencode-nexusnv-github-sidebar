import open from "open"
import type { Context } from "@opencode/plugin/tui/context"

export type OpenLinks = "auto" | "browser" | "osc8"

export type OpenResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

export interface OpenEnvironment {
  readonly SSH_CONNECTION?: string | undefined
  readonly SSH_TTY?: string | undefined
}

export interface OpenExternalOptions {
  /** Injected for tests; defaults to the platform opener. */
  readonly opener?: (url: string) => Promise<unknown>
  readonly env?: OpenEnvironment
}

export function openLinksMode(value: unknown): OpenLinks {
  if (value === "browser" || value === "osc8" || value === "auto") return value
  return "auto"
}

export function shouldUseOsc8(
  mode: OpenLinks,
  env: OpenEnvironment = { SSH_CONNECTION: process.env.SSH_CONNECTION, SSH_TTY: process.env.SSH_TTY },
): boolean {
  if (mode === "osc8") return true
  if (mode === "browser") return false
  return Boolean(env.SSH_CONNECTION || env.SSH_TTY)
}

/**
 * Only canonical HTTPS links may leave the plugin.
 *
 * The server already normalizes URLs, but the TUI is a separate trust boundary:
 * a broken or malicious server response must not become a `javascript:` link,
 * a `file:` read, or a credential-bearing URL.
 */
export function safeExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== "https:") return undefined
  if (url.username || url.password) return undefined
  return url.href
}

/**
 * Open a canonical URL in the user's browser.
 *
 * In `osc8` mode the terminal owns the click through the rendered `<a href>`,
 * so this function deliberately does not spawn an opener. Callers stay
 * responsible for showing the URL when spawning fails.
 */
export async function openExternal(
  value: string,
  mode: OpenLinks = "auto",
  options: OpenExternalOptions = {},
): Promise<OpenResult> {
  const url = safeExternalUrl(value)
  if (!url) return { ok: false, reason: "Not a safe HTTPS link" }
  if (shouldUseOsc8(mode, options.env)) return { ok: true }

  try {
    await (options.opener ?? open)(url)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Could not open the browser" }
  }
}

/** Open a link and report a spawn failure instead of leaving a dead click. */
export async function openWithFeedback(
  context: Context,
  value: string,
  mode: OpenLinks = "auto",
  options: OpenExternalOptions = {},
): Promise<boolean> {
  const result = await openExternal(value, mode, options)
  if (result.ok) return true
  context.ui.toast.show({
    title: "Could not open the browser",
    message: `${result.reason}\n${value}`,
    variant: "error",
  })
  return false
}
