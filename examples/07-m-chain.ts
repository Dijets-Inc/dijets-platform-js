// READ-ONLY. M-Chain: height, validators, staking parameters and subnets.
import { formatDJT } from "@dijets/platform-js"
import { connect } from "./_config"

async function main() {
  const client = await connect()
  console.log("M-Chain height", (await client.mChain.getHeight()).toString())
  const v: any = await client.mChain.getCurrentValidators()
  console.log(v.validators.length, "primary-network validators")
  const min: any = await client.mChain.getMinStake()
  console.log("min validator stake", formatDJT(BigInt(min.minValidatorStake.toString())), "DJT; min delegation", formatDJT(BigInt(min.minDelegatorStake.toString())), "DJT")
  console.log("current supply", formatDJT(BigInt((await client.mChain.getCurrentSupply()).toString())), "DJT")
  console.log((await client.mChain.getSubnets()).length, "subnets")
  console.log("Banff transactions accepted on this network:", client.network.features.banff)
}
main().catch((e) => { console.error(e.message); process.exit(1) })
