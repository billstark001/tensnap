// This user CLI delegates to study code shared with the benchmark kernel. The
// split prevents copied trial loops; it is not required by the Go binding.
package main

import (
	"flag"
	"os"

	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
)

func main() {
	values := shared.RegisterStudyFlags(flag.CommandLine)
	flag.Parse()
	options, err := values.Options()
	if err != nil {
		panic(err)
	}
	result, err := shared.RunStudy(options)
	if err != nil {
		panic(err)
	}
	if err := shared.WriteStudyCSV(os.Stdout, result); err != nil {
		panic(err)
	}
}
