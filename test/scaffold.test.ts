import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const read = (path: string) => readFileSync(resolve(root, path), "utf8")

describe("repository foundation", () => {
  test("package manifest is a Bun ESM plugin package", () => {
    const pkg = JSON.parse(read("package.json"))

    expect(pkg.name).toBe("opencode-nexusnv-github-sidebar")
    expect(pkg.type).toBe("module")
    expect(pkg.exports["."]).toBe("./src/index.ts")
    expect(pkg.exports["./tui"]).toBe("./src/tui.tsx")
    expect(pkg.exports["./rpc"]).toBe("./src/rpc.ts")
    expect(pkg.devDependencies["@opencode/plugin"]).toBe("2.1.4")
  })

  test("entrypoints, lockfile, and project docs exist", () => {
    for (const file of [
      "src/index.ts",
      "src/tui.tsx",
      "src/rpc.ts",
      "bun.lock",
      "README.md",
      "LICENSE",
      "CHANGELOG.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
    ]) {
      expect(existsSync(resolve(root, file)), `${file} exists`).toBe(true)
    }
  })

  test("tsconfig is strict and covers source plus tests", () => {
    const tsconfig = JSON.parse(read("tsconfig.json"))

    expect(tsconfig.compilerOptions.strict).toBe(true)
    expect(tsconfig.compilerOptions.noEmit).toBe(true)
    expect(tsconfig.compilerOptions.noUncheckedIndexedAccess).toBe(true)
    expect(tsconfig.include).toContain("src/**/*.ts")
    expect(tsconfig.include).toContain("src/**/*.tsx")
    expect(tsconfig.include).toContain("test/**/*.ts")
    expect(tsconfig.include).toContain("scripts/**/*.ts")
  })
})
