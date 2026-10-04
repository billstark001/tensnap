# Publication audit sidecar; not part of the teaching Schelling example.
# Loaded only when TENSNAP_SCHELLING_AUDIT_STATE is set. It reads live model
# state independently of the model checkpoint serializer.

function schelling_audit_state(model, config::SchellingConfig)
	properties = Agents.abmproperties(model)
	rng_io = IOBuffer()
	serialize(rng_io, Agents.abmrng(model))
	agents = [Dict("id" => agent.agentid, "internal_id" => agent.id,
		"x" => agent.pos[1] - 1, "y" => agent.pos[2] - 1,
		"group" => agent.group, "satisfied" => satisfied(agent, model))
		for agent in Agents.allagents(model)]
	sort!(agents; by = agent -> agent["internal_id"])
	return Dict(
		"time" => properties.tick,
		"config" => Dict("gridWidth" => config.gridwidth, "gridHeight" => config.gridheight,
			"density" => config.density, "balance" => config.balance,
			"similarityThreshold" => properties.similarity_threshold, "seed" => config.seed),
		"agents" => agents,
		"rng" => bytes2hex(take!(rng_io)),
		"lastMoved" => properties.last_swapped,
		"metrics" => Dict("satisfactionRate" => satisfied_pct(model),
			"segregationIndex" => segregation_index(model), "moved" => properties.last_swapped),
	)
end

function write_schelling_audit!(path::String, model, config::SchellingConfig)
	tmp = path * ".tmp"
	open(tmp, "w") do io
		write(io, TenSnap.JSON3.write(schelling_audit_state(model, config)))
	end
	mv(tmp, path; force = true)
	return nothing
end
