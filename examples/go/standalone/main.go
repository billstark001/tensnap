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

	model := shared.NewDefaultModel()
	model.Config.GridWidth = *gridWidth
	model.Config.GridHeight = *gridHeight
	model.Config.SimilarityThreshold = 1
	model.Initialize()

	fmt.Printf(
		"Initialized with parameters:\n  GridWidth: %d\n  GridHeight: %d\n  SimilarityThreshold: %.2f\n  Density: %.2f\n  Balance: %.2f\n",
		model.Config.GridWidth, model.Config.GridHeight, model.Config.SimilarityThreshold, model.Config.Density, model.Config.Balance,
	)

	for tick := range 200000 {
		swapped := model.Step()
		if tick%1000 == 0 {
			fmt.Printf("tick %d:  swapped %d agents, satisfied %.1f%%\n", tick, swapped, model.SatisfiedPct()*100)
		}
	}
}
