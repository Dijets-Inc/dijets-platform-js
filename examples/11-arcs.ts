// READ-ONLY. Discover Arcs and their status. Registration is authoritative;
// health is this node's observation and is "unknown" if the node does not track the Arc.
import { assessHealth } from "@dijets/platform-js"
import { connect } from "./_config"

async function main() {
  const client = await connect()
  const page = await client.arcs.list({ limit: 25 })
  console.log(`${page.counts.registered} Arcs registered on the M-Chain (height ${page.mChainHeight}); this node tracks ${page.counts.tracked}`)
  for (const { descriptor: d, observation: o } of page.chains) {
    console.log(`- ${d.name} ${d.id}`)
    console.log(`  ${d.vmName}, ${d.validators.currentCount} committee members (${d.validatorPolicy.profile}, ${d.validatorPolicy.enforcement})`)
    console.log(`  health here: ${assessHealth(o)} (${o.lifecycle}${o.reasons.length ? `: ${o.reasons.join(", ")}` : ""})`)
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
