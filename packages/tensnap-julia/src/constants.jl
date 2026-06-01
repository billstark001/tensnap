const ACTION_START = "start"
const ACTION_STEP = "step"
const ACTION_RESET = "reset"

const SERVER_MESSAGE_TYPES = Set([
	"metadata_update", "state_sync_begin", "state_sync_end", "action_end",
	"action_create", "action_update", "action_delete", "env_create", "env_delete",
	"env_layer_create", "env_layer_update", "env_layer_delete", "item_create",
	"item_update", "item_delete", "param_create", "param_update", "param_delete",
	"param_sync", "chart_create", "chart_update", "chart_delete", "asset_meta",
	"asset_data", "asset_delete", "screenshot_request", "log", "error",
])

struct _UnsetValue end
const _UNSET = _UnsetValue()
