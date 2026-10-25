// OFFLINE. The network presets, and which values are still placeholders.
import { networks, isPlaceholder, formatDJT } from "@dijets/platform-js"

for (const p of Object.values(networks)) {
  const show = (v: unknown) => (isPlaceholder(v) ? `(placeholder: ${v.what})` : String(v))
  console.log(`${p.name}: network ${p.networkID}, HRP "${p.hrp}"`)
  console.log(`  node      ${show(p.endpoints.node)}`)
  console.log(`  V-Chain   ${show(p.chains.V.id)}`)
  console.log(`  U-Chain   ${show(p.chains.U.id)} (EVM chain ${show(p.chains.U.evmChainID)})`)
  console.log(`  DJT asset ${show(p.djtAssetID)}`)
  console.log(`  tx fee ${formatDJT(p.fees.txFee)} DJT · min validator stake ${formatDJT(p.staking.minValidatorStake)} DJT`)
  console.log(`  Banff ${p.features.banff ? "active" : "not active"} · naming ${p.features.naming ? "active" : "not active"}`)
}
