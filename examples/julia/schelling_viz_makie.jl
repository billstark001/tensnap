using Bonito
using WGLMakie
using Agents

include("utils.jl")
include("schelling.jl")

WGLMakie.activate!()

function schelling_app()
	gridwidth = parse_env(Int, "TENSNAP_SCHELLING_WIDTH", DEFAULT_GRID_W)
	gridheight = parse_env(Int, "TENSNAP_SCHELLING_HEIGHT", DEFAULT_GRID_H)
	density = parse_env(Float64, "TENSNAP_SCHELLING_DENSITY", DEFAULT_DENSITY)
	balance = parse_env(Float64, "TENSNAP_SCHELLING_BALANCE", DEFAULT_BALANCE)
	seed = parse_optional_env(Int, "TENSNAP_SCHELLING_SEED")
	threshold = Observable(parse_env(Float64, "TENSNAP_SCHELLING_THRESHOLD", DEFAULT_SIMILARITY_THRESHOLD))
	ticks_per_second = Observable(parse_env(Int, "BONITO_TICKS_PER_SECOND", 5))
	running = Observable(false)
	current_model = Observable(
		initialize_schelling(;
			gridwidth,
			gridheight,
			density,
			balance,
			similarity_threshold = threshold[],
			seed,
		),
	)
	model_lock = ReentrantLock()

	fig = Figure(size = (700, 700))
	ax = Axis(fig[1, 1], aspect = DataAspect())

	positions = @lift([Tuple(a.pos) for a in allagents($current_model)])
	colors = @lift([a.group == 1 ? :dodgerblue : :orange for a in allagents($current_model)])

	scatter!(ax, positions; color = colors, marker = :rect, markersize = 12)

	run_button = Button("Run")
	step_button = Button("Step")
	reset_button = Button("Reset")
	slider = Slider(0.0:0.01:1.0; value = threshold[])
	speed_slider = Slider(1:200; value = ticks_per_second[])

	function step_current_model!()
		lock(model_lock)
		try
			step!(current_model[])
			notify(current_model)
		finally
			unlock(model_lock)
		end
	end

	on(slider.value) do v
		threshold[] = v
		lock(model_lock)
		try
			abmproperties(current_model[]).similarity_threshold = v
			notify(current_model)
		finally
			unlock(model_lock)
		end
	end

	on(speed_slider.value) do v
		ticks_per_second[] = v
	end

	on(run_button.value) do _
		if running[]
			running[] = false
			run_button.content[] = "Run"
			return nothing
		end

		running[] = true
		run_button.content[] = "Stop"

		@async begin
			try
				while running[]
					step_current_model!()
					sleep(1 / max(ticks_per_second[], 1))
				end
			finally
				running[] = false
				run_button.content[] = "Run"
			end
		end
	end

	on(step_button.value) do _
		step_current_model!()
	end

	on(reset_button.value) do _
		lock(model_lock)
		try
			current_model[] = initialize_schelling(;
				gridwidth,
				gridheight,
				density,
				balance,
				similarity_threshold = threshold[],
				seed,
			)
		finally
			unlock(model_lock)
		end
	end

	return App() do
		DOM.div(
			DOM.h2("Schelling model"),
			DOM.div("Similarity threshold: ", slider),
			DOM.div("Steps per second: ", speed_slider),
			DOM.div(run_button, step_button, reset_button),
			fig,
		)
	end
end

host = parse_env(String, "BONITO_HOST", "127.0.0.1")
port = parse_env(Int, "BONITO_PORT", 8080)

server = Bonito.Server(schelling_app(), host, port)
Bonito.HTTPServer.start(server)
println("Schelling app listening on http://$(host):$(port)/")
wait(server)
