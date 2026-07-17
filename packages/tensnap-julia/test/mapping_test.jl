using JSON3

function _parse_v03_simulator_messages(messages)
	Sys.which("node") === nothing && return
	schema_url = "file://" * joinpath(@__DIR__, "..", "..", "protocol", "dist", "schemas.js")
	script = "const { SimulatorToRendererMessageSchema } = await import(process.argv[1]); for (const message of JSON.parse(process.argv[2])) SimulatorToRendererMessageSchema.parse(message);"
	run(`node --input-type=module -e $script $schema_url $(JSON3.write(messages))`)
end

@testset "v0.3 exact binding mappings" begin
	mutable struct MappingConfig
		speed::Float64
		enabled::Bool
		internal::Vector{Int}
	end
	config = MappingConfig(2.5, true, [1])
	params = parameters_from_fields(config; include = [:speed, :enabled, :internal], metadata = Dict(:speed => (; min = 0, max = 4, step = 0.5)))
	@test [p.id for p in params] == ["speed", "enabled"]
	@test TenSnap._param_payload(params[1], config) == Dict{String, Any}(
		"id" => "speed", "label" => "speed", "type" => "number", "value" => 2.5,
		"allow_runtime_change" => true, "min" => 0, "max" => 4, "step" => 0.5,
	)
	@test TenSnap._param_payload(params[2], config) == Dict{String, Any}(
		"id" => "enabled", "label" => "enabled", "type" => "boolean", "value" => true,
		"allow_runtime_change" => true,
	)
	@test params[1].setter !== nothing
	renamed = parameters_from_fields(config;
		include = [:speed, :enabled], exclude = [:enabled], rename = Dict(:speed => "velocity"))
	@test [p.id for p in renamed] == ["velocity"]
	@test TenSnap._param_payload(renamed[1], config)["value"] == 2.5
	read_only = (count = 3,)
	read_only_params = parameters_from_fields(read_only; include = [:count])
	@test read_only_params[1].setter === nothing

	agent_item = (id = "a", pos = (2, 3), heading = 90, score = 4)
	@test autoagentprojector(fields = [:score])(agent_item) == Dict{String, Any}(
		"id" => "a", "x" => 2, "y" => 3, "heading" => 90, "icon" => "circle", "score" => 4,
	)
	@test dictprojector([:id, :score]; rename = Dict(:score => :value))(agent_item) ==
		Dict{String, Any}("id" => "a", "value" => 4)

	a = action("nudge", _ -> nothing; label = "Nudge", scope = "agent", kwargs = [
		Dict("name" => "amount", "type" => "number", "min" => 0, "max" => 4, "default" => 1),
	])
	@test TenSnap._action_payload(a) == Dict{String, Any}(
		"id" => "nudge", "label" => "Nudge", "scope" => "agent",
		"kwargs" => [Dict("name" => "amount", "type" => "number", "min" => 0, "max" => 4, "default" => 1)],
	)

	c = chart("counts", _ -> Dict("alive" => 2, "dead" => 1); label = "Counts", series = [
		Dict("id" => "alive", "label" => "Alive", "color" => "#16A34A"),
		Dict("id" => "dead", "label" => "Dead", "color" => "#9CA3AF"),
	])
	@test TenSnap._chart_payload(c) == Dict{String, Any}(
		"id" => "counts", "label" => "Counts", "color" => "#228be6",
		"data_list" => c.series,
	)

	edges = edge_layer("edges", _ -> Any[]; data = _ -> Dict("link_distance" => 20))
	layer = TenSnap._layer_payload("world", edges, config)
	@test layer == Dict{String, Any}(
		"env_id" => "world", "layer_id" => "edges", "layer_type" => "edge",
		"dependency_layer_ids" => Dict("agent" => "agents"), "metadata" => Dict("link_distance" => 20),
	)

	scenario = Scenario(model_id = "mapping.julia")
	info = TenSnap._simulator_info_payload(scenario)
	_parse_v03_simulator_messages([
		Dict("type" => "simulator_info", "payload" => info),
		Dict("type" => "param_create", "payload" => TenSnap._param_payload(params[1], config)),
		Dict("type" => "action_create", "payload" => TenSnap._action_payload(a)),
		Dict("type" => "chart_create", "payload" => TenSnap._chart_payload(c)),
		Dict("type" => "env_layer_create", "payload" => layer),
	])
end
