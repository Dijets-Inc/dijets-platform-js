# Upstream lineage

`src/upstream` is the TypeScript source of **avalanche.js 3.15.2** (npm `avalanche@3.15.2`, BSD-3-Clause, © 2020 Ava Labs; see `LICENSE.upstream`). `test/upstream` is its unit-test suite. Both are vendored with a short, deliberate list of changes, each marked `DIJETS:` in the code.

`UPSTREAM.patch` is the full diff against the npm release; regenerate it with `scripts/upstream-diff.sh`.

The previous approach patched `node_modules/avalanche` with `~/Documents/wellar2/patches/avalanche+3.15.2.patch`. Nothing here is derived from that patch. It was inconsistent (its `src`, `typings` and `dist` disagree), and every constant here is taken from the node instead.

## Why vendor rather than depend

Upstream hard-codes several things a wrapper cannot reach:

- RPC method names (`avax.*`, `platform.exportAVAX`);
- the X/P/C alias tables;
- a global `Defaults.network` table that it reads without setters. One example is the U-Chain import fee check.

Dijets reuses network IDs 1, 5 and 12345 with different chains, so Avalanche's table would be silently wrong. The internal class names (`AVMAPI`, `PlatformVMAPI`, `EVMAPI`) and the table's internal X/P/C keys are kept, so the diff stays small. They are never part of the public API.

## Changes to `src/upstream`

| File | Change | Why | Covered by |
|---|---|---|---|
| `utils/constants.ts` | Network tables generated from `src/presets.ts`. Aliases V/M/U. `PrimaryAssetAlias = "DJT"`. Avalanche hosts removed. Adds `toUpstreamNetwork` and `registerNetwork`. | Dijets networks, from the node's genesis; the asset's genesis alias is `DJT`. | `test/dijets/presets.test.ts`, `regressions.test.ts` #1–#8 |
| `utils/bintools.ts` | Accepted HRPs are the node's (`dijets`, `lothar`, `testing`, `local`, `custom`). | Upstream accepted `avax` and `fuji`, so an Avalanche address parsed as a Dijets one. | `test/upstream/utils/bintools.test.ts`, regression #13 |
| `utils/payload.ts` | Chain-address payloads use the V/M/U prefixes. | Dijets chain names. | `test/upstream/common/payload.test.ts` |
| `utils/fetchadapter.ts` | The timeout timer is cleared when the request settles. | Upstream bug: every request held a Node process open for the full timeout. | the integration run finishes promptly |
| `utils/mnemonic.ts` | `import` instead of `require`. | Needed for the ESM build. | `scripts/check-dist.mjs` |
| `common/secp256k1.ts` | Uses `elliptic`'s default export at runtime. | Native ESM cannot see `elliptic.ec`. | `scripts/check-dist.mjs` |
| all files | `"buffer/"` imported as `"buffer/index.js"`. | Node's ESM loader rejects directory imports. | `scripts/check-dist.mjs` |
| `apis/avm/api.ts` | Default path `/ext/bc/V`. `buildCreateAssetTx` uses the configured creation fee. | Upstream bug: it used the network default even after `setCreationTxFee`. | `test/upstream/apis/avm/api.test.ts` (fixed-cap and variable-cap) |
| `apis/platformvm/api.ts` | Default path `/ext/bc/M`. `platform.exportDJTX` and `importDJTX`. `buildAddSubnetValidatorTx` uses the configured fee. | Node method names (`vms/platformvm/service.go`); same fee bug as above. | `test/dijets/client.test.ts` |
| `apis/platformvm/tx.ts` | The parser accepts `AddSubnetValidatorTx`, `CreateChainTx`, `RegisterNameTx` and `UpdateNameTx`. | Upstream could build the first two but not parse them; the last two are new. | `test/dijets/txs.test.ts` |
| `apis/platformvm/constants.ts` | Type IDs 33 and 34. | Name registry (`vms/platformvm/txs/codec.go`). | `test/dijets/txs.test.ts` |
| `apis/platformvm/nametxs.ts` | **New**: `RegisterNameTx` and `UpdateNameTx`. | Name registry. | golden vectors, integration |
| `apis/platformvm/createchaintx.ts` | VM and Fx IDs may be cb58 IDs or padded names. Raw genesis bytes are accepted. | Upstream silently wrote a cb58 ID as text, giving a wrong 32-byte ID. | golden vector `M CreateChainTx`, integration (Arc creation) |
| `apis/platformvm/index.ts` | Exports `nametxs`. | | |
| `apis/evm/api.ts` | Namespace `djtx.*` at `/ext/bc/U/djtx`. EVM calls at `/ext/bc/U/rpc`. Asset lookups pass the V-Chain path per call. `buildExportTx` compares against the cached DJT asset ID and accepts a `Buffer` asset ID. | coreth's Dijets namespace; the node has no `C` alias. Upstream switched the client's base URL around a call, which misrouted concurrent requests. It looked the asset up as `"AVAX"`, and crashed or mis-built with a `Buffer` asset ID. | `test/dijets/client.test.ts`, regression #10, integration (U → V) |
| `apis/evm/utxos.ts` | Error message names the DJT asset. | | |
| `apis/index/api.ts` | Default index `/ext/index/V/tx`. | | `test/dijets/client.test.ts` |
| `apis/socket/socket.ts` | The URL is required. | Upstream defaulted to Avalanche's public host. | |
| `index.ts` | Paths in the internal `Avalanche` class. | Not exported; kept so the upstream suite runs. | `test/upstream/avalanche.test.ts` |
| comments | X-, P-, C-Chain → V-, M-, U-Chain in doc comments. | They appear in editor tooltips. | |

## Changes to `test/upstream`

- Import paths point at `src/upstream`.
- `fixture-network.ts` (loaded only for this suite) registers upstream's network-1337 IDs as opaque fixtures. The expected serialisations embed them, and Dijets has no fixed 1337 network.
- Expected HRPs, prefixes and IDs are Dijets ones. Re-encoded values were generated by the node's own code (`tools/vectors`), never by this library. Avalanche HRPs are now expected to be rejected.
- Three lock-time tests used an absolute "future" time, 10 December 2024, which has passed. They now use times relative to now.
- One request expectation allows the fetch adapter that Node 18+ selects.
- One test (`buildCreateAssetTx - Fixed Cap`) passed only because of the creation-fee bug. It now expects the fee it sets.

Result: all 572 upstream tests pass. The upstream release itself fails 3 of them, because of the expired lock time.
