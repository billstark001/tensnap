package main

import (
	"fmt"

	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
)

func main() {
	model := shared.New()
	emitter := abm.NewSink()

	if err := model.Setup(emitter); err != nil {
		panic(err)
	}

	for tick := 0; tick < 200; tick++ {
		if err := model.Step(emitter); err != nil {
			panic(err)
		}
		if tick%10 == 0 {
			fmt.Printf("tick %d  satisfied %.1f%%\n", tick, shared.SatisfiedPct(model))
		}
	}
}
