_jsonable(x) = x
_jsonable(x::Symbol) = String(x)
_jsonable(x::Tuple) = collect(x)
_jsonable(x::NamedTuple) = Dict(String(k) => _jsonable(v) for (k, v) in pairs(x))
_jsonable(x::AbstractDict) = Dict(String(k) => _jsonable(v) for (k, v) in pairs(x))
_jsonable(x::AbstractVector{UInt8}) = Vector{UInt8}(x)
_jsonable(x::AbstractArray) = [_jsonable(v) for v in x]

function _public_fieldnames(x)
	x isa AbstractDict && return keys(x)
	x isa NamedTuple && return keys(x)
	x isa Type && return fieldnames(x)
	return fieldnames(typeof(x))
end

function _key_candidates(key)
	candidates = Any[key]
	if key isa Symbol
		push!(candidates, String(key))
	elseif key isa AbstractString
		push!(candidates, Symbol(key))
	end
	return unique(candidates)
end

function _getvalue(obj, key)
	if obj isa AbstractDict
		for candidate in _key_candidates(key)
			haskey(obj, candidate) && return obj[candidate]
		end
		return nothing
	end
	sym = key isa Symbol ? key : Symbol(key)
	return hasproperty(obj, sym) ? getproperty(obj, sym) : nothing
end

function _setvalue!(obj, key, value)
	if obj isa AbstractDict
		for candidate in _key_candidates(key)
			if haskey(obj, candidate)
				obj[candidate] = value
				return value
			end
		end
		obj[key] = value
	else
		setproperty!(obj, key isa Symbol ? key : Symbol(key), value)
	end
	return value
end

function _call0or1(f::Function, model)
	applicable(f, model) ? f(model) : f()
end

function _call1or2(f::Function, value, model)
	applicable(f, value, model) ? f(value, model) : f(value)
end
