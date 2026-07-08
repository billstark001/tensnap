package main

import (
	"flag"
	"fmt"
	"strconv"
	"strings"
	"time"

	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
)

const (
	defaultScientificSteps      = 1000
	defaultScientificSeeds      = 8
	defaultScientificThresholds = "0.30,0.50,0.70,0.90"
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
	elapsed     time.Duration
}

func runTrial(cfg shared.Config, seed int64, steps int) trialResult {
	model := shared.NewModel(cfg)
	model.SetSeed(seed)
	model.Initialize()

	result := trialResult{}
	started := time.Now()
	for i := 0; i < steps; i++ {
		result.stepsRun++
		if model.Step() == 0 {
			result.converged = true
			break
		}
	}
	result.elapsed = time.Since(started)
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
	steps := flag.Int("steps", defaultScientificSteps, "Maximum steps per trial")
	seeds := flag.Int("seeds", defaultScientificSeeds, "Number of seeds per threshold")
	seed := flag.Int64("seed", 7, "Base random seed")
	thresholdsRaw := flag.String("thresholds", defaultScientificThresholds, "Comma-separated similarity thresholds")
	flag.Parse()

	thresholds, err := parseThresholds(*thresholdsRaw)
	if err != nil {
		panic(err)
	}

	outputRows := make([]string, 0, len(thresholds))
	totalTicks := 0
	totalElapsed := time.Duration(0)
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
			totalTicks += result.stepsRun
			totalElapsed += result.elapsed
			if result.converged {
				convergedRuns++
			}
		}
		n := float64(*seeds)
		outputRows = append(outputRows, fmt.Sprintf(
			"%.2f,%.4f,%.4f,%.2f,%.2f,%d",
			threshold,
			satisfiedTotal/n,
			segregationTotal/n,
			float64(lastSwappedTotal)/n,
			float64(stepsTotal)/n,
			convergedRuns,
		))
	}

	fmt.Println("threshold,mean_satisfied_pct,mean_segregation_index,mean_last_swapped,mean_steps,converged_runs")
	for _, row := range outputRows {
		fmt.Println(row)
	}
	elapsedMS := float64(totalElapsed) / float64(time.Millisecond)
	tpms := 0.0
	if totalElapsed > 0 {
		tpms = float64(totalTicks) / elapsedMS
	}
	mspt := 0.0
	if totalTicks > 0 {
		mspt = elapsedMS / float64(totalTicks)
	}
	fmt.Println("performance_metric,total_ticks,elapsed_ms,tpms,mspt")
	fmt.Printf("performance,%d,%.3f,%.6f,%.6f\n", totalTicks, elapsedMS, tpms, mspt)
}
