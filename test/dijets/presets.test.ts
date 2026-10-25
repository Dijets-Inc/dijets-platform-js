import { MAINNET, LOTHAR, LOCAL, PRESETS, NETWORK_ID_TO_HRP, HRP_TO_NETWORK_ID, FALLBACK_HRP, isPlaceholder, hrpForNetworkID } from "../../src"
import { nodeNetworks } from "./vectors"

const byID = new Map(PRESETS.map((p) => [p.networkID, p]))

describe("presets match the node's genesis", () => {
  test.each(nodeNetworks.networks.map((n) => [n.networkID, n] as const))("network %i", (_id, n) => {
    const p = byID.get(n.networkID)!
    expect(p).toBeDefined()
    expect(p.hrp).toBe(n.hrp)
    expect(p.chains.M.id).toBe(n.mChain)
    expect(p.chains.V.id).toBe(n.vChain)
    // Mainnet's U-Chain ID is deliberately a placeholder (see presets.ts).
    if (isPlaceholder(p.chains.U.id)) expect(n.networkID).toBe(1)
    else expect(p.chains.U.id).toBe(n.uChain)
    expect(p.chains.U.evmChainID).toBe(n.evmChainID)
    expect(p.djtAssetID).toBe(n.djtAssetID)
    for (const [k, v] of Object.entries(n.fees)) expect([k, String((p.fees as any)[k])]).toEqual([k, v])
    const s = p.staking
    expect(String(s.minValidatorStake)).toBe(n.staking.minValidatorStake)
    expect(String(s.maxValidatorStake)).toBe(n.staking.maxValidatorStake)
    expect(String(s.minDelegatorStake)).toBe(n.staking.minDelegatorStake)
    expect(String(s.minDelegationFee)).toBe(n.staking.minDelegationFee)
    expect(String(s.minStakeDuration)).toBe(n.staking.minStakeDuration)
    expect(String(s.maxStakeDuration)).toBe(n.staking.maxStakeDuration)
    expect(String(s.supplyCap)).toBe(n.staking.supplyCap)
    expect(String(s.minConsumptionRate)).toBe(n.staking.minConsumptionRate)
    expect(String(s.maxConsumptionRate)).toBe(n.staking.maxConsumptionRate)
    expect(p.features.banff).toBe(n.banffActive)
    expect(p.features.naming).toBe(n.namingActive)
  })

  test("HRP tables are the node's, in both directions", () => {
    const node = Object.fromEntries(Object.entries(nodeNetworks.networkIDToHRP).map(([k, v]) => [Number(k), v]))
    expect(NETWORK_ID_TO_HRP).toEqual(node)
    for (const [id, hrp] of Object.entries(node)) expect(HRP_TO_NETWORK_ID[hrp]).toBe(Number(id))
    expect(FALLBACK_HRP).toBe(nodeNetworks.fallbackHRP)
    expect(hrpForNetworkID(1337)).toBe("custom")
  })

  test("placeholders: mainnet and Lothar node URLs; nothing else", () => {
    expect(isPlaceholder(MAINNET.endpoints.node)).toBe(true)
    expect(isPlaceholder(LOTHAR.endpoints.node)).toBe(true)
    expect(LOCAL.endpoints.node).toBe("http://127.0.0.1:9650")
    for (const p of PRESETS) {
      expect(isPlaceholder(p.chains.V.id)).toBe(false)
      expect(isPlaceholder(p.chains.U.id)).toBe(false)
      expect(isPlaceholder(p.djtAssetID)).toBe(false)
    }
  })
})
