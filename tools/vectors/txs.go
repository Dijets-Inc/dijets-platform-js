package main

import (
	"encoding/hex"
	"fmt"

	"github.com/lasthyphen/dijetsnodesgo/genesis"
	"github.com/lasthyphen/dijetsnodesgo/ids"
	"github.com/lasthyphen/dijetsnodesgo/utils/constants"
	"github.com/lasthyphen/dijetsnodesgo/utils/crypto"
	"github.com/lasthyphen/dijetsnodesgo/utils/hashing"
	avmtxs "github.com/lasthyphen/dijetsnodesgo/vms/avm/txs"
	"github.com/lasthyphen/dijetsnodesgo/vms/avm/fxs"
	"github.com/lasthyphen/dijetsnodesgo/vms/components/djtx"
	ptxs "github.com/lasthyphen/dijetsnodesgo/vms/platformvm/txs"
	"github.com/lasthyphen/dijetsnodesgo/vms/platformvm/validator"
	"github.com/lasthyphen/dijetsnodesgo/vms/secp256k1fx"
)

// Transaction vectors on the local network (12345), built from fixed inputs
// and signed with the node's test keys. Signatures are deterministic
// (RFC 6979), so a correct JavaScript implementation reproduces every byte.

type txVector struct {
	Name     string                 `json:"name"`
	Chain    string                 `json:"chain"`
	Spec     map[string]interface{} `json:"spec"`
	Unsigned string                 `json:"unsignedHex"`
	Signed   string                 `json:"signedHex"`
	TxID     string                 `json:"txID"`
}

func label(s string) ids.ID { return hashing.ComputeHash256Array([]byte("dijets-vector:" + s)) }

func txVectors() interface{} {
	keys := crypto.BuildTestKeys()
	alice, ewoq := keys[0], keys[3] // 24jUJ9…, ewoq…
	aliceAddr, ewoqAddr := alice.PublicKey().Address(), ewoq.PublicKey().Address()
	cfg := genesis.GetConfig(constants.LocalID)
	b, djt, err := genesis.FromConfig(cfg)
	must(err)
	vtx, err := genesis.VMGenesis(b, constants.AVMID)
	must(err)
	vChain := vtx.ID()
	net := constants.LocalID

	owners := func(a ids.ShortID) secp256k1fx.OutputOwners {
		return secp256k1fx.OutputOwners{Threshold: 1, Addrs: []ids.ShortID{a}}
	}
	out := func(amt uint64, a ids.ShortID) *djtx.TransferableOutput {
		return &djtx.TransferableOutput{Asset: djtx.Asset{ID: djt}, Out: &secp256k1fx.TransferOutput{Amt: amt, OutputOwners: owners(a)}}
	}
	in := func(utxo string, idx uint32, amt uint64) *djtx.TransferableInput {
		return &djtx.TransferableInput{
			UTXOID: djtx.UTXOID{TxID: label(utxo), OutputIndex: idx}, Asset: djtx.Asset{ID: djt},
			In: &secp256k1fx.TransferInput{Amt: amt, Input: secp256k1fx.Input{SigIndices: []uint32{0}}},
		}
	}
	common := map[string]interface{}{
		"networkID": net, "vChain": vChain.String(), "mChain": constants.PlatformChainID.String(), "djtAssetID": djt.String(),
		"alice": map[string]string{"privateKey": crypto.PrivateKeyPrefix + mustCB58(alice.Bytes()), "keyHashHex": hex.EncodeToString(aliceAddr[:])},
		"ewoq":  map[string]string{"privateKey": crypto.PrivateKeyPrefix + mustCB58(ewoq.Bytes()), "keyHashHex": hex.EncodeToString(ewoqAddr[:])},
	}
	var vs []txVector

	// V-Chain BaseTx: 2 DJT in, 0.5 DJT to ewoq, change to alice, 1 mDJT fee.
	{
		outs := []*djtx.TransferableOutput{out(500_000_000, ewoqAddr), out(1_499_000_000, aliceAddr)}
		parser, err := avmtxs.NewParser([]fxs.Fx{&secp256k1fx.Fx{}})
		must(err)
		djtx.SortTransferableOutputs(outs, parser.Codec())
		tx := &avmtxs.Tx{Unsigned: &avmtxs.BaseTx{BaseTx: djtx.BaseTx{
			NetworkID: net, BlockchainID: vChain, Outs: outs,
			Ins:  []*djtx.TransferableInput{in("v-base", 0, 2_000_000_000)},
			Memo: []byte("dijets vector"),
		}}}
		ub, err := parser.Codec().Marshal(avmtxs.CodecVersion, &tx.Unsigned)
		must(err)
		must(tx.SignSECP256K1Fx(parser.Codec(), [][]*crypto.PrivateKeySECP256K1R{{alice}}))
		vs = append(vs, txVector{Name: "V BaseTx", Chain: "V", Spec: map[string]interface{}{
			"utxo": label("v-base").String(), "outputIndex": 0, "in": "2000000000", "outs": [][]string{{"500000000", "ewoq"}, {"1499000000", "alice"}}, "memo": "dijets vector", "signers": []string{"alice"},
		}, Unsigned: hex.EncodeToString(ub), Signed: hex.EncodeToString(tx.Bytes()), TxID: tx.ID().String()})
	}

	pBase := func(ins []*djtx.TransferableInput, outs []*djtx.TransferableOutput) ptxs.BaseTx {
		djtx.SortTransferableOutputs(outs, ptxs.Codec)
		return ptxs.BaseTx{BaseTx: djtx.BaseTx{NetworkID: net, BlockchainID: constants.PlatformChainID, Ins: ins, Outs: outs}}
	}
	sign := func(name string, u ptxs.UnsignedTx, spec map[string]interface{}, signers ...[]*crypto.PrivateKeySECP256K1R) {
		ub, err := ptxs.Codec.Marshal(ptxs.Version, &u)
		must(err)
		tx, err := ptxs.NewSigned(u, ptxs.Codec, signers)
		must(err)
		vs = append(vs, txVector{Name: name, Chain: "M", Spec: spec, Unsigned: hex.EncodeToString(ub), Signed: hex.EncodeToString(tx.Bytes()), TxID: tx.ID().String()})
	}
	one := func(k *crypto.PrivateKeySECP256K1R) []*crypto.PrivateKeySECP256K1R { return []*crypto.PrivateKeySECP256K1R{k} }

	// Arc creation, step 1: CreateSubnetTx owned by ewoq. Local fee 0.1 DJT.
	subnetOwner := owners(ewoqAddr)
	createSubnet := &ptxs.CreateSubnetTx{
		BaseTx: pBase([]*djtx.TransferableInput{in("m-subnet", 0, 1_000_000_000)}, []*djtx.TransferableOutput{out(900_000_000, aliceAddr)}),
		Owner:  &subnetOwner,
	}
	sign("M CreateSubnetTx", createSubnet, map[string]interface{}{"utxo": label("m-subnet").String(), "in": "1000000000", "change": "900000000", "owner": "ewoq", "signers": []string{"alice"}}, one(alice))
	subnetID := label("subnet") // a fixed subnet ID; the real one is the CreateSubnetTx's ID

	// Arc creation, step 2: a committee member, authorised by the subnet owner.
	nodeID := ids.NodeID(aliceAddr)
	addVal := &ptxs.AddSubnetValidatorTx{
		BaseTx: pBase([]*djtx.TransferableInput{in("m-addval", 0, 10_000_000)}, []*djtx.TransferableOutput{out(9_000_000, aliceAddr)}),
		Validator: validator.SubnetValidator{Validator: validator.Validator{NodeID: nodeID, Start: 1_800_000_000, End: 1_800_086_400, Wght: 20}, Subnet: subnetID},
		SubnetAuth: &secp256k1fx.Input{SigIndices: []uint32{0}},
	}
	sign("M AddSubnetValidatorTx", addVal, map[string]interface{}{"utxo": label("m-addval").String(), "in": "10000000", "change": "9000000", "nodeID": nodeID.String(), "start": "1800000000", "end": "1800086400", "weight": "20", "subnetID": subnetID.String(), "signers": []string{"alice", "ewoq(subnet)"}}, one(alice), one(ewoq))

	// Arc creation, step 3: the AVM chain itself.
	genesisData := []byte("arc genesis bytes")
	createChain := &ptxs.CreateChainTx{
		BaseTx:     pBase([]*djtx.TransferableInput{in("m-chain", 0, 1_000_000_000)}, []*djtx.TransferableOutput{out(900_000_000, aliceAddr)}),
		SubnetID:   subnetID, ChainName: "alpha", VMID: constants.AVMID, FxIDs: []ids.ID{secp256k1fx.ID},
		GenesisData: genesisData, SubnetAuth: &secp256k1fx.Input{SigIndices: []uint32{0}},
	}
	sign("M CreateChainTx", createChain, map[string]interface{}{"utxo": label("m-chain").String(), "in": "1000000000", "change": "900000000", "subnetID": subnetID.String(), "chainName": "alpha", "vmID": constants.AVMID.String(), "fxID": secp256k1fx.ID.String(), "genesisHex": hex.EncodeToString(genesisData), "signers": []string{"alice", "ewoq(subnet)"}}, one(alice), one(ewoq))

	// M ImportTx from the V-Chain.
	imp := &ptxs.ImportTx{
		BaseTx: pBase(nil, []*djtx.TransferableOutput{out(999_000_000, aliceAddr)}), SourceChain: vChain,
		ImportedInputs: []*djtx.TransferableInput{in("v-export", 1, 1_000_000_000)},
	}
	sign("M ImportTx", imp, map[string]interface{}{"utxo": label("v-export").String(), "outputIndex": 1, "in": "1000000000", "out": "999000000", "sourceChain": vChain.String(), "signers": []string{"alice"}}, one(alice))

	// M ExportTx to the V-Chain.
	exp := &ptxs.ExportTx{
		BaseTx: pBase([]*djtx.TransferableInput{in("m-export", 0, 1_000_000_000)}, []*djtx.TransferableOutput{out(499_000_000, aliceAddr)}), DestinationChain: vChain,
		ExportedOutputs: []*djtx.TransferableOutput{out(500_000_000, ewoqAddr)},
	}
	sign("M ExportTx", exp, map[string]interface{}{"utxo": label("m-export").String(), "in": "1000000000", "change": "499000000", "exported": "500000000", "destinationChain": vChain.String(), "signers": []string{"alice"}}, one(alice))

	// Names: alice registers "alice" pointing at ewoq; ewoq consents.
	nameOwner := owners(aliceAddr)
	reg := &ptxs.RegisterNameTx{
		BaseTx: pBase([]*djtx.TransferableInput{in("m-name", 0, 100_000_000)}, []*djtx.TransferableOutput{out(90_000_000, aliceAddr)}),
		Name:   "alice", Target: ewoqAddr, Owner: &nameOwner, Expiry: 1_900_000_000,
		TargetAuth: &secp256k1fx.Input{SigIndices: []uint32{0}},
	}
	sign("M RegisterNameTx", reg, map[string]interface{}{"utxo": label("m-name").String(), "in": "100000000", "change": "90000000", "name": "alice", "target": "ewoq", "owner": "alice", "expiry": "1900000000", "signers": []string{"alice", "ewoq(target)"}}, one(alice), one(ewoq))

	// Names: the owner renews (same target, so the target credential is empty).
	upd := &ptxs.UpdateNameTx{
		BaseTx: pBase([]*djtx.TransferableInput{in("m-rename", 0, 10_000_000)}, []*djtx.TransferableOutput{out(9_000_000, aliceAddr)}),
		Name:   "alice", Version: 1, Target: ewoqAddr, Owner: &nameOwner, Expiry: 1_950_000_000, Revoke: false,
		NameAuth: &secp256k1fx.Input{SigIndices: []uint32{0}}, TargetAuth: &secp256k1fx.Input{},
	}
	sign("M UpdateNameTx", upd, map[string]interface{}{"utxo": label("m-rename").String(), "in": "10000000", "change": "9000000", "name": "alice", "version": "1", "target": "ewoq", "owner": "alice", "expiry": "1950000000", "revoke": false, "signers": []string{"alice", "alice(owner)", "(target: none)"}}, one(alice), one(alice), nil)

	vs = append(vs, uTxVectors()...)
	return map[string]interface{}{"source": "dijetsnodesgo vms/avm/txs, vms/platformvm/txs; coreth plugin/evm", "common": common, "txs": vs}
}

var _ = fmt.Sprint
