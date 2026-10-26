import { $ } from "bun"

type Advisory = {
  severity: string
  title: string
  url: string
}

const result = await $`bun audit --json`.nothrow().quiet()
const output = result.stdout.toString()
const start = output.indexOf("{")

if (start === -1) {
  console.error("audit failed: could not parse bun audit output")
  console.error(output.trim())
  process.exit(1)
}

let report: Record<string, Advisory[]>
try {
  report = JSON.parse(output.slice(start)) as Record<string, Advisory[]>
} catch {
  console.error("audit failed: invalid JSON from bun audit")
  console.error(output.trim())
  process.exit(1)
}

const blocking = Object.entries(report).flatMap(([pkg, advisories]) =>
  advisories
    .filter((advisory) => advisory.severity === "high" || advisory.severity === "critical")
    .map((advisory) => ({ pkg, ...advisory })),
)

if (blocking.length > 0) {
  console.error(`audit failed: ${blocking.length} high/critical advisor${blocking.length === 1 ? "y" : "ies"}`)
  for (const advisory of blocking) {
    console.error(`- ${advisory.pkg}: ${advisory.severity} — ${advisory.title}`)
    console.error(`  ${advisory.url}`)
  }
  process.exit(1)
}

console.log("audit ok: no high/critical advisories")
