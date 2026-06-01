@testset "fine-grained CRD helpers" begin
	scenario = Scenario()
	model = ToyModel(ToyAgent[], 0, 0)
	register_model!(scenario, model)
	env = environment("dynamic")
	add_environment!(scenario, env)
	add_layer!(scenario, "dynamic", agents_layer("agents", m -> m.agents; projector = autoagentprojector()))
	@test haskey(scenario.environments, "dynamic")
	@test length(scenario.environments["dynamic"].layers) == 1
	@test remove_layer!(scenario, "dynamic", "agents")
	@test isempty(scenario.environments["dynamic"].layers)
	@test remove_environment!(scenario, "dynamic")
	@test !haskey(scenario.environments, "dynamic")
end
