// Checks the built package: both module formats load and expose the same
// API, declarations exist, and nothing machine-specific leaked into dist.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const fail = (m) => {
  console.error(`check-dist: ${m}`)
  process.exit(1)
}
const cjs = require("../dist/index.cjs")
const esm = await import("../dist/index.mjs")
for (const name of ["DijetsClient", "networks", "parseAddress", "canonicaliseName", "ArcsAPI", "vchain", "mchain", "uchain"]) {
  if (!cjs[name]) fail(`CommonJS build lacks ${name}`)
  if (!esm[name]) fail(`ESM build lacks ${name}`)
}
if (Object.keys(cjs).sort().join() !== Object.keys(esm).sort().join()) fail("CommonJS and ESM exports differ")
statSync("dist/index.d.ts")
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
for (const f of walk("dist")) {
  const text = readFileSync(f, "utf8")
  if (/\/Users\/|\/home\/[a-z]|[A-Z]:\\\\Users/.test(text.replace(/"sources(Content)?":\[[^\]]*\]/g, ""))) fail(`${f} contains a machine-specific path`)
  if (/X-Chain|P-Chain|C-Chain/.test(text) && f.endsWith(".d.ts")) console.warn(`check-dist: note: ${f} mentions upstream chain names (in vendored doc comments)`)
}
const client = new cjs.DijetsClient({ network: "local", url: "http://127.0.0.1:9650" })
if (client.vChain.getBlockchainID() !== cjs.LOCAL.chains.V.id) fail("client did not configure the V-Chain")
console.log(`check-dist: ok (${Object.keys(cjs).length} exports)`)
