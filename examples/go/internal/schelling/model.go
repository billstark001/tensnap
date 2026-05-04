package schelling

import (
	"math/rand"
	"strconv"
	"time"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

const (
	defaultGridW = 50
	defaultGridH = 50

	EnvID        = "main"
	AgentLayerID = "agents"
	GridLayerID  = "grid"

	SatisfactionChartID = "satisfaction_rate"
	SegregationChartID  = "segregation_index"

	ActionIDStart = "start"
	ActionIDReset = "reset"
)

type cell struct {
	agentID     string
	group, x, y int
}

type Config struct {
	GridWidth           int
	GridHeight          int
	Density             float64
	SimilarityThreshold float64
}

type runtimeConfig struct {
	gridWidth           int
	gridHeight          int
	density             float64
	similarityThreshold float64
}

type Model struct {
	abm.Base
	abm.TickCounter
	initialized bool
	cells       []cell
	rng         *rand.Rand
	active      runtimeConfig
	diff        *abm.NaiveItemDiffTracker
}

func New() *Model {
	return NewWithConfig(Config{})
}

func NewWithConfig(cfg Config) *Model {
	model := &Model{
		rng:  rand.New(rand.NewSource(time.Now().UnixNano())),
		diff: abm.NewNaiveItemDiffTracker("id"),
	}
	model.SetParam("gridWidth", float64(abm.DefaultedInt(cfg.GridWidth, defaultGridW)))
	model.SetParam("gridHeight", float64(abm.DefaultedInt(cfg.GridHeight, defaultGridH)))
	model.SetParam("density", abm.DefaultedFloat(cfg.Density, 0.48))
	model.SetParam("similarityThreshold", abm.DefaultedFloat(cfg.SimilarityThreshold, 0.4))
	model.SetActionRouter(abm.NewActionRouter().
		Handle(ActionIDStart, func(e abm.Emitter, tickID *string, _ bool) error {
			return model.stepAction(e, ActionIDStart, tickID)
		}).
		Handle(ActionIDReset, func(e abm.Emitter, tickID *string, _ bool) error {
			return model.resetAction(e, ActionIDReset, tickID)
		}).
		Handle(protocol.ActionIDInit, func(e abm.Emitter, tickID *string, _ bool) error {
			return model.resetAction(e, protocol.ActionIDInit, tickID)
		}))
	model.refreshScenario()
	return model
}

func (m *Model) Setup(e abm.Emitter) error {
	if m.initialized {
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

func (m *Model) OnStateSync(e abm.Emitter, payload *protocol.StateSyncPayload) error {
	if !m.initialized {
		m.initializeState()
		m.refreshScenario()
	}
	return m.Base.OnStateSync(e, payload)
}

func (m *Model) Step(e abm.Emitter) error {
	return m.stepAction(e, protocol.ActionIDStep, nil)
}

func (m *Model) stepAction(e abm.Emitter, actionID string, tickID *string) error {
	start := time.Now()
	var unsatisfied []int
	var empty []int
	for index, current := range m.cells {
		if current.group == 0 {
			empty = append(empty, index)
			continue
		}
		if !m.satisfied(index) {
			unsatisfied = append(unsatisfied, index)
		}
	}
	m.rng.Shuffle(len(unsatisfied), func(a, b int) { unsatisfied[a], unsatisfied[b] = unsatisfied[b], unsatisfied[a] })
	m.rng.Shuffle(len(empty), func(a, b int) { empty[a], empty[b] = empty[b], empty[a] })

	swapped := min(len(unsatisfied), len(empty))
	for index := 0; index < swapped; index++ {
		fromIndex := unsatisfied[index]
		toIndex := empty[index]
		m.cells[toIndex].group = m.cells[fromIndex].group
		m.cells[toIndex].agentID = m.cells[fromIndex].agentID
		m.cells[fromIndex].group = 0
		m.cells[fromIndex].agentID = ""
	}
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
		{ID: SatisfactionChartID, Time: &tick, Value: SatisfiedPct(m)},
		{ID: SegregationChartID, Time: &tick, Value: SegregationIndex(m)},
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

func SatisfiedPct(m *Model) float64 {
	satisfiedCount := 0
	occupiedCount := 0
	for index, current := range m.cells {
		if current.group == 0 {
			continue
		}
		occupiedCount++
		if m.satisfied(index) {
			satisfiedCount++
		}
	}
	if occupiedCount == 0 {
		return 0
	}
	return float64(satisfiedCount) / float64(occupiedCount)
}

func SegregationIndex(m *Model) float64 {
	totalRatio := 0.0
	count := 0
	for index, current := range m.cells {
		if current.group == 0 {
			continue
		}
		same := 0
		neighbors := 0
		for _, neighborIndex := range m.neighborIndexes(index) {
			neighbor := m.cells[neighborIndex]
			if neighbor.group == 0 {
				continue
			}
			neighbors++
			if neighbor.group == current.group {
				same++
			}
		}
		if neighbors > 0 {
			totalRatio += float64(same) / float64(neighbors)
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return totalRatio / float64(count)
}

func (m *Model) initializeState() {
	m.ResetTick()
	m.diff.Reset()
	m.applyPendingConfig()
	m.rebuildCells()
	m.populate()
	m.initialized = true
}

func (m *Model) applyPendingConfig() {
	gridWidth, gridHeight := m.pendingGridSize()
	m.active.gridWidth = gridWidth
	m.active.gridHeight = gridHeight
	m.active.density = abm.ClampFloat(m.ParamFloat("density"), 0.1, 0.95)
	m.active.similarityThreshold = abm.ClampFloat(m.ParamFloat("similarityThreshold"), 0, 1)
}

func (m *Model) rebuildCells() {
	width, height := m.activeGridSize()
	m.cells = make([]cell, width*height)
	for index := range m.cells {
		m.cells[index] = cell{x: index % width, y: index / width}
	}
}

func (m *Model) populate() {
	density := m.active.density
	nextType1 := 0
	nextType2 := 0
	for index := range m.cells {
		m.cells[index].agentID = ""
		randomValue := m.rng.Float64()
		switch {
		case randomValue < density/2:
			m.cells[index].group = 1
			m.cells[index].agentID = "agent1_" + strconv.Itoa(nextType1)
			nextType1++
		case randomValue < density:
			m.cells[index].group = 2
			m.cells[index].agentID = "agent2_" + strconv.Itoa(nextType2)
			nextType2++
		default:
			m.cells[index].group = 0
		}
	}
}

func (m *Model) satisfied(index int) bool {
	current := m.cells[index]
	if current.group == 0 {
		return true
	}
	threshold := m.active.similarityThreshold
	sameGroup := 0
	occupiedNeighbors := 0
	for _, neighborIndex := range m.neighborIndexes(index) {
		neighbor := m.cells[neighborIndex]
		if neighbor.group == 0 {
			continue
		}
		occupiedNeighbors++
		if neighbor.group == current.group {
			sameGroup++
		}
	}
	if occupiedNeighbors == 0 {
		return true
	}
	return float64(sameGroup)/float64(occupiedNeighbors) >= threshold
}

func (m *Model) neighborIndexes(index int) []int {
	current := m.cells[index]
	width, height := m.activeGridSize()
	neighbors := make([]int, 0, 8)
	for yOffset := -1; yOffset <= 1; yOffset++ {
		for xOffset := -1; xOffset <= 1; xOffset++ {
			if xOffset == 0 && yOffset == 0 {
				continue
			}
			x := current.x + xOffset
			y := current.y + yOffset
			if x < 0 || x >= width || y < 0 || y >= height {
				continue
			}
			neighbors = append(neighbors, y*width+x)
		}
	}
	return neighbors
}

func (m *Model) pendingGridSize() (int, int) {
	width := abm.ClampInt(int(m.ParamFloat("gridWidth")), 10, 200)
	height := abm.ClampInt(int(m.ParamFloat("gridHeight")), 10, 200)
	return width, height
}

func (m *Model) activeGridSize() (int, int) {
	return m.active.gridWidth, m.active.gridHeight
}

func (m *Model) refreshScenario() {
	pendingGridWidth, pendingGridHeight := m.pendingGridSize()
	activeGridWidth, activeGridHeight := m.activeGridSize()
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
					m.active.similarityThreshold = threshold
					return nil
				},
			},
			&abm.ParamMetadata{
				Definition: protocol.NumberParameter{ID: "gridWidth", Type: "number", Label: "Grid Width", Value: float64(pendingGridWidth), Min: 10, Max: 200, Step: 1, AllowRuntimeChange: abm.BoolPtr(false)},
				Normalize: func(value any) (any, error) {
					f, ok := abm.AsFloat64(value)
					if !ok {
						return nil, protocolDecodeError("gridWidth")
					}
					return float64(abm.ClampInt(int(f), 10, 200)), nil
				},
			},
			&abm.ParamMetadata{
				Definition: protocol.NumberParameter{ID: "gridHeight", Type: "number", Label: "Grid Height", Value: float64(pendingGridHeight), Min: 10, Max: 200, Step: 1, AllowRuntimeChange: abm.BoolPtr(false)},
				Normalize: func(value any) (any, error) {
					f, ok := abm.AsFloat64(value)
					if !ok {
						return nil, protocolDecodeError("gridHeight")
					}
					return float64(abm.ClampInt(int(f), 10, 200)), nil
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
				{EnvID: EnvID, LayerID: AgentLayerID, LayerType: "agent", Data: map[string]any{"width": activeGridWidth, "height": activeGridHeight}},
				{EnvID: EnvID, LayerID: GridLayerID, LayerType: "grid", Data: map[string]any{"width": activeGridWidth, "height": activeGridHeight}},
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

func (m *Model) resetAction(e abm.Emitter, actionID string, tickID *string) error {
	if err := m.Setup(e); err != nil {
		return err
	}
	return e.ActionEnd(&protocol.ActionEndPayload{
		ID:       actionID,
		TickID:   tickID,
		Continue: abm.BoolPtr(false),
	})
}

func (m *Model) replayState(e abm.Emitter) error {
	items := m.snapshotItems()
	if err := e.ItemCreate(EnvID, AgentLayerID, items); err != nil {
		return err
	}
	m.diff.Seed(items)
	currentTick := float64(m.Tick())
	if err := e.ChartUpdate(&protocol.ChartUpdatePayload{Updates: []protocol.ChartUpdateEntry{
		{ID: SatisfactionChartID, Time: &currentTick, Value: SatisfiedPct(m)},
		{ID: SegregationChartID, Time: &currentTick, Value: SegregationIndex(m)},
	}}); err != nil {
		return err
	}
	return e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &currentTick})
}

func (m *Model) snapshotItems() []map[string]any {
	items := make([]map[string]any, 0, len(m.cells))
	for index, current := range m.cells {
		if current.group == 0 {
			continue
		}
		size := 1.0
		if !m.satisfied(index) {
			size = 0.6
		}
		items = append(items, map[string]any{
			"id":      current.agentID,
			"x":       float64(current.x),
			"y":       float64(current.y),
			"heading": float64(0),
			"color":   groupColor(current.group),
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
