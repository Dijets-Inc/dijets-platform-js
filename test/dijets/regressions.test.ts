// One test per bug found in ~/Documents/wellar2/patches/avalanche+3.15.2.patch
// (numbers as in M0-reconnaissance.md, "Bugs in the existing patches").
import { DijetsClient, HRP_TO_NETWORK_ID, NETWORK_ID_TO_HRP, LOTHAR, LOCAL, MAINNET, parseAddress, isPlaceholder, DJT } from "../../src"
import BinTools from "../../src/upstream/utils/bintools"
import { Defaults } from "../../src/upstream/utils/constants"
import { nodeAddresses } from "./vectors"
import { mockNode } from "./mocknode"

describe("platform patch regressions", () => {
  test("#1 a dijets1… address maps back to network 1 (patch had djtx: 1)", () => {
    expect(HRP_TO_NETWORK_ID.dijets).toBe(1)
    expect(HRP_TO_NETWORK_ID).not.toHaveProperty("djtx")
    const a = nodeAddresses.addresses.find((x) => x.hrp === "dijets")!.address
    expect(parseAddress(a).networkID).toBe(1)
  })

  test("#2 lothar and testing are in both HRP tables", () => {
    expect(NETWORK_ID_TO_HRP[5]).toBe("lothar")
    expect(NETWORK_ID_TO_HRP[10]).toBe("testing")
    expect(HRP_TO_NETWORK_ID.lothar).toBe(5)
    expect(HRP_TO_NETWORK_ID.testing).toBe(10)
  })

  test("#3 network 5 is Lothar, not Avalanche Fuji", () => {
    expect(LOTHAR.hrp).toBe("lothar")
    expect(LOTHAR.chains.U.evmChainID).toBe(381932)
    expect(LOTHAR.chains.V.id).not.toBe("2JVSBoinj9C2J33VntvzYtVJNZdN2NKiwwKjcumHUWEb5DbBrm")
    expect(Defaults.network[5].hrp).toBe("lothar")
  })

  test("#4 mainnet V-Chain and asset IDs are the genesis ones (patch had hgBiUr…, wjcHr7…)", () => {
    expect(MAINNET.chains.V.id).toBe("2abk8oCqF74M1L2UhsPGe1MMXoEkRVubGZxV1Nfn7aF5s5T8fM")
    expect(MAINNET.djtAssetID).toBe("2U4xzjHGnxXKWzFKqVZVMEnnepKFRNcBC75346X129Nj7uzyP1")
  })

  test("#5 the native asset is looked up by the node's alias DJT, not DJTX", async () => {
    const node = mockNode()
    await DijetsClient.connect({ network: "local", url: "http://n:9650", fetch: node.fetch })
    expect(node.calls.find((c) => c.method === "avm.getAssetDescription")?.params).toEqual({ assetID: "DJT" })
  })

  test("#6 a client uses its own network's IDs, not network 1's", () => {
    const local = new DijetsClient({ network: "local", url: "http://n:9650" })
    expect(local.vChain.getBlockchainID()).toBe(LOCAL.chains.V.id)
    const lothar = new DijetsClient({ network: "lothar", url: "http://n:9650" })
    expect(lothar.vChain.getBlockchainID()).toBe(LOTHAR.chains.V.id)
    expect(lothar.hrp).toBe("lothar")
  })

  test("#7 the local network's EVM chain ID is 43112 (patch had 43114) and its IDs are its own", () => {
    expect(LOCAL.chains.U.evmChainID).toBe(43112)
    expect(LOCAL.chains.V.id).not.toBe(LOTHAR.chains.V.id)
  })

  test("#8 supply cap and fees are per network", () => {
    expect(MAINNET.staking.supplyCap).toBe(111_111_111n * DJT)
    expect(LOTHAR.staking.supplyCap).toBe(666_666_666n * DJT)
    expect(LOCAL.staking.supplyCap).toBe(720_000_000n * DJT)
    expect(LOTHAR.fees.createSubnetTxFee).toBe(DJT / 10n)
    expect(LOCAL.fees.createAssetTxFee).toBe(DJT / 1000n)
    expect(LOTHAR.staking.minValidatorStake).toBe(DJT)
  })

  test("#10 U-Chain paths use the U alias (the node has no C alias)", async () => {
    const node = mockNode({ eth_baseFee: () => "0x5d21dba00" })
    const c = new DijetsClient({ network: "local", url: "http://n:9650", fetch: node.fetch })
    await c.uChain.getBaseFee()
    expect(node.calls[0].path).toBe("/ext/bc/U/rpc")
  })

  test("#12 no network I/O on construction; an unset URL is a clear error", () => {
    const node = mockNode()
    new DijetsClient({ network: "local", url: "http://n:9650", fetch: node.fetch })
    expect(node.calls).toHaveLength(0)
    expect(isPlaceholder(MAINNET.endpoints.node)).toBe(true)
    expect(() => new DijetsClient({ network: "mainnet" })).toThrow(/placeholder/)
  })

  test("#13 address fixtures come from the node, and Avalanche HRPs are rejected", () => {
    const bt = BinTools.getInstance()
    for (const a of nodeAddresses.addresses.slice(0, 12)) expect(() => bt.stringToAddress(a.address)).not.toThrow()
    expect(() => bt.stringToAddress("X-avax1dcfyuug87xqayl4fpp02z9dvknwhafdsjlw6m9")).toThrow(/Invalid HRP/)
    expect(() => parseAddress("V-avax1dcfyuug87xqayl4fpp02z9dvknwhafdsjlw6m9")).toThrow(/not a Dijets network/)
  })
})
