#=
Focused projection/publication benchmarks without sockets or rendering.

julia --project=packages/tensnap-julia packages/tensnap-julia/benchmarks/projection_ownership.jl --count=1000 --mode=builtin --shape=nested --changes=changed
Options: count, mode (builtin/boundary/custom/owned/double/all), shape (scalar/nested),
changes (changed/unchanged), iterations, repeat, phase (diff/sync/encode), encoding.
=#
using TenSnap
using JSON3
using Statistics

function benchmark(options)
  count = parse(Int, get(options, "count", "1000"))
  iterations = parse(Int, get(options, "iterations", "50"))
  repeat = parse(Int, get(options, "repeat", "5"))
  min(count, iterations, repeat) > 0 || error("counts must be positive")
  shape = get(options, "shape", "nested")
  shape in ("nested", "scalar") || error("shape must be nested or scalar")
  change = get(options, "changes", "changed")
  change in ("changed", "unchanged") || error("changes must be changed or unchanged")
  phase = get(options, "phase", "diff")
  phase in ("diff", "sync", "encode") || error("phase must be diff, sync, or encode")
  encoding = get(options, "encoding", "msgpack")
  encoding in ("json", "msgpack") || error("encoding must be json or msgpack")
  mode = get(options, "mode", "all")
  modes = mode == "all" ? ("builtin", "boundary", "custom", "owned", "double") : (mode,)
  for mode in modes
    mode in ("builtin", "boundary", "custom", "owned", "double") || error("invalid mode")
    items = [Dict{String,Any}("id" => i, "x" => i) for i = 1:count]
    if shape == "nested"
      for (i, item) in enumerate(items)
        item["data"] = Dict{String,Any}("count" => i, "tags" => ["ready"])
      end
    end
    projector =
      mode == "custom" ? identity :
      mode == "owned" ? item -> deepcopy(item) : dictprojector()
    l = agents_layer(
      "agents",
      identity;
      projector = projector,
      projector_owns_values = mode == "owned" ? true : nothing,
      projector_deep_copy = mode != "boundary",
      deep_copy = mode == "double" ? true : nothing,
    )
    TenSnap._remember_layer_items!(l, TenSnap._layer_items(l, items))
    payload = Dict(
      "env_id" => "world",
      "layer_id" => "agents",
      "items" => collect(values(l.last_items)),
    )
    run = if phase == "encode"
      () -> TenSnap._encode(
        "item_update",
        payload;
        use_msgpack = encoding == "msgpack",
        normalized = true,
      )
    else
      () -> begin
        if change == "changed"
          for i = 1:max(1, count÷100)
            items[i]["x"] += 1
            shape == "nested" && (items[i]["data"]["count"] += 1)
          end
        end
        phase == "sync" ?
        TenSnap._remember_layer_items!(l, TenSnap._layer_items(l, items)) :
        TenSnap._layer_item_deltas!(l, items)
      end
    end
    for _ = 1:20
      run()
    end
    allocations = @allocated run()
    samples = Float64[]
    for _ = 1:repeat
      start = time_ns()
      for _ = 1:iterations
        run()
      end
      push!(samples, (time_ns() - start) / 1e6 / iterations)
    end
    println(
      JSON3.write((;
        count,
        mode,
        shape,
        change,
        phase,
        encoding,
        iterations,
        repeat,
        median_ms_per_pass = median(samples),
        bytes_per_pass = allocations,
        samples_ms_per_pass = samples,
      )),
    )
  end
end

options = Dict{String,String}()
for argument in ARGS
  startswith(argument, "--") && occursin('=', argument) || error("expected --name=value")
  name, value = split(argument[3:end], '='; limit = 2)
  name in
  ("count", "mode", "shape", "changes", "iterations", "repeat", "phase", "encoding") ||
    error("unknown option: $name")
  options[name] = value
end
benchmark(options)
