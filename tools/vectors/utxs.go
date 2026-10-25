package main

import (
	"encoding/hex"

	"github.com/lasthyphen/coreth/plugin/evm"
	"github.com/lasthyphen/dijetsnodesgo/genesis"
	"github.com/lasthyphen/dijetsnodesgo/ids"
	"github.com/lasthyphen/dijetsnodesgo/utils/constants"
	"github.com/lasthyphen/dijetsnodesgo/utils/crypto"
	"github.com/lasthyphen/dijetsnodesgo/vms/components/djtx"
	"github.com/lasthyphen/dijetsnodesgo/vms/secp256k1fx"
)

// uTxVectors: a U-Chain atomic ExportTx (coreth plugin/evm) moving DJT from
// ewoq's EVM account to alice on the V-Chain.
func uTxVectors() []txVector {
	keys := crypto.BuildTestKeys()
	alice, ewoq := keys[0], keys[3]
	cfg := genesis.GetConfig(constants.LocalID)
	b, djt, err := genesis.FromConfig(cfg)
	must(err)
	vtx, err := genesis.VMGenesis(b, constants.AVMID)
	must(err)
	utx, err := genesis.VMGenesis(b, constants.EVMID)
	must(err)
	from := evm.GetEthAddress(ewoq)
	exp := &evm.UnsignedExportTx{
		NetworkID: constants.LocalID, BlockchainID: utx.ID(), DestinationChain: vtx.ID(),
		Ins: []evm.EVMInput{{Address: from, Amount: 1_001_000_000, AssetID: djt, Nonce: 7}},
		ExportedOutputs: []*djtx.TransferableOutput{{Asset: djtx.Asset{ID: djt}, Out: &secp256k1fx.TransferOutput{
			Amt: 1_000_000_000, OutputOwners: secp256k1fx.OutputOwners{Threshold: 1, Addrs: []ids.ShortID{alice.PublicKey().Address()}},
		}}},
	}
	tx := &evm.Tx{UnsignedAtomicTx: exp}
	ub, err := evm.Codec.Marshal(0, &tx.UnsignedAtomicTx)
	must(err)
	must(tx.Sign(evm.Codec, [][]*crypto.PrivateKeySECP256K1R{{ewoq}}))
	return []txVector{{Name: "U ExportTx", Chain: "U", Spec: map[string]interface{}{
		"uChain": utx.ID().String(), "destinationChain": vtx.ID().String(), "from": from.Hex(), "amount": "1001000000", "nonce": "7",
		"exported": "1000000000", "to": "alice", "signers": []string{"ewoq"},
	}, Unsigned: hex.EncodeToString(ub), Signed: hex.EncodeToString(tx.SignedBytes()), TxID: tx.ID().String()}}
}
