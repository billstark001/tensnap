@testset "asset cache" begin
	scenario = Scenario()
	asset = publish_asset!(scenario, "logo", "hello", "text/plain"; label = "Greeting")
	@test haskey(scenario.assets, "logo")
	@test asset.size == 5
	@test asset.label == "Greeting"
	@test publish_asset!(scenario, "logo", "hello", "text/plain") === asset
	@test delete_asset!(scenario, "logo")
	@test !haskey(scenario.assets, "logo")
end
