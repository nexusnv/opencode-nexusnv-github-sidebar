/**
 * Opt-in live GitHub smoke test.
 *
 * This script is never part of `bun test`: it talks to the real GitHub API and
 * uses the developer's existing `gh auth token` (or the plugin integration when
 * a host context supplies one, which this script does not). It exists to prove
 * that the checked-in GraphQL query still matches the live schema and that
 * normalization survives real data.
 *
 *   GITHUB_SIDEBAR_LIVE=1 bun run smoke:live
 */
import { parseConfig } from "../src/config.js"
import { resolveAuth } from "../src/server/auth.js"
import { githubGraphql } from "../src/server/github.js"
import { normalizeSidebar } from "../src/server/normalize.js"
import { SIDEBAR_QUERY } from "../src/server/query.js"
import { detectRepo } from "../src/server/repo.js"
import { graphqlEndpoint } from "../src/shared/remote.js"
import type { RepoRef } from "../src/shared/types.js"
import { VERSION } from "../src/shared/version.js"

const USER_AGENT = `opencode-nexusnv-github-sidebar/${VERSION}`

if (process.env.GITHUB_SIDEBAR_LIVE !== "1") {
  console.log("live smoke skipped: set GITHUB_SIDEBAR_LIVE=1 to call the GitHub API")
  process.exit(0)
}

const parsed = parseConfig({})
if (parsed.errors.length > 0) {
  console.error(`configuration error: ${parsed.errors.join("; ")}`)
  process.exit(1)
}
const config = parsed.config

const detection = await detectRepo({
  directory: process.cwd(),
  remote: config.remote,
  hosts: config.hosts,
})
if (detection.status !== "ok") {
  console.error(`repository detection failed: ${detection.status}`)
  process.exit(1)
}
const detected = detection.repo

const auth = await resolveAuth(
  {
    location: { directory: process.cwd() },
    integration: {
      connection: {
        active: async () => undefined,
        resolve: async () => undefined,
      },
      get: async () => ({ data: { connections: [] } }),
    },
  },
  config,
  detected.host,
)
if (!auth.token) {
  console.error("no GitHub credential: run `gh auth login` first")
  process.exit(1)
}

const repo: RepoRef = {
  host: detected.host,
  owner: detected.owner,
  name: detected.name,
  nameWithOwner: detected.nameWithOwner,
  url: detected.url,
  isPrivate: false,
}

const data = await githubGraphql<unknown>({
  endpoint: graphqlEndpoint(detected.host, config.apiUrl),
  token: auth.token,
  query: SIDEBAR_QUERY,
  variables: {
    owner: detected.owner,
    name: detected.name,
    branch: detected.branch ?? "",
    hasBranch: Boolean(detected.branch),
    prLimit: config.fetchLimit,
    issueLimit: config.fetchLimit,
  },
  timeoutMs: 15_000,
  userAgent: USER_AGENT,
})

const result = normalizeSidebar(data, repo, config)
if (!result.ok) {
  console.error(`normalization failed: ${result.reason}`)
  process.exit(1)
}

// Defense in depth: the token must never be part of anything the plugin
// renders, stores, or returns.
if (JSON.stringify(result.data).includes(auth.token)) {
  console.error("security failure: the live token appeared in normalized output")
  process.exit(1)
}

console.log(
  [
    `live smoke ok: ${repo.nameWithOwner} (${auth.source})`,
    `viewer ${result.data.viewer || "(unknown)"}`,
    `${result.data.pulls.length}/${result.data.totals.pulls} pull rows`,
    `${result.data.issues.length}/${result.data.totals.issues} issue rows`,
    `default branch ${result.data.defaultBranch || "(unknown)"}`,
  ].join(" · "),
)
