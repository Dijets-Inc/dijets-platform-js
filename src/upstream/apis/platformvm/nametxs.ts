/**
 * DIJETS addition (not in upstream avalanche.js): the name registry's two
 * M-Chain transactions, type IDs 33 and 34 in the platformvm codec
 * (dijetsnodesgo vms/platformvm/txs/register_name_tx.go, update_name_tx.go).
 *
 * Layout, after the BaseTx fields (linear codec, big-endian):
 *   RegisterNameTx: name (u16 length + bytes), target (20 bytes),
 *     owner (u32 type 11 + OutputOwners), expiry (u64),
 *     targetAuthorization (u32 type 10 + secp256k1fx.Input)
 *   UpdateNameTx:   name, version (u64), target, owner, expiry, revoke (1 byte),
 *     nameAuthorization, targetAuthorization
 *
 * Credentials follow the inputs in this order (wallet/chain/p/signer_visitor.go):
 * base inputs, then (UpdateNameTx only) the current owner, then the target.
 * The target credential has no signatures when the target is unchanged.
 */
import { Buffer } from "buffer/index.js"
import BN from "bn.js"
import BinTools from "../../utils/bintools"
import { PlatformVMConstants } from "./constants"
import { TransferableOutput, SECPOwnerOutput } from "./outputs"
import { TransferableInput } from "./inputs"
import { BaseTx } from "./basetx"
import { SubnetAuth } from "./subnetauth"
import { SelectCredentialClass } from "./credentials"
import { Credential, Signature } from "../../common/credentials"
import { KeyChain } from "./keychain"
import { DefaultNetworkID } from "../../utils/constants"
import { TransactionError } from "../../utils/errors"

const bintools: BinTools = BinTools.getInstance()

const u64 = (v: BN): Buffer => bintools.fromBNToBuffer(v, 8) as Buffer
const nameBytes = (name: string): Buffer => {
  const body = Buffer.from(name, "utf8")
  const len = Buffer.alloc(2)
  len.writeUInt16BE(body.length, 0)
  return Buffer.concat([len, body])
}
const ownerBytes = (owner: SECPOwnerOutput): Buffer => {
  const typeID = Buffer.alloc(4)
  typeID.writeUInt32BE(owner.getOutputID(), 0)
  return Buffer.concat([typeID, owner.toBuffer()])
}

/** An authorisation: signature indices into an owner's addresses, and those addresses' signers. */
const authFor = (signers: Buffer[]): SubnetAuth => {
  const auth = new SubnetAuth()
  signers.forEach((_a, i) => {
    const idx = Buffer.alloc(4)
    idx.writeUInt32BE(i, 0)
    auth.addAddressIndex(idx)
  })
  return auth
}

const credentialFrom = (msg: Buffer, kc: KeyChain, signers: Buffer[]): Credential => {
  const cred: Credential = SelectCredentialClass(PlatformVMConstants.SECPCREDENTIAL)
  for (const address of signers) {
    const keypair = kc.getKey(address)
    if (!keypair) {
      throw new TransactionError(`Error - name transaction: no key in the keychain for ${bintools.cb58Encode(address)}`)
    }
    const sig = new Signature()
    sig.fromBuffer(keypair.sign(msg))
    cred.addSignature(sig)
  }
  return cred
}

export class RegisterNameTx extends BaseTx {
  protected _typeName = "RegisterNameTx"
  protected _typeID = PlatformVMConstants.REGISTERNAMETX

  protected name: string = ""
  protected target: Buffer = Buffer.alloc(20)
  protected owner: SECPOwnerOutput = new SECPOwnerOutput()
  protected expiry: Buffer = Buffer.alloc(8)
  protected targetAuth: SubnetAuth = new SubnetAuth()

  getTxType(): number {
    return this._typeID
  }
  getName = (): string => this.name
  getTarget = (): Buffer => this.target
  getOwner = (): SECPOwnerOutput => this.owner
  getExpiry = (): BN => bintools.fromBufferToBN(this.expiry)

  fromBuffer(bytes: Buffer, offset: number = 0): number {
    offset = super.fromBuffer(bytes, offset)
    const len = bintools.copyFrom(bytes, offset, offset + 2).readUInt16BE(0)
    offset += 2
    this.name = bintools.copyFrom(bytes, offset, offset + len).toString("utf8")
    offset += len
    this.target = bintools.copyFrom(bytes, offset, offset + 20)
    offset += 20
    offset += 4 // owner type ID
    this.owner = new SECPOwnerOutput()
    offset = this.owner.fromBuffer(bytes, offset)
    this.expiry = bintools.copyFrom(bytes, offset, offset + 8)
    offset += 8
    this.targetAuth = new SubnetAuth()
    offset = this.targetAuth.fromBuffer(bytes, offset)
    return offset
  }

  toBuffer(): Buffer {
    return Buffer.concat([
      super.toBuffer(),
      nameBytes(this.name),
      this.target,
      ownerBytes(this.owner),
      this.expiry,
      this.targetAuth.toBuffer()
    ])
  }

  clone(): this {
    const tx = new RegisterNameTx()
    tx.fromBuffer(this.toBuffer())
    return tx as this
  }

  create(...args: any[]): this {
    return new RegisterNameTx(...args) as this
  }

  /** Base inputs, then the target's consent. */
  sign(msg: Buffer, kc: KeyChain): Credential[] {
    const creds = super.sign(msg, kc)
    creds.push(credentialFrom(msg, kc, [this.target]))
    return creds
  }

  constructor(
    networkID: number = DefaultNetworkID,
    blockchainID: Buffer = Buffer.alloc(32, 16),
    outs: TransferableOutput[] = undefined,
    ins: TransferableInput[] = undefined,
    memo: Buffer = undefined,
    name: string = undefined,
    target: Buffer = undefined,
    owner: SECPOwnerOutput = undefined,
    expiry: BN = undefined
  ) {
    super(networkID, blockchainID, outs, ins, memo)
    if (name !== undefined) this.name = name
    if (target !== undefined) this.target = target
    if (owner !== undefined) this.owner = owner
    if (expiry !== undefined) this.expiry = u64(expiry)
    // The target signs at index 0 of the owner {threshold 1, [target]}.
    this.targetAuth = authFor([this.target])
  }
}

export class UpdateNameTx extends BaseTx {
  protected _typeName = "UpdateNameTx"
  protected _typeID = PlatformVMConstants.UPDATENAMETX

  protected name: string = ""
  protected version: Buffer = Buffer.alloc(8)
  protected target: Buffer = Buffer.alloc(20)
  protected owner: SECPOwnerOutput = new SECPOwnerOutput()
  protected expiry: Buffer = Buffer.alloc(8)
  protected revoke: Buffer = Buffer.alloc(1)
  protected nameAuth: SubnetAuth = new SubnetAuth()
  protected targetAuth: SubnetAuth = new SubnetAuth()
  /** Addresses of the current owner that sign, by signature index. Not serialised. */
  protected ownerSigners: Buffer[] = []
  /** Whether the target changes (and so must consent). Not serialised. */
  protected targetChanges: boolean = false

  getTxType(): number {
    return this._typeID
  }
  getName = (): string => this.name
  getVersion = (): BN => bintools.fromBufferToBN(this.version)
  getTarget = (): Buffer => this.target
  getOwner = (): SECPOwnerOutput => this.owner
  getExpiry = (): BN => bintools.fromBufferToBN(this.expiry)
  isRevoke = (): boolean => this.revoke[0] === 1

  fromBuffer(bytes: Buffer, offset: number = 0): number {
    offset = super.fromBuffer(bytes, offset)
    const len = bintools.copyFrom(bytes, offset, offset + 2).readUInt16BE(0)
    offset += 2
    this.name = bintools.copyFrom(bytes, offset, offset + len).toString("utf8")
    offset += len
    this.version = bintools.copyFrom(bytes, offset, offset + 8)
    offset += 8
    this.target = bintools.copyFrom(bytes, offset, offset + 20)
    offset += 20
    offset += 4 // owner type ID
    this.owner = new SECPOwnerOutput()
    offset = this.owner.fromBuffer(bytes, offset)
    this.expiry = bintools.copyFrom(bytes, offset, offset + 8)
    offset += 8
    this.revoke = bintools.copyFrom(bytes, offset, offset + 1)
    offset += 1
    this.nameAuth = new SubnetAuth()
    offset = this.nameAuth.fromBuffer(bytes, offset)
    this.targetAuth = new SubnetAuth()
    offset = this.targetAuth.fromBuffer(bytes, offset)
    return offset
  }

  toBuffer(): Buffer {
    return Buffer.concat([
      super.toBuffer(),
      nameBytes(this.name),
      this.version,
      this.target,
      ownerBytes(this.owner),
      this.expiry,
      this.revoke,
      this.nameAuth.toBuffer(),
      this.targetAuth.toBuffer()
    ])
  }

  clone(): this {
    const tx = new UpdateNameTx()
    tx.fromBuffer(this.toBuffer())
    ;(tx as any).ownerSigners = this.ownerSigners
    ;(tx as any).targetChanges = this.targetChanges
    return tx as this
  }

  create(...args: any[]): this {
    return new UpdateNameTx(...args) as this
  }

  /** Base inputs, then the current owner, then the target (no signatures if unchanged). */
  sign(msg: Buffer, kc: KeyChain): Credential[] {
    const creds = super.sign(msg, kc)
    creds.push(credentialFrom(msg, kc, this.ownerSigners))
    creds.push(credentialFrom(msg, kc, this.targetChanges ? [this.target] : []))
    return creds
  }

  /**
   * @param ownerSigners The current owner's addresses that sign, in the
   *   order of their indices in the current owner's (sorted) address list.
   * @param ownerSigIndices Those indices.
   * @param targetChanges True if `target` differs from the record's target.
   */
  constructor(
    networkID: number = DefaultNetworkID,
    blockchainID: Buffer = Buffer.alloc(32, 16),
    outs: TransferableOutput[] = undefined,
    ins: TransferableInput[] = undefined,
    memo: Buffer = undefined,
    name: string = undefined,
    version: BN = undefined,
    target: Buffer = undefined,
    owner: SECPOwnerOutput = undefined,
    expiry: BN = undefined,
    revoke: boolean = false,
    ownerSigners: Buffer[] = [],
    ownerSigIndices: number[] = [],
    targetChanges: boolean = false
  ) {
    super(networkID, blockchainID, outs, ins, memo)
    if (name !== undefined) this.name = name
    if (version !== undefined) this.version = u64(version)
    if (target !== undefined) this.target = target
    if (owner !== undefined) this.owner = owner
    if (expiry !== undefined) this.expiry = u64(expiry)
    this.revoke = Buffer.from([revoke ? 1 : 0])
    if (ownerSigners.length !== ownerSigIndices.length) {
      throw new TransactionError("Error - UpdateNameTx: one signature index per owner signer")
    }
    this.ownerSigners = ownerSigners
    this.nameAuth = new SubnetAuth()
    for (const i of ownerSigIndices) {
      const idx = Buffer.alloc(4)
      idx.writeUInt32BE(i, 0)
      this.nameAuth.addAddressIndex(idx)
    }
    this.targetChanges = targetChanges
    this.targetAuth = targetChanges ? authFor([this.target]) : new SubnetAuth()
  }
}
