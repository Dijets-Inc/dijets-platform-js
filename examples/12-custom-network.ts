// OFFLINE. Configure endpoints and networks without touching library internals.
import { DijetsClient, networks, withOverrides, defineNetwork } from "@dijets/platform-js"

// A preset with your own node.
const mainnet = withOverrides(networks.mainnet, { nodeUrl: "https://node.example.org:9650" })
console.log(mainnet.name, "→", mainnet.endpoints.node)

// A devnet: only the network ID and URL; chain and asset IDs are read from the node by connect().
const devnet = defineNetwork({ networkID: 1337, key: "my-devnet", nodeUrl: "http://127.0.0.1:19750", explorerUrl: "http://127.0.0.1:8090" })
const client = new DijetsClient({ network: devnet, headers: { "X-Team": "payments" }, timeoutMs: 10_000 })
console.log(client.network.name, "HRP", client.hrp, "→", client.transport.baseUrl)
