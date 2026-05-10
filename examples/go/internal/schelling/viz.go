package schelling

import (
	"github.com/billstark001/tensnap/packages/tensnap-go/binding"
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

func NewVizModel(model *Model) *VizModel {
	viz := &VizModel{model: model}
	viz.Model = binding.NewModel(
		model,
		binding.WithInit(func(model *Model) error {
			model.Initialize()
			return nil
		}),
		binding.WithStep(func(model *Model) (bool, error) {
			return model.Step() > 0, nil
		}),
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
