import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkoutRoot, detectRepo } from "../src/server/repo"
import { runGit } from "../src/shared/git"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "github-sidebar-repo-"))
  roots.push(directory)
  return directory
}

async function git(args: string[], cwd: string): Promise<string> {
  return runGit(args, cwd, { timeoutMs: 10_000 })
}

async function initRepo(remote?: string): Promise<string> {
  const directory = await tempDir()
  await git(["init", "-b", "main"], directory)
  await git(
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "init"],
    directory,
  )
  if (remote) await git(["remote", "add", "origin", remote], directory)
  return directory
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("detectRepo", () => {
  test("detects a GitHub checkout, branch, and remote default branch", async () => {
    const directory = await initRepo("git@github.com:acme/widgets.git")
    await git(["update-ref", "refs/remotes/origin/main", "HEAD"], directory)
    await git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], directory)

    const detection = await detectRepo({
      directory,
      remote: "origin",
      hosts: ["github.com"],
    })
    expect(detection.status).toBe("ok")
    if (detection.status !== "ok") return
    expect(detection.repo.host).toBe("github.com")
    expect(detection.repo.nameWithOwner).toBe("acme/widgets")
    expect(detection.repo.url).toBe("https://github.com/acme/widgets")
    expect(detection.repo.branch).toBe("main")
    expect(detection.repo.defaultBranchHint).toBe("main")
    expect(detection.repo.root).toBe(directory)
  })

  test("reports no-git outside a repository", async () => {
    const directory = await tempDir()
    expect(await detectRepo({ directory, remote: "origin", hosts: ["github.com"] })).toEqual({ status: "no-git" })
  })

  test("reports no-remote when no remotes are configured", async () => {
    const directory = await initRepo()
    expect(await detectRepo({ directory, remote: "origin", hosts: ["github.com"] })).toEqual({ status: "no-remote" })
  })

  test("reports a malformed remote", async () => {
    const directory = await initRepo("/tmp/not-a-github-url")
    expect(await detectRepo({ directory, remote: "origin", hosts: ["github.com"] })).toEqual({
      status: "malformed-remote",
    })
  })

  test("reports an unsupported host with the parsed host", async () => {
    const directory = await initRepo("git@gitlab.com:acme/widgets.git")
    expect(await detectRepo({ directory, remote: "origin", hosts: ["github.com"] })).toEqual({
      status: "unsupported-host",
      host: "gitlab.com",
    })
  })

  test("uses the configured remote when present", async () => {
    const directory = await initRepo("git@github.com:acme/widgets.git")
    await git(["remote", "add", "upstream", "git@github.com:other/widgets.git"], directory)
    const detection = await detectRepo({ directory, remote: "upstream", hosts: ["github.com"] })
    expect(detection.status).toBe("ok")
    if (detection.status !== "ok") return
    expect(detection.repo.nameWithOwner).toBe("other/widgets")
    expect(detection.repo.remote).toBe("upstream")
  })

  test("falls back to origin when the configured remote is missing", async () => {
    const directory = await initRepo("git@github.com:acme/widgets.git")
    const detection = await detectRepo({ directory, remote: "missing", hosts: ["github.com"] })
    expect(detection.status).toBe("ok")
    if (detection.status !== "ok") return
    expect(detection.repo.remote).toBe("origin")
  })

  test("checkoutRoot resolves a nested directory to the checkout root", async () => {
    const directory = await initRepo("git@github.com:acme/widgets.git")
    const nested = join(directory, "packages", "app")
    await mkdir(nested, { recursive: true })
    expect(await checkoutRoot(nested)).toBe(directory)
    expect(await checkoutRoot(join(await tempDir(), "missing"))).toStartWith(tmpdir())
  })
})
