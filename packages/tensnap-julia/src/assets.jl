function _asset_hash(data::Vector{UInt8})
	return bytes2hex(sha256(data))[1:16]
end

function _asset_meta(asset::Asset)
	d = Dict{String, Any}("id" => asset.id, "hash" => asset.hash, "mime" => asset.mime, "size" => asset.size)
	asset.label === nothing || (d["label"] = asset.label)
	return d
end

_asset_data_uri(asset::Asset) = "data:$(asset.mime);base64,$(base64encode(asset.data))"
_asset_data_payload(asset::Asset; use_msgpack = false) = Dict("id" => asset.id, "hash" => asset.hash, "mime" => asset.mime, "data" => use_msgpack ? asset.data : _asset_data_uri(asset))

function _send_asset_meta(s::Scenario, ws = nothing)
	isempty(s.assets) && return nothing
	payload = Dict("assets" => [_asset_meta(asset) for asset in values(s.assets)])
	_send_or_broadcast(s, ws, "asset_metadata", payload)
	return payload
end

function _send_asset_data(s::Scenario, asset::Asset, ws = nothing)
	if ws === nothing
		for client in copy(s.clients)
			try
				use_msgpack = _client_use_msgpack(s, client)
				_send(client, "asset_data", _asset_data_payload(asset; use_msgpack = use_msgpack); use_msgpack = use_msgpack)
			catch
				filter!(x -> x !== client, s.clients)
				pop!(s.client_encodings, client, nothing)
			end
		end
		return _asset_data_payload(asset; use_msgpack = s.use_msgpack)
	end
	use_msgpack = _client_use_msgpack(s, ws)
	payload = _asset_data_payload(asset; use_msgpack = use_msgpack)
	_send(ws, "asset_data", payload; use_msgpack = use_msgpack)
	return payload
end

function publish_asset!(s::Scenario, asset_id, data::AbstractVector{UInt8}, mime; label = nothing)
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

publish_asset!(s::Scenario, asset_id, data::AbstractString, mime; label = nothing) =
	publish_asset!(s, asset_id, Vector{UInt8}(codeunits(data)), mime; label = label)

function delete_asset!(s::Scenario, asset_id)
	sid = String(asset_id)
	existed = pop!(s.assets, sid, nothing) !== nothing
	existed && _broadcast(s, "asset_delete", Dict("ids" => [sid]))
	return existed
end

function _handle_asset_sync(s::Scenario, ws, payload)
	client_hashes = get(payload, "assets", Dict{String, Any}())
	for (asset_id, asset) in s.assets
		if get(client_hashes, asset_id, nothing) != asset.hash
			_send_asset_data(s, asset, ws)
		end
	end
end
