# TenSnap visualization entry point for the El Farol Bar Problem.
#
# Run from the repository root:
#   pnpm --dir examples/julia run demo:el-farol
# Then connect the TenSnap web UI or tensnap-agent to ws://localhost:8765.

using TenSnap

include("utils.jl")
include("el_farol.jl")

server_port = parse_env(Int, "TENSNAP_SERVER_PORT", 8765)
use_msgpack = parse_env(Bool, "TENSNAP_USE_MSGPACK", true)

model = make_model()
scenario = Scenario(port=server_port, use_msgpack=use_msgpack)
register_model!(scenario, model; init=initialize!, step=advance!, reset=initialize!)

add_parameter!(scenario, parameter("capacity";
    label="Bar capacity",
    type="number",
    value=model.capacity,
    min=1,
    max=100,
    step=1,
    getter=m -> m.capacity,
    setter=(v, m) -> (m.capacity = Int(round(v))),
))

add_chart!(scenario, chart("attendance", m -> m.attendance; label="Attendance", color="#1971c2"))
add_chart!(scenario, chart("capacity", m -> m.capacity; label="Capacity", color="#e03131"))

env = environment("bar"; type="2d")
add_layer!(env, agents_layer("patrons", m -> m.agents;
    projector=autoagentprojector(
        color=a -> a.attending ? "#2f9e44" : "#adb5bd",
        size=a -> a.attending ? 7 : 5,
        fields=[:expected, :score],
    ),
    data=m -> Dict("width" => 100, "height" => 100),
))
add_environment!(scenario, env)

@info "Starting El Farol TenSnap server" url="ws://localhost:$server_port"
run!(scenario)
