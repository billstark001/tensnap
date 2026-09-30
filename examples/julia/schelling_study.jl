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
	warmup_steps::Int = 0
	steps::Int = 1000
	seeds::Int = 8
	seed::Int = 7
	mode::Symbol = :convergence
end

function option_values(args)::Dict{String, String}
	allowed = Set(["width", "height", "density", "balance", "thresholds", "warmup-steps", "steps", "seeds", "seed", "mode"])
	values = Dict{String, String}()
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
			value = args[index + 1]
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
	thresholds = [parse(Float64, strip(item)) for item in split(raw, ",") if !isempty(strip(item))]
	!isempty(thresholds) || error("at least one threshold is required")
	all(value -> 0 <= value <= 1, thresholds) || error("thresholds must be values from 0 through 1")
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
		warmup_steps = parse(Int, value("warmup-steps", 0)),
		steps = parse(Int, value("steps", 1000)),
		seeds = parse(Int, value("seeds", 8)),
		seed = parse(Int, value("seed", 7)),
		mode = mode,
	)
	options.width > 0 && options.height > 0 || error("width and height must be positive")
	0 <= options.density <= 1 && 0 <= options.balance <= 1 || error("density and balance must be values from 0 through 1")
	options.steps > 0 && options.seeds > 0 || error("steps and seeds must be positive")
	options.warmup_steps >= 0 || error("warmup-steps must be non-negative")
	return options
end

function run_schelling_trial(config::SchellingConfig, steps::Int, mode::Symbol)
	model = initialize_schelling(config)
	steps_run = 0
	converged = false
	started_ns = time_ns()
	for _ in 1:steps
		steps_run += 1
		moving = schelling_model_step!(model)
		if mode == :convergence && !moving
			converged = true
			break
		end
	end
	return (
		threshold = config.similarity_threshold,
		seed = config.seed,
		satisfied = satisfied_pct(model),
		segregation = segregation_index(model),
		last_swapped = Agents.abmproperties(model).last_swapped,
		steps_run = steps_run,
		converged = converged,
		elapsed_ns = time_ns() - started_ns,
	)
end

function run_schelling_study(options::SchellingStudyOptions)
	config_for(threshold, seed) = SchellingConfig(
		gridwidth = options.width,
		gridheight = options.height,
		density = options.density,
		balance = options.balance,
		similarity_threshold = threshold,
		seed = seed,
	)
	if options.warmup_steps > 0
		run_schelling_trial(config_for(options.thresholds[1], options.seed), options.warmup_steps, :steady)
	end

	trials = NamedTuple[]
	rows = NamedTuple[]
	for threshold in options.thresholds
		threshold_trials = [
			run_schelling_trial(config_for(threshold, options.seed + offset), options.steps, options.mode)
			for offset in 0:options.seeds-1
		]
		append!(trials, threshold_trials)
		push!(rows, (
			threshold,
			mean_satisfied = mean(row.satisfied for row in threshold_trials),
			mean_segregation = mean(row.segregation for row in threshold_trials),
			mean_last_swapped = mean(row.last_swapped for row in threshold_trials),
			mean_steps = mean(row.steps_run for row in threshold_trials),
			converged_runs = count(row -> row.converged, threshold_trials),
		))
	end

	total_ticks = sum(row.steps_run for row in trials)
	total_elapsed_ns = sum(row.elapsed_ns for row in trials)
	return (
		options = options,
		trials = trials,
		rows = rows,
		total_ticks = total_ticks,
		total_elapsed_ns = total_elapsed_ns,
		mean_satisfied = mean(row.satisfied for row in trials),
		mean_segregation = mean(row.segregation for row in trials),
		mean_last_swapped = mean(row.last_swapped for row in trials),
		actual_steps = mean(row.steps_run for row in trials),
	)
end

function write_schelling_study_csv(result; io = stdout)
	println(io, "threshold,mean_satisfied_pct,mean_segregation_index,mean_last_swapped,mean_steps,converged_runs")
	for row in result.rows
		@printf(io, "%.2f,%.4f,%.4f,%.2f,%.2f,%d\n", row.threshold, row.mean_satisfied, row.mean_segregation, row.mean_last_swapped, row.mean_steps, row.converged_runs)
	end
	elapsed_ms = result.total_elapsed_ns / 1_000_000
	tpms = result.total_elapsed_ns == 0 ? 0.0 : result.total_ticks / elapsed_ms
	mspt = result.total_ticks == 0 ? 0.0 : elapsed_ms / result.total_ticks
	println(io, "performance_metric,total_ticks,elapsed_ms,tpms,mspt")
	@printf(io, "performance,%d,%.3f,%.6f,%.6f\n", result.total_ticks, elapsed_ms, tpms, mspt)
	return nothing
end
