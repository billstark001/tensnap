using Test
using TenSnap
using MsgPack

include("support/toy_model.jl")

@testset "TenSnap.jl" begin
	include("projectors_test.jl")
	include("scenario_lifecycle_test.jl")
	include("codec_test.jl")
	include("layers_test.jl")
	include("assets_test.jl")
	include("crd_helpers_test.jl")
	include("examples_test.jl")
end
