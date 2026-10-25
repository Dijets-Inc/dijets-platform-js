// READ-ONLY. Connect to any reachable Dijets node and check it is the network you expect.
//   DIJETS_NODE_URL=https://your-node:9650 DIJETS_NETWORK=mainnet npx tsx examples/01-connect.ts
import { DijetsClient } from "@dijets/platform-js"
import { clientOptions } from "./_config"

async function main() {
  const client = new DijetsClient(clientOptions()) // no network calls yet
  const report = await client.discover() // checks network ID, chain IDs, asset, EVM chain ID
  console.log(`Connected to ${client.network.name} (network ${report.networkID}), node ${report.nodeVersion}`)
  if (report.filled.length) console.log("Read from the node:", report.filled.join(", "))
  for (const d of report.differences) console.log(`Node differs from preset: ${d.field} ${d.preset} → ${d.node}`)
}
main().catch((e) => { console.error(e.message); process.exit(1) })
