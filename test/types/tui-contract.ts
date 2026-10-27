import type { Context } from "@opencode/plugin/tui/context"

declare const context: Context

// @ts-expect-error - the public TUI context must not expose the internal `.api` wrapper
void context.client.api

// @ts-expect-error - project is not part of the public TUI location contract
void context.location?.project

// @ts-expect-error - unknown theme tokens must not silently become `any`
void context.theme.text.thisDoesNotExist
