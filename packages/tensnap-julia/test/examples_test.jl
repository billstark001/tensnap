@testset "El Farol dynamics stay TenSnap-free" begin
	include(joinpath(@__DIR__, "..", "..", "..", "examples", "julia", "el_farol.jl"))
	model = make_model(n = 20, capacity = 12, seed = 7)
	initialize!(model)
	@test model.attendance == 0
	@test isempty(model.history)
	@test !hasproperty(first(model.agents), :x)
	@test !hasproperty(first(model.agents), :y)
	advance!(model)
	@test length(model.history) == 1
	@test 0 <= model.attendance <= length(model.agents)
end

module ElFarolVizFixture
    include(joinpath(@__DIR__, "..", "..", "..", "examples", "julia", "el_farol_viz.jl"))
end

@testset "El Farol declarations retain parameters, chart, monitor, and restoration" begin
    s = ElFarolVizFixture.scenario
    @test haskey(s.parameters, "capacity")
    @test TenSnap._param_value(s.parameters["capacity"], s.model) == 60
    @test haskey(s.charts, "attendance")
    @test [series["id"] for series in s.charts["attendance"].series] == ["attendance", "capacity"]
    @test haskey(s.monitors, "bar_status")
    @test s.monitors["bar_status"].getter(s.model)["capacity"] == 60
    @test "monitor" in TenSnap._simulator_info_payload(s)["capabilities"]
    @test s.environments["bar"].layers[1].restore.replace !== nothing
    @test s.environments["bar"].layers[1].restore.metadata !== nothing

    TenSnap._set_parameter!(s.parameters["capacity"], 55, s.model)
    @test s.monitors["bar_status"].getter(s.model)["capacity"] == 55
    chart = s.charts["attendance"]
    values = TenSnap._chart_updates(chart, chart.getter(s.model), 0)
    @test Dict(entry["id"] => entry["value"] for entry in values) ==
        Dict("attendance" => 0, "capacity" => 55)
end

@testset "El Farol checkpoint resumes the same stochastic next step" begin
    model = ElFarolVizFixture.make_model(n=20, capacity=12, seed=7)
    ElFarolVizFixture.initialize!(model)
    for _ in 1:3
        ElFarolVizFixture.advance!(model)
    end
    saved = ElFarolVizFixture.capture_bar(model)
    ElFarolVizFixture.advance!(model)
    expected = (attendance=model.attendance, history=copy(model.history),
        patrons=[(a.id, a.attending, a.expected, a.score) for a in model.agents])
    @test model.attendance == count(a -> a.attending, model.agents)
    ElFarolVizFixture.restore_bar!(saved, model)
    ElFarolVizFixture.advance!(model)
    @test (attendance=model.attendance, history=model.history,
        patrons=[(a.id, a.attending, a.expected, a.score) for a in model.agents]) == expected
end
