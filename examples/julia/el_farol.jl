# Adaptive-expectations bar inspired by El Farol (no competing predictor pool).
#
# This file intentionally has no TenSnap dependency. It can be used from tests,
# scripts, notebooks, or other visualization front ends.

using Random

mutable struct Patron
    id::Int
    attending::Bool
    expected::Float64
    score::Float64
end

mutable struct ElFarolModel
    agents::Vector{Patron}
    capacity::Int
    attendance::Int
    history::Vector{Int}
    seed::Int
    rng::MersenneTwister
end

function make_model(; n=100, capacity=60, seed=42)
    rng = MersenneTwister(seed)
    agents = [Patron(i, false, capacity, 0.0) for i in 1:n]
    return ElFarolModel(agents, capacity, 0, Int[], seed, rng)
end

function initialize!(model::ElFarolModel)
    Random.seed!(model.rng, model.seed)
    empty!(model.history)
    model.attendance = 0
    for agent in model.agents
        agent.attending = false
        agent.expected = model.capacity
        agent.score = 0.0
    end
    return model
end

"""One synchronous week; inertia 0.7, five-week memory, Gaussian noise σ=8.

Score is an outcome diagnostic and does not select strategies. These chosen
constants define a teaching variant, not a calibrated attendance model.
"""
function advance!(model::ElFarolModel)
    recent = isempty(model.history) ? model.capacity : sum(model.history[max(1, end - 4):end]) / min(5, length(model.history))
    noise = randn(model.rng, length(model.agents)) .* 8
    for (agent, n) in zip(model.agents, noise)
        agent.expected = clamp(0.7 * agent.expected + 0.3 * (recent + n), 0, length(model.agents))
        agent.attending = agent.expected < model.capacity
    end
    model.attendance = count(a -> a.attending, model.agents)
    push!(model.history, model.attendance)
    crowded = model.attendance > model.capacity
    for agent in model.agents
        agent.score += agent.attending == !crowded ? 1 : 0
    end
    return model
end
