"""Normalize layer-local inverse callbacks without adding a public restore type."""
function _normalize_layer_restore(restore)
    restore === nothing && return nothing
    gethook(key) = hasproperty(restore, key) ? getproperty(restore, key) : nothing
    spec = (create = gethook(:create), update = gethook(:update),
        delete = gethook(:delete), replace = gethook(:replace),
        metadata = gethook(:metadata), validate = gethook(:validate))
    if spec.replace !== nothing
        all(x -> x === nothing, (spec.create, spec.update, spec.delete)) ||
            error("replace cannot be combined with create/update/delete")
    elseif any(x -> x !== nothing, (spec.create, spec.update, spec.delete))
        all(x -> x !== nothing, (spec.create, spec.update, spec.delete)) ||
            error("collection restore requires create, update, and delete")
    else
        spec.metadata !== nothing || error("layer restore needs item or metadata callbacks")
    end
    return spec
end

struct _ProjectedRestore
    time::Union{Nothing, Function}
    validate::Union{Nothing, Function}
    after_apply::Union{Nothing, Function}
end

scene_restore(; time = nothing, validate = nothing, after_apply = nothing) =
    _ProjectedRestore(time, validate, after_apply)

function _restore_dict(value)
	value isa AbstractDict || error("restore entry must be an object")
	return Dict{String, Any}(String(k) => v for (k, v) in pairs(value))
end

function _restore_items(layer)
	value = get(layer, "items", Any[])
	value isa AbstractVector || error("restored layer items must be an array")
	return [_restore_dict(item) for item in value]
end

function _restore_key(item, fields)
	isempty(fields) && error("restore keys cannot be empty")
	values = Any[]
	for field in fields
		haskey(item, field) || error("missing item key: $(field)")
		value = item[field]
		(value isa AbstractString || value isa Number || value isa Bool) ||
			error("item key must be scalar: $(field)")
		push!(values, value)
	end
	return Tuple(values)
end

function _restore_index(items, fields)
	result = Dict{Tuple, Dict{String, Any}}()
	for item in items
		key = _restore_key(item, fields)
		haskey(result, key) && error("duplicate item key: $(key)")
		result[key] = item
	end
	return result
end

function _restore_order(entries)
	by_name = Dict(entry.name => entry for entry in entries)
	visited = Set{String}()
	active = Set{String}()
	ordered = Any[]
	function visit(name)
		name in visited && return
		name in active && error("cyclic layer dependency: $(name)")
		push!(active, name)
		entry = by_name[name]
		for dependency in values(entry.layer.dependency_layer_ids)
			other = entry.env_id * "/" * dependency
			haskey(by_name, other) && visit(other)
		end
		delete!(active, name)
		push!(visited, name)
		push!(ordered, entry)
	end
	for entry in entries
		visit(entry.name)
	end
	return ordered
end

function _prepare_projected_restore(s, payload)
	plan = s.restore_plan
	plan === nothing && error("projected restore is not configured")
	seen_envs = Set{String}()
	entries = Any[]
	for raw_env in get(payload, "envs", Any[])
		env = _restore_dict(raw_env)
		id = String(env["id"])
		id in seen_envs && error("duplicate environment: $(id)")
		push!(seen_envs, id)
		haskey(s.environments, id) || error("unknown environment: $(id)")
		declared = s.environments[id]
		env["type"] == declared.type || error("environment topology mismatch: $(id)")
		layers = [_restore_dict(layer) for layer in env["layers"]]
		length(layers) == length(declared.layers) || error("layer topology mismatch: $(id)")
		seen_layers = Set{String}()
		for layer in layers
			layer_id = String(layer["layer_id"])
			layer_id in seen_layers && error("duplicate layer: $(id)/$(layer_id)")
			push!(seen_layers, layer_id)
			index = findfirst(candidate -> candidate.id == layer_id, declared.layers)
			index === nothing && error("unknown layer: $(id)/$(layer_id)")
			declared_layer = declared.layers[index]
			layer["layer_type"] == declared_layer.type || error("layer type mismatch: $(id)/$(layer_id)")
			deps = Dict(String(k) => String(v) for (k, v) in pairs(get(layer, "dependency_layer_ids", Dict())))
			deps == declared_layer.dependency_layer_ids || error("layer dependencies mismatch: $(id)/$(layer_id)")
			name = id * "/" * layer_id
			declared_layer.restore === nothing && error("no restore declaration for $(name)")
			spec = declared_layer.restore
			haskey(layer, "metadata") && spec.metadata === nothing &&
				error("no metadata restore declaration for $(name)")
			items = _restore_items(layer)
			if spec.replace === nothing && spec.create === nothing && !isempty(items)
				error("metadata-only layer $(name) has items")
			end
			if spec.replace === nothing && spec.create === nothing && declared_layer.type in ("agent", "edge")
				error("item-bearing layer $(name) needs an item inverse")
			end
			if spec.replace === nothing && spec.create !== nothing
				_restore_index(items, declared_layer.item_key_fields)
				_restore_index(_layer_items(declared_layer, s.model), declared_layer.item_key_fields)
			end
			spec.validate === nothing || _call1or2(spec.validate, layer, s.model)
			push!(entries, (name = name, env_id = id, layer = declared_layer,
				spec = spec, inbound = layer, items = items))
		end
	end
	seen_params = Set{String}()
	for raw_change in get(payload, "parameters", Any[])
		change = _restore_dict(raw_change)
		id = String(change["id"])
		id in seen_params && error("duplicate parameter: $(id)")
		push!(seen_params, id)
		haskey(s.parameters, id) || error("unknown parameter: $(id)")
		p = s.parameters[id]
		p.setter === nothing && error("parameter $(id) has no setter")
		value = change["value"]
		if p.type == "number"
			(value isa Number && !(value isa Bool) && isfinite(value)) || error("parameter $(id) requires a finite number")
			p.min === nothing || value >= p.min || error("parameter $(id) is below minimum")
			p.max === nothing || value <= p.max || error("parameter $(id) is above maximum")
		elseif p.type == "boolean"
			value isa Bool || error("parameter $(id) requires a boolean")
		elseif p.type == "string"
			value isa AbstractString || error("parameter $(id) requires a string")
		elseif p.type == "enum"
			p.options !== nothing && value in p.options || error("parameter $(id) has unknown option")
		end
	end
	plan.validate === nothing || _call1or2(plan.validate, payload, s.model)
	return _restore_order(entries)
end

_validate_projected_restore(s, payload) = (_prepare_projected_restore(s, payload); nothing)

function _apply_projected_restore!(s, payload)
	ordered = _prepare_projected_restore(s, payload)
	for raw_change in get(payload, "parameters", Any[])
		change = _restore_dict(raw_change)
		_set_parameter!(s.parameters[String(change["id"])], change["value"], s.model)
		s.parameters[String(change["id"])].value = _param_value(s.parameters[String(change["id"])], s.model)
	end
	for entry in ordered
		if haskey(entry.inbound, "metadata")
			_call1or2(entry.spec.metadata, _restore_dict(entry.inbound["metadata"]), s.model)
		end
	end
	current_by_name = Dict{String, Any}()
	for entry in reverse(ordered)
		(entry.spec.replace !== nothing || entry.spec.create === nothing) && continue
		current_items = _layer_items(entry.layer, s.model)
		current = _restore_index(current_items, entry.layer.item_key_fields)
		incoming = _restore_index(entry.items, entry.layer.item_key_fields)
		current_by_name[entry.name] = current
		for key in keys(current)
			haskey(incoming, key) || _call1or2(entry.spec.delete,
				Dict(field => current[key][field] for field in entry.layer.item_key_fields), s.model)
		end
	end
	for entry in ordered
		entry.spec.create === nothing && entry.spec.replace === nothing && continue
		if entry.spec.replace !== nothing
			_call1or2(entry.spec.replace, entry.items, s.model)
			continue
		end
		current = current_by_name[entry.name]
		for item in entry.items
			key = _restore_key(item, entry.layer.item_key_fields)
			callback = haskey(current, key) ? entry.spec.update : entry.spec.create
			_call1or2(callback, item, s.model)
		end
	end
	haskey(payload, "time") && s.restore_plan.time !== nothing && _call1or2(s.restore_plan.time, payload["time"], s.model)
	s.restore_plan.after_apply === nothing || _call0or1(s.restore_plan.after_apply, s.model)
	return nothing
end
