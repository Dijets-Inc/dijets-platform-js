/**
 * Dijets addresses.
 *
 * A V-, M- or Arc-chain address is `<chain>-<bech32>` where the bech32 part
 * encodes a 20-byte key hash under the network's HRP. The chain part names
 * the chain context (V, M, U, or an Arc's chain ID); the HRP names the network
 * context. They are independent: the same key has the same bech32 part on
 * every chain of a network. This mirrors dijetsnodesgo
 * utils/formatting/address and vms/components/djtx/addresses.go, which use
 * classic bech32 (not bech32m).
 *
 * U-Chain EVM accounts are 0x addresses; `U-…` bech32 addresses appear only in
 * atomic import/export.
 */
import { bech32 } from "bech32"
import { Buffer } from "buffer/index.js"
import createHash from "create-hash"
import { utils as ethersUtils } from "ethers"
import { DijetsAddressError } from "./errors"
import { HRP_TO_NETWORK_ID, FALLBACK_HRP } from "./presets"

export type ChainAlias = "V" | "M" | "U"
export const CHAIN_ALIASES: readonly ChainAlias[] = ["V", "M", "U"]

/** The node also accepts its VM aliases in place of V, M and U (genesis/aliases.go). */
const VM_ALIASES: Readonly<Record<string, ChainAlias>> = { avm: "V", platform: "M", evm: "U" }

export const ADDRESS_LENGTH = 20

export interface ParsedAddress {
  /** As written: "V", "M", "U", or a chain ID for an Arc. VM aliases are normalised to V/M/U. */
  chain: string
  hrp: string
  /** The network ID the HRP belongs to, or undefined for "custom". */
  networkID: number | undefined
  /** The 20-byte key hash. */
  bytes: Uint8Array
}

export interface AddressExpectation {
  /** Required chain context(s). Arc chains are named by chain ID. */
  chain?: string | readonly string[]
  /** Required network HRP, e.g. "dijets". */
  hrp?: string
}

/**
 * Parses and checks a bech32 chain address. Throws `DijetsAddressError` with a
 * specific reason: malformed, bad checksum, wrong chain, or wrong network.
 */
export function parseAddress(text: string, expect: AddressExpectation = {}): ParsedAddress {
  if (typeof text !== "string" || text.length === 0) throw new DijetsAddressError("Address is empty")
  if (isEvmAddress(text)) {
    throw new DijetsAddressError(
      `${text} is a U-Chain EVM address; this operation needs a bech32 chain address such as V-${expect.hrp ?? "dijets"}1…`
    )
  }
  const dash = text.indexOf("-")
  if (dash <= 0) throw new DijetsAddressError(`"${text}" has no chain prefix (expected e.g. "V-…")`)
  const rawChain = text.slice(0, dash)
  const chain = VM_ALIASES[rawChain] ?? rawChain
  let decoded: { prefix: string; words: number[] }
  try {
    decoded = bech32.decode(text.slice(dash + 1))
  } catch (e) {
    throw new DijetsAddressError(`"${text}" is not valid bech32: ${(e as Error).message}`)
  }
  const bytes = Uint8Array.from(bech32.fromWords(decoded.words))
  if (bytes.length !== ADDRESS_LENGTH) {
    throw new DijetsAddressError(`"${text}" encodes ${bytes.length} bytes, not ${ADDRESS_LENGTH}`)
  }
  const hrp = decoded.prefix
  if (!(hrp in HRP_TO_NETWORK_ID) && hrp !== FALLBACK_HRP) {
    throw new DijetsAddressError(`"${text}" uses network prefix "${hrp}", which is not a Dijets network`)
  }
  if (expect.hrp !== undefined && hrp !== expect.hrp) {
    throw new DijetsAddressError(`"${text}" is for network "${hrp}", not "${expect.hrp}"`)
  }
  if (expect.chain !== undefined) {
    const allowed = typeof expect.chain === "string" ? [expect.chain] : expect.chain
    if (!allowed.includes(chain)) {
      throw new DijetsAddressError(`"${text}" is a ${chain}-Chain address; expected ${allowed.join(" or ")}`)
    }
  }
  return { chain, hrp, networkID: HRP_TO_NETWORK_ID[hrp], bytes }
}

/** True when `text` parses and meets the expectation. */
export function isValidAddress(text: string, expect: AddressExpectation = {}): boolean {
  try {
    parseAddress(text, expect)
    return true
  } catch {
    return false
  }
}

/** Formats a 20-byte key hash for a chain and network. */
export function formatAddress(chain: string, hrp: string, bytes: Uint8Array): string {
  if (bytes.length !== ADDRESS_LENGTH) {
    throw new DijetsAddressError(`An address is ${ADDRESS_LENGTH} bytes, not ${bytes.length}`)
  }
  if (!chain || chain.includes("-")) throw new DijetsAddressError(`"${chain}" is not a chain prefix`)
  return `${chain}-${bech32.encode(hrp, bech32.toWords(bytes))}`
}

/** The same key's address on another chain of the same network. */
export const toChain = (text: string, chain: string): string => {
  const a = parseAddress(text)
  return formatAddress(chain, a.hrp, a.bytes)
}

/** The 20-byte key hash of a compressed secp256k1 public key: ripemd160(sha256(pub)). */
export function keyHashFromPublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 33) throw new DijetsAddressError("Expected a 33-byte compressed public key")
  const sha = createHash("sha256").update(Buffer.from(publicKey)).digest()
  return Uint8Array.from(createHash("ripemd160").update(sha).digest())
}

/** True for a 0x EVM address. Mixed-case addresses must carry a valid EIP-55 checksum. */
export function isEvmAddress(text: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) return false
  const body = text.slice(2)
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true
  try {
    return ethersUtils.getAddress(text) === text
  } catch {
    return false
  }
}

/** Validates a U-Chain EVM address and returns it with an EIP-55 checksum. */
export function toEvmChecksumAddress(text: string): string {
  if (!isEvmAddress(text)) throw new DijetsAddressError(`"${text}" is not a valid 0x address`)
  return ethersUtils.getAddress(text)
}

/** The EVM address of a secp256k1 public key (compressed or uncompressed). */
export const evmAddressFromPublicKey = (publicKey: Uint8Array): string =>
  ethersUtils.computeAddress(publicKey)
