using Printf
using Statistics

include("schelling.jl")

function arg_value(name::String, default::String)::String
	prefix = "--$name="
	for (index, arg) in enumerate(ARGS)
		startswith(arg, prefix) && return arg[length(prefix)+1:end]
		if arg == "--$name" && index < length(ARGS)
			return ARGS[index+1]
		end
	end
	return default
end

parse_thresholds(raw::String) = [parse(Float64, strip(item)) for item in split(raw, ",") if !isempty(strip(item))]

function run_trial(; threshold, seed, steps, width, height, density, balance)
	model = initialize_schelling(
		gridwidth = width,
		gridheight = height,
		density = density,
		balance = balance,
		similarity_threshold = threshold,
		seed = seed,
	)
	steps_run = 0
	converged = false
	for _ in 1:steps
		steps_run += 1
		if !schelling_model_step!(model)
			converged = true
			break
		end
	end
	return (
		satisfied = satisfied_pct(model),
		segregation = segregation_index(model),
		last_swapped = Agents.abmproperties(model).last_swapped,
		steps_run = steps_run,
		converged = converged,
	)
end

function main()
	width = parse(Int, arg_value("width", string(DEFAULT_GRID_W)))
	height = parse(Int, arg_value("height", string(DEFAULT_GRID_H)))
	density = parse(Float64, arg_value("density", string(DEFAULT_DENSITY)))
	balance = parse(Float64, arg_value("balance", string(DEFAULT_BALANCE)))
	steps = parse(Int, arg_value("steps", "200"))
	seeds = parse(Int, arg_value("seeds", "5"))
	seed = parse(Int, arg_value("seed", "7"))
	thresholds = parse_thresholds(arg_value("thresholds", "0.30,0.50,0.70,0.90"))

	println("threshold,mean_satisfied_pct,mean_segregation_index,mean_last_swapped,mean_steps,converged_runs")
	for threshold in thresholds
		rows = [
			run_trial(
				threshold = threshold,
				seed = seed + run - 1,
				steps = steps,
				width = width,
				height = height,
				density = density,
				balance = balance,
			)
			for run in 1:seeds
		]
		@printf(
			"%.2f,%.4f,%.4f,%.2f,%.2f,%d\n",
			threshold,
			mean(row.satisfied for row in rows),
			mean(row.segregation for row in rows),
			mean(row.last_swapped for row in rows),
			mean(row.steps_run for row in rows),
			count(row -> row.converged, rows),
		)
	end
end

main()
