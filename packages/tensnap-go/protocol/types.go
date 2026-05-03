// Package protocol defines all TenSnap v0.2 wire types and constants.
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
	TypeMetadataUpdate = "metadata_update"
	TypeStateSyncBegin = "state_sync_begin"
	TypeStateSyncEnd   = "state_sync_end"
	TypeActionEnd      = "action_end"
	TypeActionCreate   = "action_create"
	TypeActionUpdate   = "action_update"
	TypeActionDelete   = "action_delete"
	TypeEnvCreate      = "env_create"
	TypeEnvDelete      = "env_delete"
	TypeEnvLayerCreate = "env_layer_create"
	TypeEnvLayerUpdate = "env_layer_update"
	TypeEnvLayerDelete = "env_layer_delete"
	TypeItemCreate     = "item_create"
	TypeItemUpdate     = "item_update"
	TypeItemDelete     = "item_delete"
	TypeParamCreate    = "param_create"
	TypeParamUpdate    = "param_update"
	TypeParamDelete    = "param_delete"
	TypeParamSync      = "param_sync"
	TypeChartCreate    = "chart_create"
	TypeChartUpdate    = "chart_update"
	TypeChartDelete    = "chart_delete"
	TypeAssetMeta      = "asset_meta"
	TypeAssetData      = "asset_data"
	TypeAssetDelete    = "asset_delete"
	TypeScreenshotReq  = "screenshot_request"
	TypeLog            = "log"
	TypeError          = "error"
)

// #endregion

// #region Renderer → Simulator message types

const (
	TypeStateSync          = "state_sync"
	TypeParamChange        = "param_change"
	TypeActionStart        = "action_start"
	TypeAssetSync          = "asset_sync"
	TypeScreenshotResponse = "screenshot_response"
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
	AllowRuntimeChange *bool   `json:"allowRuntimeChange,omitempty"`
}

type EnumParameter struct {
	ID                 string            `json:"id"`
	Type               string            `json:"type"` // "enum"
	Label              string            `json:"label"`
	Value              string            `json:"value"`
	Options            []string          `json:"options"`
	Labels             map[string]string `json:"labels,omitempty"`
	AllowRuntimeChange *bool             `json:"allowRuntimeChange,omitempty"`
}

type BooleanParameter struct {
	ID                 string `json:"id"`
	Type               string `json:"type"` // "boolean"
	Label              string `json:"label"`
	Value              bool   `json:"value"`
	AllowRuntimeChange *bool  `json:"allowRuntimeChange,omitempty"`
}

type StringParameter struct {
	ID                 string `json:"id"`
	Type               string `json:"type"` // "string"
	Label              string `json:"label"`
	Value              string `json:"value"`
	AllowRuntimeChange *bool  `json:"allowRuntimeChange,omitempty"`
}

// #endregion

// #region Action

type Action struct {
	ID                 string `json:"id"`
	Label              string `json:"label"`
	Continuous         *bool  `json:"continuous,omitempty"`
	AllowRuntimeChange *bool  `json:"allowRuntimeChange,omitempty"`
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
	DataList []ChartMetadata `json:"dataList,omitempty"`
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
type StateSyncBracketPayload struct {
	RequestID *string `json:"request_id,omitempty"`
}

type ActionEndTimings struct {
	SimulateMS    *float64 `json:"simulate_ms,omitempty"`
	CommunicateMS *float64 `json:"communicate_ms,omitempty"`
	RenderMS      *float64 `json:"render_ms,omitempty"`
}

type ActionEndPayload struct {
	ID       string            `json:"id"`
	TickID   *string           `json:"tick_id,omitempty"`
	Continue *bool             `json:"continue,omitempty"`
	Timings  *ActionEndTimings `json:"timings,omitempty"`
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
	Data               map[string]any    `json:"data,omitempty"`
}

type EnvLayerUpdatePayload struct {
	EnvID   string         `json:"env_id"`
	LayerID string         `json:"layer_id"`
	Data    map[string]any `json:"data"`
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
	ID        string `json:"id"`
	Operation string `json:"operation"` // "clear"
}

type ChartUpdatePayload struct {
	Updates    []ChartUpdateEntry `json:"updates,omitempty"`
	Operations []ChartOperation   `json:"operations,omitempty"`
}

type ChartDeletePayload struct {
	ID string `json:"id"`
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
	Error string `json:"error"`
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
	RequestID  *string         `json:"request_id,omitempty"`
	Parameters []any           `json:"parameters"`
	Actions    []Action        `json:"actions"`
	Envs       []StateSyncEnv  `json:"envs"`
	Charts     []ChartMetadata `json:"charts"`
}

type ParamChangePayload struct {
	ID    string `json:"id"`
	Value any    `json:"value"`
}

type ActionStartPayload struct {
	ID         string  `json:"id"`
	TickID     *string `json:"tick_id,omitempty"`
	Continuous *bool   `json:"continuous,omitempty"`
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
