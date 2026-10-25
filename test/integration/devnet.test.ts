/**
 * Integration tests against a real Dijets node. Nothing is mocked: every
 * transaction is built and signed here, issued to the node, and must be
 * accepted by consensus.
 *
 *   DIJETS_NODE_URL=http://127.0.0.1:19750 npm run test:integration
 *
 * Start a network with the node's own harness (dijetsnodesgo):
 *   NAMES_DEVNET=1 NAMES_DEVNET_HOLD=60m go test -tags names_e2e -timeout 0 -run TestDevNetwork ./tests/names/
 * It is a 5-node custom network (ID 1337) with naming active; the local
 * genesis funds the ewoq test key on V, M and U. Only test keys are used.
 */
import { Buffer } from "buffer/index.js"
import BN from "bn.js"
import { ethers } from "ethers"
import {
  DijetsClient,
  defineNetwork,
  DJT,
  MILLI_DJT,
  formatAddress,
  parseAddress,
  vchain,
  mchain,
  uchain,
  utils
} from "../../src"

const URL_ = process.env.DIJETS_NODE_URL
const NETWORK_ID = Number(process.env.DIJETS_NETWORK_ID ?? 1337)
const run = URL_ ? describe : describe.skip

const EWOQ = "PrivateKey-ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN"
const EWOQ_EVM = "0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027"
const bintools = utils.BinTools.getInstance()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until<T>(what: string, f: () => Promise<T | undefined>, timeoutMs = 60_000): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const v = await f()
    if (v !== undefined) return v
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await sleep(500)
  }
}

run("against a live node", () => {
  let client: DijetsClient
  let hrp: string
  // A fresh key per run, so repeated runs start clean.
  const alice = new vchain.KeyChain("custom", "V").makeKey()
  const vAddr = (k: { getAddress(): Buffer }) => formatAddress("V", hrp, k.getAddress())
  const mAddr = (k: { getAddress(): Buffer }) => formatAddress("M", hrp, k.getAddress())

  const vAccepted = (txID: string) =>
    until(`V ${txID}`, async () => {
      const s = await client.vChain.getTxStatus(txID)
      if (s === "Rejected") throw new Error(`${txID} rejected`)
      return s === "Accepted" ? s : undefined
    })
  const mCommitted = (txID: string) =>
    until(`M ${txID}`, async () => {
      const r: any = await client.mChain.getTxStatus(txID)
      const s = typeof r === "string" ? r : r.status
      if (s === "Dropped" || s === "Aborted") throw new Error(`${txID} ${s}: ${r.reason ?? ""}`)
      return s === "Committed" ? s : undefined
    })

  beforeAll(async () => {
    client = await DijetsClient.connect({ network: defineNetwork({ networkID: NETWORK_ID, nodeUrl: URL_! }) })
    hrp = client.hrp
  })

  test("discovery fills every ID from the node", async () => {
    const fresh = new DijetsClient({ network: defineNetwork({ networkID: NETWORK_ID, nodeUrl: URL_! }) })
    const report = await fresh.discover()
    expect(report.networkID).toBe(NETWORK_ID)
    expect(report.nodeVersion).toMatch(/^Dijets\/\d+\.\d+\.\d+$/)
    expect(report.filled).toEqual(["V-Chain ID", "U-Chain ID", "DJT asset ID", "U-Chain EVM chain ID"])
    expect(await client.info.isBootstrapped("V")).toBe(true)
    expect(await client.info.getBlockchainID("M")).toBe("11111111111111111111111111111111LpoYY")
  })

  test("V-Chain: a transfer is accepted by DAG consensus", async () => {
    const kc = client.vChain.keyChain()
    const ewoq = vAddr(kc.importKey(EWOQ))
    const before = await client.vChain.getDJTBalance(ewoq)
    expect(before).toBeGreaterThan(10n * DJT)
    const { utxos } = await client.vChain.getUTXOs([ewoq])
    const unsigned = await client.vChain.buildBaseTx(utxos, new BN((5n * DJT).toString()), await client.vChain.getDJTAssetID(), [vAddr(alice)], [ewoq], [ewoq], Buffer.from("platform-js"))
    const txID = await client.vChain.issueTx(unsigned.sign(kc))
    await vAccepted(txID)
    expect(await client.vChain.getDJTBalance(vAddr(alice))).toBe(5n * DJT)
    // DAG: the transaction is found by ID (there is no height to ask for),
    // and the node's bytes parse back to what was signed.
    const parsed = new vchain.Tx()
    // The node's "hex" encoding is 0x-prefixed with a 4-byte checksum.
    const hexTx = String(await client.vChain.getTx(txID, "hex")).replace(/^0x/, "")
    parsed.fromBuffer(Buffer.from(hexTx, "hex").slice(0, -4) as any)
    expect(parsed.getUnsignedTx().getTransaction().getMemo().toString()).toBe("platform-js")
  })

  test("V → M: atomic export, then import on the M-Chain", async () => {
    const kc = client.vChain.keyChain()
    kc.addKey(alice)
    const from = vAddr(alice)
    const { utxos } = await client.vChain.getUTXOs([from])
    const exp = await client.vChain.buildExportTx(utxos, new BN((2n * DJT).toString()), client.mChain.getBlockchainID(), [mAddr(alice)], [from], [from])
    await vAccepted(await client.vChain.issueTx(exp.sign(kc)))

    const mkc = client.mChain.keyChain()
    mkc.addKey(alice as any)
    const atomic = await client.mChain.getUTXOs([mAddr(alice)], client.network.chains.V.id as string)
    const imp = await client.mChain.buildImportTx(atomic.utxos, [mAddr(alice)], client.network.chains.V.id as string, [mAddr(alice)], [mAddr(alice)], [mAddr(alice)])
    await mCommitted(await client.mChain.issueTx(imp.sign(mkc)))
    const bal: any = await client.mChain.getBalance(mAddr(alice))
    expect(BigInt(bal.balance.toString())).toBe(2n * DJT - client.network.fees.txFee)
  })

  test("U-Chain: an EVM transfer signed with ethers", async () => {
    expect(await client.uChainEvm.chainId()).toBe(client.network.chains.U.evmChainID)
    const provider = new ethers.providers.StaticJsonRpcProvider(client.uChainRpcUrl, Number(client.network.chains.U.evmChainID))
    const wallet = new ethers.Wallet(EWOQ_EVM, provider)
    const to = ethers.Wallet.createRandom().address
    const tx = await wallet.sendTransaction({ to, value: ethers.utils.parseEther("0.25") })
    const receipt = await tx.wait()
    expect(receipt.status).toBe(1)
    expect(await client.uChainEvm.getBalance(to)).toBe(250_000_000_000_000_000n)
  })

  test("U → V: atomic export from the EVM, then import on the V-Chain", async () => {
    const ukc = client.uChain.keyChain()
    const ewoqU = formatAddress("U", hrp, ukc.importKey(EWOQ).getAddress())
    const evmFrom = new ethers.Wallet(EWOQ_EVM).address
    const nonce = await client.uChainEvm.getTransactionCount(evmFrom)
    const baseFee = await client.uChainEvm.baseFee()
    // Fee in nDJT: the atomic tx's gas at the current base fee, rounded up (generous margin).
    const fee = new BN(((baseFee * 30_000n) / 1_000_000_000n + 1n).toString())
    const exp = await client.uChain.buildExportTx(
      new BN(DJT.toString()), await client.uChain.getDJTAssetID(), client.network.chains.V.id as string,
      evmFrom, ewoqU, [vAddr(alice)], nonce, new BN(0), 1, fee
    )
    const atomicID = await client.uChain.issueTx(exp.sign(ukc))
    await until("U atomic tx", async () => ((await client.uChain.getAtomicTxStatus(atomicID)) === "Accepted" ? true : undefined))

    const kc = client.vChain.keyChain()
    kc.addKey(alice)
    const atomic = await client.vChain.getUTXOs([vAddr(alice)], client.network.chains.U.id as string)
    const before = await client.vChain.getDJTBalance(vAddr(alice))
    const imp = await client.vChain.buildImportTx(atomic.utxos, [vAddr(alice)], client.network.chains.U.id as string, [vAddr(alice)], [vAddr(alice)])
    await vAccepted(await client.vChain.issueTx(imp.sign(kc)))
    expect(await client.vChain.getDJTBalance(vAddr(alice))).toBe(before + DJT - client.network.fees.txFee)
  })

  test("names: register, resolve, reverse, renew, history", async () => {
    const params = await client.names.params()
    expect(params.active).toBe(true)
    const name = `sdk${Date.now().toString(36)}`
    const mkc = client.mChain.keyChain()
    const ewoqM = mAddr(mkc.importKey(EWOQ))
    mkc.addKey(alice as any)
    const now = BigInt(Math.floor(Date.now() / 1000))
    const expiry = now + 30n * 24n * 3600n

    const { utxos } = await client.mChain.getUTXOs([ewoqM])
    const reg = await client.mChain.buildRegisterNameTx(utxos, [ewoqM], [ewoqM], {
      name, target: vAddr(alice), owner: { addresses: [mAddr(alice)] }, expiry, registerFee: params.registerFee
    })
    await mCommitted(await client.mChain.issueTx(reg.sign(mkc)))

    const r = await client.names.resolve(name)
    expect(r).toMatchObject({ name, status: "ACTIVE", resolvable: true })
    expect(r.record!.target).toBe(vAddr(alice))
    expect(r.record!.version).toBe(1n)
    const pay = await client.names.resolveForPayment(name.toUpperCase())
    expect(pay.address).toBe(vAddr(alice))
    expect((await client.names.reverse(vAddr(alice))).name).toBe(name)

    const { utxos: u2 } = await client.mChain.getUTXOs([ewoqM])
    const upd = await client.mChain.buildUpdateNameTx(u2, [ewoqM], [ewoqM], r.record!, [mAddr(alice)], {
      expiry: expiry + 10n * 24n * 3600n, updateFee: params.updateFee
    })
    await mCommitted(await client.mChain.issueTx(upd.sign(mkc)))
    const r2 = await client.names.resolve(name)
    expect(r2.record!.version).toBe(2n)
    expect(r2.record!.expiry).toBe(expiry + 10n * 24n * 3600n)
    const h = await client.names.history(name)
    expect(h.versions.map((v) => v.version)).toEqual([1n, 2n])
  })

  test("names: the node refuses a name that is already registered", async () => {
    const params = await client.names.params()
    expect((await client.names.resolve("alice")).status).toBe("ACTIVE") // registered by the harness
    const mkc = client.mChain.keyChain()
    const ewoqM = mAddr(mkc.importKey(EWOQ))
    const taker = new mchain.KeyChain(hrp, "M").makeKey()
    mkc.addKey(taker)
    const { utxos } = await client.mChain.getUTXOs([ewoqM])
    const reg = await client.mChain.buildRegisterNameTx(utxos, [ewoqM], [ewoqM], {
      name: "alice", target: mAddr(taker), owner: { addresses: [ewoqM] },
      expiry: BigInt(Math.floor(Date.now() / 1000)) + 40n * 24n * 3600n, registerFee: params.registerFee
    })
    const txID = await client.mChain.issueTx(reg.sign(mkc)).catch((e) => e)
    if (txID instanceof Error) {
      expect(txID.message).toMatch(/not available for registration/)
    } else {
      // Issued but not committed: the executor drops it with the same reason.
      await expect(mCommitted(txID)).rejects.toThrow(/not available for registration/)
    }
  })

  test("Arcs: subnet, committee member and AVM chain are registered", async () => {
    const mkc = client.mChain.keyChain()
    const ewoqM = mAddr(mkc.importKey(EWOQ))
    const ewoqBytes = Buffer.from(parseAddress(ewoqM).bytes)

    let { utxos } = await client.mChain.getUTXOs([ewoqM])
    const subnetTx = await client.mChain.buildCreateSubnetTx(utxos, [ewoqM], [ewoqM], [ewoqM], 1)
    const subnetID = await client.mChain.issueTx(subnetTx.sign(mkc))
    await mCommitted(subnetID)
    expect((await client.arcs.creationStatus({ subnetTxID: subnetID })).stage).toBe("SUBNET_REGISTERED")

    const nodeID = await client.info.getNodeID()
    const validators: any = await client.mChain.getCurrentValidators()
    const me = validators.validators.find((v: any) => v.nodeID === nodeID)
    const start = BigInt(Math.floor(Date.now() / 1000) + 60)
    const end = BigInt(me.endTime) - 60n
    ;({ utxos } = await client.mChain.getUTXOs([ewoqM]))
    const addVal = await client.mChain.buildAddSubnetValidatorTx(
      utxos, [ewoqM], [ewoqM], nodeID, new BN(start.toString()), new BN(end.toString()), new BN(20), subnetID,
      undefined, undefined, [[0, ewoqBytes]]
    )
    const valTxID = await client.mChain.issueTx(addVal.sign(mkc))
    await mCommitted(valTxID)

    // The Arc's AVM genesis, from the node's static API: one fixed-cap asset.
    const genesis = await client.transport.call("/ext/vm/avm", "avm.buildGenesis", {
      networkID: NETWORK_ID,
      genesisData: { ARC: { name: "Arc Token", symbol: "ARC", denomination: 0, initialState: { fixedCap: [{ amount: 1000000, address: formatAddress("V", hrp, ewoqBytes).slice(2) }] } } },
      encoding: "hex"
    })
    ;({ utxos } = await client.mChain.getUTXOs([ewoqM]))
    const chainTx = await client.mChain.buildCreateChainTx(
      utxos, [ewoqM], [ewoqM], subnetID, `sdk ${Date.now().toString(36)}`, "avm", ["secp256k1fx"],
      Buffer.from(String(genesis.bytes).replace(/^0x/, ""), "hex").slice(0, -4) as any, undefined, undefined, [[0, ewoqBytes]]
    )
    const chainID = await client.mChain.issueTx(chainTx.sign(mkc))
    await mCommitted(chainID)

    const status = await client.arcs.creationStatus({ subnetTxID: subnetID, chainTxID: chainID, validatorTxIDs: [valTxID] })
    expect(status.stage).toBe("REGISTERED")
    const arc = await client.arcs.get(chainID)
    expect(arc.descriptor).toMatchObject({ id: chainID, subnetID, vmName: "avm" })
    expect(arc.descriptor.owner.addresses).toEqual([ewoqM])
    // This node does not track the new subnet, so it cannot vouch for its health.
    expect(arc.observation.trackedByNode).toBe(false)
    const all = await client.arcs.listAll({ subnetID })
    expect(all.map((a) => a.descriptor.id)).toEqual([chainID])
  })

  test("metrics and health respond", async () => {
    expect(await client.metrics()).toMatch(/^# HELP/m)
    const h: any = await client.health.health()
    expect(typeof h.healthy).toBe("boolean")
  })

  void uchain
  void bintools
  void MILLI_DJT
})
