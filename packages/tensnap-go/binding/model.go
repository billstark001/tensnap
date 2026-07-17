package binding

import (
	"sort"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

const (
	ActionIDStart = "start"
	ActionIDReset = "reset"
)

// Model is a composable declarative adapter around an arbitrary Go model.
//
// Each registry is optional. Callers can use the whole adapter as an abm.Model,
// or keep using their own imperative model and call the registry helpers
// directly.
type Model[T any] struct {
	abm.Base
	abm.TickCounter

	target T

	initFn  ActionInvoker[T]
	stepFn  ContinuousActionInvoker[T]
	resetFn ActionInvoker[T]

	params       []*Param[T]
	envs         []*Env[T]
	charts       []*Chart[T]
	monitors     []*Monitor[T]
	actionRouter *BindingActionRouter[T]

	sceneRestore      func(T, *protocol.SceneRestorePayload) error
	checkpointCapture func(T) (any, error)
	checkpointRestore func(T, any) error
	restoreResults    map[string]*protocol.SceneRestoreEndPayload

	initialized bool
}

type ModelOption[T any] func(*Model[T])

func NewModel[T any](target T, opts ...ModelOption[T]) *Model[T] {
	model := &Model[T]{
		target: target,
		// Timing fields are optional protocol diagnostics. Keeping them off in
		// the default continuous action path avoids clock calls and allocations
		// for every simulation tick.
		actionRouter:   NewBindingActionRouter(target, false),
		restoreResults: make(map[string]*protocol.SceneRestoreEndPayload),
	}
	model.actionRouter.Set(NewEmissiveAction(
		ActionIDReset, "Reset", func(t T, e abm.Emitter) (bool, error) {
			return false, defaultResetInvoker(model, t, e)
		},
	))
	model.actionRouter.Set(NewEmissiveAction(
		protocol.ActionIDInit, "Init", func(t T, e abm.Emitter) (bool, error) {
			return false, defaultResetInvoker(model, t, e)
		},
	))
	start := NewEmissiveAction(
		ActionIDStart, "Start", func(t T, e abm.Emitter) (bool, error) {
			return defaultStepInvoker(model, t, e)
		},
	)
	start.Continuous = abm.BoolPtr(true)
	model.actionRouter.Set(start)
	model.actionRouter.Set(NewEmissiveAction(
		protocol.ActionIDStep, "Step", func(t T, e abm.Emitter) (bool, error) {
			_, err := defaultStepInvoker(model, t, e)
			return false, err
		},
	))
	model.Base.SetActionRouter(model.actionRouter)
	for _, opt := range opts {
		opt(model)
	}
	model.refreshCapabilities()
	model.refreshScenario()
	return model
}

func WithInit[T any](fn ActionInvoker[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.initFn = fn
	}
}

func WithStep[T any](fn ContinuousActionInvoker[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.stepFn = fn
	}
}

func WithReset[T any](fn ActionInvoker[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.resetFn = fn
	}
}

func WithActions[T any](actions ...*Action[T]) ModelOption[T] {
	return func(model *Model[T]) {
		for _, action := range actions {
			model.actionRouter.Set(action)
		}
	}
}

func WithParams[T any](params ...*Param[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.params = append(model.params, params...)
	}
}

func WithEnvs[T any](envs ...*Env[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.envs = append(model.envs, envs...)
	}
}

func WithCharts[T any](charts ...*Chart[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.charts = append(model.charts, charts...)
	}
}

// WithMonitors declares current-value monitor getters before the handshake.
func WithMonitors[T any](monitors ...*Monitor[T]) ModelOption[T] {
	return func(model *Model[T]) { model.monitors = append(model.monitors, monitors...) }
}

// WithSceneRestore registers an explicit projected-state inverse. The binding
// will advertise scene.restore.projected, but never attempts generic restore.
func WithSceneRestore[T any](restore func(T, *protocol.SceneRestorePayload) error) ModelOption[T] {
	return func(model *Model[T]) { model.sceneRestore = restore }
}

// WithCheckpointCapture returns model data. The binding infers and owns the
// v0.3 checkpoint encoding envelope.
func WithCheckpointCapture[T any](capture func(T) (any, error)) ModelOption[T] {
	return func(model *Model[T]) { model.checkpointCapture = capture }
}

// WithCheckpointRestore receives decoded model data. It is paired with
// WithCheckpointCapture to advertise scene.restore.checkpoint.
func WithCheckpointRestore[T any](restore func(T, any) error) ModelOption[T] {
	return func(model *Model[T]) { model.checkpointRestore = restore }
}

// WithSimulatorInfo supplies the stable identity announced before any state
// replay. The binding fills protocol/binding defaults when callers omit them.
func WithSimulatorInfo[T any](info protocol.SimulatorInfoPayload) ModelOption[T] {
	return func(model *Model[T]) { model.Base.SetSimulatorInfo(info) }
}

// func WithAction[]

func (m *Model[T]) Setup(e abm.Emitter) error {
	if m.initialized {
		if err := m.deleteOwned(e); err != nil {
			return err
		}
	}
	if err := m.initialize(); err != nil {
		return err
	}
	m.refreshScenario()
	return m.ReplayScenario(e)
}

func (m *Model[T]) Step(e abm.Emitter) error {
	continuous := false
	return m.actionRouter.fire(e, &protocol.ActionInvokePayload{ID: protocol.ActionIDStep, RequestID: "internal-step", Continuous: &continuous})
}

func (m *Model[T]) OnStateSync(e abm.Emitter, payload *protocol.StateSyncPayload) error {
	if !m.initialized {
		if err := m.initialize(); err != nil {
			return err
		}
		m.refreshScenario()
	}
	return m.Base.OnStateSync(e, payload)
}

func (m *Model[T]) OnParamChange(e abm.Emitter, id string, value any) error {
	m.refreshScenario()
	return m.Base.OnParamChange(e, id, value)
}

func (m *Model[T]) OnAction(e abm.Emitter, payload *protocol.ActionInvokePayload) error {
	return m.Base.OnAction(e, payload)
}

func (m *Model[T]) PushEnvDiffs(e abm.Emitter) error {
	for _, env := range m.envs {
		if err := env.PushDiffs(m.target, e); err != nil {
			return err
		}
	}
	return nil
}

func (m *Model[T]) PushCharts(e abm.Emitter, tick float64) error {
	if len(m.charts) == 0 {
		return nil
	}
	updates := make([]protocol.ChartUpdateEntry, 0, len(m.charts))
	for _, chart := range m.charts {
		chartUpdates, err := chart.Updates(m.target, tick)
		if err != nil {
			return err
		}
		updates = append(updates, chartUpdates...)
	}
	return e.ChartUpdate(&protocol.ChartUpdatePayload{Updates: updates})
}

func (m *Model[T]) PushMonitors(e abm.Emitter) error {
	for _, monitor := range m.monitors {
		value, err := monitor.Value(m.target)
		if err != nil {
			return err
		}
		if err := e.MonitorUpdate(&protocol.MonitorUpdatePayload{ID: monitor.ID, Value: value}); err != nil {
			return err
		}
	}
	return nil
}

// OnSceneRestore reports a structured rejection unless an explicit inverse
// hook was configured.
func (m *Model[T]) OnSceneRestore(e abm.Emitter, payload *protocol.SceneRestorePayload) error {
	if payload == nil {
		return nil
	}
	if cached := m.restoreResults[payload.RequestID]; cached != nil {
		if err := e.SceneRestoreBegin(&protocol.SceneRestoreBeginPayload{RequestID: payload.RequestID}); err != nil {
			return err
		}
		copy := *cached
		return e.SceneRestoreEnd(&copy)
	}
	begun := false
	begin := func() error {
		if begun {
			return nil
		}
		if err := e.SceneRestoreBegin(&protocol.SceneRestoreBeginPayload{RequestID: payload.RequestID}); err != nil {
			return err
		}
		begun = true
		return nil
	}
	end := func(status string, executionError *protocol.ActionExecutionError) error {
		if err := begin(); err != nil {
			return err
		}
		result := &protocol.SceneRestoreEndPayload{RequestID: payload.RequestID, Status: status, Error: executionError}
		m.restoreResults[payload.RequestID] = result
		return e.SceneRestoreEnd(result)
	}
	hasProjectedState := payload.Time != nil || payload.Parameters != nil || payload.Envs != nil
	info := m.SimulatorInfo()
	if payload.ModelID != info.Model.ID {
		return end("rejected", &protocol.ActionExecutionError{Code: "model_mismatch", Message: "scene_restore model_id does not match this simulator."})
	}
	if payload.ExpectedInstanceID != nil && *payload.ExpectedInstanceID != info.InstanceID {
		return end("rejected", &protocol.ActionExecutionError{Code: "instance_mismatch", Message: "scene_restore expected_instance_id is stale."})
	}
	if info.Model.StateSchemaVersion != nil && payload.StateSchemaVersion != nil && *payload.StateSchemaVersion != *info.Model.StateSchemaVersion {
		return end("rejected", &protocol.ActionExecutionError{Code: "state_schema_mismatch", Message: "scene_restore state schema is incompatible."})
	}
	if m.sceneRestore == nil && hasProjectedState {
		return end("rejected", &protocol.ActionExecutionError{Code: "unsupported_capability", Message: "Projected scene restore is not configured."})
	}
	if payload.Checkpoint != nil && (m.checkpointCapture == nil || m.checkpointRestore == nil) {
		return end("rejected", &protocol.ActionExecutionError{Code: "unsupported_capability", Message: "Checkpoint restore is not configured."})
	}
	if payload.Checkpoint == nil && !hasProjectedState {
		return end("rejected", &protocol.ActionExecutionError{Code: "invalid_restore", Message: "scene_restore contains no restorable state."})
	}

	previousActions := m.actionRouter.BuildState()
	previousParams := append([]*Param[T](nil), m.params...)
	previousEnvs := append([]*Env[T](nil), m.envs...)
	previousMonitors := append([]*Monitor[T](nil), m.monitors...)
	previousTick := m.Tick()
	var rollback any
	hasRollback := m.checkpointCapture != nil && m.checkpointRestore != nil
	if hasRollback {
		var err error
		rollback, err = m.checkpointCapture(m.target)
		if err != nil {
			return end("failed", &protocol.ActionExecutionError{Code: "restore_failed", Message: "capture rollback checkpoint: " + err.Error()})
		}
	}
	if err := begin(); err != nil {
		return err
	}
	fail := func(err error) error {
		message := err.Error()
		m.SetTick(previousTick)
		if hasRollback {
			if rollbackErr := m.checkpointRestore(m.target, rollback); rollbackErr != nil {
				message += "; rollback failed: " + rollbackErr.Error()
			}
		}
		return end("failed", &protocol.ActionExecutionError{Code: "restore_failed", Message: message})
	}
	if payload.Checkpoint != nil {
		checkpointData, err := decodeCheckpoint(payload.Checkpoint)
		if err != nil {
			return fail(err)
		}
		if err := m.checkpointRestore(m.target, checkpointData); err != nil {
			return fail(err)
		}
	}
	projected := *payload
	projected.Checkpoint = nil
	if hasProjectedState {
		if err := m.sceneRestore(m.target, &projected); err != nil {
			return fail(err)
		}
	}
	if payload.Time != nil {
		m.SetTick(int64(*payload.Time))
	}
	m.refreshScenario()
	if err := deleteRestoreDefinitions(e, previousActions, previousParams, previousEnvs, previousMonitors); err != nil {
		return fail(err)
	}
	if err := m.ReplayScenarioForRestore(e); err != nil {
		return fail(err)
	}
	return end("ok", nil)
}

func (m *Model[T]) OnSceneCapture(e abm.Emitter, payload *protocol.SceneCapturePayload) error {
	if payload == nil {
		return nil
	}
	if m.checkpointCapture == nil || m.checkpointRestore == nil {
		return e.Error(&protocol.ErrorPayload{Code: "unsupported_capability", Message: "Checkpoint capture is not configured.", RequestID: &payload.RequestID})
	}
	data, err := m.checkpointCapture(m.target)
	if err != nil {
		return e.Error(&protocol.ErrorPayload{Code: "capture_failed", Message: err.Error(), RequestID: &payload.RequestID})
	}
	checkpoint, err := encodeCheckpoint(data)
	if err != nil {
		return e.Error(&protocol.ErrorPayload{Code: "capture_failed", Message: err.Error(), RequestID: &payload.RequestID})
	}
	info := m.SimulatorInfo()
	result := &protocol.SceneCaptureResultPayload{RequestID: payload.RequestID, ModelID: info.Model.ID, Checkpoint: checkpoint}
	if info.Model.StateSchemaVersion != nil {
		result.StateSchemaVersion = info.Model.StateSchemaVersion
	}
	return e.SceneCaptureResult(result)
}

func (m *Model[T]) initialize() error {
	m.ResetTick()
	for _, env := range m.envs {
		env.Reset()
	}
	if m.initFn != nil {
		if err := m.initFn(m.target); err != nil {
			return err
		}
	}
	m.initialized = true
	return nil
}

// #region Actions 2

func defaultResetInvoker[T any](m *Model[T], target T, e abm.Emitter) error {
	if !m.initialized {
		return m.Setup(e)
	}
	for _, env := range m.envs {
		env.PrepareReset(target)
	}
	m.ResetTick()
	if m.resetFn != nil {
		if err := m.resetFn(target); err != nil {
			for _, env := range m.envs {
				env.CancelReset()
			}
			return err
		}
	} else if m.initFn != nil {
		if err := m.initFn(target); err != nil {
			for _, env := range m.envs {
				env.CancelReset()
			}
			return err
		}
	}
	m.initialized = true
	m.refreshScenario()
	return m.replayResetState(e)
}

func defaultStepInvoker[T any](m *Model[T], target T, e abm.Emitter) (bool, error) {
	if !m.initialized {
		if err := m.Setup(e); err != nil {
			return false, err
		}
	}
	cont := false
	if m.stepFn != nil {
		next, err := m.stepFn(target)
		if err != nil {
			return cont, err
		}
		cont = next
	}
	if err := m.PushEnvDiffs(e); err != nil {
		return cont, err
	}
	tick := float64(m.NextTick())
	if err := m.PushCharts(e, tick); err != nil {
		return cont, err
	}
	if err := m.PushMonitors(e); err != nil {
		return cont, err
	}
	if err := e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &tick}); err != nil {
		return cont, err
	}
	return cont, nil
}

// #endregion

func (m *Model[T]) replayState(e abm.Emitter) error {
	for _, env := range m.envs {
		if err := env.ReplayState(m.target, e); err != nil {
			return err
		}
	}
	tick := float64(m.Tick())
	if err := m.PushCharts(e, tick); err != nil {
		return err
	}
	if err := m.PushMonitors(e); err != nil {
		return err
	}
	return e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &tick})
}

func (m *Model[T]) replayRestoreState(e abm.Emitter) error {
	for _, env := range m.envs {
		if err := env.ReplayState(m.target, e); err != nil {
			return err
		}
	}
	if err := m.PushMonitors(e); err != nil {
		return err
	}
	tick := float64(m.Tick())
	return e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &tick})
}

func (m *Model[T]) replayResetState(e abm.Emitter) error {
	for _, action := range m.actionRouter.BuildState() {
		if err := e.ActionUpdate(action); err != nil {
			return err
		}
	}
	for _, param := range m.params {
		if err := e.ParamUpdate(param.Metadata(m.target).Definition); err != nil {
			return err
		}
	}
	for _, env := range m.envs {
		if err := env.ReplayReset(m.target, e); err != nil {
			return err
		}
	}
	if len(m.charts) > 0 {
		operations := make([]protocol.ChartOperation, 0, len(m.charts))
		for _, chart := range m.charts {
			operations = append(operations, protocol.ChartOperation{ID: chart.ID, Kind: "group", Operation: "clear"})
		}
		if err := e.ChartUpdate(&protocol.ChartUpdatePayload{Operations: operations}); err != nil {
			return err
		}
	}
	tick := float64(m.Tick())
	if err := m.PushCharts(e, tick); err != nil {
		return err
	}
	if err := m.PushMonitors(e); err != nil {
		return err
	}
	return e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &tick})
}

func (m *Model[T]) refreshScenario() {
	scenario := abm.NewScenario().
		WithActions(m.actionRouter.BuildState()...).
		WithStateReplay(m.replayState).
		WithRestoreStateReplay(m.replayRestoreState)

	for _, param := range m.params {
		scenario.WithParams(param.Metadata(m.target))
	}
	for _, env := range m.envs {
		scenario.WithEnvs(env.Scenario(m.target))
	}
	for _, chart := range m.charts {
		scenario.WithCharts(chart.Metadata())
	}
	for _, monitor := range m.monitors {
		scenario.WithMonitors(monitor.Metadata())
	}
	if err := m.SetScenario(scenario); err != nil {
		panic(err)
	}
}

func (m *Model[T]) refreshCapabilities() {
	info := m.Base.SimulatorInfo()
	capabilities := make(map[string]struct{}, len(info.Capabilities)+5)
	for _, capability := range info.Capabilities {
		capabilities[capability] = struct{}{}
	}
	for _, action := range m.actionRouter.actions {
		if action.Scope != nil && *action.Scope != "model" {
			capabilities["action.target"] = struct{}{}
		}
		if len(action.Kwargs) > 0 {
			capabilities["action.kwargs"] = struct{}{}
		}
	}
	if len(m.monitors) > 0 {
		capabilities["monitor"] = struct{}{}
	}
	if m.sceneRestore != nil {
		capabilities["scene.restore.projected"] = struct{}{}
	}
	if m.checkpointCapture != nil && m.checkpointRestore != nil {
		capabilities["scene.restore.checkpoint"] = struct{}{}
	}
	info.Capabilities = make([]string, 0, len(capabilities))
	for capability := range capabilities {
		info.Capabilities = append(info.Capabilities, capability)
	}
	sort.Strings(info.Capabilities)
	m.Base.SetSimulatorInfo(*info)
}

func deleteRestoreDefinitions[T any](e abm.Emitter, actions []*protocol.Action, params []*Param[T], envs []*Env[T], monitors []*Monitor[T]) error {
	for _, monitor := range monitors {
		if err := e.MonitorDelete(monitor.ID); err != nil {
			return err
		}
	}
	for _, action := range actions {
		if err := e.ActionDelete(action.ID); err != nil {
			return err
		}
	}
	for _, param := range params {
		if err := e.ParamDelete(param.ID); err != nil {
			return err
		}
	}
	for _, env := range envs {
		if err := e.EnvDelete(env.ID); err != nil {
			return err
		}
	}
	return nil
}

func (m *Model[T]) deleteOwned(e abm.Emitter) error {
	for _, monitor := range m.monitors {
		if err := e.MonitorDelete(monitor.ID); err != nil {
			return err
		}
	}
	for _, action := range m.actionRouter.BuildState() {
		if err := e.ActionDelete(action.ID); err != nil {
			return err
		}
	}
	for _, param := range m.params {
		if err := e.ParamDelete(param.ID); err != nil {
			return err
		}
	}
	for _, chart := range m.charts {
		if err := e.ChartDelete("group", chart.ID); err != nil {
			return err
		}
	}
	for _, env := range m.envs {
		if err := e.EnvDelete(env.ID); err != nil {
			return err
		}
	}
	return nil
}
