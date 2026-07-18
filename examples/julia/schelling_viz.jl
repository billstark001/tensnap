# Run from the repository root with:
#   pnpm --dir examples/julia run demo:schelling
#
# This user launcher calls a scenario factory shared with the benchmark server
# so reset/binding behavior has one implementation. The split is not required
# by the Julia binding.

include("utils.jl")
include("schelling.jl")
include("schelling_tensnap.jl")

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
	use_msgpack = parse_env(Bool, "TENSNAP_USE_MSGPACK", true),
)

@info "Starting Schelling TenSnap server" url="ws://localhost:$server_port"
TenSnap.run!(scenario)
