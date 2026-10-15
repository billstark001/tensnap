package abm

import (
	"fmt"
	"maps"
	"math"
	"reflect"
	"slices"
	"strconv"
	"strings"
)

// ItemSnapshot is a single item's projected field map, ready to send over the wire.
type ItemSnapshot = map[string]any

// DictDiff returns the fields in b that are absent or differ from a.
// Key fields present in a but absent in b are NOT included (they are not "changed").
// The result is suitable for use as an item_update payload.
func DictDiff(a, b ItemSnapshot) ItemSnapshot {
	var diff ItemSnapshot
	for k, bv := range b {
		av, ok := a[k]
		if !ok || !reflect.DeepEqual(av, bv) {
			if diff == nil {
				diff = make(ItemSnapshot)
			}
			diff[k] = bv
		}
	}
	return diff
}

// diffSnapshot compares complete projections. Unlike DictDiff's partial-map
// contract, omitted fields must be cleared explicitly on the renderer.
func diffSnapshot(previous, current ItemSnapshot) ItemSnapshot {
	diff := DictDiff(previous, current)
	if diff == nil && len(previous) == len(current) {
		return nil
	}
	for key := range previous {
		if _, present := current[key]; !present {
			if diff == nil {
				diff = make(ItemSnapshot)
			}
			diff[key] = nil
		}
	}
	return diff
}

func cloneSnapshot(item ItemSnapshot) ItemSnapshot {
	return maps.Clone(item)
}

// #region ItemDiffTracker — precise change tracking

// ItemDiffTracker tracks projected item state across steps.
// It relies on caller-supplied id and changed accessors to avoid full re-projection
// when an item has not changed, and performs field-level diffing on changed items.
//
// T is the item type stored in your model (e.g. a struct or pointer).
// Use [NewItemDiffTracker] to create an instance; embed or store in your Model struct.
// Call [Reset] when re-initializing the model (e.g. on Setup).
// Seed and Compute panic if an identity is a non-finite numeric value.
type ItemDiffTracker[T any] struct {
	prev map[any]ItemSnapshot
}

// NewItemDiffTracker returns an initialized tracker.
func NewItemDiffTracker[T any]() *ItemDiffTracker[T] {
	return &ItemDiffTracker[T]{prev: make(map[any]ItemSnapshot)}
}

// Reset clears the tracker's internal state.
func (t *ItemDiffTracker[T]) Reset() {
	t.prev = make(map[any]ItemSnapshot)
}

// Seed primes the tracker with pre-projected snapshots keyed by idFn.
// Call this after an ItemCreate that initializes the renderer so that the first
// Compute call produces correct incremental diffs.
func (t *ItemDiffTracker[T]) Seed(items []T, idFn func(T) any, projFn func(T) ItemSnapshot) {
	t.prev = make(map[any]ItemSnapshot, len(items))
	for _, item := range items {
		id := idFn(item)
		checkScalarKey(id) // Reject non-finite numeric identities before inserting a map key.
		t.prev[id] = cloneSnapshot(projFn(item))
	}
}

// SeedSnapshots primes the tracker from raw items and their already-projected
// snapshots. It is useful after a full replay that already paid projection cost.
func (t *ItemDiffTracker[T]) SeedSnapshots(
	items []T,
	snapshots []ItemSnapshot,
	idFn func(T) any,
) {
	t.prev = make(map[any]ItemSnapshot, len(items))
	for index, item := range items {
		if index >= len(snapshots) {
			break
		}
		id := idFn(item)
		checkScalarKey(id)
		t.prev[id] = cloneSnapshot(snapshots[index])
	}
}

// Compute iterates items and returns three lists:
//   - created: full snapshots of items whose ID was not seen in the previous step.
//   - updated: field-level diff snapshots (only changed fields + id field) for items
//     that were seen before but whose changedFn returned true.
//   - deleted: IDs of items present in the previous step but absent now.
//
// projFn is only called for new or changed items, saving work for unchanged items.
// After Compute returns, the tracker's internal state reflects the current step.
func (t *ItemDiffTracker[T]) Compute(
	items []T,
	idFn func(T) any,
	changedFn func(T) bool,
	projFn func(T) ItemSnapshot,
) (created, updated []ItemSnapshot, deleted []any) {
	currentIDs := make(map[any]struct{}, len(items))

	for _, item := range items {
		id := idFn(item)
		checkScalarKey(id)
		currentIDs[id] = struct{}{}

		prev, seen := t.prev[id]
		if !seen {
			// New item — full snapshot.
			snap := projFn(item)
			t.prev[id] = cloneSnapshot(snap)
			created = append(created, snap)
		} else if changedFn(item) {
			// Changed item — project and emit only differing fields.
			snap := projFn(item)
			diff := diffSnapshot(prev, snap)
			t.prev[id] = cloneSnapshot(snap)
			if len(diff) > 0 {
				diff["id"] = id
				updated = append(updated, diff)
			}
		}
		// Unchanged items: no emission, prev entry untouched.
	}

	// Detect deletions.
	for id := range t.prev {
		if _, alive := currentIDs[id]; !alive {
			deleted = append(deleted, id)
			delete(t.prev, id)
		}
	}

	return created, updated, deleted
}

// #endregion

// #region NaiveItemDiffTracker — full-projection field-level diffing

// NaiveItemDiffTracker computes diffs by fully projecting every item each step,
// then comparing field-by-field against the previous snapshot.
// This is simpler than [ItemDiffTracker] but calls projFn for all items every step.
//
// keyFields names the fields that together form the primary key (e.g. "id").
// Updated payloads contain only the changed fields plus the key fields.
// Use [NewNaiveItemDiffTracker] to create an instance.
// Non-finite numeric key values panic before they enter the cache.
type NaiveItemDiffTracker struct {
	keyFields []string
	prev      map[any]ItemSnapshot
}

// NewNaiveItemDiffTracker returns a tracker keyed by the given field names.
// Panics if no key fields are supplied.
func NewNaiveItemDiffTracker(keyFields ...string) *NaiveItemDiffTracker {
	if len(keyFields) == 0 {
		panic("abm: NaiveItemDiffTracker requires at least one key field")
	}
	return &NaiveItemDiffTracker{
		keyFields: slices.Clone(keyFields),
		prev:      make(map[any]ItemSnapshot),
	}
}

// Reset clears the tracker's internal state.
func (t *NaiveItemDiffTracker) Reset() {
	t.prev = make(map[any]ItemSnapshot)
}

// itemKey keeps the overwhelmingly common one-field scalar key as-is, rather
// than formatting it into a throwaway string for every item on every tick.
func (t *NaiveItemDiffTracker) itemKey(item ItemSnapshot) any {
	if len(t.keyFields) == 1 {
		value := item[t.keyFields[0]]
		if checkScalarKey(value) {
			return value
		}
		return fmt.Sprintf("%T:%v", value, value)
	}
	// Edge keys are the common compound case. A comparable pair preserves
	// endpoint types and embedded separators without formatting or allocations.
	if len(t.keyFields) == 2 {
		first, second := item[t.keyFields[0]], item[t.keyFields[1]]
		if checkScalarKey(first) && checkScalarKey(second) {
			return [2]any{first, second}
		}
	}
	var key strings.Builder
	for _, field := range t.keyFields {
		value := item[field]
		checkScalarKey(value)
		part := fmt.Sprintf("%T:%v", value, value)
		key.WriteString(strconv.Itoa(len(part)))
		key.WriteByte(':')
		key.WriteString(part)
	}
	return key.String()
}

// checkScalarKey recognizes scalar identities and rejects non-finite numbers.
func checkScalarKey(value any) bool {
	switch number := value.(type) {
	case float32:
		if math.IsNaN(float64(number)) || math.IsInf(float64(number), 0) {
			panic("abm: numeric item keys must be finite")
		}
		return true
	case float64:
		if math.IsNaN(number) || math.IsInf(number, 0) {
			panic("abm: numeric item keys must be finite")
		}
		return true
	case nil, bool, string, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return true
	default:
		kind := reflect.TypeOf(value).Kind()
		if kind == reflect.Float32 || kind == reflect.Float64 {
			number := reflect.ValueOf(value).Float()
			if math.IsNaN(number) || math.IsInf(number, 0) {
				panic("abm: numeric item keys must be finite")
			}
		}
		return false
	}
}

func (t *NaiveItemDiffTracker) itemDeleteKey(item ItemSnapshot) any {
	if len(t.keyFields) == 1 {
		return item[t.keyFields[0]]
	}
	key := make(map[string]any, len(t.keyFields))
	for _, field := range t.keyFields {
		key[field] = item[field]
	}
	return key
}

// Seed primes the tracker with the given snapshots without returning any diff lists.
// Call this after an ItemCreate that was used to initialize the renderer so that
// the first subsequent Compute call produces correct incremental diffs instead of
// treating every existing item as newly created.
func (t *NaiveItemDiffTracker) Seed(projected []ItemSnapshot) {
	t.prev = make(map[any]ItemSnapshot, len(projected))
	for _, item := range projected {
		key := t.itemKey(item)
		t.prev[key] = cloneSnapshot(item)
	}
}

// Compute takes the full list of projected snapshots for the current step and
// returns:
//   - created: full snapshots for newly appearing keys.
//   - updated: diff snapshots (changed fields + key fields) for changed items.
//   - deleted: scalar keys, or maps of key fields for compound keys, for disappeared items.
//
// After Compute returns, the tracker's internal state reflects the current step.
func (t *NaiveItemDiffTracker) Compute(
	projected []ItemSnapshot,
) (created, updated []ItemSnapshot, deleted []any) {
	currentKeys := make(map[any]struct{}, len(projected))

	for _, item := range projected {
		key := t.itemKey(item)
		currentKeys[key] = struct{}{}

		prev, seen := t.prev[key]
		if !seen {
			// New item.
			t.prev[key] = cloneSnapshot(item)
			created = append(created, item)
		} else {
			diff := diffSnapshot(prev, item)
			if len(diff) > 0 {
				// Emit diff + key fields so the renderer can identify the item.
				payload := make(ItemSnapshot, len(diff)+len(t.keyFields))
				for k, v := range diff {
					payload[k] = v
				}
				for _, kf := range t.keyFields {
					payload[kf] = item[kf]
				}
				updated = append(updated, payload)
				// Replace rather than merge: omitted fields are no longer present.
				t.prev[key] = cloneSnapshot(item)
			}
		}
	}

	// Detect deletions.
	for key := range t.prev {
		if _, alive := currentKeys[key]; !alive {
			deleted = append(deleted, t.itemDeleteKey(t.prev[key]))
			delete(t.prev, key)
		}
	}

	return created, updated, deleted
}

// #endregion
