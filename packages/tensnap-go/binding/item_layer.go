package binding

import "github.com/billstark001/tensnap/packages/tensnap-go/abm"

// itemLayer owns the common projection, copying, keyed diff and replay pipeline.
// Layer wrappers declare metadata, keys and lifecycle policy; map/matrix adapt AgentLayer.
type itemLayer[T any, I any] struct {
	copyPolicy  projectionCopy
	items       func(T) []I
	base        func(T, I) map[string]any
	project     func(T, I) map[string]any
	scanProject func(T, I, map[string]any) map[string]any
	fields      map[string]ItemFieldFunc[T, I]
	diff        *abm.NaiveItemDiffTracker
	tracker     *abm.ItemDiffTracker[I]
	itemID      func(T, I) any
	changed     func(T, I) bool
}

func newItemLayer[T any, I any](keys ...string) itemLayer[T, I] {
	return itemLayer[T, I]{diff: abm.NewNaiveItemDiffTracker(keys...), tracker: abm.NewItemDiffTracker[I]()}
}

func (l *itemLayer[T, I]) rebuildProjector() {
	raw := l.base
	if len(l.fields) > 0 && l.base == nil {
		l.copyPolicy.builtin = true
	}
	l.copyPolicy.configureInjectedValues()
	if len(l.fields) > 0 {
		raw = composeProjector(l.base, l.fields, l.copyPolicy.copyInjectedValues)
	}
	l.project = ownedProjector(raw, &l.copyPolicy)
	if l.base == nil && len(l.fields) > 0 && l.copyPolicy.builtin && l.copyPolicy.copiesProjection() {
		// Detach as fields are read, without a second pass over scalar records.
		l.project = composeProjector[T, I](nil, l.fields, true)
	}
	l.scanProject = nil
	if raw != nil && l.copyPolicy.builtin && l.copyPolicy.copiesProjection() && !l.copyPolicy.copiesPublication() {
		l.scanProject = borrowedProjector(l.base, l.fields)
	}
	l.diff.DeepCopy = l.copyPolicy.copiesPublication()
	l.tracker.DeepCopy = l.copyPolicy.copiesPublication()
}

func (l *itemLayer[T, I]) replayState(target T, envID, layerID string, emitter abm.Emitter) error {
	items := l.itemList(target)
	snapshots := l.projectItems(target, items)
	if len(snapshots) > 0 {
		if err := emitter.ItemCreate(envID, layerID, snapshots); err != nil {
			return err
		}
	}
	if l.usesIncrementalDiff() {
		l.tracker.SeedOwnedSnapshots(items, snapshots, func(item I) any {
			return l.itemID(target, item)
		})
	} else {
		l.diff.SeedOwned(snapshots)
	}
	return nil
}

func (l *itemLayer[T, I]) pushDiffs(target T, envID, layerID string, emitter abm.Emitter) error {
	created, updated, deleted := l.computeDiffs(target)
	if len(created) > 0 {
		if err := emitter.ItemCreate(envID, layerID, created); err != nil {
			return err
		}
	}
	if len(updated) > 0 {
		if err := emitter.ItemUpdate(envID, layerID, updated); err != nil {
			return err
		}
	}
	if len(deleted) > 0 {
		if err := emitter.ItemDelete(envID, layerID, deleted); err != nil {
			return err
		}
	}
	return nil
}

func (l *itemLayer[T, I]) Reset() {
	l.diff.Reset()
	l.tracker.Reset()
}

func (l *itemLayer[T, I]) usesIncrementalDiff() bool {
	return l.itemID != nil && l.changed != nil
}

func (l *itemLayer[T, I]) computeDiffs(target T) (created, updated []map[string]any, deleted []any) {
	items := l.itemList(target)
	if l.project == nil {
		return nil, nil, nil
	}
	if l.scanProject != nil {
		var scratch map[string]any
		if len(l.fields) > 0 {
			scratch = make(map[string]any, len(l.fields))
		}
		if l.usesIncrementalDiff() {
			return l.tracker.ComputeBorrowed(items,
				func(item I) any { return l.itemID(target, item) },
				func(item I) bool { return l.changed(target, item) },
				func(item I) abm.ItemSnapshot { return l.scanProject(target, item, scratch) })
		}
		return l.diff.ComputeBorrowed(len(items), func(index int) abm.ItemSnapshot { return l.scanProject(target, items[index], scratch) })
	}
	if l.usesIncrementalDiff() {
		return l.tracker.Compute(
			items,
			func(item I) any { return l.itemID(target, item) },
			func(item I) bool { return l.changed(target, item) },
			func(item I) abm.ItemSnapshot { return l.project(target, item) },
		)
	}
	return l.diff.Compute(l.projectItems(target, items, false))
}

func (l *itemLayer[T, I]) itemList(target T) []I {
	if l.items == nil {
		return nil
	}
	return l.items(target)
}

func (l *itemLayer[T, I]) projectItems(target T, items []I, deepCopy ...bool) []map[string]any {
	copyValues := l.copyPolicy.copiesPublication()
	if len(deepCopy) > 0 {
		copyValues = deepCopy[0]
	}
	if l.project == nil {
		return nil
	}
	snapshots := make([]map[string]any, 0, len(items))
	for _, item := range items {
		snapshots = append(snapshots, abm.SnapshotItem(l.project(target, item), copyValues))
	}
	return snapshots
}

func (l *itemLayer[T, I]) restoreCurrent(target T) []map[string]any {
	return l.projectItems(target, l.itemList(target))
}

func selectItemField[T any, I any](path string) ItemFieldFunc[T, I] {
	root, parts := compileSourcePath(path, "item", "item", "model")
	return func(model T, item I) any {
		if root == "model" {
			return readSourcePath(model, parts)
		}
		return readSourcePath(item, parts)
	}
}
