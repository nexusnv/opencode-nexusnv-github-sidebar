/**
 * Local-directory entrypoint.
 *
 * The host probes `<dir>/server` before `<dir>/index` for directory targets,
 * while package targets use the `exports` map. Keep this thin shim so both
 * paths load the same plugin.
 */
export { default } from "./src/index.js"
export * from "./src/index.js"
