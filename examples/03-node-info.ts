// READ-ONLY. Node health and network information.
import { connect } from "./_config"

async function main() {
  const client = await connect()
  console.log("node ID      ", await client.info.getNodeID())
  console.log("network name ", await client.info.getNetworkName())
  for (const chain of ["V", "M", "U"]) console.log(`${chain}-Chain       `, await client.info.getBlockchainID(chain), (await client.info.isBootstrapped(chain)) ? "bootstrapped" : "bootstrapping")
  const health: any = await client.health.health()
  console.log("healthy      ", health.healthy)
  console.log("peers        ", (await client.info.peers()).length)
}
main().catch((e) => { console.error(e.message); process.exit(1) })
