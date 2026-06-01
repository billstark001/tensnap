package schelling

import (
	"math/rand"
	"strconv"
	"time"
)

const (
	defaultGridW               = 50
	defaultGridH               = 50
	defaultDensity             = 0.8
	defaultBalance             = 0.5
	defaultSimilarityThreshold = 0.7
	maxNeighbors               = 8
)

type Cell struct {
	AgentID string `tensnap:"id"`
	Group   int
	X       int `tensnap:"x"`
	Y       int `tensnap:"y"`
}

type Config struct {
	GridWidth           int     `tensnap:"id=gridWidth,label='Grid Width',min=10,max=200,step=1,runtime=false; width,scope=space"`
	GridHeight          int     `tensnap:"id=gridHeight,label='Grid Height',min=10,max=200,step=1,runtime=false; height,scope=space"`
	SimilarityThreshold float64 `tensnap:"id=similarityThreshold,label='Similarity Threshold',min=0,max=1,step=0.05,runtime=true,aliases=threshold"`
	Density             float64 `tensnap:"id=density,label=Density,min=0,max=1,step=0.05,runtime=false"`
	Balance             float64 `tensnap:"id=balance,label=Balance,min=0,max=1,step=0.05,runtime=false"`
}

type Model struct {
	rng         *rand.Rand
	Initialized bool
	Cells       []Cell
	Config      Config `tensnap:"type=params"`

	// Cached topology and reusable work buffers. These fields deliberately have no
	// tensnap tags: visualization still reads Cells and Config exactly as before.
	neighborIndexes [][maxNeighbors]int
	neighborCounts  []uint8
	unsatisfied     []int
	empty           []int
}

func NewDefaultModel() *Model {
	return NewModel(Config{
		GridWidth:           defaultGridW,
		GridHeight:          defaultGridH,
		SimilarityThreshold: defaultSimilarityThreshold,
		Density:             defaultDensity,
		Balance:             defaultBalance,
	})
}

func NewModel(cfg Config) *Model {
	model := &Model{
		rng:    rand.New(rand.NewSource(time.Now().UnixNano())),
		Config: cfg,
	}
	if model.Config.GridWidth <= 0 {
		model.Config.GridWidth = defaultGridW
	}
	if model.Config.GridHeight <= 0 {
		model.Config.GridHeight = defaultGridH
	}
	if model.Config.SimilarityThreshold < 0 || model.Config.SimilarityThreshold > 1 {
		model.Config.SimilarityThreshold = defaultSimilarityThreshold
	}
	if model.Config.Density < 0 || model.Config.Density > 1 {
		model.Config.Density = defaultDensity
	}
	if model.Config.Balance < 0 || model.Config.Balance > 1 {
		model.Config.Balance = defaultBalance
	}
	model.Initialize()
	return model
}

func (m *Model) Step() int {
	m.ensureTopologyCache()

	m.unsatisfied = m.unsatisfied[:0]
	m.empty = m.empty[:0]
	threshold := m.Config.SimilarityThreshold // runtime-tunable; read every step.

	for index := range m.Cells {
		switch m.Cells[index].Group {
		case 0:
			m.empty = append(m.empty, index)
		default:
			if !m.satisfiedWithThreshold(index, threshold) {
				m.unsatisfied = append(m.unsatisfied, index)
			}
		}
	}

	m.rng.Shuffle(len(m.unsatisfied), func(a, b int) {
		m.unsatisfied[a], m.unsatisfied[b] = m.unsatisfied[b], m.unsatisfied[a]
	})
	m.rng.Shuffle(len(m.empty), func(a, b int) {
		m.empty[a], m.empty[b] = m.empty[b], m.empty[a]
	})

	swapped := minInt(len(m.unsatisfied), len(m.empty))
	for i := range swapped {
		fromIndex := m.unsatisfied[i]
		toIndex := m.empty[i]
		from := &m.Cells[fromIndex]
		to := &m.Cells[toIndex]

		to.Group = from.Group
		to.AgentID = from.AgentID
		from.Group = 0
		from.AgentID = ""
	}
	return swapped
}

func (m *Model) SatisfiedPct() float64 {
	m.ensureTopologyCache()

	satisfiedCount := 0
	occupiedCount := 0
	threshold := m.Config.SimilarityThreshold
	for index := range m.Cells {
		if m.Cells[index].Group == 0 {
			continue
		}
		occupiedCount++
		if m.satisfiedWithThreshold(index, threshold) {
			satisfiedCount++
		}
	}
	if occupiedCount == 0 {
		return 0
	}
	return float64(satisfiedCount) / float64(occupiedCount)
}

func (m *Model) SegregationIndex() float64 {
	m.ensureTopologyCache()

	totalRatio := 0.0
	count := 0
	for index := range m.Cells {
		currentGroup := m.Cells[index].Group
		if currentGroup == 0 {
			continue
		}

		same := 0
		neighbors := 0
		indexes := m.neighborIndexes[index]
		for i := 0; i < int(m.neighborCounts[index]); i++ {
			neighborGroup := m.Cells[indexes[i]].Group
			if neighborGroup == 0 {
				continue
			}
			neighbors++
			if neighborGroup == currentGroup {
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

func (m *Model) Initialize() {
	m.RebuildCells()
	m.Populate()
	m.Initialized = true
}

func (m *Model) RebuildCells() {
	width, height := m.GridSize()
	size := width * height
	m.Cells = make([]Cell, size)
	for index := range m.Cells {
		m.Cells[index] = Cell{X: index % width, Y: index / width}
	}
	m.rebuildTopologyCache(width, height)
}

func (m *Model) Populate() {
	density := m.Config.Density
	type1Threshold := density * m.Config.Balance
	nextType1 := 0
	nextType2 := 0
	for index := range m.Cells {
		cell := &m.Cells[index]
		cell.AgentID = ""
		randomValue := m.rng.Float64()
		switch {
		case randomValue < type1Threshold:
			cell.Group = 1
			cell.AgentID = "agent1_" + strconv.Itoa(nextType1)
			nextType1++
		case randomValue < density:
			cell.Group = 2
			cell.AgentID = "agent2_" + strconv.Itoa(nextType2)
			nextType2++
		default:
			cell.Group = 0
		}
	}
}

func (m *Model) Satisfied(index int) bool {
	m.ensureTopologyCache()
	return m.satisfiedWithThreshold(index, m.Config.SimilarityThreshold)
}

func (m *Model) satisfiedWithThreshold(index int, threshold float64) bool {
	currentGroup := m.Cells[index].Group
	if currentGroup == 0 {
		return true
	}

	sameGroup := 0
	occupiedNeighbors := 0
	indexes := m.neighborIndexes[index]
	for i := 0; i < int(m.neighborCounts[index]); i++ {
		neighborGroup := m.Cells[indexes[i]].Group
		if neighborGroup == 0 {
			continue
		}
		occupiedNeighbors++
		if neighborGroup == currentGroup {
			sameGroup++
		}
	}
	if occupiedNeighbors == 0 {
		return true
	}
	// Avoid one division per occupied cell.
	return float64(sameGroup) >= threshold*float64(occupiedNeighbors)
}

// NeighborIndexes preserves the public API, but no longer allocates in hot paths.
// Callers that need zero-allocation access should use the cached arrays internally.
func (m *Model) NeighborIndexes(index int) []int {
	m.ensureTopologyCache()
	count := int(m.neighborCounts[index])
	neighbors := make([]int, count)
	copy(neighbors, m.neighborIndexes[index][:count])
	return neighbors
}

func (m *Model) GridSize() (int, int) {
	return m.Config.GridWidth, m.Config.GridHeight
}

func (m *Model) ensureTopologyCache() {
	if len(m.neighborCounts) == len(m.Cells) && len(m.neighborIndexes) == len(m.Cells) {
		return
	}
	width, height := m.GridSize()
	m.rebuildTopologyCache(width, height)
}

func (m *Model) rebuildTopologyCache(width, height int) {
	size := width * height
	m.neighborIndexes = make([][maxNeighbors]int, size)
	m.neighborCounts = make([]uint8, size)
	m.unsatisfied = make([]int, 0, size)
	m.empty = make([]int, 0, size)

	for index := 0; index < size; index++ {
		x := index % width
		y := index / width
		count := 0
		for yOffset := -1; yOffset <= 1; yOffset++ {
			for xOffset := -1; xOffset <= 1; xOffset++ {
				if xOffset == 0 && yOffset == 0 {
					continue
				}
				nx := x + xOffset
				ny := y + yOffset
				if nx < 0 || nx >= width || ny < 0 || ny >= height {
					continue
				}
				m.neighborIndexes[index][count] = ny*width + nx
				count++
			}
		}
		m.neighborCounts[index] = uint8(count)
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
