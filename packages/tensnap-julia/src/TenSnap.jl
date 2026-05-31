module TenSnap

using Base64
using Dates
using HTTP
using JSON3
using SHA
using UUIDs

export Scenario, Parameter, Action, Chart, Environment, Layer
export add_parameter!, add_action!, add_chart!, add_environment!, add_layer!, register_model!
export remove_parameter!, remove_action!, remove_chart!, remove_environment!, remove_layer!
export create_items!, update_items!, delete_items!, replace_layer_items!, publish_asset!, delete_asset!, request_screenshot!
export run!, step!, reset!, sync!, clear_charts!, log!
export parameter, action, chart, environment, layer, agents_layer, grid_layer, patch_layer, edge_layer
export dictprojector, propertyprojector, autoagentprojector, agents_getter

const ACTION_START = "start"
const ACTION_STEP = "step"
const ACTION_RESET = "reset"

const SERVER_MESSAGE_TYPES = Set([
    "metadata_update", "state_sync_begin", "state_sync_end", "action_end",
    "action_create", "action_update", "action_delete", "env_create", "env_delete",
    "env_layer_create", "env_layer_update", "env_layer_delete", "item_create",
    "item_update", "item_delete", "param_create", "param_update", "param_delete",
    "param_sync", "chart_create", "chart_update", "chart_delete", "asset_meta",
    "asset_data", "asset_delete", "screenshot_request", "log", "error",
])

_jsonable(x) = x
_jsonable(x::Symbol) = String(x)
_jsonable(x::Tuple) = collect(x)
_jsonable(x::NamedTuple) = Dict(String(k) => _jsonable(v) for (k, v) in pairs(x))
_jsonable(x::AbstractDict) = Dict(String(k) => _jsonable(v) for (k, v) in pairs(x))
_jsonable(x::AbstractArray) = [_jsonable(v) for v in x]

function _public_fieldnames(x)
    x isa AbstractDict && return keys(x)
    x isa NamedTuple && return keys(x)
    x isa Type && return fieldnames(x)
    return fieldnames(typeof(x))
end

function _getvalue(obj, key)
    if obj isa AbstractDict
        return get(obj, key, get(obj, Symbol(key), nothing))
    end
    sym = key isa Symbol ? key : Symbol(key)
    return hasproperty(obj, sym) ? getproperty(obj, sym) : nothing
end

function _setvalue!(obj, key, value)
    if obj isa AbstractDict
        obj[key] = value
    else
        setproperty!(obj, key isa Symbol ? key : Symbol(key), value)
    end
    return value
end

"""Create a projector from a dictionary, named tuple, struct, or Agents.jl agent."""
function dictprojector(fields::Union{Nothing,AbstractVector}=nothing; rename=Dict{Any,Any}())
    wanted = fields === nothing ? nothing : collect(fields)
    return function (item)
        keys = wanted === nothing ? _public_fieldnames(item) : wanted
        out = Dict{String,Any}()
        for key in keys
            value = _getvalue(item, key)
            out[String(get(rename, key, key))] = _jsonable(value)
        end
        return out
    end
end

propertyprojector(fields...; rename=Dict{Any,Any}()) = dictprojector(collect(fields); rename=rename)

function _position_tuple(agent)
    pos = _getvalue(agent, :pos)
    pos === nothing && return nothing
    if pos isa Tuple || pos isa AbstractVector
        length(pos) >= 2 && return (pos[1], pos[2])
    end
    return nothing
end

"""Project a generic/Agents.jl-style agent into TenSnap item fields."""
function autoagentprojector(; id=:id, x=:x, y=:y, color=nothing, size=nothing, icon="circle", fields=())
    return function (agent)
        out = Dict{String,Any}()
        out["id"] = _jsonable(_getvalue(agent, id))
        pos = _position_tuple(agent)
        if pos !== nothing
            out["x"], out["y"] = pos
        else
            out["x"] = _jsonable(_getvalue(agent, x))
            out["y"] = _jsonable(_getvalue(agent, y))
        end
        out["heading"] = _jsonable(something(_getvalue(agent, :heading), 0))
        out["icon"] = icon
        color !== nothing && (out["color"] = _jsonable(color isa Function ? color(agent) : _getvalue(agent, color)))
        size !== nothing && (out["size"] = _jsonable(size isa Function ? size(agent) : _getvalue(agent, size)))
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

mutable struct Parameter
    id::String
    label::String
    type::String
    value::Any
    min::Any
    max::Any
    step::Any
    options::Union{Nothing,Vector{Any}}
    getter::Union{Nothing,Function}
    setter::Union{Nothing,Function}
end

function parameter(id; label=id, type="number", value=nothing, min=nothing, max=nothing,
                   step=nothing, options=nothing, getter=nothing, setter=nothing)
    return Parameter(String(id), String(label), String(type), value, min, max, step,
                     options === nothing ? nothing : collect(options), getter, setter)
end

function _call0or1(f::Function, model)
    applicable(f, model) ? f(model) : f()
end

function _call1or2(f::Function, value, model)
    applicable(f, value, model) ? f(value, model) : f(value)
end

function _param_value(p::Parameter, model=nothing)
    p.getter === nothing ? p.value : _call0or1(p.getter, model)
end

function _param_payload(p::Parameter, model=nothing)
    d = Dict{String,Any}("id" => p.id, "label" => p.label, "type" => p.type, "value" => _jsonable(_param_value(p, model)), "allowRuntimeChange" => true)
    p.min !== nothing && (d["min"] = p.min)
    p.max !== nothing && (d["max"] = p.max)
    p.step !== nothing && (d["step"] = p.step)
    p.options !== nothing && (d["options"] = p.options)
    return d
end

mutable struct Action
    id::String
    label::String
    handler::Function
    continuous::Bool
    continue_on_return::Bool
end

action(id, handler; label=id, continuous=false, continue_on_return=false) =
    Action(String(id), String(label), handler, Bool(continuous), Bool(continue_on_return))

_action_payload(a::Action) = Dict("id" => a.id, "label" => a.label, "continuous" => a.continuous, "allowRuntimeChange" => true)

mutable struct Chart
    id::String
    label::String
    color::String
    getter::Function
    series::Vector{Dict{String,Any}}
end

function chart(id, getter; label=id, color="#228be6", series=nothing)
    sl = series === nothing ? [Dict{String,Any}("id" => String(id), "label" => String(label), "color" => color)] :
                                [Dict{String,Any}(String(k) => v for (k, v) in pairs(item)) for item in series]
    return Chart(String(id), String(label), String(color), getter, sl)
end

_chart_payload(c::Chart) = Dict("id" => c.id, "label" => c.label, "color" => c.color, "dataList" => c.series)

mutable struct Layer
    id::String
    type::String
    items::Function
    data::Union{Nothing,Function}
    dependency_layer_ids::Dict{String,String}
    item_key_fields::Vector{String}
    last_items::Dict{Any,Dict{String,Any}}
end

function layer(id, type, items; data=nothing, dependency_layer_ids=Dict{String,String}(), item_key_fields=String[])
    return Layer(String(id), String(type), items, data,
                 Dict(String(k) => String(v) for (k, v) in pairs(dependency_layer_ids)),
                 String.(item_key_fields), Dict{Any,Dict{String,Any}}())
end

function agents_layer(id, getagents=agents_getter; projector=autoagentprojector(), data=nothing,
                      dependency_layer_ids=Dict{String,String}(), item_key_fields=["id"])
    items = model -> [projector(a) for a in getagents(model)]
    return layer(id, "agent", items; data=data, dependency_layer_ids=dependency_layer_ids,
                 item_key_fields=item_key_fields)
end

grid_layer(id, items; data=nothing, item_key_fields=["x", "y"]) = layer(id, "grid", items; data=data, item_key_fields=item_key_fields)
patch_layer(id, items; data=nothing, item_key_fields=["x", "y"]) = layer(id, "patch", items; data=data, item_key_fields=item_key_fields)
edge_layer(id, items; data=nothing, dependency_layer_ids=Dict{String,String}(), item_key_fields=["source", "target"]) =
    layer(id, "edge", items; data=data, dependency_layer_ids=dependency_layer_ids, item_key_fields=item_key_fields)

mutable struct Environment
    id::String
    type::String
    layers::Vector{Layer}
end

environment(id; type="2d", layers=Layer[]) = Environment(String(id), String(type), collect(layers))

mutable struct Asset
    id::String
    hash::String
    mime::String
    size::Int
    label::Union{Nothing,String}
    data::Vector{UInt8}
end

mutable struct Scenario
    host::String
    port::Int
    use_msgpack::Bool
    step_interval::Float64
    parameters::Dict{String,Parameter}
    actions::Dict{String,Action}
    charts::Dict{String,Chart}
    environments::Dict{String,Environment}
    assets::Dict{String,Asset}
    pending_screenshots::Dict{String,Channel{Any}}
    model::Any
    init::Union{Nothing,Function}
    step::Union{Nothing,Function}
    reset::Union{Nothing,Function}
    time_step::Int
    initialized::Bool
    clients::Vector{HTTP.WebSockets.WebSocket}
end

function Scenario(; host="localhost", port=8765, use_msgpack=false, step_interval=0.05)
    use_msgpack && error("TenSnap.jl currently supports JSON WebSocket transport; set use_msgpack=false.")
    s = Scenario(String(host), Int(port), Bool(use_msgpack), Float64(step_interval),
                 Dict{String,Parameter}(), Dict{String,Action}(), Dict{String,Chart}(),
                 Dict{String,Environment}(), Dict{String,Asset}(), Dict{String,Channel{Any}}(), nothing, nothing, nothing, nothing, 0, false,
                 HTTP.WebSockets.WebSocket[])
    add_action!(s, action(ACTION_START, () -> begin step!(s); true end; label="Start", continuous=true, continue_on_return=true))
    add_action!(s, action(ACTION_STEP, () -> begin step!(s); false end; label="Step"))
    add_action!(s, action(ACTION_RESET, () -> begin reset!(s); false end; label="Reset"))
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

function add_environment!(s::Scenario, e::Environment)
    s.environments[e.id] = e
    _broadcast(s, "env_create", Dict("id" => e.id, "type" => e.type))
    for l in e.layers
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

add_layer!(e::Environment, l::Layer) = (push!(e.layers, l); l)

function add_layer!(s::Scenario, env_id, l::Layer)
    e = s.environments[String(env_id)]
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

function register_model!(s::Scenario, model; init=nothing, step=nothing, reset=nothing)
    s.model = model
    s.init = init
    s.step = step
    s.reset = reset
    return s
end

function _layer_items(l::Layer, model)
    return [Dict(String(k) => _jsonable(v) for (k, v) in pairs(item)) for item in _call0or1(l.items, model)]
end

function _layer_payload(env_id::String, l::Layer, model)
    d = Dict{String,Any}("env_id" => env_id, "layer_id" => l.id, "layer_type" => l.type)
    isempty(l.dependency_layer_ids) || (d["dependency_layer_ids"] = l.dependency_layer_ids)
    l.data === nothing || (d["data"] = _jsonable(_call0or1(l.data, model)))
    return d
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

function _remember_layer_items!(l::Layer, items::Vector{Dict{String,Any}})
    l.last_items = Dict{Any,Dict{String,Any}}(_item_key(l, item) => item for item in items)
    return items
end

function _layer_item_deltas!(l::Layer, model)
    items = _layer_items(l, model)
    previous = l.last_items
    current = Dict{Any,Dict{String,Any}}()
    creates = Dict{String,Any}[]
    updates = Dict{String,Any}[]
    for item in items
        key = _item_key(l, item)
        current[key] = item
        if !haskey(previous, key)
            push!(creates, item)
        elseif previous[key] != item
            push!(updates, item)
        end
    end
    deletes = Any[]
    for (key, item) in previous
        haskey(current, key) || push!(deletes, _item_delete_payload(l, item))
    end
    l.last_items = current
    return creates, updates, deletes
end

function _send_or_broadcast(s::Scenario, ws, type::String, payload)
    ws === nothing ? _broadcast(s, type, payload) : _send(ws, type, payload)
end

function _broadcast_layer_full(s::Scenario, env_id::String, l::Layer; ws=nothing)
    _send_or_broadcast(s, ws, "env_layer_create", _layer_payload(env_id, l, s.model))
    items = _remember_layer_items!(l, _layer_items(l, s.model))
    isempty(items) || _send_or_broadcast(s, ws, "item_create", Dict("env_id" => env_id, "layer_id" => l.id, "items" => items))
    return items
end

function create_items!(s::Scenario, env_id, layer_id, items)
    payload_items = [Dict(String(k) => _jsonable(v) for (k, v) in pairs(item)) for item in items]
    _broadcast(s, "item_create", Dict("env_id" => String(env_id), "layer_id" => String(layer_id), "items" => payload_items))
    return payload_items
end

function update_items!(s::Scenario, env_id, layer_id, items)
    payload_items = [Dict(String(k) => _jsonable(v) for (k, v) in pairs(item)) for item in items]
    _broadcast(s, "item_update", Dict("env_id" => String(env_id), "layer_id" => String(layer_id), "items" => payload_items))
    return payload_items
end

function delete_items!(s::Scenario, env_id, layer_id, items)
    payload_items = [_jsonable(item) for item in items]
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
    return (creates=creates, updates=updates, deletes=deletes)
end

function _asset_hash(data::Vector{UInt8})
    return bytes2hex(sha256(data))[1:16]
end

function _asset_meta(asset::Asset)
    d = Dict{String,Any}("id" => asset.id, "hash" => asset.hash, "mime" => asset.mime, "size" => asset.size)
    asset.label === nothing || (d["label"] = asset.label)
    return d
end

_asset_data_uri(asset::Asset) = "data:$(asset.mime);base64,$(base64encode(asset.data))"

function _send_asset_meta(s::Scenario, ws=nothing)
    isempty(s.assets) && return nothing
    payload = Dict("assets" => [_asset_meta(asset) for asset in values(s.assets)])
    ws === nothing ? _broadcast(s, "asset_meta", payload) : _send(ws, "asset_meta", payload)
    return payload
end

function _send_asset_data(s::Scenario, asset::Asset, ws=nothing)
    payload = Dict("id" => asset.id, "hash" => asset.hash, "mime" => asset.mime, "data" => _asset_data_uri(asset))
    ws === nothing ? _broadcast(s, "asset_data", payload) : _send(ws, "asset_data", payload)
    return payload
end

function publish_asset!(s::Scenario, asset_id, data::AbstractVector{UInt8}, mime; label=nothing)
    bytes = Vector{UInt8}(data)
    hash = _asset_hash(bytes)
    sid = String(asset_id)
    existing = get(s.assets, sid, nothing)
    if existing !== nothing && existing.hash == hash
        return existing
    end
    asset = Asset(sid, hash, String(mime), length(bytes), label === nothing ? nothing : String(label), bytes)
    s.assets[sid] = asset
    _send_asset_meta(s)
    _send_asset_data(s, asset)
    return asset
end

publish_asset!(s::Scenario, asset_id, data::AbstractString, mime; label=nothing) =
    publish_asset!(s, asset_id, Vector{UInt8}(codeunits(data)), mime; label=label)

function delete_asset!(s::Scenario, asset_id)
    sid = String(asset_id)
    existed = pop!(s.assets, sid, nothing) !== nothing
    existed && _broadcast(s, "asset_delete", Dict("ids" => [sid]))
    return existed
end

function _handle_asset_sync(s::Scenario, ws, payload)
    client_hashes = get(payload, "assets", Dict{String,Any}())
    for (asset_id, asset) in s.assets
        if get(client_hashes, asset_id, nothing) != asset.hash
            _send_asset_data(s, asset, ws)
        end
    end
end

function request_screenshot!(s::Scenario; env_id=nothing, chart_id=nothing, format="png", quality=nothing, timeout=nothing, request_id=nothing)
    (env_id === nothing) == (chart_id === nothing) && error("Exactly one of env_id or chart_id must be specified.")
    isempty(s.clients) && error("No connected renderer.")
    rid = request_id === nothing ? string(uuid4()) : String(request_id)
    haskey(s.pending_screenshots, rid) && error("Screenshot request $rid is already pending.")
    payload = Dict{String,Any}("request_id" => rid)
    env_id === nothing || (payload["env_id"] = String(env_id))
    chart_id === nothing || (payload["chart_id"] = String(chart_id))
    format == "png" || (payload["format"] = String(format))
    quality === nothing || (payload["quality"] = quality)
    ch = Channel{Any}(1)
    s.pending_screenshots[rid] = ch
    try
        _broadcast(s, "screenshot_request", payload)
        if timeout === nothing
            return take!(ch)
        end
        status = timedwait(() -> isready(ch), timeout)
        status == :ok || error("Timed out waiting for screenshot response $rid.")
        return take!(ch)
    finally
        pop!(s.pending_screenshots, rid, nothing)
    end
end

function _handle_screenshot_response(s::Scenario, payload)
    rid = get(payload, "request_id", nothing)
    rid === nothing && return nothing
    ch = get(s.pending_screenshots, String(rid), nothing)
    ch === nothing || put!(ch, payload)
    return payload
end

function _chart_updates(c::Chart, value, t::Int)
    if value isa AbstractDict
        return [Dict("id" => String(k), "value" => _jsonable(v), "time" => t) for (k, v) in pairs(value)]
    elseif value isa Tuple || value isa AbstractVector
        return [Dict("id" => c.series[i]["id"], "value" => _jsonable(v), "time" => t) for (i, v) in enumerate(value) if i <= length(c.series)]
    else
        return [Dict("id" => c.series[1]["id"], "value" => _jsonable(value), "time" => t)]
    end
end

_encode(type::String, payload) = JSON3.write(Dict("type" => type, "payload" => _jsonable(payload)))

function _send(ws, type::String, payload)
    type in SERVER_MESSAGE_TYPES || error("unknown TenSnap server message type: $type")
    HTTP.WebSockets.send(ws, _encode(type, payload))
end

function _broadcast(s::Scenario, type::String, payload)
    for ws in copy(s.clients)
        try
            _send(ws, type, payload)
        catch
            filter!(x -> x !== ws, s.clients)
        end
    end
end

function sync!(s::Scenario, ws=nothing)
    sink(type, payload) = ws === nothing ? _broadcast(s, type, payload) : _send(ws, type, payload)
    sink("metadata_update", Dict("time" => s.time_step))
    for a in values(s.actions)
        sink("action_create", _action_payload(a))
    end
    for p in values(s.parameters)
        sink("param_create", _param_payload(p, s.model))
    end
    for e in values(s.environments)
        sink("env_create", Dict("id" => e.id, "type" => e.type))
        for l in e.layers
            _broadcast_layer_full(s, e.id, l; ws=ws)
        end
    end
    for c in values(s.charts)
        sink("chart_create", _chart_payload(c))
    end
    _send_asset_meta(s, ws)
    broadcast_charts!(s, ws)
    return s
end

function broadcast_charts!(s::Scenario, ws=nothing)
    updates = Dict{String,Any}[]
    for c in values(s.charts)
        append!(updates, _chart_updates(c, _call0or1(c.getter, s.model), s.time_step))
    end
    isempty(updates) || (ws === nothing ? _broadcast(s, "chart_update", Dict("updates" => updates)) : _send(ws, "chart_update", Dict("updates" => updates)))
    return updates
end

function _ensure_initialized!(s::Scenario)
    if !s.initialized
        s.time_step = 0
        s.init !== nothing && _call0or1(s.init, s.model)
        s.initialized = true
    end
    return s
end

function step!(s::Scenario)
    _ensure_initialized!(s)
    s.time_step += 1
    s.step !== nothing && _call0or1(s.step, s.model)
    _broadcast(s, "metadata_update", Dict("time" => s.time_step))
    for e in values(s.environments), l in e.layers
        creates, updates, deletes = _layer_item_deltas!(l, s.model)
        isempty(creates) || _broadcast(s, "item_create", Dict("env_id" => e.id, "layer_id" => l.id, "items" => creates))
        isempty(updates) || _broadcast(s, "item_update", Dict("env_id" => e.id, "layer_id" => l.id, "items" => updates))
        isempty(deletes) || _broadcast(s, "item_delete", Dict("env_id" => e.id, "layer_id" => l.id, "items" => deletes))
    end
    broadcast_charts!(s)
    return s
end

function reset!(s::Scenario)
    s.time_step = 0
    if s.reset !== nothing
        _call0or1(s.reset, s.model)
    elseif s.init !== nothing
        _call0or1(s.init, s.model)
    end
    s.initialized = true
    clear_charts!(s)
    sync!(s)
    return s
end

function clear_charts!(s::Scenario; ids=collect(keys(s.charts)))
    operations = [Dict("id" => id, "operation" => "clear") for id in ids]
    isempty(operations) || _broadcast(s, "chart_update", Dict("operations" => operations))
    return s
end

function log!(s::Scenario, level, message)
    ts = Int(floor(datetime2unix(now(UTC)) * 1000))
    _broadcast(s, "log", Dict("timestamp" => ts, "level" => String(level), "message" => String(message)))
end

function _set_parameter!(p::Parameter, value, model=nothing)
    p.setter === nothing ? (p.value = value) : _call1or2(p.setter, value, model)
    p.value = value
    return value
end

function _handle_message(s::Scenario, ws, raw)
    msg = JSON3.read(String(raw), Dict{String,Any})
    type = String(msg["type"])
    payload = haskey(msg, "payload") ? msg["payload"] : Dict{String,Any}()
    if type == "state_sync"
        request_id = get(payload, "request_id", nothing)
        boundary = request_id === nothing ? Dict{String,Any}() : Dict("request_id" => request_id)
        _send(ws, "state_sync_begin", boundary)
        _ensure_initialized!(s)
        sync!(s, ws)
        _send(ws, "state_sync_end", boundary)
    elseif type == "param_change"
        id = String(payload["id"])
        haskey(s.parameters, id) && _set_parameter!(s.parameters[id], payload["value"], s.model)
        _broadcast(s, "param_sync", Dict("id" => id, "value" => payload["value"]))
    elseif type == "asset_sync"
        _handle_asset_sync(s, ws, payload)
    elseif type == "screenshot_response"
        _handle_screenshot_response(s, payload)
    elseif type == "action_start"
        id = String(payload["id"])
        tick_id = get(payload, "tick_id", nothing)
        if haskey(s.actions, id)
            started = time_ns()
            result = _call0or1(s.actions[id].handler, s.model)
            simulate_ms = (time_ns() - started) / 1_000_000
            cont = s.actions[id].continue_on_return ? Bool(result) : false
            resp = Dict{String,Any}("id" => id, "timings" => Dict("simulate_ms" => simulate_ms), "continue" => cont)
            tick_id === nothing || (resp["tick_id"] = tick_id)
            _send(ws, "action_end", resp)
        end
    end
    return nothing
end

function run!(s::Scenario; verbose=true)
    verbose && @info "TenSnap Julia server listening" host=s.host port=s.port
    HTTP.WebSockets.listen(s.host, s.port) do ws
        push!(s.clients, ws)
        _send_asset_meta(s, ws)
        try
            for msg in ws
                _handle_message(s, ws, msg)
            end
        finally
            filter!(x -> x !== ws, s.clients)
        end
    end
end

end # module
