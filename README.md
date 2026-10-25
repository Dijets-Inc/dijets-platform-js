# @dijets/platform-js

The TypeScript library for Dijets nodes. It covers:

- **Clients** for the V-, M- and U-Chains, plus the node APIs.
- **Addresses:** a codec that checks chain and network.
- **Transactions:** building, signing and parsing.
- **Native naming:** the registry and its transactions.
- **Arcs:** their discovery and status.

> **Not published.** The package is `"private": true` so it cannot be published by accident. Build it locally and depend on it by path (see [Use it](#use-it)).

| Dijets chain | What it is | Consensus | Endpoint |
|---|---|---|---|
| **V-Chain** | AVM: assets and UTXO transfers | DAG (vertices). No block heights or timestamps | `/ext/bc/V` |
| **M-Chain** | Platform: validators, delegation, subnets, chain creation, the name registry, Arcs | Snowman blocks | `/ext/bc/M` |
| **U-Chain** | EVM, with atomic import and export to V and M | Snowman blocks | `/ext/bc/U/rpc`, `/ext/bc/U/djtx` |

The library is derived from avalanche.js 3.15.2 (see [UPSTREAM.md](UPSTREAM.md)). Ordinary use needs no Avalanche names: there are no X/P/C chains and no AVAX methods.

## Quick start

```ts
import { DijetsClient, formatDJT } from "@dijets/platform-js"

const client = await DijetsClient.connect({ network: "local" }) // http://127.0.0.1:9650
const balance = await client.vChain.getDJTBalance("V-local18jma8ppw3nhx5r4ap8clazz0dps7rv5u00z96u")
console.log(formatDJT(balance), "DJT")
```

`connect()` reads the node's identity and checks it against the configuration:

- network ID;
- V- and U-Chain IDs;
- DJT asset ID;
- U-Chain EVM chain ID.

It fills in any value the configuration leaves as a placeholder. If the node reports something different, it throws `DijetsNetworkMismatchError`, so a wrong URL can't send you to the wrong network. `new DijetsClient(...)` makes no network calls, which suits offline signing when every ID is known.

## Networks

| Preset | ID | HRP | Node URL | Status |
|---|---|---|---|---|
| `mainnet` | 1 | `dijets` | **placeholder** | IDs from the node's genesis. The U-Chain ID is a **placeholder** (unresolved; read from the node on connect) |
| `lothar` | 5 | `lothar` | **placeholder** | IDs from the node's genesis, not yet confirmed against a live Lothar node |
| `local` | 12345 | `local` | `http://127.0.0.1:9650` | IDs from the node's genesis |

All constants live in one file, [`src/presets.ts`](src/presets.ts), with their sources. An unconfirmed value is a `placeholder(...)`. Using one throws a `DijetsConfigError` saying what is missing and how to supply it. Nothing falls back to a made-up URL.

```ts
import { DijetsClient, networks, withOverrides, defineNetwork } from "@dijets/platform-js"

// Your own mainnet node:
await DijetsClient.connect({ network: "mainnet", url: "https://node.example.org:9650" })
// Or as a reusable preset:
const mainnet = withOverrides(networks.mainnet, { nodeUrl: "https://node.example.org:9650" })

// A devnet: chain and asset IDs are read from the node.
const devnet = defineNetwork({ networkID: 1337, nodeUrl: "http://127.0.0.1:19750" })
const client = await DijetsClient.connect({ network: devnet, headers: { "X-Team": "ops" }, authToken, timeoutMs: 10_000 })

// Several nodes: the first that answers and matches.
await DijetsClient.connectFirst([{ network: "local", url: urlA }, { network: "local", url: urlB }])
```

Protocol facts that vary by network:

- **Banff transaction types are not accepted on mainnet or Lothar.** Every M-Chain builder in this library uses the Apricot types, which work on all networks.
- **The name registry is active only on local and custom networks.** Check with `client.names.isActive()`.

## Addresses

A chain address is `<chain>-<bech32>`. The chain part (`V`, `M`, `U`, or an Arc's chain ID) is the chain context. The bech32 HRP (`dijets`, `lothar`, `local`, `custom`) is the network context. The two are independent: one key has the same bech32 body on every chain of a network. The encoding is classic bech32, as in the node.

```ts
import { parseAddress, toChain, isValidAddress } from "@dijets/platform-js"

parseAddress("V-dijets1…", { chain: "V", hrp: "dijets" }) // throws DijetsAddressError naming the wrong part
toChain("V-dijets1…", "M")                                // the same key's M-Chain address
isValidAddress("V-avax1…")                                // false: not a Dijets network
```

U-Chain EVM accounts are `0x` addresses (`isEvmAddress`, `toEvmChecksumAddress`). Bech32 `U-…` addresses appear only in atomic import and export.

## Chains

`client.vChain`, `client.mChain` and `client.uChain` are the upstream AVM, platform and coreth-atomic clients, configured for Dijets. They add DJT-named methods (`getDJTAssetID`, `getDJTBalance`, `exportDJT`, `importDJT`), and their types leave out the AVAX-named ones.

```ts
// V-Chain: build, sign locally, submit, wait for DAG acceptance
const { utxos } = await client.vChain.getUTXOs([from])
const unsigned = await client.vChain.buildBaseTx(utxos, new BN(amount.toString()), await client.vChain.getDJTAssetID(), [to], [from], [from])
const txID = await client.vChain.issueTx(unsigned.sign(keychain))
await client.vChain.getTxStatus(txID) // "Processing" → "Accepted"

// M-Chain
await client.mChain.getCurrentValidators()
await client.mChain.buildAddValidatorTx(/* … */)

// U-Chain
await client.uChainEvm.getBalance("0x…")    // wei
await client.uChain.buildExportTx(/* … */) // atomic, to V or M
new ethers.providers.StaticJsonRpcProvider(client.uChainRpcUrl, chainId)
```

The acceptance-ordered indexes are `client.index.V.tx`, `.V.vertex`, `.M.block`, `.U.block` and `client.index.arc(chainID)`. On the V-Chain an index position is acceptance order, not a block height.

Low-level protocol types are grouped by chain: `vchain`, `mchain`, `uchain`, `common`, `utils`. These include transactions, outputs, credentials and keychains, and `vchain.Tx.fromBuffer`.

## Native names

The rules match `dijetsnodesgo/vms/platformvm/names` exactly (`canonicaliseName`, `validateName`). The read API is `names.*` at `/ext/bc/M/names`.

```ts
const pay = await client.names.resolveForPayment("@Alice")
// Accepts only an ACTIVE name, checks that the target is on this network,
// and returns the registry evidence: { address, recordID, version, at: { blockID, height } }
```

A display name is never treated as an identity: always resolve it before paying.

Registering and updating are M-Chain transactions you sign locally:

```ts
const p = await client.names.params()
const reg = await client.mChain.buildRegisterNameTx(utxos, [payer], [payer], {
  name: "alice", target: aliceV, owner: { addresses: [aliceM] }, expiry, registerFee: p.registerFee
})
await client.mChain.issueTx(reg.sign(keychainWithPayerAndTarget)) // the target signs to consent

const { record } = await client.names.resolve("alice")
const upd = await client.mChain.buildUpdateNameTx(utxos, [payer], [payer], record!, [aliceM], { expiry: later, updateFee: p.updateFee })
```

Listing names by owner, browsing and search need the explorer (see below), and listing by owner needs a route the explorer does not have yet. Auctions and a marketplace exist only in the names app's simulation, not in the protocol.

## Arcs

An Arc is an AVM chain on its own permissioned subnet. It is created and administered with ordinary signed M-Chain transactions:

1. `buildCreateSubnetTx`
2. `buildAddSubnetValidatorTx`, one per committee member
3. `buildCreateChainTx`

Committee operators must then whitelist the subnet on their nodes. The arc service is read-only:

```ts
const page = await client.arcs.list({ limit: 25 })     // counts.registered is authoritative
const arc = await client.arcs.get(chainID)             // descriptor (authoritative) + observation (this node)
assessHealth(arc.observation)                          // "unknown" if stale, untracked or an unknown lifecycle
await client.arcs.creationStatus({ subnetTxID, chainTxID })
const chain = client.arcChain(chainID, { feeAssetID }) // the Arc's own AVM, on a node that tracks it
```

What is authoritative and what is only observed:

- **Authoritative:** the descriptor and committee membership.
- **Observed by the answering node:** lifecycle, health and stats.

An Arc's fee asset is the first asset in its own genesis, not DJT. Atomic import and export are rejected across subnets, so an Arc chain client offers neither.

## Explorer (optional service)

`client.explorer` (configure `explorerUrl`) or `new ExplorerClient({ baseUrl })` covers the explorer's `GET /api/v1/...`:

- address history;
- names, with a fallback index;
- Arc history;
- search.

It is a cache of chain data. Confirm anything that decides funds or identity with the node.

## Errors

Every error is a `DijetsError` with a stable `code`:

| Class | Code | When |
|---|---|---|
| `DijetsConfigError` | `CONFIG` | Missing or placeholder configuration |
| `DijetsNetworkMismatchError` | `NETWORK_MISMATCH` | The node is on a different network or chain |
| `DijetsHttpError` | `HTTP` | Non-2xx response, or no response at all |
| `DijetsTimeoutError` | `TIMEOUT` | The request timed out |
| `DijetsRpcError` | `RPC` | JSON-RPC error, with `method`, `rpcCode` and `data` |
| `DijetsAddressError` | `ADDRESS` | Malformed address, or the wrong chain or network |
| `DijetsNameError` | `NAME` | A name breaks a rule; `rule` holds the node's rule identifier |
| `DijetsUnsupportedError` | `UNSUPPORTED` | The operation isn't available here |
| `DijetsTxError` | `TX` | A transaction can't be built |

Upstream's own error classes (low-level builders) are in `utils`.

## Amounts

- Public amounts are `bigint` nDJT, 9 decimals: `parseDJT("1.5")`, `formatDJT(n)`. Neither ever rounds.
- U-Chain EVM values are wei, 18 decimals: `nDJTToWei`, `weiToNDJT`. `weiToNDJT` refuses to drop a remainder.
- Upstream builders take `BN`.

## Security

- No API in this library accepts or sends a private key to a node. Keys sign locally (`*.keyChain()`). The keystore API (`client.keystore`, `exportDJT`, `importDJT`) is the node-side key storage and is documented as not recommended.
- `connect()` refuses a node whose network, chains or asset differ from the configuration. Building for a placeholder ID is impossible.
- In a browser, a page can read in-memory keys; keep signing in a separate context such as a wallet extension or worker, and use `@dijets/wallet-sdk` for encrypted key files.
- Dependencies are pinned. `npm audit --omit=dev` reports only the low-severity, unfixable `elliptic` advisory inherited by every ethers v5 package. The `ws` copy inside ethers is pinned to 8.22.0 with an npm `overrides` entry; applications should add the same:

  ```json
  "overrides": { "ws": "8.22.0" }
  ```

## Use it

```sh
cd dijets-platform-js
nvm use 22
npm install
npm run build        # dist/index.{cjs,mjs,d.ts}, then scripts/check-dist.mjs
```

In an application: `npm install ../Dijets-Libraries/dijets-platform-js`, or `npm pack` and install the tarball. Node 18+ and modern browsers (through a bundler) are supported. It uses `fetch` and `AbortController`.

## Tests

| Command | What | Network |
|---|---|---|
| `npm test` | The upstream suite (572) and the Dijets suite (160) | None (mocked fetch) |
| `npm run test:integration` | 9 live tests: V transfer, V → M, U EVM transfer, U → V, name register/renew/refusal, Arc creation | A real node: `DIJETS_NODE_URL=…` |
| `npm run typecheck`, `npm run lint` | Types; ESLint on the Dijets code | |

How the expected values are produced:

- **Golden vectors** (`test/vectors/*.json`) come from **dijetsnodesgo's own code**: networks, addresses, name rules, and signed V, M and U transactions. `scripts/vectors.sh` regenerates them (`DIJETSNODESGO=/path/to/dijetsnodesgo`). The library must reproduce every byte, transaction ID and signature.
- `test/dijets/regressions.test.ts` has one test per bug found in the old patches.

Integration tests need a node. The node's own harness starts one with names active:

```sh
cd dijetsnodesgo
NAMES_DEVNET=1 NAMES_DEVNET_HOLD=60m go test -tags names_e2e -timeout 0 -run TestDevNetwork ./tests/names/
# then, here:
DIJETS_NODE_URL=http://127.0.0.1:19750 npm run test:integration
```

## Examples

`examples/` (run with `npx tsx examples/<file>.ts`; configure with `DIJETS_NETWORK` and `DIJETS_NODE_URL`):

| # | Example | Kind |
|---|---|---|
| 01 | connect to a custom node | read-only |
| 02 | network presets and placeholders | offline |
| 03 | node health and network information | read-only |
| 04 | import and create keys | offline |
| 05 | derive and validate addresses | offline |
| 06 | V-Chain balance and UTXOs | read-only |
| 07 | M-Chain height, validators, staking | read-only |
| 08 | U-Chain through EVM JSON-RPC and ethers | read-only |
| 09 | resolve a name for payment | read-only |
| 10 | prepare, sign offline and (with `BROADCAST=1`) submit a transfer | broadcast only on request; refuses mainnet and Lothar |
| 11 | Arc discovery and status | read-only |
| 12 | configure endpoints without touching internals | offline |

## Not supported

| Feature | Status |
|---|---|
| Banff-only M-Chain transactions (permissionless validator and delegator, remove subnet validator, transform subnet) | Not implemented. Not accepted on mainnet or Lothar |
| Listing names by owner, search | Needs the explorer; listing by owner needs a new explorer route |
| Arc health history | Explorer only |
| Mainnet U-Chain ID | Placeholder until confirmed; read from the node on connect |
| Public mainnet and Lothar RPC URLs | Placeholders |
| Upstream's `Avalanche` class, the AVAX-named methods | Internal only |

## Licence

BSD-3-Clause, © 2026 Dijets Inc. Limited. Derived from avalanche.js (BSD-3-Clause, © 2020 Ava Labs): see `LICENSE.upstream`.
