# P1 Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the P1 full-list GitHub session panel and durable sidebar section collapse, reusing the P0 snapshot and keeping the existing true totals.

**Architecture:** The server caches one full normalized snapshot (every row fetched under `fetchLimit`) and derives the bounded sidebar selection from it. `summary` gains an optional `full` flag; the panel requests all fetched rows while the sidebar keeps its configured display limits. The TUI registers a `session.panel` contribution with a focused keymap layer. Section collapse moves from an in-memory signal to `context.storage.store`, seeded once from `display.collapsed`.

**Tech Stack:** TypeScript ESM, SolidJS/OpenTUI, OpenCode 2.1.4 plugin APIs, Bun tests, GitHub GraphQL.

---

## Scope

**In scope**

- `session.panel` with keyboard navigation, mouse launch, mine/all filter, fullscreen toggle, refresh, and close.
- Full rows up to `fetchLimit` (100 maximum) in the panel; the sidebar keeps `pulls.limit` / `issues.limit`.
- Durable section collapse across TUI restarts, seeded from `display.collapsed` on first run.
- While in scope, verify true totals and `+ N more` remain correct.

**Already implemented in P0**

- `totals` from GraphQL `totalCount`.
- `+ N more` rows and section titles with true totals.

**Deferred**

- Every other P1 bullet in the research report: session linking, context dialog, multiple-session picker, worktree removal, review-requested filter, search fallback, adaptive polling, GHES hardening, ASCII glyph mode, palette/slash commands, background `updated` event.

---

## File Structure

| File                           | Responsibility                                                          |
| ------------------------------ | ----------------------------------------------------------------------- |
| `src/shared/contract.ts`       | Parse `summary.full`; keep strict RPC validation.                       |
| `src/rpc.ts`                   | Add the optional `full` input to the summary schema.                    |
| `src/server/normalize.ts`      | Return ordered full rows alongside the bounded selection.               |
| `src/server/service.ts`        | Cache the full snapshot; serve `full` or bounded data from one load.    |
| `src/tui/state.tsx`            | Pass `full`; move collapse to durable storage with validation.          |
| `src/tui/status-line.tsx`      | New shared status/auth line for the sidebar and panel.                  |
| `src/tui/panel.tsx`            | New full-list panel, row model, filters, and keymap commands.           |
| `src/tui/row.tsx`              | Optional selection background and row id.                               |
| `src/tui/format.ts`            | Panel affordance glyph.                                                 |
| `src/tui/sidebar.tsx`          | Extract status line; add the panel button.                              |
| `src/tui.tsx`                  | Register `session.panel` and the global open command.                   |
| `test/helpers/tui.ts`          | Fake storage, keymap, and panel APIs.                                   |
| `test/*.test.ts(x)`            | Contract, service, state, panel render/keyboard, and boundary coverage. |
| `README.md`, `AGENTS.md`, docs | Document the panel, keys, persistence, and updated limitations.         |

---

## Task 1: Server full snapshot

**Files:**

- Modify: `src/shared/contract.ts`, `src/rpc.ts`, `src/server/normalize.ts`, `src/server/service.ts`
- Test: `test/contract.test.ts`, `test/normalize.test.ts`, `test/service.test.ts`

- [ ] **Step 1: Write the failing contract test**

Add to `test/contract.test.ts`:

```ts
test("accepts an optional full flag on summary input", () => {
  expect(parseSummaryInput({ force: true })).toEqual({ force: true, full: false })
  expect(parseSummaryInput({ force: false, full: true })).toEqual({ force: false, full: true })
  expect(() => parseSummaryInput({ force: true, full: "yes" })).toThrow(TypeError)
})
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test test/contract.test.ts`

Expected: FAIL because `full` is not returned.

- [ ] **Step 3: Extend the parser and RPC schema**

In `src/shared/contract.ts`:

```ts
export interface SummaryInput {
  readonly force: boolean
  readonly full: boolean
}

export function parseSummaryInput(value: unknown): SummaryInput {
  if (!isRecord(value) || typeof value.force !== "boolean") {
    throw new TypeError("summary input must be { force: boolean, full?: boolean }")
  }
  if (value.full !== undefined && typeof value.full !== "boolean") {
    throw new TypeError("summary.full must be a boolean")
  }
  return { force: value.force, full: value.full === true }
}
```

In `src/rpc.ts`, add to the `summary.input.properties` block:

```ts
full: { type: "boolean" },
```

Keep `required: ["force"]`; older callers remain valid.

- [ ] **Step 4: Write the failing normalization test**

Add to `test/normalize.test.ts`:

```ts
test("returns every fetched row in full while the sidebar stays bounded", () => {
  const body = sidebarBody()
  const pulls = Array.from({ length: 12 }, (_, index) => ({
    ...pullNode,
    number: 100 + index,
    title: `Other ${index}`,
    author: { login: "other" },
  }))
  body.repository.pullRequests.nodes = pulls
  body.repository.pullRequests.totalCount = 12

  const config = parseConfig({ scope: "auto", autoAllThreshold: 5, pulls: { limit: 3 } }).config
  const result = normalizeSidebar(body, repo, config)

  expect(result.data.pulls).toHaveLength(3)
  expect(result.full.pulls).toHaveLength(12)
  expect(result.full.totals.pulls).toBe(12)
})
```

- [ ] **Step 5: Run it and confirm the failure**

Run: `bun test test/normalize.test.ts`

Expected: FAIL because `result.full` is undefined.

- [ ] **Step 6: Return ordered full rows from normalization**

In `src/server/normalize.ts`, split ordering out of `selectRows`:

```ts
export interface OrderedRows {
  readonly pulls: readonly PullView[]
  readonly issues: readonly IssueView[]
}

export function orderedRows(options: {
  readonly pulls: readonly PullView[]
  readonly issues: readonly IssueView[]
  readonly branchPr: PullView | undefined
}): OrderedRows {
  const branchNumber = options.branchPr?.number
  return {
    pulls: [
      ...(options.branchPr ? [options.branchPr] : []),
      ...options.pulls.filter((pull) => pull.number !== branchNumber && pull.isMine),
      ...options.pulls.filter((pull) => pull.number !== branchNumber && !pull.isMine),
    ],
    issues: [...options.issues.filter((issue) => issue.isMine), ...options.issues.filter((issue) => !issue.isMine)],
  }
}
```

Use `orderedRows` inside `selectRows` instead of the inline ordering. Extend the result:

```ts
export type NormalizeSidebarResult =
  | { readonly ok: true; readonly data: SummaryData; readonly full: SummaryData; readonly isPrivate: boolean }
  | { readonly ok: false; readonly reason: "not-found" }
```

In `normalizeSidebar`, build both payloads from one set of rows:

```ts
const ordered = orderedRows({ pulls, issues, branchPr })
const selected = selectRows({ pulls, issues, pullsTotal, issuesTotal, branchPr, config })
const shared = {
  viewer,
  branch: "",
  defaultBranch: sanitizeText(body.repository.defaultBranchRef?.name, 200),
  ...(branchPr ? { branchPr } : {}),
  totals: { pulls: pullsTotal, issues: issuesTotal },
  ...(rateLimit ? { rateLimit } : {}),
}
```

Return:

```ts
data: { ...shared, pulls: selected.pulls, issues: selected.issues },
full: {
  ...shared,
  pulls: config.pulls.enabled ? ordered.pulls : [],
  issues: config.issues.enabled ? ordered.issues : [],
},
```

- [ ] **Step 7: Write the failing service test**

Add to `test/service.test.ts`:

```ts
test("serves full rows from the same cached snapshot", async () => {
  const directory = await tempRepo("git@github.com:acme/widgets.git")
  let calls = 0
  const nodes = Array.from({ length: 6 }, (_, index) => ({
    ...pullNode,
    number: 100 + index,
    title: `Pull ${index}`,
    author: { login: "other" },
  }))
  const body = summaryBody()
  body.repository.pullRequests.nodes = nodes
  body.repository.pullRequests.totalCount = 6

  const service = new GithubSidebarService(
    context(directory),
    parseConfig({ token: "secret-token", scope: "auto", autoAllThreshold: 1, pulls: { limit: 2 } }),
    {
      fetchImpl: async () => {
        calls++
        return jsonResponse({ data: body })
      },
    },
  )
  const signal = new AbortController().signal

  const bounded = await service.summary({ force: false }, signal)
  const full = await service.summary({ force: false, full: true }, signal)

  expect(calls).toBe(1)
  expect(bounded.data?.pulls).toHaveLength(2)
  expect(full.data?.pulls).toHaveLength(6)
  expect(full.data?.totals.pulls).toBe(6)
})
```

- [ ] **Step 8: Run it and confirm the failure**

Run: `bun test test/service.test.ts`

Expected: FAIL because `summary` ignores `full`.

- [ ] **Step 9: Cache both payloads and select per request**

In `src/server/service.ts`:

```ts
interface CachedSummary {
  readonly selected: SummaryData
  readonly full: SummaryData
  readonly isPrivate: boolean
}
```

In the cache `load`:

```ts
const normalized = normalizeSidebar(body, repository, this.config)
if (!normalized.ok) throw new NotFoundError()
return {
  selected: { ...normalized.data, branch },
  full: { ...normalized.full, branch },
  isPrivate: normalized.isPrivate,
}
```

In `summary`:

```ts
this.lastSummary.set(this.repoKey(repo), {
  data: hit.value.full,
  isPrivate: hit.value.isPrivate,
  fetchedAt: hit.fetchedAt,
})
return summaryResponse({
  // ...
  data: input.full === true ? hit.value.full : hit.value.selected,
  // ...
})
```

The launch cache now sees every fetched row, so preparing a launch for a panel row does not need a second list query.

- [ ] **Step 10: Run the server tests**

Run: `bun test test/contract.test.ts test/normalize.test.ts test/service.test.ts`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/shared/contract.ts src/rpc.ts src/server/normalize.ts src/server/service.ts test/contract.test.ts test/normalize.test.ts test/service.test.ts
git commit -m "feat: serve full rows for the session panel"
```

---

## Task 2: Durable section collapse

**Files:**

- Modify: `src/tui/state.tsx`, `test/helpers/tui.ts`
- Test: `test/tui.test.tsx`, `test/tui-state.test.ts` (new, optional)

- [ ] **Step 1: Add fake TUI storage**

In `test/helpers/tui.ts`, import `createStore` and `produce` from `solid-js/store`, then replace the `context.storage` stub with a shared keyed store:

```ts
const stores = new Map<
  string,
  readonly [ReturnType<typeof createStore>[0], (mutation: (draft: any) => void) => Promise<void>]
>()
const storage = {
  store<Value extends object>(key: string, options: { readonly initial: Value }) {
    const existing = stores.get(key)
    if (existing) return existing as never
    const [store, setStore] = createStore(structuredClone(options.initial))
    const update = async (mutation: (draft: Value) => void) => {
      setStore(produce(mutation))
    }
    const entry = [store, update] as const
    stores.set(key, entry as never)
    return entry
  },
}
```

Expose it on the fake context as `storage`. Do not persist to disk in tests.

- [ ] **Step 2: Write the failing persistence test**

Add to `test/tui.test.tsx`:

```tsx
test("persists section collapse across remounts and ignores config after the first seed", async () => {
  const fake = fakeTui({
    summary: async () => summaryResponse({ data: summaryData() }),
  })

  const first = await renderSidebar(fake)
  try {
    await first.waitForFrame((frame) => frame.includes("Pull requests"))
    await first.mockMouse.click(1, 7) // section header row; adjust to the rendered frame
    await first.waitFor(() => fake.storage.get("preferences")?.initialized === true)
  } finally {
    await first.dispose()
  }

  const second = await renderSidebar(fake)
  try {
    const frame = await second.waitForFrame((value) => value.includes("Pull requests"))
    expect(frame).toContain("▸ Pull requests")
  } finally {
    await second.dispose()
  }
})
```

If clicking coordinates are brittle, expose the state's `toggleSection` from a focused component test instead. The assertion must prove a second mount reads storage rather than `display.collapsed`.

- [ ] **Step 3: Run it and confirm the failure**

Run: `bun test test/tui.test.tsx`

Expected: FAIL because collapse is in-memory and the second mount expands again.

- [ ] **Step 4: Move collapse into storage**

In `src/tui/state.tsx`:

```ts
interface SidebarPreferences {
  initialized: boolean
  collapsed: SectionName[]
}

function sanitizeSections(value: unknown): readonly SectionName[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is SectionName => entry === "pulls" || entry === "issues")
}
```

Inside `createSidebarState`:

```ts
const [preferences, updatePreferences] = context.storage.store<SidebarPreferences>("preferences", {
  initial: { initialized: false, collapsed: [] },
})
const collapsed = () => sanitizeSections(preferences.collapsed)
```

In `applySummary`:

```ts
if (!preferences.initialized) {
  void updatePreferences((draft) => {
    if (draft.initialized) return
    draft.initialized = true
    draft.collapsed = [...next.view.display.collapsed]
  }).catch(() => undefined)
}
```

Replace `toggleSection`:

```ts
toggleSection: (section) => {
  void updatePreferences((draft) => {
    draft.initialized = true
    const current = sanitizeSections(draft.collapsed)
    draft.collapsed = current.includes(section)
      ? current.filter((entry) => entry !== section)
      : [...current, section]
  }).catch(() => undefined)
},
```

Remove `collapsedInitialized` and the `setCollapsed([])` in `reset()`; collapse is a global client preference, not location state. Keep the `collapsed` accessor in `SidebarState`.

- [ ] **Step 5: Run the TUI tests**

Run: `bun test test/tui.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tui/state.tsx test/helpers/tui.ts test/tui.test.tsx
git commit -m "feat: persist sidebar section collapse"
```

---

## Task 3: Panel row model and shared status line

**Files:**

- Create: `src/tui/status-line.tsx`
- Modify: `src/tui/sidebar.tsx`, `src/tui/row.tsx`, `src/tui/format.ts`
- Test: `test/tui-format.test.ts`, `test/tui.test.tsx`

- [ ] **Step 1: Extract the status line**

Move `messageHint`, `connectAlert`, and `StatusLine` from `src/tui/sidebar.tsx` into `src/tui/status-line.tsx`, exporting `StatusLine`. Keep the behavior identical. Import it back into `sidebar.tsx`.

- [ ] **Step 2: Add the panel glyph and selection support**

In `src/tui/format.ts`:

```ts
readonly panel: string
```

Unicode: `panel: "▤"`. ASCII: `panel: "P"`.

In `src/tui/row.tsx`, add optional `id` and `selected`:

```ts
export function Row(props: {
  readonly context: Context
  readonly onActivate: () => void
  readonly id?: string
  readonly selected?: boolean
  readonly children: JSX.Element
}) {
  return (
    <box
      id={props.id}
      flexDirection="column"
      minWidth={0}
      backgroundColor={props.selected ? props.context.theme.background.raised.high : undefined}
      onMouseUp={(event: MouseLike) => {
        if (event.button !== 0) return
        props.onActivate()
      }}
    >
      {props.children}
    </box>
  )
}
```

Pass `id` and `selected` through `PullRow` and `IssueRow`.

- [ ] **Step 3: Add the sidebar panel button**

In the sidebar header row, before the refresh control:

```tsx
<text
  flexShrink={0}
  fg={theme.text.muted}
  onMouseUp={(event: MouseLike) => {
    if (event.button !== 0) return
    event.stopPropagation()
    openGithubPanel(props.context)
  }}
>
  {props.glyphs.panel}
</text>
```

`openGithubPanel` is defined in Task 4.

- [ ] **Step 4: Run formatting, types, and tests**

Run: `bun run format && bun run typecheck && bun test test/tui.test.tsx test/tui-format.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/status-line.tsx src/tui/sidebar.tsx src/tui/row.tsx src/tui/format.ts test/tui-format.test.ts test/tui.test.tsx
git commit -m "refactor: share status UI and prepare selectable rows"
```

---

## Task 4: Full-list session panel

**Files:**

- Create: `src/tui/panel.tsx`
- Modify: `src/tui.tsx`, `src/tui/state.tsx`
- Test: `test/tui-panel.test.tsx` (new), `test/helpers/tui.ts`

- [ ] **Step 1: Add the `full` option to the TUI state**

In `src/tui/state.tsx`:

```ts
export interface SidebarStateOptions {
  readonly full?: boolean
}

export function createSidebarState(context: Context, options: SidebarStateOptions = {}): SidebarState
```

Pass it through:

```ts
.summary(
  { force, full: options.full === true },
  { location: requireRpcLocation(context), signal: controller.signal },
)
```

- [ ] **Step 2: Write the failing panel render test**

Add `test/tui-panel.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { GithubPanel } from "../src/tui/panel"
import { fakeTui, summaryData, summaryResponse } from "./helpers/tui"

function panelInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "github",
    sessionID: "ses-root",
    width: 100,
    presentation: "panel",
    focused: true,
    focus() {},
    close() {},
    toggleFullscreen() {},
    ...overrides,
  } as never
}

test("renders every fetched row and reports truncation from true totals", async () => {
  const fake = fakeTui({
    summary: async () =>
      summaryResponse({
        data: summaryData({
          pulls: [
            pullView({ number: 7 }),
            pullView({ number: 8, title: "Second pull", isMine: false, author: "other" }),
          ],
          issues: [],
          totals: { pulls: 1_250, issues: 0 },
        }),
      }),
  })
  const app = await testRender(() => <GithubPanel context={fake.context} panel={panelInput()} />, {
    width: 100,
    height: 30,
  })
  try {
    const frame = await app.waitForFrame((value) => value.includes("GitHub"))
    expect(frame).toContain("#7 Fix the widget")
    expect(frame).toContain("#8 Second pull")
    expect(frame).toContain("Pull requests (1,250)")
    expect(frame).toContain("showing 2 of 1,250")
    expect(frame).toContain("mine")
    expect(frame).toContain("all")
  } finally {
    await app.dispose()
  }
})
```

- [ ] **Step 3: Run it and confirm the failure**

Run: `bun test test/tui-panel.test.tsx`

Expected: FAIL because `src/tui/panel.tsx` does not exist.

- [ ] **Step 4: Implement `src/tui/panel.tsx`**

Required exports:

```ts
export function openGithubPanel(context: Context): boolean {
  return context.ui.panel.open("github")
}

export function GithubPanel(props: { readonly context: Context; readonly panel: PanelInput })

export function PanelCommands(props: { readonly context: Context })
```

Behavior:

- Root-session guard; child sessions show `GitHub is not available in child sessions.`
- `createSidebarState(context, { full: true })`.
- Gate states reuse `StatusLine`; disabled renders nothing.
- Header: `GitHub · owner/repo`, branch, stale marker, filter buttons `mine` / `all`, refresh, close.
- `mine` filters rows by `isMine`; `all` shows every fetched row. Default to `mine` only when `view.scope === "mine"`.
- Section order comes from `view.display.order`, filtered by enabled sections.
- Section title uses `sectionTitle` with `totals`; when `rows.length < data.totals`, render `showing N of TOTAL`.
- Entries are a flat list of section headers and rows so `j`/`k` walk sections transparently.
- Selection is `createSignal(0)`; clamp on data/filter changes; reset to 0 on filter change.
- Rows use `PullRow` / `IssueRow`, selected background, id `${rowId(index)}`.
- `scrollChildIntoView(rowId(selected()))` in an effect after selection changes.
- Empty section text matches the sidebar: `No open pull requests`, `No matching pull requests`, etc.
- Footer: `j/k move · enter launch · o browser · r refresh · m mine · a all · f fullscreen · esc close`.
- Keymap layer: `enabled: () => props.panel.focused && root()`, commands for `j`, `down`, `k`, `up`, `enter`, `o`, `r`, `m`, `a`, `f`, `escape`.
- `enter` calls `launchItem` with the selected row and effective actions.
- `o` calls `openWithFeedback`.
- `r` calls `state.refresh(true)`.
- `f` calls `props.panel.toggleFullscreen()`.
- `escape` calls `props.panel.close()`.
- `PanelCommands` registers `github.panel.open` with `mode: "global"`, `bind: "ctrl+shift+g"`, `palette: true`, group `GitHub`; it toggles the panel when `context.ui.panel.current()?.name === "github"`, otherwise opens it and toasts when no session is available.

- [ ] **Step 5: Register the contribution**

In `src/tui.tsx`:

```tsx
context.ui.slot({
  append: "session.panel",
  render: (panel) => (
    <Show when={panel.name === "github"}>
      <GithubPanel context={context} panel={panel} />
    </Show>
  ),
})
context.ui.slot({
  append: "app",
  render: () => <PanelCommands context={context} />,
})
```

Import `Show`.

- [ ] **Step 6: Run the panel test**

Run: `bun test test/tui-panel.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tui/panel.tsx src/tui.tsx src/tui/state.tsx test/tui-panel.test.tsx test/helpers/tui.ts
git commit -m "feat: add the full-list GitHub session panel"
```

---

## Task 5: Keyboard and state coverage

**Files:**

- Modify: `test/helpers/tui.ts`, `test/tui-panel.test.tsx`

- [ ] **Step 1: Extend the fake context**

Add to `test/helpers/tui.ts`:

- `keymap.layer(factory)` stores factories; expose `keymapCommands()` that evaluates them and returns commands.
- `keymap.dispatch`, `shortcuts`, `commands`, `pending`, `active`, and `mode` stubs.
- `ui.panel.open/close/current` with a signal and call log.
- `ui.router.current()` returning `{ type: "session", sessionID: "ses-root" }`.
- `calls.panelOpen`, `calls.panelClose`.

- [ ] **Step 2: Write the failing navigation test**

```tsx
test("navigates rows, filters by mine, and launches the selected item", async () => {
  const fake = fakeTui({
    summary: async () =>
      summaryResponse({
        data: summaryData({
          pulls: [
            pullView({ number: 7 }),
            pullView({ number: 8, title: "Second pull", isMine: false, author: "other" }),
          ],
          issues: [issueView({ number: 9 })],
          totals: { pulls: 2, issues: 1 },
        }),
      }),
  })
  const app = await testRender(() => <GithubPanel context={fake.context} panel={panelInput()} />, {
    width: 100,
    height: 30,
  })
  try {
    await app.waitForFrame((value) => value.includes("#7"))
    const commands = fake.keymapCommands()
    commands.find((command) => command.bind === "j")?.run()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Second pull")
    commands.find((command) => command.bind === "m")?.run()
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Second pull")
    commands.find((command) => command.bind === "a")?.run()
    commands.find((command) => command.bind === "enter")?.run()
    await app.waitFor(() => fake.calls.prepare.length === 1)
    expect(fake.calls.prepare[0]).toMatchObject({ input: { kind: "pull", number: 7 } })
  } finally {
    await app.dispose()
  }
})
```

- [ ] **Step 3: Run it and confirm the failure**

Run: `bun test test/tui-panel.test.tsx`

Expected: FAIL because the fake context lacks keymap/panel/router support.

- [ ] **Step 4: Implement the test fakes and make the test pass**

Keep the fake minimal but reactive. `keymap.layer` must call the factory so `enabled` and `commands` are visible to tests. Evaluate command `enabled` before running.

- [ ] **Step 5: Run the full TUI suite**

Run: `bun test test/tui-panel.test.tsx test/tui.test.tsx test/tui-boundary.test.ts test/tui-runtime.test.ts`

Expected: PASS. The boundary test must stay green; the panel may only use allowed client/server surfaces.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/tui.ts test/tui-panel.test.tsx
git commit -m "test: cover panel navigation and filters"
```

---

## Task 6: Documentation and verification

**Files:**

- Modify: `README.md`, `AGENTS.md`, `docs/v0.1.0-readiness.md`, `opencode-github-sidebar-plugin-research.md`, `CHANGELOG.md`, `package.json`
- Test: full suite, pack check, live E2E

- [ ] **Step 1: Document the panel and persistence**

In `README.md`:

- Change the status line to P1.
- Add a `## Session panel` section with the key map and `ctrl+shift+g`.
- Change `display.collapsed` to "Sections collapsed on first run; later changes are stored in TUI storage."
- Change the sidebar behavior bullet from "in memory for the TUI session" to "stored in TUI storage and shared across TUI instances."
- Remove "No panel" from limitations.
- Add `src/tui/panel.tsx` to the project layout.

In `AGENTS.md`:

- Record `session.panel`, the panel state lifecycle, the keymap layer, and persisted collapse.
- Note that the panel requests `summary({ full: true })` and the server cache owns full rows.
- Update the P0/P1 scope paragraph.

- [ ] **Step 2: Record the P1 decision in the research report**

Add a short "Implementation status" note under §12.7: the panel ships in 0.2.0 with full rows up to `fetchLimit`, mine/all filters, and no pagination/search yet.

- [ ] **Step 3: Bump the version and changelog**

`package.json`: `0.2.0`.

`CHANGELOG.md`: add `0.2.0` with the panel, persisted collapse, `summary.full`, and true-totals verification.

- [ ] **Step 4: Run the full verification**

```sh
bun run check
bun run audit
bun run pack:check
```

Expected: format, lint, typecheck, 225+ tests, audit, and pack assertions pass.

- [ ] **Step 5: Real OpenCode E2E**

Use a local-directory plugin target so the test exercises the new source without publishing:

```json
{
  "plugins": [
    {
      "package": "/home/leonidas/dev/nexusnv/opencode-nexusnv-github-sidebar",
      "options": { "actions": { "enabled": true } }
    }
  ]
}
```

Verify:

1. Sidebar header shows the panel affordance.
2. `ctrl+shift+g` opens the panel; `esc` closes it.
3. `j`/`k` moves the selection; `enter` launches the selected PR (worktree + session + context + focus).
4. `m`/`a` filters; `o` opens the canonical URL; `r` refreshes; `f` toggles fullscreen.
5. Collapse a section, quit OpenCode, restart with the same TUI storage, and confirm it stays collapsed.
6. `session.panel` renders nothing in a child session.

Capture a panel screenshot for `docs/panel.png` and link it from the README if it is representative.

- [ ] **Step 6: Commit**

```bash
git add README.md AGENTS.md docs/v0.1.0-readiness.md opencode-github-sidebar-plugin-research.md CHANGELOG.md package.json docs/panel.png
git commit -m "docs: announce the P1 workbench"
```

---

## Acceptance Criteria

- `summary({ force, full: true })` returns every row fetched under `fetchLimit`, with true totals.
- One GraphQL request feeds both sidebar and panel snapshots per cache TTL.
- The sidebar still renders only `pulls.limit` / `issues.limit` rows and `+ N more`.
- The panel renders all fetched rows, truncation text, mine/all filters, and keyboard navigation.
- Launching from the panel uses the same linked-session/worktree/context/focus path as the sidebar.
- Collapse survives a TUI restart and is seeded from `display.collapsed` only once.
- No TUI code uses forbidden client APIs; no token crosses RPC.
- `bun run check`, `bun run audit`, and `bun run pack:check` pass.
- A real OpenCode E2E proves the panel, keyboard actions, and persistence.
