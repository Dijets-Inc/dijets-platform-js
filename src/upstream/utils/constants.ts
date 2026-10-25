/**
 * @packageDocumentation
 * @module Utils-Constants
 */

import BN from "bn.js"
// DIJETS: everything from here to the merge rules is generated from
// src/presets.ts, the single source of network constants. Upstream's
// Avalanche tables (networks 0–5, 1337, 12345) are gone: Dijets reuses
// network IDs 1, 5 and 12345 with different chains and assets. The internal
// keys X, P and C are kept because upstream code indexes by them; their
// aliases are the Dijets chain names V, M and U.
import {
  PRESETS,
  NETWORK_ID_TO_HRP,
  HRP_TO_NETWORK_ID,
  FALLBACK_HRP,
  M_CHAIN_ID,
  DJT_SYMBOL,
  isPlaceholder,
  type NetworkPreset
} from "../../presets"

export const PrivateKeyPrefix: string = "PrivateKey-"
export const NodeIDPrefix: string = "NodeID-"
// DIJETS: the AVM genesis registers the native asset under the alias "DJT".
export const PrimaryAssetAlias: string = DJT_SYMBOL

export interface C {
  blockchainID: string
  alias: string
  vm: string
  fee?: BN
  gasPrice: BN | number
  chainID?: number
  minGasPrice?: BN
  maxGasPrice?: BN
  txBytesGas?: number
  costPerSignature?: number
  txFee?: BN
  avaxAssetID?: string
}
export interface X {
  blockchainID: string
  alias: string
  vm: string
  creationTxFee: BN | number
  mintTxFee: BN
  avaxAssetID?: string
  txFee?: BN | number
  fee?: BN
}
export interface P {
  blockchainID: string
  alias: string
  vm: string
  creationTxFee: BN | number
  createSubnetTx: BN | number
  createChainTx: BN | number
  minConsumption: number
  maxConsumption: number
  maxStakingDuration: BN
  maxSupply: BN
  minStake: BN
  minStakeDuration: number
  maxStakeDuration: number
  minDelegationStake: BN
  minDelegationFee: BN
  avaxAssetID?: string
  txFee?: BN | number
  fee?: BN
}
export interface Network {
  C: C
  hrp: string
  X: X
  P: P
  [key: string]: C | X | P | string
}
export interface Networks {
  [key: number]: Network
}

export const NetworkIDToHRP: object = { ...NETWORK_ID_TO_HRP }
export const HRPToNetworkID: object = { ...HRP_TO_NETWORK_ID }

export const NetworkIDToNetworkNames: object = Object.fromEntries(
  PRESETS.map((p) => [p.networkID, [p.name]])
)
export const NetworkNameToNetworkID: object = Object.fromEntries(
  PRESETS.map((p) => [p.name, p.networkID])
)

export const FallbackHRP: string = FALLBACK_HRP
export const FallbackNetworkName: string = "Custom Network"
export const FallbackEVMChainID: number = 43112

export const DefaultNetworkID: number = 1

export const PlatformChainID: string = M_CHAIN_ID
export const PrimaryNetworkID: string = M_CHAIN_ID
export const XChainAlias: string = "V"
export const CChainAlias: string = "U"
export const PChainAlias: string = "M"
export const XChainVMName: string = "avm"
export const CChainVMName: string = "evm"
export const PChainVMName: string = "platformvm"

// Funded only in the local network's genesis. Never use on a public network.
export const DefaultLocalGenesisPrivateKey: string =
  "ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN"
export const DefaultEVMLocalGenesisPrivateKey: string =
  "0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027"
export const DefaultEVMLocalGenesisAddress: string =
  "0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC"
export const mnemonic: string =
  "output tooth keep tooth bracket fox city sustain blood raise install pond stem reject long scene clap gloom purpose mean music piece unknown light"

// Upstream unit names are kept internally; the public API uses DJT units.
export const ONEAVAX: BN = new BN(1000000000)

export const DECIAVAX: BN = ONEAVAX.div(new BN(10))

export const CENTIAVAX: BN = ONEAVAX.div(new BN(100))

export const MILLIAVAX: BN = ONEAVAX.div(new BN(1000))

export const MICROAVAX: BN = ONEAVAX.div(new BN(1000000))

export const NANOAVAX: BN = ONEAVAX.div(new BN(1000000000))

export const WEI: BN = new BN(1)

export const GWEI: BN = WEI.mul(new BN(1000000000))

export const AVAXGWEI: BN = NANOAVAX.clone()

export const AVAXSTAKECAP: BN = ONEAVAX.mul(new BN(3000000))

const bn = (v: bigint | number): BN => new BN(v.toString())
const known = (v: unknown): string => (isPlaceholder(v) ? "" : (v as string))

/** Builds the upstream-shaped entry for a Dijets network. */
export function toUpstreamNetwork(p: NetworkPreset): Network {
  const djt = known(p.djtAssetID)
  const x: X = {
    blockchainID: known(p.chains.V.id),
    alias: XChainAlias,
    vm: XChainVMName,
    txFee: bn(p.fees.txFee),
    creationTxFee: bn(p.fees.createAssetTxFee),
    mintTxFee: bn(p.fees.txFee),
    avaxAssetID: djt
  }
  const pc: P = {
    blockchainID: p.chains.M.id,
    alias: PChainAlias,
    vm: PChainVMName,
    txFee: bn(p.fees.txFee),
    creationTxFee: bn(p.fees.createAssetTxFee),
    createSubnetTx: bn(p.fees.createSubnetTxFee),
    createChainTx: bn(p.fees.createBlockchainTxFee),
    minConsumption: p.staking.minConsumptionRate,
    maxConsumption: p.staking.maxConsumptionRate,
    maxStakingDuration: new BN(p.staking.maxStakeDuration),
    maxSupply: bn(p.staking.supplyCap),
    minStake: bn(p.staking.minValidatorStake),
    minStakeDuration: p.staking.minStakeDuration,
    maxStakeDuration: p.staking.maxStakeDuration,
    minDelegationStake: bn(p.staking.minDelegatorStake),
    // upstream expresses this in percent; the node in parts per million
    minDelegationFee: new BN(p.staking.minDelegationFee / 10_000),
    avaxAssetID: djt
  }
  const c: C = {
    blockchainID: known(p.chains.U.id),
    alias: CChainAlias,
    vm: CChainVMName,
    // coreth: AtomicTxBaseCost-era gas accounting, unchanged in Dijets
    txBytesGas: 1,
    costPerSignature: 1000,
    txFee: MILLIAVAX,
    // coreth params/dijets_params.go: Apricot phase 1 price and phase 4 base-fee bounds
    gasPrice: GWEI.mul(new BN(225)),
    minGasPrice: GWEI.mul(new BN(25)),
    maxGasPrice: GWEI.mul(new BN(1000)),
    chainID: isPlaceholder(p.chains.U.evmChainID) ? undefined : (p.chains.U.evmChainID as number),
    avaxAssetID: djt
  }
  const n: Network = { hrp: p.hrp, X: x, P: pc, C: c }
  if (x.blockchainID) n[x.blockchainID] = x
  n[pc.blockchainID] = pc
  if (c.blockchainID) n[c.blockchainID] = c
  return n
}

export class Defaults {
  static network: Networks = Object.fromEntries(
    PRESETS.map((p) => [p.networkID, toUpstreamNetwork(p)])
  )
}

/**
 * Installs (or replaces) the entry for one network. The Dijets client calls
 * this after confirming chain and asset IDs with the node, so that upstream
 * code which reads `Defaults.network` directly sees the network it is
 * actually talking to.
 */
export function registerNetwork(networkID: number, network: Network): void {
  Defaults.network[networkID] = network
}

/**
 * Rules used when merging sets
 */
export type MergeRule =
  | "intersection" // Self INTERSECT New
  | "differenceSelf" // Self MINUS New
  | "differenceNew" // New MINUS Self
  | "symDifference" // differenceSelf UNION differenceNew
  | "union" // Self UNION New
  | "unionMinusNew" // union MINUS differenceNew
  | "unionMinusSelf" // union MINUS differenceSelf
  | "ERROR" // generate error for testing
