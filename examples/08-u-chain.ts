// READ-ONLY. U-Chain through its EVM JSON-RPC, and an ethers provider for full EVM work.
import { ethers } from "ethers"
import { connect } from "./_config"

async function main() {
  const client = await connect()
  const evm = client.uChainEvm
  console.log("EVM chain ID", await evm.chainId(), "block", (await evm.blockNumber()).toString())
  console.log("base fee", (await evm.baseFee()).toString(), "wei")
  const who = process.env.EVM_ADDRESS ?? "0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC"
  console.log(who, "has", ethers.utils.formatEther((await evm.getBalance(who)).toString()), "DJT")
  const provider = new ethers.providers.StaticJsonRpcProvider(client.uChainRpcUrl, await evm.chainId())
  console.log("via ethers:", (await provider.getBlockNumber()).toString())
}
main().catch((e) => { console.error(e.message); process.exit(1) })
