# TenSnap visualization entry point for the Schelling segregation model.
#
# Run from the repository root:
#   pnpm --dir examples/julia run demo:schelling
# Then connect the TenSnap web UI or tensnap-agent to ws://localhost:8765.

using TenSnap

include("utils.jl")
include("schelling.jl")

const GRIDWIDTH = parse_env(Int, "TENSNAP_SCHELLING_WIDTH", DEFAULT_GRID_W)
const GRIDHEIGHT = parse_env(Int, "TENSNAP_SCHELLING_HEIGHT", DEFAULT_GRID_H)
const DENSITY = Ref(parse_env(Float64, "TENSNAP_SCHELLING_DENSITY", DEFAULT_DENSITY))
const SIMILARITY_THRESHOLD = Ref(parse_env(Float64, "TENSNAP_SCHELLING_THRESHOLD", DEFAULT_SIMILARITY_THRESHOLD))
const SEED = parse_optional_env(Int, "TENSNAP_SCHELLING_SEED")

function build_model()
	return initialize_schelling(
		gridwidth = GRIDWIDTH,
		gridheight = GRIDHEIGHT,
		density = DENSITY[],
		similarity_threshold = SIMILARITY_THRESHOLD[],
		seed = SEED,
	)
end

function initialize!(model_ref::Base.RefValue)
	model_ref[] = build_model()
	return nothing
end

function advance!(model_ref::Base.RefValue)
	Agents.step!(model_ref[])
	return nothing
end

function set_similarity_threshold!(value, model_ref::Base.RefValue)
	SIMILARITY_THRESHOLD[] = clamp(Float64(value), 0.0, 1.0)
	Agents.abmproperties(model_ref[]).similarity_threshold = SIMILARITY_THRESHOLD[]
	return SIMILARITY_THRESHOLD[]
end

function set_density!(value, model_ref::Base.RefValue)
	DENSITY[] = clamp(Float64(value), 0.0, 1.0)
	initialize!(model_ref)
	return DENSITY[]
end

grid_data(_) = Dict("width" => GRIDWIDTH, "height" => GRIDHEIGHT)

function group_color(group::Int)
	return group == 1 ? "#3498db" : "#e74c3c"
end

server_port = parse_env(Int, "TENSNAP_SERVER_PORT", 8765)
use_msgpack = parse_env(Bool, "TENSNAP_USE_MSGPACK", true)

# TenSnap callbacks receive one model object; a Ref keeps this example small while reset/density changes replace the Agents.jl model.
model_ref = Ref(build_model())

scenario = Scenario(port = server_port, use_msgpack = use_msgpack)
register_model!(scenario, model_ref; init = initialize!, step = advance!, reset = initialize!)

add_parameter!(
	scenario,
	parameter("similarity_threshold";
		label = "Similarity threshold",
		type = "number",
		value = SIMILARITY_THRESHOLD[],
		min = 0,
		max = 1,
		step = 0.01,
		getter = r -> Agents.abmproperties(r[]).similarity_threshold,
		setter = set_similarity_threshold!,
	),
)

add_parameter!(scenario, parameter("density";
	label = "Density",
	type = "number",
	value = DENSITY[],
	min = 0,
	max = 1,
	step = 0.01,
	getter = _ -> DENSITY[],
	setter = set_density!,
))

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
run!(scenario)
