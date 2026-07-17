"""Create a projector from a dictionary, named tuple, struct, or Agents.jl agent."""
function dictprojector(fields::Union{Nothing, AbstractVector} = nothing; rename = Dict{Any, Any}())
	wanted = fields === nothing ? nothing : collect(fields)
	return function (item)
		keys = wanted === nothing ? _public_fieldnames(item) : wanted
		out = Dict{String, Any}()
		for key in keys
			value = _getvalue(item, key)
			out[String(get(rename, key, key))] = _jsonable(value)
		end
		return out
	end
end

propertyprojector(fields...; rename = Dict{Any, Any}()) = dictprojector(collect(fields); rename = rename)

_projector_value(agent, selector) = selector isa Function ? selector(agent) : _getvalue(agent, selector)

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
	id
	x
	y
	color
	size
	icon
	fields
	data_fields
end

"""Project one agent, optionally omitting spatial fields for a uniform environment."""
function _project_autoagent(projector::AutoAgentProjector, agent; spatial = true)
	out = Dict{String, Any}("id" => _jsonable(_projector_value(agent, projector.id)))
	if spatial
		pos = projector.x isa Function || projector.y isa Function ? nothing : _position_tuple(agent)
		if pos !== nothing
			out["x"], out["y"] = pos
		else
			out["x"] = _jsonable(_projector_value(agent, projector.x))
			out["y"] = _jsonable(_projector_value(agent, projector.y))
		end
		out["heading"] = _jsonable(something(_getvalue(agent, :heading), 0))
	end
	out["icon"] = projector.icon
	projector.color !== nothing && (out["color"] = _jsonable(_projector_value(agent, projector.color)))
	projector.size !== nothing && (out["size"] = _jsonable(_projector_value(agent, projector.size)))
	for field in projector.fields
		out[String(field)] = _jsonable(_getvalue(agent, field))
	end
	if !isempty(projector.data_fields)
		out["data"] = Dict(String(field) => _jsonable(_getvalue(agent, field)) for field in projector.data_fields)
	end
	return out
end

"""Project a generic/Agents.jl-style agent into TenSnap item fields.

When used with `agents_layer`, spatial fields are selected from the containing
environment: `uniform` environments omit `x`, `y`, and `heading`; `2d`
environments retain them. Direct projector calls retain the 2d behavior.
"""
function autoagentprojector(; id = :id, x = :x, y = :y, color = nothing, size = nothing,
	icon = "circle", fields = (), data_fields = ())
	return AutoAgentProjector(id, x, y, color, size, icon, collect(fields), collect(data_fields))
end

(projector::AutoAgentProjector)(agent) = _project_autoagent(projector, agent)

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
