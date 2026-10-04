package schelling

import (
	"github.com/billstark001/tensnap/packages/tensnap-go/binding"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

const (
	EnvID        = "main"
	AgentLayerID = "agents"
	GridLayerID  = "grid"

	SatisfactionChartID = "satisfaction_rate"
	SegregationChartID  = "segregation_index"

	ActionIDStart = binding.ActionIDStart
	ActionIDReset = binding.ActionIDReset
)

type VizModel struct {
	*binding.Model[*Model]
	model *Model
}

func NewVizModel(model *Model, auditHooks ...func(*Model)) *VizModel {
	viz := &VizModel{model: model}
	version := "2"
	var audit func(*Model)
	if len(auditHooks) > 0 {
		audit = auditHooks[0]
	}
	initFn := func(model *Model) error { model.Initialize(); return nil }
	stepFn := func(model *Model) (bool, error) { return model.Step() > 0, nil }
	restoreFn := func(model *Model, saved checkpoint) error {
		if err := model.restoreCheckpoint(saved); err != nil {
			return err
		}
		viz.Model.SetTick(int64(saved.StepCount))
		return nil
	}
	if audit != nil {
		originalInit, originalStep, originalRestore := initFn, stepFn, restoreFn
		initFn = func(model *Model) error {
			err := originalInit(model)
			if err == nil {
				audit(model)
			}
			return err
		}
		stepFn = func(model *Model) (bool, error) {
			advanced, err := originalStep(model)
			if err == nil {
				audit(model)
			}
			return advanced, err
		}
		restoreFn = func(model *Model, saved checkpoint) error {
			err := originalRestore(model, saved)
			if err == nil {
				audit(model)
			}
			return err
		}
	}
	viz.Model = binding.NewModel(
		model,
		binding.WithSimulatorInfo[*Model](protocol.SimulatorInfoPayload{Model: protocol.ModelInfo{ID: "examples.schelling", StateSchemaVersion: &version}}),
		binding.WithTypedCheckpoint((*Model).captureCheckpoint, restoreFn),
		binding.WithInit(initFn),
		binding.WithStep(stepFn),
		binding.WithParams(binding.MustParamsFromTags(
			func(model *Model) *Config { return &model.Config },
			binding.TagScope("param"),
		)...),
		binding.WithEnvs(binding.NewEnv(EnvID,
			binding.NewAgentLayer[*Model, Cell](AgentLayerID).
				Data(binding.MustMetadataFromTags(
					func(model *Model) *Config { return &model.Config },
					binding.TagScope("space"),
				)).
				Items(occupiedCells).
				ProjectTagsRequired("id", "x", "y").
				Field("heading", binding.Const[*Model, Cell](float64(0))).
				Field("icon", binding.Const[*Model, Cell]("circle")).
				Field("color", func(_ *Model, cell Cell) any {
					return groupColor(cell.Group)
				}).
				Field("size", func(model *Model, cell Cell) any {
					if model.Satisfied(cell.Y*model.Config.GridWidth + cell.X) {
						return 1.0
					}
					return 0.6
				}),
			binding.NewGridLayer[*Model](GridLayerID).
				Data(binding.MustMetadataFromTags(
					func(model *Model) *Config { return &model.Config },
					binding.TagScope("space"),
				)),
		)),
		binding.WithCharts(
			binding.NewChart(SatisfactionChartID, "Satisfaction Rate", "#2f9e44",
				func(model *Model) any { return model.SatisfiedPct() }),
			binding.NewChart(SegregationChartID, "Segregation Index", "#e8590c",
				func(model *Model) any { return model.SegregationIndex() }),
		),
	)
	return viz
}

func occupiedCells(model *Model) []Cell {
	cells := make([]Cell, 0, len(model.Cells))
	for _, cell := range model.Cells {
		if cell.Group != 0 {
			cells = append(cells, cell)
		}
	}
	return cells
}

func groupColor(group int) string {
	if group == 1 {
		return "#3498db"
	}
	return "#e74c3c"
}
