# Publication environment adapter over the example's shared scenario factory.
const EXAMPLE_DIR = normpath(joinpath(@__DIR__, "../../../../../examples/julia"))
include(joinpath(EXAMPLE_DIR, "utils.jl"))
include(joinpath(EXAMPLE_DIR, "schelling.jl"))
include(joinpath(EXAMPLE_DIR, "schelling_tensnap.jl"))

SCHELLING_DYNAMICS_VERSION == 1 || error("benchmark adapter requires Schelling dynamics v1")

config = SchellingConfig(
	gridwidth = parse_env(Int, "TENSNAP_SCHELLING_WIDTH", DEFAULT_GRID_W),
	gridheight = parse_env(Int, "TENSNAP_SCHELLING_HEIGHT", DEFAULT_GRID_H),
	density = parse_env(Float64, "TENSNAP_SCHELLING_DENSITY", DEFAULT_DENSITY),
	balance = parse_env(Float64, "TENSNAP_SCHELLING_BALANCE", DEFAULT_BALANCE),
	similarity_threshold = parse_env(Float64, "TENSNAP_SCHELLING_THRESHOLD", DEFAULT_SIMILARITY_THRESHOLD),
	seed = parse_optional_env(Int, "TENSNAP_SCHELLING_SEED"),
)
server_port = parse_env(Int, "TENSNAP_SERVER_PORT", 8765)
scenario = create_schelling_scenario(
	config;
	port = server_port,
	use_msgpack = true,
	include_parameters = false,
	include_charts = false,
)

@info "Starting Julia Schelling benchmark subject" url="ws://localhost:$server_port"
TenSnap.run!(scenario)
