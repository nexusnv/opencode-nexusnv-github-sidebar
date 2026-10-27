import { Rpc } from "@opencode/plugin/rpc"
import { RPC_ID } from "./shared/ids.js"

export { RPC_ID } from "./shared/ids.js"

const repoRefSchema = {
  type: "object",
  properties: {
    host: { type: "string" },
    owner: { type: "string" },
    name: { type: "string" },
    nameWithOwner: { type: "string" },
    url: { type: "string" },
    isPrivate: { type: "boolean" },
  },
  required: ["host", "owner", "name", "nameWithOwner", "url", "isPrivate"],
  additionalProperties: false,
} as const

const pullSchema = {
  type: "object",
  properties: {
    number: { type: "number" },
    title: { type: "string" },
    url: { type: "string" },
    isDraft: { type: "boolean" },
    isCrossRepository: { type: "boolean" },
    headRefName: { type: "string" },
    headRepositoryOwner: { type: "string" },
    author: { type: "string" },
    isMine: { type: "boolean" },
    comments: { type: "number" },
    reviews: { type: "number" },
    ci: { type: "string", enum: ["pass", "fail", "run", "wait", "none", "unknown"] },
    merge: {
      type: "string",
      enum: [
        "ready",
        "blocked",
        "changes",
        "conflict",
        "behind",
        "unstable",
        "review",
        "draft",
        "hooks",
        "mergeable",
        "unknown",
      ],
    },
    updatedAt: { type: "string" },
  },
  required: [
    "number",
    "title",
    "url",
    "isDraft",
    "isCrossRepository",
    "headRefName",
    "headRepositoryOwner",
    "author",
    "isMine",
    "comments",
    "reviews",
    "ci",
    "merge",
    "updatedAt",
  ],
  additionalProperties: false,
} as const

const issueSchema = {
  type: "object",
  properties: {
    number: { type: "number" },
    title: { type: "string" },
    url: { type: "string" },
    author: { type: "string" },
    assignees: { type: "array", items: { type: "string" } },
    isMine: { type: "boolean" },
    comments: { type: "number" },
    labels: { type: "array", items: { type: "string" } },
    updatedAt: { type: "string" },
  },
  required: ["number", "title", "url", "author", "assignees", "isMine", "comments", "labels", "updatedAt"],
  additionalProperties: false,
} as const

const viewSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["auto", "mine", "all"] },
    autoAllThreshold: { type: "number" },
    pulls: {
      type: "object",
      properties: { enabled: { type: "boolean" }, limit: { type: "number" } },
      required: ["enabled", "limit"],
      additionalProperties: false,
    },
    issues: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        limit: { type: "number" },
        labels: { type: "number" },
      },
      required: ["enabled", "limit", "labels"],
      additionalProperties: false,
    },
    actions: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        confirm: { type: "boolean" },
        worktree: { type: "boolean" },
        issueWorktree: { type: "boolean" },
        focusTabs: { type: "boolean" },
      },
      required: ["enabled", "confirm", "worktree", "issueWorktree", "focusTabs"],
      additionalProperties: false,
    },
    display: {
      type: "object",
      properties: {
        header: { type: "boolean" },
        totals: { type: "boolean" },
        order: { type: "array", items: { type: "string", enum: ["pulls", "issues"] } },
        collapsed: { type: "array", items: { type: "string", enum: ["pulls", "issues"] } },
        glyphs: { type: "string", enum: ["unicode", "ascii"] },
        showUnavailable: { type: "boolean" },
      },
      required: ["header", "totals", "order", "collapsed", "glyphs", "showUnavailable"],
      additionalProperties: false,
    },
    refreshSeconds: { type: "number" },
  },
  required: ["scope", "autoAllThreshold", "pulls", "issues", "actions", "display", "refreshSeconds"],
  additionalProperties: false,
} as const

const summaryDataSchema = {
  type: "object",
  properties: {
    viewer: { type: "string" },
    branch: { type: "string" },
    defaultBranch: { type: "string" },
    branchPr: pullSchema,
    pulls: { type: "array", items: pullSchema },
    issues: { type: "array", items: issueSchema },
    totals: {
      type: "object",
      properties: { pulls: { type: "number" }, issues: { type: "number" } },
      required: ["pulls", "issues"],
      additionalProperties: false,
    },
    rateLimit: {
      type: "object",
      properties: {
        cost: { type: "number" },
        remaining: { type: "number" },
        resetAt: { type: "string" },
      },
      required: ["cost", "remaining", "resetAt"],
      additionalProperties: false,
    },
  },
  required: ["viewer", "branch", "defaultBranch", "pulls", "issues", "totals"],
  additionalProperties: false,
} as const

const summaryResponseSchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: [
        "ready",
        "stale",
        "disabled",
        "no-git",
        "no-remote",
        "unsupported-host",
        "no-auth",
        "unauthorized",
        "not-found",
        "rate-limited",
        "network",
        "error",
      ],
    },
    message: { type: "string" },
    view: viewSchema,
    repository: repoRefSchema,
    data: summaryDataSchema,
    fetchedAt: { type: "number" },
    retryAt: { type: "string" },
  },
  required: ["status", "message", "view", "fetchedAt", "retryAt"],
  additionalProperties: false,
} as const

const launchResultSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    code: {
      type: "string",
      enum: [
        "ok",
        "disabled",
        "no-git",
        "no-remote",
        "unsupported-host",
        "worktree-disabled",
        "no-default-branch",
        "not-found",
        "fetch-failed",
        "worktree-failed",
        "branch-failed",
        "store-failed",
      ],
    },
    message: { type: "string" },
    kind: { type: "string", enum: ["pull", "issue"] },
    number: { type: "number" },
    repository: {
      type: "object",
      properties: {
        host: { type: "string" },
        nameWithOwner: { type: "string" },
        url: { type: "string" },
        isPrivate: { type: "boolean" },
      },
      required: ["host", "nameWithOwner", "url", "isPrivate"],
      additionalProperties: false,
    },
    title: { type: "string" },
    url: { type: "string" },
    branch: { type: "string" },
    base: { type: "string" },
    worktree: { type: "string" },
    subpath: { type: "string" },
    sessionDirectory: { type: "string" },
    reused: { type: "boolean" },
    context: { type: "string" },
    description: { type: "string" },
  },
  required: [
    "ok",
    "code",
    "message",
    "kind",
    "number",
    "repository",
    "title",
    "url",
    "branch",
    "base",
    "worktree",
    "subpath",
    "sessionDirectory",
    "reused",
    "context",
    "description",
  ],
  additionalProperties: false,
} as const

/**
 * Location-scoped contract between the TUI half and the server half.
 *
 * `health` is the liveness/location gate. `summary` returns one normalized
 * snapshot plus the effective server-owned view. `prepareLaunch` performs the
 * server-side fetch/worktree/branch work and returns launch context; it never
 * returns a token.
 */
export const GithubSidebarRpc = Rpc.define({
  id: RPC_ID,
  methods: {
    health: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          plugin: { type: "string" },
          location: { type: "string" },
        },
        required: ["ok", "plugin", "location"],
        additionalProperties: false,
      },
    },
    summary: {
      input: {
        type: "object",
        properties: {
          force: { type: "boolean" },
        },
        required: ["force"],
        additionalProperties: false,
      },
      output: summaryResponseSchema,
    },
    prepareLaunch: {
      input: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["pull", "issue"] },
          number: { type: "number" },
        },
        required: ["kind", "number"],
        additionalProperties: false,
      },
      output: launchResultSchema,
    },
  },
  events: {},
})
