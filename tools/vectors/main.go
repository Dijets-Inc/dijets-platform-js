// Command vectors prints test vectors computed by the Dijets node's own code
// (github.com/lasthyphen/dijetsnodesgo), so the JavaScript tests compare
// against an independent implementation rather than against themselves.
//
// Run it with ./run.sh, which points the module at a local node checkout
// through $DIJETSNODESGO.
package main

import (
	"encoding/hex"
	"fmt"
	"os"

	"github.com/lasthyphen/dijetsnodesgo/ids"
	"github.com/lasthyphen/dijetsnodesgo/utils/cb58"
	"github.com/lasthyphen/dijetsnodesgo/utils/formatting/address"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: vectors reencode <alias> <hrp> <addr>... | idhex <cb58>... | golden")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "reencode":
		alias, hrp := os.Args[2], os.Args[3]
		for _, a := range os.Args[4:] {
			_, _, b, err := address.Parse(a)
			must(err)
			out, err := address.Format(alias, hrp, b)
			must(err)
			fmt.Println(out)
		}
	case "idhex":
		for _, s := range os.Args[2:] {
			id, err := ids.FromString(s)
			must(err)
			fmt.Println(hex.EncodeToString(id[:]))
		}
	case "golden":
		golden()
	default:
		fmt.Fprintln(os.Stderr, "unknown command", os.Args[1])
		os.Exit(2)
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func cb58Encode(b []byte) (string, error) { return cb58.Encode(b) }
