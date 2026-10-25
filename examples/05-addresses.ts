// OFFLINE. Derive, convert and validate addresses: chain and network are checked separately.
import { parseAddress, toChain, isValidAddress, isEvmAddress, evmAddressFromPublicKey, vchain } from "@dijets/platform-js"
import { TEST_KEY } from "./_config"

const key = new vchain.KeyChain("dijets", "V").importKey(TEST_KEY)
const v = key.getAddressString()
console.log("V-Chain:", v)
console.log("M-Chain:", toChain(v, "M"), "(same key, same body)")
console.log("U-Chain (EVM):", evmAddressFromPublicKey(key.getPublicKey()))
console.log(parseAddress(v, { chain: "V", hrp: "dijets" }))
console.log("valid on Lothar?", isValidAddress(v, { hrp: "lothar" }))
try {
  parseAddress(v, { chain: "M" })
} catch (e) {
  console.log("as M-Chain:", (e as Error).message)
}
console.log("0x8db9…52FC is an EVM address:", isEvmAddress("0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC"))
