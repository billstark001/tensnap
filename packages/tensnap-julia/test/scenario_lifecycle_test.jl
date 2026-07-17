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

@testset "model steps may return their mutated model" begin
	model = ToyModel([ToyAgent(1, 0.0, 0.0)], 2, 0)
	scenario = Scenario()
	register_model!(scenario, model; step = identity)

	@test TenSnap._advance_step!(scenario)
	@test scenario.time_step == 1

	register_model!(scenario, model; step = _ -> false)
	@test !TenSnap._advance_step!(scenario)
end

@testset "declarative monitors and restore hooks" begin
	state = Ref(2)
	restored = Ref(false)
	scenario = Scenario(
		model_id = "monitor-model",
		state_schema_version = "1",
		monitors = [monitor("status", _ -> Dict("value" => state[]); label = "Status", render_hint = "tree")],
		restore_hooks = restore_hooks(payload -> begin
			restored[] = true
			state[] = Int(payload["checkpoint"])
		end; checkpoint_capture = _ -> state[]),
	)
	register_model!(scenario, state)

	@test scenario.monitors["status"].label == "Status"
	@test TenSnap._monitor_payload(scenario.monitors["status"]) == Dict(
		"id" => "status", "label" => "Status", "render_hint" => "tree",
	)
	info = TenSnap._simulator_info_payload(scenario)
	@test info["capabilities"] == ["monitor", "scene.restore.checkpoint", "scene.restore.projected"]
	TenSnap._call0or1(scenario.scene_restore, Dict("checkpoint" => 5))
	@test restored[]
	@test state[] == 5
	@test TenSnap._call0or1(scenario.checkpoint_capture, state) == 5
end

@testset "declarative parameters from fields" begin
	config = ToyConfig(1.5, true, "fast", [ToyAgent(1, 0.0, 0.0)])
	scenario = Scenario()
	register_model!(scenario, Ref(config))

	function set_speed!(value, _model_ref)
		config.speed = clamp(Float64(value), 0.0, 10.0)
	end

	added = add_parameters!(
		scenario,
		parameters_from_fields(scenario.model;
			target = _ -> config,
			include = [:speed, :enabled, :label, :agents],
			metadata = Dict(
				:speed => (; min = 0, max = 10, step = 0.5, label = "Speed",
					allow_runtime_change = false, setter = set_speed!),
			),
			rename = Dict(:enabled => "isEnabled"),
		),
	)
	by_id = scenario.parameters

	@test Set(keys(by_id)) == Set(["speed", "isEnabled", "label"])
	@test length(added) == 3
	@test by_id["speed"].type == "number"
	@test by_id["speed"].label == "Speed"
	@test by_id["speed"].min == 0
	@test by_id["speed"].max == 10
	@test by_id["speed"].step == 0.5
	@test by_id["speed"].allow_runtime_change == false
	@test TenSnap._param_payload(by_id["speed"], scenario.model)["allow_runtime_change"] == false
	@test by_id["isEnabled"].type == "boolean"
	@test by_id["isEnabled"].allow_runtime_change == true
	@test by_id["label"].type == "string"

	TenSnap._set_parameter!(by_id["speed"], 12, scenario.model)
	TenSnap._set_parameter!(by_id["isEnabled"], false, scenario.model)
	TenSnap._set_parameter!(by_id["label"], "slow", scenario.model)

	@test config.speed == 10.0
	@test config.enabled == false
	@test config.label == "slow"

	wrapped = ToyWrapper(config)
	wrapped_params = parameters_from_fields(wrapped;
		include = ["config.speed"],
		rename = Dict("config.speed" => "wrappedSpeed"),
	)
	@test length(wrapped_params) == 1
	@test wrapped_params[1].id == "wrappedSpeed"
	TenSnap._set_parameter!(wrapped_params[1], 4, wrapped)
	@test wrapped.config.speed == 4.0
end

@testset "structural parameters can be staged for the next initialization" begin
	pending = ToyConfig(8.0, true, "pending", ToyAgent[])
	active_speed = Ref(pending.speed)
	model_ref = Ref(pending)

	function init_config!(ref)
		active_speed[] = pending.speed
		ref[] = pending
	end

	function set_pending_speed!(value, _ref)
		pending.speed = Float64(value)
	end

	scenario = Scenario()
	register_model!(scenario, model_ref; init = init_config!, reset = init_config!)
	add_parameters!(
		scenario,
		parameters_from_fields(model_ref;
			target = _ -> pending,
			include = [:speed],
			metadata = Dict(:speed => (; allow_runtime_change = false, setter = set_pending_speed!)),
		),
	)

	@test active_speed[] == 8.0
	TenSnap._set_parameter!(scenario.parameters["speed"], 3.0, scenario.model)
	@test pending.speed == 3.0
	@test active_speed[] == 8.0

	reset!(scenario)
	@test active_speed[] == 3.0
end

@testset "declarative parameters support target selectors and read-only targets" begin
	model_ref = Ref(Dict(:threshold => 0.25, "mode" => "low"))
	params = parameters_from_fields(model_ref;
		target = r -> r[],
		include = [:threshold, :mode],
		metadata = Dict(
			:threshold => (; min = 0, max = 1, step = 0.05),
			:mode => (; options = ["low", "high"]),
		),
	)
	by_id = Dict(p.id => p for p in params)

	@test by_id["threshold"].type == "number"
	@test by_id["mode"].type == "enum"
	@test by_id["mode"].options == ["low", "high"]

	TenSnap._set_parameter!(by_id["threshold"], 0.5, model_ref)
	TenSnap._set_parameter!(by_id["mode"], "high", model_ref)

	@test model_ref[][:threshold] == 0.5
	@test model_ref[]["mode"] == "high"

	read_only = (count = 3,)
	read_only_params = parameters_from_fields(read_only; include = [:count])
	@test length(read_only_params) == 1
	@test read_only_params[1].setter === nothing
end
