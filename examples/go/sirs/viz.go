package main

import (
	"github.com/billstark001/tensnap/packages/tensnap-go/binding"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

func NewVizModel(config Config) *binding.Model[*Model] {
	m := NewModel(config)
	modelConfig := func(m *Model) *Config { return &m.Config }
	space := binding.MustMetadataFromTags(modelConfig, binding.TagScope("space"))
	colors := map[string]string{susceptible: "#3498db", infected: "#e74c3c", recovered: "#2ecc71"}
	version := "1"

	return binding.NewModel(m,
		binding.WithSimulatorInfo[*Model](protocol.SimulatorInfoPayload{
			Model: protocol.ModelInfo{ID: "examples.go.sirs", StateSchemaVersion: &version},
		}),
		binding.WithInit(func(m *Model) error { m.Reset(); return nil }),
		binding.WithReset(func(m *Model) error { m.Reset(); return nil }),
		binding.WithStep(func(m *Model) (bool, error) { m.Step(); return true, nil }),
		binding.WithParams(binding.MustParamsFromTags(modelConfig)...),
		binding.WithEnvs(binding.NewEnv("sirs_grid",
			binding.NewGridLayer[*Model]("grid").Data(space).
				Restore(binding.RestoreLayer[*Model]{Metadata: validateGrid}),
			binding.NewAgentLayer[*Model, Person]("agents").Data(space).
				Items(func(m *Model) []Person { return m.People }).ProjectTagsRequired("id").
				Field("x", func(m *Model, p Person) any { return p.ID % m.Cols }).
				Field("y", func(m *Model, p Person) any { return p.ID / m.Cols }).
				Field("icon", binding.Const[*Model, Person]("square")).
				Field("size", binding.Const[*Model, Person](0.95)).
				Field("color", func(_ *Model, p Person) any { return colors[p.State] }).
				Restore(binding.RestoreLayer[*Model]{Replace: restorePeople, Metadata: validateGrid}),
		)),
		binding.WithCharts(binding.NewChartGroup("sir", "S/I/R",
			binding.NewChartSeries("susceptible", "Susceptible", colors[susceptible], func(m *Model) any { s, _, _ := m.Counts(); return s }),
			binding.NewChartSeries("infected", "Infected", colors[infected], func(m *Model) any { _, i, _ := m.Counts(); return i }),
			binding.NewChartSeries("recovered", "Recovered", colors[recovered], func(m *Model) any { _, _, r := m.Counts(); return r }),
		)),
		binding.WithRestoreTime(restoreTime),
		binding.WithTypedCheckpoint((*Model).Snapshot, (*Model).Restore),
	)
}
