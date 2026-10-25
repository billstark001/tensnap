package binding

import (
	"slices"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

// #region Agent Layer

type AgentLayer[T any, I any] struct {
	itemLayer[T, I]
	restore  *RestoreLayer[T]
	ID       string
	metadata func(T) map[string]any
	resetIDs []any
}

func NewAgentLayer[T any, I any](id string) *AgentLayer[T, I] {
	return &AgentLayer[T, I]{
		ID:        id,
		itemLayer: newItemLayer[T, I]("id"),
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

// ProjectorOwnsValues declares whether a custom projector returns stable, detached records.
func (l *AgentLayer[T, I]) ProjectorOwnsValues(value bool) *AgentLayer[T, I] {
	l.copyPolicy.projectorOwnsValues = &value
	l.rebuildProjector()
	return l
}

// ProjectorDeepCopy controls built-in projection detachment; it defaults to true.
func (l *AgentLayer[T, I]) ProjectorDeepCopy(value bool) *AgentLayer[T, I] {
	l.copyPolicy.projectorDeepCopy = &value
	l.rebuildProjector()
	return l
}

// DeepCopy overrides publication detachment; auto copies projections without an ownership guarantee.
func (l *AgentLayer[T, I]) DeepCopy(value bool) *AgentLayer[T, I] {
	l.copyPolicy.deepCopy = &value
	l.rebuildProjector()
	return l
}

func (l *AgentLayer[T, I]) Project(fn func(T, I) map[string]any) *AgentLayer[T, I] {
	l.copyPolicy.builtin = false
	l.base = fn
	l.rebuildProjector()
	return l
}

func (l *AgentLayer[T, I]) ProjectTags(options ...TagOption) *AgentLayer[T, I] {
	l.base = ProjectTags[T, I](append(slices.Clone(options), TagDeepCopy(false))...)
	l.copyPolicy.builtin = true
	l.rebuildProjector()
	return l
}

func (l *AgentLayer[T, I]) ProjectTagsRequired(required ...string) *AgentLayer[T, I] {
	l.base = ProjectTagsRequired[T, I](required, TagScope("agent"), TagDeepCopy(false))
	l.copyPolicy.builtin = true
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
	return l.Field(name, selectItemField[T, I](path))
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
	return l.replayState(target, envID, l.ID, emitter)
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

func (l *AgentLayer[T, I]) PushDiffs(target T, envID string, emitter abm.Emitter) error {
	return l.pushDiffs(target, envID, l.ID, emitter)
}

func (l *AgentLayer[T, I]) ReplayReset(target T, envID string, emitter abm.Emitter) error {
	if len(l.resetIDs) > 0 {
		if err := emitter.ItemDelete(envID, l.ID, l.resetIDs); err != nil {
			return err
		}
	}
	l.resetIDs = nil
	return l.replayState(target, envID, l.ID, emitter)
}

func (l *AgentLayer[T, I]) data(target T) map[string]any {
	if l.metadata == nil {
		return nil
	}
	return l.metadata(target)
}

// #endregion Agent Layer

func (l *AgentLayer[T, I]) restoreDefinition() *RestoreLayer[T] { return l.restore }
