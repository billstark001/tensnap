package binding

import (
	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

type Env[T any] struct {
	ID     string
	Type   string
	layers []Layer[T]
}

type Layer[T any] interface {
	CreatePayload(T, string) *protocol.EnvLayerCreatePayload
	ReplayState(T, string, abm.Emitter) error
	PushDiffs(T, string, abm.Emitter) error
	Reset()
}

type resetLayer[T any] interface {
	ReplayReset(T, string, abm.Emitter) error
}

type resetPreparedLayer[T any] interface {
	PrepareReset(T)
	CancelReset()
}

func NewEnv[T any](id string, layers ...Layer[T]) *Env[T] {
	return &Env[T]{
		ID:     id,
		Type:   "2d",
		layers: layers,
	}
}

func (e *Env[T]) EnvType(envType string) *Env[T] {
	e.Type = envType
	return e
}

func (e *Env[T]) Scenario(target T) abm.ScenarioEnvironment {
	layers := make([]*protocol.EnvLayerCreatePayload, 0, len(e.layers))
	for _, layer := range e.layers {
		layers = append(layers, layer.CreatePayload(target, e.ID))
	}
	return abm.ScenarioEnvironment{
		ID:     e.ID,
		Type:   e.Type,
		Layers: layers,
	}
}

func (e *Env[T]) ReplayState(target T, emitter abm.Emitter) error {
	for _, layer := range e.layers {
		if err := layer.ReplayState(target, e.ID, emitter); err != nil {
			return err
		}
	}
	return nil
}

// PrepareReset captures renderer delete keys before the model mutates.
func (e *Env[T]) PrepareReset(target T) {
	for _, layer := range e.layers {
		if prepared, ok := layer.(resetPreparedLayer[T]); ok {
			prepared.PrepareReset(target)
		}
	}
}

// CancelReset drops a prepared reset plan after a model reset hook fails.
func (e *Env[T]) CancelReset() {
	for _, layer := range e.layers {
		if prepared, ok := layer.(resetPreparedLayer[T]); ok {
			prepared.CancelReset()
		}
	}
}

// ReplayReset updates stable layer metadata and replaces current agent items
// without recreating the environment/layers themselves. That keeps renderer
// trajectory on_reset policy in control of renderer-owned history.
func (e *Env[T]) ReplayReset(target T, emitter abm.Emitter) error {
	for _, layer := range e.layers {
		payload := layer.CreatePayload(target, e.ID)
		metadata := payload.Data
		if metadata == nil {
			metadata = map[string]any{}
		}
		if err := emitter.EnvLayerUpdate(&protocol.EnvLayerUpdatePayload{
			EnvID: e.ID, LayerID: payload.LayerID, Data: metadata,
		}); err != nil {
			return err
		}
		var err error
		if resetter, ok := layer.(resetLayer[T]); ok {
			err = resetter.ReplayReset(target, e.ID, emitter)
		} else {
			err = layer.PushDiffs(target, e.ID, emitter)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (e *Env[T]) PushDiffs(target T, emitter abm.Emitter) error {
	for _, layer := range e.layers {
		if err := layer.PushDiffs(target, e.ID, emitter); err != nil {
			return err
		}
	}
	return nil
}

func (e *Env[T]) Reset() {
	for _, layer := range e.layers {
		layer.Reset()
	}
}

type GridLayer[T any] struct {
	ID       string
	metadata func(T) map[string]any
}

func NewGridLayer[T any](id string) *GridLayer[T] {
	return &GridLayer[T]{ID: id}
}

func (l *GridLayer[T]) Data(fn func(T) map[string]any) *GridLayer[T] {
	l.metadata = fn
	return l
}

func (l *GridLayer[T]) Size(fn func(T) (int, int)) *GridLayer[T] {
	l.metadata = func(target T) map[string]any {
		width, height := fn(target)
		return map[string]any{"width": width, "height": height}
	}
	return l
}

func (l *GridLayer[T]) CreatePayload(target T, envID string) *protocol.EnvLayerCreatePayload {
	return &protocol.EnvLayerCreatePayload{
		EnvID:     envID,
		LayerID:   l.ID,
		LayerType: "grid",
		Data:      l.data(target),
	}
}

func (l *GridLayer[T]) ReplayState(T, string, abm.Emitter) error {
	return nil
}

func (l *GridLayer[T]) ReplayReset(T, string, abm.Emitter) error {
	return nil
}

func (l *GridLayer[T]) PushDiffs(T, string, abm.Emitter) error {
	return nil
}

func (l *GridLayer[T]) Reset() {}

func (l *GridLayer[T]) data(target T) map[string]any {
	if l.metadata == nil {
		return nil
	}
	return l.metadata(target)
}

// #endregion Grid Layer

// #region Agent Layer

type AgentLayer[T any, I any] struct {
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

func (l *AgentLayer[T, I]) rebuildProjector() {
	if len(l.fields) == 0 {
		l.project = l.base
		return
	}
	l.project = composeProjector(l.base, l.fields)
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

// #region Edge Layer

type EdgeLayer[T any, I any] struct {
	ID                 string
	metadata           func(T) map[string]any
	dependencyLayerIDs map[string]string
	items              func(T) []I
	base               func(T, I) map[string]any
	project            func(T, I) map[string]any
	fields             map[string]ItemFieldFunc[T, I]
	diff               *abm.NaiveItemDiffTracker
	tracker            *abm.ItemDiffTracker[I]
	itemID             func(T, I) any
	changed            func(T, I) bool
}

func NewEdgeLayer[T any, I any](id string) *EdgeLayer[T, I] {
	return &EdgeLayer[T, I]{
		ID:                 id,
		dependencyLayerIDs: map[string]string{"agent": "agents"},
		diff:               abm.NewNaiveItemDiffTracker("source", "target"),
		tracker:            abm.NewItemDiffTracker[I](),
	}
}

func (l *EdgeLayer[T, I]) Data(fn func(T) map[string]any) *EdgeLayer[T, I] {
	l.metadata = fn
	return l
}

func (l *EdgeLayer[T, I]) AgentLayer(layerID string) *EdgeLayer[T, I] {
	return l.DependencyLayer("agent", layerID)
}

func (l *EdgeLayer[T, I]) DependencyLayer(role, layerID string) *EdgeLayer[T, I] {
	if l.dependencyLayerIDs == nil {
		l.dependencyLayerIDs = make(map[string]string)
	}
	l.dependencyLayerIDs[role] = layerID
	return l
}

func (l *EdgeLayer[T, I]) Items(fn func(T) []I) *EdgeLayer[T, I] {
	l.items = fn
	return l
}

func (l *EdgeLayer[T, I]) ItemID(fn func(T, I) any) *EdgeLayer[T, I] {
	l.itemID = fn
	return l
}

func (l *EdgeLayer[T, I]) Changed(fn func(T, I) bool) *EdgeLayer[T, I] {
	l.changed = fn
	return l
}

func (l *EdgeLayer[T, I]) Project(fn func(T, I) map[string]any) *EdgeLayer[T, I] {
	l.base = fn
	l.rebuildProjector()
	return l
}

func (l *EdgeLayer[T, I]) ProjectTags(options ...TagOption) *EdgeLayer[T, I] {
	l.base = ProjectTags[T, I](append([]TagOption{TagScope("edge")}, options...)...)
	l.rebuildProjector()
	return l
}

func (l *EdgeLayer[T, I]) ProjectTagsRequired(required ...string) *EdgeLayer[T, I] {
	if len(required) == 0 {
		required = []string{"source", "target"}
	}
	l.base = ProjectTagsRequired[T, I](required, TagScope("edge"))
	l.rebuildProjector()
	return l
}

func (l *EdgeLayer[T, I]) Field(name string, fn ItemFieldFunc[T, I]) *EdgeLayer[T, I] {
	if l.fields == nil {
		l.fields = make(map[string]ItemFieldFunc[T, I])
	}
	l.fields[name] = fn
	l.rebuildProjector()
	return l
}

func (l *EdgeLayer[T, I]) rebuildProjector() {
	if len(l.fields) == 0 {
		l.project = l.base
		return
	}
	l.project = composeProjector(l.base, l.fields)
}

func (l *EdgeLayer[T, I]) CreatePayload(target T, envID string) *protocol.EnvLayerCreatePayload {
	return &protocol.EnvLayerCreatePayload{
		EnvID:              envID,
		LayerID:            l.ID,
		LayerType:          "edge",
		DependencyLayerIDs: cloneStringMap(l.dependencyLayerIDs),
		Data:               l.data(target),
	}
}

func (l *EdgeLayer[T, I]) ReplayState(target T, envID string, emitter abm.Emitter) error {
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

func (l *EdgeLayer[T, I]) ReplayReset(target T, envID string, emitter abm.Emitter) error {
	return l.PushDiffs(target, envID, emitter)
}

func (l *EdgeLayer[T, I]) PushDiffs(target T, envID string, emitter abm.Emitter) error {
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

func (l *EdgeLayer[T, I]) Reset() {
	l.diff.Reset()
	l.tracker.Reset()
}

func (l *EdgeLayer[T, I]) data(target T) map[string]any {
	if l.metadata == nil {
		return nil
	}
	return l.metadata(target)
}

func (l *EdgeLayer[T, I]) usesIncrementalDiff() bool {
	return l.itemID != nil && l.changed != nil
}

func (l *EdgeLayer[T, I]) computeDiffs(target T) (created, updated []map[string]any, deleted []any) {
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

func (l *EdgeLayer[T, I]) itemList(target T) []I {
	if l.items == nil {
		return nil
	}
	return l.items(target)
}

func (l *EdgeLayer[T, I]) projectItems(target T, items []I) []map[string]any {
	if l.project == nil {
		return nil
	}
	snapshots := make([]map[string]any, 0, len(items))
	for _, item := range items {
		snapshots = append(snapshots, l.project(target, item))
	}
	return snapshots
}

// #endregion Edge Layer

// #region Trajectory Layer

type TrajectoryLayer[T any, I any] struct {
	ID                 string
	metadata           func(T) map[string]any
	metadataFields     map[string]any
	dependencyLayerIDs map[string]string
	items              func(T) []I
	base               func(T, I) map[string]any
	project            func(T, I) map[string]any
	fields             map[string]ItemFieldFunc[T, I]
	diff               *abm.NaiveItemDiffTracker
	tracker            *abm.ItemDiffTracker[I]
	itemID             func(T, I) any
	changed            func(T, I) bool
}

func NewTrajectoryLayer[T any, I any](id string) *TrajectoryLayer[T, I] {
	return &TrajectoryLayer[T, I]{
		ID:                 id,
		dependencyLayerIDs: map[string]string{"agent": "agents"},
		diff:               abm.NewNaiveItemDiffTracker("id"),
		tracker:            abm.NewItemDiffTracker[I](),
	}
}

func NewEmptyTrajectoryLayer[T any](id string) *TrajectoryLayer[T, any] {
	return NewTrajectoryLayer[T, any](id)
}

func (l *TrajectoryLayer[T, I]) Data(fn func(T) map[string]any) *TrajectoryLayer[T, I] {
	l.metadata = fn
	return l
}

func (l *TrajectoryLayer[T, I]) metadataField(name string, value any) *TrajectoryLayer[T, I] {
	if l.metadataFields == nil {
		l.metadataFields = make(map[string]any)
	}
	l.metadataFields[name] = value
	return l
}

func (l *TrajectoryLayer[T, I]) Length(value float64) *TrajectoryLayer[T, I] {
	return l.metadataField("length", value)
}

func (l *TrajectoryLayer[T, I]) Width(value float64) *TrajectoryLayer[T, I] {
	return l.metadataField("width", value)
}

func (l *TrajectoryLayer[T, I]) Color(value string) *TrajectoryLayer[T, I] {
	return l.metadataField("color", value)
}

func (l *TrajectoryLayer[T, I]) ZIndex(value float64) *TrajectoryLayer[T, I] {
	return l.metadataField("z_index", value)
}

func (l *TrajectoryLayer[T, I]) OnAgentDelete(value protocol.TrajectoryAgentDeletePolicy) *TrajectoryLayer[T, I] {
	return l.metadataField("on_agent_delete", value)
}

func (l *TrajectoryLayer[T, I]) OnStateSync(value protocol.TrajectoryStateSyncPolicy) *TrajectoryLayer[T, I] {
	return l.metadataField("on_state_sync", value)
}

func (l *TrajectoryLayer[T, I]) OnReset(value protocol.TrajectoryResetPolicy) *TrajectoryLayer[T, I] {
	return l.metadataField("on_reset", value)
}

func (l *TrajectoryLayer[T, I]) AgentLayer(layerID string) *TrajectoryLayer[T, I] {
	return l.DependencyLayer("agent", layerID)
}

func (l *TrajectoryLayer[T, I]) DependencyLayer(role, layerID string) *TrajectoryLayer[T, I] {
	if l.dependencyLayerIDs == nil {
		l.dependencyLayerIDs = make(map[string]string)
	}
	l.dependencyLayerIDs[role] = layerID
	return l
}

func (l *TrajectoryLayer[T, I]) Items(fn func(T) []I) *TrajectoryLayer[T, I] {
	l.items = fn
	return l
}

func (l *TrajectoryLayer[T, I]) ItemID(fn func(T, I) any) *TrajectoryLayer[T, I] {
	l.itemID = fn
	return l
}

func (l *TrajectoryLayer[T, I]) Changed(fn func(T, I) bool) *TrajectoryLayer[T, I] {
	l.changed = fn
	return l
}

func (l *TrajectoryLayer[T, I]) Project(fn func(T, I) map[string]any) *TrajectoryLayer[T, I] {
	l.base = fn
	l.rebuildProjector()
	return l
}

func (l *TrajectoryLayer[T, I]) ProjectTags(options ...TagOption) *TrajectoryLayer[T, I] {
	l.base = ProjectTags[T, I](append([]TagOption{TagScope("trajectory")}, options...)...)
	l.rebuildProjector()
	return l
}

func (l *TrajectoryLayer[T, I]) ProjectTagsRequired(required ...string) *TrajectoryLayer[T, I] {
	if len(required) == 0 {
		required = []string{"id"}
	}
	l.base = ProjectTagsRequired[T, I](required, TagScope("trajectory"))
	l.rebuildProjector()
	return l
}

func (l *TrajectoryLayer[T, I]) Field(name string, fn ItemFieldFunc[T, I]) *TrajectoryLayer[T, I] {
	if l.fields == nil {
		l.fields = make(map[string]ItemFieldFunc[T, I])
	}
	l.fields[name] = fn
	l.rebuildProjector()
	return l
}

func (l *TrajectoryLayer[T, I]) rebuildProjector() {
	if len(l.fields) == 0 {
		l.project = l.base
		return
	}
	l.project = composeProjector(l.base, l.fields)
}

func (l *TrajectoryLayer[T, I]) CreatePayload(target T, envID string) *protocol.EnvLayerCreatePayload {
	return &protocol.EnvLayerCreatePayload{
		EnvID:              envID,
		LayerID:            l.ID,
		LayerType:          "trajectory",
		DependencyLayerIDs: cloneStringMap(l.dependencyLayerIDs),
		Data:               l.data(target),
	}
}

func (l *TrajectoryLayer[T, I]) ReplayState(target T, envID string, emitter abm.Emitter) error {
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

func (l *TrajectoryLayer[T, I]) ReplayReset(target T, envID string, emitter abm.Emitter) error {
	return l.PushDiffs(target, envID, emitter)
}

func (l *TrajectoryLayer[T, I]) PushDiffs(target T, envID string, emitter abm.Emitter) error {
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

func (l *TrajectoryLayer[T, I]) Reset() {
	l.diff.Reset()
	l.tracker.Reset()
}

func (l *TrajectoryLayer[T, I]) data(target T) map[string]any {
	if l.metadata == nil && len(l.metadataFields) == 0 {
		return nil
	}
	result := make(map[string]any, len(l.metadataFields)+4)
	if l.metadata != nil {
		for key, value := range l.metadata(target) {
			result[key] = value
		}
	}
	for key, value := range l.metadataFields {
		result[key] = value
	}
	return result
}

func (l *TrajectoryLayer[T, I]) usesIncrementalDiff() bool {
	return l.itemID != nil && l.changed != nil
}

func (l *TrajectoryLayer[T, I]) computeDiffs(target T) (created, updated []map[string]any, deleted []any) {
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

func (l *TrajectoryLayer[T, I]) itemList(target T) []I {
	if l.items == nil {
		return nil
	}
	return l.items(target)
}

func (l *TrajectoryLayer[T, I]) projectItems(target T, items []I) []map[string]any {
	if l.project == nil {
		return nil
	}
	snapshots := make([]map[string]any, 0, len(items))
	for _, item := range items {
		snapshots = append(snapshots, l.project(target, item))
	}
	return snapshots
}

// #endregion Trajectory Layer

// #region Background Layer

type BackgroundLayer[T any] struct {
	ID       string
	metadata func(T) map[string]any
}

func NewBackgroundLayer[T any](id string) *BackgroundLayer[T] {
	return &BackgroundLayer[T]{ID: id}
}

func (l *BackgroundLayer[T]) Data(fn func(T) map[string]any) *BackgroundLayer[T] {
	l.metadata = fn
	return l
}

func (l *BackgroundLayer[T]) CreatePayload(target T, envID string) *protocol.EnvLayerCreatePayload {
	return &protocol.EnvLayerCreatePayload{
		EnvID:     envID,
		LayerID:   l.ID,
		LayerType: "background",
		Data:      l.data(target),
	}
}

func (l *BackgroundLayer[T]) ReplayState(T, string, abm.Emitter) error {
	return nil
}

func (l *BackgroundLayer[T]) ReplayReset(T, string, abm.Emitter) error {
	return nil
}

func (l *BackgroundLayer[T]) PushDiffs(T, string, abm.Emitter) error {
	return nil
}

func (l *BackgroundLayer[T]) Reset() {}

func (l *BackgroundLayer[T]) data(target T) map[string]any {
	if l.metadata == nil {
		return nil
	}
	return l.metadata(target)
}

// #endregion Background Layer
