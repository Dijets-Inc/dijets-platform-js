// DIJETS: test fixture for the vendored upstream suite only (loaded through
// jest "setupFiles" for that project; never part of the library).
//
// The upstream tests were written against Avalanche's network 1337 with fixed
// chain and asset IDs, and their expected serialisations embed those IDs.
// Dijets has no fixed 1337 network (its devnets are discovered at runtime),
// so the same IDs are registered here as opaque fixtures. The aliases are
// the Dijets ones (V, M, U), which the tests now assert.
import BN from "bn.js"
import {
  registerNetwork,
  PlatformChainID,
  XChainAlias,
  PChainAlias,
  CChainAlias,
  XChainVMName,
  PChainVMName,
  CChainVMName,
  ONEAVAX,
  CENTIAVAX,
  MILLIAVAX,
  GWEI,
  type Network
} from "../../src/upstream/utils/constants"

const assetID = "BUuypiq2wyuLMvyhzFXcPyxPMCgSp7eeDohhQRqTChoBjKziC"
const X = {
  blockchainID: "qzfF3A11KzpcHkkqznEyQgupQrCNS6WV6fTUTwZpEKqhj1QE7",
  avaxAssetID: assetID,
  alias: XChainAlias,
  vm: XChainVMName,
  txFee: MILLIAVAX,
  creationTxFee: CENTIAVAX,
  mintTxFee: MILLIAVAX
}
const P = {
  blockchainID: PlatformChainID,
  avaxAssetID: assetID,
  alias: PChainAlias,
  vm: PChainVMName,
  txFee: MILLIAVAX,
  creationTxFee: CENTIAVAX,
  createSubnetTx: ONEAVAX,
  createChainTx: ONEAVAX,
  minConsumption: 0.1,
  maxConsumption: 0.12,
  maxStakingDuration: new BN(31536000),
  maxSupply: new BN(720000000).mul(ONEAVAX),
  minStake: ONEAVAX,
  minStakeDuration: 24 * 60 * 60,
  maxStakeDuration: 365 * 24 * 60 * 60,
  minDelegationStake: ONEAVAX,
  minDelegationFee: new BN(2)
}
const C = {
  blockchainID: "BR28ypgLATNS6PbtHMiJ7NQ61vfpT27Hj8tAcZ1AHsfU5cz88",
  avaxAssetID: assetID,
  alias: CChainAlias,
  vm: CChainVMName,
  txBytesGas: 1,
  costPerSignature: 1000,
  txFee: MILLIAVAX,
  gasPrice: GWEI.mul(new BN(225)),
  minGasPrice: GWEI.mul(new BN(25)),
  maxGasPrice: GWEI.mul(new BN(1000)),
  chainID: 43112
}
const network: Network = { hrp: "custom", X, P, C }
network[X.blockchainID] = X
network[P.blockchainID] = P
network[C.blockchainID] = C
registerNetwork(1337, network)
