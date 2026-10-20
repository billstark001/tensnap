using Test
using Random
using Agents
using TenSnap
include("schelling.jl")
include("schelling_study.jl")
include("schelling_tensnap.jl")
include("el_farol.jl")
include("el_farol_state.jl")

population(model) = sort([(a.id, a.pos, a.group) for a in allagents(model)]; by=first)

@testset "Agents.jl owns time and randomness" begin
    a = initialize_schelling(gridwidth=9,gridheight=7,seed=7)
    b = initialize_schelling(gridwidth=9,gridheight=7,seed=7)
    other = initialize_schelling(gridwidth=9,gridheight=7,seed=29)
    for tick in 1:8
        @test population(a) == population(b)
        saved_rng = deepcopy(abmrng(a))
        satisfied_pct(a); segregation_index(a)
        @test rand(deepcopy(saved_rng), UInt64) == rand(deepcopy(abmrng(a)), UInt64)
        advance_schelling!(a); advance_schelling!(other); advance_schelling!(b)
        @test abmtime(a) == tick
        @test population(a) == population(b)
    end
    jammed = run_schelling_trial(SchellingConfig(gridwidth=5,gridheight=5,density=1,similarity_threshold=1,seed=7),10,:convergence)
    @test jammed.termination == :jammed
    @test jammed.satisfied < 1
end

@testset "Seed is an initialization parameter; checkpoint restores exact continuation" begin
    config = SchellingConfig(gridwidth=9,gridheight=7,seed=7)
    observations = Ref(0)
    scenario = create_schelling_scenario(config; observe=_ -> (observations[] += 1))
    @test !scenario.parameters["seed"].allow_runtime_change
    scenario.init(scenario.model)
    initial = population(scenario.model[])
    for _ in 1:3; scenario.step(scenario.model); end
    saved = scenario.checkpoint_capture(scenario.model)
    for _ in 1:4; scenario.step(scenario.model); end
    expected = population(scenario.model[])
    rng = deepcopy(abmrng(scenario.model[]))
    scenario.checkpoint_restore(saved)
    @test scenario.time_step == abmtime(scenario.model[]) == 3
    for _ in 1:4; scenario.step(scenario.model); end
    @test population(scenario.model[]) == expected
    @test rand(deepcopy(abmrng(scenario.model[])), UInt64) == rand(rng, UInt64)
    scenario.reset(scenario.model)
    @test population(scenario.model[]) == initial
    @test abmtime(scenario.model[]) == 0
    @test observations[] > 0
end

@testset "Adaptive bar resets its own RNG and restores the future" begin
    a = make_model(seed=7); b = make_model(seed=7); other = make_model(seed=29)
    initialize!(a); initialize!(b)
    initial = capture_bar(a)
    for _ in 1:4; advance!(a); advance!(other); advance!(b); end
    @test a.history == b.history
    saved = capture_bar(a)
    for _ in 1:4; advance!(a); end
    expected = capture_bar(a)
    restore_bar!(saved,a)
    for _ in 1:4; advance!(a); end
    @test capture_bar(a) == expected
    initialize!(a)
    @test capture_bar(a) == initial
end
