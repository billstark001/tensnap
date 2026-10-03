package binding

import (
	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

// #region Agent Layer

type AgentLayer[T any, I any] struct {
	restore  *RestoreLayer[T]
	ID       string
	metadata func(T) map[string]any
	items    func(T) []I
	base     func(T, I) map[string]any
	project  func(T, I) map[string]any
	fields   map[string]ItemFieldFunc[T, I]
	diff     *abm.NaiveItemDiffTracker
	tracker  *abm.ItemDiffTracker[I]
	itemID   func(T, I) any
	changed  func(T, I) bool
	resetIDs []any
}

func NewAgentLayer[T any, I any](id string) *AgentLayer[T, I] {
	return &AgentLayer[T, I]{
		ID:      id,
		diff:    abm.NewNaiveItemDiffTracker("id"),
		tracker: abm.NewItemDiffTracker[I](),
	}
}

func (l *AgentLayer[T, I]) Data(fn func(T) map[string]any) *AgentLayer[T, I] {
	l.metadata = fn
	return l
}

func (l *AgentLayer[T, I]) Size(fn func(T) (int, int)) *AgentLayer[T, I] {
	l.metadata = func(target T) map[string]any {
		width, height := fn(target)
		return map[string]any{"width": width, "height": height}
	}
	return l
}

func (l *AgentLayer[T, I]) Items(fn func(T) []I) *AgentLayer[T, I] {
	l.items = fn
	return l
}

func (l *AgentLayer[T, I]) ItemID(fn func(T, I) any) *AgentLayer[T, I] {
	l.itemID = fn
	return l
}

func (l *AgentLayer[T, I]) Changed(fn func(T, I) bool) *AgentLayer[T, I] {
	l.changed = fn
	return l
}

func (l *AgentLayer[T, I]) Project(fn func(T, I) map[string]any) *AgentLayer[T, I] {
	l.base = fn
	l.rebuildProjector()
	return l
}

func (l *AgentLayer[T, I]) ProjectTags(options ...TagOption) *AgentLayer[T, I] {
	l.base = ProjectTags[T, I](options...)
	l.rebuildProjector()
	return l
}

func (l *AgentLayer[T, I]) ProjectTagsRequired(required ...string) *AgentLayer[T, I] {
	l.base = ProjectTagsRequired[T, I](required, TagScope("agent"))
	l.rebuildProjector()
	return l
}

func (l *AgentLayer[T, I]) Field(name string, fn ItemFieldFunc[T, I]) *AgentLayer[T, I] {
	if l.fields == nil {
		l.fields = make(map[string]ItemFieldFunc[T, I])
	}
	l.fields[name] = fn
	l.rebuildProjector()
	return l
}

func (l *AgentLayer[T, I]) Const(name string, value any) *AgentLayer[T, I] {
	return l.Field(name, Const[T, I](value))
}

// Select reads an item field by default; model.* selects model state.
func (l *AgentLayer[T, I]) Select(name, path string) *AgentLayer[T, I] {
	root, parts := compileSourcePath(path, "item", "item", "model")
	return l.Field(name, func(model T, item I) any {
		if root == "model" {
			return readSourcePath(model, parts)
		}
		return readSourcePath(item, parts)
	})
}

func (l *AgentLayer[T, I]) rebuildProjector() {
	if len(l.fields) == 0 {
		l.project = l.base
		return
	}
	l.project = composeProjector(l.base, l.fields)
}

func (l *AgentLayer[T, I]) Restore(spec RestoreLayer[T]) *AgentLayer[T, I] {
	l.restore = &spec
	return l
}

func (l *AgentLayer[T, I]) CreatePayload(target T, envID string) *protocol.EnvLayerCreatePayload {
	return &protocol.EnvLayerCreatePayload{
		EnvID:     envID,
		LayerID:   l.ID,
		LayerType: "agent",
		Data:      l.data(target),
	}
}

func (l *AgentLayer[T, I]) ReplayState(target T, envID string, emitter abm.Emitter) error {
	items := l.itemList(target)
	snapshots := l.projectItems(target, items)
	if len(snapshots) > 0 {
		if err := emitter.ItemCreate(envID, l.ID, snapshots); err != nil {
			return err
		}
	}
	if l.usesIncrementalDiff() {
		l.tracker.SeedSnapshots(items, snapshots, func(item I) any {
			return l.itemID(target, item)
		})
	} else {
		l.diff.Seed(snapshots)
	}
	return nil
}

func (l *AgentLayer[T, I]) PrepareReset(target T) {
	items := l.itemList(target)
	ids := make([]any, 0, len(items))
	if l.itemID != nil {
		for _, item := range items {
			ids = append(ids, l.itemID(target, item))
		}
	} else {
		for _, snapshot := range l.projectItems(target, items) {
			if id, ok := snapshot["id"]; ok {
				ids = append(ids, id)
			}
		}
	}
	l.resetIDs = ids
}

func (l *AgentLayer[T, I]) CancelReset() {
	l.resetIDs = nil
}

func (l *AgentLayer[T, I]) ReplayReset(target T, envID string, emitter abm.Emitter) error {
	if len(l.resetIDs) > 0 {
		if err := emitter.ItemDelete(envID, l.ID, l.resetIDs); err != nil {
			return err
		}
	}
	l.resetIDs = nil
	items := l.itemList(target)
	snapshots := l.projectItems(target, items)
	if len(snapshots) > 0 {
		if err := emitter.ItemCreate(envID, l.ID, snapshots); err != nil {
			return err
		}
	}
	if l.usesIncrementalDiff() {
		l.tracker.SeedSnapshots(items, snapshots, func(item I) any {
			return l.itemID(target, item)
		})
	} else {
		l.diff.Seed(snapshots)
	}
	return nil
}

func (l *AgentLayer[T, I]) PushDiffs(target T, envID string, emitter abm.Emitter) error {
	created, updated, deleted := l.computeDiffs(target)
	if len(created) > 0 {
		if err := emitter.ItemCreate(envID, l.ID, created); err != nil {
			return err
		}
	}
	if len(updated) > 0 {
		if err := emitter.ItemUpdate(envID, l.ID, updated); err != nil {
			return err
		}
	}
	if len(deleted) > 0 {
		if err := emitter.ItemDelete(envID, l.ID, deleted); err != nil {
			return err
		}
	}
	return nil
}

func (l *AgentLayer[T, I]) Reset() {
	l.diff.Reset()
	l.tracker.Reset()
}

func (l *AgentLayer[T, I]) data(target T) map[string]any {
	if l.metadata == nil {
		return nil
	}
	return l.metadata(target)
}

func (l *AgentLayer[T, I]) usesIncrementalDiff() bool {
	return l.itemID != nil && l.changed != nil
}

func (l *AgentLayer[T, I]) computeDiffs(target T) (created, updated []map[string]any, deleted []any) {
	items := l.itemList(target)
	if l.project == nil {
		return nil, nil, nil
	}
	if l.usesIncrementalDiff() {
		return l.tracker.Compute(
			items,
			func(item I) any { return l.itemID(target, item) },
			func(item I) bool { return l.changed(target, item) },
			func(item I) abm.ItemSnapshot { return l.project(target, item) },
		)
	}
	return l.diff.Compute(l.projectItems(target, items))
}

func (l *AgentLayer[T, I]) itemList(target T) []I {
	if l.items == nil {
		return nil
	}
	return l.items(target)
}

func (l *AgentLayer[T, I]) projectItems(target T, items []I) []map[string]any {
	if l.project == nil {
		return nil
	}
	snapshots := make([]map[string]any, 0, len(items))
	for _, item := range items {
		snapshots = append(snapshots, l.project(target, item))
	}
	return snapshots
}

// #endregion Agent Layer

func (l *AgentLayer[T, I]) restoreDefinition() *RestoreLayer[T] { return l.restore }
func (l *AgentLayer[T, I]) restoreCurrent(target T) []map[string]any {
	return l.projectItems(target, l.itemList(target))
}
