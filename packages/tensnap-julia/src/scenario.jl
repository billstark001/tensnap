mutable struct Scenario
	host::String
	port::Int
	use_msgpack::Bool
	step_interval::Float64
	parameters::Dict{String, Parameter}
	actions::Dict{String, Action}
	charts::Dict{String, Chart}
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
end

function Scenario(; host = "localhost", port = 8765, use_msgpack = false, step_interval = 0.05)
	s = Scenario(String(host), Int(port), Bool(use_msgpack), Float64(step_interval),
		Dict{String, Parameter}(), Dict{String, Action}(), Dict{String, Chart}(),
		Dict{String, Environment}(), Dict{String, Asset}(), Dict{String, Channel{Any}}(), nothing, nothing, nothing, nothing, 0, false,
		HTTP.WebSockets.WebSocket[], IdDict{HTTP.WebSockets.WebSocket, Bool}())
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
	s.parameters[p.id] = p
	_broadcast(s, "param_create", _param_payload(p, s.model))
	return p
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
	existed && _broadcast(s, "chart_delete", Dict("id" => sid))
	return existed
end

function register_model!(s::Scenario, model; init = nothing, step = nothing, reset = nothing)
	s.model = model
	s.init = init
	s.step = step
	s.reset = reset
	return s
end
