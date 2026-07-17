// Package protocol defines the canonical TenSnap v0.3 wire types and constants.
// No external dependencies. Safe to import anywhere.
package protocol

// #region Envelope

type Message struct {
	Type      string `json:"type"`
	Payload   any    `json:"payload"`
	Timestamp *int64 `json:"timestamp,omitempty"`
}

func NewMessage(msgType string, payload any) *Message {
	return &Message{Type: msgType, Payload: payload}
}

// #endregion

// #region Simulator → Renderer message types

const (
	TypeSimulatorInfo  = "simulator_info"
	TypeMetadataUpdate = "metadata_update"
	TypeStateSyncBegin = "state_sync_begin"
	TypeStateSyncEnd   = "state_sync_end"
	TypeActionResult   = "action_result"
	// TypeActionEnd is source-compatible only; canonical v0.3 emits action_result.
	TypeActionEnd          = TypeActionResult
	TypeActionCreate       = "action_create"
	TypeActionUpdate       = "action_update"
	TypeActionDelete       = "action_delete"
	TypeEnvCreate          = "env_create"
	TypeEnvDelete          = "env_delete"
	TypeEnvLayerCreate     = "env_layer_create"
	TypeEnvLayerUpdate     = "env_layer_update"
	TypeEnvLayerDelete     = "env_layer_delete"
	TypeItemCreate         = "item_create"
	TypeItemUpdate         = "item_update"
	TypeItemDelete         = "item_delete"
	TypeParamCreate        = "param_create"
	TypeParamUpdate        = "param_update"
	TypeParamDelete        = "param_delete"
	TypeParamSync          = "param_sync"
	TypeChartCreate        = "chart_create"
	TypeChartUpdate        = "chart_update"
	TypeChartDelete        = "chart_delete"
	TypeAssetMetadata      = "asset_metadata"
	TypeAssetMeta          = TypeAssetMetadata
	TypeAssetData          = "asset_data"
	TypeAssetDelete        = "asset_delete"
	TypeScreenshotReq      = "screenshot_request"
	TypeLog                = "log"
	TypeError              = "error"
	TypeMonitorCreate      = "monitor_create"
	TypeMonitorUpdate      = "monitor_update"
	TypeMonitorDelete      = "monitor_delete"
	TypeSceneRestoreBegin  = "scene_restore_begin"
	TypeSceneRestoreEnd    = "scene_restore_end"
	TypeSceneCaptureResult = "scene_capture_result"
)

// #endregion

// #region Renderer → Simulator message types

const (
	TypeStateSync    = "state_sync"
	TypeParamChange  = "param_change"
	TypeActionInvoke = "action_invoke"
	// TypeActionStart is source-compatible only; canonical v0.3 accepts action_invoke.
	TypeActionStart        = TypeActionInvoke
	TypeAssetSync          = "asset_sync"
	TypeScreenshotResponse = "screenshot_response"
	TypeSceneRestore       = "scene_restore"
	TypeSceneCapture       = "scene_capture"
)

// Reserved action IDs.
const (
	ActionIDInit = "init"
	ActionIDStep = "step"
)

// #endregion

// #region Scalars

type AgentID = any
type AgentIcon string

const (
	AgentIconArrow    AgentIcon = "arrow"
	AgentIconCircle   AgentIcon = "circle"
	AgentIconSquare   AgentIcon = "square"
	AgentIconTriangle AgentIcon = "triangle"
)

// #endregion

// #region Parameter types

type NumberParameter struct {
	ID                 string  `json:"id"`
	Type               string  `json:"type"` // "number"
	Label              string  `json:"label"`
	Value              float64 `json:"value"`
	Min                float64 `json:"min"`
	Max                float64 `json:"max"`
	Step               float64 `json:"step"`
	AllowRuntimeChange *bool   `json:"allow_runtime_change,omitempty"`
}

type EnumParameter struct {
	ID                 string            `json:"id"`
	Type               string            `json:"type"` // "enum"
	Label              string            `json:"label"`
	Value              string            `json:"value"`
	Options            []string          `json:"options"`
	Labels             map[string]string `json:"labels,omitempty"`
	AllowRuntimeChange *bool             `json:"allow_runtime_change,omitempty"`
}

type BooleanParameter struct {
	ID                 string `json:"id"`
	Type               string `json:"type"` // "boolean"
	Label              string `json:"label"`
	Value              bool   `json:"value"`
	AllowRuntimeChange *bool  `json:"allow_runtime_change,omitempty"`
}

type StringParameter struct {
	ID                 string `json:"id"`
	Type               string `json:"type"` // "string"
	Label              string `json:"label"`
	Value              string `json:"value"`
	AllowRuntimeChange *bool  `json:"allow_runtime_change,omitempty"`
}

// #endregion

// #region Action

type Action struct {
	ID         string                  `json:"id"`
	Label      string                  `json:"label"`
	Scope      *string                 `json:"scope,omitempty"`
	Kwargs     []ActionKwargDefinition `json:"kwargs,omitempty"`
	Continuous *bool                   `json:"continuous,omitempty"`
}

type ActionKwargDefinition struct {
	Name     string   `json:"name"`
	Label    *string  `json:"label,omitempty"`
	Type     string   `json:"type"`
	Required *bool    `json:"required,omitempty"`
	Default  any      `json:"default,omitempty"`
	Min      *float64 `json:"min,omitempty"`
	Max      *float64 `json:"max,omitempty"`
	Step     *float64 `json:"step,omitempty"`
	Options  []string `json:"options,omitempty"`
}

// #endregion

// #region Chart

type ChartMetadata struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	Color *string `json:"color,omitempty"`
}

type ChartGroupMetadata struct {
	ID       string          `json:"id"`
	Label    string          `json:"label"`
	Color    *string         `json:"color,omitempty"`
	DataList []ChartMetadata `json:"data_list,omitempty"`
}

// #endregion

// #region Assets / Screenshots

type AssetDescriptor struct {
	ID    string  `json:"id"`
	Hash  string  `json:"hash"`
	MIME  string  `json:"mime"`
	Size  int64   `json:"size"`
	Label *string `json:"label,omitempty"`
}

type ScreenshotRequestPayload struct {
	RequestID string   `json:"request_id"`
	EnvID     *string  `json:"env_id,omitempty"`
	ChartID   *string  `json:"chart_id,omitempty"`
	Format    *string  `json:"format,omitempty"`
	Quality   *float64 `json:"quality,omitempty"`
}

// #endregion

// #region Simulator → Renderer payloads

type MetadataUpdatePayload struct {
	Time *float64 `json:"time,omitempty"`
}
type BindingInfo struct {
	Name     string  `json:"name"`
	Version  string  `json:"version"`
	Language *string `json:"language,omitempty"`
}
type ModelInfo struct {
	ID                 string  `json:"id"`
	Name               *string `json:"name,omitempty"`
	Description        *string `json:"description,omitempty"`
	Version            *string `json:"version,omitempty"`
	StateSchemaVersion *string `json:"state_schema_version,omitempty"`
}
type SimulatorInfoPayload struct {
	ProtocolVersion   string         `json:"protocol_version"`
	Binding           BindingInfo    `json:"binding"`
	Model             ModelInfo      `json:"model"`
	InstanceID        string         `json:"instance_id"`
	Capabilities      []string       `json:"capabilities"`
	CapabilityDetails map[string]any `json:"capability_details,omitempty"`
}

// NormalizeSimulatorInfo preserves the required v0.3 collection shape when a
// caller builds a handshake with Go's zero values. In particular, a nil slice
// encodes as JSON null while an empty capability list must encode as [].
func NormalizeSimulatorInfo(info *SimulatorInfoPayload) *SimulatorInfoPayload {
	if info == nil {
		return nil
	}
	normalized := *info
	if info.Capabilities == nil {
		normalized.Capabilities = []string{}
	} else {
		normalized.Capabilities = append([]string(nil), info.Capabilities...)
	}
	return &normalized
}

type StateSyncBeginPayload struct {
	RequestID  string `json:"request_id"`
	ModelID    string `json:"model_id"`
	InstanceID string `json:"instance_id"`
	Mode       string `json:"mode"`
}
type StateSyncEndPayload struct {
	RequestID     string `json:"request_id"`
	StateRevision string `json:"state_revision"`
}

type ActionResultTimings struct {
	SimulateMS    *float64 `json:"simulate_ms,omitempty"`
	CommunicateMS *float64 `json:"communicate_ms,omitempty"`
	RenderMS      *float64 `json:"render_ms,omitempty"`
}

type ActionEndTimings = ActionResultTimings
type ActionExecutionError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type ActionResultPayload struct {
	ID             string                `json:"id"`
	RequestID      string                `json:"request_id"`
	ShouldContinue *bool                 `json:"should_continue,omitempty"`
	Error          *ActionExecutionError `json:"error,omitempty"`
	Timings        *ActionResultTimings  `json:"timings,omitempty"`
}

type EnvCreatePayload struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}
type EnvDeletePayload struct {
	ID string `json:"id"`
}

type EnvLayerCreatePayload struct {
	EnvID              string            `json:"env_id"`
	LayerID            string            `json:"layer_id"`
	LayerType          string            `json:"layer_type"`
	DependencyLayerIDs map[string]string `json:"dependency_layer_ids,omitempty"`
	Data               map[string]any    `json:"metadata,omitempty"`
}

type EnvLayerUpdatePayload struct {
	EnvID   string         `json:"env_id"`
	LayerID string         `json:"layer_id"`
	Data    map[string]any `json:"metadata"`
}

type EnvLayerDeletePayload struct {
	EnvID   string `json:"env_id"`
	LayerID string `json:"layer_id"`
}

type ItemCreatePayload struct {
	EnvID   string           `json:"env_id"`
	LayerID string           `json:"layer_id"`
	Items   []map[string]any `json:"items"`
}

type ItemUpdatePayload struct {
	EnvID   string           `json:"env_id"`
	LayerID string           `json:"layer_id"`
	Items   []map[string]any `json:"items"`
}

type ItemDeletePayload struct {
	EnvID   string `json:"env_id"`
	LayerID string `json:"layer_id"`
	Items   []any  `json:"items"`
}

type ParamDeletePayload struct {
	ID string `json:"id"`
}
type ParamSyncPayload struct {
	ID    string `json:"id"`
	Value any    `json:"value"`
}

type ChartUpdateEntry struct {
	ID    string   `json:"id"`
	Time  *float64 `json:"time,omitempty"`
	Value any      `json:"value"`
}

type ChartOperation struct {
	ID        string   `json:"id,omitempty"`
	Kind      string   `json:"kind"`
	Operation string   `json:"operation"` // "clear" or "truncate"
	Time      *float64 `json:"time,omitempty"`
	Inclusive *bool    `json:"inclusive,omitempty"`
}

type ChartUpdatePayload struct {
	Updates    []ChartUpdateEntry `json:"updates,omitempty"`
	Operations []ChartOperation   `json:"operations,omitempty"`
}

type ChartDeletePayload struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}
type AssetMetaPayload struct {
	Assets []AssetDescriptor `json:"assets"`
}

type AssetDataPayload struct {
	ID   string `json:"id"`
	Hash string `json:"hash"`
	MIME string `json:"mime"`
	Data any    `json:"data"`
}

type AssetDeletePayload struct {
	IDs []string `json:"ids"`
}

type LogLevel string

const (
	LogLevelDebug    LogLevel = "debug"
	LogLevelInfo     LogLevel = "info"
	LogLevelWarning  LogLevel = "warning"
	LogLevelError    LogLevel = "error"
	LogLevelCritical LogLevel = "critical"
)

type LogPayload struct {
	Message   string    `json:"message"`
	Level     *LogLevel `json:"level,omitempty"`
	Target    *string   `json:"target,omitempty"`
	Timestamp *float64  `json:"timestamp,omitempty"`
	Data      any       `json:"data,omitempty"`
}

type ErrorPayload struct {
	Code      string  `json:"code"`
	Message   string  `json:"message"`
	RequestID *string `json:"request_id,omitempty"`
	Path      *string `json:"path,omitempty"`
	Retryable *bool   `json:"retryable,omitempty"`
	Data      any     `json:"data,omitempty"`
}
type ActionDeletePayload struct {
	ID string `json:"id"`
}

// #endregion

// #region Renderer → Simulator payloads

type StateSyncEnvLayer struct {
	LayerID   string `json:"layer_id"`
	LayerType string `json:"layer_type"`
}

type StateSyncEnv struct {
	ID     string              `json:"id"`
	Type   string              `json:"type"`
	Layers []StateSyncEnvLayer `json:"layers"`
}

type StateSyncPayload struct {
	RequestID        string            `json:"request_id"`
	ModelID          string            `json:"model_id"`
	InstanceID       *string           `json:"instance_id,omitempty"`
	StateRevision    *string           `json:"state_revision,omitempty"`
	MetadataRevision *string           `json:"metadata_revision,omitempty"`
	Parameters       []any             `json:"parameters"`
	Actions          []Action          `json:"actions"`
	Envs             []StateSyncEnv    `json:"envs"`
	Charts           []ChartMetadata   `json:"charts"`
	Monitors         []MonitorMetadata `json:"monitors"`
}

type ParamChangePayload struct {
	ID    string `json:"id"`
	Value any    `json:"value"`
}

type ActionTarget struct {
	Type    string `json:"type"`
	EnvID   string `json:"env_id"`
	LayerID string `json:"layer_id,omitempty"`
	AgentID any    `json:"agent_id,omitempty"`
}
type ActionInvokePayload struct {
	ID         string         `json:"id"`
	RequestID  string         `json:"request_id"`
	Continuous *bool          `json:"continuous,omitempty"`
	Target     *ActionTarget  `json:"target,omitempty"`
	Kwargs     map[string]any `json:"kwargs,omitempty"`
}

type MonitorMetadata struct {
	ID         string  `json:"id"`
	Label      string  `json:"label"`
	RenderHint *string `json:"render_hint,omitempty"`
}
type MonitorUpdatePayload struct {
	ID       string `json:"id"`
	Value    any    `json:"value"`
	Revision any    `json:"revision,omitempty"`
}
type MonitorDeletePayload struct {
	ID string `json:"id"`
}

type SceneRestorePayload struct {
	RequestID          string           `json:"request_id"`
	ModelID            string           `json:"model_id"`
	StateSchemaVersion *string          `json:"state_schema_version,omitempty"`
	ExpectedInstanceID *string          `json:"expected_instance_id,omitempty"`
	Checkpoint         any              `json:"checkpoint,omitempty"`
	Time               *float64         `json:"time,omitempty"`
	Parameters         []map[string]any `json:"parameters,omitempty"`
	Envs               []any            `json:"envs,omitempty"`
}
type SceneRestoreBeginPayload struct {
	RequestID string `json:"request_id"`
}
type SceneRestoreEndPayload struct {
	RequestID string                `json:"request_id"`
	Status    string                `json:"status"`
	Error     *ActionExecutionError `json:"error,omitempty"`
}
type SceneCapturePayload struct {
	RequestID string `json:"request_id"`
}
type SceneCaptureResultPayload struct {
	RequestID          string  `json:"request_id"`
	ModelID            string  `json:"model_id"`
	StateSchemaVersion *string `json:"state_schema_version,omitempty"`
	Checkpoint         any     `json:"checkpoint"`
}

type AssetSyncPayload struct {
	Assets map[string]string `json:"assets"`
}

type ScreenshotResponsePayload struct {
	RequestID string  `json:"request_id"`
	Data      any     `json:"data,omitempty"`
	MIME      *string `json:"mime,omitempty"`
	Error     *string `json:"error,omitempty"`
}

// #endregion

// #region Built-in item types

type Agent struct {
	ID    AgentID        `json:"id"`
	Color *string        `json:"color,omitempty"`
	Icon  *AgentIcon     `json:"icon,omitempty"`
	Size  *float64       `json:"size,omitempty"`
	Data  map[string]any `json:"data,omitempty"`
}

type EdgeData struct {
	Source   AgentID  `json:"source"`
	Target   AgentID  `json:"target"`
	Directed *bool    `json:"directed,omitempty"`
	Style    *string  `json:"style,omitempty"`
	Width    *float64 `json:"width,omitempty"`
	Color    *string  `json:"color,omitempty"`
}

// #endregion
