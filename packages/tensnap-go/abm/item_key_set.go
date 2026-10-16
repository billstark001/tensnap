package abm

const (
	keySetGrowthFactor = 2
	keySetShrinkFactor = 4
)

// itemKeySet reuses per-tracker scan storage, retaining no item values. Resize
// on large population changes so a mostly emptied layer does not retain a huge
// scratch table or pay to clear it every step. Reset releases it entirely.
type itemKeySet struct {
	keys      map[any]struct{}
	highWater int
}

func (s *itemKeySet) begin(count int) map[any]struct{} {
	if s.keys == nil || count > s.highWater*keySetGrowthFactor || count < s.highWater/keySetShrinkFactor {
		s.keys = make(map[any]struct{}, count)
		s.highWater = count
	} else {
		clear(s.keys)
		s.highWater = max(s.highWater, count)
	}
	return s.keys
}
