// A fake node for client tests: answers JSON-RPC by path and method, and
// records every request. Nothing here talks to a network.
import { LOCAL } from "../../src"

export interface Call {
  url: string
  path: string
  method: string
  params: any
  headers: Record<string, string>
}

type Handler = (params: any, call: Call) => unknown

export function mockNode(overrides: Record<string, Handler> = {}, preset = LOCAL) {
  const calls: Call[] = []
  const answers: Record<string, Handler> = {
    "info.getNetworkID": () => ({ networkID: String(preset.networkID) }),
    "info.getNodeVersion": () => ({ version: "Dijets/1.0.0" }),
    "info.getBlockchainID": (p) => ({ blockchainID: p.alias === "V" ? preset.chains.V.id : preset.chains.U.id }),
    "avm.getAssetDescription": () => ({ assetID: preset.djtAssetID, name: "Dijets", symbol: "DJT", denomination: "9" }),
    eth_chainId: () => `0x${Number(preset.chains.U.evmChainID).toString(16)}`,
    "info.getTxFee": () =>
      Object.fromEntries(Object.entries(preset.fees).map(([k, v]) => [k, String(v)])),
    ...overrides
  }
  const fetchImpl = (async (url: string, init: any) => {
    const u = new URL(url)
    const body = init?.body ? JSON.parse(init.body) : {}
    const call: Call = { url, path: u.pathname, method: body.method, params: body.params, headers: init.headers }
    calls.push(call)
    const h = answers[body.method]
    if (!h) return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `method ${body.method} not found` } }), { status: 200 })
    try {
      const result = h(body.params, call)
      if (result instanceof Response) return result
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 })
    } catch (e: any) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: e }), { status: 200 })
    }
  }) as unknown as typeof fetch
  return { calls, fetch: fetchImpl }
}
