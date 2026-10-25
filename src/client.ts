/**
 * DijetsClient: one connection to one Dijets node.
 *
 *   const client = await DijetsClient.connect({ network: "local" })
 *   const status = await client.vChain.getTxStatus(txID)
 *
 * `connect()` checks the node against the configuration (network ID, chain
 * IDs, DJT asset ID, EVM chain ID) and fills in anything the configuration
 * leaves as a placeholder. `new DijetsClient()` makes no network calls and is
 * for offline use when every ID is already known.
 */
import BN from "bn.js"
import AvalancheCore from "./upstream/avalanche"
import { InfoAPI } from "./upstream/apis/info/api"
import { HealthAPI } from "./upstream/apis/health/api"
import { IndexAPI } from "./upstream/apis/index/api"
import { AdminAPI } from "./upstream/apis/admin/api"
import { AuthAPI } from "./upstream/apis/auth/api"
import { KeystoreAPI } from "./upstream/apis/keystore/api"
import { registerNetwork, toUpstreamNetwork } from "./upstream/utils/constants"
import { ArcChainAPI, MChainAPI, UChainAPI, UChainEvm, VChainAPI, type ArcChain, type MChain, type UChain, type VChain } from "./chains"
import { DijetsConfigError, DijetsError, DijetsNetworkMismatchError } from "./errors"
import { requireValue, resolveNetwork, type NetworkName } from "./networks"
import { DJT_SYMBOL, isPlaceholder, type Fees, type NetworkPreset } from "./presets"
import { adoptRpc, Transport } from "./rpc"
import { NamesAPI } from "./names/api"
import { ArcsAPI } from "./arcs"
import { ExplorerClient } from "./explorer"

export interface ClientOptions {
  /** A preset name or a network from `defineNetwork()` / `withOverrides()`. */
  network: NetworkName | NetworkPreset
  /** Node base URL. Overrides the preset's node endpoint. */
  url?: string
  /** Explorer base URL (optional service). Overrides the preset's explorer endpoint. */
  explorerUrl?: string
  headers?: Record<string, string>
  /** Node auth token (`Authorization: Bearer …`). */
  authToken?: string
  /** Per-request timeout in ms. Default 30 000. */
  timeoutMs?: number
  /** Custom fetch, e.g. for tests. */
  fetch?: typeof fetch
}

/** What `connect()` checked, and anything the node reported differently from the preset. */
export interface DiscoveryReport {
  networkID: number
  nodeVersion: string
  /** Values that were placeholders and were read from the node. */
  filled: string[]
  /** Values where the node is authoritative and differs from the preset (e.g. fees). */
  differences: { field: string; preset: string; node: string }[]
}

export class DijetsClient {
  /** The network as configured, with placeholders filled in by `connect()`. */
  network: NetworkPreset
  readonly transport: Transport
  /** @internal the upstream core used by the chain APIs. */
  readonly core: AvalancheCore
  readonly explorerUrl: string | undefined
  private readonly cache = new Map<string, unknown>()

  constructor(options: ClientOptions) {
    const preset = resolveNetwork(options.network)
    const url = options.url ?? requireValue(preset.endpoints.node, `${preset.name} node URL`)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new DijetsConfigError(`"${url}" is not a URL`)
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new DijetsConfigError(`Node URL must be http or https, not ${parsed.protocol}`)
    }
    this.network = preset
    this.transport = new Transport({
      baseUrl: url,
      headers: options.headers,
      authToken: options.authToken,
      timeoutMs: options.timeoutMs,
      fetch: options.fetch
    })
    const port = parsed.port ? Number(parsed.port) : undefined
    const core = new AvalancheCore(parsed.hostname, port, parsed.protocol.slice(0, -1))
    core.setAddress(parsed.hostname, port, parsed.protocol.slice(0, -1), parsed.pathname.replace(/\/+$/, ""))
    core.setNetworkID(preset.networkID)
    core.setHRP(preset.hrp)
    for (const [k, v] of Object.entries(options.headers ?? {})) core.setHeader(k, v)
    if (options.authToken) core.setAuthToken(options.authToken)
    if (options.timeoutMs) core.setRequestConfig("timeout", options.timeoutMs as unknown as string)
    this.core = core
    const explorer = options.explorerUrl ?? preset.endpoints.explorer
    this.explorerUrl = explorer && !isPlaceholder(explorer) ? (explorer as string) : undefined
    install(preset)
  }

  /** Creates a client and checks it against the node. */
  static async connect(options: ClientOptions): Promise<DijetsClient> {
    const client = new DijetsClient(options)
    await client.discover()
    return client
  }

  /**
   * Tries each configuration in order and returns the first node that answers
   * and matches. Errors from every attempt are collected if none does.
   */
  static async connectFirst(options: ClientOptions[]): Promise<DijetsClient> {
    const errors: string[] = []
    for (const o of options) {
      try {
        return await DijetsClient.connect(o)
      } catch (e) {
        if (e instanceof DijetsNetworkMismatchError) throw e
        errors.push(`${o.url ?? "(preset URL)"}: ${(e as Error).message}`)
      }
    }
    throw new DijetsError("HTTP", `No node answered:\n${errors.join("\n")}`)
  }

  get hrp(): string {
    return this.network.hrp
  }
  get networkID(): number {
    return this.network.networkID
  }

  /**
   * Reads the network's identity from the node, checks it against the
   * configuration, fills in placeholders, and applies the node's fees.
   */
  async discover(): Promise<DiscoveryReport> {
    const n = this.network
    const filled: string[] = []
    const differences: DiscoveryReport["differences"] = []
    const t = this.transport

    const networkID = Number(await t.call("/ext/info", "info.getNetworkID").then((r: any) => r.networkID))
    if (networkID !== n.networkID) {
      throw new DijetsNetworkMismatchError("network ID", String(n.networkID), String(networkID))
    }
    const nodeVersion: string = (await t.call("/ext/info", "info.getNodeVersion")).version

    const check = (field: string, expected: unknown, actual: string): string => {
      if (isPlaceholder(expected) || expected === undefined || expected === "") {
        filled.push(field)
        return actual
      }
      if (String(expected) !== actual) throw new DijetsNetworkMismatchError(field, String(expected), actual)
      return actual
    }

    const vID = check("V-Chain ID", n.chains.V.id, (await t.call("/ext/info", "info.getBlockchainID", { alias: "V" })).blockchainID)
    const uID = check("U-Chain ID", n.chains.U.id, (await t.call("/ext/info", "info.getBlockchainID", { alias: "U" })).blockchainID)
    const asset = await t.call("/ext/bc/V", "avm.getAssetDescription", { assetID: DJT_SYMBOL })
    const djt = check("DJT asset ID", n.djtAssetID, asset.assetID)
    const evmChainID = Number(
      check("U-Chain EVM chain ID", n.chains.U.evmChainID, String(Number(BigInt(await t.call("/ext/bc/U/rpc", "eth_chainId", [])))))
    )

    const nodeFees: Record<string, string> = await t.call("/ext/info", "info.getTxFee")
    const fees: Fees = { ...n.fees }
    for (const k of Object.keys(fees) as (keyof Fees)[]) {
      if (nodeFees[k] === undefined) continue
      const v = BigInt(nodeFees[k])
      if (v !== fees[k]) differences.push({ field: `fees.${k}`, preset: String(fees[k]), node: String(v) })
      fees[k] = v
    }

    this.network = {
      ...n,
      chains: { M: n.chains.M, V: { id: vID }, U: { id: uID, evmChainID } },
      djtAssetID: djt,
      fees
    }
    install(this.network)
    this.cache.clear()
    return { networkID, nodeVersion, filled, differences }
  }

  private memo<T>(key: string, make: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, make())
    return this.cache.get(key) as T
  }

  private known(value: unknown, what: string): string {
    if (isPlaceholder(value) || value === undefined || value === "") {
      throw new DijetsConfigError(`${what} is not known yet: call connect() (or discover()) first, or configure it`)
    }
    return value as string
  }

  private adopt<T extends { callMethod: any; getBaseURL: () => string }>(api: T): T {
    return adoptRpc(api, this.transport)
  }

  get info(): InfoAPI {
    return this.memo("info", () => this.adopt(new InfoAPI(this.core)))
  }
  get health(): HealthAPI {
    return this.memo("health", () => this.adopt(new HealthAPI(this.core)))
  }
  get admin(): AdminAPI {
    return this.memo("admin", () => this.adopt(new AdminAPI(this.core)))
  }
  get auth(): AuthAPI {
    return this.memo("auth", () => this.adopt(new AuthAPI(this.core)))
  }
  /** Node-side key storage. Keys held by a node are only as safe as the node; prefer local signing. */
  get keystore(): KeystoreAPI {
    return this.memo("keystore", () => this.adopt(new KeystoreAPI(this.core)))
  }
  /** Prometheus metrics text from /ext/metrics. */
  metrics(): Promise<string> {
    return this.transport.request("/ext/metrics")
  }

  get vChain(): VChain {
    return this.memo("V", () => {
      const api = this.adopt(new VChainAPI(this.core, "/ext/bc/V", this.known(this.network.chains.V.id, "V-Chain ID")))
      api.setDJTAssetID(this.known(this.network.djtAssetID, "DJT asset ID"))
      api.setTxFee(new BN(this.network.fees.txFee.toString()))
      api.setMintTxFee(new BN(this.network.fees.txFee.toString()))
      api.setCreationTxFee(new BN(this.network.fees.createAssetTxFee.toString()))
      return api
    })
  }

  get mChain(): MChain {
    return this.memo("M", () => {
      const api = this.adopt(new MChainAPI(this.core, "/ext/bc/M"))
      api.setDJTAssetID(this.known(this.network.djtAssetID, "DJT asset ID"))
      api.setTxFee(new BN(this.network.fees.txFee.toString()))
      api.setCreationTxFee(new BN(this.network.fees.createAssetTxFee.toString()))
      api.setMinStake(
        new BN(this.network.staking.minValidatorStake.toString()),
        new BN(this.network.staking.minDelegatorStake.toString())
      )
      return api
    })
  }

  /** U-Chain atomic API (import/export with V and M). */
  get uChain(): UChain {
    return this.memo("U", () => {
      const api = this.adopt(new UChainAPI(this.core, "/ext/bc/U/djtx", this.known(this.network.chains.U.id, "U-Chain ID")))
      api.setDJTAssetID(this.known(this.network.djtAssetID, "DJT asset ID"))
      return api
    })
  }

  /** U-Chain EVM JSON-RPC. */
  get uChainEvm(): UChainEvm {
    return this.memo("Uevm", () => new UChainEvm(this.transport))
  }

  /** The U-Chain RPC URL, for EVM libraries such as ethers or viem. */
  get uChainRpcUrl(): string {
    return this.transport.url("/ext/bc/U/rpc")
  }

  /**
   * Acceptance-ordered indexes. The node serves them only when started with
   * --index-enabled (and --index-subnet-chains for Arcs). On the V-Chain the
   * index position is acceptance order on the DAG, not a block height.
   */
  get index(): {
    V: { tx: IndexAPI; vertex: IndexAPI }
    M: { block: IndexAPI }
    U: { block: IndexAPI }
    arc: (chainID: string) => { tx: IndexAPI; vertex: IndexAPI }
  } {
    return this.memo("index", () => {
      const at = (p: string) => this.adopt(new IndexAPI(this.core, p))
      return {
        V: { tx: at("/ext/index/V/tx"), vertex: at("/ext/index/V/vtx") },
        M: { block: at("/ext/index/M/block") },
        U: { block: at("/ext/index/U/block") },
        arc: (chainID: string) => ({ tx: at(`/ext/index/${chainID}/tx`), vertex: at(`/ext/index/${chainID}/vtx`) })
      }
    })
  }

  /** The native name registry (M-Chain). */
  get names(): NamesAPI {
    return this.memo("names", () => new NamesAPI(this.transport, this.network))
  }

  /** Arcs: discovery, status and metadata from the M-Chain's arc service. */
  get arcs(): ArcsAPI {
    return this.memo("arcs", () => new ArcsAPI(this.transport))
  }

  /**
   * A client for one Arc's chain. The node must track the Arc's subnet. Pass
   * the Arc's fee asset (the first asset in its genesis) to build transactions.
   */
  arcChain(chainID: string, options: { feeAssetID?: string } = {}): ArcChain {
    return this.memo(`arc:${chainID}:${options.feeAssetID ?? ""}`, () => {
      const api = this.adopt(new ArcChainAPI(this.core, chainID, options.feeAssetID))
      api.setTxFee(new BN(this.network.fees.txFee.toString()))
      return api
    })
  }

  /** The explorer client, if an explorer URL is configured. */
  get explorer(): ExplorerClient {
    return this.memo("explorer", () => {
      if (!this.explorerUrl) {
        throw new DijetsConfigError("No explorer URL configured: pass { explorerUrl } to the client")
      }
      return new ExplorerClient({ baseUrl: this.explorerUrl, fetch: undefined })
    })
  }

}

/**
 * Makes upstream code that reads `Defaults.network` see this network. If two
 * clients in one process use the same network ID with different chain IDs
 * (for example two devnets), upstream's global table cannot hold both, so
 * the second is refused instead of silently mixing them.
 */
const installed = new Map<number, string[]>()
function install(n: NetworkPreset): void {
  const ids = [n.hrp, n.chains.V.id, n.chains.U.id, n.djtAssetID].map((v) => (isPlaceholder(v) ? "" : String(v)))
  const prev = installed.get(n.networkID)
  if (prev) {
    if (ids.some((v, i) => v !== "" && prev[i] !== "" && v !== prev[i])) {
      throw new DijetsConfigError(
        `Network ${n.networkID} is already in use in this process with different chain or asset IDs. ` +
          "Use one client per network ID per process."
      )
    }
    // A client that knows less (not yet connected) must not blank out what
    // another client has confirmed.
    if (ids.some((v, i) => v === "" && prev[i] !== "")) return
  }
  installed.set(n.networkID, ids)
  registerNetwork(n.networkID, toUpstreamNetwork(n))
}
