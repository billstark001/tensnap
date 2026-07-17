mutable struct Scenario
	host::String
	port::Int
	use_msgpack::Bool
	step_interval::Float64
	parameters::Dict{String, Parameter}
	actions::Dict{String, Action}
	charts::Dict{String, Chart}
	monitors::Dict{String, Monitor}
	environments::Dict{String, Environment}
	assets::Dict{String, Asset}
	pending_screenshots::Dict{String, Channel{Any}}
	model::Any
	init::Union{Nothing, Function}
	step::Union{Nothing, Function}
	reset::Union{Nothing, Function}
	time_step::Int
	initialized::Bool
	clients::Vector{HTTP.WebSockets.WebSocket}
	client_encodings::IdDict{HTTP.WebSockets.WebSocket, Bool}
	model_id::String
	model_name::Union{Nothing, String}
	model_description::Union{Nothing, String}
	model_version::Union{Nothing, String}
	state_schema_version::Union{Nothing, String}
	instance_id::String
	capabilities::Set{String}
	capability_details::Dict{String, Any}
	state_revision::Int
	scene_restore::Union{Nothing, Function}
	checkpoint_capture::Union{Nothing, Function}
end

function Scenario(; host = "localhost", port = 8765, use_msgpack = false, step_interval = 0.05,
	model_id = "tensnap.julia.model", model_name = nothing, model_description = nothing,
	model_version = nothing, state_schema_version = nothing, capabilities = String[],
	capability_details = Dict{String, Any}(), monitors = Monitor[],
	scene_restore = nothing, checkpoint_capture = nothing, restore_hooks = nothing)
	isempty(String(model_id)) && error("model_id must be a non-empty stable string")
	if restore_hooks !== nothing
		restore_hooks isa RestoreHooks || error("restore_hooks must be created with restore_hooks(...)")
		scene_restore === nothing || error("Use scene_restore or restore_hooks, not both.")
		checkpoint_capture === nothing || error("Use checkpoint_capture or restore_hooks, not both.")
		scene_restore = restore_hooks.projected
		checkpoint_capture = restore_hooks.checkpoint_capture
	end
	monitor_dict = Dict{String, Monitor}()
	for item in monitors
		item isa Monitor || error("monitors must contain Monitor values")
		haskey(monitor_dict, item.id) && error("duplicate monitor id: $(item.id)")
		monitor_dict[item.id] = item
	end
	caps = Set(String.(capabilities))
	isempty(monitor_dict) || push!(caps, "monitor")
	scene_restore === nothing || push!(caps, "scene.restore.projected")
	(scene_restore === nothing || checkpoint_capture === nothing) || push!(caps, "scene.restore.checkpoint")
	s = Scenario(String(host), Int(port), Bool(use_msgpack), Float64(step_interval),
		Dict{String, Parameter}(), Dict{String, Action}(), Dict{String, Chart}(), monitor_dict,
		Dict{String, Environment}(), Dict{String, Asset}(), Dict{String, Channel{Any}}(), nothing, nothing, nothing, nothing, 0, false,
		HTTP.WebSockets.WebSocket[], IdDict{HTTP.WebSockets.WebSocket, Bool}(),
		String(model_id), model_name === nothing ? nothing : String(model_name), model_description === nothing ? nothing : String(model_description),
		model_version === nothing ? nothing : String(model_version), state_schema_version === nothing ? nothing : String(state_schema_version),
		string(uuid4()), caps, Dict{String, Any}(String(k) => v for (k, v) in pairs(capability_details)), 0,
		scene_restore, checkpoint_capture)
	add_action!(s, action(ACTION_START, () -> begin
		_advance_step!(s)
	end; label = "Start", continuous = true, continue_on_return = true))
	add_action!(s, action(ACTION_STEP, () -> begin
		step!(s);
		false
	end; label = "Step"))
	add_action!(s, action(ACTION_RESET, () -> begin
		reset!(s);
		false
	end; label = "Reset"))
	return s
end

function add_parameter!(s::Scenario, p::Parameter)
	existed = haskey(s.parameters, p.id)
	s.parameters[p.id] = p
	_broadcast(s, existed ? "param_update" : "param_create", _param_payload(p, s.model))
	return p
end

function update_parameter!(s::Scenario, p::Parameter)
	s.parameters[p.id] = p
	_broadcast(s, "param_update", _param_payload(p, s.model))
	return p
end

function add_parameters!(s::Scenario, params...)
	added = Parameter[]
	for item in params
		if item isa Parameter
			push!(added, add_parameter!(s, item))
		else
			for p in item
				push!(added, add_parameter!(s, p))
			end
		end
	end
	return added
end

function remove_parameter!(s::Scenario, id)
	sid = String(id)
	existed = pop!(s.parameters, sid, nothing) !== nothing
	existed && _broadcast(s, "param_delete", Dict("id" => sid))
	return existed
end

function add_action!(s::Scenario, a::Action)
	s.actions[a.id] = a
	_broadcast(s, "action_create", _action_payload(a))
	return a
end

function remove_action!(s::Scenario, id)
	sid = String(id)
	existed = pop!(s.actions, sid, nothing) !== nothing
	existed && _broadcast(s, "action_delete", Dict("id" => sid))
	return existed
end

function add_chart!(s::Scenario, c::Chart)
	s.charts[c.id] = c
	_broadcast(s, "chart_create", _chart_payload(c))
	return c
end

function remove_chart!(s::Scenario, id)
	sid = String(id)
	existed = pop!(s.charts, sid, nothing) !== nothing
	existed && _broadcast(s, "chart_delete", Dict("kind" => "group", "id" => sid))
	return existed
end

function add_monitor!(s::Scenario, m::Monitor)
	s.monitors[m.id] = m
	# Capabilities are immutable after a connection opens. Declare monitor
	# support during construction (or before run!) for a truthful handshake.
	isempty(s.clients) && push!(s.capabilities, "monitor")
	_broadcast(s, "monitor_create", _monitor_payload(m))
	return m
end

function remove_monitor!(s::Scenario, id)
	sid = String(id)
	existed = pop!(s.monitors, sid, nothing) !== nothing
	existed && _broadcast(s, "monitor_delete", Dict("id" => sid))
	if isempty(s.monitors) && isempty(s.clients)
		delete!(s.capabilities, "monitor")
	end
	return existed
end

function register_model!(s::Scenario, model; init = nothing, step = nothing, reset = nothing)
	s.model = model
	s.init = init
	s.step = step
	s.reset = reset
	return s
end
