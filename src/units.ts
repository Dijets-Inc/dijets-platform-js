/**
 * Amounts. The public API uses `bigint` nano-DJT (nDJT) for V- and M-Chain
 * amounts and `bigint` wei for U-Chain EVM amounts; conversions are exact.
 */
import BN from "bn.js"
import { DJT_DENOMINATION, WEI_PER_NDJT } from "./presets"

export type AmountLike = bigint | number | string | BN

/** Converts to `bigint`. Numbers must be safe integers; strings are integer amounts. */
export function toBigInt(v: AmountLike): bigint {
  if (typeof v === "bigint") return v
  if (BN.isBN(v)) return BigInt((v as BN).toString(10))
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new RangeError(`${v} is not a safe integer amount`)
    return BigInt(v)
  }
  if (!/^-?\d+$/.test(v)) throw new RangeError(`"${v}" is not an integer amount`)
  return BigInt(v)
}

/** @internal Upstream code takes BN. */
export const toBN = (v: AmountLike): BN => new BN(toBigInt(v).toString(10))

/**
 * Parses a decimal DJT string ("1.5") into nDJT. Rejects more than 9 decimals
 * rather than rounding.
 */
export function parseDJT(text: string, decimals: number = DJT_DENOMINATION): bigint {
  const t = text.trim()
  const m = /^(\d+)(?:\.(\d*))?$/.exec(t)
  if (!m) throw new RangeError(`"${text}" is not a DJT amount`)
  const frac = m[2] ?? ""
  if (frac.length > decimals) throw new RangeError(`"${text}" has more than ${decimals} decimals`)
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0")
}

/** Formats nDJT as a decimal DJT string without trailing zeros: 1500000000n → "1.5". */
export function formatDJT(amount: AmountLike, decimals: number = DJT_DENOMINATION): string {
  const n = toBigInt(amount)
  const neg = n < 0n
  const a = neg ? -n : n
  const base = 10n ** BigInt(decimals)
  const whole = a / base
  const frac = (a % base).toString().padStart(decimals, "0").replace(/0+$/, "")
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`
}

/** nDJT (V/M-Chain, 9 decimals) to wei (U-Chain, 18 decimals). */
export const nDJTToWei = (nDJT: AmountLike): bigint => toBigInt(nDJT) * WEI_PER_NDJT

/**
 * Wei to nDJT. Throws if the amount is not a whole number of nDJT, because
 * atomic transfers move whole nDJT and silently dropping wei would lose funds.
 */
export function weiToNDJT(wei: AmountLike): bigint {
  const w = toBigInt(wei)
  if (w % WEI_PER_NDJT !== 0n) throw new RangeError(`${w} wei is not a whole number of nDJT`)
  return w / WEI_PER_NDJT
}
