// READ-ONLY. Resolve a native name before paying it. Only an ACTIVE record resolves.
//   NAME=alice npx tsx examples/09-names.ts
import { canonicaliseName, DijetsNameError } from "@dijets/platform-js"
import { connect } from "./_config"

async function main() {
  const client = await connect()
  if (!(await client.names.isActive())) {
    console.log(`The name registry is not active on ${client.network.name}.`)
    return
  }
  const input = process.env.NAME ?? "alice"
  try {
    console.log("canonical:", canonicaliseName(input))
    const r = await client.names.resolve(input)
    console.log(r.name, r.status, r.record ? `→ ${r.record.target} (version ${r.record.version})` : "")
    const pay = await client.names.resolveForPayment(input, 600n)
    console.log(`pay ${pay.address} (record ${pay.recordID}, version ${pay.version}, at M-Chain height ${pay.at.height})`)
  } catch (e) {
    if (e instanceof DijetsNameError) console.log("cannot use this name:", e.message)
    else throw e
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
