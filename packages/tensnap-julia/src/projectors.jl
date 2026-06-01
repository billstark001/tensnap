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

"""Project a generic/Agents.jl-style agent into TenSnap item fields."""
function autoagentprojector(; id = :id, x = :x, y = :y, color = nothing, size = nothing, icon = "circle", fields = ())
	return function (agent)
		out = Dict{String, Any}()
		out["id"] = _jsonable(_projector_value(agent, id))
		pos = x isa Function || y isa Function ? nothing : _position_tuple(agent)
		if pos !== nothing
			out["x"], out["y"] = pos
		else
			out["x"] = _jsonable(_projector_value(agent, x))
			out["y"] = _jsonable(_projector_value(agent, y))
		end
		out["heading"] = _jsonable(something(_getvalue(agent, :heading), 0))
		out["icon"] = icon
		color !== nothing && (out["color"] = _jsonable(_projector_value(agent, color)))
		size !== nothing && (out["size"] = _jsonable(_projector_value(agent, size)))
		for f in fields
			out[String(f)] = _jsonable(_getvalue(agent, f))
		end
		return out
	end
end

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
