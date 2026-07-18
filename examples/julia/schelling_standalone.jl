using Printf
using Statistics

include("schelling.jl")

const DEFAULT_SCIENTIFIC_STEPS = 1000
const DEFAULT_SCIENTIFIC_SEEDS = 8
const DEFAULT_SCIENTIFIC_THRESHOLDS = "0.30,0.50,0.70,0.90"

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

function run_trial(; threshold, seed, steps, width, height, density, balance, mode)
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
	started_ns = time_ns()
	for _ in 1:steps
		steps_run += 1
		moving = schelling_model_step!(model)
		if mode == "convergence" && !moving
			converged = true
			break
		end
	end
	elapsed_ns = time_ns() - started_ns
	return (
		satisfied = satisfied_pct(model),
		segregation = segregation_index(model),
		last_swapped = Agents.abmproperties(model).last_swapped,
		steps_run = steps_run,
		converged = converged,
		elapsed_ns = elapsed_ns,
	)
end

function main()
	width = parse(Int, arg_value("width", string(DEFAULT_GRID_W)))
	height = parse(Int, arg_value("height", string(DEFAULT_GRID_H)))
	density = parse(Float64, arg_value("density", string(DEFAULT_DENSITY)))
	balance = parse(Float64, arg_value("balance", string(DEFAULT_BALANCE)))
	steps = parse(Int, arg_value("steps", string(DEFAULT_SCIENTIFIC_STEPS)))
	warmup_steps = parse(Int, arg_value("warmup-steps", "0"))
	seeds = parse(Int, arg_value("seeds", string(DEFAULT_SCIENTIFIC_SEEDS)))
	seed = parse(Int, arg_value("seed", "7"))
	thresholds = parse_thresholds(arg_value("thresholds", DEFAULT_SCIENTIFIC_THRESHOLDS))
	mode = arg_value("mode", "convergence")
	mode in ("steady", "convergence") || error("mode must be steady or convergence")
	warmup_steps >= 0 || error("warmup-steps must be non-negative")
	benchmark_json = lowercase(arg_value("benchmark-json", "false")) in ("true", "1", "yes")
	if warmup_steps > 0
		run_trial(threshold = thresholds[1], seed = seed, steps = warmup_steps, width = width, height = height, density = density, balance = balance, mode = "steady")
	end

	output_rows = String[]
	satisfied_means = Float64[]
	segregation_means = Float64[]
	last_swapped_means = Float64[]
	total_ticks = 0
	total_elapsed_ns = UInt64(0)
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
				mode = mode,
			)
			for run in 1:seeds
		]
		total_ticks += sum(row.steps_run for row in rows)
		total_elapsed_ns += sum(row.elapsed_ns for row in rows)
		mean_satisfied = mean(row.satisfied for row in rows)
		mean_segregation = mean(row.segregation for row in rows)
		mean_last_swapped = mean(row.last_swapped for row in rows)
		push!(satisfied_means, mean_satisfied)
		push!(segregation_means, mean_segregation)
		push!(last_swapped_means, mean_last_swapped)
		row = @sprintf(
			"%.2f,%.4f,%.4f,%.2f,%.2f,%d",
			threshold,
			mean_satisfied,
			mean_segregation,
			mean_last_swapped,
			mean(row.steps_run for row in rows),
			count(row -> row.converged, rows),
		)
		push!(output_rows, row)
	end

	println("threshold,mean_satisfied_pct,mean_segregation_index,mean_last_swapped,mean_steps,converged_runs")
	for row in output_rows
		println(row)
	end
	elapsed_ms = total_elapsed_ns / 1_000_000
	tpms = total_elapsed_ns == 0 ? 0.0 : total_ticks / elapsed_ms
	mspt = total_ticks == 0 ? 0.0 : elapsed_ms / total_ticks
	println("performance_metric,total_ticks,elapsed_ms,tpms,mspt")
	@printf("performance,%d,%.3f,%.6f,%.6f\n", total_ticks, elapsed_ms, tpms, mspt)
	if benchmark_json
		mean_satisfied = mean(satisfied_means)
		mean_segregation = mean(segregation_means)
		mean_last_swapped = mean(last_swapped_means)
		actual_steps = total_ticks / max(length(thresholds) * seeds, 1)
		semantic_valid = 0 <= mean_satisfied <= 1 && 0 <= mean_segregation <= 1 && 0 <= mean_last_swapped <= width * height && 1 <= actual_steps <= steps
		@printf("{\"schemaVersion\":1,\"timingsMs\":[%.9f],\"metrics\":{\"totalTicks\":%d,\"elapsedMs\":%.9f,\"msPerTick\":%.9f},\"state\":{\"mode\":\"%s\",\"instrumentation\":\"none\",\"satisfiedPct\":%.9f,\"segregationIndex\":%.9f,\"lastSwapped\":%.9f,\"actualSteps\":%.9f},\"correctness\":{\"valid\":%s,\"actionCount\":1},\"runtime\":{\"julia\":\"%s\"}}\n", elapsed_ms, total_ticks, elapsed_ms, mspt, mode, mean_satisfied, mean_segregation, mean_last_swapped, actual_steps, semantic_valid ? "true" : "false", string(VERSION))
	end
end

main()
