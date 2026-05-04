package main

import (
	"flag"
	"fmt"

	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
)

func main() {
	gridWidth := flag.Int("grid-width", 50, "Schelling grid width")
	gridHeight := flag.Int("grid-height", 50, "Schelling grid height")
	flag.Parse()

	model := shared.NewWithConfig(shared.Config{GridWidth: *gridWidth, GridHeight: *gridHeight})
	emitter := abm.NewSink()

	if err := model.Setup(emitter); err != nil {
		panic(err)
	}

	for tick := 0; tick < 200; tick++ {
		if err := model.Step(emitter); err != nil {
			panic(err)
		}
		if tick%10 == 0 {
			fmt.Printf("tick %d  satisfied %.1f%%\n", tick, shared.SatisfiedPct(model)*100)
		}
	}
}
