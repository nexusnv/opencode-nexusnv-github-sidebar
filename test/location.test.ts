import { describe, expect, test } from "bun:test"
import { MissingLocationError, requireLocation, requireRpcLocation } from "../src/shared/location"

describe("requireLocation", () => {
  test("returns the project location", () => {
    const location = { directory: "/work/repo", workspaceID: "workspace" }

    expect(requireLocation({ location })).toBe(location)
  })

  test("fails instead of silently targeting the default location", () => {
    expect(() => requireLocation({ location: undefined })).toThrow(MissingLocationError)
  })

  test("rejects an empty directory", () => {
    expect(() => requireLocation({ location: { directory: "" } })).toThrow(MissingLocationError)
  })
})

describe("requireRpcLocation", () => {
  test("narrows runtime location data to the wire shape", () => {
    const location = { directory: "/work/repo", project: { id: "project" } }

    expect(requireRpcLocation({ location })).toEqual({ directory: "/work/repo" })
    expect(requireRpcLocation({ location })).not.toHaveProperty("project")
  })
})
