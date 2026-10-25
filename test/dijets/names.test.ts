import { canonicaliseName, validateName, parsePaymentMemo, formatPaymentMemo, nameStatusAt, DijetsNameError } from "../../src"
import { nodeNames } from "./vectors"

const ruleOf = (f: () => unknown): string | undefined => {
  try {
    f()
    return undefined
  } catch (e) {
    expect(e).toBeInstanceOf(DijetsNameError)
    return (e as DijetsNameError).rule
  }
}

describe("name rules agree with the node", () => {
  test.each(nodeNames.names.map((v) => [JSON.stringify(v.input), v] as const))("%s", (_i, v: any) => {
    expect(ruleOf(() => validateName(v.input))).toBe(v.validateRule)
    if (v.canonical) expect(canonicaliseName(v.input)).toBe(v.canonical)
    else expect(ruleOf(() => canonicaliseName(v.input))).toBe(v.canonicaliseRule)
  })

  test.each(nodeNames.memos.map((m) => [m.memo, m] as const))("memo %s", (_m, m: any) => {
    const p = parsePaymentMemo(m.memo)
    expect(p !== undefined).toBe(m.valid)
    if (p) {
      expect([p.name, String(p.generation), String(p.version)]).toEqual([m.name, m.generation, m.version])
      expect(formatPaymentMemo(p)).toBe(m.memo)
    }
  })
})

describe("status", () => {
  const grace = 30n
  const r = { revoked: false, expiry: 1000n, updatedAt: 500n }
  test("follows record.go StatusAt", () => {
    expect(nameStatusAt(undefined, 0n, grace)).toBe("NOT_FOUND")
    expect(nameStatusAt(r, 999n, grace)).toBe("ACTIVE")
    expect(nameStatusAt(r, 1000n, grace)).toBe("EXPIRED")
    expect(nameStatusAt(r, 1030n, grace)).toBe("RELEASED")
    expect(nameStatusAt({ ...r, revoked: true }, 529n, grace)).toBe("REVOKED")
    expect(nameStatusAt({ ...r, revoked: true }, 530n, grace)).toBe("RELEASED")
  })
})
