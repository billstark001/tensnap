# The example owns the native app; this publication wrapper adds only hidden
# revision/state probes and profile environment translation.
const EXAMPLE_DIR = normpath(joinpath(@__DIR__, "../../../../../examples/julia"))
include(joinpath(EXAMPLE_DIR, "utils.jl"))
include(joinpath(EXAMPLE_DIR, "schelling.jl"))
include(joinpath(EXAMPLE_DIR, "schelling_makie_app.jl"))

SCHELLING_DYNAMICS_VERSION == 1 || error("benchmark adapter requires Schelling dynamics v1")

function canonical_state_json(model)
	agents = sort(collect(allagents(model)); by = agent -> agent.agentid)
	items = map(agents) do agent
		x = agent.pos[1] - 1
		y = agent.pos[2] - 1
		color = schelling_group_color(agent.group)
		size = satisfied(agent, model) ? "1" : "0.6"
		return "{\"id\":\"$(agent.agentid)\",\"x\":$x,\"y\":$y,\"color\":\"$color\",\"size\":$size}"
	end
	return "{\"agents\":[" * join(items, ",") * "]}"
end

function benchmark_probe(current_model, revision)
	state_json = @lift(canonical_state_json($current_model))
	return DOM.div(
		DOM.span(revision; id = "tensnap-benchmark-revision", style = "display:none"),
		DOM.span(state_json; id = "tensnap-benchmark-state", style = "display:none"),
	)
end

config = SchellingConfig(
	gridwidth = parse_env(Int, "TENSNAP_SCHELLING_WIDTH", DEFAULT_GRID_W),
	gridheight = parse_env(Int, "TENSNAP_SCHELLING_HEIGHT", DEFAULT_GRID_H),
	density = parse_env(Float64, "TENSNAP_SCHELLING_DENSITY", DEFAULT_DENSITY),
	balance = parse_env(Float64, "TENSNAP_SCHELLING_BALANCE", DEFAULT_BALANCE),
	similarity_threshold = parse_env(Float64, "TENSNAP_SCHELLING_THRESHOLD", DEFAULT_SIMILARITY_THRESHOLD),
	seed = parse_optional_env(Int, "TENSNAP_SCHELLING_SEED"),
)
host = parse_env(String, "BONITO_HOST", "127.0.0.1")
port = parse_env(Int, "BONITO_PORT", 8768)
app = create_schelling_makie_app(
	config;
	title = "Schelling benchmark subject",
	extra_content = benchmark_probe,
)

server = Bonito.Server(app, host, port)
Bonito.HTTPServer.start(server)
println("Schelling benchmark subject listening on http://$(host):$(port)/")
wait(server)
