"""Create a projector from a dictionary, named tuple, struct, or Agents.jl agent.
Nested values are detached by default; `deep_copy=false` borrows them.
"""
function dictprojector(fields::Union{Nothing, AbstractVector} = nothing; rename = Dict{Any, Any}(), deep_copy = true)
	wanted = fields === nothing ? nothing : collect(fields)
	return SnapshotProjector(function (item)
			keys = wanted === nothing ? _public_fieldnames(item) : wanted
			out = Dict{String, Any}()
			for key in keys
				value = _getvalue(item, key)
				out[String(get(rename, key, key))] = value
			end
			return out
		end, deep_copy)
end

propertyprojector(fields...; rename = Dict{Any, Any}(), deep_copy = true) = dictprojector(collect(fields); rename = rename, deep_copy = deep_copy)

struct LiteralField
	value::Any
end

literal(value) = LiteralField(value)

function _projector_value(agent, selector)
	selector isa LiteralField && return selector.value
	selector isa Function && return selector(agent)
	selector isa Symbol || selector isa AbstractString || return selector
	current = agent
	for part in split(String(selector), ".")
		current = _getvalue(current, part)
	end
	return current
end

function _position_tuple(agent)
	pos = _getvalue(agent, :pos)
	pos === nothing && return nothing
	if pos isa Tuple || pos isa AbstractVector
		length(pos) >= 2 && return (pos[1], pos[2])
	end
	return nothing
end

"""Declarative projector configuration for generic/Agents.jl-style agents."""
struct AutoAgentProjector
	deep_copy::Bool
	id::Any
	x::Any
	y::Any
	color::Any
	size::Any
	icon::Any
	fields::Any
	data_fields::Any
end

"""Project one agent, optionally omitting spatial fields for a uniform environment."""
function _project_autoagent(projector::AutoAgentProjector, agent; spatial = true, deep_copy = projector.deep_copy)
	out = Dict{String, Any}("id" => _projector_value(agent, projector.id))
	if spatial
		pos = projector.x isa Function || projector.y isa Function ? nothing : _position_tuple(agent)
		if pos !== nothing
			out["x"], out["y"] = pos
		else
			out["x"] = _projector_value(agent, projector.x)
			out["y"] = _projector_value(agent, projector.y)
		end
		out["heading"] = something(_getvalue(agent, :heading), 0)
	end
	out["icon"] = projector.icon isa AbstractString ? projector.icon : _projector_value(agent, projector.icon)
	projector.color !== nothing && (out["color"] = projector.color isa AbstractString ? projector.color : _projector_value(agent, projector.color))
	projector.size !== nothing && (out["size"] = _projector_value(agent, projector.size))
	if projector.fields isa AbstractDict || projector.fields isa NamedTuple
		for (field, selector) in pairs(projector.fields)
			out[String(field)] = _projector_value(agent, selector)
		end
	else
		for field in projector.fields
			out[String(field)] = _getvalue(agent, field)
		end
	end
	if !isempty(projector.data_fields)
		out["data"] = Dict(String(field) => _getvalue(agent, field) for field in projector.data_fields)
	end
	return _own_projection!(out, deep_copy)
end

"""Project a generic/Agents.jl-style agent into TenSnap item fields.

When used with `agents_layer`, spatial fields are selected from the containing
environment: `uniform` environments omit `x`, `y`, and `heading`; `2d`
environments retain them. Direct projector calls retain the 2d behavior.
Nested output is independent unless `deep_copy=false` explicitly borrows it.
"""
function autoagentprojector(; id = :id, x = :x, y = :y, color = nothing, size = nothing,
	icon = "circle", fields = (), data_fields = (), deep_copy = true)
	return AutoAgentProjector(deep_copy, id, x, y, color, size, icon,
		fields isa AbstractDict || fields isa NamedTuple ? Dict(pairs(fields)) : collect(fields), collect(data_fields))
end

(projector::AutoAgentProjector)(agent) = _project_autoagent(projector, agent)
_projector_owns_values(p::AutoAgentProjector) = p.deep_copy
_configure_projector(p::AutoAgentProjector, deep_copy::Bool) = AutoAgentProjector(deep_copy, p.id, p.x, p.y, p.color, p.size, p.icon, p.fields, p.data_fields)

"""Return a best-effort agent iterable for Agents.jl and non-Agents.jl models."""
function agents_getter(model)
	if hasproperty(model, :agents)
		return getproperty(model, :agents)
	elseif hasproperty(model, :space) && hasproperty(getproperty(model, :space), :agents)
		return getproperty(getproperty(model, :space), :agents)
	elseif isdefined(Main, :allagents)
		return getfield(Main, :allagents)(model)
	else
		error("Cannot find agents on model. Pass an explicit getagents function to agents_layer, or expose model.agents/model.space.agents.")
	end
end
