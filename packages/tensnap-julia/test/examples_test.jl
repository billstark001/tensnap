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
