package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/lasthyphen/dijetsnodesgo/genesis"
	"github.com/lasthyphen/dijetsnodesgo/utils/constants"
	"github.com/lasthyphen/dijetsnodesgo/utils/crypto"
	"github.com/lasthyphen/dijetsnodesgo/utils/formatting/address"
	"github.com/lasthyphen/dijetsnodesgo/version"
	"github.com/lasthyphen/dijetsnodesgo/vms/platformvm/names"
	"github.com/lasthyphen/dijetsnodesgo/vms/platformvm/reward"
	"github.com/lasthyphen/dijetsnodesgo/vms/platformvm/txs"
)

// golden writes one vector file to stdout: networks, addresses or names.
func golden() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: vectors golden networks|addresses|names")
		os.Exit(2)
	}
	var out interface{}
	switch os.Args[2] {
	case "networks":
		out = networks()
	case "addresses":
		out = addresses()
	case "names":
		out = nameVectors()
	case "txs":
		out = txVectors()
	default:
		fmt.Fprintln(os.Stderr, "unknown vector set", os.Args[2])
		os.Exit(2)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	must(enc.Encode(out))
}

var publicNetworks = []uint32{constants.MainnetID, constants.LotharID, constants.LocalID}

func networks() interface{} {
	type net struct {
		NetworkID     uint32            `json:"networkID"`
		HRP           string            `json:"hrp"`
		MChain        string            `json:"mChain"`
		VChain        string            `json:"vChain"`
		UChain        string            `json:"uChain"`
		DJTAssetID    string            `json:"djtAssetID"`
		Fees          map[string]string `json:"fees"`
		Staking       map[string]string `json:"staking"`
		EVMChainID    uint64            `json:"evmChainID"`
		BanffActive   bool              `json:"banffActive"`
		NamingActive  bool              `json:"namingActive"`
	}
	hrps := map[string]string{}
	for id, h := range constants.NetworkIDToHRP {
		hrps[fmt.Sprint(id)] = h
	}
	var nets []net
	for _, id := range publicNetworks {
		cfg := genesis.GetConfig(id)
		b, djtx, err := genesis.FromConfig(cfg)
		must(err)
		v, err := genesis.VMGenesis(b, constants.AVMID)
		must(err)
		u, err := genesis.VMGenesis(b, constants.EVMID)
		must(err)
		f := genesis.GetTxFeeConfig(id)
		s := genesis.GetStakingConfig(id)
		var cg struct{ Config struct{ ChainID uint64 `json:"chainId"` } `json:"config"` }
		must(json.Unmarshal([]byte(cfg.CChainGenesis), &cg))
		far := version.GetBanffTime(id).Year() > 3000
		namingFar := version.GetNamingTime(id).Year() > 3000
		nets = append(nets, net{
			NetworkID: id, HRP: constants.GetHRP(id),
			MChain: constants.PlatformChainID.String(), VChain: v.ID().String(), UChain: u.ID().String(),
			DJTAssetID: djtx.String(),
			Fees: map[string]string{
				"txFee": fmt.Sprint(f.TxFee), "createAssetTxFee": fmt.Sprint(f.CreateAssetTxFee),
				"createSubnetTxFee": fmt.Sprint(f.CreateSubnetTxFee), "transformSubnetTxFee": fmt.Sprint(f.TransformSubnetTxFee),
				"createBlockchainTxFee": fmt.Sprint(f.CreateBlockchainTxFee),
				"addPrimaryNetworkValidatorFee": fmt.Sprint(f.AddPrimaryNetworkValidatorFee),
				"addPrimaryNetworkDelegatorFee": fmt.Sprint(f.AddPrimaryNetworkDelegatorFee),
				"addSubnetValidatorFee": fmt.Sprint(f.AddSubnetValidatorFee), "addSubnetDelegatorFee": fmt.Sprint(f.AddSubnetDelegatorFee),
			},
			Staking: map[string]string{
				"minValidatorStake": fmt.Sprint(s.MinValidatorStake), "maxValidatorStake": fmt.Sprint(s.MaxValidatorStake),
				"minDelegatorStake": fmt.Sprint(s.MinDelegatorStake), "minDelegationFee": fmt.Sprint(s.MinDelegationFee),
				"minStakeDuration": fmt.Sprint(int64(s.MinStakeDuration.Seconds())), "maxStakeDuration": fmt.Sprint(int64(s.MaxStakeDuration.Seconds())),
				"supplyCap":          fmt.Sprint(s.RewardConfig.SupplyCap),
				"minConsumptionRate": fmt.Sprint(float64(s.RewardConfig.MinConsumptionRate) / reward.PercentDenominator),
				"maxConsumptionRate": fmt.Sprint(float64(s.RewardConfig.MaxConsumptionRate) / reward.PercentDenominator),
			},
			EVMChainID: cg.Config.ChainID, BanffActive: !far, NamingActive: !namingFar,
		})
	}
	return map[string]interface{}{"source": "dijetsnodesgo genesis", "networkIDToHRP": hrps, "fallbackHRP": constants.FallbackHRP, "networks": nets}
}

func addresses() interface{} {
	type addr struct {
		Key      string `json:"privateKey"`
		Chain    string `json:"chain"`
		HRP      string `json:"hrp"`
		Address  string `json:"address"`
		KeyHash  string `json:"keyHashHex"`
		PubKey   string `json:"publicKeyHex"`
	}
	var out []addr
	for _, k := range crypto.BuildTestKeys() {
		short := k.PublicKey().Address()
		for _, hrp := range []string{"dijets", "lothar", "local", "custom"} {
			for _, chain := range []string{"V", "M", "U"} {
				a, err := address.Format(chain, hrp, short.Bytes())
				must(err)
				out = append(out, addr{
					Key: crypto.PrivateKeyPrefix + mustCB58(k.Bytes()), Chain: chain, HRP: hrp, Address: a,
					KeyHash: fmt.Sprintf("%x", short.Bytes()), PubKey: fmt.Sprintf("%x", k.PublicKey().Bytes()),
				})
			}
		}
	}
	return map[string]interface{}{"source": "dijetsnodesgo utils/formatting/address, utils/crypto test keys", "addresses": out}
}

func nameVectors() interface{} {
	inputs := []string{
		"alice", "Alice", "  @Bob  ", "@@bob", "al", "a", "", "abc", "a-b", "v-alice", "m-1", "u-x2",
		"alice--bob", "alice-", "-alice", "1alice", "alice1", "ali.ce", "ali_ce", "ali ce", "ali" + string(rune(0xe9)), string(rune(0xfeff)) + "alice", string(rune(0xa0)) + "alice" + string(rune(0x3000)),
		"dijets", "DJT", "registry", "abcdefghijklmnopqrstuvwxyz012345",
		"abcdefghijklmnopqrstuvwxyz0123456", "ALICE", "x-ray", "xx-ray", "a1", "zz9",
	}
	type v struct {
		Input        string `json:"input"`
		Canonical    string `json:"canonical,omitempty"`
		CanonRule    string `json:"canonicaliseRule,omitempty"`
		ValidateRule string `json:"validateRule,omitempty"`
	}
	rule := func(err error) string {
		var ne *names.Error
		if errors.As(err, &ne) {
			return string(ne.Rule)
		}
		return ""
	}
	var out []v
	for _, in := range inputs {
		c, err := names.Canonicalise(in)
		x := v{Input: in, Canonical: c, CanonRule: rule(err), ValidateRule: rule(names.Validate(in))}
		out = append(out, x)
	}
	memos := []string{"djtname/1 to=alice g=1 v=2", "djtname/1 to=alice g=0 v=2", "djtname/1 to=alice g=01 v=2",
		"djtname/1 to=Alice g=1 v=2", "djtname/2 to=alice g=1 v=2", "djtname/1 to=alice g=1", "djtname/1  to=alice g=1 v=2",
		"djtname/1 to=alice g=18446744073709551615 v=1", "djtname/1 to=alice g=18446744073709551616 v=1"}
	type m struct {
		Memo  string `json:"memo"`
		Valid bool   `json:"valid"`
		Name  string `json:"name,omitempty"`
		G     string `json:"generation,omitempty"`
		V     string `json:"version,omitempty"`
	}
	var mo []m
	for _, s := range memos {
		pm, ok := names.ParsePaymentMemo([]byte(s))
		x := m{Memo: s, Valid: ok}
		if ok {
			x.Name, x.G, x.V = pm.Name, fmt.Sprint(pm.Generation), fmt.Sprint(pm.Version)
		}
		mo = append(mo, x)
	}
	_ = txs.Codec
	return map[string]interface{}{"source": "dijetsnodesgo vms/platformvm/names", "names": out, "memos": mo}
}

func mustCB58(b []byte) string {
	s, err := cb58Encode(b)
	must(err)
	return s
}
