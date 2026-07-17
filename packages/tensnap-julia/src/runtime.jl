function broadcast_charts!(s::Scenario, ws = nothing)
	updates = Dict{String, Any}[]
	for c in values(s.charts)
		append!(updates, _chart_updates(c, _call0or1(c.getter, s.model), s.time_step))
	end
	isempty(updates) || _send_or_broadcast(s, ws, "chart_update", Dict("updates" => updates))
	return updates
end

function broadcast_monitors!(s::Scenario, ws = nothing)
	for monitor in values(s.monitors)
		value = _call0or1(monitor.getter, s.model)
		_send_or_broadcast(s, ws, "monitor_update", Dict("id" => monitor.id, "value" => value))
	end
	return s
end

function _ensure_initialized!(s::Scenario)
	if !s.initialized
		s.time_step = 0
		s.init !== nothing && _call0or1(s.init, s.model)
		s.initialized = true
	end
	return s
end

function _advance_step!(s::Scenario)
	_ensure_initialized!(s)
	s.time_step += 1
	step_result = s.step === nothing ? true : _call0or1(s.step, s.model)
	_broadcast(s, "metadata_update", Dict("time" => s.time_step))
	for e in values(s.environments), l in e.layers
		data = _layer_data_delta!(l, s.model)
		data === nothing || _broadcast(s, "env_layer_update", Dict("env_id" => e.id, "layer_id" => l.id, "metadata" => data))
		creates, updates, deletes = _layer_item_deltas!(l, s.model)
		isempty(creates) || _broadcast(s, "item_create", Dict("env_id" => e.id, "layer_id" => l.id, "items" => creates))
		isempty(updates) || _broadcast(s, "item_update", Dict("env_id" => e.id, "layer_id" => l.id, "items" => updates))
		isempty(deletes) || _broadcast(s, "item_delete", Dict("env_id" => e.id, "layer_id" => l.id, "items" => deletes))
	end
	broadcast_charts!(s)
	broadcast_monitors!(s)
	# Julia mutating model steps conventionally return their mutated model. Only
	# an explicit Bool controls renderer-driven continuation; every other normal
	# return value means the step completed successfully.
	return step_result isa Bool ? step_result : true
end

function step!(s::Scenario)
	_advance_step!(s)
	return s
end

function reset!(s::Scenario)
	s.time_step = 0
	if s.reset !== nothing
		_call0or1(s.reset, s.model)
	elseif s.init !== nothing
		_call0or1(s.init, s.model)
	end
	s.initialized = true
	clear_charts!(s)
	_sync_reset!(s)
	return s
end

function clear_charts!(s::Scenario; ids = collect(keys(s.charts)))
	operations = [Dict("id" => id, "kind" => "group", "operation" => "clear") for id in ids]
	isempty(operations) || _broadcast(s, "chart_update", Dict("operations" => operations))
	return s
end

function log!(s::Scenario, level, message)
	ts = Int(floor(datetime2unix(now(UTC)) * 1000))
	_broadcast(s, "log", Dict("timestamp" => ts, "level" => String(level), "message" => String(message)))
end

function _handle_message(s::Scenario, ws, raw)
	msg, use_msgpack = _decode_with_encoding(raw)
	ws === nothing || (s.client_encodings[ws] = use_msgpack)
	if !(msg isa AbstractDict) || !haskey(msg, "type")
		@warn "Ignoring invalid TenSnap client message" decoded_type=typeof(msg)
		return nothing
	end
	type = String(msg["type"])
	payload = haskey(msg, "payload") ? msg["payload"] : Dict{String, Any}()
	payload isa AbstractDict || (payload = Dict{String, Any}())
	if type == "state_sync"
		_handle_state_sync(s, ws, payload)
	elseif type == "param_change"
		id = String(payload["id"])
		haskey(s.parameters, id) && _set_parameter!(s.parameters[id], payload["value"], s.model)
	elseif type == "asset_sync"
		_handle_asset_sync(s, ws, payload)
	elseif type == "screenshot_response"
		_handle_screenshot_response(s, payload)
	elseif type == "action_invoke"
		_handle_action_invoke(s, ws, payload)
	elseif type == "scene_restore"
		_handle_scene_restore(s, ws, payload)
	elseif type == "scene_capture"
		_handle_scene_capture(s, ws, payload)
	end
	return nothing
end

_listen_host(host::String) = lowercase(host) == "localhost" ? "127.0.0.1" : host

function run!(s::Scenario; verbose = true)
	verbose && @info "TenSnap Julia server listening" host=s.host port=s.port
	HTTP.WebSockets.listen(_listen_host(s.host), s.port) do ws
		push!(s.clients, ws)
		_send_to(s, ws, "simulator_info", _simulator_info_payload(s))
		_send_asset_meta(s, ws)
		try
			for msg in ws
				_handle_message(s, ws, msg)
			end
		finally
			filter!(x -> x !== ws, s.clients)
			pop!(s.client_encodings, ws, nothing)
		end
	end
end

function _simulator_info_payload(s::Scenario)
	model = Dict{String, Any}("id" => s.model_id)
	s.model_name === nothing || (model["name"] = s.model_name)
	s.model_description === nothing || (model["description"] = s.model_description)
	s.model_version === nothing || (model["version"] = s.model_version)
	s.state_schema_version === nothing || (model["state_schema_version"] = s.state_schema_version)
	payload = Dict{String, Any}(
		"protocol_version" => "0.3",
	"binding" => Dict("name" => "tensnap-julia", "version" => "0.3.0", "language" => "julia"),
		"model" => model,
		"instance_id" => s.instance_id,
		"capabilities" => sort!(collect(s.capabilities)),
	)
	isempty(s.capability_details) || (payload["capability_details"] = s.capability_details)
	return payload
end

function _action_result!(s::Scenario, ws, id, request_id; should_continue = nothing, error = nothing, simulate_ms = nothing)
	resp = Dict{String, Any}("id" => String(id), "request_id" => String(request_id))
	should_continue === nothing || (resp["should_continue"] = Bool(should_continue))
	error === nothing || (resp["error"] = error)
	simulate_ms === nothing || (resp["timings"] = Dict("simulate_ms" => max(0.0, simulate_ms)))
	_send_to(s, ws, "action_result", resp)
end

function _validate_action_target(s::Scenario, a::Action, target)
	scope = a.scope === nothing ? "model" : a.scope
	scope == "model" && return target === nothing ? nothing : Dict("code" => "invalid_target", "message" => "This action does not accept a target.")
	(target isa AbstractDict && get(target, "type", nothing) == scope) || return Dict("code" => "invalid_target", "message" => "Action requires a $(scope) target.")
	env_id = get(target, "env_id", nothing)
	haskey(s.environments, String(env_id)) || return Dict("code" => "invalid_target", "message" => "Unknown environment: $(env_id).")
	scope == "env" && return nothing
	layer = _find_layer(s, env_id, get(target, "layer_id", ""))
	layer === nothing && return Dict("code" => "invalid_target", "message" => "Unknown layer.")
	scope == "layer" && return nothing
	any(item -> get(item, "id", nothing) == get(target, "agent_id", nothing), _layer_items(layer, s.model)) || return Dict("code" => "invalid_target", "message" => "Unknown agent target.")
	return nothing
end

function _validate_action_kwargs(a::Action, supplied)
	supplied === nothing && (supplied = Dict{String, Any}())
	supplied isa AbstractDict || return nothing, Dict("code" => "invalid_kwargs", "message" => "Action kwargs must be an object.")
	defs = Dict(String(def["name"]) => def for def in a.kwargs)
	for key in keys(supplied)
		haskey(defs, String(key)) || return nothing, Dict("code" => "invalid_kwargs", "message" => "Unknown action kwarg: $(key).")
	end
	result = Dict{String, Any}()
	for (name, def) in defs
		if !haskey(supplied, name)
			get(def, "required", false) && return nothing, Dict("code" => "invalid_kwargs", "message" => "Missing action kwarg: $(name).")
			haskey(def, "default") && (result[name] = def["default"])
			continue
		end
		value = supplied[name]
		kind = get(def, "type", "json")
		valid = kind == "json" || (kind == "string" && value isa AbstractString) || (kind == "boolean" && value isa Bool) ||
			(kind == "number" && value isa Number && !(value isa Bool)) || (kind == "integer" && value isa Integer) ||
			(kind == "enum" && value isa AbstractString && value in get(def, "options", Any[]))
		valid || return nothing, Dict("code" => "invalid_kwargs", "message" => "Invalid action kwarg: $(name).")
		if kind in ("number", "integer") && ((haskey(def, "min") && value < def["min"]) || (haskey(def, "max") && value > def["max"]))
			return nothing, Dict("code" => "invalid_kwargs", "message" => "Action kwarg out of range: $(name).")
		end
		result[name] = value
	end
	return result, nothing
end

function _invoke_action_handler(a::Action, target, kwargs, model)
	if a.scope !== nothing && a.scope != "model"
		applicable(a.handler, target, kwargs, model) && return a.handler(target, kwargs, model)
		applicable(a.handler, target, kwargs) && return a.handler(target, kwargs)
	end
	isempty(kwargs) || (applicable(a.handler, kwargs, model) && return a.handler(kwargs, model))
	isempty(kwargs) || (applicable(a.handler, kwargs) && return a.handler(kwargs))
	return _call0or1(a.handler, model)
end

function _handle_action_invoke(s::Scenario, ws, payload)
	id = String(get(payload, "id", ""))
	request_id = String(get(payload, "request_id", uuid4()))
	if !haskey(s.actions, id)
		_action_result!(s, ws, id, request_id; error = Dict("code" => "unknown_action", "message" => "No handler for action: $(id)."))
		return nothing
	end
	a = s.actions[id]
	supplied_target = get(payload, "target", nothing)
	supplied_kwargs = get(payload, "kwargs", nothing)
	# Playback actions are the hot path. They normally have no target or kwargs,
	# so bypass declaration-map construction and dynamic signature probes.
	if (a.scope === nothing || a.scope == "model") && isempty(a.kwargs) && supplied_target === nothing &&
		(supplied_kwargs === nothing || (supplied_kwargs isa AbstractDict && isempty(supplied_kwargs)))
		try
			result = _call0or1(a.handler, s.model)
			cont = get(payload, "continuous", false) && a.continue_on_return && Bool(result)
			_action_result!(s, ws, id, request_id; should_continue = cont)
		catch error
			_action_result!(s, ws, id, request_id; error = Dict("code" => "handler_error", "message" => sprint(showerror, error)))
		end
		return nothing
	end
	target_error = _validate_action_target(s, a, supplied_target)
	kwargs, kwargs_error = _validate_action_kwargs(a, supplied_kwargs)
	if target_error !== nothing || kwargs_error !== nothing
		_action_result!(s, ws, id, request_id; error = target_error === nothing ? kwargs_error : target_error)
		return nothing
	end
	try
		result = _invoke_action_handler(a, supplied_target, kwargs, s.model)
		cont = get(payload, "continuous", false) && a.continue_on_return && Bool(result)
		_action_result!(s, ws, id, request_id; should_continue = cont)
	catch error
		_action_result!(s, ws, id, request_id; error = Dict("code" => "handler_error", "message" => sprint(showerror, error)))
	end
	return nothing
end

function _handle_scene_restore(s::Scenario, ws, payload)
	request_id = String(get(payload, "request_id", uuid4()))
	if haskey(s.restore_results, request_id)
		_send_to(s, ws, "scene_restore_begin", Dict("request_id" => request_id))
		_send_to(s, ws, "scene_restore_end", s.restore_results[request_id])
		return nothing
	end
	begin_sent = false
	begin_restore!() = begin
		if !begin_sent
			_send_to(s, ws, "scene_restore_begin", Dict("request_id" => request_id))
			begin_sent = true
		end
	end
	finish(status; code = nothing, message = nothing) = begin
		begin_restore!()
		result = Dict{String, Any}("request_id" => request_id, "status" => status)
		code === nothing || (result["error"] = Dict("code" => code, "message" => message))
		s.restore_results[request_id] = result
		_send_to(s, ws, "scene_restore_end", result)
	end
	has_projected_state = any(haskey(payload, key) for key in ("time", "parameters", "envs"))
	if get(payload, "model_id", nothing) != s.model_id
		finish("rejected"; code = "model_mismatch", message = "scene_restore model_id does not match this simulator.")
		return nothing
	end
	if get(payload, "expected_instance_id", nothing) ∉ (nothing, s.instance_id)
		finish("rejected"; code = "instance_mismatch", message = "scene_restore expected_instance_id is stale.")
		return nothing
	end
	if s.state_schema_version !== nothing && get(payload, "state_schema_version", nothing) ∉ (nothing, s.state_schema_version)
		finish("rejected"; code = "state_schema_mismatch", message = "scene_restore state schema is incompatible.")
		return nothing
	end
	if s.scene_restore === nothing && has_projected_state
		finish("rejected"; code = "unsupported_capability", message = "Scene restore is not configured.")
		return nothing
	end
	if haskey(payload, "checkpoint") && (s.checkpoint_capture === nothing || s.checkpoint_restore === nothing)
		finish("rejected"; code = "unsupported_capability", message = "Checkpoint restore is not configured.")
		return nothing
	end
	if !has_projected_state && !haskey(payload, "checkpoint")
		finish("rejected"; code = "invalid_restore", message = "scene_restore contains no restorable state.")
		return nothing
	end
	previous = Dict(
		"actions" => collect(keys(s.actions)),
		"parameters" => collect(keys(s.parameters)),
		"envs" => collect(keys(s.environments)),
		"monitors" => collect(keys(s.monitors)),
	)
	previous_time = s.time_step
	has_rollback = s.checkpoint_capture !== nothing && s.checkpoint_restore !== nothing
	rollback = nothing
	rollback_captured = false
	try
		if has_rollback
			rollback = _call0or1(s.checkpoint_capture, s.model)
			rollback_captured = true
		end
		begin_restore!()
		if haskey(payload, "checkpoint")
			_call0or1(s.checkpoint_restore, _decode_checkpoint(payload["checkpoint"]))
		end
		if has_projected_state
			projected = Dict{String, Any}(String(k) => v for (k, v) in pairs(payload) if String(k) != "checkpoint")
			_call0or1(s.scene_restore, projected)
		end
		haskey(payload, "time") && (s.time_step = Int(payload["time"]))
		for id in previous["monitors"]
			_send_to(s, ws, "monitor_delete", Dict("id" => id))
		end
		for id in previous["actions"]
			_send_to(s, ws, "action_delete", Dict("id" => id))
		end
		for id in previous["parameters"]
			_send_to(s, ws, "param_delete", Dict("id" => id))
		end
		for id in previous["envs"]
			_send_to(s, ws, "env_delete", Dict("id" => id))
		end
		sync!(s, ws; include_charts = false)
		finish("ok")
	catch error
		s.time_step = previous_time
		message = sprint(showerror, error)
		if has_rollback && rollback_captured
			try
				_call0or1(s.checkpoint_restore, rollback)
			catch rollback_error
				message *= "; rollback failed: " * sprint(showerror, rollback_error)
			end
		end
		finish("failed"; code = "restore_failed", message = message)
	end
	return nothing
end

function _handle_scene_capture(s::Scenario, ws, payload)
	request_id = String(get(payload, "request_id", uuid4()))
	if s.checkpoint_capture === nothing || s.checkpoint_restore === nothing
		_send_to(s, ws, "error", Dict("code" => "unsupported_capability", "message" => "Checkpoint capture is not configured.", "request_id" => request_id))
		return nothing
	end
	try
		data = _call0or1(s.checkpoint_capture, s.model)
		checkpoint = _encode_checkpoint(data; use_msgpack = _client_use_msgpack(s, ws))
		result = Dict{String, Any}("request_id" => request_id, "model_id" => s.model_id, "checkpoint" => checkpoint)
		s.state_schema_version === nothing || (result["state_schema_version"] = s.state_schema_version)
		_send_to(s, ws, "scene_capture_result", result)
	catch error
		_send_to(s, ws, "error", Dict("code" => "capture_failed", "message" => sprint(showerror, error), "request_id" => request_id))
	end
	return nothing
end
