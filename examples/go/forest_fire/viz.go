package main

import (
	"github.com/billstark001/tensnap/packages/tensnap-go/binding"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

type Cell struct {
	ID    int    `tensnap:"id"`
	State string `tensnap:"state,scope=data"`
}

func cells(m *Model) []Cell {
	items := make([]Cell, len(m.Cells))
	for id, state := range m.Cells {
		items[id] = Cell{ID: id, State: state}
	}
	return items
}

func NewVizModel(config Config) *binding.Model[*Model] {
	m := NewModel(config)
	modelConfig := func(m *Model) *Config { return &m.Config }
	space := binding.MustMetadataFromTags(modelConfig, binding.TagScope("space"))
	colors := map[string]string{empty: "#6b7280", tree: "#15803d", burning: "#ef4444"}
	version := "1"

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
			binding.NewAgentLayer[*Model, Cell]("cells").Data(space).
				Items(cells).ProjectTagsRequired("id").
				Field("x", func(m *Model, c Cell) any { return c.ID % m.Width }).
				Field("y", func(m *Model, c Cell) any { return c.ID / m.Width }).
				Field("icon", binding.Const[*Model, Cell]("square")).
				Field("size", binding.Const[*Model, Cell](1)).
				Field("color", func(_ *Model, c Cell) any { return colors[c.State] }).
				Restore(binding.RestoreLayer[*Model]{Replace: restoreCells, Metadata: validateGrid}),
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
