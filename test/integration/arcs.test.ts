/**
 * Arc integration tests against the node's Arc development network, which
 * runs two Arcs ("alpha", committee node1-3; "beta", committee node3-5) and
 * one that failed to start ("gamma"). Node 3 tracks both live subnets.
 *
 *   ARC_DEVNET=1 ARC_DEVNET_HOLD=45m go test -tags arc_e2e -timeout 0 -run TestDevNetwork ./tests/arc/   (dijetsnodesgo)
 *   DIJETS_ARC_NODE_URL=http://127.0.0.1:19654 npm run test:integration
 */
import BN from "bn.js"
import { DijetsClient, defineNetwork, assessHealth, DijetsUnsupportedError, vchain, utils, type ArcEntry } from "../../src"

const URL_ = process.env.DIJETS_ARC_NODE_URL
const run = URL_ ? describe : describe.skip
const EWOQ = "PrivateKey-ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN"

run("Arcs on a live network", () => {
  let client: DijetsClient
  let arcs: ArcEntry[]
  const byName = (n: string) => arcs.find((a) => a.descriptor.name === n)!

  beforeAll(async () => {
    client = await DijetsClient.connect({ network: defineNetwork({ networkID: 1337, nodeUrl: URL_! }) })
    arcs = await client.arcs.listAll()
  })

  test("discovery: registered Arcs, with this node's observations", async () => {
    expect(arcs.map((a) => a.descriptor.name).sort()).toEqual(expect.arrayContaining(["alpha", "beta", "gamma"]))
    const page = await client.arcs.list({ limit: 1 })
    expect(page.counts.registered).toBeGreaterThanOrEqual(3)
    expect(page.nextCursor).not.toBe("")
    const alpha = byName("alpha")
    expect(alpha.descriptor).toMatchObject({ vmName: "avm", privacyMode: "public", networkID: 1337 })
    expect(alpha.descriptor.validatorPolicy.profile).toBe("permissioned_committee")
    expect(alpha.descriptor.capabilities).toContain("atomic:disabled_across_subnets")
  })

  test("health follows the contract's rules", async () => {
    const alpha = await client.arcs.get(byName("alpha").descriptor.id)
    expect(alpha.observation.trackedByNode).toBe(true)
    expect(assessHealth(alpha.observation)).toBe("healthy")
    const gamma = await client.arcs.get(byName("gamma").descriptor.id)
    expect(gamma.observation.lifecycle).toBe("FAILED")
    expect(assessHealth(gamma.observation)).toBe("failed")
    expect(assessHealth(alpha.observation, new Date(Date.now() + 60_000))).toBe("unknown") // stale
  })

  test("committee membership, stats, health, capabilities, creation status and events", async () => {
    const id = byName("alpha").descriptor.id
    const v = await client.arcs.validators(id)
    expect(v.members.filter((m) => m.membershipStatus === "current")).toHaveLength(3)
    const stats = await client.arcs.stats(id)
    expect(stats.height).toBeNull() // a DAG chain has no linear height
    const h = await client.arcs.health(id)
    expect(h.engine.checked).toBe(true)
    const caps: any = await client.arcs.capabilities(id)
    expect(caps.chain).toBeDefined()
    const d = byName("alpha").descriptor
    const status = await client.arcs.creationStatus({ subnetTxID: d.createdBy.subnetTxID, chainTxID: d.createdBy.chainTxID })
    expect(status.stage).toBe("REGISTERED")
    const events = await client.arcs.events(0, 50)
    expect(events.events.some((e) => e.chainID === id)).toBe(true)
  })

  test("a transfer on an Arc's chain, paying the Arc's own fee asset", async () => {
    const id = byName("alpha").descriptor.id
    const probe = client.arcChain(id) as any
    const asset = await probe.getAssetDescription("ARC")
    const feeAssetID = utils.BinTools.getInstance().cb58Encode(asset.assetID)
    const arc = client.arcChain(id, { feeAssetID }) as any
    const kc = arc.keyChain()
    const from = kc.importKey(EWOQ).getAddressString()
    expect(from.startsWith(`${id}-custom1`)).toBe(true)
    const to = new vchain.KeyChain("custom", id).makeKey().getAddressString()
    const { utxos } = await arc.getUTXOs([from])
    const unsigned = await arc.buildBaseTx(utxos, new BN(10_000_000_000), feeAssetID, [to], [from], [from])
    const txID = await arc.issueTx(unsigned.sign(kc))
    for (let i = 0; i < 120 && (await arc.getTxStatus(txID)) !== "Accepted"; i++) await new Promise((r) => setTimeout(r, 500))
    expect(await arc.getTxStatus(txID)).toBe("Accepted")
    const bal: any = await arc.getBalance(to, feeAssetID)
    expect(bal.balance.toString()).toBe("10000000000")
    await expect(arc.buildExportTx()).rejects.toBeInstanceOf(DijetsUnsupportedError)
  })
})
