# Shared native-app factory: the teaching launcher uses it directly, while the
# benchmark wrapper adds read-only probes through `extra_content`.
using Bonito
using WGLMakie
using Agents

WGLMakie.activate!()

"""Create the teaching UI; benchmark callers may add read-only DOM probes."""
function create_schelling_makie_app(
	config::SchellingConfig;
	title::String = "Schelling model",
	ticks_per_second::Int = 5,
	extra_content = (_, _) -> DOM.div(),
)
	threshold = Observable(config.similarity_threshold)
	running = Observable(false)
	speed = Observable(ticks_per_second)
	current_model = Observable(initialize_schelling(config))
	revision = Observable(0)
	model_lock = ReentrantLock()

	fig = Figure(size = (700, 700))
	ax = Axis(fig[1, 1], aspect = DataAspect())
	positions = @lift([Tuple(agent.pos) for agent in allagents($current_model)])
	colors = @lift([agent.group == 1 ? :dodgerblue : :orange for agent in allagents($current_model)])
	sizes = @lift([satisfied(agent, $current_model) ? 12.0 : 7.2 for agent in allagents($current_model)])
	scatter!(ax, positions; color = colors, marker = :rect, markersize = sizes)

	run_button = Button("Run")
	step_button = Button("Step")
	reset_button = Button("Reset")
	threshold_slider = Slider(0.0:0.01:1.0; value = threshold[])
	density_slider = Slider(0.0:0.01:1.0; value = config.density)
	balance_slider = Slider(0.0:0.01:1.0; value = config.balance)
	speed_slider = Slider(1:200; value = speed[])

	function step_current_model!()
		lock(model_lock)
		try
			schelling_model_step!(current_model[])
			notify(current_model)
			revision[] += 1
		finally
			unlock(model_lock)
		end
	end

	on(threshold_slider.value) do value
		threshold[] = value
		config.similarity_threshold = value
		lock(model_lock)
		try
			abmproperties(current_model[]).similarity_threshold = value
			notify(current_model)
		finally
			unlock(model_lock)
		end
	end
	on(density_slider.value) do value
		config.density = value
	end
	on(balance_slider.value) do value
		config.balance = value
	end
	on(speed_slider.value) do value
		speed[] = value
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
					sleep(1 / max(speed[], 1))
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
			current_model[] = initialize_schelling(config)
			revision[] = 0
		finally
			unlock(model_lock)
		end
	end

	probe = extra_content(current_model, revision)
	return App() do
		DOM.div(
			DOM.h2(title),
			DOM.div("Similarity threshold: ", threshold_slider),
			DOM.div("Density on reset: ", density_slider),
			DOM.div("Group 1 balance on reset: ", balance_slider),
			DOM.div("Steps per second: ", speed_slider),
			DOM.div(run_button, step_button, reset_button),
			probe,
			fig,
		)
	end
end
