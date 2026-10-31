import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")

/**
 * The TUI host rewrites these specifiers to its own runtime modules, but only
 * for `.tsx` sources. A `.ts` source resolves them from the plugin's
 * `node_modules` instead, which silently creates a second runtime: components
 * still render, while effects created in the `.ts` module never track host
 * signals such as `context.location`. This bit the sidebar in OpenCode 2.2.0
 * and is invisible to render tests because the test preload installs the
 * transform for every source file.
 *
 * `src/tui/state.tsx` documents the same constraint from the other side.
 */
export const HOST_RUNTIME_SPECIFIER =
  /^(?:solid-js(?:\/store)?|@opentui\/(?:core|solid)(?:\/.*)?|@opencode\/plugin\/tui(?:\/.*)?)$/

const FROM = /(?:^|\W)(?:import|export)\s+(?!type\b)[^"'`]*?\bfrom\s*["']([^"']+)["']/
const SIDE_EFFECT = /^\s*import\s*["']([^"']+)["']/
const DYNAMIC = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/

/**
 * Line-oriented tripwire: multi-line import lists and aliased dynamic imports
 * still require review. Type-only imports are allowed because they are erased
 * and never load the runtime module.
 */
export function hostRuntimeImport(line: string): string | undefined {
  for (const pattern of [FROM, SIDE_EFFECT, DYNAMIC]) {
    const specifier = pattern.exec(line)?.[1]
    if (specifier && HOST_RUNTIME_SPECIFIER.test(specifier)) return specifier
  }
  return undefined
}

function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return []
  const entries = readdirSync(path, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) return sourceFiles(entryPath)
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [entryPath] : []
  })
}

describe("TUI host runtime", () => {
  test("matcher catches value imports and allows type-only imports", () => {
    const flagged = [
      'import { createSignal } from "solid-js"',
      'import * as Solid from "solid-js"',
      'import "solid-js"',
      'export { createSignal } from "solid-js"',
      'import { createStore } from "solid-js/store"',
      'import { Plugin } from "@opencode/plugin/tui"',
      'import { Box } from "@opentui/solid"',
      'const solid = await import("solid-js")',
      'const solid = require("solid-js")',
    ]
    const allowed = [
      'import type { Context } from "@opencode/plugin/tui/context"',
      'import type { JSX } from "@opentui/solid"',
      'import { Plugin } from "@opencode/plugin"',
      'import { Rpc } from "@opencode/plugin/rpc"',
      'import { readFileSync } from "node:fs"',
    ]

    expect(flagged.filter((line) => !hostRuntimeImport(line))).toEqual([])
    expect(allowed.filter((line) => hostRuntimeImport(line))).toEqual([])
  })

  test("runtime modules are imported from .tsx sources only", () => {
    const files = [...sourceFiles(resolve(root, "src")), resolve(root, "index.ts"), resolve(root, "rpc.ts")]
    const violations: string[] = []

    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n")
      for (const [index, line] of lines.entries()) {
        const specifier = hostRuntimeImport(line)
        if (specifier) violations.push(`${relative(root, file)}:${index + 1}: ${specifier}`)
      }
    }

    expect(violations).toEqual([])
  })
})
