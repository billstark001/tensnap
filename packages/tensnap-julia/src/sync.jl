_payload_id(x) = get(x, "id", nothing)

function _payload_map(items)
	out = Dict{String, Any}()
	for item in items
		id = _payload_id(item)
		id === nothing || (out[String(id)] = item)
	end
	return out
end

_payload_equal(a, b) = _jsonable(a) == _jsonable(b)

function _sync_actions!(s::Scenario, ws, client_actions)
	clients = _payload_map(client_actions)
	server_ids = Set(keys(s.actions))
	for client_id in keys(clients)
		client_id in server_ids || _send_to(s, ws, "action_delete", Dict("id" => client_id))
	end
	for action in values(s.actions)
		payload = _action_payload(action)
		if !haskey(clients, action.id)
			_send_to(s, ws, "action_create", payload)
		elseif !_payload_equal(payload, clients[action.id])
			_send_to(s, ws, "action_update", payload)
		end
	end
end

function _sync_parameters!(s::Scenario, ws, client_params)
	clients = _payload_map(client_params)
	server_ids = Set(keys(s.parameters))
	# state_sync is read-only renderer inventory; never write client parameter
	# values into the authoritative simulator here.
	for client_id in keys(clients)
		client_id in server_ids || _send_to(s, ws, "param_delete", Dict("id" => client_id))
	end
	for parameter in values(s.parameters)
		payload = _param_payload(parameter, s.model)
		if !haskey(clients, parameter.id)
			_send_to(s, ws, "param_create", payload)
		elseif !_payload_equal(payload, clients[parameter.id])
			_send_to(s, ws, "param_update", payload)
		end
	end
end

function _client_layer_ids(client_env)
	client_env === nothing && return Set{String}()
	layers = get(client_env, "layers", Any[])
	return Set(String(get(layer, "layer_id", "")) for layer in layers if haskey(layer, "layer_id"))
end

function _sync_environment!(s::Scenario, ws, e::Environment, client_env)
	recreate = client_env === nothing || get(client_env, "type", nothing) != e.type
	if recreate && client_env !== nothing
		_send_to(s, ws, "env_delete", Dict("id" => e.id))
	end
	recreate && _send_to(s, ws, "env_create", Dict("id" => e.id, "type" => e.type))

	server_layer_ids = Set(l.id for l in e.layers)
	client_layer_ids = _client_layer_ids(client_env)
	if !recreate
		for layer_id in setdiff(client_layer_ids, server_layer_ids)
			_send_to(s, ws, "env_layer_delete", Dict("env_id" => e.id, "layer_id" => layer_id))
		end
	end

	for layer in _ordered_layers(e)
		if !recreate && layer.id in client_layer_ids
			_send_to(s, ws, "env_layer_delete", Dict("env_id" => e.id, "layer_id" => layer.id))
		end
		_broadcast_layer_full(s, e.id, layer; ws = ws)
	end
end

function _sync_environments!(s::Scenario, ws, client_envs)
	clients = _payload_map(client_envs)
	server_ids = Set(keys(s.environments))
	for client_id in keys(clients)
		client_id in server_ids || _send_to(s, ws, "env_delete", Dict("id" => client_id))
	end
	for environment in values(s.environments)
		_sync_environment!(s, ws, environment, get(clients, environment.id, nothing))
	end
end

function _chart_meta_ids(c::Chart)
	return Set([c.id; String[item["id"] for item in c.series]])
end

function _sync_charts!(s::Scenario, ws, client_charts)
	clients = _payload_map(client_charts)
	# state_sync carries flat series metadata, not complete chart-group
	# descriptors. Preserve an existing group when its owner id is present and
	# do not mistake the other series in that group for stale chart groups.
	server_meta_ids = reduce(union, (_chart_meta_ids(c) for c in values(s.charts)); init = Set{String}())
	for client_id in keys(clients)
		client_id in server_meta_ids || _send_to(s, ws, "chart_delete", Dict("kind" => "group", "id" => client_id))
	end
	for c in values(s.charts)
		series_present = all(haskey(clients, String(item["id"])) for item in c.series)
		if !haskey(clients, c.id) && !series_present
			_send_to(s, ws, "chart_create", _chart_payload(c))
		end
	end
end

function _sync_monitors!(s::Scenario, ws, client_monitors)
	clients = _payload_map(client_monitors)
	server_ids = Set(keys(s.monitors))
	for client_id in keys(clients)
		client_id in server_ids || _send_to(s, ws, "monitor_delete", Dict("id" => client_id))
	end
	for monitor in values(s.monitors)
		payload = _monitor_payload(monitor)
		if !haskey(clients, monitor.id)
			_send_to(s, ws, "monitor_create", payload)
		elseif !_payload_equal(payload, clients[monitor.id])
			_send_to(s, ws, "monitor_delete", Dict("id" => monitor.id))
			_send_to(s, ws, "monitor_create", payload)
		end
	end
end

function _handle_state_sync(s::Scenario, ws, payload)
	request_id = String(get(payload, "request_id", uuid4()))
	if get(payload, "model_id", s.model_id) != s.model_id
		_send_to(s, ws, "error", Dict("code" => "model_mismatch", "message" => "state_sync model_id does not match this simulator.", "request_id" => request_id))
		return nothing
	end
	mode = get(payload, "instance_id", nothing) == s.instance_id ? "reconcile" : "replace"
	begin_payload = Dict("request_id" => request_id, "model_id" => s.model_id, "instance_id" => s.instance_id, "mode" => mode)
	_send_to(s, ws, "state_sync_begin", begin_payload)
	_ensure_initialized!(s)
	inventory = mode == "reconcile" ? payload : Dict{String, Any}()
	try
		_sync_actions!(s, ws, get(inventory, "actions", Any[]))
		_sync_parameters!(s, ws, get(inventory, "parameters", Any[]))
		_sync_environments!(s, ws, get(inventory, "envs", Any[]))
		_sync_charts!(s, ws, get(inventory, "charts", Any[]))
		_sync_monitors!(s, ws, get(inventory, "monitors", Any[]))
		_send_asset_meta(s, ws)
		_send_to(s, ws, "metadata_update", Dict("time" => s.time_step))
		broadcast_charts!(s, ws)
		broadcast_monitors!(s, ws)
	finally
		s.state_revision += 1
		_send_to(s, ws, "state_sync_end", Dict("request_id" => request_id, "state_revision" => string(s.state_revision)))
	end
end

function sync!(s::Scenario, ws = nothing; include_charts = true)
	sink(type, payload) = _send_or_broadcast(s, ws, type, payload)
	sink("metadata_update", Dict("time" => s.time_step))
	for a in values(s.actions)
		sink("action_create", _action_payload(a))
	end
	for p in values(s.parameters)
		sink("param_create", _param_payload(p, s.model))
	end
	for e in values(s.environments)
		sink("env_create", Dict("id" => e.id, "type" => e.type))
		for l in _ordered_layers(e)
			_broadcast_layer_full(s, e.id, l; ws = ws)
		end
	end
	if include_charts
		for c in values(s.charts)
			sink("chart_create", _chart_payload(c))
		end
	end
	for monitor in values(s.monitors)
		sink("monitor_create", _monitor_payload(monitor))
	end
	_send_asset_meta(s, ws)
	include_charts && broadcast_charts!(s, ws)
	broadcast_monitors!(s, ws)
	return s
end

"""Replay reset state with valid CRUD while preserving stable topology."""
function _sync_reset!(s::Scenario)
	for action in values(s.actions)
		_broadcast(s, "action_update", _action_payload(action))
	end
	for parameter in values(s.parameters)
		_broadcast(s, "param_update", _param_payload(parameter, s.model))
	end
	for environment in values(s.environments), layer in _ordered_layers(environment)
		data = _layer_data(layer, s.model)
		layer.last_data = data
		metadata = data isa AbstractDict ? data : Dict{String, Any}()
		_broadcast(s, "env_layer_update", Dict(
			"env_id" => environment.id,
			"layer_id" => layer.id,
			"metadata" => metadata,
		))
		if layer.type == "agent"
			deletes = [_item_delete_payload(layer, item) for item in values(layer.last_items)]
			items = _remember_layer_items!(layer, _layer_items(layer, s.model))
			isempty(deletes) || _broadcast(s, "item_delete", Dict("env_id" => environment.id, "layer_id" => layer.id, "items" => deletes))
			isempty(items) || _broadcast(s, "item_create", Dict("env_id" => environment.id, "layer_id" => layer.id, "items" => items))
		else
			creates, updates, deletes = _layer_item_deltas!(layer, s.model)
			isempty(deletes) || _broadcast(s, "item_delete", Dict("env_id" => environment.id, "layer_id" => layer.id, "items" => deletes))
			isempty(creates) || _broadcast(s, "item_create", Dict("env_id" => environment.id, "layer_id" => layer.id, "items" => creates))
			isempty(updates) || _broadcast(s, "item_update", Dict("env_id" => environment.id, "layer_id" => layer.id, "items" => updates))
		end
	end
	_send_asset_meta(s)
	_broadcast(s, "metadata_update", Dict("time" => s.time_step))
	broadcast_charts!(s)
	broadcast_monitors!(s)
	return s
end
