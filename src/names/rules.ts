/**
 * The name registry's rules, ported from dijetsnodesgo
 * vms/platformvm/names (name.go, record.go, claims.go). These must match the
 * node exactly: a transaction must carry a name that passes `validateName`
 * unchanged, and every client must canonicalise input the same way.
 */
import { DijetsNameError } from "../errors"

export const MIN_NAME_LENGTH = 3
export const MAX_NAME_LENGTH = 32

/** The node's rule identifiers, reported by the API as `invalid_name:<rule>`. */
export type NameRule =
  | "empty"
  | "non_ascii"
  | "too_short"
  | "too_long"
  | "character"
  | "first_character"
  | "last_character"
  | "double_hyphen"
  | "chain_prefix"
  | "hierarchical"
  | "reserved"
  | "not_canonical"

const RESERVED = new Set([
  "dijets", "djt", "djtx", "admin", "administrator", "root", "system", "validator", "validators",
  "treasury", "foundation", "official", "support", "security", "wallet", "explorer", "bridge", "null",
  "undefined", "none", "unknown", "anonymous", "everyone", "self", "me", "names", "registry"
])

const RULE_TEXT: Record<NameRule, string> = {
  empty: "is empty",
  non_ascii: "contains non-ASCII characters",
  too_short: `is shorter than ${MIN_NAME_LENGTH} characters`,
  too_long: `is longer than ${MAX_NAME_LENGTH} characters`,
  character: "may only contain a-z, 0-9 and -",
  first_character: "must start with a letter",
  last_character: "must end with a letter or digit",
  double_hyphen: 'may not contain "--"',
  chain_prefix: 'may not have "-" as its second character (it would look like a chain address)',
  hierarchical: 'may not contain "."',
  reserved: "is reserved",
  not_canonical: "must be lowercase"
}

const fail = (name: string, rule: NameRule): never => {
  throw new DijetsNameError(rule, `Name "${name}" ${RULE_TEXT[rule]}`)
}

const isLower = (c: number) => c >= 0x61 && c <= 0x7a
const isDigit = (c: number) => c >= 0x30 && c <= 0x39

/** Throws `DijetsNameError` unless `name` is a canonical, registrable name. */
export function validateName(name: string): void {
  if (name.length === 0) fail(name, "empty")
  // Go measures bytes; for ASCII names that equals characters, and any
  // non-ASCII input is rejected below either way.
  const bytes = new TextEncoder().encode(name)
  if (bytes.length < MIN_NAME_LENGTH) fail(name, "too_short")
  if (bytes.length > MAX_NAME_LENGTH) fail(name, "too_long")
  for (const c of bytes) {
    if (c >= 0x80) fail(name, "non_ascii")
    if (c === 0x2e) fail(name, "hierarchical")
    if (c >= 0x41 && c <= 0x5a) fail(name, "not_canonical")
    if (!isLower(c) && !isDigit(c) && c !== 0x2d) fail(name, "character")
  }
  const last = bytes[bytes.length - 1]
  if (!isLower(bytes[0])) fail(name, "first_character")
  if (!isLower(last) && !isDigit(last)) fail(name, "last_character")
  if (bytes[1] === 0x2d) fail(name, "chain_prefix")
  if (name.includes("--")) fail(name, "double_hyphen")
  if (RESERVED.has(name)) fail(name, "reserved")
}

// unicode.IsSpace, which Go's strings.TrimSpace uses. JavaScript's trim()
// differs (it also removes U+FEFF), so it is not used.
const GO_SPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000
])

function trimGoSpace(s: string): string {
  let start = 0
  let end = s.length
  while (start < end && GO_SPACE.has(s.charCodeAt(start))) start++
  while (end > start && GO_SPACE.has(s.charCodeAt(end - 1))) end--
  return s.slice(start, end)
}

/**
 * Converts user input to the canonical name: trims whitespace, strips one
 * leading "@", lowercases. Non-ASCII input is rejected, never transliterated.
 */
export function canonicaliseName(input: string): string {
  let name = trimGoSpace(input)
  if (name.startsWith("@")) name = name.slice(1)
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) >= 0x80) fail(input, "non_ascii")
  }
  name = name.toLowerCase()
  validateName(name)
  return name
}

export const isReservedName = (name: string): boolean => RESERVED.has(name)

/** Registry status. Computed from a record and the chain time, never stored. */
export type NameStatus = "NOT_FOUND" | "ACTIVE" | "EXPIRED" | "REVOKED" | "RELEASED"

/** As record.go StatusAt. Times are Unix seconds. */
export function nameStatusAt(
  record: { revoked: boolean; expiry: bigint; updatedAt: bigint } | undefined,
  now: bigint,
  gracePeriodSeconds: bigint
): NameStatus {
  if (!record) return "NOT_FOUND"
  if (record.revoked) return now < record.updatedAt + gracePeriodSeconds ? "REVOKED" : "RELEASED"
  if (now < record.expiry) return "ACTIVE"
  if (now < record.expiry + gracePeriodSeconds) return "EXPIRED"
  return "RELEASED"
}

/** Only an ACTIVE name may be paid to. */
export const isResolvable = (s: NameStatus): boolean => s === "ACTIVE"
export const isUpdatable = (s: NameStatus): boolean => s === "ACTIVE" || s === "EXPIRED"
export const isRegistrable = (s: NameStatus): boolean => s === "NOT_FOUND" || s === "RELEASED"

/** The payment memo the transaction service writes: "djtname/1 to=alice g=1 v=2". */
export const PAYMENT_MEMO_PREFIX = "djtname/1"

export interface PaymentMemo {
  name: string
  generation: bigint
  version: bigint
}

export const formatPaymentMemo = (m: PaymentMemo): string =>
  `${PAYMENT_MEMO_PREFIX} to=${m.name} g=${m.generation} v=${m.version}`

const U64 = /^\d+$/
const MAX_U64 = 2n ** 64n - 1n

/** As claims.go ParsePaymentMemo: exact form only, positive generation and version. */
export function parsePaymentMemo(memo: string): PaymentMemo | undefined {
  const f = memo.split(" ")
  if (f.length !== 4 || f[0] !== PAYMENT_MEMO_PREFIX || !f[1].startsWith("to=")) return undefined
  const name = f[1].slice(3)
  try {
    validateName(name)
  } catch {
    return undefined
  }
  const num = (field: string, prefix: string): bigint | undefined => {
    if (!field.startsWith(prefix)) return undefined
    const s = field.slice(prefix.length)
    if (!U64.test(s)) return undefined
    const n = BigInt(s)
    return n > 0n && n <= MAX_U64 ? n : undefined
  }
  const generation = num(f[2], "g=")
  const version = num(f[3], "v=")
  if (generation === undefined || version === undefined) return undefined
  const m = { name, generation, version }
  return formatPaymentMemo(m) === memo ? m : undefined
}
