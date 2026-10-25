import { parseDJT, formatDJT, nDJTToWei, weiToNDJT, toBigInt } from "../../src"

describe("units", () => {
  test("parse and format DJT exactly", () => {
    expect(parseDJT("1.5")).toBe(1_500_000_000n)
    expect(parseDJT("0.000000001")).toBe(1n)
    expect(parseDJT("111111111")).toBe(111_111_111_000_000_000n)
    expect(() => parseDJT("0.0000000001")).toThrow(/more than 9 decimals/)
    expect(() => parseDJT("1e3")).toThrow()
    expect(() => parseDJT("-1")).toThrow()
    expect(formatDJT(1_500_000_000n)).toBe("1.5")
    expect(formatDJT(1n)).toBe("0.000000001")
    expect(formatDJT(0n)).toBe("0")
  })
  test("U-Chain conversions never drop wei", () => {
    expect(nDJTToWei(1n)).toBe(1_000_000_000n)
    expect(weiToNDJT(2_000_000_000n)).toBe(2n)
    expect(() => weiToNDJT(1_000_000_001n)).toThrow(/not a whole number of nDJT/)
  })
  test("rejects unsafe numbers", () => {
    expect(() => toBigInt(2 ** 60)).toThrow(/safe integer/)
    expect(() => toBigInt(1.5)).toThrow()
  })
})
