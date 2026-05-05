package abm

import (
	"fmt"
	"strings"
)

// ItemSnapshot is a single item's projected field map, ready to send over the wire.
type ItemSnapshot = map[string]any

// DictDiff returns the fields in b that are absent or differ from a.
// Key fields present in a but absent in b are NOT included (they are not "changed").
// The result is suitable for use as an item_update payload.
func DictDiff(a, b ItemSnapshot) ItemSnapshot {
	diff := make(ItemSnapshot)
	for k, bv := range b {
		av, ok := a[k]
		if !ok || av != bv {
			diff[k] = bv
		}
	}
	return diff
}

// #region ItemDiffTracker — precise change tracking

// ItemDiffTracker tracks projected item state across steps.
// It relies on caller-supplied id and changed accessors to avoid full re-projection
// when an item has not changed, and performs field-level diffing on changed items.
//
// T is the item type stored in your model (e.g. a struct or pointer).
// Use [NewItemDiffTracker] to create an instance; embed or store in your Model struct.
// Call [Reset] when re-initializing the model (e.g. on Setup).
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
		t.prev[id] = projFn(item)
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
		currentIDs[id] = struct{}{}

		prev, seen := t.prev[id]
		if !seen {
			// New item — full snapshot.
			snap := projFn(item)
			t.prev[id] = snap
			created = append(created, snap)
		} else if changedFn(item) {
			// Changed item — project and emit only differing fields.
			snap := projFn(item)
			diff := DictDiff(prev, snap)
			t.prev[id] = snap
			if len(diff) > 0 {
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
type NaiveItemDiffTracker struct {
	keyFields []string
	prev      map[string]ItemSnapshot
}

// NewNaiveItemDiffTracker returns a tracker keyed by the given field names.
// Panics if no key fields are supplied.
func NewNaiveItemDiffTracker(keyFields ...string) *NaiveItemDiffTracker {
	if len(keyFields) == 0 {
		panic("abm: NaiveItemDiffTracker requires at least one key field")
	}
	return &NaiveItemDiffTracker{
		keyFields: keyFields,
		prev:      make(map[string]ItemSnapshot),
	}
}

// Reset clears the tracker's internal state.
func (t *NaiveItemDiffTracker) Reset() {
	t.prev = make(map[string]ItemSnapshot)
}

// itemKey builds a stable string key from the item's key fields.
func (t *NaiveItemDiffTracker) itemKey(item ItemSnapshot) string {
	if len(t.keyFields) == 1 {
		return fmt.Sprintf("%v", item[t.keyFields[0]])
	}
	parts := make([]string, len(t.keyFields))
	for i, f := range t.keyFields {
		parts[i] = fmt.Sprintf("%v", item[f])
	}
	return strings.Join(parts, "\x00")
}

// Seed primes the tracker with the given snapshots without returning any diff lists.
// Call this after an ItemCreate that was used to initialize the renderer so that
// the first subsequent Compute call produces correct incremental diffs instead of
// treating every existing item as newly created.
func (t *NaiveItemDiffTracker) Seed(projected []ItemSnapshot) {
	t.prev = make(map[string]ItemSnapshot, len(projected))
	for _, item := range projected {
		key := t.itemKey(item)
		snap := make(ItemSnapshot, len(item))
		for k, v := range item {
			snap[k] = v
		}
		t.prev[key] = snap
	}
}

// Compute takes the full list of projected snapshots for the current step and
// returns:
//   - created: full snapshots for newly appearing keys.
//   - updated: diff snapshots (changed fields + key fields) for changed items.
//   - deleted: key values (or "\x00"-joined tuples) for disappeared items.
//
// After Compute returns, the tracker's internal state reflects the current step.
func (t *NaiveItemDiffTracker) Compute(
	projected []ItemSnapshot,
) (created, updated []ItemSnapshot, deleted []any) {
	currentKeys := make(map[string]struct{}, len(projected))

	for _, item := range projected {
		key := t.itemKey(item)
		currentKeys[key] = struct{}{}

		prev, seen := t.prev[key]
		if !seen {
			// New item.
			snap := make(ItemSnapshot, len(item))
			for k, v := range item {
				snap[k] = v
			}
			t.prev[key] = snap
			created = append(created, item)
		} else {
			diff := DictDiff(prev, item)
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
				// Update stored snapshot.
				for k, v := range item {
					prev[k] = v
				}
			}
		}
	}

	// Detect deletions.
	for key := range t.prev {
		if _, alive := currentKeys[key]; !alive {
			deleted = append(deleted, key)
			delete(t.prev, key)
		}
	}

	return created, updated, deleted
}

// #endregion
