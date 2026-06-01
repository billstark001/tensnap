@testset "scenario builders and lifecycle" begin
	model = ToyModel([ToyAgent(1, 0.0, 0.0)], 2, 0)
	scenario = Scenario()
	register_model!(scenario, model;
		init = m -> (m.ticks = 0),
		step = m -> (m.ticks += 1; m.agents[1].x += 1),
		reset = m -> (m.ticks = 0; m.agents[1].x = 0),
	)

	add_parameter!(scenario, parameter("threshold";
		value = model.threshold,
		getter = m -> m.threshold,
		setter = (value, m) -> (m.threshold = Int(value)),
	))
	add_chart!(scenario, chart("ticks", m -> m.ticks))
	env = environment("toy")
	add_layer!(env, agents_layer("agents", m -> m.agents; projector = autoagentprojector()))
	add_environment!(scenario, env)

	@test haskey(scenario.actions, "start")
	@test haskey(scenario.actions, "step")
	@test haskey(scenario.actions, "reset")
	@test scenario.actions["start"].continuous
	@test TenSnap._listen_host("localhost") == "127.0.0.1"

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
