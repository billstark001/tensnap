# This user launcher calls the native-app factory also used by the benchmark
# wrapper. Only that wrapper adds hidden probes; the split is a reuse choice.
include("utils.jl")
include("schelling.jl")
include("schelling_makie_app.jl")

config = SchellingConfig(
	gridwidth = parse_env(Int, "TENSNAP_SCHELLING_WIDTH", DEFAULT_GRID_W),
	gridheight = parse_env(Int, "TENSNAP_SCHELLING_HEIGHT", DEFAULT_GRID_H),
	density = parse_env(Float64, "TENSNAP_SCHELLING_DENSITY", DEFAULT_DENSITY),
	balance = parse_env(Float64, "TENSNAP_SCHELLING_BALANCE", DEFAULT_BALANCE),
	similarity_threshold = parse_env(Float64, "TENSNAP_SCHELLING_THRESHOLD", DEFAULT_SIMILARITY_THRESHOLD),
	seed = parse_optional_env(Int, "TENSNAP_SCHELLING_SEED"),
)
host = parse_env(String, "BONITO_HOST", "127.0.0.1")
port = parse_env(Int, "BONITO_PORT", 8080)
app = create_schelling_makie_app(
	config;
	ticks_per_second = parse_env(Int, "BONITO_TICKS_PER_SECOND", 5),
)

server = Bonito.Server(app, host, port)
Bonito.HTTPServer.start(server)
println("Schelling app listening on http://$(host):$(port)/")
wait(server)
