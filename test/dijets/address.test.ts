import {
  parseAddress,
  formatAddress,
  isValidAddress,
  toChain,
  keyHashFromPublicKey,
  isEvmAddress,
  toEvmChecksumAddress,
  DijetsAddressError
} from "../../src"
import { nodeAddresses } from "./vectors"

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")

describe("addresses agree with the node's formatting", () => {
  test.each(nodeAddresses.addresses.map((a) => [a.address, a] as const))("%s", (_s, a) => {
    const p = parseAddress(a.address)
    expect(p.chain).toBe(a.chain)
    expect(p.hrp).toBe(a.hrp)
    expect(hex(p.bytes)).toBe(a.keyHashHex)
    expect(formatAddress(a.chain, a.hrp, p.bytes)).toBe(a.address)
    expect(hex(keyHashFromPublicKey(Buffer.from(a.publicKeyHex, "hex")))).toBe(a.keyHashHex)
  })
})

describe("parseAddress", () => {
  const ewoq = nodeAddresses.addresses.find((a) => a.chain === "V" && a.hrp === "local")!.address

  test("checks chain and network separately", () => {
    expect(() => parseAddress(ewoq, { chain: "M" })).toThrow(/is a V-Chain address; expected M/)
    expect(() => parseAddress(ewoq, { hrp: "dijets" })).toThrow(/is for network "local", not "dijets"/)
    expect(parseAddress(ewoq, { chain: ["V", "M"], hrp: "local" }).networkID).toBe(12345)
  })

  test("the same key has the same body on every chain", () => {
    expect(toChain(ewoq, "M")).toBe(ewoq.replace(/^V-/, "M-"))
  })

  test("accepts the node's VM aliases as chain prefixes", () => {
    expect(parseAddress(ewoq.replace(/^V-/, "avm-")).chain).toBe("V")
  })

  test("rejects a bad checksum, wrong length, missing prefix and EVM addresses", () => {
    const bad = ewoq.slice(0, -1) + (ewoq.endsWith("q") ? "p" : "q")
    expect(() => parseAddress(bad)).toThrow(DijetsAddressError)
    expect(() => parseAddress(ewoq.slice(2))).toThrow(/no chain prefix/)
    expect(() => parseAddress("0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC")).toThrow(/EVM address/)
    expect(isValidAddress("V-local1qqqqqqqq")).toBe(false)
  })

  test("Arc chain addresses use the chain ID as prefix", () => {
    const id = "28vcu7VaHmh4XMbagjioa1iWNaS82LfDmRGYuydeQYLYZ2MAwZ"
    const a = toChain(ewoq, id)
    expect(parseAddress(a, { chain: id }).chain).toBe(id)
  })
})

describe("EVM addresses", () => {
  test("validates EIP-55 checksums", () => {
    expect(isEvmAddress("0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC")).toBe(true)
    expect(isEvmAddress("0x8db97c7cece249c2b98bdc0226cc4c2a57bf52fc")).toBe(true)
    expect(isEvmAddress("0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52Fc")).toBe(false)
    expect(toEvmChecksumAddress("0x8db97c7cece249c2b98bdc0226cc4c2a57bf52fc")).toBe("0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC")
  })
})
