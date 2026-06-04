package main

import (
	"flag"
	"fmt"
	"strconv"
	"strings"

	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
)

func parseThresholds(raw string) ([]float64, error) {
	parts := strings.Split(raw, ",")
	thresholds := make([]float64, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		value, err := strconv.ParseFloat(part, 64)
		if err != nil {
			return nil, err
		}
		thresholds = append(thresholds, value)
	}
	return thresholds, nil
}

type trialResult struct {
	satisfied   float64
	segregation float64
	lastSwapped int
	stepsRun    int
	converged   bool
}

func runTrial(cfg shared.Config, seed int64, steps int) trialResult {
	model := shared.NewModel(cfg)
	model.SetSeed(seed)
	model.Initialize()

	result := trialResult{}
	for i := 0; i < steps; i++ {
		result.stepsRun++
		if model.Step() == 0 {
			result.converged = true
			break
		}
	}
	result.satisfied = model.SatisfiedPct()
	result.segregation = model.SegregationIndex()
	result.lastSwapped = model.LastSwapped
	return result
}

func main() {
	gridWidth := flag.Int("width", 50, "Schelling grid width")
	gridHeight := flag.Int("height", 50, "Schelling grid height")
	density := flag.Float64("density", 0.8, "Initial occupied density")
	balance := flag.Float64("balance", 0.5, "Share of group 1 among occupied cells")
	steps := flag.Int("steps", 200, "Maximum steps per trial")
	seeds := flag.Int("seeds", 5, "Number of seeds per threshold")
	seed := flag.Int64("seed", 7, "Base random seed")
	thresholdsRaw := flag.String("thresholds", "0.30,0.50,0.70,0.90", "Comma-separated similarity thresholds")
	flag.Parse()

	thresholds, err := parseThresholds(*thresholdsRaw)
	if err != nil {
		panic(err)
	}

	fmt.Println("threshold,mean_satisfied_pct,mean_segregation_index,mean_last_swapped,mean_steps,converged_runs")
	for _, threshold := range thresholds {
		cfg := shared.Config{
			GridWidth:           *gridWidth,
			GridHeight:          *gridHeight,
			SimilarityThreshold: threshold,
			Density:             *density,
			Balance:             *balance,
		}
		satisfiedTotal := 0.0
		segregationTotal := 0.0
		lastSwappedTotal := 0
		stepsTotal := 0
		convergedRuns := 0
		for run := 0; run < *seeds; run++ {
			result := runTrial(cfg, *seed+int64(run), *steps)
			satisfiedTotal += result.satisfied
			segregationTotal += result.segregation
			lastSwappedTotal += result.lastSwapped
			stepsTotal += result.stepsRun
			if result.converged {
				convergedRuns++
			}
		}
		n := float64(*seeds)
		fmt.Printf(
			"%.2f,%.4f,%.4f,%.2f,%.2f,%d\n",
			threshold,
			satisfiedTotal/n,
			segregationTotal/n,
			float64(lastSwappedTotal)/n,
			float64(stepsTotal)/n,
			convergedRuns,
		)
	}
}
