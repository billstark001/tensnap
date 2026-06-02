# TenSnap visualization entry point for the Schelling segregation model.
#
# Run from the repository root:
#   pnpm --dir examples/julia run demo:schelling
# Then connect the TenSnap web UI or tensnap-agent to ws://localhost:8765.

using TenSnap

include("utils.jl")
include("schelling.jl")

mutable struct SchellingParameterConfig
	gridwidth::Int
	gridheight::Int
	density::Float64
	balance::Float64
	similarity_threshold::Float64
end

const PARAMS = SchellingParameterConfig(
	parse_env(Int, "TENSNAP_SCHELLING_WIDTH", DEFAULT_GRID_W),
	parse_env(Int, "TENSNAP_SCHELLING_HEIGHT", DEFAULT_GRID_H),
	parse_env(Float64, "TENSNAP_SCHELLING_DENSITY", DEFAULT_DENSITY),
	parse_env(Float64, "TENSNAP_SCHELLING_BALANCE", DEFAULT_BALANCE),
	parse_env(Float64, "TENSNAP_SCHELLING_THRESHOLD", DEFAULT_SIMILARITY_THRESHOLD),
)
const ACTIVE_GRIDWIDTH = Ref(PARAMS.gridwidth)
const ACTIVE_GRIDHEIGHT = Ref(PARAMS.gridheight)
const SEED = parse_optional_env(Int, "TENSNAP_SCHELLING_SEED")

function build_model()
	return initialize_schelling(
		gridwidth = PARAMS.gridwidth,
		gridheight = PARAMS.gridheight,
		density = PARAMS.density,
		balance = PARAMS.balance,
		similarity_threshold = PARAMS.similarity_threshold,
		seed = SEED,
	)
end

function initialize!(model_ref::Base.RefValue)
	model_ref[] = build_model()
	ACTIVE_GRIDWIDTH[] = PARAMS.gridwidth
	ACTIVE_GRIDHEIGHT[] = PARAMS.gridheight
	return nothing
end

function advance!(model_ref::Base.RefValue)
	return schelling_model_step!(model_ref[])
end

function set_similarity_threshold!(value, model_ref::Base.RefValue)
	PARAMS.similarity_threshold = clamp(Float64(value), 0.0, 1.0)
	Agents.abmproperties(model_ref[]).similarity_threshold = PARAMS.similarity_threshold
	return PARAMS.similarity_threshold
end

grid_data(_) = Dict("width" => ACTIVE_GRIDWIDTH[], "height" => ACTIVE_GRIDHEIGHT[])

function group_color(group::Int)
	return group == 1 ? "#3498db" : "#e74c3c"
end

server_port = parse_env(Int, "TENSNAP_SERVER_PORT", 8765)
use_msgpack = parse_env(Bool, "TENSNAP_USE_MSGPACK", true)

# TenSnap callbacks receive one model object; a Ref keeps this example small.
# Structural parameter edits update PARAMS and become visible on the next reset/init.
model_ref = Ref(build_model())

scenario = Scenario(port = server_port, use_msgpack = use_msgpack)
register_model!(scenario, model_ref; init = initialize!, step = advance!, reset = initialize!)

add_parameters!(
	scenario,
	parameters_from_fields(model_ref;
		target = _ -> PARAMS,
		include = [:gridwidth, :gridheight, :similarity_threshold, :density, :balance],
		rename = Dict(
			:gridwidth => "gridWidth",
			:gridheight => "gridHeight",
		),
		metadata = Dict(
			:gridwidth => (; label = "Grid Width", min = 10, max = 200, step = 1,
				allow_runtime_change = false),
			:gridheight => (; label = "Grid Height", min = 10, max = 200, step = 1,
				allow_runtime_change = false),
			:similarity_threshold => (; label = "Similarity threshold", min = 0,
				max = 1, step = 0.01, setter = set_similarity_threshold!),
			:density => (; label = "Density", min = 0, max = 1, step = 0.01,
				allow_runtime_change = false),
			:balance => (; label = "Balance", min = 0, max = 1, step = 0.01,
				allow_runtime_change = false),
		),
	),
)

add_chart!(scenario, chart("satisfaction_rate", r -> satisfied_pct(r[]);
	label = "Satisfaction Rate",
	color = "#2f9e44",
))
add_chart!(scenario, chart("segregation_index", r -> segregation_index(r[]);
	label = "Segregation Index",
	color = "#e8590c",
))
add_chart!(scenario, chart("moved", r -> Agents.abmproperties(r[]).last_swapped;
	label = "Moved Agents",
	color = "#5f3dc4",
))

agent_projector = autoagentprojector(
	id = :agentid,
	x = a -> a.pos[1] - 1,
	y = a -> a.pos[2] - 1,
	color = a -> group_color(a.group),
	size = a -> satisfied(a, model_ref[]) ? 1.0 : 0.6,
	fields = [:group],
)

env = environment("main"; type = "2d")
add_layer!(env, grid_layer("grid", _ -> Dict{String, Any}[]; data = grid_data))
add_layer!(env, agents_layer("agents", r -> Agents.allagents(r[]); projector = agent_projector, data = grid_data))
add_environment!(scenario, env)

@info "Starting Schelling TenSnap server" url="ws://localhost:$server_port"
TenSnap.run!(scenario)
