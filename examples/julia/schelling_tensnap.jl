# Shared scenario factory used by teaching and publication launchers so reset
# and projection semantics have one implementation.
using TenSnap
using Agents

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

	function initialize!(ref::Base.RefValue)
		ref[] = build_model()
		active_gridwidth[] = config.gridwidth
		active_gridheight[] = config.gridheight
		return nothing
	end
	advance!(ref::Base.RefValue) = schelling_model_step!(ref[])
	grid_data(_) = Dict("width" => active_gridwidth[], "height" => active_gridheight[])

	scenario = Scenario(port = port, use_msgpack = use_msgpack)
	register_model!(scenario, model_ref; init = initialize!, step = advance!, reset = initialize!)

	if include_parameters
		function set_similarity_threshold!(value, ref::Base.RefValue)
			config.similarity_threshold = clamp(Float64(value), 0.0, 1.0)
			Agents.abmproperties(ref[]).similarity_threshold = config.similarity_threshold
			return config.similarity_threshold
		end
		add_parameters!(
			scenario,
			parameters_from_fields(model_ref;
				target = _ -> config,
				include = [:gridwidth, :gridheight, :similarity_threshold, :density, :balance],
				rename = Dict(:gridwidth => "gridWidth", :gridheight => "gridHeight"),
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
