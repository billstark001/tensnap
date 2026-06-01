function parse_env(::Type{String}, name, default)
	raw = get(ENV, name, nothing)
	return raw === nothing ? default : raw
end

function parse_env(::Type{Int}, name, default)
	raw = get(ENV, name, nothing)
	raw === nothing && return default
	parsed = tryparse(Int, raw)
	return parsed === nothing ? default : parsed
end

function parse_env(::Type{Float64}, name, default)
	raw = get(ENV, name, nothing)
	raw === nothing && return default
	parsed = tryparse(Float64, raw)
	return parsed === nothing ? default : parsed
end

function parse_env(::Type{Bool}, name, default)
	raw = get(ENV, name, nothing)
	raw === nothing && return default
	normalized = lowercase(strip(raw))
	normalized in ("1", "true", "yes", "on") && return true
	normalized in ("0", "false", "no", "off") && return false
	return default
end

function parse_optional_env(::Type{Int}, name)
	raw = strip(get(ENV, name, ""))
	isempty(raw) && return nothing
	parsed = tryparse(Int, raw)
	return parsed === nothing ? nothing : parsed
end
