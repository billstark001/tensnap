# TenSnap visualization entry point for the El Farol Bar Problem.
# Run from the repository root with: pnpm --dir examples/julia run demo:el-farol

using TenSnap

include("utils.jl")
include("el_farol.jl")
include("el_farol_state.jl")

server_port = parse_env(Int, "TENSNAP_SERVER_PORT", 8765)
use_msgpack = parse_env(Bool, "TENSNAP_USE_MSGPACK", true)
model = make_model()

scenario = Scenario(
    port=server_port,
    use_msgpack=use_msgpack,
    model_id="examples.julia.el_farol",
    state_schema_version="1",
    restore_hooks=restore_hooks(scene_restore();
        checkpoint_capture=capture_bar,
        checkpoint_restore=data -> restore_bar!(data, model)),
)
register_model!(scenario, model; init=initialize!, step=advance!, reset=initialize!)

add_parameter!(scenario, parameter("capacity";
    label="Bar capacity", value=model.capacity, min=1, max=100, step=1,
    getter=m -> m.capacity,
    setter=(value, m) -> (m.capacity = Int(round(value))),
))

add_chart!(scenario, chart("attendance", m -> (m.attendance, m.capacity);
    label="Attendance and capacity",
    series=[
        Dict("id" => "attendance", "label" => "Attendance", "color" => "#1971c2"),
        Dict("id" => "capacity", "label" => "Capacity", "color" => "#e03131"),
    ],
))

add_monitor!(scenario, monitor("bar_status", m -> Dict(
    "attending" => m.attendance,
    "not_attending" => length(m.agents) - m.attendance,
    "capacity" => m.capacity,
    "over_capacity" => max(m.attendance - m.capacity, 0),
); label="Bar status", render_hint="table"))

env = environment("bar"; type="uniform")
add_layer!(env, agents_layer("patrons", m -> m.agents;
    projector=autoagentprojector(
        color=a -> a.attending ? "#2f9e44" : "#adb5bd",
        size=a -> a.attending ? 7 : 5,
        data_fields=[:attending, :expected, :score],
    ),
    restore=(
        replace=restore_patrons!,
        metadata=(data, _) -> isempty(data) || error("Patron layer has no metadata"),
    ),
))
add_environment!(scenario, env)

if abspath(PROGRAM_FILE) == @__FILE__
    @info "Starting El Farol TenSnap server" url="ws://localhost:$server_port"
    run!(scenario)
end
