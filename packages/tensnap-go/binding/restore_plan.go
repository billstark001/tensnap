package binding

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"sort"

	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

// RestoreLayer is the inverse for one complete projected layer. Use Replace
// for array-backed state, or Create/Update/Delete for entities.
// Callbacks mutate only the host model; the binding owns reconciliation.
type RestoreLayer[T any] struct {
	Create   func(T, map[string]any) error
	Update   func(T, map[string]any) error
	Delete   func(T, map[string]any) error
	Replace  func(T, []map[string]any) error
	Metadata func(T, map[string]any) error
	Validate func(T, map[string]any) error
}

// projectedRestore owns the model-wide phases. Layer inverses live on layers.
type projectedRestore[T any] struct {
	Time       func(T, float64) error
	Validate   func(T, *protocol.SceneRestorePayload) error
	AfterApply func(T) error
}

type restoreBinding[T any] interface {
	restoreDefinition() *RestoreLayer[T]
	restoreCurrent(T) []map[string]any
}

func restoreKeyFields(layerType string) []string {
	switch layerType {
	case "edge":
		return []string{"source", "target"}
	default:
		return []string{"id"}
	}
}

func restoreDeleteKey(item map[string]any, fields []string) map[string]any {
	key := make(map[string]any, len(fields))
	for _, field := range fields {
		key[field] = item[field]
	}
	return key
}

type plannedLayer[T any] struct {
	name        string
	definition  RestoreLayer[T]
	layer       restoreBinding[T]
	keyFields   []string
	data        map[string]any
	hasData     bool
	itemBearing bool
	items       []map[string]any
	current     map[string]map[string]any
	incoming    map[string]map[string]any
	deps        []string
}

func restoreRecord(value any) (map[string]any, error) {
	if record, ok := value.(map[string]any); ok {
		return record, nil
	}
	// MessagePack and JSON decoders can choose different concrete map types.
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var record map[string]any
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, err
	}
	if record == nil {
		return nil, fmt.Errorf("expected object")
	}
	return record, nil
}

func restoreRecords(value any) ([]map[string]any, error) {
	if value == nil {
		return nil, nil
	}
	if records, ok := value.([]map[string]any); ok {
		return records, nil
	}
	list, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("expected array of objects")
	}
	result := make([]map[string]any, 0, len(list))
	for _, entry := range list {
		record, err := restoreRecord(entry)
		if err != nil {
			return nil, err
		}
		result = append(result, record)
	}
	return result, nil
}

func restoreKey(item map[string]any, fields []string) (string, error) {
	if len(fields) == 0 {
		fields = []string{"id"}
	}
	parts := make([]any, len(fields))
	for index, field := range fields {
		value, ok := item[field]
		if !ok {
			return "", fmt.Errorf("missing item key %q", field)
		}
		switch value.(type) {
		case string, bool, float64, float32, int, int64, int32, uint, uint64:
		default:
			return "", fmt.Errorf("item key %q must be scalar", field)
		}
		if number, ok := value.(float64); ok && (math.IsNaN(number) || math.IsInf(number, 0)) {
			return "", fmt.Errorf("item key %q must be finite", field)
		}
		parts[index] = value
	}
	raw, _ := json.Marshal(parts)
	return string(raw), nil
}

func indexRestoreItems(items []map[string]any, fields []string) (map[string]map[string]any, error) {
	index := make(map[string]map[string]any, len(items))
	for _, item := range items {
		key, err := restoreKey(item, fields)
		if err != nil {
			return nil, err
		}
		if _, exists := index[key]; exists {
			return nil, fmt.Errorf("duplicate item key %s", key)
		}
		index[key] = item
	}
	return index, nil
}

func (p *projectedRestore[T]) prepare(m *Model[T], payload *protocol.SceneRestorePayload) ([]plannedLayer[T], error) {
	declaredEnvs := make(map[string]*Env[T], len(m.envs))
	for _, env := range m.envs {
		declaredEnvs[env.ID] = env
	}
	seenEnvs := map[string]bool{}
	plans := []plannedLayer[T]{}
	for _, rawEnv := range payload.Envs {
		env, err := restoreRecord(rawEnv)
		if err != nil {
			return nil, err
		}
		id, ok := env["id"].(string)
		if !ok || seenEnvs[id] {
			return nil, fmt.Errorf("invalid or duplicate environment id")
		}
		seenEnvs[id] = true
		definition := declaredEnvs[id]
		if definition == nil || env["type"] != definition.Type {
			return nil, fmt.Errorf("environment topology mismatch: %s", id)
		}
		layers, err := restoreRecords(env["layers"])
		if err != nil {
			return nil, err
		}
		if len(layers) != len(definition.layers) {
			return nil, fmt.Errorf("layer topology mismatch: %s", id)
		}
		declaredLayers := map[string]*protocol.EnvLayerCreatePayload{}
		declaredBindings := map[string]Layer[T]{}
		for _, layer := range definition.layers {
			created := layer.CreatePayload(m.target, id)
			declaredLayers[created.LayerID] = created
			declaredBindings[created.LayerID] = layer
		}
		seenLayers := map[string]bool{}
		for _, layer := range layers {
			layerID, ok := layer["layer_id"].(string)
			if !ok || seenLayers[layerID] {
				return nil, fmt.Errorf("invalid or duplicate layer id")
			}
			seenLayers[layerID] = true
			declared := declaredLayers[layerID]
			if declared == nil || layer["layer_type"] != declared.LayerType {
				return nil, fmt.Errorf("layer topology mismatch: %s/%s", id, layerID)
			}
			deps, err := restoreRecordOrEmpty(layer["dependency_layer_ids"])
			if err != nil {
				return nil, err
			}
			if len(deps) != len(declared.DependencyLayerIDs) {
				return nil, fmt.Errorf("layer dependencies mismatch: %s/%s", id, layerID)
			}
			for role, target := range declared.DependencyLayerIDs {
				if deps[role] != target {
					return nil, fmt.Errorf("layer dependencies mismatch: %s/%s", id, layerID)
				}
			}
			name := id + "/" + layerID
			bound, ok := declaredBindings[layerID].(restoreBinding[T])
			if !ok || bound.restoreDefinition() == nil {
				return nil, fmt.Errorf("no restore declaration for %s", name)
			}
			spec := *bound.restoreDefinition()
			if spec.Replace != nil && (spec.Create != nil || spec.Update != nil || spec.Delete != nil) {
				return nil, fmt.Errorf("restore layer %s cannot combine Replace with collection callbacks", name)
			}
			metadata, err := restoreRecordOrEmpty(layer["metadata"])
			if err != nil {
				return nil, err
			}
			if _, present := layer["metadata"]; present && spec.Metadata == nil {
				return nil, fmt.Errorf("no metadata restore declaration for %s", name)
			}
			items, err := restoreRecords(layer["items"])
			if err != nil {
				return nil, err
			}
			itemBearing := declared.LayerType != "grid" && declared.LayerType != "background"
			if !itemBearing && len(items) != 0 {
				return nil, fmt.Errorf("metadata-only layer %s has items", name)
			}
			if itemBearing && spec.Replace == nil && (spec.Create == nil || spec.Update == nil || spec.Delete == nil) {
				return nil, fmt.Errorf("collection restore for %s needs Create/Update/Delete", name)
			}
			keyFields := restoreKeyFields(declared.LayerType)
			incoming := map[string]map[string]any{}
			if itemBearing && spec.Replace == nil {
				incoming, err = indexRestoreItems(items, keyFields)
				if err != nil {
					return nil, err
				}
				if _, err := indexRestoreItems(bound.restoreCurrent(m.target), keyFields); err != nil {
					return nil, err
				}
			}
			if spec.Validate != nil {
				if err := spec.Validate(m.target, layer); err != nil {
					return nil, err
				}
			}
			dependencies := []string{}
			for _, dep := range declared.DependencyLayerIDs {
				dependencies = append(dependencies, id+"/"+dep)
			}
			_, hasData := layer["metadata"]
			plans = append(plans, plannedLayer[T]{name: name, definition: spec, layer: bound, keyFields: keyFields, data: metadata, hasData: hasData, itemBearing: itemBearing, items: items, incoming: incoming, deps: dependencies})
		}
	}
	seenParams := map[string]bool{}
	for _, change := range payload.Parameters {
		id, ok := change["id"].(string)
		if !ok || seenParams[id] {
			return nil, fmt.Errorf("invalid or duplicate parameter id")
		}
		seenParams[id] = true
		var param *Param[T]
		for _, candidate := range m.params {
			if candidate.ID == id {
				param = candidate
				break
			}
		}
		if param == nil || param.set == nil {
			return nil, fmt.Errorf("parameter %s has no restore setter", id)
		}
		if param.normalize != nil {
			normalized, err := param.normalize(change["value"])
			if err != nil {
				return nil, err
			}
			if !reflect.DeepEqual(normalized, change["value"]) {
				return nil, fmt.Errorf("parameter %s is not a canonical value", id)
			}
		}
	}
	if p.Validate != nil {
		if err := p.Validate(m.target, payload); err != nil {
			return nil, err
		}
	}
	return orderRestoreLayers(plans)
}

func restoreRecordOrEmpty(value any) (map[string]any, error) {
	if value == nil {
		return map[string]any{}, nil
	}
	return restoreRecord(value)
}

func orderRestoreLayers[T any](plans []plannedLayer[T]) ([]plannedLayer[T], error) {
	byName := map[string]plannedLayer[T]{}
	for _, plan := range plans {
		byName[plan.name] = plan
	}
	state := map[string]int{}
	result := make([]plannedLayer[T], 0, len(plans))
	var visit func(string) error
	visit = func(name string) error {
		if state[name] == 2 {
			return nil
		}
		if state[name] == 1 {
			return fmt.Errorf("cyclic layer dependency: %s", name)
		}
		state[name] = 1
		for _, dep := range byName[name].deps {
			if _, ok := byName[dep]; ok {
				if err := visit(dep); err != nil {
					return err
				}
			}
		}
		state[name] = 2
		result = append(result, byName[name])
		return nil
	}
	for _, plan := range plans {
		if err := visit(plan.name); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (p *projectedRestore[T]) validate(m *Model[T], payload *protocol.SceneRestorePayload) error {
	_, err := p.prepare(m, payload)
	return err
}

func (p *projectedRestore[T]) apply(m *Model[T], payload *protocol.SceneRestorePayload) error {
	plans, err := p.prepare(m, payload)
	if err != nil {
		return err
	}
	for _, change := range payload.Parameters {
		for _, param := range m.params {
			if param.ID == change["id"] {
				value := change["value"]
				if param.normalize != nil {
					value, err = param.normalize(value)
					if err != nil {
						return err
					}
				}
				if err := param.set(m.target, value); err != nil {
					return err
				}
				break
			}
		}
	}
	for _, plan := range plans {
		if plan.definition.Metadata != nil && plan.hasData {
			if err := plan.definition.Metadata(m.target, plan.data); err != nil {
				return err
			}
		}
	}
	for i := len(plans) - 1; i >= 0; i-- {
		plan := &plans[i]
		if !plan.itemBearing || plan.definition.Replace != nil {
			continue
		}
		current := plan.layer.restoreCurrent(m.target)
		plan.current, err = indexRestoreItems(current, plan.keyFields)
		if err != nil {
			return err
		}
		keys := sortedKeys(plan.current)
		for _, key := range keys {
			if _, ok := plan.incoming[key]; !ok {
				if err := plan.definition.Delete(m.target, restoreDeleteKey(plan.current[key], plan.keyFields)); err != nil {
					return err
				}
			}
		}
	}
	for _, plan := range plans {
		if !plan.itemBearing {
			continue
		}
		if plan.definition.Replace != nil {
			if err := plan.definition.Replace(m.target, plan.items); err != nil {
				return err
			}
			continue
		}
		for _, key := range sortedKeys(plan.incoming) {
			item := plan.incoming[key]
			if _, ok := plan.current[key]; ok {
				err = plan.definition.Update(m.target, item)
			} else {
				err = plan.definition.Create(m.target, item)
			}
			if err != nil {
				return err
			}
		}
	}
	if payload.Time != nil && p.Time != nil {
		if err := p.Time(m.target, *payload.Time); err != nil {
			return err
		}
	}
	if p.AfterApply != nil {
		return p.AfterApply(m.target)
	}
	return nil
}

func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
