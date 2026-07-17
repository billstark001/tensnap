function add_environment!(s::Scenario, e::Environment)
	s.environments[e.id] = e
	for l in e.layers
		l.environment_type = e.type
	end
	_broadcast(s, "env_create", Dict("id" => e.id, "type" => e.type))
	for l in _ordered_layers(e)
		_broadcast_layer_full(s, e.id, l)
	end
	return e
end

function remove_environment!(s::Scenario, id)
	sid = String(id)
	existed = pop!(s.environments, sid, nothing) !== nothing
	existed && _broadcast(s, "env_delete", Dict("id" => sid))
	return existed
end

add_layer!(e::Environment, l::Layer) = (l.environment_type = e.type; push!(e.layers, l); l)

function _ordered_layers(e::Environment)
	by_id = Dict(l.id => l for l in e.layers)
	ordered = Layer[]
	visiting = Set{String}()
	visited = Set{String}()

	function visit(l::Layer)
		l.id in visited && return
		l.id in visiting && return
		push!(visiting, l.id)
		for dep_id in values(l.dependency_layer_ids)
			haskey(by_id, dep_id) && visit(by_id[dep_id])
		end
		delete!(visiting, l.id)
		push!(visited, l.id)
		push!(ordered, l)
	end

	for l in e.layers
		visit(l)
	end
	return ordered
end

function add_layer!(s::Scenario, env_id, l::Layer)
	e = s.environments[String(env_id)]
	l.environment_type = e.type
	existing = findfirst(x -> x.id == l.id, e.layers)
	if existing === nothing
		push!(e.layers, l)
	else
		e.layers[existing] = l
	end
	_broadcast_layer_full(s, e.id, l)
	return l
end

function remove_layer!(s::Scenario, env_id, layer_id)
	e = s.environments[String(env_id)]
	sid = String(layer_id)
	before = length(e.layers)
	filter!(l -> l.id != sid, e.layers)
	existed = length(e.layers) != before
	existed && _broadcast(s, "env_layer_delete", Dict("env_id" => e.id, "layer_id" => sid))
	return existed
end

function _normalize_layer_item(item)
	return Dict(String(k) => _jsonable(v) for (k, v) in pairs(item))
end

function _layer_items(l::Layer, model)
	return [_normalize_layer_item(item) for item in _call0or1(l.items, model)]
end

function _layer_data(l::Layer, model)
	l.data === nothing && return nothing
	value = _jsonable(_call0or1(l.data, model))
	return value isa AbstractDict ? Dict(String(k) => _jsonable(v) for (k, v) in pairs(value)) : value
end

function _layer_payload(env_id::String, l::Layer, model; data = _UNSET)
	d = Dict{String, Any}("env_id" => env_id, "layer_id" => l.id, "layer_type" => l.type)
	isempty(l.dependency_layer_ids) || (d["dependency_layer_ids"] = l.dependency_layer_ids)
	data === _UNSET && (data = _layer_data(l, model))
	data === nothing || (d["metadata"] = data)
	return d
end

function _remember_layer_data!(l::Layer, model)
	l.last_data = _layer_data(l, model)
	return l.last_data
end

function _item_key_fields(l::Layer, item::AbstractDict)
	!isempty(l.item_key_fields) && return l.item_key_fields
	for candidate in (("id",), ("name",), ("uid",), ("source", "target"), ("x", "y"))
		all(k -> haskey(item, k), candidate) && return collect(candidate)
	end
	return sort!(collect(String.(keys(item))))
end

function _item_key(l::Layer, item::AbstractDict)
	fields = _item_key_fields(l, item)
	return Tuple(get(item, field, nothing) for field in fields)
end

function _item_delete_payload(l::Layer, item::AbstractDict)
	fields = _item_key_fields(l, item)
	if length(fields) == 1 && fields[1] == "id"
		return get(item, "id", nothing)
	end
	return Dict(field => get(item, field, nothing) for field in fields)
end

function _item_update_payload(l::Layer, previous::AbstractDict, item::AbstractDict)
	fields = _item_key_fields(l, item)
	payload = Dict{String, Any}()
	for key in union(keys(previous), keys(item))
		if !haskey(item, key)
			payload[String(key)] = nothing
		elseif !haskey(previous, key) || previous[key] != item[key]
			payload[String(key)] = item[key]
		end
	end
	for field in fields
		payload[field] = get(item, field, nothing)
	end
	return payload
end

function _remember_layer_items!(l::Layer, items)
	l.last_items = Dict{Any, Dict{String, Any}}(_item_key(l, item) => item for item in items)
	return items
end

function _has_incremental_item_source(l::Layer)
	return l.source_items !== nothing && l.item_projector !== nothing &&
		   l.item_id !== nothing && l.item_changed !== nothing
end

function _project_incremental_item(l::Layer, item, model)
	return _normalize_layer_item(_call1or2(l.item_projector, item, model))
end

function _incremental_item_key(l::Layer, item, model)
	value = _jsonable(_call1or2(l.item_id, item, model))
	isempty(l.item_key_fields) && return value
	value isa Tuple && return value
	value isa AbstractVector && return Tuple(value)
	return (value,)
end

function _layer_item_deltas_incremental!(l::Layer, model)
	raw_items = _call0or1(l.source_items, model)
	previous = l.last_items
	seen = Set{Any}()
	creates = Dict{String, Any}[]
	updates = Dict{String, Any}[]
	for item in raw_items
		key = _incremental_item_key(l, item, model)
		push!(seen, key)
		if !haskey(previous, key)
			projected = _project_incremental_item(l, item, model)
			previous[key] = projected
			push!(creates, projected)
		elseif Bool(_call1or2(l.item_changed, item, model))
			projected = _project_incremental_item(l, item, model)
			previous[key] != projected && push!(updates, _item_update_payload(l, previous[key], projected))
			previous[key] = projected
		end
	end
	deletes = Any[]
	for key in collect(keys(previous))
		key in seen && continue
		push!(deletes, _item_delete_payload(l, previous[key]))
		delete!(previous, key)
	end
	return creates, updates, deletes
end

function _layer_item_deltas!(l::Layer, model)
	_has_incremental_item_source(l) && return _layer_item_deltas_incremental!(l, model)
	items = _layer_items(l, model)
	previous = l.last_items
	seen = Set{Any}()
	creates = Dict{String, Any}[]
	updates = Dict{String, Any}[]
	for item in items
		key = _item_key(l, item)
		push!(seen, key)
		if !haskey(previous, key)
			push!(creates, item)
		elseif previous[key] != item
			push!(updates, _item_update_payload(l, previous[key], item))
		end
		previous[key] = item
	end
	deletes = Any[]
	for key in collect(keys(previous))
		key in seen && continue
		push!(deletes, _item_delete_payload(l, previous[key]))
		delete!(previous, key)
	end
	return creates, updates, deletes
end

function _broadcast_layer_full(s::Scenario, env_id::String, l::Layer; ws = nothing)
	data = _layer_data(l, s.model)
	_send_or_broadcast(s, ws, "env_layer_create", _layer_payload(env_id, l, s.model; data = data))
	l.last_data = data
	items = _remember_layer_items!(l, _layer_items(l, s.model))
	isempty(items) || _send_or_broadcast(s, ws, "item_create", Dict("env_id" => env_id, "layer_id" => l.id, "items" => items))
	return items
end

function _find_layer(s::Scenario, env_id, layer_id)
	e = get(s.environments, String(env_id), nothing)
	e === nothing && return nothing
	idx = findfirst(l -> l.id == String(layer_id), e.layers)
	idx === nothing ? nothing : e.layers[idx]
end

function _remember_manual_creates!(l::Layer, items)
	for item in items
		l.last_items[_item_key(l, item)] = item
	end
	return items
end

function _remember_manual_updates!(l::Layer, items)
	for item in items
		key = _item_key(l, item)
		l.last_items[key] = haskey(l.last_items, key) ? merge(l.last_items[key], item) : item
	end
	return items
end

function _manual_delete_key(l::Layer, item)
	if item isa AbstractDict
		normalized = Dict(String(k) => _jsonable(v) for (k, v) in pairs(item))
		return _item_key(l, normalized)
	end
	fields = isempty(l.item_key_fields) ? ["id"] : l.item_key_fields
	return length(fields) == 1 ? (_jsonable(item),) : Tuple(_jsonable(v) for v in item)
end

function _remember_manual_deletes!(l::Layer, items)
	for item in items
		pop!(l.last_items, _manual_delete_key(l, item), nothing)
	end
	return items
end

function create_items!(s::Scenario, env_id, layer_id, items)
	payload_items = [Dict(String(k) => _jsonable(v) for (k, v) in pairs(item)) for item in items]
	l = _find_layer(s, env_id, layer_id)
	l === nothing || _remember_manual_creates!(l, payload_items)
	_broadcast(s, "item_create", Dict("env_id" => String(env_id), "layer_id" => String(layer_id), "items" => payload_items))
	return payload_items
end

function update_items!(s::Scenario, env_id, layer_id, items)
	payload_items = [Dict(String(k) => _jsonable(v) for (k, v) in pairs(item)) for item in items]
	l = _find_layer(s, env_id, layer_id)
	l === nothing || _remember_manual_updates!(l, payload_items)
	_broadcast(s, "item_update", Dict("env_id" => String(env_id), "layer_id" => String(layer_id), "items" => payload_items))
	return payload_items
end

function delete_items!(s::Scenario, env_id, layer_id, items)
	payload_items = [_jsonable(item) for item in items]
	l = _find_layer(s, env_id, layer_id)
	l === nothing || _remember_manual_deletes!(l, payload_items)
	_broadcast(s, "item_delete", Dict("env_id" => String(env_id), "layer_id" => String(layer_id), "items" => payload_items))
	return payload_items
end

function replace_layer_items!(s::Scenario, env_id, layer_id)
	e = s.environments[String(env_id)]
	l = only(filter(layer -> layer.id == String(layer_id), e.layers))
	creates, updates, deletes = _layer_item_deltas!(l, s.model)
	isempty(creates) || _broadcast(s, "item_create", Dict("env_id" => e.id, "layer_id" => l.id, "items" => creates))
	isempty(updates) || _broadcast(s, "item_update", Dict("env_id" => e.id, "layer_id" => l.id, "items" => updates))
	isempty(deletes) || _broadcast(s, "item_delete", Dict("env_id" => e.id, "layer_id" => l.id, "items" => deletes))
	return (creates = creates, updates = updates, deletes = deletes)
end

function _layer_data_delta!(l::Layer, model)
	data = _layer_data(l, model)
	if l.last_data === _UNSET
		l.last_data = data
		return nothing
	end
	if data != l.last_data
		l.last_data = data
		return data === nothing ? Dict{String, Any}() : data
	end
	return nothing
end
