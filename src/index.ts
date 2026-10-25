/**
 * @dijets/platform-js: the TypeScript library for Dijets nodes.
 *
 * Chains: V (AVM, DAG, UTXO), M (platform: validators, subnets, names, Arcs),
 * U (EVM). See README.md for the mapping to the upstream implementation.
 */

export { DijetsClient, type ClientOptions, type DiscoveryReport } from "./client"
export {
  networks,
  defineNetwork,
  withOverrides,
  requireValue,
  resolveNetwork,
  type NetworkName,
  type CustomNetworkInput
} from "./networks"
export {
  MAINNET,
  LOTHAR,
  LOCAL,
  PRESETS,
  Placeholder,
  placeholder,
  isPlaceholder,
  hrpForNetworkID,
  NETWORK_ID_TO_HRP,
  HRP_TO_NETWORK_ID,
  FALLBACK_HRP,
  M_CHAIN_ID,
  DJT,
  MILLI_DJT,
  MICRO_DJT,
  NANO_DJT,
  DJT_SYMBOL,
  DJT_DENOMINATION,
  type NetworkPreset,
  type Fees,
  type Staking,
  type Maybe
} from "./presets"
export * from "./errors"
export * from "./units"
export * from "./address"
export {
  VChainAPI,
  MChainAPI,
  UChainAPI,
  UChainEvm,
  ArcChainAPI,
  type VChain,
  type MChain,
  type UChain,
  type ArcChain
} from "./chains"
export { Transport, type TransportOptions } from "./rpc"
export type { InfoAPI } from "./upstream/apis/info/api"
export type { HealthAPI } from "./upstream/apis/health/api"
export type { IndexAPI } from "./upstream/apis/index/api"
export type { AdminAPI } from "./upstream/apis/admin/api"
export type { AuthAPI } from "./upstream/apis/auth/api"
export type { KeystoreAPI } from "./upstream/apis/keystore/api"
export * from "./names"
export * from "./arcs"
export { ExplorerClient, DijetsExplorerError, type ExplorerReply } from "./explorer"

/** Low-level protocol types (transactions, outputs, keychains, encoding), per chain. */
export * as vchain from "./protocol/vchain"
export * as mchain from "./protocol/mchain"
export * as uchain from "./protocol/uchain"
export * as common from "./protocol/common"
export * as utils from "./protocol/utils"
