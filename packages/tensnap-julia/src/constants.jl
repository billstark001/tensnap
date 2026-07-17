const ACTION_START = "start"
const ACTION_STEP = "step"
const ACTION_RESET = "reset"

const SERVER_MESSAGE_TYPES = Set([
	"simulator_info", "metadata_update", "state_sync_begin", "state_sync_end", "action_result",
	"action_create", "action_update", "action_delete", "env_create", "env_delete",
	"env_layer_create", "env_layer_update", "env_layer_delete", "item_create",
	"item_update", "item_delete", "param_create", "param_update", "param_delete",
	"param_sync", "chart_create", "chart_update", "chart_delete", "monitor_create", "monitor_update", "monitor_delete", "asset_metadata",
	"asset_data", "asset_delete", "screenshot_request", "log", "error",
	"scene_restore_begin", "scene_restore_end", "scene_capture_result",
])

struct _UnsetValue end
const _UNSET = _UnsetValue()
