# Reusable scientific loop shared by the user CLI and publication kernel. The
# extraction prevents drift; it is not required by Agents.jl or TenSnap.
using Printf
using Statistics

Base.@kwdef struct SchellingStudyOptions
  width::Int = DEFAULT_GRID_W
  height::Int = DEFAULT_GRID_H
  density::Float64 = DEFAULT_DENSITY
  balance::Float64 = DEFAULT_BALANCE
  thresholds::Vector{Float64} = [0.3, 0.5, 0.7, 0.9]
  steps::Int = 1000
  seeds::Int = 8
  seed::Int = 7
  mode::Symbol = :convergence
end

function option_values(args)::Dict{String,String}
  allowed = Set([
    "width",
    "height",
    "density",
    "balance",
    "thresholds",
    "steps",
    "seeds",
    "seed",
    "mode",
  ])
  values = Dict{String,String}()
  index = 1
  while index <= length(args)
    argument = args[index]
    startswith(argument, "--") || error("unexpected argument: $argument")
    body = argument[3:end]
    if occursin("=", body)
      name, value = split(body, "="; limit = 2)
    else
      name = body
      index < length(args) || error("--$name requires a value")
      value = args[index+1]
      startswith(value, "--") && error("--$name requires a value")
      index += 1
    end
    name in allowed || error("unknown option: --$name")
    values[name] = value
    index += 1
  end
  return values
end

function parse_thresholds(raw::String)::Vector{Float64}
  thresholds =
    [parse(Float64, strip(item)) for item in split(raw, ",") if !isempty(strip(item))]
  !isempty(thresholds) || error("at least one threshold is required")
  all(value -> 0 <= value <= 1, thresholds) ||
    error("thresholds must be values from 0 through 1")
  return thresholds
end

function parse_schelling_study_options(args = ARGS)::SchellingStudyOptions
  values = option_values(args)
  value(name, fallback) = get(values, name, string(fallback))
  mode = Symbol(value("mode", "convergence"))
  mode in (:steady, :convergence) || error("mode must be steady or convergence")
  options = SchellingStudyOptions(
    width = parse(Int, value("width", DEFAULT_GRID_W)),
    height = parse(Int, value("height", DEFAULT_GRID_H)),
    density = parse(Float64, value("density", DEFAULT_DENSITY)),
    balance = parse(Float64, value("balance", DEFAULT_BALANCE)),
    thresholds = parse_thresholds(value("thresholds", "0.30,0.50,0.70,0.90")),
    steps = parse(Int, value("steps", 1000)),
    seeds = parse(Int, value("seeds", 8)),
    seed = parse(Int, value("seed", 7)),
    mode = mode,
  )
  options.width > 0 && options.height > 0 || error("width and height must be positive")
  0 <= options.density <= 1 && 0 <= options.balance <= 1 ||
    error("density and balance must be values from 0 through 1")
  options.steps > 0 && options.seeds > 0 || error("steps and seeds must be positive")
  return options
end

function advance_trial!(model, steps::Int, mode::Symbol)
  for tick = 1:steps
    moving = advance_schelling!(model)
    mode == :convergence && !moving && return (tick, true)
  end
  return (steps, false)
end

function summarize_trial(model, config, steps_run, stopped)
  all_satisfied = all(agent -> satisfied(agent, model), allagents(model))
  return (
    threshold = config.similarity_threshold,
    seed = config.seed,
    satisfied = satisfied_pct(model),
    segregation = segregation_index(model),
    last_swapped = Agents.abmproperties(model).last_swapped,
    steps_run = steps_run,
    termination = stopped ? (all_satisfied ? :satisfied : :jammed) : :limit,
  )
end

function run_schelling_trial(config::SchellingConfig, steps::Int, mode::Symbol)
  model = initialize_schelling(config)
  steps_run, stopped = advance_trial!(model, steps, mode)
  return summarize_trial(model, config, steps_run, stopped)
end

function run_schelling_study(
  options::SchellingStudyOptions;
  trial_runner = run_schelling_trial,
)
  config_for(threshold, seed) = SchellingConfig(
    gridwidth = options.width,
    gridheight = options.height,
    density = options.density,
    balance = options.balance,
    similarity_threshold = threshold,
    seed = seed,
  )

  trials = NamedTuple[]
  rows = NamedTuple[]
  for threshold in options.thresholds
    threshold_trials = [
      trial_runner(
        config_for(threshold, options.seed + offset),
        options.steps,
        options.mode,
      ) for offset = 0:(options.seeds-1)
    ]
    append!(trials, threshold_trials)
    push!(
      rows,
      (
        threshold,
        mean_satisfied = mean(row.satisfied for row in threshold_trials),
        mean_segregation = mean(row.segregation for row in threshold_trials),
        mean_last_swapped = mean(row.last_swapped for row in threshold_trials),
        mean_steps = mean(row.steps_run for row in threshold_trials),
        satisfied_runs = count(row -> row.termination == :satisfied, threshold_trials),
        jammed_runs = count(row -> row.termination == :jammed, threshold_trials),
        limit_runs = count(row -> row.termination == :limit, threshold_trials),
      ),
    )
  end

  total_ticks = sum(row.steps_run for row in trials)
  return (
    options = options,
    trials = trials,
    rows = rows,
    total_ticks = total_ticks,
    mean_satisfied = mean(row.satisfied for row in trials),
    mean_segregation = mean(row.segregation for row in trials),
    mean_last_swapped = mean(row.last_swapped for row in trials),
    actual_steps = mean(row.steps_run for row in trials),
  )
end

function write_schelling_study_csv(result; io = stdout)
  println(
    io,
    "threshold,mean_satisfied_pct,mean_segregation_index,mean_last_swapped,mean_steps,satisfied_runs,jammed_runs,limit_runs",
  )
  for row in result.rows
    @printf(
      io,
      "%.2f,%.4f,%.4f,%.2f,%.2f,%d,%d,%d\n",
      row.threshold,
      row.mean_satisfied,
      row.mean_segregation,
      row.mean_last_swapped,
      row.mean_steps,
      row.satisfied_runs,
      row.jammed_runs,
      row.limit_runs
    )
  end
  return nothing
end
