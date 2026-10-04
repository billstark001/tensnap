# Shared scenario factory used by teaching and publication launchers so reset
# and projection semantics have one implementation.
using TenSnap
using Agents
using Serialization
if !isempty(get(ENV, "TENSNAP_SCHELLING_AUDIT_STATE", ""))
	# Publication audit only; ordinary example imports skip this module.
	include("schelling_audit.jl")
end

"""Build a Schelling scenario; callers choose the pedagogical features they need."""
function create_schelling_scenario(
	config::SchellingConfig;
	port::Int = 8765,
	use_msgpack::Bool = true,
	include_parameters::Bool = true,
	include_charts::Bool = true,
)
	active_gridwidth = Ref(config.gridwidth)
	active_gridheight = Ref(config.gridheight)
	build_model() = initialize_schelling(config)
	model_ref = Ref(build_model())
	audit_path = get(ENV, "TENSNAP_SCHELLING_AUDIT_STATE", "")
	audit! = _ -> nothing
	if !isempty(audit_path)
		audit! = model -> write_schelling_audit!(audit_path, model, config)
		audit!(model_ref[])
	end

	function initialize!(ref::Base.RefValue)
		ref[] = build_model()
		active_gridwidth[] = config.gridwidth
		active_gridheight[] = config.gridheight
		audit!(ref[])
		return nothing
	end
	advance! = isempty(audit_path) ?
		(ref::Base.RefValue) -> schelling_model_step!(ref[]) :
		(ref::Base.RefValue) -> begin
			changed = schelling_model_step!(ref[])
			audit!(ref[])
			changed
		end
	grid_data(_) = Dict("width" => active_gridwidth[], "height" => active_gridheight[])

	function capture_checkpoint(_)
		# Optional exact replay for the publication experiment. A shorter projected
		# scene restore could recover visible state, but not necessarily RNG state.
		io = IOBuffer()
		serialize(io, (model_ref[], deepcopy(config)))
		return bytes2hex(take!(io))
	end
	function restore_checkpoint(data)
		data isa AbstractString || error("Schelling checkpoint must be a hex string")
		model, saved_config = deserialize(IOBuffer(hex2bytes(data)))
		model isa typeof(model_ref[]) || error("Schelling checkpoint model type mismatch")
		saved_config isa SchellingConfig || error("Schelling checkpoint config type mismatch")
		model_ref[] = model
		for field in fieldnames(SchellingConfig)
			setfield!(config, field, getfield(saved_config, field))
		end
		active_gridwidth[] = config.gridwidth
		active_gridheight[] = config.gridheight
		scenario_ref[].time_step = Agents.abmproperties(model).tick
		audit!(model_ref[])
		return nothing
	end

	scenario_ref = Ref{Scenario}()
	scenario = Scenario(port = port, use_msgpack = use_msgpack,
		model_id = "examples.schelling", state_schema_version = "2",
		checkpoint_capture = capture_checkpoint, checkpoint_restore = restore_checkpoint)
	scenario_ref[] = scenario
	register_model!(scenario, model_ref; init = initialize!, step = advance!, reset = initialize!)

	if include_parameters
		function set_similarity_threshold!(value, ref::Base.RefValue)
			config.similarity_threshold = clamp(Float64(value), 0.0, 1.0)
			Agents.abmproperties(ref[]).similarity_threshold = config.similarity_threshold
			audit!(ref[])
			return config.similarity_threshold
		end
		add_parameters!(
			scenario,
			parameters_from_fields(model_ref;
				target = _ -> config,
				include = [:gridwidth, :gridheight, :similarity_threshold, :density, :balance],
				rename = Dict(:gridwidth => "gridWidth", :gridheight => "gridHeight",
					:similarity_threshold => "similarityThreshold"),
				metadata = Dict(
					:gridwidth => (; label = "Grid Width", min = 10, max = 200, step = 1, allow_runtime_change = false),
					:gridheight => (; label = "Grid Height", min = 10, max = 200, step = 1, allow_runtime_change = false),
					:similarity_threshold => (; label = "Similarity threshold", min = 0, max = 1, step = 0.01, setter = set_similarity_threshold!),
					:density => (; label = "Density", min = 0, max = 1, step = 0.01, allow_runtime_change = false),
					:balance => (; label = "Balance", min = 0, max = 1, step = 0.01, allow_runtime_change = false),
				),
			),
		)
	end

	if include_charts
		add_chart!(scenario, chart("satisfaction_rate", ref -> satisfied_pct(ref[]); label = "Satisfaction Rate", color = "#2f9e44"))
		add_chart!(scenario, chart("segregation_index", ref -> segregation_index(ref[]); label = "Segregation Index", color = "#e8590c"))
		add_chart!(scenario, chart("moved", ref -> Agents.abmproperties(ref[]).last_swapped; label = "Moved Agents", color = "#5f3dc4"))
	end

	agent_projector = autoagentprojector(
		id = :agentid,
		x = agent -> agent.pos[1] - 1,
		y = agent -> agent.pos[2] - 1,
		color = agent -> schelling_group_color(agent.group),
		size = agent -> satisfied(agent, model_ref[]) ? 1.0 : 0.6,
		fields = [:group],
	)
	env = environment("main"; type = "2d")
	add_layer!(env, grid_layer("grid", _ -> Dict{String, Any}[]; data = grid_data))
	add_layer!(env, agents_layer("agents", ref -> Agents.allagents(ref[]); projector = agent_projector, data = grid_data))
	add_environment!(scenario, env)
	return scenario
end
