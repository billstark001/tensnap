package main

import (
	"github.com/billstark001/tensnap/packages/tensnap-go/binding"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

func NewVizModel(config Config) *binding.Model[*Model] {
	m := NewModel(config)
	modelConfig := func(m *Model) *Config { return &m.Config }
	space := binding.MustMetadataFromTags(modelConfig, binding.TagScope("space"))
	colors := map[string]string{empty: "#6b7280", tree: "#15803d", burning: "#ef4444"}
	version := "2"

	return binding.NewModel(m,
		binding.WithSimulatorInfo[*Model](protocol.SimulatorInfoPayload{
			Model: protocol.ModelInfo{ID: "examples.go.forest_fire", StateSchemaVersion: &version},
		}),
		binding.WithInit(func(m *Model) error { m.Reset(); return nil }),
		binding.WithReset(func(m *Model) error { m.Reset(); return nil }),
		binding.WithStep(func(m *Model) (bool, error) { m.Step(); return true, nil }),
		binding.WithParams(binding.MustParamsFromTags(modelConfig)...),
		binding.WithEnvs(binding.NewEnv("forest",
			binding.NewGridLayer[*Model]("grid").Data(space).
				Restore(binding.RestoreLayer[*Model]{Metadata: validateGrid}),
			binding.NewMatrixAgentLayer[*Model, string]("cells").
				Flat(
					func(m *Model) (int, int) { return m.Height, m.Width },
					func(m *Model, row, col int) string { return m.Cells[row*m.Width+col] },
				).
				Field("color", func(_ *Model, _, _ int, state string) any {
					return colors[state]
				}).
				Const("icon", "square").
				Const("size", 1).
				RestoreSource(decodeCellState, restoreCellMatrix),
		)),
		binding.WithCharts(binding.NewChartGroup("forest", "Forest state",
			binding.NewChartSeries("empty", "Empty", colors[empty], func(m *Model) any { return m.Count(empty) }),
			binding.NewChartSeries("tree", "Trees", colors[tree], func(m *Model) any { return m.Count(tree) }),
			binding.NewChartSeries("burning", "Burning", colors[burning], func(m *Model) any { return m.Count(burning) }),
		)),
		binding.WithRestoreTime(restoreTime),
		binding.WithTypedCheckpoint((*Model).Snapshot, (*Model).Restore),
	)
}
