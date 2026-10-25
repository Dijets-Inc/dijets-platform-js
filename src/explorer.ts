/**
 * A client for the Dijets explorer's REST API (`GET /api/v1/...`). This is
 * an optional, separate service, not part of the node. It indexes what the
 * node does not keep: address history, name lookups with a fallback index,
 * Arc history and first-seen times.
 *
 * Every reply is `{apiVersion, data, page?, freshness, generatedAt}`; lists
 * page with `cursor` and `limit`. Explorer data is a cache of chain data: for
 * anything that decides funds or identity, confirm it with the node.
 */
import { DijetsError, DijetsHttpError, DijetsTimeoutError } from "./errors"

export interface ExplorerReply<T = any> {
  apiVersion: string
  data: T
  page?: { next: string | null; limit: number }
  /** The ingestion sources the reply was built from, with lag and staleness. */
  freshness?: { source: string; state?: string; lagSeconds?: number; stale?: boolean; [k: string]: unknown }[]
  generatedAt: string
}

export class DijetsExplorerError extends DijetsError {
  constructor(
    readonly status: number,
    readonly explorerCode: string,
    message: string
  ) {
    super("HTTP", `Explorer: ${message} (${explorerCode})`)
  }
}

type Query = Record<string, string | number | undefined>

export class ExplorerClient {
  readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: { baseUrl: string; fetch?: typeof fetch; timeoutMs?: number }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "")
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  /** GET /api/v1/<path>. */
  async get<T = any>(path: string, query: Query = {}): Promise<ExplorerReply<T>> {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") q.set(k, String(v))
    const url = `${this.baseUrl}/api/v1/${path.replace(/^\/+/, "")}${q.toString() ? `?${q}` : ""}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(url, { headers: { Accept: "application/json" }, signal: controller.signal })
    } catch (e) {
      if (controller.signal.aborted) throw new DijetsTimeoutError(url, this.timeoutMs)
      throw new DijetsHttpError(0, url, (e as Error).message)
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let body: any
    try {
      body = JSON.parse(text)
    } catch {
      throw new DijetsHttpError(res.status, url, text.slice(0, 200))
    }
    if (body?.error) throw new DijetsExplorerError(res.status, body.error.code, body.error.message)
    if (!res.ok) throw new DijetsHttpError(res.status, url, text.slice(0, 200))
    return body as ExplorerReply<T>
  }

  network = () => this.get("network")
  status = () => this.get("status")
  chains = () => this.get("chains")
  chain = (id: string) => this.get(`chains/${encodeURIComponent(id)}`)
  /** Recent transactions; `chain` is V, M, U or an Arc chain ID. */
  txs = (query: { chain?: string; type?: string; cursor?: string; limit?: number } = {}) => this.get("txs", query)
  tx = (id: string) => this.get(`txs/${encodeURIComponent(id)}`)
  vertex = (id: string) => this.get(`vertices/${encodeURIComponent(id)}`)
  mBlocks = (query: { cursor?: string; limit?: number } = {}) => this.get("blocks/M", query)
  mBlock = (idOrHeight: string) => this.get(`blocks/M/${encodeURIComponent(idOrHeight)}`)
  uBlocks = (query: { cursor?: string; limit?: number } = {}) => this.get("blocks/U", query)
  uBlock = (idOrHeight: string) => this.get(`blocks/U/${encodeURIComponent(idOrHeight)}`)
  /** Balances and, when registered, the name an address carries. */
  address = (address: string) => this.get(`addresses/${encodeURIComponent(address)}`)
  addressTxs = (address: string, query: { cursor?: string; limit?: number } = {}) =>
    this.get(`addresses/${encodeURIComponent(address)}/txs`, query)
  assets = () => this.get("assets")
  asset = (id: string) => this.get(`assets/${encodeURIComponent(id)}`)
  tokens = () => this.get("tokens")
  token = (address: string) => this.get(`tokens/${encodeURIComponent(address)}`)
  validators = (query: { subnet?: string } = {}) => this.get("validators", query)
  validator = (nodeID: string) => this.get(`validators/${encodeURIComponent(nodeID)}`)
  arcs = (query: { cursor?: string; limit?: number } = {}) => this.get("arcs", query)
  arc = (chainID: string) => this.get(`arcs/${encodeURIComponent(chainID)}`)
  arcEvents = (chainID: string, query: { cursor?: string; limit?: number } = {}) =>
    this.get(`arcs/${encodeURIComponent(chainID)}/events`, query)
  /** Name lookup: passes through the node's resolve/history, falling back to the explorer's index. */
  name = (name: string) => this.get(`names/${encodeURIComponent(name)}`)
  search = (q: string) => this.get("search", { q })
}
