# Publication JSON/version adapter over the example's shared study.
using Printf

const EXAMPLE_DIR = normpath(joinpath(@__DIR__, "../../../../../examples/julia"))
include(joinpath(EXAMPLE_DIR, "schelling.jl"))
include(joinpath(EXAMPLE_DIR, "schelling_study.jl"))

SCHELLING_DYNAMICS_VERSION == 1 || error("benchmark adapter requires Schelling dynamics v1")

function benchmark_args(args)
  study_args = String[]
  benchmark_json = false
  warmup_steps = 0
  index = 1
  while index <= length(args)
    argument = args[index]
    if argument == "--warmup-steps"
      index += 1
      warmup_steps = parse(Int, args[index])
    elseif startswith(argument, "--warmup-steps=")
      warmup_steps = parse(Int, split(argument, "="; limit = 2)[2])
    elseif argument == "--benchmark-json"
      benchmark_json = true
    elseif startswith(argument, "--benchmark-json=")
      benchmark_json = lowercase(split(argument, "="; limit = 2)[2]) in ("true", "1", "yes")
    elseif argument == "--instrumentation"
      index < length(args) || error("--instrumentation requires a value")
      args[index+1] == "none" || error("instrumentation must be none for the Julia kernel")
      index += 1
    elseif startswith(argument, "--instrumentation=")
      split(argument, "="; limit = 2)[2] == "none" ||
        error("instrumentation must be none for the Julia kernel")
    else
      push!(study_args, argument)
    end
    index += 1
  end
  return study_args, benchmark_json, warmup_steps
end

study_args, benchmark_json, warmup_steps = benchmark_args(ARGS)
options = parse_schelling_study_options(study_args)
warmup_steps >= 0 || error("warmup steps must be nonnegative")
elapsed_ns = Ref(UInt64(0))
function measured_trial(config, steps, mode)
  model = initialize_schelling(config)
  started = time_ns()
  steps_run, stopped = advance_trial!(model, steps, mode)
  elapsed_ns[] += time_ns() - started
  return summarize_trial(model, config, steps_run, stopped)
end
if warmup_steps > 0
  measured_trial(
    SchellingConfig(
      gridwidth = options.width,
      gridheight = options.height,
      density = options.density,
      balance = options.balance,
      similarity_threshold = options.thresholds[1],
      seed = options.seed,
    ),
    warmup_steps,
    :steady,
  )
  elapsed_ns[] = 0
end
result = run_schelling_study(options; trial_runner = measured_trial)
write_schelling_study_csv(result)
elapsed_ms = elapsed_ns[] / 1_000_000
mspt = result.total_ticks == 0 ? 0.0 : elapsed_ms / result.total_ticks
println("performance_metric,total_ticks,elapsed_ms,tpms,mspt")
@printf(
  "performance,%d,%.3f,%.6f,%.6f\n",
  result.total_ticks,
  elapsed_ms,
  elapsed_ms == 0 ? 0 : result.total_ticks / elapsed_ms,
  mspt
)

if benchmark_json
  mspt = result.total_ticks == 0 ? 0.0 : elapsed_ms / result.total_ticks
  valid =
    0 <= result.mean_satisfied <= 1 &&
    0 <= result.mean_segregation <= 1 &&
    0 <= result.mean_last_swapped <= options.width * options.height &&
    1 <= result.actual_steps <= options.steps
  @printf(
    "{\"schemaVersion\":1,\"timingsMs\":[%.9f],\"metrics\":{\"totalTicks\":%d,\"elapsedMs\":%.9f,\"msPerTick\":%.9f},\"state\":{\"mode\":\"%s\",\"instrumentation\":\"none\",\"satisfiedPct\":%.9f,\"segregationIndex\":%.9f,\"lastSwapped\":%.9f,\"actualSteps\":%.9f},\"correctness\":{\"valid\":%s,\"actionCount\":1},\"runtime\":{\"julia\":\"%s\"}}\n",
    elapsed_ms,
    result.total_ticks,
    elapsed_ms,
    mspt,
    string(options.mode),
    result.mean_satisfied,
    result.mean_segregation,
    result.mean_last_swapped,
    result.actual_steps,
    valid ? "true" : "false",
    string(VERSION)
  )
end
