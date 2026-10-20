using Pkg

const EXAMPLES_DIR = @__DIR__
const ROOT_DIR = normpath(joinpath(EXAMPLES_DIR, "..", ".."))
const TENSNAP_PACKAGE_DIR = joinpath(ROOT_DIR, "packages", "tensnap-julia")

if "--instantiate-only" in ARGS
    cd(EXAMPLES_DIR) do
        Pkg.develop(Pkg.PackageSpec(path=relpath(TENSNAP_PACKAGE_DIR, EXAMPLES_DIR)))
        Pkg.instantiate()
    end
    exit()
end

const EXAMPLES = Dict(
	"el-farol" => "el_farol_viz.jl",
	"schelling" => "schelling_viz.jl",
	"schelling:makie" => "schelling_viz_makie.jl",
)

example = isempty(ARGS) ? "el-farol" : ARGS[1]
haskey(EXAMPLES, example) || error("Unknown Julia example: $example. Available examples: $(join(sort(collect(keys(EXAMPLES))), ", ")).")

include(joinpath(EXAMPLES_DIR, EXAMPLES[example]))
