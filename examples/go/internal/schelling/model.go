package schelling

import (
	"fmt"
	"math/rand"
	"time"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

const (
	GridW   = 20
	GridH   = 20
	EnvID   = "env0"
	LayerID = "agents"
	ChartID = "sat"
)

type cell struct {
	id          string
	group, x, y int
}

type Model struct {
	abm.Base
	abm.TickCounter
	initialized bool
	cells       [GridW * GridH]cell
	rng         *rand.Rand
}

func New() *Model {
	model := &Model{rng: rand.New(rand.NewSource(time.Now().UnixNano()))}
	for index := range model.cells {
		model.cells[index] = cell{id: fmt.Sprintf("%d", index), x: index % GridW, y: index / GridW}
	}
	model.SetParam("density", 0.7)
	model.SetParam("threshold", 0.3)
	return model
}

func (m *Model) Setup(e abm.Emitter) error {
	if m.initialized {
		if err := e.ChartDelete(ChartID); err != nil {
			return err
		}
		if err := e.EnvDelete(EnvID); err != nil {
			return err
		}
	}

	m.ResetTick()
	m.populate()
	m.initialized = true
	return m.replay(e)
}

func (m *Model) OnStateSync(e abm.Emitter, payload *protocol.StateSyncPayload) error {
	if err := e.StateSyncBegin(payload.RequestID); err != nil {
		return err
	}
	if err := m.replay(e); err != nil {
		return err
	}
	return e.StateSyncEnd(payload.RequestID)
}

func (m *Model) Step(e abm.Emitter) error {
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
	diffs := make([]map[string]interface{}, 0, swapped*2)
	for index := 0; index < swapped; index++ {
		fromIndex := unsatisfied[index]
		toIndex := empty[index]
		m.cells[toIndex].group, m.cells[fromIndex].group = m.cells[fromIndex].group, 0
		diffs = append(diffs,
			map[string]interface{}{"id": m.cells[toIndex].id, "color": groupColor(m.cells[toIndex].group), "x": float64(m.cells[toIndex].x), "y": float64(m.cells[toIndex].y)},
			map[string]interface{}{"id": m.cells[fromIndex].id, "color": "#00000000", "x": float64(m.cells[fromIndex].x), "y": float64(m.cells[fromIndex].y)},
		)
	}
	if len(diffs) > 0 {
		if err := e.ItemUpdate(EnvID, LayerID, diffs); err != nil {
			return err
		}
	}

	tick := float64(m.NextTick())
	if err := e.ChartUpdate(&protocol.ChartUpdatePayload{Updates: []protocol.ChartUpdateEntry{{ID: ChartID, Time: &tick, Value: SatisfiedPct(m)}}}); err != nil {
		return err
	}
	if err := e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &tick}); err != nil {
		return err
	}

	simulateMS := float64(time.Since(start).Milliseconds())
	return e.ActionEnd(&protocol.ActionEndPayload{
		ID:       protocol.ActionIDStep,
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
	return float64(satisfiedCount) / float64(occupiedCount) * 100
}

func (m *Model) populate() {
	density := m.ParamFloat("density")
	for index := range m.cells {
		randomValue := m.rng.Float64()
		switch {
		case randomValue < density/2:
			m.cells[index].group = 1
		case randomValue < density:
			m.cells[index].group = 2
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
	threshold := m.ParamFloat("threshold")
	sameGroup := 0
	occupiedNeighbors := 0
	for yOffset := -1; yOffset <= 1; yOffset++ {
		for xOffset := -1; xOffset <= 1; xOffset++ {
			if xOffset == 0 && yOffset == 0 {
				continue
			}
			x := current.x + xOffset
			y := current.y + yOffset
			if x < 0 || x >= GridW || y < 0 || y >= GridH {
				continue
			}
			neighbor := m.cells[y*GridW+x]
			if neighbor.group == 0 {
				continue
			}
			occupiedNeighbors++
			if neighbor.group == current.group {
				sameGroup++
			}
		}
	}
	if occupiedNeighbors == 0 {
		return true
	}
	return float64(sameGroup)/float64(occupiedNeighbors) >= threshold
}

func (m *Model) replay(e abm.Emitter) error {
	if err := e.ParamCreate(protocol.NumberParameter{ID: "density", Type: "number", Label: "Density", Value: m.ParamFloat("density"), Min: 0.1, Max: 1.0, Step: 0.05}); err != nil {
		return err
	}
	if err := e.ParamCreate(protocol.NumberParameter{ID: "threshold", Type: "number", Label: "Threshold", Value: m.ParamFloat("threshold"), Min: 0.0, Max: 1.0, Step: 0.05}); err != nil {
		return err
	}
	if err := e.ActionCreate(&protocol.Action{ID: protocol.ActionIDInit, Label: "Reset", AllowRuntimeChange: abm.BoolPtr(true)}); err != nil {
		return err
	}
	if err := e.ActionCreate(&protocol.Action{ID: protocol.ActionIDStep, Label: "Step", Continuous: abm.BoolPtr(true), AllowRuntimeChange: abm.BoolPtr(true)}); err != nil {
		return err
	}
	if err := e.EnvCreate(EnvID, "2d"); err != nil {
		return err
	}
	if err := e.EnvLayerCreate(&protocol.EnvLayerCreatePayload{EnvID: EnvID, LayerID: LayerID, LayerType: "agent", Data: map[string]interface{}{"width": GridW, "height": GridH}}); err != nil {
		return err
	}
	if err := e.ChartCreate(&protocol.ChartGroupMetadata{ID: ChartID, Label: "% Satisfied"}); err != nil {
		return err
	}
	if err := e.ItemCreate(EnvID, LayerID, m.snapshotItems()); err != nil {
		return err
	}
	currentTick := float64(m.Tick())
	if err := e.ChartUpdate(&protocol.ChartUpdatePayload{Updates: []protocol.ChartUpdateEntry{{ID: ChartID, Time: &currentTick, Value: SatisfiedPct(m)}}}); err != nil {
		return err
	}
	return e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &currentTick})
}

func (m *Model) snapshotItems() []map[string]interface{} {
	items := make([]map[string]interface{}, 0, GridW*GridH)
	for _, current := range m.cells {
		if current.group == 0 {
			continue
		}
		items = append(items, map[string]interface{}{"id": current.id, "color": groupColor(current.group), "x": float64(current.x), "y": float64(current.y)})
	}
	return items
}

func groupColor(group int) string {
	if group == 1 {
		return "#4f98a3"
	}
	return "#d163a7"
}

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}
