// Shared example configuration, read from the environment so no endpoint is
// hard-coded in the examples themselves:
//   DIJETS_NETWORK   mainnet | lothar | local | <network ID>   (default local)
//   DIJETS_NODE_URL  node base URL (required for mainnet, Lothar and custom IDs)
import { DijetsClient, defineNetwork, networks, type ClientOptions } from "@dijets/platform-js"

export function clientOptions(): ClientOptions {
  const net = process.env.DIJETS_NETWORK ?? "local"
  const url = process.env.DIJETS_NODE_URL
  if (net in networks) return { network: net as keyof typeof networks, url }
  if (!url) throw new Error("Set DIJETS_NODE_URL for a custom network ID")
  return { network: defineNetwork({ networkID: Number(net), nodeUrl: url }) }
}

export const connect = (): Promise<DijetsClient> => DijetsClient.connect(clientOptions())

/** Test-only key, funded only in local and dev genesis. Never use it on a public network. */
export const TEST_KEY = "PrivateKey-ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN"
