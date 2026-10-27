/**
 * The TUI context exposes `location` as optional. Passing `undefined` to an RPC
 * can silently target the server's default location instead of the project the
 * sidebar is rendered for. Fail visibly rather than guessing.
 */
export class MissingLocationError extends Error {
  constructor() {
    super("OpenCode did not expose a project location; refusing to target the default location.")
    this.name = "MissingLocationError"
  }
}

export interface LocationLike {
  readonly directory: string
}

export interface LocationContext<Location extends LocationLike> {
  readonly location: Location | undefined
}

/** The wire shape accepted by the location-scoped RPC query. */
export interface RpcLocation {
  readonly directory: string
}

export function requireLocation<Location extends LocationLike>(context: LocationContext<Location>): Location {
  const location = context.location
  if (!location || !location.directory) throw new MissingLocationError()
  return location
}

/**
 * Narrow a runtime location to the RPC wire shape.
 *
 * The TUI type is `LocationRef`, but the runtime value is the server's full
 * location info (it may include `project`). Sending that object puts unrelated
 * project paths in the RPC query; reduce it to `{ directory }` deliberately.
 */
export function requireRpcLocation<Location extends LocationLike>(context: LocationContext<Location>): RpcLocation {
  return { directory: requireLocation(context).directory }
}
