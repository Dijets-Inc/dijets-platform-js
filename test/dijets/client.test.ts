import BN from "bn.js"
import {
  DijetsClient,
  LOCAL,
  MAINNET,
  defineNetwork,
  DijetsNetworkMismatchError,
  DijetsRpcError,
  DijetsHttpError,
  DijetsTimeoutError,
  DijetsConfigError,
  DijetsUnsupportedError,
  DijetsNameError,
  assessHealth
} from "../../src"
import { mockNode } from "./mocknode"

const URL_ = "http://node.test:9650"

describe("connect", () => {
  test("checks a preset against the node; nothing to fill on local", async () => {
    const node = mockNode()
    const client = new DijetsClient({ network: "local", url: URL_, fetch: node.fetch })
    const report = await client.discover()
    expect(report).toMatchObject({ networkID: 12345, filled: [], differences: [] })
    expect(node.calls.map((c) => c.method)).toEqual([
      "info.getNetworkID",
      "info.getNodeVersion",
      "info.getBlockchainID",
      "info.getBlockchainID",
      "avm.getAssetDescription",
      "eth_chainId",
      "info.getTxFee"
    ])
    // The asset is looked up by its genesis alias, DJT.
    expect(node.calls[4]).toMatchObject({ path: "/ext/bc/V", params: { assetID: "DJT" } })
    expect(node.calls[5].path).toBe("/ext/bc/U/rpc")
  })

  test("fills the mainnet U-Chain placeholder from the node", async () => {
    const live = { ...MAINNET, chains: { ...MAINNET.chains, U: { id: "vWaU1HuvgqAQ9KkKSh5ThrxXvSCZ2ZDK1k8zeg2innRv2SdrN", evmChainID: 98200 } } }
    const node = mockNode({}, live as any)
    const client = await DijetsClient.connect({ network: "mainnet", url: URL_, fetch: node.fetch })
    expect(client.network.chains.U.id).toBe("vWaU1HuvgqAQ9KkKSh5ThrxXvSCZ2ZDK1k8zeg2innRv2SdrN")
    expect(client.uChain.getBlockchainID()).toBe("vWaU1HuvgqAQ9KkKSh5ThrxXvSCZ2ZDK1k8zeg2innRv2SdrN")
  })

  test("refuses a node on another network", async () => {
    const node = mockNode({ "info.getNetworkID": () => ({ networkID: "5" }) })
    await expect(DijetsClient.connect({ network: "local", url: URL_, fetch: node.fetch })).rejects.toBeInstanceOf(DijetsNetworkMismatchError)
  })

  test("refuses a node whose V-Chain is not the preset's", async () => {
    const node = mockNode({ "info.getBlockchainID": (p) => ({ blockchainID: p.alias === "V" ? "2DeMcqEBxHgER88uMcWSFrQfFLCeRmeu4QYK5FMDcgjQgmzXLv" : LOCAL.chains.U.id }) })
    await expect(DijetsClient.connect({ network: "local", url: URL_, fetch: node.fetch })).rejects.toThrow(/V-Chain ID/)
  })

  test("discovers every ID of a custom network, and takes the node's fees", async () => {
    const dev = { ...LOCAL, networkID: 1337, chains: { M: LOCAL.chains.M, V: { id: "2DeMcqEBxHgER88uMcWSFrQfFLCeRmeu4QYK5FMDcgjQgmzXLv" }, U: { id: "LuyHgvEZq2DDJ8GSC4jWupb7ScZ6ncNqSkzPRfjtWyZpH7qCy", evmChainID: 43112 } }, djtAssetID: "z8GHRyhJhKjMod5FUxPYPqHxT1W7mw392hxXRG7MrDDApWoRu", fees: { ...LOCAL.fees, createAssetTxFee: 2_000_000n } }
    const node = mockNode({}, dev as any)
    const client = new DijetsClient({ network: defineNetwork({ networkID: 1337, nodeUrl: URL_ }), fetch: node.fetch })
    expect(client.hrp).toBe("custom")
    expect(() => client.vChain).toThrow(DijetsConfigError)
    const report = await client.discover()
    expect(report.filled).toEqual(["V-Chain ID", "U-Chain ID", "DJT asset ID", "U-Chain EVM chain ID"])
    expect(report.differences).toEqual([{ field: "fees.createAssetTxFee", preset: "1000000", node: "2000000" }])
    expect(client.vChain.getBlockchainID()).toBe(dev.chains.V.id)
    expect(client.vChain.getCreationTxFee().toString()).toBe("2000000")
  })

  test("refuses two clients with different chains for one network ID in a process", async () => {
    const a = mockNode({}, { ...LOCAL, networkID: 4242, chains: { ...LOCAL.chains, V: { id: "2DeMcqEBxHgER88uMcWSFrQfFLCeRmeu4QYK5FMDcgjQgmzXLv" } } } as any)
    const b = mockNode({}, { ...LOCAL, networkID: 4242 } as any)
    await DijetsClient.connect({ network: defineNetwork({ networkID: 4242, nodeUrl: URL_ }), fetch: a.fetch })
    await expect(DijetsClient.connect({ network: defineNetwork({ networkID: 4242, nodeUrl: URL_ }), fetch: b.fetch })).rejects.toThrow(/already in use in this process/)
  })
})

describe("configuration", () => {
  test("a placeholder node URL is a clear error, not a request", () => {
    expect(() => new DijetsClient({ network: "mainnet" })).toThrow(/mainnet node URL is not configured \(placeholder\)/)
  })
  test("rejects non-http URLs", () => {
    expect(() => new DijetsClient({ network: "local", url: "ftp://x" })).toThrow(DijetsConfigError)
  })
  test("sends configured headers and the auth token on every call", async () => {
    const node = mockNode()
    const c = new DijetsClient({ network: "local", url: URL_, fetch: node.fetch, headers: { "X-Org": "dijets" }, authToken: "tok" })
    await c.info.getNetworkID()
    expect(node.calls[0].headers).toMatchObject({ "X-Org": "dijets", Authorization: "Bearer tok" })
  })
})

describe("errors", () => {
  test("JSON-RPC errors keep their code and data", async () => {
    const node = mockNode({ "avm.getTxStatus": () => { throw { code: -32000, message: "boom", data: { reason: "x" } } } })
    const c = new DijetsClient({ network: "local", url: URL_, fetch: node.fetch })
    const e = await c.vChain.getTxStatus("x").catch((e) => e)
    expect(e).toBeInstanceOf(DijetsRpcError)
    expect(e).toMatchObject({ method: "avm.getTxStatus", rpcCode: -32000, data: { reason: "x" } })
  })
  test("HTTP errors are thrown, not returned", async () => {
    const node = mockNode({ "info.getNodeID": () => new Response("bad gateway", { status: 502 }) })
    const c = new DijetsClient({ network: "local", url: URL_, fetch: node.fetch })
    await expect(c.info.getNodeID()).rejects.toMatchObject({ status: 502 })
    await expect(c.info.getNodeID()).rejects.toBeInstanceOf(DijetsHttpError)
  })
  test("timeouts abort the request", async () => {
    const hang = ((_u: string, init: any) =>
      new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))) as any
    const c = new DijetsClient({ network: "local", url: URL_, fetch: hang, timeoutMs: 20 })
    await expect(c.info.getNodeID()).rejects.toBeInstanceOf(DijetsTimeoutError)
  })
})

describe("chain clients use Dijets paths and method names", () => {
  test("V, M and U", async () => {
    const node = mockNode({
      "avm.getTxStatus": () => ({ status: "Accepted" }),
      "platform.getHeight": () => ({ height: "12" }),
      "djtx.getAtomicTxStatus": () => ({ status: "Accepted" }),
      "platform.exportDJTX": () => ({ txID: "t1" }),
      "djtx.exportDJTX": () => ({ txID: "t2" }),
      eth_getBalance: () => "0x3b9aca00"
    })
    const c = new DijetsClient({ network: "local", url: URL_, fetch: node.fetch })
    await c.vChain.getTxStatus("x")
    await c.mChain.getHeight()
    await c.uChain.getAtomicTxStatus("x")
    expect(await c.mChain.exportDJT("u", "p", "V-local1x", 5n)).toBe("t1")
    expect(await c.uChain.exportDJT("u", "p", "V-local1x", new BN(5))).toBe("t2")
    expect(await c.uChainEvm.getBalance("0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC")).toBe(1_000_000_000n)
    expect(node.calls.map((x) => `${x.path} ${x.method}`)).toEqual([
      "/ext/bc/V avm.getTxStatus",
      "/ext/bc/M platform.getHeight",
      "/ext/bc/U/djtx djtx.getAtomicTxStatus",
      "/ext/bc/M platform.exportDJTX",
      "/ext/bc/U/djtx djtx.exportDJTX",
      "/ext/bc/U/rpc eth_getBalance"
    ])
  })
  test("keychains produce V-, M- and U- addresses for the network", () => {
    const c = new DijetsClient({ network: "local", url: URL_ })
    const key = "PrivateKey-ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN"
    expect(c.vChain.keyChain().importKey(key).getAddressString()).toBe("V-local18jma8ppw3nhx5r4ap8clazz0dps7rv5u00z96u")
    expect(c.mChain.keyChain().importKey(key).getAddressString()).toBe("M-local18jma8ppw3nhx5r4ap8clazz0dps7rv5u00z96u")
    expect(c.uChain.keyChain().importKey(key).getAddressString()).toBe("U-local18jma8ppw3nhx5r4ap8clazz0dps7rv5u00z96u")
  })
  test("index paths", async () => {
    const node = mockNode({ "index.getLastAccepted": () => ({ id: "x", bytes: "0x", timestamp: "", encoding: "hex", index: "0" }) })
    const c = new DijetsClient({ network: "local", url: URL_, fetch: node.fetch })
    await c.index.V.tx.getLastAccepted()
    await c.index.V.vertex.getLastAccepted()
    await c.index.M.block.getLastAccepted()
    await c.index.arc("abc").tx.getLastAccepted()
    expect(node.calls.map((x) => x.path)).toEqual(["/ext/index/V/tx", "/ext/index/V/vtx", "/ext/index/M/block", "/ext/index/abc/tx"])
  })
  test("an Arc chain has no atomic import or export", async () => {
    const c = new DijetsClient({ network: "local", url: URL_ })
    const arc = c.arcChain("28vcu7VaHmh4XMbagjioa1iWNaS82LfDmRGYuydeQYLYZ2MAwZ", { feeAssetID: LOCAL.djtAssetID as string }) as any
    await expect(arc.buildExportTx()).rejects.toBeInstanceOf(DijetsUnsupportedError)
    expect(arc.getBaseURL()).toBe("/ext/bc/28vcu7VaHmh4XMbagjioa1iWNaS82LfDmRGYuydeQYLYZ2MAwZ")
  })
})

describe("names", () => {
  const at = { blockID: "b", height: "3", chainTime: "1000" }
  const record = (status: string, extra: object = {}) => ({
    name: "alice", status, target: "V-local18jma8ppw3nhx5r4ap8clazz0dps7rv5u00z96u", targetID: "t",
    owner: { threshold: "1", locktime: "0", addresses: ["M-local18jma8ppw3nhx5r4ap8clazz0dps7rv5u00z96u"] },
    expiry: "5000", revoked: false, generation: "1", version: "2", recordID: "r", lastTxID: "l", registeredAt: "1", updatedAt: "1", ...extra
  })
  const client = (resolve: any) =>
    new DijetsClient({ network: "local", url: URL_, fetch: mockNode({ "names.resolve": resolve }).fetch })

  test("pays only an ACTIVE name, and returns the evidence", async () => {
    const r = await client(() => ({ input: "Alice", name: "alice", status: "ACTIVE", resolvable: true, record: record("ACTIVE"), at })).names.resolveForPayment("@Alice")
    expect(r).toMatchObject({ name: "alice", address: "V-local18jma8ppw3nhx5r4ap8clazz0dps7rv5u00z96u", version: 2n, at: { height: 3n } })
  })
  test("refuses EXPIRED, NOT_FOUND and names that expire too soon", async () => {
    await expect(client(() => ({ input: "a", name: "alice", status: "EXPIRED", resolvable: false, record: record("EXPIRED"), at })).names.resolveForPayment("alice")).rejects.toThrow(/status is EXPIRED/)
    await expect(client(() => ({ input: "a", name: "alice", status: "NOT_FOUND", resolvable: false, at })).names.resolveForPayment("alice")).rejects.toThrow(/NOT_FOUND/)
    await expect(client(() => ({ input: "a", name: "alice", status: "ACTIVE", resolvable: true, record: record("ACTIVE"), at })).names.resolveForPayment("alice", 4001n)).rejects.toThrow(/expires too soon/)
  })
  test("refuses a target on another network", async () => {
    const other = record("ACTIVE", { target: "V-dijets18jma8ppw3nhx5r4ap8clazz0dps7rv5ujq54md" })
    await expect(client(() => ({ input: "a", name: "alice", status: "ACTIVE", resolvable: true, record: other, at })).names.resolveForPayment("alice")).rejects.toThrow(/is for network "dijets", not "local"/)
  })
  test("rejects a bad name locally, before asking the node", async () => {
    const node = mockNode()
    const c = new DijetsClient({ network: "local", url: URL_, fetch: node.fetch })
    await expect(c.names.resolveForPayment("v-alice")).rejects.toMatchObject({ rule: "chain_prefix" })
    expect(node.calls).toHaveLength(0)
  })
  test("maps the node's invalid_name reason to a DijetsNameError", async () => {
    const c = client(() => { throw { code: -32602, message: "invalid name", data: { reason: "invalid_name:reserved" } } })
    const e = await c.names.resolve("dijets").catch((e) => e)
    expect(e).toBeInstanceOf(DijetsNameError)
    expect(e.rule).toBe("reserved")
  })
  test("reports a node without the registry as unsupported", async () => {
    const c = new DijetsClient({ network: "local", url: URL_, fetch: mockNode().fetch })
    expect(await c.names.isActive()).toBe(false)
  })
})

describe("Arc health", () => {
  const obs = (o: object) => ({ lifecycle: "ACTIVE", registered: true, operational: true, healthy: true, reasons: [], trackedByNode: true, observedAt: "2026-10-25T10:00:00Z", observerNode: "n", source: "local-observation", ...o })
  const now = new Date("2026-10-25T10:00:10Z")
  test("never reports healthy for stale, untracked or unknown states", () => {
    expect(assessHealth(obs({}), now)).toBe("healthy")
    expect(assessHealth(obs({ healthy: false }), now)).toBe("degraded")
    expect(assessHealth(obs({}), new Date("2026-10-25T10:01:00Z"))).toBe("unknown")
    expect(assessHealth(obs({ trackedByNode: false }), now)).toBe("unknown")
    expect(assessHealth(obs({ lifecycle: "SOMETHING_NEW" }), now)).toBe("unknown")
    expect(assessHealth(obs({ lifecycle: "FAILED" }), now)).toBe("failed")
    expect(assessHealth(null, now)).toBe("unknown")
  })
})
