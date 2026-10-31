import { readFileSync, rmSync } from "node:fs"
import { $ } from "bun"

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  exports?: Record<string, string>
}

const targets = Object.entries(pkg.exports ?? {}).filter((entry): entry is [string, string] => {
  return typeof entry[1] === "string"
})

if (targets.length === 0) {
  throw new Error("package.json has no string exports")
}

const output = (await $`bun pm pack --quiet --ignore-scripts`.text()).trim()
const tarball = output.split("\n").filter(Boolean).at(-1)

if (!tarball || !tarball.endsWith(".tgz")) {
  throw new Error(`pack did not report a tarball: ${JSON.stringify(output)}`)
}

try {
  const listing = await $`tar -tzf ${tarball}`.text()
  const files = new Set(listing.split("\n").filter(Boolean))

  for (const [subpath, target] of targets) {
    const wanted = `package/${target.replace(/^\.\//, "")}`
    if (!files.has(wanted)) {
      throw new Error(`packed tarball is missing ${subpath}: ${wanted}`)
    }
  }

  for (const shim of ["index.ts", "tui.tsx", "rpc.ts"]) {
    if (!files.has(`package/${shim}`)) {
      throw new Error(`packed tarball is missing local-directory shim: package/${shim}`)
    }
  }

  if (!files.has("package/package.json")) {
    throw new Error("packed tarball is missing package/package.json")
  }

  const tui = await $`tar -xOzf ${tarball} package/dist/tui.js`.text()
  if (!tui.includes('from "@opentui/solid"')) {
    throw new Error("packed TUI entrypoint does not import the host @opentui/solid runtime")
  }
  if (tui.includes("@jsxImportSource")) {
    throw new Error("packed TUI entrypoint still contains uncompiled TSX")
  }

  console.log(`pack ok: ${targets.length} exports and 3 directory shims present`)
} finally {
  rmSync(tarball, { force: true })
}
