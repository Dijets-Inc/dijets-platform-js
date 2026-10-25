/**
 * Network presets: the one place where Dijets network constants live.
 *
 * Every value here was taken from the node implementation (dijetsnodesgo,
 * genesis/genesis_{mainnet,lothar,local}.go, utils/constants/network_ids.go,
 * genesis/aliases.go) or computed from its genesis. Values that are not
 * confirmed are `placeholder(...)`s: they throw a descriptive error when used,
 * and `connect()` fills chain and asset IDs in from the node itself.
 *
 * This module has no imports so that both the public API and the vendored
 * upstream code can build on it without a cycle.
 */

/** A value that has not been confirmed. Using it throws a `DijetsConfigError`. */
export class Placeholder {
  readonly placeholder = true
  constructor(
    /** What the value is, e.g. "mainnet node URL". */
    readonly what: string,
    /** How to supply it. */
    readonly howToSet: string
  ) {}
  toString(): string {
    return `<placeholder: ${this.what}>`
  }
}

export const placeholder = (what: string, howToSet: string): Placeholder =>
  new Placeholder(what, howToSet)

export const isPlaceholder = (v: unknown): v is Placeholder =>
  v instanceof Placeholder

export type Maybe<T> = T | Placeholder

/** nano-DJT per DJT. V- and M-Chain amounts are in nDJT (9 decimals). */
export const DJT = 1_000_000_000n
export const MILLI_DJT = 1_000_000n
export const MICRO_DJT = 1_000n
export const NANO_DJT = 1n
/** On the U-Chain, DJT has 18 decimals like ether: 1 nDJT = 1 gwei. */
export const WEI_PER_NDJT = 1_000_000_000n

export const M_CHAIN_ID = "11111111111111111111111111111111LpoYY"
export const DJT_SYMBOL = "DJT"
export const DJT_DENOMINATION = 9

export interface Fees {
  /** Base fee for V- and M-Chain transactions (nDJT). */
  txFee: bigint
  createAssetTxFee: bigint
  createSubnetTxFee: bigint
  transformSubnetTxFee: bigint
  createBlockchainTxFee: bigint
  addPrimaryNetworkValidatorFee: bigint
  addPrimaryNetworkDelegatorFee: bigint
  addSubnetValidatorFee: bigint
  addSubnetDelegatorFee: bigint
}

export interface Staking {
  minValidatorStake: bigint
  maxValidatorStake: bigint
  minDelegatorStake: bigint
  /** Parts per million: 20000 = 2%. */
  minDelegationFee: number
  /** Seconds. */
  minStakeDuration: number
  maxStakeDuration: number
  supplyCap: bigint
  /** Reward consumption rates, fractions of 1. */
  minConsumptionRate: number
  maxConsumptionRate: number
}

export interface NetworkPreset {
  /** Short key: "mainnet", "lothar", "local", or a custom name. */
  key: string
  name: string
  networkID: number
  /** Bech32 human-readable part, the network context of every address. */
  hrp: string
  endpoints: {
    /** Base URL of a node exposing the /ext APIs, e.g. "https://host:9650". */
    node: Maybe<string>
    /** Base URL of a Dijets explorer exposing /api/v1, if one is used. */
    explorer?: Maybe<string>
  }
  chains: {
    M: { id: string }
    V: { id: Maybe<string> }
    U: { id: Maybe<string>; evmChainID: Maybe<number> }
  }
  djtAssetID: Maybe<string>
  fees: Fees
  staking: Staking
  features: {
    /** Banff M-Chain transaction types are accepted. False on Lothar. */
    banff: boolean
    /** The native name registry is active. False on Lothar. */
    naming: boolean
  }
  /** Where the values came from. */
  source: string
}

const day = 24 * 60 * 60

export const MAINNET: NetworkPreset = {
  key: "mainnet",
  name: "Dijets Mainnet",
  networkID: 1,
  hrp: "dijets",
  endpoints: {
    node: placeholder(
      "mainnet node URL",
      'pass { url: "https://your-node" } or set endpoints.node in a custom preset'
    )
  },
  chains: {
    M: { id: M_CHAIN_ID },
    V: { id: "2abk8oCqF74M1L2UhsPGe1MMXoEkRVubGZxV1Nfn7aF5s5T8fM" },
    U: { id: "vWaU1HuvgqAQ9KkKSh5ThrxXvSCZ2ZDK1k8zeg2innRv2SdrN", evmChainID: 98200 }
  },
  djtAssetID: "2U4xzjHGnxXKWzFKqVZVMEnnepKFRNcBC75346X129Nj7uzyP1",
  fees: {
    txFee: MILLI_DJT,
    createAssetTxFee: 10n * MILLI_DJT,
    createSubnetTxFee: DJT,
    transformSubnetTxFee: DJT,
    createBlockchainTxFee: DJT,
    addPrimaryNetworkValidatorFee: 0n,
    addPrimaryNetworkDelegatorFee: 0n,
    addSubnetValidatorFee: MILLI_DJT,
    addSubnetDelegatorFee: MILLI_DJT
  },
  staking: {
    minValidatorStake: 2_000n * DJT,
    maxValidatorStake: 3_000_000n * DJT,
    minDelegatorStake: 25n * DJT,
    minDelegationFee: 20_000,
    minStakeDuration: 14 * day,
    maxStakeDuration: 365 * day,
    supplyCap: 111_111_111n * DJT,
    minConsumptionRate: 0.1,
    maxConsumptionRate: 0.12
  },
  features: { banff: true, naming: true },
  source:
    "dijetsnodesgo 1.0.0 genesis/genesis_mainnet.go (genesis of 2026-10-25); IDs computed from genesis and checked against a node"
}

export const LOTHAR: NetworkPreset = {
  key: "lothar",
  name: "Dijets Lothar Testnet",
  networkID: 5,
  hrp: "lothar",
  endpoints: {
    node: placeholder(
      "Lothar node URL",
      'pass { url: "https://your-node" } or set endpoints.node in a custom preset'
    )
  },
  chains: {
    M: { id: M_CHAIN_ID },
    V: { id: "2NZ41DrsnFvri1mjj7mw494bsu3LWLtzHHGmkmq5LJyPX8bzZE" },
    U: { id: "2FXwKL6ioNTtTn7qMVBm3YVRvdEGAJv1e1uaKMF8UzLNuy5caK", evmChainID: 381932 }
  },
  djtAssetID: "2NVTQnV6wqocU9MffGLP9HhAvnjy55MxnDJSEjLZLXMPyzN5Z6",
  fees: {
    txFee: MILLI_DJT,
    createAssetTxFee: 10n * MILLI_DJT,
    createSubnetTxFee: 100n * MILLI_DJT,
    transformSubnetTxFee: 100n * MILLI_DJT,
    createBlockchainTxFee: 100n * MILLI_DJT,
    addPrimaryNetworkValidatorFee: 0n,
    addPrimaryNetworkDelegatorFee: 0n,
    addSubnetValidatorFee: MILLI_DJT,
    addSubnetDelegatorFee: MILLI_DJT
  },
  staking: {
    minValidatorStake: DJT,
    maxValidatorStake: 3_000_000n * DJT,
    minDelegatorStake: DJT,
    minDelegationFee: 20_000,
    minStakeDuration: day,
    maxStakeDuration: 365 * day,
    supplyCap: 666_666_666n * DJT,
    minConsumptionRate: 0.1,
    maxConsumptionRate: 0.12
  },
  features: { banff: false, naming: false },
  source:
    "dijetsnodesgo genesis/genesis_lothar.go; IDs computed from genesis, not yet confirmed against a live Lothar node"
}

export const LOCAL: NetworkPreset = {
  key: "local",
  name: "Dijets Local Network",
  networkID: 12345,
  hrp: "local",
  endpoints: { node: "http://127.0.0.1:9650" },
  chains: {
    M: { id: M_CHAIN_ID },
    V: { id: "25h261N5gt1J4jun7vWbuTsRWgUzAxHRXvLuzQXD3yJiTwyhn9" },
    U: { id: "296U3EP4ix4MGPjehERz3rbW2BgwkQeXmyomhGC9sBecF6fezz", evmChainID: 43112 }
  },
  djtAssetID: "iM8M9EHTy8hdqmGzt6R1Lf76VwNDJpnjT46Za6VsTnL6NaLdr",
  fees: {
    txFee: MILLI_DJT,
    createAssetTxFee: MILLI_DJT,
    createSubnetTxFee: 100n * MILLI_DJT,
    transformSubnetTxFee: 100n * MILLI_DJT,
    createBlockchainTxFee: 100n * MILLI_DJT,
    addPrimaryNetworkValidatorFee: 0n,
    addPrimaryNetworkDelegatorFee: 0n,
    addSubnetValidatorFee: MILLI_DJT,
    addSubnetDelegatorFee: MILLI_DJT
  },
  staking: {
    minValidatorStake: 2_000n * DJT,
    maxValidatorStake: 3_000_000n * DJT,
    minDelegatorStake: 25n * DJT,
    minDelegationFee: 20_000,
    minStakeDuration: day,
    maxStakeDuration: 365 * day,
    supplyCap: 720_000_000n * DJT,
    minConsumptionRate: 0.1,
    maxConsumptionRate: 0.12
  },
  features: { banff: true, naming: true },
  source: "dijetsnodesgo genesis/genesis_local.go; IDs computed from genesis"
}

/** The presets shipped with the library, by network ID. */
export const PRESETS: readonly NetworkPreset[] = [MAINNET, LOTHAR, LOCAL]

/**
 * Bech32 HRP for every network ID the node names (utils/constants/network_ids.go).
 * Any other network ID uses "custom".
 */
export const NETWORK_ID_TO_HRP: Readonly<Record<number, string>> = {
  1: "dijets",
  5: "lothar",
  10: "testing",
  12345: "local"
}
export const FALLBACK_HRP = "custom"

export const HRP_TO_NETWORK_ID: Readonly<Record<string, number>> = {
  dijets: 1,
  lothar: 5,
  testing: 10,
  local: 12345
}

export const hrpForNetworkID = (networkID: number): string =>
  NETWORK_ID_TO_HRP[networkID] ?? FALLBACK_HRP

/** Network IDs that the node gives no name to fall back to the local network's parameters (genesis/params.go). */
export const parametersForNetworkID = (networkID: number): NetworkPreset =>
  PRESETS.find((p) => p.networkID === networkID) ?? LOCAL
