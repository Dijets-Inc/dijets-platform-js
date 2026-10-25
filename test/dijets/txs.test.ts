// Golden vectors: transactions built and signed by dijetsnodesgo's own code
// (tools/vectors), reproduced here byte for byte. Signatures are RFC 6979
// deterministic on both sides.
import { Buffer } from "buffer/index.js"
import BN from "bn.js"
import createHash from "create-hash"
import { vchain, mchain, uchain, utils } from "../../src"
import txVectors from "../vectors/txs.json"

const bintools = utils.BinTools.getInstance()
const c = txVectors.common
const hex = (b: { toString(e: string): string }) => b.toString("hex")
const cb58 = (s: string) => bintools.cb58Decode(s)
const bn = (s: string | number) => new BN(String(s))
const addr = (who: string) => Buffer.from((c as any)[who.replace(/\(.*\)/, "")].keyHashHex, "hex")
const keyOf = (who: string) => (c as any)[who].privateKey as string
const vec = (name: string) => txVectors.txs.find((t) => t.name === name)! as any
const txID = (signed: Buffer) => bintools.cb58Encode(Buffer.from(createHash("sha256").update(signed).digest()))
const idx = (i: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(i, 0)
  return b
}

describe("V-Chain", () => {
  test("BaseTx", () => {
    const v = vec("V BaseTx")
    const asset = cb58(c.djtAssetID)
    const out = (amt: string, who: string) =>
      new vchain.TransferableOutput(asset, new vchain.SECPTransferOutput(bn(amt), [addr(who)], bn(0), 1))
    const input = new vchain.SECPTransferInput(bn(v.spec.in))
    input.addSignatureIdx(0, addr("alice"))
    const ins = [new vchain.TransferableInput(cb58(v.spec.utxo), idx(v.spec.outputIndex), asset, input)]
    const outs = v.spec.outs.map(([a, w]: string[]) => out(a, w))
    const unsigned = new vchain.UnsignedTx(
      new vchain.BaseTx(c.networkID, cb58(c.vChain), outs, ins, Buffer.from(v.spec.memo))
    )
    expect(hex(unsigned.toBuffer())).toBe(v.unsignedHex)
    const kc = new vchain.KeyChain("local", "V")
    kc.importKey(keyOf("alice"))
    const signed = unsigned.sign(kc).toBuffer()
    expect(hex(signed)).toBe(v.signedHex)
    expect(txID(signed)).toBe(v.txID)
    const parsed = new vchain.Tx()
    parsed.fromBuffer(Buffer.from(v.signedHex, "hex"))
    expect(hex(parsed.toBuffer())).toBe(v.signedHex)
  })
})

describe("M-Chain", () => {
  const asset = cb58(c.djtAssetID)
  const mOut = (amt: string, who: string) =>
    new mchain.TransferableOutput(asset, new mchain.SECPTransferOutput(bn(amt), [addr(who)], bn(0), 1))
  const mIn = (utxo: string, outputIndex: number, amt: string) => {
    const i = new mchain.SECPTransferInput(bn(amt))
    i.addSignatureIdx(0, addr("alice"))
    return new mchain.TransferableInput(cb58(utxo), idx(outputIndex), asset, i)
  }
  const owner = (who: string) => new mchain.SECPOwnerOutput([addr(who)], bn(0), 1)
  const kc = () => {
    const k = new mchain.KeyChain("local", "M")
    k.importKey(keyOf("alice"))
    k.importKey(keyOf("ewoq"))
    return k
  }
  const check = (name: string, tx: any) => {
    const v = vec(name)
    const unsigned = new mchain.UnsignedTx(tx)
    expect(hex(unsigned.toBuffer())).toBe(v.unsignedHex)
    const signed = unsigned.sign(kc()).toBuffer()
    expect(hex(signed)).toBe(v.signedHex)
    expect(txID(signed)).toBe(v.txID)
    const parsed = new mchain.Tx()
    parsed.fromBuffer(Buffer.from(v.signedHex, "hex"))
    expect(parsed.getUnsignedTx().getTransaction().getTxType()).toBe(tx.getTxType())
    expect(hex(parsed.toBuffer())).toBe(v.signedHex)
  }
  const m = cb58(c.mChain)

  test("CreateSubnetTx (Arc step 1)", () => {
    const s = vec("M CreateSubnetTx").spec
    check("M CreateSubnetTx", new mchain.CreateSubnetTx(c.networkID, m, [mOut(s.change, "alice")], [mIn(s.utxo, 0, s.in)], undefined, owner(s.owner)))
  })

  test("AddSubnetValidatorTx (Arc step 2), authorised by the subnet owner", () => {
    const s = vec("M AddSubnetValidatorTx").spec
    const tx = new mchain.AddSubnetValidatorTx(
      c.networkID, m, [mOut(s.change, "alice")], [mIn(s.utxo, 0, s.in)], undefined,
      utils.NodeIDStringToBuffer(s.nodeID), bn(s.start), bn(s.end), bn(s.weight), s.subnetID
    )
    tx.addSignatureIdx(0, addr("ewoq"))
    check("M AddSubnetValidatorTx", tx)
  })

  test("CreateChainTx (Arc step 3)", () => {
    const s = vec("M CreateChainTx").spec
    const tx = new mchain.CreateChainTx(
      c.networkID, m, [mOut(s.change, "alice")], [mIn(s.utxo, 0, s.in)], undefined,
      s.subnetID, s.chainName, s.vmID, [s.fxID], Buffer.from(s.genesisHex, "hex")
    )
    tx.addSignatureIdx(0, addr("ewoq"))
    check("M CreateChainTx", tx)
  })

  test("ImportTx from the V-Chain", () => {
    const s = vec("M ImportTx").spec
    check("M ImportTx", new mchain.ImportTx(c.networkID, m, [mOut(s.out, "alice")], [], undefined, cb58(s.sourceChain), [mIn(s.utxo, s.outputIndex, s.in)]))
  })

  test("ExportTx to the V-Chain", () => {
    const s = vec("M ExportTx").spec
    check("M ExportTx", new mchain.ExportTx(c.networkID, m, [mOut(s.change, "alice")], [mIn(s.utxo, 0, s.in)], undefined, cb58(s.destinationChain), [mOut(s.exported, "ewoq")]))
  })

  test("RegisterNameTx: base inputs, then the target's consent", () => {
    const s = vec("M RegisterNameTx").spec
    check("M RegisterNameTx", new mchain.RegisterNameTx(c.networkID, m, [mOut(s.change, "alice")], [mIn(s.utxo, 0, s.in)], undefined, s.name, addr(s.target), owner(s.owner), bn(s.expiry)))
  })

  test("UpdateNameTx: base, owner, then an empty target credential", () => {
    const s = vec("M UpdateNameTx").spec
    check(
      "M UpdateNameTx",
      new mchain.UpdateNameTx(c.networkID, m, [mOut(s.change, "alice")], [mIn(s.utxo, 0, s.in)], undefined, s.name, bn(s.version), addr(s.target), owner(s.owner), bn(s.expiry), s.revoke, [addr("alice")], [0], false)
    )
  })
})

describe("U-Chain", () => {
  test("atomic ExportTx", () => {
    const v = vec("U ExportTx")
    const s = v.spec
    const asset = cb58(c.djtAssetID)
    const input = new uchain.EVMInput(s.from, bn(s.amount), asset, bn(s.nonce))
    input.addSignatureIdx(0, addr("ewoq"))
    const out = new uchain.TransferableOutput(asset, new uchain.SECPTransferOutput(bn(s.exported), [addr(s.to)], bn(0), 1))
    const unsigned = new uchain.UnsignedTx(new uchain.ExportTx(c.networkID, cb58(s.uChain), cb58(s.destinationChain), [input], [out]))
    expect(hex(unsigned.toBuffer())).toBe(v.unsignedHex)
    const kc = new uchain.KeyChain("local", "U")
    kc.importKey(keyOf("ewoq"))
    const signed = unsigned.sign(kc).toBuffer()
    expect(hex(signed)).toBe(v.signedHex)
    expect(txID(signed)).toBe(v.txID)
  })
})
