# Deterministic Julia binding host for the cross-binding matrix.
using TenSnap
using JSON3

mutable struct Person
    id::Int
    x::Int
    y::Int
    health::String
end

mutable struct CounterModel
    x::Int
    steps::Int
    rng::Int
    queue::Vector{Int}
    speed::Int
    agents::Vector{Person}
    next_id::Int
    base_population::Int
    births::Int
    deaths::Int
end

const state_path = ENV["TENSNAP_CONFORMANCE_STATE"]
person_snapshot(a::Person) = Dict("id" => a.id, "x" => a.x, "y" => a.y, "health" => a.health)
snapshot(m::CounterModel) = Dict("x" => m.x, "steps" => m.steps, "rng" => m.rng,
    "queue" => copy(m.queue), "speed" => m.speed,
    "agents" => [person_snapshot(a) for a in m.agents], "next_id" => m.next_id,
    "base_population" => m.base_population, "births" => m.births, "deaths" => m.deaths)
persist(m::CounterModel) = write(state_path, JSON3.write(snapshot(m)))

function new_person!(m::CounterModel)
    id = m.next_id
    m.next_id += 1
    return Person(id, id % 64, (id ÷ 64) % 64, id % 4 == 1 ? "I" : "S")
end

function seed!(m::CounterModel, count::Int)
    empty!(m.agents)
    m.base_population = count
    m.births = m.deaths = 0
    for _ in 1:count
        push!(m.agents, new_person!(m))
    end
end

function clear_population!(m::CounterModel)
    empty!(m.agents)
    m.base_population = m.births = m.deaths = 0
end

counts(m::CounterModel) = Dict(
    "susceptible" => count(a -> a.health == "S", m.agents),
    "infected" => count(a -> a.health == "I", m.agents),
    "recovered" => count(a -> a.health == "R", m.agents),
)

function advance!(m::CounterModel)
    m.steps += 1
    m.x += m.speed
    m.rng = (m.rng * 17 + 11) % 997
    m.queue = [m.queue[2:end]; m.queue[1] + m.steps]
    if !isempty(m.agents)
        for a in m.agents
            a.x = (a.x + 1 + a.id % 3) % 64
            a.y = (a.y + 2) % 64
            if a.health == "I" && m.steps % 2 == 0
                a.health = "R"
            elseif a.health == "S" && a.id % 5 == 0 && m.steps % 3 == 0
                a.health = "I"
            end
        end
        if m.steps % 3 == 0
            popfirst!(m.agents)
            m.deaths += 1
        end
        if m.steps % 2 == 0
            push!(m.agents, new_person!(m))
            m.births += 1
        end
    end
    persist(m)
    return true
end

function restore!(m::CounterModel, saved)
    m.x = Int(saved["x"])
    m.steps = Int(saved["steps"])
    m.rng = Int(saved["rng"])
    m.queue = Int.(saved["queue"])
    m.speed = Int(saved["speed"])
    m.agents = [Person(Int(a["id"]), Int(a["x"]), Int(a["y"]), String(a["health"])) for a in saved["agents"]]
    m.next_id = Int(saved["next_id"])
    m.base_population = Int(saved["base_population"])
    m.births = Int(saved["births"])
    m.deaths = Int(saved["deaths"])
    persist(m)
end

model = CounterModel(0, 0, 7, [1, 2, 3], 1, Person[], 0, 0, 0, 0)
seed!(model, 4)
persist(model)
scenario = Scenario(host = "127.0.0.1", port = parse(Int, ENV["TENSNAP_CONFORMANCE_PORT"]),
    use_msgpack = get(ENV, "TENSNAP_CONFORMANCE_ENCODING", "json") == "msgpack",
    model_id = "conformance.counter", state_schema_version = "1",
    scene_restore = _ -> nothing,
    checkpoint_capture = get(ENV, "TENSNAP_CONFORMANCE_NO_CHECKPOINT", "0") == "1" ? nothing : (_ -> snapshot(model)),
    checkpoint_restore = get(ENV, "TENSNAP_CONFORMANCE_NO_CHECKPOINT", "0") == "1" ? nothing : (saved -> restore!(model, saved)))
register_model!(scenario, model; step = advance!)
add_parameter!(scenario, parameter("speed"; value = 1, min = 0, max = 5, step = 1,
    getter = m -> m.speed,
    setter = (value, m) -> begin
        m.speed = clamp(Int(value), 0, 5)
        persist(m)
    end))
add_monitor!(scenario, monitor("position", m -> m.x))
add_monitor!(scenario, monitor("population", m -> length(m.agents)))
add_action!(scenario, action("fail", _ -> error("intentional handler failure")))
function publish_population!()
    for e in values(scenario.environments), l in e.layers
        creates, updates, deletes = TenSnap._layer_item_deltas!(l, scenario.model)
        isempty(creates) || TenSnap._broadcast(scenario, "item_create", Dict("env_id" => e.id, "layer_id" => l.id, "items" => creates))
        isempty(updates) || TenSnap._broadcast(scenario, "item_update", Dict("env_id" => e.id, "layer_id" => l.id, "items" => updates))
        isempty(deletes) || TenSnap._broadcast(scenario, "item_delete", Dict("env_id" => e.id, "layer_id" => l.id, "items" => deletes))
    end
    TenSnap.broadcast_charts!(scenario)
    TenSnap.broadcast_monitors!(scenario)
end
add_action!(scenario, action("seed_dense", () -> begin seed!(model, 1024); persist(model); publish_population!() end))
add_action!(scenario, action("clear_population", () -> begin clear_population!(model); persist(model); publish_population!() end))
add_chart!(scenario, chart("health", counts;
    label = "Health states",
    series = [
        Dict("id" => "susceptible", "label" => "Susceptible", "color" => "#3498db"),
        Dict("id" => "infected", "label" => "Infected", "color" => "#e74c3c"),
        Dict("id" => "recovered", "label" => "Recovered", "color" => "#2ecc71"),
    ]))
env = environment("study")
add_layer!(env, grid_layer("grid", _ -> Dict{String, Any}[]; data = _ -> Dict("width" => 64, "height" => 64)))
add_layer!(env, agents_layer("agents", m -> m.agents;
    projector = a -> Dict("id" => a.id, "x" => a.x, "y" => a.y,
        "color" => Dict("S" => "#3498db", "I" => "#e74c3c", "R" => "#2ecc71")[a.health],
        "data" => Dict("health" => a.health)),
    data = _ -> Dict("width" => 64, "height" => 64)))
add_environment!(scenario, env)
run!(scenario; verbose = false)
