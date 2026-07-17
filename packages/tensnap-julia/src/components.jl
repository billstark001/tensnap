mutable struct Parameter
	id::String
	label::String
	type::String
	value::Any
	min::Any
	max::Any
	step::Any
	options::Union{Nothing, Vector{Any}}
	allow_runtime_change::Bool
	getter::Union{Nothing, Function}
	setter::Union{Nothing, Function}
end

function parameter(id; label = id, type = "number", value = nothing, min = nothing, max = nothing,
	step = nothing, options = nothing, allow_runtime_change = true, getter = nothing, setter = nothing)
	return Parameter(String(id), String(label), String(type), value, min, max, step,
		options === nothing ? nothing : collect(options), Bool(allow_runtime_change),
		getter, setter)
end

function _param_value(p::Parameter, model = nothing)
	p.getter === nothing ? p.value : _call0or1(p.getter, model)
end

function _param_payload(p::Parameter, model = nothing)
	d = Dict{String, Any}("id" => p.id, "label" => p.label, "type" => p.type, "value" => _jsonable(_param_value(p, model)), "allow_runtime_change" => p.allow_runtime_change)
	p.min !== nothing && (d["min"] = p.min)
	p.max !== nothing && (d["max"] = p.max)
	p.step !== nothing && (d["step"] = p.step)
	p.options !== nothing && (d["options"] = p.options)
	return d
end

function _set_parameter!(p::Parameter, value, model = nothing)
	p.setter === nothing ? (p.value = value) : _call1or2(p.setter, value, model)
	p.value = value
	return value
end

_parameter_target(model, target::Function) = target(model)

function _field_path_parts(field)
	if field isa Symbol || field isa AbstractString
		text = String(field)
		occursin(".", text) && return Any[part for part in split(text, ".")]
	end
	return Any[field]
end

function _get_parameter_field(obj, field)
	current = obj
	for part in _field_path_parts(field)
		current = _getvalue(current, part)
		current === nothing && return nothing
	end
	return current
end

function _parameter_field_parent(obj, field)
	parts = _field_path_parts(field)
	isempty(parts) && return nothing, nothing
	current = obj
	for part in parts[1:(end - 1)]
		current = _getvalue(current, part)
		current === nothing && return nothing, nothing
	end
	return current, parts[end]
end

function _lookup_option(options, key, default = nothing)
	options === nothing && return default
	if options isa AbstractDict
		for candidate in _key_candidates(key)
			haskey(options, candidate) && return options[candidate]
		end
		return default
	end
	if options isa NamedTuple
		sym = key isa Symbol ? key : Symbol(key)
		return sym in keys(options) ? getproperty(options, sym) : default
	end
	sym = key isa Symbol ? key : Symbol(key)
	return hasproperty(options, sym) ? getproperty(options, sym) : default
end

function _parameter_type_for(value, metadata)
	explicit_type = _lookup_option(metadata, :type, nothing)
	explicit_type === nothing || return String(explicit_type)
	_lookup_option(metadata, :options, nothing) === nothing || return "enum"
	value isa Bool && return "boolean"
	value isa Number && return "number"
	value isa AbstractString && return "string"
	return nothing
end

function _allow_runtime_change_for(metadata)
	value = _lookup_option(metadata, :allow_runtime_change, nothing)
	value === nothing && (value = _lookup_option(metadata, :allowRuntimeChange, true))
	return Bool(value)
end

function _can_set_parameter_field(obj, field)
	parent, leaf = _parameter_field_parent(obj, field)
	parent === nothing && return false
	parent isa AbstractDict && return true
	parent isa NamedTuple && return false
	parent isa Type && return false
	return ismutable(parent) && hasproperty(parent, leaf isa Symbol ? leaf : Symbol(leaf))
end

function _coerce_parameter_value(current, value)
	current === nothing && return value
	value isa typeof(current) && return value
	try
		return convert(typeof(current), value)
	catch
		return value
	end
end

function _make_field_getter(captured_model, target::Function, field)
	field_key = field
	return model -> _get_parameter_field(_parameter_target(model === nothing ? captured_model : model, target), field_key)
end

function _make_field_setter(captured_model, target::Function, field)
	field_key = field
	return (value, model) -> begin
		target_obj = _parameter_target(model === nothing ? captured_model : model, target)
		parent, leaf = _parameter_field_parent(target_obj, field_key)
		parent === nothing && return value
		current = _getvalue(parent, leaf)
		_setvalue!(parent, leaf, _coerce_parameter_value(current, value))
	end
end

"""
    parameters_from_fields(model; target=identity, include=nothing, exclude=(),
        metadata=Dict(), rename=Dict())

Build `Parameter` bindings by discovering scalar fields on `model` or on
`target(model)`. Explicit `include` entries may be fields or dotted paths.
By default it includes fields whose current values are
`Number`, `Bool`, or `AbstractString`; fields with `metadata[field].options`
are treated as enum parameters. Metadata can also provide custom `getter` or
`setter` functions for fields whose runtime behavior needs side effects, plus
`allow_runtime_change = false` for controls that should be staged for the next
reset/init.
"""
function parameters_from_fields(model; target = identity, include = nothing, exclude = (), metadata = Dict(), rename = Dict())
	target_obj = _parameter_target(model, target)
	fields = include === nothing ? collect(_public_fieldnames(target_obj)) : collect(include)
	excluded = Set(String(field) for field in exclude)
	params = Parameter[]
	for field in fields
		String(field) in excluded && continue
		field_metadata = _lookup_option(metadata, field, nothing)
		value = _get_parameter_field(target_obj, field)
		parameter_type = _parameter_type_for(value, field_metadata)
		parameter_type === nothing && continue

		id = String(_lookup_option(rename, field, field))
		label = String(_lookup_option(field_metadata, :label, id))
		getter = _lookup_option(field_metadata, :getter, _make_field_getter(model, target, field))
		setter = _lookup_option(field_metadata, :setter, nothing)
		setter === nothing && _can_set_parameter_field(target_obj, field) && (setter = _make_field_setter(model, target, field))

		push!(params, parameter(id;
			label = label,
			type = parameter_type,
			value = _lookup_option(field_metadata, :value, value),
			min = _lookup_option(field_metadata, :min, nothing),
			max = _lookup_option(field_metadata, :max, nothing),
			step = _lookup_option(field_metadata, :step, nothing),
			options = _lookup_option(field_metadata, :options, nothing),
			allow_runtime_change = _allow_runtime_change_for(field_metadata),
			getter = getter,
			setter = setter,
		))
	end
	return params
end

mutable struct Action
	id::String
	label::String
	handler::Function
	continuous::Bool
	continue_on_return::Bool
	scope::Union{Nothing, String}
	kwargs::Vector{Dict{String, Any}}
end

action(id, handler; label = id, continuous = false, continue_on_return = false, scope = nothing, kwargs = Dict{String, Any}[]) =
	Action(String(id), String(label), handler, Bool(continuous), Bool(continue_on_return),
		scope === nothing ? nothing : String(scope), [Dict{String, Any}(String(k) => v for (k, v) in pairs(item)) for item in kwargs])

function _action_payload(a::Action)
	d = Dict{String, Any}("id" => a.id, "label" => a.label)
	a.continuous && (d["continuous"] = true)
	a.scope === nothing || (d["scope"] = a.scope)
	isempty(a.kwargs) || (d["kwargs"] = a.kwargs)
	return d
end

mutable struct Chart
	id::String
	label::String
	color::String
	getter::Function
	series::Vector{Dict{String, Any}}
end

function chart(id, getter; label = id, color = "#228be6", series = nothing)
	sl = series === nothing ? [Dict{String, Any}("id" => String(id), "label" => String(label), "color" => color)] :
		 [Dict{String, Any}(String(k) => v for (k, v) in pairs(item)) for item in series]
	return Chart(String(id), String(label), String(color), getter, sl)
end

function _chart_payload(c::Chart)
	d = Dict{String, Any}("id" => c.id, "label" => c.label, "color" => c.color)
	# A one-series chart is represented by the group itself; data_list is only
	# for a real group of named series in canonical v0.3.
	(length(c.series) == 1 && String(c.series[1]["id"]) == c.id) || (d["data_list"] = c.series)
	return d
end

"""A declarative renderer monitor and its current-value getter."""
mutable struct Monitor
	id::String
	label::String
	render_hint::Union{Nothing, String}
	getter::Function
end

function monitor(id, getter; label = id, render_hint = nothing)
	return Monitor(
		String(id),
		String(label),
		render_hint === nothing ? nothing : String(render_hint),
		getter,
	)
end

function _monitor_payload(m::Monitor)
	payload = Dict{String, Any}("id" => m.id, "label" => m.label)
	m.render_hint === nothing || (payload["render_hint"] = m.render_hint)
	return payload
end

"""Explicit model-specific inverse hooks for scene restore/checkpoints."""
struct RestoreHooks
	projected::Function
	checkpoint_capture::Union{Nothing, Function}
end

restore_hooks(projected; checkpoint_capture = nothing) =
	RestoreHooks(projected, checkpoint_capture)

mutable struct Layer
	id::String
	type::String
	items::Function
	data::Union{Nothing, Function}
	dependency_layer_ids::Dict{String, String}
	item_key_fields::Vector{String}
	source_items::Union{Nothing, Function}
	item_projector::Union{Nothing, Function}
	item_id::Union{Nothing, Function}
	item_changed::Union{Nothing, Function}
	environment_type::Union{Nothing, String}
	last_items::Dict{Any, Dict{String, Any}}
	last_data::Any
end

function layer(id, type, items; data = nothing, dependency_layer_ids = Dict{String, String}(), item_key_fields = String[],
	source_items = nothing, projector = nothing, item_id = nothing, changed = nothing)
	return Layer(String(id), String(type), items, data,
		Dict(String(k) => String(v) for (k, v) in pairs(dependency_layer_ids)),
		String.(item_key_fields), source_items, projector, item_id, changed,
		nothing,
		Dict{Any, Dict{String, Any}}(), _UNSET)
end

function agents_layer(id, getagents = agents_getter; projector = autoagentprojector(), data = nothing,
	dependency_layer_ids = Dict{String, String}(), item_key_fields = ["id"],
	item_id = nothing, changed = nothing)
	# The containing environment is selected after this layer is built. Keep the
	# projector context-aware so `autoagentprojector()` follows that environment.
	l = layer(id, "agent", _empty_layer_items; data = data,
		dependency_layer_ids = dependency_layer_ids, item_key_fields = item_key_fields,
		source_items = getagents, item_id = item_id, changed = changed)
	project_item = if projector isa AutoAgentProjector
		(agent, _model) -> _project_autoagent(projector, agent; spatial = l.environment_type != "uniform")
	else
		(agent, model) -> _call1or2(projector, agent, model)
	end
	l.items = model -> [project_item(agent, model) for agent in getagents(model)]
	l.item_projector = project_item
	return l
end

grid_layer(id, items; data = nothing, item_key_fields = ["x", "y"]) = layer(id, "grid", items; data = data, item_key_fields = item_key_fields)
patch_layer(id, items; data = nothing, item_key_fields = ["x", "y"]) = layer(id, "patch", items; data = data, item_key_fields = item_key_fields)
edge_layer(id, items; data = nothing, dependency_layer_ids = Dict("agent" => "agents"), item_key_fields = ["source", "target"]) =
	layer(id, "edge", items; data = data, dependency_layer_ids = dependency_layer_ids, item_key_fields = item_key_fields)
_empty_layer_items(_model = nothing) = Any[]
trajectory_layer(id, items = _empty_layer_items; data = nothing, dependency_layer_ids = Dict("agent" => "agents"), item_key_fields = ["id"]) =
	layer(id, "trajectory", items; data = data, dependency_layer_ids = dependency_layer_ids, item_key_fields = item_key_fields)
background_layer(id = "background"; data = nothing) = layer(id, "background", _empty_layer_items; data = data)

mutable struct Environment
	id::String
	type::String
	layers::Vector{Layer}
end

function environment(id; type = "2d", layers = Layer[])
	e = Environment(String(id), String(type), collect(layers))
	for l in e.layers
		l.environment_type = e.type
	end
	return e
end

mutable struct Asset
	id::String
	hash::String
	mime::String
	size::Int
	label::Union{Nothing, String}
	data::Vector{UInt8}
end
