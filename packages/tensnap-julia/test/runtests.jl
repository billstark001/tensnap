using Test
using TenSnap

mutable struct ToyAgent
    id::Int
    x::Float64
    y::Float64
end

mutable struct ToyModel
    agents::Vector{ToyAgent}
    threshold::Int
    ticks::Int
end

@testset "projectors" begin
    agent = (id=7, pos=(2.5, 3.5), attending=true, score=4)
    projected = autoagentprojector(color=a -> a.attending ? "green" : "gray", fields=[:score])(agent)
    @test projected["id"] == 7
    @test projected["x"] == 2.5
    @test projected["y"] == 3.5
    @test projected["color"] == "green"
    @test projected["score"] == 4

    data = Dict(:id => 1, :wealth => 12)
    @test dictprojector([:id, :wealth]; rename=Dict(:wealth => :value))(data) == Dict("id" => 1, "value" => 12)
end

@testset "scenario builders and lifecycle" begin
    model = ToyModel([ToyAgent(1, 0.0, 0.0)], 2, 0)
    scenario = Scenario()
    register_model!(scenario, model;
        init=m -> (m.ticks = 0),
        step=m -> (m.ticks += 1; m.agents[1].x += 1),
        reset=m -> (m.ticks = 0; m.agents[1].x = 0),
    )

    add_parameter!(scenario, parameter("threshold";
        value=model.threshold,
        getter=m -> m.threshold,
        setter=(value, m) -> (m.threshold = Int(value)),
    ))
    add_chart!(scenario, chart("ticks", m -> m.ticks))
    env = environment("toy")
    add_layer!(env, agents_layer("agents", m -> m.agents; projector=autoagentprojector()))
    add_environment!(scenario, env)

    @test haskey(scenario.actions, "start")
    @test haskey(scenario.actions, "step")
    @test haskey(scenario.actions, "reset")
    @test scenario.actions["start"].continuous

    sync!(scenario)
    @test length(env.layers[1].last_items) == 1

    step!(scenario)
    @test scenario.time_step == 1
    @test model.ticks == 1
    @test model.agents[1].x == 1

    TenSnap._set_parameter!(scenario.parameters["threshold"], 5, scenario.model)
    @test model.threshold == 5

    reset!(scenario)
    @test scenario.time_step == 0
    @test model.ticks == 0
    @test model.agents[1].x == 0
end

@testset "incremental layer diffing" begin
    model = ToyModel([ToyAgent(1, 0.0, 0.0), ToyAgent(2, 2.0, 2.0)], 2, 0)
    scenario = Scenario()
    register_model!(scenario, model)
    env = environment("toy")
    l = agents_layer("agents", m -> m.agents; projector=autoagentprojector())
    add_layer!(env, l)
    add_environment!(scenario, env)

    sync!(scenario)
    model.agents[1].x = 1.0
    pop!(model.agents)
    push!(model.agents, ToyAgent(3, 3.0, 3.0))
    delta = replace_layer_items!(scenario, "toy", "agents")
    @test length(delta.creates) == 1
    @test delta.creates[1]["id"] == 3
    @test length(delta.updates) == 1
    @test delta.updates[1]["id"] == 1
    @test delta.deletes == [2]
end

@testset "asset cache" begin
    scenario = Scenario()
    asset = publish_asset!(scenario, "logo", "hello", "text/plain"; label="Greeting")
    @test haskey(scenario.assets, "logo")
    @test asset.size == 5
    @test asset.label == "Greeting"
    @test publish_asset!(scenario, "logo", "hello", "text/plain") === asset
    @test delete_asset!(scenario, "logo")
    @test !haskey(scenario.assets, "logo")
end

@testset "fine-grained CRD helpers" begin
    scenario = Scenario()
    model = ToyModel(ToyAgent[], 0, 0)
    register_model!(scenario, model)
    env = environment("dynamic")
    add_environment!(scenario, env)
    add_layer!(scenario, "dynamic", agents_layer("agents", m -> m.agents; projector=autoagentprojector()))
    @test haskey(scenario.environments, "dynamic")
    @test length(scenario.environments["dynamic"].layers) == 1
    @test remove_layer!(scenario, "dynamic", "agents")
    @test isempty(scenario.environments["dynamic"].layers)
    @test remove_environment!(scenario, "dynamic")
    @test !haskey(scenario.environments, "dynamic")
end

@testset "El Farol dynamics stay TenSnap-free" begin
    include(joinpath(@__DIR__, "..", "..", "..", "examples", "julia", "el_farol.jl"))
    model = make_model(n=20, capacity=12, seed=7)
    initialize!(model)
    @test model.attendance == 0
    @test isempty(model.history)
    advance!(model)
    @test length(model.history) == 1
    @test 0 <= model.attendance <= length(model.agents)
end
