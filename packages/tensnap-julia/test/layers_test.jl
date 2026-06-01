@testset "incremental layer diffing" begin
	model = ToyModel([ToyAgent(1, 0.0, 0.0), ToyAgent(2, 2.0, 2.0)], 2, 0)
	scenario = Scenario()
	register_model!(scenario, model)
	env = environment("toy")
	l = agents_layer("agents", m -> m.agents; projector = autoagentprojector())
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
	@test delta.updates[1]["x"] == 1.0
	@test !haskey(delta.updates[1], "y")
	@test delta.deletes == [2]
end

@testset "layer metadata diffing" begin
	model = ToyModel([ToyAgent(1, 0.0, 0.0)], 2, 0)
	scenario = Scenario()
	register_model!(scenario, model)
	l = agents_layer("agents", m -> m.agents;
		projector = autoagentprojector(),
		data = m -> Dict("width" => m.threshold, "height" => 10),
	)
	env = environment("toy"; layers = [l])
	add_environment!(scenario, env)
	sync!(scenario)

	@test l.last_data == Dict("width" => 2, "height" => 10)
	model.threshold = 5
	delta = TenSnap._layer_data_delta!(l, model)
	@test delta == Dict("width" => 5, "height" => 10)
	@test TenSnap._layer_data_delta!(l, model) === nothing
end
