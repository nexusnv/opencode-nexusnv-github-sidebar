import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")

/**
 * OpenCode 2.1.4 does not sandbox TUI plugins. `context.client` can read stored
 * credential secrets, read/write server files, create server PTYs, run shells,
 * execute session process commands, and even create worktrees. This plugin
 * keeps that work in the server half and treats the TUI as trusted code; this
 * guard prevents accidental use.
 *
 * This is a line-oriented tripwire, not a proof: aliasing (`const c =
 * context.client`) and computed access (`client["credential"]`) can evade it.
 * Code review still matters.
 */
export const FORBIDDEN_CLIENT_API =
  /\bclient\s*(?:\?\.|\.)\s*(?:(?:credential|file|pty|shell|experimental|worktree)\b|session\s*(?:\?\.|\.)\s*(?:shell|command|background|environment)\b)/

export function findForbiddenClientApi(line: string): string | undefined {
  return FORBIDDEN_CLIENT_API.exec(line)?.[0]
}

function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return []
  const entries = readdirSync(path, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) return sourceFiles(entryPath)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : []
  })
}

describe("TUI trust boundary", () => {
  test("forbidden matcher catches every guarded API, including optional chaining", () => {
    const forbidden = [
      "context.client.credential.list()",
      "context.client?.credential.list()",
      "context.client.file.read({})",
      "context.client?.file?.read({})",
      "context.client.pty.create({})",
      "context.client.shell.create({})",
      "context.client.experimental.persistentPty.read({})",
      "context.client.worktree.create({})",
      "context.client.session.shell({ command: 'id' })",
      "context.client.session?.command({})",
      "context.client.session.background({})",
      "context.client.session.environment({})",
      "context.client?.session?.shell({})",
    ]
    const allowed = [
      "context.client.session.create({})",
      "context.client.session.synthetic({})",
      "context.client.session.list({})",
      "context.client.session.get({})",
      "context.client.rpc(Contract).health({})",
      "context.client.integration.list()",
      "context.client.integration.connect.key({})",
      "context.client.location.get({})",
      "context.client?.rpc(Contract)",
    ]

    expect(forbidden.filter((line) => !findForbiddenClientApi(line))).toEqual([])
    expect(allowed.filter((line) => findForbiddenClientApi(line))).toEqual([])
  })

  test("TUI-reachable code never calls unsandboxed server APIs", () => {
    const serverOnly = new Set([resolve(root, "src/index.ts"), ...sourceFiles(resolve(root, "src/server"))])
    const files = [...sourceFiles(resolve(root, "src")), resolve(root, "tui.tsx")].filter(
      (file) => !serverOnly.has(file),
    )
    const violations: string[] = []

    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n")
      for (const [index, line] of lines.entries()) {
        if (FORBIDDEN_CLIENT_API.test(line)) {
          violations.push(`${relative(root, file)}:${index + 1}: ${line.trim()}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
