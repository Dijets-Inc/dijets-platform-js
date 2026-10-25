/**
 * The V-, M- and U-Chain clients.
 *
 * Each is a thin subclass of the proven upstream implementation (AVM,
 * platformvm, coreth atomic API) configured for Dijets, adding DJT-named
 * methods. The exported types (`VChain`, `MChain`, `UChain`) leave out the
 * inherited AVAX-named methods, so the Dijets surface never needs them.
 */
import { Buffer } from "buffer/index.js"
import BN from "bn.js"
import { AVMAPI } from "./upstream/apis/avm/api"
import { PlatformVMAPI } from "./upstream/apis/platformvm/api"
import { EVMAPI } from "./upstream/apis/evm/api"
import type AvalancheCore from "./upstream/avalanche"
import BinTools from "./upstream/utils/bintools"
import { DijetsRpcError, DijetsTxError, DijetsUnsupportedError } from "./errors"
import { toBigInt } from "./units"
import type { Transport } from "./rpc"
import type { UTXOSet as MUTXOSet } from "./upstream/apis/platformvm/utxos"
import type { UnsignedTx as MUnsignedTx } from "./upstream/apis/platformvm/tx"
import { buildRegisterNameTx, buildUpdateNameTx, type RegisterNameArgs, type UpdateNameArgs } from "./names/builders"
import type { NameRecord } from "./names/api"

const bintools = BinTools.getInstance()

type AvaxNamed = "getAVAXAssetID" | "setAVAXAssetID"

/**
 * V-Chain: the AVM on Dijets' DAG engine. UTXO-based; transactions are
 * accepted by DAG consensus and have no block height or timestamp. Status
 * comes from `getTxStatus` (Processing, Accepted, Rejected, Unknown) and the
 * acceptance-ordered index (`client.index.V`).
 */
export class VChainAPI extends AVMAPI {
  /** The DJT asset ID. Cached; `refresh` asks the node again. */
  getDJTAssetID = (refresh: boolean = false): Promise<Buffer> => this.getAVAXAssetID(refresh)
  /** Sets the DJT asset ID (cb58 string or 32 bytes). */
  setDJTAssetID = (assetID: string | Buffer): void => this.setAVAXAssetID(assetID)
  /** DJT balance of an address in nDJT. */
  getDJTBalance = async (address: string): Promise<bigint> => {
    const id = bintools.cb58Encode(await this.getDJTAssetID())
    const r: any = await this.getBalance(address, id)
    return toBigInt(String(r.balance))
  }
}
export type VChain = Omit<VChainAPI, AvaxNamed>

/**
 * An Arc's chain: the same AVM as the V-Chain, at /ext/bc/<chainID>, on a
 * node that tracks the Arc's subnet. Its fee asset is the first asset in its
 * own genesis, not DJT, and atomic import/export is rejected across subnets,
 * so those builders are not offered.
 */
export class ArcChainAPI extends VChainAPI {
  constructor(core: AvalancheCore, chainID: string, feeAssetID?: string) {
    super(core, `/ext/bc/${chainID}`, chainID)
    // The node formats an un-aliased chain's addresses with its chain ID.
    this.setBlockchainAlias(chainID)
    if (feeAssetID) this.setAVAXAssetID(feeAssetID)
    const unsupported = (what: string) => async (): Promise<never> => {
      throw new DijetsUnsupportedError(`${what} is not possible on an Arc: atomic transfers are rejected across subnets`)
    }
    this.buildImportTx = unsupported("Import") as any
    this.buildExportTx = unsupported("Export") as any
  }
  /** The Arc's fee asset (the first asset in its genesis). */
  getFeeAssetID = (): Promise<Buffer> => this.getAVAXAssetID(false)
}
export type ArcChain = Omit<ArcChainAPI, AvaxNamed | "getDJTAssetID" | "setDJTAssetID" | "getDJTBalance" | "buildImportTx" | "buildExportTx">

// Upstream returns an error object instead of throwing in some places; with
// the Dijets transport RPC errors already throw, so anything else is a bug.
const txIDOf = (method: string, r: unknown): string => {
  if (typeof r === "string") return r
  throw new DijetsRpcError(method, undefined, `unexpected response ${JSON.stringify(r)}`)
}

type MAvaxNamed = AvaxNamed | "exportAVAX" | "importAVAX"

/**
 * M-Chain: the platform chain (validators, delegation, subnets, chain creation,
 * the name registry and Arcs). Snowman blocks, so heights are meaningful here.
 * On Lothar only Apricot transaction types are accepted; the builders
 * inherited here are all Apricot types, which every network accepts.
 */
export class MChainAPI extends PlatformVMAPI {
  getDJTAssetID = (refresh: boolean = false): Promise<Buffer> => this.getAVAXAssetID(refresh)
  setDJTAssetID = (assetID: string | Buffer): void => this.setAVAXAssetID(assetID)
  /**
   * Keystore-based export (`platform.exportDJTX`): the node signs with a key
   * held in its keystore. Prefer building and signing locally.
   */
  exportDJT = async (
    username: string,
    password: string,
    to: string,
    amount: bigint | BN
  ): Promise<string> => txIDOf("platform.exportDJTX", await this.exportAVAX(username, password, new BN(amount.toString()), to))
  /** Keystore-based import (`platform.importDJTX`). Prefer building and signing locally. */
  importDJT = async (username: string, password: string, to: string, sourceChain: string): Promise<string> =>
    txIDOf("platform.importDJTX", await this.importAVAX(username, password, to, sourceChain))

  constructor(core: AvalancheCore, baseURL: string = "/ext/bc/M") {
    super(core, baseURL)
    // Upstream's methods are fields set by its constructor, so wrap after super().
    const upstreamBuildCreateChainTx = this.buildCreateChainTx
    /**
     * As upstream, after checking the chain name the way the node does
     * (create_chain_tx.go: ASCII letters, digits and spaces only).
     */
    this.buildCreateChainTx = (utxoset, from, change, subnetID, chainName, ...rest) => {
      if (chainName !== undefined && !/^[A-Za-z0-9 ]*$/.test(chainName)) {
        return Promise.reject(new DijetsTxError(`Chain name "${chainName}" may only contain ASCII letters, digits and spaces`))
      }
      return upstreamBuildCreateChainTx(utxoset, from, change, subnetID, chainName, ...rest)
    }
  }

  private nameContext = async () => ({
    networkID: this.core.getNetworkID(),
    hrp: this.core.getHRP(),
    blockchainID: bintools.cb58Decode(this.getBlockchainID()),
    djtAssetID: await this.getDJTAssetID()
  })

  /**
   * An unsigned RegisterNameTx (name registry). Sign with the fee payer's
   * keys and the target's key, which consents to the name. Read the fee and
   * term limits from `client.names.params()`.
   */
  buildRegisterNameTx = async (
    utxoset: MUTXOSet,
    fromAddresses: string[],
    changeAddresses: string[],
    args: RegisterNameArgs
  ): Promise<MUnsignedTx> => buildRegisterNameTx(await this.nameContext(), utxoset, fromAddresses, changeAddresses, args)

  /**
   * An unsigned UpdateNameTx: renew, transfer, change target or revoke.
   * `current` is the record from `client.names.resolve()`; `ownerKeys` are
   * the current owner's addresses whose keys will sign.
   */
  buildUpdateNameTx = async (
    utxoset: MUTXOSet,
    fromAddresses: string[],
    changeAddresses: string[],
    current: NameRecord,
    ownerKeys: string[],
    args: UpdateNameArgs
  ): Promise<MUnsignedTx> =>
    buildUpdateNameTx(await this.nameContext(), utxoset, fromAddresses, changeAddresses, current, ownerKeys, args)
}
export type MChain = Omit<MChainAPI, MAvaxNamed>

/**
 * U-Chain atomic API (`djtx.*` at /ext/bc/U/djtx): import and export between
 * the U-Chain and the V/M-Chains. EVM access is `UChainEvm`.
 */
export class UChainAPI extends EVMAPI {
  getDJTAssetID = (refresh: boolean = false): Promise<Buffer> => this.getAVAXAssetID(refresh)
  setDJTAssetID = (assetID: string | Buffer): void => this.setAVAXAssetID(assetID)
  /** Keystore-based export (`djtx.exportDJTX`). Prefer building and signing locally. */
  exportDJT = (
    username: string,
    password: string,
    to: string,
    amount: bigint | BN
  ): Promise<string> => this.exportAVAX(username, password, to, new BN(amount.toString()))
  /** Keystore-based import (`djtx.importDJTX`). Prefer building and signing locally. */
  importDJT = (username: string, password: string, to: string, sourceChain: string): Promise<string> =>
    this.importAVAX(username, password, to, sourceChain)
}
export type UChain = Omit<UChainAPI, MAvaxNamed>

const hexToBigInt = (h: string): bigint => BigInt(h)
const toHex = (n: bigint | number): string => `0x${BigInt(n).toString(16)}`

/**
 * U-Chain EVM JSON-RPC (/ext/bc/U/rpc). A thin typed client for the common
 * calls; `request` reaches any other method. For a full EVM toolkit, use
 * `client.uChainProvider()` (an ethers provider).
 */
export class UChainEvm {
  constructor(
    private readonly transport: Transport,
    readonly path: string = "/ext/bc/U/rpc"
  ) {}

  request<T = any>(method: string, params: unknown[] = []): Promise<T> {
    return this.transport.call<T>(this.path, method, params)
  }
  chainId = async (): Promise<number> => Number(hexToBigInt(await this.request("eth_chainId")))
  blockNumber = async (): Promise<bigint> => hexToBigInt(await this.request("eth_blockNumber"))
  /** Balance in wei (18 decimals). */
  getBalance = async (address: string, block: string = "latest"): Promise<bigint> =>
    hexToBigInt(await this.request("eth_getBalance", [address, block]))
  getTransactionCount = async (address: string, block: string = "pending"): Promise<number> =>
    Number(hexToBigInt(await this.request("eth_getTransactionCount", [address, block])))
  gasPrice = async (): Promise<bigint> => hexToBigInt(await this.request("eth_gasPrice"))
  baseFee = async (): Promise<bigint> => hexToBigInt(await this.request("eth_baseFee"))
  maxPriorityFeePerGas = async (): Promise<bigint> =>
    hexToBigInt(await this.request("eth_maxPriorityFeePerGas"))
  estimateGas = async (tx: { from?: string; to?: string; data?: string; value?: bigint }): Promise<bigint> =>
    hexToBigInt(
      await this.request("eth_estimateGas", [
        { ...tx, value: tx.value === undefined ? undefined : toHex(tx.value) }
      ])
    )
  call = (tx: { from?: string; to: string; data?: string }, block: string = "latest"): Promise<string> =>
    this.request("eth_call", [tx, block])
  getTransactionByHash = (hash: string): Promise<any> => this.request("eth_getTransactionByHash", [hash])
  getTransactionReceipt = (hash: string): Promise<any> => this.request("eth_getTransactionReceipt", [hash])
  getBlockByNumber = (block: bigint | "latest", full: boolean = false): Promise<any> =>
    this.request("eth_getBlockByNumber", [block === "latest" ? block : toHex(block), full])
  /** Broadcasts a signed transaction; returns its hash. */
  sendRawTransaction = (signedHex: string): Promise<string> => this.request("eth_sendRawTransaction", [signedHex])
}
