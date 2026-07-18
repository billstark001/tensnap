package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"runtime"
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

func runTrial(cfg shared.Config, seed int64, steps int, mode string) trialResult {
	model := shared.NewModel(cfg)
	model.SetSeed(seed)
	model.Initialize()

	result := trialResult{}
	started := time.Now()
	for i := 0; i < steps; i++ {
		result.stepsRun++
		if moved := model.Step(); mode == "convergence" && moved == 0 {
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
	warmupSteps := flag.Int("warmup-steps", 0, "Untimed steps on an independent model before measurement")
	seeds := flag.Int("seeds", defaultScientificSeeds, "Number of seeds per threshold")
	seed := flag.Int64("seed", 7, "Base random seed")
	thresholdsRaw := flag.String("thresholds", defaultScientificThresholds, "Comma-separated similarity thresholds")
	mode := flag.String("mode", "convergence", "steady executes exactly steps; convergence stops at no movement")
	benchmarkJSON := flag.Bool("benchmark-json", false, "append one schema-v1 JSON result for the benchmark harness")
	flag.Parse()

	thresholds, err := parseThresholds(*thresholdsRaw)
	if err != nil {
		panic(err)
	}
	if *mode != "steady" && *mode != "convergence" {
		panic("mode must be steady or convergence")
	}
	if *warmupSteps < 0 {
		panic("warmup-steps must be non-negative")
	}
	if *warmupSteps > 0 {
		warmupConfig := shared.Config{GridWidth: *gridWidth, GridHeight: *gridHeight, SimilarityThreshold: thresholds[0], Density: *density, Balance: *balance}
		_ = runTrial(warmupConfig, *seed, *warmupSteps, "steady")
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
			result := runTrial(cfg, *seed+int64(run), *steps, *mode)
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
	if *benchmarkJSON {
		meanSatisfied := 0.0
		meanSegregation := 0.0
		meanLastSwapped := 0.0
		if len(outputRows) > 0 {
			// Recompute the scientific summaries instead of parsing presentation CSV.
			for _, threshold := range thresholds {
				cfg := shared.Config{GridWidth: *gridWidth, GridHeight: *gridHeight, SimilarityThreshold: threshold, Density: *density, Balance: *balance}
				for run := 0; run < *seeds; run++ {
					result := runTrial(cfg, *seed+int64(run), *steps, *mode)
					meanSatisfied += result.satisfied
					meanSegregation += result.segregation
					meanLastSwapped += float64(result.lastSwapped)
				}
			}
			denominator := float64(len(thresholds) * *seeds)
			meanSatisfied /= denominator
			meanSegregation /= denominator
			meanLastSwapped /= denominator
		}
		actualSteps := float64(totalTicks) / float64(maxInt(len(thresholds)*(*seeds), 1))
		semanticValid := meanSatisfied >= 0 && meanSatisfied <= 1 && meanSegregation >= 0 && meanSegregation <= 1 && meanLastSwapped >= 0 && meanLastSwapped <= float64((*gridWidth)*(*gridHeight)) && actualSteps >= 1 && actualSteps <= float64(*steps)
		result := map[string]any{
			"schemaVersion": 1,
			"timingsMs":     []float64{elapsedMS},
			"metrics":       map[string]float64{"totalTicks": float64(totalTicks), "elapsedMs": elapsedMS, "msPerTick": mspt},
			"state":         map[string]any{"mode": *mode, "satisfiedPct": meanSatisfied, "segregationIndex": meanSegregation, "lastSwapped": meanLastSwapped, "actualSteps": actualSteps},
			"correctness":   map[string]any{"valid": semanticValid, "actionCount": 1},
			"runtime":       map[string]string{"go": runtime.Version()},
		}
		if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
			panic(err)
		}
	}
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
