/**
 * Arcs: application chains, each an AVM chain on its own permissioned subnet,
 * created and administered with ordinary signed M-Chain transactions
 * (CreateSubnetTx, AddSubnetValidatorTx, CreateChainTx).
 *
 * This is the node's read-only arc service, `arc.*` at /ext/bc/M/arc
 * (dijetsnodesgo docs/arcs/03-api-and-explorer-contract.md, API v1). Two kinds
 * of data come back, and the types keep them apart:
 *
 * - authoritative: the descriptor and committee membership, the same on every
 *   bootstrapped node at the same `mChainHeight`;
 * - local observations: lifecycle, health, connectivity, stats and events,
 *   as seen by the answering node (`observerNode`, `observedAt`).
 *
 * Unknown lifecycle values, reasons and stale observations must be treated
 * as "unknown", never as healthy; `assessHealth` applies those rules.
 */
import { DijetsRpcError, DijetsUnsupportedError } from "./errors"
import type { Transport } from "./rpc"

const PATH = "/ext/bc/M/arc"

export const ARC_LIFECYCLES = [
  "PENDING",
  "INITIALISING",
  "ACTIVE",
  "DEGRADED",
  "STOPPING",
  "STOPPED",
  "FAILED",
  "UNKNOWN"
] as const
export type ArcLifecycle = (typeof ARC_LIFECYCLES)[number]

export interface ArcOwner {
  threshold: number
  locktime: number
  /** M-Chain addresses. */
  addresses: string[]
}

export interface ArcValidatorPolicy {
  /** Only "permissioned_committee" is operational. */
  profile: string
  /** "consensus" when enforced by the subnet validator set; anything else must be shown. */
  enforcement: string
  params: { minCommitteeSize?: number; minConnectedWeight?: number; [k: string]: unknown }
  provides: string[]
}

/** Authoritative: derived from committed M-Chain state. */
export interface ArcDescriptor {
  schemaVersion: number
  protocolVersion: string
  metadataVersion: number
  /** The Arc's chain ID: its identity. Names are not unique. */
  id: string
  name: string
  subnetID: string
  networkID: number
  vmID: string
  vmName: string
  fxIDs: string[]
  genesisHash: string
  genesisSize: number
  owner: ArcOwner
  createdBy: { chainTxID: string; subnetTxID: string }
  /** Not recorded in authoritative state; always null in API v1. */
  createdAt: string | null
  validatorPolicy: ArcValidatorPolicy
  validators: { currentCount: number; pendingCount: number; currentWeight: number | string; source: string }
  subnetChainCount: number
  /** Paths on the answering node, listed only if it serves the chain. */
  rpcEndpoints: string[]
  explorerURL: string | null
  privacyMode: string
  capabilities: string[]
  registration: { status: string; authority: string; observedAtMChainHeight: number }
  unavailable?: Record<string, string>
  [k: string]: unknown
}

/** Local observation by the answering node. */
export interface ArcObservation {
  lifecycle: ArcLifecycle | string
  registered: boolean
  operational: boolean
  healthy: boolean
  reasons: string[]
  trackedByNode: boolean
  observedAt: string
  observerNode: string
  source: "local-observation" | string
  [k: string]: unknown
}

export interface ArcEntry {
  descriptor: ArcDescriptor
  observation: ArcObservation
}

export interface ArcListFilter {
  lifecycle?: ArcLifecycle
  /** Owner address, with or without the M- prefix. */
  owner?: string
  vmID?: string
  profile?: string
  subnetID?: string
  name?: string
  cursor?: string
  /** ≤ 100. */
  limit?: number
}

export interface ArcListPage {
  chains: ArcEntry[]
  /** "" on the last page. */
  nextCursor: string
  counts: {
    registered: number
    tracked: number
    operational: number
    healthy: number
    byLifecycle: Record<string, number>
    matched: number
  }
  mChainHeight: number
  observedAt: string
  observerNode: string
}

export interface ArcCommitteeMember {
  nodeID: string
  txID: string
  weight: string
  startTime: string
  endTime: string
  /** Authoritative. */
  membershipStatus: "current" | "pending" | string
  /** Observed; null unless the answering node tracks the subnet. */
  connected: boolean | null
  uptimePercent: number | null
}

export interface ArcValidators {
  chainID: string
  subnetID: string
  validatorPolicy: ArcValidatorPolicy
  members: ArcCommitteeMember[]
  summary: Record<string, unknown>
  reasons: string[]
  membershipSource: string
  connectivitySource: string
  mChainHeight: number
  observedAt: string
  observerNode: string
}

export interface ArcStats {
  chainID: string
  source: string
  observedSince: string | null
  observedAt: string
  observerNode: string
  acceptedTxs: string | null
  acceptedContainers: string | null
  lastAcceptedAt: string | null
  lastAcceptedContainerID: string | null
  /** Always null: a DAG chain has no linear height. */
  height: null
  createdAt: string | null
  unavailable?: Record<string, string>
}

export interface ArcHealth {
  chainID: string
  observation: ArcObservation
  engine: { checked: boolean; healthy: boolean | null; checkedAt: string | null }
  committee: Record<string, unknown>
  params: Record<string, unknown>
  dependencies: { mChainBootstrapped: boolean; observerLastPoll: string | null }
}

export type ArcCreationStage =
  | "UNKNOWN"
  | "SUBNET_PENDING_ACCEPTANCE"
  | "SUBNET_REJECTED"
  | "SUBNET_REGISTERED"
  | "CHAIN_PENDING_ACCEPTANCE"
  | "CHAIN_REJECTED"
  | "REGISTERED"

export interface ArcCreationStatus {
  stage: ArcCreationStage | string
  subnet: { txID: string; status: string } | null
  chain: { txID: string; status: string } | null
  validators: { txID: string; status: string }[]
  observation: ArcObservation | null
}

export interface ArcEvent {
  schemaVersion: number
  id: string
  seq: number
  bootID: string
  type: string
  chainID: string
  subnetID: string
  from: string
  to: string
  reasons: string[]
  observedAt: string
  observerNode: string
  source: string
  authoritative: boolean
}

export interface ArcEventsPage {
  bootID: string
  nextCursor: number
  oldestSeq: number
  /** True when events were dropped; resynchronise from `list()`. */
  truncated: boolean
  observerNode: string
  events: ArcEvent[]
}

/** Reasons the node reports through `data.reason`. */
export type ArcErrorReason = "not_found" | "not_an_arc" | "too_many_concurrent_requests" | string

export class ArcsAPI {
  constructor(private readonly transport: Transport) {}

  private async call<T>(method: string, params: object): Promise<T> {
    try {
      return await this.transport.call<T>(PATH, method, params)
    } catch (e) {
      if (e instanceof DijetsRpcError && (e.rpcCode === -32601 || /method .* not found|can't find/i.test(e.message))) {
        throw new DijetsUnsupportedError(`This node has no arc service (${method})`)
      }
      throw e
    }
  }

  /** One page of Arcs, ordered by chain ID. */
  list(filter: ArcListFilter = {}): Promise<ArcListPage> {
    return this.call("arc.list", filter)
  }

  /** Every Arc matching the filter, following `nextCursor`. */
  async listAll(filter: Omit<ArcListFilter, "cursor"> = {}): Promise<ArcEntry[]> {
    const out: ArcEntry[] = []
    let cursor = ""
    for (;;) {
      const page = await this.list({ ...filter, cursor: cursor || undefined, limit: filter.limit ?? 100 })
      out.push(...page.chains)
      if (!page.nextCursor) return out
      cursor = page.nextCursor
    }
  }

  get(chainID: string): Promise<ArcEntry> {
    return this.call("arc.get", { chainID })
  }
  validators(chainID: string): Promise<ArcValidators> {
    return this.call("arc.validators", { chainID })
  }
  stats(chainID: string): Promise<ArcStats> {
    return this.call("arc.stats", { chainID })
  }
  health(chainID: string): Promise<ArcHealth> {
    return this.call("arc.health", { chainID })
  }
  /** Describes the service, or one chain when `chainID` is given. */
  capabilities(chainID: string = ""): Promise<Record<string, unknown>> {
    return this.call("arc.capabilities", { chainID })
  }
  /** Where an Arc creation has got to, from its transaction IDs. */
  creationStatus(ids: { subnetTxID?: string; chainTxID?: string; validatorTxIDs?: string[] }): Promise<ArcCreationStatus> {
    return this.call("arc.getCreationStatus", ids)
  }
  /** Lifecycle events after `after` (a sequence number). */
  events(after: number = 0, limit: number = 100): Promise<ArcEventsPage> {
    return this.call("arc.events", { after, limit })
  }
}

export type ArcHealthAssessment = "healthy" | "degraded" | "failed" | "unknown"

/**
 * The contract's display rules (§3.4): unknown lifecycles, untracked chains
 * and observations older than `staleAfterMs` are "unknown", never healthy.
 */
export function assessHealth(
  observation: ArcObservation | null | undefined,
  now: Date = new Date(),
  staleAfterMs: number = 30_000
): ArcHealthAssessment {
  if (!observation || !observation.trackedByNode) return "unknown"
  const at = Date.parse(observation.observedAt)
  if (!Number.isFinite(at) || now.getTime() - at > staleAfterMs) return "unknown"
  switch (observation.lifecycle) {
    case "ACTIVE":
      return observation.healthy ? "healthy" : "degraded"
    case "DEGRADED":
      return "degraded"
    case "FAILED":
    case "STOPPED":
      return "failed"
    default:
      return "unknown"
  }
}
