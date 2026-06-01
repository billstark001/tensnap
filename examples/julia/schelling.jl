using Agents
using Random

const DEFAULT_GRID_W = 50
const DEFAULT_GRID_H = 50
const DEFAULT_DENSITY = 0.8
const DEFAULT_BALANCE = 0.5
const DEFAULT_SIMILARITY_THRESHOLD = 0.7

mutable struct SchellingProperties
	similarity_threshold::Float64
	last_swapped::Int
end

@agent struct SchellingAgent(GridAgent{2})
	group::Int
	agentid::String
end

function satisfied(agent::SchellingAgent, model)::Bool
	same_group = 0
	occupied_neighbors = 0

	for neighbor in nearby_agents(agent, model, 1)
		occupied_neighbors += 1
		if neighbor.group == agent.group
			same_group += 1
		end
	end

	occupied_neighbors == 0 && return true

	return same_group >= model.similarity_threshold * occupied_neighbors
end

function satisfied_pct(model)::Float64
	n = nagents(model)
	n == 0 && return 0.0
	return count(agent -> satisfied(agent, model), allagents(model)) / n
end

function segregation_index(model)::Float64
	total_ratio = 0.0
	count_agents = 0

	for agent in allagents(model)
		same = 0
		occupied_neighbors = 0

		for neighbor in nearby_agents(agent, model, 1)
			occupied_neighbors += 1
			if neighbor.group == agent.group
				same += 1
			end
		end

		if occupied_neighbors > 0
			total_ratio += same / occupied_neighbors
			count_agents += 1
		end
	end

	return count_agents == 0 ? 0.0 : total_ratio / count_agents
end

function schelling_model_step!(model)
	unsatisfied = Int[]
	for id in allids(model)
		agent = model[id]
		if !satisfied(agent, model)
			push!(unsatisfied, id)
		end
	end

	empties = collect(empty_positions(model))

	rng = abmrng(model)
	shuffle!(rng, unsatisfied)
	shuffle!(rng, empties)

	swapped = min(length(unsatisfied), length(empties))

	for i in 1:swapped
		move_agent!(model[unsatisfied[i]], empties[i], model)
	end

	abmproperties(model).last_swapped = swapped
	return swapped > 0
end

function initialize_schelling(;
	gridwidth::Int = DEFAULT_GRID_W,
	gridheight::Int = DEFAULT_GRID_H,
	density::Float64 = DEFAULT_DENSITY,
	balance::Float64 = DEFAULT_BALANCE,
	similarity_threshold::Float64 = DEFAULT_SIMILARITY_THRESHOLD,
	seed = nothing,
)
	gridwidth = gridwidth > 0 ? gridwidth : DEFAULT_GRID_W
	gridheight = gridheight > 0 ? gridheight : DEFAULT_GRID_H
	density = 0 <= density <= 1 ? density : DEFAULT_DENSITY
	balance = 0 <= balance <= 1 ? balance : DEFAULT_BALANCE
	similarity_threshold = 0 <= similarity_threshold <= 1 ?
						   similarity_threshold :
						   DEFAULT_SIMILARITY_THRESHOLD

	rng = isnothing(seed) ? Xoshiro() : Xoshiro(seed)

	space = GridSpaceSingle(
		(gridwidth, gridheight);
		periodic = false,
		metric = :chebyshev,
	)

	properties = SchellingProperties(similarity_threshold, 0)

	model = StandardABM(
		SchellingAgent,
		space;
		properties,
		model_step! = schelling_model_step!,
		rng,
	)

	next_type1 = 0
	next_type2 = 0
	type1_threshold = density * balance

	# Go 代码是 row-major: index -> x = index % width, y = index / width。
	# Julia 坐标为 1-based；顺序不影响动力学，只影响同 seed 时的初始随机流对应关系。
	for y in 1:gridheight, x in 1:gridwidth
		value = rand(abmrng(model))
		pos = (x, y)

		if value < type1_threshold
			add_agent!(pos, model, 1, "agent1_$(next_type1)")
			next_type1 += 1
		elseif value < density
			add_agent!(pos, model, 2, "agent2_$(next_type2)")
			next_type2 += 1
		end
	end

	return model
end
