"""Agent layers backed by entities, maps, and matrices."""

function agents_layer(id, getagents = agents_getter; projector = autoagentprojector(), data = nothing,
	dependency_layer_ids = Dict{String, String}(), item_key_fields = ["id"],
	item_id = nothing, changed = nothing, restore = nothing)
	# The containing environment is selected after this layer is built. Keep the
	# projector context-aware so `autoagentprojector()` follows that environment.
	l = layer(id, "agent", _empty_layer_items; data = data,
		dependency_layer_ids = dependency_layer_ids, item_key_fields = item_key_fields,
		source_items = getagents, item_id = item_id, changed = changed, restore = restore)
	project_item = if projector isa AutoAgentProjector
		(agent, _model) -> _project_autoagent(projector, agent; spatial = l.environment_type != "uniform")
	else
		(agent, model) -> _call1or2(projector, agent, model)
	end
	l.items = model -> [project_item(agent, model) for agent in getagents(model)]
	l.item_projector = project_item
	return l
end

function _source_id(key)
    key isa AbstractString && return key
    key isa Integer && !(key isa Bool) && abs(big(key)) <= 9007199254740991 && return key
    error("map agent keys must be strings or JSON-safe integers; otherwise provide encode_key")
end

function _source_field_value(spec, roots, args; shortcut = false)
    spec isa LiteralField && return spec.value
    spec isa Function && return spec(args...)
    if spec isa Symbol || (spec isa AbstractString && !shortcut)
        parts = split(String(spec), ".")
        rooted = haskey(roots, parts[1])
        current = rooted ? roots[parts[1]] : roots["value"]
        for part in (rooted ? parts[2:end] : parts)
            current = _getvalue(current, part)
        end
        return current
    end
    return spec
end

function _source_field_config(project, fields, color, icon, size)
    shortcuts = Dict{String, Any}()
    color === nothing || (shortcuts["color"] = color)
    icon === nothing || (shortcuts["icon"] = icon)
    size === nothing || (shortcuts["size"] = size)
    project === nothing || (fields === nothing && isempty(shortcuts)) ||
        error("use project or fields and visual shortcuts, not both")
    declared = fields === nothing ? Dict{String, Any}() : Dict{String, Any}(String(k) => v for (k, v) in pairs(fields))
    for name in keys(shortcuts)
        haskey(declared, name) && error("visual field declared twice: $name")
    end
    return declared, shortcuts
end

function _source_project_fields(fields, shortcuts, roots, args)
    item = Dict{String, Any}()
    for (name, spec) in fields
        item[name] = _source_field_value(spec, roots, args)
    end
    for (name, spec) in shortcuts
        item[name] = _source_field_value(spec, roots, args; shortcut = true)
    end
    return item
end

"""Bind map entries as agent items. False values remain present; absent keys do not."""
function map_agent_layer(id, source; project = nothing, fields = nothing,
    color = nothing, icon = nothing, size = nothing,
    encode_key = _source_id, decode_key = identity, decode_value = identity,
    replace = nothing, changed = nothing, data = nothing)
    declared, shortcuts = _source_field_config(project, fields, color, icon, size)
    entries = model -> begin
        result = sort!(collect(pairs(source(model)));
            by = pair -> string(typeof(encode_key(first(pair))), ":", encode_key(first(pair))))
        ids = [(typeof(encode_key(first(pair))), encode_key(first(pair))) for pair in result]
        length(unique(ids)) == length(ids) || error("map source has duplicate encoded IDs")
        result
    end
    project_entry = (entry, model) -> begin
        key, value = entry
        projected = project === nothing ?
            _source_project_fields(declared, shortcuts,
                Dict("model" => model, "key" => key, "value" => value), (model, key, value)) :
            project(model, key, value)
        item = Dict{String, Any}(String(k) => v for (k, v) in pairs(projected))
        item["id"] = encode_key(key)
        payload = get(item, "data", Dict{String, Any}())
        payload isa AbstractDict || error("map agent data must be a dictionary")
        item["data"] = merge(Dict{String, Any}(String(k) => v for (k, v) in pairs(payload)), Dict("value" => value))
        item
    end
    prepare = layer -> begin
        result = Dict{Any, Any}()
        for item in _restore_items(layer)
            haskey(item, "id") || error("map item is missing id")
            key = decode_key(item["id"])
            encode_key(key) == item["id"] || error("map item id is not canonical")
            haskey(result, key) && error("duplicate map item id")
            payload = get(item, "data", nothing)
            payload isa AbstractDict && haskey(payload, "value") || error("map item is missing data.value")
            result[key] = decode_value(payload["value"])
        end
        result
    end
    inverse = (
        validate = (layer, _model) -> (prepare(layer); nothing),
        metadata = (_metadata, _model) -> nothing,
        replace = (items, model) -> begin
            values = prepare(Dict("items" => items))
            if replace === nothing
                target = source(model)
                empty!(target)
                merge!(target, values)
            else
                replace(model, values)
            end
        end,
    )
    l = layer(id, "agent", model -> [project_entry(entry, model) for entry in entries(model)];
        data = data, item_key_fields = ["id"], restore = inverse)
    l.source_items = entries
    l.item_projector = project_entry
    l.item_id = (entry, _model) -> encode_key(first(entry))
    changed === nothing || (l.item_changed = (entry, model) -> changed(model, first(entry), last(entry)))
    return l
end

"""Bind a matrix with explicit axis meaning. `:row_col` uses A[row,col],
`:x_y` uses A[x,y]. Both expose 1-based row/col to callbacks and zero-based
renderer coordinates with row one at the top.
"""
function matrix_agent_layer(id, source; orientation::Symbol,
    project = nothing, fields = nothing, color = nothing, icon = nothing, size = nothing,
    decode_value = identity, replace = nothing, sparse = false,
    sparse_default = nothing, changed = nothing, data = nothing)
    orientation in (:row_col, :x_y) || error("orientation must be :row_col or :x_y")
    declared, shortcuts = _source_field_config(project, fields, color, icon, size)
    shape = model -> begin
        matrix = source(model)
        ndims(matrix) == 2 || error("matrix source must have two dimensions")
        orientation == :row_col ? Base.size(matrix) : reverse(Base.size(matrix))
    end
    read = (model, row, col) -> orientation == :row_col ? source(model)[row, col] : source(model)[col, row]
    cells = model -> begin
        height, width = shape(model)
        ((row, col, read(model, row, col)) for row in 1:height for col in 1:width
            if !sparse || read(model, row, col) != sparse_default)
    end
    project_cell = (cell, model) -> begin
        row, col, value = cell
        height, _ = shape(model)
        projected = project === nothing ?
            _source_project_fields(declared, shortcuts,
                Dict("model" => model, "key" => (row, col), "row" => row,
                    "col" => col, "value" => value), (model, row, col, value)) :
            project(model, row, col, value)
        item = Dict{String, Any}(String(k) => v for (k, v) in pairs(projected))
        item["id"] = "cell:$(row-1):$(col-1)"
        item["x"] = col - 1
        item["y"] = height - row
        payload = get(item, "data", Dict{String, Any}())
        payload isa AbstractDict || error("matrix agent data must be a dictionary")
        item["data"] = merge(Dict{String, Any}(String(k) => v for (k, v) in pairs(payload)), Dict("value" => value))
        item
    end
    metadata = model -> begin
        height, width = shape(model)
        base = data === nothing ? Dict{String, Any}() : Dict{String, Any}(String(k) => v for (k, v) in pairs(data(model)))
        merge(base, Dict("width" => width, "height" => height, "coord_offset" => "int"))
    end
    incoming_metadata = Ref{Any}(nothing)
    prepare = layer -> begin
        metadata = get(layer, "metadata", nothing)
        metadata isa AbstractDict || error("matrix restore requires metadata")
        width, height = get(metadata, "width", nothing), get(metadata, "height", nothing)
        width isa Int && height isa Int && width >= 0 && height >= 0 || error("invalid matrix shape")
        get(metadata, "coord_offset", nothing) == "int" || error("matrix coord_offset must be int")
        values = Matrix{Any}(undef, height, width)
        fill!(values, sparse_default)
        seen = Set{Tuple{Int, Int}}()
        for item in _restore_items(layer)
            matched = match(r"^cell:(0|[1-9][0-9]*):(0|[1-9][0-9]*)$", string(get(item, "id", "")))
            matched === nothing && error("invalid matrix cell id")
            row, col = parse(Int, matched[1]) + 1, parse(Int, matched[2]) + 1
            1 <= row <= height && 1 <= col <= width && !((row, col) in seen) || error("duplicate or out-of-bounds cell")
            get(item, "x", nothing) == col - 1 && get(item, "y", nothing) == height - row || error("matrix coordinates do not match id")
            payload = get(item, "data", nothing)
            payload isa AbstractDict && haskey(payload, "value") || error("matrix item is missing data.value")
            value = decode_value(payload["value"])
            sparse && value == sparse_default && error("sparse default must be omitted")
            values[row, col] = value
            push!(seen, (row, col))
        end
        !sparse && length(seen) != width * height && error("dense matrix is missing cells")
        orientation == :row_col ? values : permutedims(values)
    end
    inverse = (
        validate = (layer, _model) -> (prepare(layer); incoming_metadata[] = layer["metadata"]; nothing),
        metadata = (_metadata, _model) -> nothing,
        replace = (items, model) -> begin
            snapshot = Dict("items" => items, "metadata" => incoming_metadata[])
            values = prepare(snapshot)
            if replace === nothing
                target = source(model)
                Base.size(target) == Base.size(values) || error("matrix shape changed; supply replace")
                copyto!(target, values)
            else
                replace(model, values)
            end
        end,
    )
    l = layer(id, "agent", model -> [project_cell(cell, model) for cell in cells(model)];
        data = metadata, item_key_fields = ["id"], restore = inverse)
    l.source_items = cells
    l.item_projector = project_cell
    l.item_id = (cell, _model) -> "cell:$(cell[1]-1):$(cell[2]-1)"
    changed === nothing || (l.item_changed = (cell, model) -> changed(model, cell[1], cell[2], cell[3]))
    return l
end
