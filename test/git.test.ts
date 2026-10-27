import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runGit, sanitizedGitEnv } from "../src/shared/git"

describe("sanitizedGitEnv", () => {
  const env = sanitizedGitEnv({
    env: {
      PATH: "/usr/bin",
      HOME: "/home/test",
      LANG: "C",
      GH_TOKEN: "server-token",
      GITHUB_TOKEN: "server-token-2",
      GIT_ASKPASS: "/tmp/askpass",
      SSH_ASKPASS: "/tmp/askpass",
      AWS_SECRET_ACCESS_KEY: "not-for-git",
    },
  })

  test("removes credentials and askpass helpers", () => {
    expect(env.GH_TOKEN).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.GIT_ASKPASS).toBeUndefined()
    expect(env.SSH_ASKPASS).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  test("keeps the minimum git environment and disables prompts", () => {
    expect(env.PATH).toBe("/usr/bin")
    expect(env.HOME).toBe("/home/test")
    expect(env.LANG).toBe("C")
    expect(env.GIT_TERMINAL_PROMPT).toBe("0")
  })
})

describe("runGit", () => {
  test("runs git in a real repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "github-sidebar-git-env-"))
    try {
      await runGit(["init"], directory, {
        env: {
          ...process.env,
          GH_TOKEN: "server-token",
          GITHUB_TOKEN: "server-token-2",
        },
      })

      expect(await runGit(["rev-parse", "--is-inside-work-tree"], directory)).toBe("true")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test.skipIf(process.platform === "win32")("removes tokens from a child process", async () => {
    const bin = await mkdtemp(join(tmpdir(), "github-sidebar-git-bin-"))
    try {
      const script = join(bin, "git")
      await writeFile(script, '#!/bin/sh\nprintf "%s\\n" "${GH_TOKEN-unset}" "${GITHUB_TOKEN-unset}"\n', {
        mode: 0o755,
      })

      const output = await runGit([], process.cwd(), {
        env: {
          PATH: bin,
          HOME: process.env.HOME,
          GH_TOKEN: "server-token",
          GITHUB_TOKEN: "server-token-2",
        },
      })

      expect(output).toBe("unset\nunset")
    } finally {
      await rm(bin, { recursive: true, force: true })
    }
  })
})
