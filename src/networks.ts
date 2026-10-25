/**
 * Network selection. Presets live in presets.ts; this module adds custom
 * networks and the checks that turn placeholders into clear errors.
 */
import { DijetsConfigError } from "./errors"
import {
  LOCAL,
  LOTHAR,
  MAINNET,
  M_CHAIN_ID,
  hrpForNetworkID,
  isPlaceholder,
  parametersForNetworkID,
  placeholder,
  type Fees,
  type Maybe,
  type NetworkPreset,
  type Staking
} from "./presets"

export type NetworkName = "mainnet" | "lothar" | "local"

/** The presets shipped with the library. */
export const networks: Readonly<Record<NetworkName, NetworkPreset>> = {
  mainnet: MAINNET,
  lothar: LOTHAR,
  local: LOCAL
}

export interface CustomNetworkInput {
  networkID: number
  /** Short key, e.g. "azure-devnet". Defaults to "network-<id>". */
  key?: string
  name?: string
  /** Defaults to the node's HRP for this network ID ("custom" for unnamed IDs). */
  hrp?: string
  nodeUrl: string
  explorerUrl?: string
  chains?: {
    V?: { id: string }
    U?: { id?: string; evmChainID?: number }
  }
  djtAssetID?: string
  fees?: Partial<Fees>
  staking?: Partial<Staking>
  features?: Partial<NetworkPreset["features"]>
}

const discovered = (what: string) =>
  placeholder(what, "connect() reads it from the node; or pass it in defineNetwork()")

/**
 * Describes a network that is not a preset, such as a devnet. Chain and asset
 * IDs you leave out are read from the node by `connect()`. Fees and staking
 * parameters default to what the node itself uses for an unnamed network ID:
 * the local network's (dijetsnodesgo genesis/params.go). Banff and naming are
 * active on every network except Lothar.
 */
export function defineNetwork(input: CustomNetworkInput): NetworkPreset {
  const base = parametersForNetworkID(input.networkID)
  const gated = input.networkID === LOTHAR.networkID
  return {
    key: input.key ?? `network-${input.networkID}`,
    name: input.name ?? `Dijets network ${input.networkID}`,
    networkID: input.networkID,
    hrp: input.hrp ?? hrpForNetworkID(input.networkID),
    endpoints: { node: input.nodeUrl, explorer: input.explorerUrl },
    chains: {
      M: { id: M_CHAIN_ID },
      V: { id: input.chains?.V?.id ?? discovered("V-Chain blockchain ID") },
      U: {
        id: input.chains?.U?.id ?? discovered("U-Chain blockchain ID"),
        evmChainID: input.chains?.U?.evmChainID ?? discovered("U-Chain EVM chain ID")
      }
    },
    djtAssetID: input.djtAssetID ?? discovered("DJT asset ID"),
    fees: { ...base.fees, ...input.fees },
    staking: { ...base.staking, ...input.staking },
    features: { banff: !gated, naming: !gated, ...input.features },
    source: "defineNetwork(); unspecified IDs are discovered from the node"
  }
}

/** A copy of a preset with some values replaced, e.g. to supply the mainnet node URL. */
export function withOverrides(
  preset: NetworkPreset,
  overrides: {
    nodeUrl?: string
    explorerUrl?: string
    chains?: { V?: { id: string }; U?: { id?: string; evmChainID?: number } }
    djtAssetID?: string
  }
): NetworkPreset {
  return {
    ...preset,
    endpoints: {
      node: overrides.nodeUrl ?? preset.endpoints.node,
      explorer: overrides.explorerUrl ?? preset.endpoints.explorer
    },
    chains: {
      M: preset.chains.M,
      V: { id: overrides.chains?.V?.id ?? preset.chains.V.id },
      U: {
        id: overrides.chains?.U?.id ?? preset.chains.U.id,
        evmChainID: overrides.chains?.U?.evmChainID ?? preset.chains.U.evmChainID
      }
    },
    djtAssetID: overrides.djtAssetID ?? preset.djtAssetID
  }
}

/** Returns the value, or throws a `DijetsConfigError` naming what is missing and how to set it. */
export function requireValue<T>(value: Maybe<T> | undefined, what: string): T {
  if (value === undefined) throw new DijetsConfigError(`${what} is not configured`)
  if (isPlaceholder(value)) {
    throw new DijetsConfigError(`${value.what} is not configured (placeholder): ${value.howToSet}`)
  }
  return value
}

export const resolveNetwork = (network: NetworkName | NetworkPreset): NetworkPreset => {
  if (typeof network !== "string") return network
  const preset = networks[network]
  if (!preset) {
    throw new DijetsConfigError(
      `Unknown network "${network}". Use "mainnet", "lothar", "local", or defineNetwork({...}).`
    )
  }
  return preset
}
