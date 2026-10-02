package binding

import (
	"fmt"
	"sort"

	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

// orderLayerDependencies is shared by environment registration and projected
// restore. The caller supplies IDs and dependencies in source order.
func orderLayerDependencies(ids []string, dependencies [][]string) ([]int, error) {
	position := make(map[string]int, len(ids))
	for i, id := range ids {
		if id == "" {
			return nil, fmt.Errorf("empty layer id")
		}
		if _, exists := position[id]; exists {
			return nil, fmt.Errorf("duplicate layer id: %s", id)
		}
		position[id] = i
	}
	ordered := make([]int, 0, len(ids))
	state := make([]uint8, len(ids))
	var visit func(int) error
	visit = func(i int) error {
		if state[i] == 2 {
			return nil
		}
		if state[i] == 1 {
			return fmt.Errorf("cyclic layer dependency: %s", ids[i])
		}
		state[i] = 1
		refs := append([]string(nil), dependencies[i]...)
		sort.Slice(refs, func(a, b int) bool {
			return position[refs[a]] < position[refs[b]]
		})
		for _, dependency := range refs {
			j, exists := position[dependency]
			if !exists {
				return fmt.Errorf("layer %s depends on missing layer %s", ids[i], dependency)
			}
			if err := visit(j); err != nil {
				return err
			}
		}
		state[i] = 2
		ordered = append(ordered, i)
		return nil
	}
	for i := range ids {
		if err := visit(i); err != nil {
			return nil, err
		}
	}
	return ordered, nil
}

// orderedLayers resolves dependency ids within this environment. A dependent
// layer is always emitted after its prerequisite, independent of source order.
func (e *Env[T]) orderedLayers(target T) ([]Layer[T], error) {
	payloads := make(map[string]*protocol.EnvLayerCreatePayload, len(e.layers))
	ids := make([]string, 0, len(e.layers))
	for _, layer := range e.layers {
		payload := layer.CreatePayload(target, e.ID)
		if payload == nil || payload.LayerID == "" {
			return nil, fmt.Errorf("environment %s has an empty layer id", e.ID)
		}
		if _, exists := payloads[payload.LayerID]; exists {
			return nil, fmt.Errorf("duplicate layer id: %s/%s", e.ID, payload.LayerID)
		}
		payloads[payload.LayerID] = payload
		ids = append(ids, payload.LayerID)
	}
	dependencies := make([][]string, len(ids))
	for i, id := range ids {
		for role, dependency := range payloads[id].DependencyLayerIDs {
			targetPayload, exists := payloads[dependency]
			if exists && role == "agent" && targetPayload.LayerType != "agent" {
				return nil, fmt.Errorf("layer %s/%s requires agent layer %s", e.ID, id, dependency)
			}
			dependencies[i] = append(dependencies[i], dependency)
		}
	}
	indices, err := orderLayerDependencies(ids, dependencies)
	if err != nil {
		return nil, err
	}
	ordered := make([]Layer[T], 0, len(indices))
	for _, i := range indices {
		ordered = append(ordered, e.layers[i])
	}
	return ordered, nil
}
