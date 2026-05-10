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
	defaultSimilarityThreshold = 0.7
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
	Density             float64 `tensnap:"id=density,label=Density,min=0.1,max=0.95,step=0.05,runtime=false"`
	SimilarityThreshold float64 `tensnap:"id=similarityThreshold,label='Similarity Threshold',min=0,max=1,step=0.05,runtime=true,aliases=threshold"`
}

type Model struct {
	rng         *rand.Rand
	Initialized bool
	Cells       []Cell
	Config      Config `tensnap:"type=params"`
}

func NewDefaultModel() *Model {
	return NewModel(Config{
		GridWidth:           defaultGridW,
		GridHeight:          defaultGridH,
		Density:             defaultDensity,
		SimilarityThreshold: defaultSimilarityThreshold,
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
	if model.Config.Density <= 0 {
		model.Config.Density = defaultDensity
	}
	if model.Config.SimilarityThreshold <= 0 {
		model.Config.SimilarityThreshold = defaultSimilarityThreshold
	}
	model.Initialize()
	return model
}

func (m *Model) Step() int {
	var unsatisfied []int
	var empty []int
	for index, current := range m.Cells {
		if current.Group == 0 {
			empty = append(empty, index)
			continue
		}
		if !m.Satisfied(index) {
			unsatisfied = append(unsatisfied, index)
		}
	}
	m.rng.Shuffle(len(unsatisfied), func(a, b int) { unsatisfied[a], unsatisfied[b] = unsatisfied[b], unsatisfied[a] })
	m.rng.Shuffle(len(empty), func(a, b int) { empty[a], empty[b] = empty[b], empty[a] })

	swapped := min(len(unsatisfied), len(empty))
	for index := range swapped {
		fromIndex := unsatisfied[index]
		toIndex := empty[index]
		m.Cells[toIndex].Group = m.Cells[fromIndex].Group
		m.Cells[toIndex].AgentID = m.Cells[fromIndex].AgentID
		m.Cells[fromIndex].Group = 0
		m.Cells[fromIndex].AgentID = ""
	}
	return swapped
}

func (m *Model) SatisfiedPct() float64 {
	satisfiedCount := 0
	occupiedCount := 0
	for index, current := range m.Cells {
		if current.Group == 0 {
			continue
		}
		occupiedCount++
		if m.Satisfied(index) {
			satisfiedCount++
		}
	}
	if occupiedCount == 0 {
		return 0
	}
	return float64(satisfiedCount) / float64(occupiedCount)
}

func (m *Model) SegregationIndex() float64 {
	totalRatio := 0.0
	count := 0
	for index, current := range m.Cells {
		if current.Group == 0 {
			continue
		}
		same := 0
		neighbors := 0
		for _, neighborIndex := range m.NeighborIndexes(index) {
			neighbor := m.Cells[neighborIndex]
			if neighbor.Group == 0 {
				continue
			}
			neighbors++
			if neighbor.Group == current.Group {
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
	m.Cells = make([]Cell, width*height)
	for index := range m.Cells {
		m.Cells[index] = Cell{X: index % width, Y: index / width}
	}
}

func (m *Model) Populate() {
	density := m.Config.Density
	nextType1 := 0
	nextType2 := 0
	for index := range m.Cells {
		m.Cells[index].AgentID = ""
		randomValue := m.rng.Float64()
		switch {
		case randomValue < density/2:
			m.Cells[index].Group = 1
			m.Cells[index].AgentID = "agent1_" + strconv.Itoa(nextType1)
			nextType1++
		case randomValue < density:
			m.Cells[index].Group = 2
			m.Cells[index].AgentID = "agent2_" + strconv.Itoa(nextType2)
			nextType2++
		default:
			m.Cells[index].Group = 0
		}
	}
}

func (m *Model) Satisfied(index int) bool {
	current := m.Cells[index]
	if current.Group == 0 {
		return true
	}
	threshold := m.Config.SimilarityThreshold
	sameGroup := 0
	occupiedNeighbors := 0
	for _, neighborIndex := range m.NeighborIndexes(index) {
		neighbor := m.Cells[neighborIndex]
		if neighbor.Group == 0 {
			continue
		}
		occupiedNeighbors++
		if neighbor.Group == current.Group {
			sameGroup++
		}
	}
	if occupiedNeighbors == 0 {
		return true
	}
	return float64(sameGroup)/float64(occupiedNeighbors) >= threshold
}

func (m *Model) NeighborIndexes(index int) []int {
	current := m.Cells[index]
	width, height := m.GridSize()
	neighbors := make([]int, 0, 8)
	for yOffset := -1; yOffset <= 1; yOffset++ {
		for xOffset := -1; xOffset <= 1; xOffset++ {
			if xOffset == 0 && yOffset == 0 {
				continue
			}
			x := current.X + xOffset
			y := current.Y + yOffset
			if x < 0 || x >= width || y < 0 || y >= height {
				continue
			}
			neighbors = append(neighbors, y*width+x)
		}
	}
	return neighbors
}

func (m *Model) GridSize() (int, int) {
	return m.Config.GridWidth, m.Config.GridHeight
}
