// PREPARE + OFFLINE SIGN, BROADCAST ONLY WHEN ASKED. A V-Chain transfer.
//   TO=V-local1… AMOUNT=1.5 npx tsx examples/10-transfer.ts            (prepare and sign only)
//   TO=V-local1… AMOUNT=1.5 BROADCAST=1 npx tsx examples/10-transfer.ts (also submit)
// Uses the test key, so it refuses public networks.
import BN from "bn.js"
import { parseDJT, parseAddress, formatDJT, utils } from "@dijets/platform-js"
import { connect, TEST_KEY } from "./_config"

async function main() {
  const client = await connect()
  if (client.networkID === 1 || client.networkID === 5) throw new Error("This sample uses a test key and does not run on mainnet or Lothar")
  const kc = client.vChain.keyChain()
  const from = kc.importKey(TEST_KEY).getAddressString()
  const to = process.env.TO ?? kc.makeKey().getAddressString()
  parseAddress(to, { chain: "V", hrp: client.hrp }) // refuse a wrong-chain or wrong-network recipient
  const amount = parseDJT(process.env.AMOUNT ?? "1")

  // 1. Prepare (reads UTXOs from the node).
  const { utxos } = await client.vChain.getUTXOs([from])
  const unsigned = await client.vChain.buildBaseTx(utxos, new BN(amount.toString()), await client.vChain.getDJTAssetID(), [to], [from], [from])
  console.log(`prepared: ${formatDJT(amount)} DJT ${from} → ${to}, fee ${formatDJT(client.network.fees.txFee)} DJT`)

  // 2. Sign locally. The signed bytes could be carried to another machine here.
  const signed = unsigned.sign(kc)
  const hex = signed.toBuffer().toString("hex")
  console.log("signed tx", hex.length / 2, "bytes")

  // 3. Broadcast only on request.
  if (process.env.BROADCAST !== "1") return console.log("not broadcast (set BROADCAST=1 to submit)")
  const txID = await client.vChain.issueTx(signed)
  for (;;) {
    const status = await client.vChain.getTxStatus(txID)
    console.log(txID, status)
    if (status === "Accepted" || status === "Rejected") break
    await new Promise((r) => setTimeout(r, 500))
  }
  void utils
}
main().catch((e) => { console.error(e.message); process.exit(1) })
