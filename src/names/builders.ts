/**
 * Builders for the name registry's transactions, mirroring dijetsnodesgo
 * wallet/chain/p/builder_names.go. They select UTXOs to pay the fee, encode
 * the authorisations, and return an unsigned M-Chain transaction to sign
 * locally. Nothing here holds or sends keys.
 */
import { Buffer } from "buffer/index.js"
import BN from "bn.js"
import { UnsignedTx } from "../upstream/apis/platformvm/tx"
import { UTXOSet, AssetAmountDestination } from "../upstream/apis/platformvm/utxos"
import { SECPOwnerOutput } from "../upstream/apis/platformvm/outputs"
import { RegisterNameTx, UpdateNameTx } from "../upstream/apis/platformvm/nametxs"
import { UnixNow } from "../upstream/utils/helperfunctions"
import { parseAddress } from "../address"
import { DijetsNameError, DijetsTxError } from "../errors"
import { validateName, isUpdatable } from "./rules"
import type { NameRecord } from "./api"

export interface NameBuildContext {
  networkID: number
  hrp: string
  /** M-Chain ID bytes. */
  blockchainID: Buffer
  /** DJT asset ID bytes. */
  djtAssetID: Buffer
}

export interface NameOwnerInput {
  /** M-Chain (or V-Chain) addresses of the owner keys. */
  addresses: string[]
  threshold?: number
  locktime?: bigint
}

const keyHash = (address: string, hrp: string): Buffer => Buffer.from(parseAddress(address, { hrp, chain: ["V", "M"] }).bytes)

const ownerOutput = (o: NameOwnerInput, hrp: string): SECPOwnerOutput => {
  if (!o.addresses.length) throw new DijetsTxError("A name owner needs at least one address")
  const threshold = o.threshold ?? 1
  if (threshold < 1 || threshold > o.addresses.length) throw new DijetsTxError(`Owner threshold ${threshold} is out of range`)
  return new SECPOwnerOutput(o.addresses.map((a) => keyHash(a, hrp)), new BN(String(o.locktime ?? 0n)), threshold)
}

function spend(ctx: NameBuildContext, utxos: UTXOSet, from: string[], change: string[], fee: bigint, asOf: BN) {
  const fromB = from.map((a) => keyHash(a, ctx.hrp))
  const changeB = change.map((a) => keyHash(a, ctx.hrp))
  const aad = new AssetAmountDestination(fromB, fromB, changeB)
  aad.addAssetAmount(ctx.djtAssetID, new BN(0), new BN(String(fee)))
  const err = utxos.getMinimumSpendable(aad, asOf, undefined, undefined)
  if (err) throw new DijetsTxError(`Cannot pay the fee of ${fee} nDJT: ${err.message}`, { cause: err })
  return { ins: aad.getInputs(), outs: aad.getAllOutputs() }
}

export interface RegisterNameArgs {
  /** Must be canonical; use `canonicaliseName()` on user input first. */
  name: string
  /** The address the name will point at. Its key must sign (consent). */
  target: string
  owner: NameOwnerInput
  /** Unix seconds, within the network's term limits (`names.params`). */
  expiry: bigint
  /** The network's register fee (`names.params().registerFee`), burned. */
  registerFee: bigint
  memo?: Buffer
}

/** An unsigned RegisterNameTx. Sign it with the fee payer's keys and the target's key. */
export function buildRegisterNameTx(
  ctx: NameBuildContext,
  utxos: UTXOSet,
  fromAddresses: string[],
  changeAddresses: string[],
  args: RegisterNameArgs,
  asOf: BN = UnixNow()
): UnsignedTx {
  validateName(args.name)
  if (args.expiry <= 0n) throw new DijetsTxError("Expiry must be set")
  const { ins, outs } = spend(ctx, utxos, fromAddresses, changeAddresses, args.registerFee, asOf)
  const tx = new RegisterNameTx(
    ctx.networkID,
    ctx.blockchainID,
    outs,
    ins,
    args.memo,
    args.name,
    keyHash(args.target, ctx.hrp),
    ownerOutput(args.owner, ctx.hrp),
    new BN(String(args.expiry))
  )
  return new UnsignedTx(tx)
}

export interface UpdateNameArgs {
  /** New target; defaults to the current one (no target consent needed). */
  target?: string
  /** New owner; defaults to the current one. */
  owner?: NameOwnerInput
  /** New expiry; defaults to the current one. */
  expiry?: bigint
  /** Revoke the name. A revocation cannot change target, owner or expiry. */
  revoke?: boolean
  /** The update fee (`names.params().updateFee`). */
  updateFee: bigint
  memo?: Buffer
}

/**
 * An unsigned UpdateNameTx against the record as last read (its `version`
 * guards against concurrent updates). `ownerKeys` are the current owner's
 * addresses whose keys will sign; enough of them must be given to meet the
 * owner's threshold.
 */
export function buildUpdateNameTx(
  ctx: NameBuildContext,
  utxos: UTXOSet,
  fromAddresses: string[],
  changeAddresses: string[],
  current: NameRecord,
  ownerKeys: string[],
  args: UpdateNameArgs,
  asOf: BN = UnixNow()
): UnsignedTx {
  if (!isUpdatable(current.status as any)) {
    throw new DijetsNameError("not_updatable", `"${current.name}" can no longer be updated: its status is ${current.status}`)
  }
  const currentTarget = keyHash(current.target, ctx.hrp)
  const target = args.target ? keyHash(args.target, ctx.hrp) : currentTarget
  const currentOwner: NameOwnerInput = {
    addresses: current.owner.addresses,
    threshold: current.owner.threshold,
    locktime: current.owner.locktime
  }
  const owner = args.owner ?? currentOwner
  const expiry = args.expiry ?? current.expiry
  if (args.revoke && (!target.equals(currentTarget) || args.owner !== undefined || expiry !== current.expiry)) {
    throw new DijetsTxError("A revocation can't change the target, owner or expiry")
  }
  // As common.MatchOwners: walk the current owner's sorted addresses, taking
  // those we hold keys for until the threshold is met.
  if (current.owner.locktime > BigInt(asOf.toString())) {
    throw new DijetsTxError("The current owner is time-locked")
  }
  const sorted = current.owner.addresses.map((a) => keyHash(a, ctx.hrp)).sort(Buffer.compare)
  const held = new Set(ownerKeys.map((a) => keyHash(a, ctx.hrp).toString("hex")))
  const signers: Buffer[] = []
  const indices: number[] = []
  for (let i = 0; i < sorted.length && signers.length < current.owner.threshold; i++) {
    if (held.has(sorted[i].toString("hex"))) {
      signers.push(sorted[i])
      indices.push(i)
    }
  }
  if (signers.length < current.owner.threshold) {
    throw new DijetsTxError(`Need ${current.owner.threshold} of the owner's keys to update "${current.name}"`)
  }
  const { ins, outs } = spend(ctx, utxos, fromAddresses, changeAddresses, args.updateFee, asOf)
  const tx = new UpdateNameTx(
    ctx.networkID,
    ctx.blockchainID,
    outs,
    ins,
    args.memo,
    current.name,
    new BN(String(current.version)),
    target,
    ownerOutput(owner, ctx.hrp),
    new BN(String(expiry)),
    Boolean(args.revoke),
    signers,
    indices,
    !target.equals(currentTarget)
  )
  return new UnsignedTx(tx)
}
