// Study helpers are shared by the user CLI and publication kernel so their
// scientific loops cannot drift. This split is not required by the Go binding.
package schelling

import (
	"flag"
	"fmt"
	"io"
	"strconv"
	"strings"
)

type StudyMode string

const (
	StudySteady      StudyMode = "steady"
	StudyConvergence StudyMode = "convergence"
)

type StudyOptions struct {
	Width      int
	Height     int
	Density    float64
	Balance    float64
	Thresholds []float64
	Steps      int
	Seeds      int
	Seed       int64
	Mode       StudyMode
}

func DefaultStudyOptions() StudyOptions {
	config := DefaultConfig()
	return StudyOptions{
		Width:      config.GridWidth,
		Height:     config.GridHeight,
		Density:    config.Density,
		Balance:    config.Balance,
		Thresholds: []float64{0.3, 0.5, 0.7, 0.9},
		Steps:      1000,
		Seeds:      8,
		Seed:       7,
		Mode:       StudyConvergence,
	}
}

type StudyFlags struct {
	options       StudyOptions
	thresholdsRaw string
	modeRaw       string
}

func RegisterStudyFlags(flags *flag.FlagSet) *StudyFlags {
	defaults := DefaultStudyOptions()
	values := &StudyFlags{
		options:       defaults,
		thresholdsRaw: "0.30,0.50,0.70,0.90",
		modeRaw:       string(defaults.Mode),
	}
	flags.IntVar(&values.options.Width, "width", defaults.Width, "Schelling grid width")
	flags.IntVar(&values.options.Height, "height", defaults.Height, "Schelling grid height")
	flags.Float64Var(&values.options.Density, "density", defaults.Density, "Initial occupied density")
	flags.Float64Var(&values.options.Balance, "balance", defaults.Balance, "Share of group 1 among occupied cells")
	flags.IntVar(&values.options.Steps, "steps", defaults.Steps, "Maximum steps per trial")
	flags.IntVar(&values.options.Seeds, "seeds", defaults.Seeds, "Number of seeds per threshold")
	flags.Int64Var(&values.options.Seed, "seed", defaults.Seed, "Base random seed")
	flags.StringVar(&values.thresholdsRaw, "thresholds", values.thresholdsRaw, "Comma-separated similarity thresholds")
	flags.StringVar(&values.modeRaw, "mode", values.modeRaw, "steady executes all steps; convergence stops at no movement")
	return values
}

func (values *StudyFlags) Options() (StudyOptions, error) {
	thresholds, err := ParseThresholds(values.thresholdsRaw)
	if err != nil {
		return StudyOptions{}, err
	}
	values.options.Thresholds = thresholds
	values.options.Mode = StudyMode(values.modeRaw)
	if err := ValidateStudyOptions(values.options); err != nil {
		return StudyOptions{}, err
	}
	return values.options, nil
}

func ParseThresholds(raw string) ([]float64, error) {
	parts := strings.Split(raw, ",")
	thresholds := make([]float64, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		value, err := strconv.ParseFloat(part, 64)
		if err != nil || value < 0 || value > 1 {
			return nil, fmt.Errorf("threshold %q must be a number from 0 through 1", part)
		}
		thresholds = append(thresholds, value)
	}
	if len(thresholds) == 0 {
		return nil, fmt.Errorf("at least one threshold is required")
	}
	return thresholds, nil
}

func ValidateStudyOptions(options StudyOptions) error {
	if options.Width <= 0 || options.Height <= 0 {
		return fmt.Errorf("width and height must be positive")
	}
	if options.Density < 0 || options.Density > 1 || options.Balance < 0 || options.Balance > 1 {
		return fmt.Errorf("density and balance must be values from 0 through 1")
	}
	if options.Steps <= 0 || options.Seeds <= 0 {
		return fmt.Errorf("steps and seeds must be positive")
	}
	if options.Mode != StudySteady && options.Mode != StudyConvergence {
		return fmt.Errorf("mode must be steady or convergence")
	}
	if len(options.Thresholds) == 0 {
		return fmt.Errorf("at least one threshold is required")
	}
	return nil
}

type TrialResult struct {
	Threshold   float64
	Seed        int64
	Satisfied   float64
	Segregation float64
	LastSwapped int
	StepsRun    int
	Termination string
}

type StudyRow struct {
	Threshold       float64
	MeanSatisfied   float64
	MeanSegregation float64
	MeanLastSwapped float64
	MeanSteps       float64
	SatisfiedRuns   int
	JammedRuns      int
	LimitRuns       int
}

type StudyResult struct {
	Options         StudyOptions
	Trials          []TrialResult
	Rows            []StudyRow
	TotalTicks      int
	MeanSatisfied   float64
	MeanSegregation float64
	MeanLastSwapped float64
	MeanActualSteps float64
}

func RunTrial(config Config, seed int64, steps int, mode StudyMode) TrialResult {
	model := NewSeededModel(config, seed)
	stepsRun, termination := AdvanceTrial(model, steps, mode)
	return SummarizeTrial(model, seed, stepsRun, termination)
}

// AdvanceTrial contains only model transitions. Measurement adapters wrap this call.
func AdvanceTrial(model *Model, steps int, mode StudyMode) (int, string) {
	for tick := 1; tick <= steps; tick++ {
		moved := model.Step()
		if mode == StudyConvergence && moved == 0 {
			return tick, "stopped"
		}
	}
	return steps, "limit"
}

func SummarizeTrial(model *Model, seed int64, steps int, termination string) TrialResult {
	if termination == "stopped" {
		termination = "satisfied"
		for i, cell := range model.Cells {
			if cell.Group != 0 && !model.Satisfied(i) {
				termination = "jammed"
				break
			}
		}
	}
	return TrialResult{Threshold: model.Config.SimilarityThreshold, Seed: seed,
		Satisfied: model.SatisfiedPct(), Segregation: model.SegregationIndex(), LastSwapped: model.LastSwapped,
		StepsRun: steps, Termination: termination}
}

func RunStudy(options StudyOptions, trialRunner func(Config, int64, int, StudyMode) TrialResult) (StudyResult, error) {
	if err := ValidateStudyOptions(options); err != nil {
		return StudyResult{}, err
	}
	base := Config{GridWidth: options.Width, GridHeight: options.Height, Density: options.Density, Balance: options.Balance}

	result := StudyResult{Options: options, Rows: make([]StudyRow, 0, len(options.Thresholds))}
	for _, threshold := range options.Thresholds {
		config := base
		config.SimilarityThreshold = threshold
		row := StudyRow{Threshold: threshold}
		for run := 0; run < options.Seeds; run++ {
			trial := trialRunner(config, options.Seed+int64(run), options.Steps, options.Mode)
			result.Trials = append(result.Trials, trial)
			result.TotalTicks += trial.StepsRun
			row.MeanSatisfied += trial.Satisfied
			row.MeanSegregation += trial.Segregation
			row.MeanLastSwapped += float64(trial.LastSwapped)
			row.MeanSteps += float64(trial.StepsRun)
			switch trial.Termination {
			case "satisfied":
				row.SatisfiedRuns++
			case "jammed":
				row.JammedRuns++
			case "limit":
				row.LimitRuns++
			}
		}
		n := float64(options.Seeds)
		row.MeanSatisfied /= n
		row.MeanSegregation /= n
		row.MeanLastSwapped /= n
		row.MeanSteps /= n
		result.Rows = append(result.Rows, row)
	}

	trialCount := float64(len(result.Trials))
	for _, trial := range result.Trials {
		result.MeanSatisfied += trial.Satisfied
		result.MeanSegregation += trial.Segregation
		result.MeanLastSwapped += float64(trial.LastSwapped)
	}
	result.MeanSatisfied /= trialCount
	result.MeanSegregation /= trialCount
	result.MeanLastSwapped /= trialCount
	result.MeanActualSteps = float64(result.TotalTicks) / trialCount
	return result, nil
}

func WriteStudyCSV(writer io.Writer, result StudyResult) error {
	if _, err := fmt.Fprintln(writer, "threshold,mean_satisfied_pct,mean_segregation_index,mean_last_swapped,mean_steps,satisfied_runs,jammed_runs,limit_runs"); err != nil {
		return err
	}
	for _, row := range result.Rows {
		if _, err := fmt.Fprintf(writer, "%.2f,%.4f,%.4f,%.2f,%.2f,%d,%d,%d\n", row.Threshold, row.MeanSatisfied, row.MeanSegregation, row.MeanLastSwapped, row.MeanSteps, row.SatisfiedRuns, row.JammedRuns, row.LimitRuns); err != nil {
			return err
		}
	}
	return nil
}
