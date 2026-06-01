function _chart_updates(c::Chart, value, t::Int)
	if value isa AbstractDict
		return [Dict("id" => String(k), "value" => _jsonable(v), "time" => t) for (k, v) in pairs(value)]
	elseif value isa Tuple || value isa AbstractVector
		return [Dict("id" => c.series[i]["id"], "value" => _jsonable(v), "time" => t) for (i, v) in enumerate(value) if i <= length(c.series)]
	else
		return [Dict("id" => c.series[1]["id"], "value" => _jsonable(value), "time" => t)]
	end
end

function _encode(type::String, payload; use_msgpack = false)
	message = Dict("type" => type, "payload" => _jsonable(payload))
	return use_msgpack ? MsgPack.pack(message) : JSON3.write(message)
end

function _raw_bytes(raw)
	raw isa AbstractString && return Vector{UInt8}(codeunits(raw))
	raw isa Vector{UInt8} && return raw
	return Vector{UInt8}(raw)
end

function _first_nonspace_byte(bytes::AbstractVector{UInt8})
	for b in bytes
		b in (0x09, 0x0a, 0x0d, 0x20) || return b
	end
	return nothing
end

function _decode_with_encoding(raw)
	bytes = _raw_bytes(raw)
	first = _first_nonspace_byte(bytes)
	if first in (UInt8('{'), UInt8('['))
		return JSON3.read(String(bytes), Dict{String, Any}), false
	end
	return MsgPack.unpack(bytes), true
end

function _decode(s::Scenario, raw)
	msg, _ = _decode_with_encoding(raw)
	return msg
end

function _send(ws, type::String, payload; use_msgpack = false)
	type in SERVER_MESSAGE_TYPES || error("unknown TenSnap server message type: $type")
	HTTP.WebSockets.send(ws, _encode(type, payload; use_msgpack = use_msgpack))
end

_client_use_msgpack(s::Scenario, ws) = get(s.client_encodings, ws, s.use_msgpack)

function _send_to(s::Scenario, ws, type::String, payload)
	_send(ws, type, payload; use_msgpack = _client_use_msgpack(s, ws))
end

function _broadcast(s::Scenario, type::String, payload)
	for ws in copy(s.clients)
		try
			_send_to(s, ws, type, payload)
		catch
			filter!(x -> x !== ws, s.clients)
			pop!(s.client_encodings, ws, nothing)
		end
	end
end

function _send_or_broadcast(s::Scenario, ws, type::String, payload)
	ws === nothing ? _broadcast(s, type, payload) : _send_to(s, ws, type, payload)
end
