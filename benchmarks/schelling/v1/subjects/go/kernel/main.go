// Publication JSON/version adapter over the example's shared study.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"runtime"
	"time"

	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
)

func main() {
	if shared.DynamicsVersion != 1 {
		panic("benchmark adapter requires Schelling dynamics v1")
	}
	values := shared.RegisterStudyFlags(flag.CommandLine)
	warmupSteps := flag.Int("warmup-steps", 0, "Untimed transitions on an independent model")
	benchmarkJSON := flag.Bool("benchmark-json", false, "append the benchmark harness result")
	instrumentation := flag.String("instrumentation", "none", "kernel instrumentation mode")
	flag.Parse()
	if *instrumentation != "none" {
		panic("instrumentation must be none for the Go kernel")
	}
	options, err := values.Options()
	if err != nil {
		panic(err)
	}
	elapsed := time.Duration(0)
	measuredTrial := func(config shared.Config, seed int64, steps int, mode shared.StudyMode) shared.TrialResult {
		model := shared.NewSeededModel(config, seed)
		started := time.Now()
		stepsRun, termination := shared.AdvanceTrial(model, steps, mode)
		elapsed += time.Since(started)
		return shared.SummarizeTrial(model, seed, stepsRun, termination)
	}
	if *warmupSteps < 0 {
		panic("warmup steps must be nonnegative")
	}
	if *warmupSteps > 0 {
		measuredTrial(shared.Config{GridWidth: options.Width, GridHeight: options.Height,
			Density: options.Density, Balance: options.Balance, SimilarityThreshold: options.Thresholds[0]}, options.Seed, *warmupSteps, shared.StudySteady)
		elapsed = 0
	}
	result, err := shared.RunStudy(options, measuredTrial)
	if err != nil {
		panic(err)
	}
	if err := shared.WriteStudyCSV(os.Stdout, result); err != nil {
		panic(err)
	}
	elapsedMS := float64(elapsed) / float64(time.Millisecond)
	msPerTick, ticksPerMS := 0.0, 0.0
	if result.TotalTicks > 0 {
		msPerTick = elapsedMS / float64(result.TotalTicks)
	}
	if elapsedMS > 0 {
		ticksPerMS = float64(result.TotalTicks) / elapsedMS
	}
	fmt.Println("performance_metric,total_ticks,elapsed_ms,tpms,mspt")
	fmt.Printf("performance,%d,%.3f,%.6f,%.6f\n", result.TotalTicks, elapsedMS, ticksPerMS, msPerTick)
	if !*benchmarkJSON {
		return
	}

	valid := result.MeanSatisfied >= 0 && result.MeanSatisfied <= 1 &&
		result.MeanSegregation >= 0 && result.MeanSegregation <= 1 &&
		result.MeanLastSwapped >= 0 && result.MeanLastSwapped <= float64(options.Width*options.Height) &&
		result.MeanActualSteps >= 1 && result.MeanActualSteps <= float64(options.Steps)
	output := map[string]any{
		"schemaVersion": 1,
		"timingsMs":     []float64{elapsedMS},
		"metrics":       map[string]float64{"totalTicks": float64(result.TotalTicks), "elapsedMs": elapsedMS, "msPerTick": msPerTick},
		"state": map[string]any{
			"mode": options.Mode, "satisfiedPct": result.MeanSatisfied,
			"segregationIndex": result.MeanSegregation, "lastSwapped": result.MeanLastSwapped,
			"actualSteps": result.MeanActualSteps,
		},
		"correctness": map[string]any{"valid": valid, "actionCount": 1},
		"runtime":     map[string]string{"go": runtime.Version()},
	}
	if err := json.NewEncoder(os.Stdout).Encode(output); err != nil {
		panic(err)
	}
}
