function request_screenshot!(s::Scenario; env_id = nothing, chart_id = nothing, format = "png", quality = nothing, timeout = nothing, request_id = nothing)
	(env_id === nothing) == (chart_id === nothing) && error("Exactly one of env_id or chart_id must be specified.")
	isempty(s.clients) && error("No connected renderer.")
	rid = request_id === nothing ? string(uuid4()) : String(request_id)
	haskey(s.pending_screenshots, rid) && error("Screenshot request $rid is already pending.")
	payload = Dict{String, Any}("request_id" => rid)
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
