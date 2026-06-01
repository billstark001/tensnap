function broadcast_charts!(s::Scenario, ws = nothing)
	updates = Dict{String, Any}[]
	for c in values(s.charts)
		append!(updates, _chart_updates(c, _call0or1(c.getter, s.model), s.time_step))
	end
	isempty(updates) || _send_or_broadcast(s, ws, "chart_update", Dict("updates" => updates))
	return updates
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
		data === nothing || _broadcast(s, "env_layer_update", Dict("env_id" => e.id, "layer_id" => l.id, "data" => data))
		creates, updates, deletes = _layer_item_deltas!(l, s.model)
		isempty(creates) || _broadcast(s, "item_create", Dict("env_id" => e.id, "layer_id" => l.id, "items" => creates))
		isempty(updates) || _broadcast(s, "item_update", Dict("env_id" => e.id, "layer_id" => l.id, "items" => updates))
		isempty(deletes) || _broadcast(s, "item_delete", Dict("env_id" => e.id, "layer_id" => l.id, "items" => deletes))
	end
	broadcast_charts!(s)
	return step_result === nothing ? true : Bool(step_result)
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
	sync!(s)
	return s
end

function clear_charts!(s::Scenario; ids = collect(keys(s.charts)))
	operations = [Dict("id" => id, "operation" => "clear") for id in ids]
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
		_broadcast(s, "param_sync", Dict("id" => id, "value" => payload["value"]))
	elseif type == "asset_sync"
		_handle_asset_sync(s, ws, payload)
	elseif type == "screenshot_response"
		_handle_screenshot_response(s, payload)
	elseif type == "action_start"
		id = String(payload["id"])
		tick_id = get(payload, "tick_id", nothing)
		if haskey(s.actions, id)
			started = time_ns()
			result = _call0or1(s.actions[id].handler, s.model)
			simulate_ms = (time_ns() - started) / 1_000_000
			cont = s.actions[id].continue_on_return ? Bool(result) : false
			resp = Dict{String, Any}("id" => id, "timings" => Dict("simulate_ms" => simulate_ms), "continue" => cont)
			tick_id === nothing || (resp["tick_id"] = tick_id)
			_send_to(s, ws, "action_end", resp)
		end
	end
	return nothing
end

_listen_host(host::String) = lowercase(host) == "localhost" ? "127.0.0.1" : host

function run!(s::Scenario; verbose = true)
	verbose && @info "TenSnap Julia server listening" host=s.host port=s.port
	HTTP.WebSockets.listen(_listen_host(s.host), s.port) do ws
		push!(s.clients, ws)
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
