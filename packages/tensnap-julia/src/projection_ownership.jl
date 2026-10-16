"""Normalize portable projection values, borrowing unchanged containers."""
_wire_value(x) = _jsonable(x)
_wire_value(x::Vector{UInt8}) = x
_wire_value(x::Tuple) = [_wire_value(v) for v in x]
_wire_value(x::NamedTuple) = Dict(String(k) => _wire_value(v) for (k, v) in pairs(x))
function _wire_value(x::AbstractDict)
	# Canonical dictionaries can be encoded directly; convert only changed paths.
	if keytype(x) === String
		result = x
		for (key, value) in x
			converted = _wire_value(value)
			if converted !== value
				result === x && (result = Dict{String, Any}(x))
				result[key] = converted
			end
		end
		return result
	end
	return Dict(String(k) => _wire_value(v) for (k, v) in pairs(x))
end
function _wire_value(x::AbstractArray)
	result = x
	for index in eachindex(x)
		converted = _wire_value(x[index])
		if converted !== x[index]
			result === x && (result = Any[v for v in x])
			result[index] = converted
		end
	end
	return result
end

# Normalize and detach ordinary protocol containers in one pass. The fallback
# preserves custom value types and their deepcopy_internal implementations.
_detached_wire_value(value) = deepcopy(_wire_value(value))
_detached_wire_value(value::Union{Nothing, Bool, Int, Float64, String}) = value
_detached_wire_value(value::AbstractDict) = Dict{String, Any}(String(k) => _detached_wire_value(v) for (k, v) in pairs(value))
_detached_wire_value(value::Tuple) = [_detached_wire_value(v) for v in value]
_detached_wire_value(value::NamedTuple) = Dict{String, Any}(String(k) => _detached_wire_value(v) for (k, v) in pairs(value))
_detached_wire_value(value::Array) = map(_detached_wire_value, value)
_detached_wire_value(value::Vector{UInt8}) = copy(value)
_detached_wire_value(value::AbstractVector{UInt8}) = Vector{UInt8}(value)

"""Detach once at publication, or transfer an already independent snapshot."""
_snapshot_value(value, deep_copy::Bool) = deep_copy ? _detached_wire_value(value) : _wire_value(value)

"""Own the fields of a fresh built-in record without copying its outer map."""
function _own_projection!(record::Dict{String, Any}, deep_copy::Bool, previous = nothing)
	deep_copy || return _wire_value(record)
	for (key, value) in record
		record[key] = previous !== nothing && haskey(previous, key) && value == previous[key] ? previous[key] : _detached_wire_value(value)
	end
	return record
end

struct SnapshotProjector{F} <: Function
	project::F
	deep_copy::Bool
end
(p::SnapshotProjector)(item) = _own_projection!(p.project(item), p.deep_copy)
_projector_owns_values(::Any) = false
_projector_owns_values(p::SnapshotProjector) = p.deep_copy
_configure_projector(p, deep_copy::Bool) = p
_configure_projector(p::SnapshotProjector, deep_copy::Bool) = SnapshotProjector(p.project, deep_copy)
