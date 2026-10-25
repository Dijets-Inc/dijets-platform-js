/**
 * The name registry's read API: `names.*` at /ext/bc/M/names
 * (dijetsnodesgo vms/platformvm/names_service.go, docs/naming/02-api.md).
 *
 * Answers come from the node's last accepted M-Chain block, reported in `at`.
 * A name is only a pointer: to pay a name, use `resolveForPayment`, which
 * refuses anything but an ACTIVE record and returns the evidence it used.
 */
import { DijetsNameError, DijetsRpcError, DijetsUnsupportedError } from "../errors"
import type { Transport } from "../rpc"
import type { NetworkPreset } from "../presets"
import { parseAddress } from "../address"
import { canonicaliseName, type NameRule, type NameStatus } from "./rules"

const PATH = "/ext/bc/M/names"

/** The accepted M-Chain block an answer was computed at. */
export interface RegistryPosition {
  blockID: string
  height: bigint
  chainTime: bigint
}

export interface NameOwner {
  threshold: number
  locktime: bigint
  /** M-Chain addresses. */
  addresses: string[]
}

export interface NameRecord {
  name: string
  status: NameStatus
  /** The address the name points at, as a V-Chain address. */
  target: string
  /** The target's 20-byte key hash, cb58. */
  targetID: string
  owner: NameOwner
  expiry: bigint
  revoked: boolean
  generation: bigint
  version: bigint
  recordID: string
  lastTxID: string
  registeredAt: bigint
  updatedAt: bigint
}

export interface ResolveResult {
  input: string
  name: string
  status: NameStatus
  resolvable: boolean
  record?: NameRecord
  at: RegistryPosition
}

export interface ReverseResult {
  address: string
  /** Present only when an ACTIVE record targets the address. */
  name?: string
  record?: NameRecord
  at: RegistryPosition
}

export interface HistoryVersion extends Omit<NameRecord, "status"> {
  /** Superseded versions are "SUPERSEDED". */
  status: NameStatus | "SUPERSEDED"
}

export interface HistoryResult {
  name: string
  /** Oldest first. */
  versions: HistoryVersion[]
  at: RegistryPosition
}

export interface NamesParams {
  active: boolean
  activationTime: bigint
  minTermSeconds: bigint
  maxTermSeconds: bigint
  gracePeriodSeconds: bigint
  /** nDJT, burned. */
  registerFee: bigint
  updateFee: bigint
  minLength: number
  maxLength: number
  at: RegistryPosition
}

/** What `resolveForPayment` returns: the address and the registry facts behind it. */
export interface PaymentRecipient {
  name: string
  /** The V-Chain address to pay. */
  address: string
  recordID: string
  generation: bigint
  version: bigint
  expiry: bigint
  at: RegistryPosition
}

const big = (v: unknown): bigint => BigInt(String(v ?? "0"))

const position = (a: any): RegistryPosition => ({
  blockID: a?.blockID,
  height: big(a?.height),
  chainTime: big(a?.chainTime)
})

const record = (r: any): NameRecord => ({
  name: r.name,
  status: r.status,
  target: r.target,
  targetID: r.targetID,
  owner: {
    threshold: Number(r.owner?.threshold ?? 0),
    locktime: big(r.owner?.locktime),
    addresses: r.owner?.addresses ?? []
  },
  expiry: big(r.expiry),
  revoked: Boolean(r.revoked),
  generation: big(r.generation),
  version: big(r.version),
  recordID: r.recordID,
  lastTxID: r.lastTxID,
  registeredAt: big(r.registeredAt),
  updatedAt: big(r.updatedAt)
})

export class NamesAPI {
  constructor(
    private readonly transport: Transport,
    private readonly network: NetworkPreset
  ) {}

  private async call(method: string, params: object): Promise<any> {
    try {
      return await this.transport.call(PATH, method, params)
    } catch (e) {
      if (e instanceof DijetsRpcError) {
        const reason: string | undefined = (e.data as any)?.reason
        if (reason?.startsWith("invalid_name:")) {
          const rule = reason.slice("invalid_name:".length) as NameRule
          throw new DijetsNameError(rule, `${method}: ${e.message}`)
        }
        if (e.rpcCode === -32601 || /method .* not found|can't find/i.test(e.message)) {
          throw new DijetsUnsupportedError(`This node has no name registry API (${method})`)
        }
      }
      throw e
    }
  }

  /** Looks a name up. Input is canonicalised by the node; an unknown name is NOT_FOUND, not an error. */
  async resolve(name: string): Promise<ResolveResult> {
    const r = await this.call("names.resolve", { name })
    return {
      input: r.input,
      name: r.name,
      status: r.status,
      resolvable: Boolean(r.resolvable),
      record: r.record ? record(r.record) : undefined,
      at: position(r.at)
    }
  }

  /** The name an address carries, if an ACTIVE record targets it. */
  async reverse(address: string): Promise<ReverseResult> {
    const r = await this.call("names.reverse", { address })
    return {
      address: r.address,
      name: r.name || undefined,
      record: r.record ? record(r.record) : undefined,
      at: position(r.at)
    }
  }

  /** Every version of a name, oldest first. */
  async history(name: string): Promise<HistoryResult> {
    const r = await this.call("names.history", { name })
    return {
      name: r.name,
      versions: (r.versions ?? []).map((v: any) => ({ ...record(v), status: v.status })),
      at: position(r.at)
    }
  }

  /** The node's canonical form of a name, or a `DijetsNameError` naming the rule it breaks. */
  async validate(name: string): Promise<{ input: string; canonical: string }> {
    return this.call("names.validate", { name })
  }

  /** Registry parameters, including whether naming is active on this network. */
  async params(): Promise<NamesParams> {
    const r = await this.call("names.params", {})
    return {
      active: Boolean(r.active),
      activationTime: big(r.activationTime),
      minTermSeconds: big(r.minTermSeconds),
      maxTermSeconds: big(r.maxTermSeconds),
      gracePeriodSeconds: big(r.gracePeriodSeconds),
      registerFee: big(r.registerFee),
      updateFee: big(r.updateFee),
      minLength: Number(r.minLength),
      maxLength: Number(r.maxLength),
      at: position(r.at)
    }
  }

  /**
   * Resolves a name to the V-Chain address to pay, refusing anything that is
   * not ACTIVE. The name is canonicalised and checked locally first, and the
   * returned address is checked to be on this network.
   *
   * @param minRemainingSeconds Also refuse names that expire sooner than this
   *   (the transaction service uses a 10-minute margin).
   */
  async resolveForPayment(input: string, minRemainingSeconds: bigint = 0n): Promise<PaymentRecipient> {
    const name = canonicaliseName(input)
    const r = await this.resolve(name)
    if (!r.resolvable || r.status !== "ACTIVE" || !r.record) {
      throw new DijetsNameError("not_resolvable" as NameRule, `"${name}" cannot be paid: its status is ${r.status}`)
    }
    if (r.record.expiry < r.at.chainTime + minRemainingSeconds) {
      throw new DijetsNameError("not_resolvable" as NameRule, `"${name}" expires too soon to pay safely`)
    }
    parseAddress(r.record.target, { chain: "V", hrp: this.network.hrp })
    return {
      name: r.name,
      address: r.record.target,
      recordID: r.record.recordID,
      generation: r.record.generation,
      version: r.record.version,
      expiry: r.record.expiry,
      at: r.at
    }
  }

  /** True when the registry is active on this network. */
  async isActive(): Promise<boolean> {
    try {
      return (await this.params()).active
    } catch (e) {
      if (e instanceof DijetsUnsupportedError) return false
      throw e
    }
  }
}
