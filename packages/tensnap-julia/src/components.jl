mutable struct Parameter
	id::String
	label::String
	type::String
	value::Any
	min::Any
	max::Any
	step::Any
	options::Union{Nothing, Vector{Any}}
	getter::Union{Nothing, Function}
	setter::Union{Nothing, Function}
end

function parameter(id; label = id, type = "number", value = nothing, min = nothing, max = nothing,
	step = nothing, options = nothing, getter = nothing, setter = nothing)
	return Parameter(String(id), String(label), String(type), value, min, max, step,
		options === nothing ? nothing : collect(options), getter, setter)
end

function _param_value(p::Parameter, model = nothing)
	p.getter === nothing ? p.value : _call0or1(p.getter, model)
end

function _param_payload(p::Parameter, model = nothing)
	d = Dict{String, Any}("id" => p.id, "label" => p.label, "type" => p.type, "value" => _jsonable(_param_value(p, model)), "allowRuntimeChange" => true)
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

mutable struct Action
	id::String
	label::String
	handler::Function
	continuous::Bool
	continue_on_return::Bool
end

action(id, handler; label = id, continuous = false, continue_on_return = false) =
	Action(String(id), String(label), handler, Bool(continuous), Bool(continue_on_return))

_action_payload(a::Action) = Dict("id" => a.id, "label" => a.label, "continuous" => a.continuous, "allowRuntimeChange" => true)

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

_chart_payload(c::Chart) = Dict("id" => c.id, "label" => c.label, "color" => c.color, "dataList" => c.series)

mutable struct Layer
	id::String
	type::String
	items::Function
	data::Union{Nothing, Function}
	dependency_layer_ids::Dict{String, String}
	item_key_fields::Vector{String}
	last_items::Dict{Any, Dict{String, Any}}
	last_data::Any
end

function layer(id, type, items; data = nothing, dependency_layer_ids = Dict{String, String}(), item_key_fields = String[])
	return Layer(String(id), String(type), items, data,
		Dict(String(k) => String(v) for (k, v) in pairs(dependency_layer_ids)),
		String.(item_key_fields), Dict{Any, Dict{String, Any}}(), _UNSET)
end

function agents_layer(id, getagents = agents_getter; projector = autoagentprojector(), data = nothing,
	dependency_layer_ids = Dict{String, String}(), item_key_fields = ["id"])
	items = model -> [projector(a) for a in getagents(model)]
	return layer(id, "agent", items; data = data, dependency_layer_ids = dependency_layer_ids,
		item_key_fields = item_key_fields)
end

grid_layer(id, items; data = nothing, item_key_fields = ["x", "y"]) = layer(id, "grid", items; data = data, item_key_fields = item_key_fields)
patch_layer(id, items; data = nothing, item_key_fields = ["x", "y"]) = layer(id, "patch", items; data = data, item_key_fields = item_key_fields)
edge_layer(id, items; data = nothing, dependency_layer_ids = Dict{String, String}(), item_key_fields = ["source", "target"]) =
	layer(id, "edge", items; data = data, dependency_layer_ids = dependency_layer_ids, item_key_fields = item_key_fields)

mutable struct Environment
	id::String
	type::String
	layers::Vector{Layer}
end

environment(id; type = "2d", layers = Layer[]) = Environment(String(id), String(type), collect(layers))

mutable struct Asset
	id::String
	hash::String
	mime::String
	size::Int
	label::Union{Nothing, String}
	data::Vector{UInt8}
end
