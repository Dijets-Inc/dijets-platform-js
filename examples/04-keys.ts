// OFFLINE. Import a key and create a new one. Keys never leave this process.
import { vchain } from "@dijets/platform-js"
import { TEST_KEY } from "./_config"

const kc = new vchain.KeyChain("local", "V")
const imported = kc.importKey(TEST_KEY)
console.log("imported test key →", imported.getAddressString())
const fresh = kc.makeKey()
console.log("new key           →", fresh.getAddressString())
// fresh.getPrivateKeyString() returns the secret; store it encrypted (see @dijets/wallet-sdk).
