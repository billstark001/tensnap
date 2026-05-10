package schelling

import (
	"time"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

const (
	EnvID        = "main"
	AgentLayerID = "agents"
	GridLayerID  = "grid"

	SatisfactionChartID = "satisfaction_rate"
	SegregationChartID  = "segregation_index"

	ActionIDStart = "start"
	ActionIDReset = "reset"
)

type VizModel struct {
	abm.Base
	abm.TickCounter
	model *Model
	diff  *abm.NaiveItemDiffTracker
}

func NewVizModel(model *Model) *VizModel {
	m := &VizModel{
		model: model,
		diff:  abm.NewNaiveItemDiffTracker("id"),
	}

	m.SetParam("gridWidth", float64(abm.DefaultedInt(model.Config.GridWidth, defaultGridW)))
	m.SetParam("gridHeight", float64(abm.DefaultedInt(model.Config.GridHeight, defaultGridH)))
	m.SetParam("density", abm.DefaultedFloat(model.Config.Density, 0.48))
	m.SetParam("similarityThreshold", abm.DefaultedFloat(model.Config.SimilarityThreshold, 0.4))

	m.SetActionRouter(abm.NewActionRouter().
		Handle(ActionIDStart, func(e abm.Emitter, tickID *string, _ bool) error {
			return m.stepAction(e, ActionIDStart, tickID)
		}).
		Handle(ActionIDReset, func(e abm.Emitter, tickID *string, _ bool) error {
			return m.resetAction(e, ActionIDReset, tickID)
		}).
		Handle(protocol.ActionIDInit, func(e abm.Emitter, tickID *string, _ bool) error {
			return m.resetAction(e, protocol.ActionIDInit, tickID)
		}))
	m.refreshScenario()
	return m
}

func (m *VizModel) Setup(e abm.Emitter) error {
	if m.model.Initialized {
		if err := e.ChartDelete(SatisfactionChartID); err != nil {
			return err
		}
		if err := e.ChartDelete(SegregationChartID); err != nil {
			return err
		}
		if err := e.EnvDelete(EnvID); err != nil {
			return err
		}
	}

	m.initializeState()
	m.refreshScenario()
	return m.ReplayScenario(e)
}

func (m *VizModel) OnStateSync(e abm.Emitter, payload *protocol.StateSyncPayload) error {
	if !m.model.Initialized {
		m.initializeState()
		m.refreshScenario()
	}
	return m.Base.OnStateSync(e, payload)
}

func (m *VizModel) Step(e abm.Emitter) error {
	return m.stepAction(e, protocol.ActionIDStep, nil)
}

func (m *VizModel) stepAction(e abm.Emitter, actionID string, tickID *string) error {
	start := time.Now()

	swapped := m.model.Step()

	created, updated, deleted := m.diff.Compute(m.snapshotItems())
	if len(created) > 0 {
		if err := e.ItemCreate(EnvID, AgentLayerID, created); err != nil {
			return err
		}
	}
	if len(updated) > 0 {
		if err := e.ItemUpdate(EnvID, AgentLayerID, updated); err != nil {
			return err
		}
	}
	if len(deleted) > 0 {
		if err := e.ItemDelete(EnvID, AgentLayerID, deleted); err != nil {
			return err
		}
	}

	tick := float64(m.NextTick())
	if err := e.ChartUpdate(&protocol.ChartUpdatePayload{Updates: []protocol.ChartUpdateEntry{
		{ID: SatisfactionChartID, Time: &tick, Value: m.model.SatisfiedPct()},
		{ID: SegregationChartID, Time: &tick, Value: m.model.SegregationIndex()},
	}}); err != nil {
		return err
	}
	if err := e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &tick}); err != nil {
		return err
	}

	simulateMS := float64(time.Since(start).Milliseconds())
	return e.ActionEnd(&protocol.ActionEndPayload{
		ID:       actionID,
		TickID:   tickID,
		Continue: abm.BoolPtr(swapped > 0),
		Timings:  &protocol.ActionEndTimings{SimulateMS: &simulateMS},
	})
}

func (m *VizModel) initializeState() {
	m.ResetTick()
	m.diff.Reset()
	m.model.Initialize()
}

func (m *VizModel) refreshScenario() {
	w, h := m.model.GridSize()
	satColor := "#2f9e44"
	segColor := "#e8590c"
	scenario := abm.NewScenario().
		WithParams(
			&abm.ParamMetadata{
				Definition: protocol.NumberParameter{ID: "similarityThreshold", Type: "number", Label: "Similarity Threshold", Value: m.ParamFloat("similarityThreshold"), Min: 0.0, Max: 1.0, Step: 0.05, AllowRuntimeChange: abm.BoolPtr(true)},
				Aliases:    []string{"threshold"},
				Normalize: func(value any) (any, error) {
					f, ok := abm.AsFloat64(value)
					if !ok {
						return nil, protocolDecodeError("similarityThreshold")
					}
					return abm.ClampFloat(f, 0, 1), nil
				},
				OnSet: func(value any) error {
					threshold, _ := abm.AsFloat64(value)
					m.model.Config.SimilarityThreshold = threshold
					return nil
				},
			},
			&abm.ParamMetadata{
				Definition: protocol.NumberParameter{ID: "gridWidth", Type: "number", Label: "Grid Width", Value: float64(w), Min: 10, Max: 200, Step: 1, AllowRuntimeChange: abm.BoolPtr(false)},
				Normalize: func(value any) (any, error) {
					f, ok := abm.AsFloat64(value)
					if !ok {
						return nil, protocolDecodeError("gridWidth")
					}
					return float64(abm.ClampInt(int(f), 10, 200)), nil
				},
				OnSet: func(value any) error {
					width, _ := abm.AsFloat64(value)
					m.model.Config.GridWidth = int(width)
					return nil
				},
			},
			&abm.ParamMetadata{
				Definition: protocol.NumberParameter{ID: "gridHeight", Type: "number", Label: "Grid Height", Value: float64(h), Min: 10, Max: 200, Step: 1, AllowRuntimeChange: abm.BoolPtr(false)},
				Normalize: func(value any) (any, error) {
					f, ok := abm.AsFloat64(value)
					if !ok {
						return nil, protocolDecodeError("gridHeight")
					}
					return float64(abm.ClampInt(int(f), 10, 200)), nil
				},
				OnSet: func(value any) error {
					height, _ := abm.AsFloat64(value)
					m.model.Config.GridHeight = int(height)
					return nil
				},
			},
			&abm.ParamMetadata{
				Definition: protocol.NumberParameter{ID: "density", Type: "number", Label: "Density", Value: abm.ClampFloat(m.ParamFloat("density"), 0.1, 0.95), Min: 0.1, Max: 0.95, Step: 0.05, AllowRuntimeChange: abm.BoolPtr(false)},
				Normalize: func(value any) (any, error) {
					f, ok := abm.AsFloat64(value)
					if !ok {
						return nil, protocolDecodeError("density")
					}
					return abm.ClampFloat(f, 0.1, 0.95), nil
				},
				OnSet: func(value any) error {
					density, _ := abm.AsFloat64(value)
					m.model.Config.Density = density
					return nil
				},
			},
		).
		WithActions(
			&protocol.Action{ID: ActionIDReset, Label: "Reset", AllowRuntimeChange: abm.BoolPtr(true)},
			&protocol.Action{ID: ActionIDStart, Label: "Start", Continuous: abm.BoolPtr(true), AllowRuntimeChange: abm.BoolPtr(true)},
			&protocol.Action{ID: protocol.ActionIDStep, Label: "Step", AllowRuntimeChange: abm.BoolPtr(true)},
		).
		WithEnvs(abm.ScenarioEnvironment{
			ID:   EnvID,
			Type: "2d",
			Layers: []*protocol.EnvLayerCreatePayload{
				{EnvID: EnvID, LayerID: AgentLayerID, LayerType: "agent", Data: map[string]any{"width": w, "height": h}},
				{EnvID: EnvID, LayerID: GridLayerID, LayerType: "grid", Data: map[string]any{"width": w, "height": h}},
			},
		}).
		WithCharts(
			&protocol.ChartGroupMetadata{ID: SatisfactionChartID, Label: "Satisfaction Rate", Color: &satColor},
			&protocol.ChartGroupMetadata{ID: SegregationChartID, Label: "Segregation Index", Color: &segColor},
		).
		WithStateReplay(m.replayState)
	if err := m.SetScenario(scenario); err != nil {
		panic(err)
	}
}

func protocolDecodeError(paramID string) error {
	return &protocolError{paramID: paramID}
}

type protocolError struct {
	paramID string
}

func (e *protocolError) Error() string {
	return "tensnap: expected numeric parameter \"" + e.paramID + "\""
}

func (m *VizModel) resetAction(e abm.Emitter, actionID string, tickID *string) error {
	if err := m.Setup(e); err != nil {
		return err
	}
	return e.ActionEnd(&protocol.ActionEndPayload{
		ID:       actionID,
		TickID:   tickID,
		Continue: abm.BoolPtr(false),
	})
}

func (m *VizModel) replayState(e abm.Emitter) error {
	items := m.snapshotItems()
	if err := e.ItemCreate(EnvID, AgentLayerID, items); err != nil {
		return err
	}
	m.diff.Seed(items)
	currentTick := float64(m.Tick())
	if err := e.ChartUpdate(&protocol.ChartUpdatePayload{Updates: []protocol.ChartUpdateEntry{
		{ID: SatisfactionChartID, Time: &currentTick, Value: m.model.SatisfiedPct()},
		{ID: SegregationChartID, Time: &currentTick, Value: m.model.SegregationIndex()},
	}}); err != nil {
		return err
	}
	return e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &currentTick})
}

func (m *VizModel) snapshotItems() []map[string]any {
	items := make([]map[string]any, 0, len(m.model.Cells))
	for index, current := range m.model.Cells {
		if current.Group == 0 {
			continue
		}
		size := 1.0
		if !m.model.Satisfied(index) {
			size = 0.6
		}
		items = append(items, map[string]any{
			"id":      current.AgentID,
			"x":       float64(current.X),
			"y":       float64(current.Y),
			"heading": float64(0),
			"color":   groupColor(current.Group),
			"icon":    "circle",
			"size":    size,
		})
	}
	return items
}

func groupColor(group int) string {
	if group == 1 {
		return "#3498db"
	}
	return "#e74c3c"
}
