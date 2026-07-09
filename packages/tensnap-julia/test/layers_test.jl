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

@testset "built-in layer constructor coverage" begin
	trails = trajectory_layer("trails"; data = _ -> Dict("length" => 12))
	@test trails.type == "trajectory"
	@test trails.dependency_layer_ids["agent"] == "agents"
	@test trails.item_key_fields == ["id"]

	background = background_layer("background"; data = _ -> Dict("background" => "asset://map"))
	@test background.type == "background"
	@test isempty(background.item_key_fields)
	@test TenSnap._layer_data(background, nothing)["background"] == "asset://map"
end

@testset "incremental layer source projects changed items only" begin
	model = ToyModel([ToyAgent(1, 0.0, 0.0), ToyAgent(2, 2.0, 2.0)], 2, 0)
	changed_ids = Set{Int}()
	project_calls = Ref(0)
	projector = a -> begin
		project_calls[] += 1
		Dict("id" => a.id, "x" => a.x, "y" => a.y)
	end
	scenario = Scenario()
	register_model!(scenario, model)
	env = environment("toy")
	l = agents_layer("agents", m -> m.agents;
		projector = projector,
		item_id = a -> a.id,
		changed = a -> a.id in changed_ids,
	)
	add_layer!(env, l)
	add_environment!(scenario, env)

	@test project_calls[] == 2
	project_calls[] = 0
	model.agents[1].x = 1.0
	push!(changed_ids, 1)
	delta = replace_layer_items!(scenario, "toy", "agents")

	@test project_calls[] == 1
	@test isempty(delta.creates)
	@test length(delta.updates) == 1
	@test delta.updates[1] == Dict("id" => 1, "x" => 1.0)
	@test isempty(delta.deletes)
end
