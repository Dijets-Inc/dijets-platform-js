// READ-ONLY. Balances and UTXOs on the V-Chain (DAG: UTXOs and acceptance, no block heights).
//   ADDRESS=V-local1… npx tsx examples/06-v-chain-utxos.ts
import { formatDJT } from "@dijets/platform-js"
import { connect, TEST_KEY } from "./_config"

async function main() {
  const client = await connect()
  const address = process.env.ADDRESS ?? client.vChain.keyChain().importKey(TEST_KEY).getAddressString()
  console.log(address, "holds", formatDJT(await client.vChain.getDJTBalance(address)), "DJT")
  const { utxos } = await client.vChain.getUTXOs([address])
  for (const u of utxos.getAllUTXOs().slice(0, 5)) {
    const out: any = u.getOutput()
    console.log(" UTXO", u.getUTXOID(), formatDJT(BigInt(out.getAmount().toString())), "DJT")
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
