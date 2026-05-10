package main

import (
	"flag"
	"fmt"

	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
)

func main() {
	gridWidth := flag.Int("grid-width", 50, "Schelling grid width")
	gridHeight := flag.Int("grid-height", 50, "Schelling grid height")
	flag.Parse()

	model := shared.NewModel(shared.Config{GridWidth: *gridWidth, GridHeight: *gridHeight})

	model.Initialize()

	fmt.Printf(
		"Initialized with parameters:\n  GridWidth: %d\n  GridHeight: %d\n  Density: %.2f\n  SimilarityThreshold: %.2f\n",
		model.Config.GridWidth, model.Config.GridHeight, model.Config.Density, model.Config.SimilarityThreshold,
	)

	for tick := range 200 {
		swapped := model.Step()
		if tick%10 == 0 {
			fmt.Printf("tick %d:  swapped %d agents, satisfied %.1f%%\n", tick, swapped, model.SatisfiedPct()*100)
		}
	}
}
