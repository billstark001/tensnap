@testset "projectors" begin
	agent = (id = 7, pos = (2.5, 3.5), attending = true, score = 4)
	projected = autoagentprojector(color = a -> a.attending ? "green" : "gray", fields = [:score])(agent)
	@test projected["id"] == 7
	@test projected["x"] == 2.5
	@test projected["y"] == 3.5
	@test projected["color"] == "green"
	@test projected["score"] == 4
	with_data = autoagentprojector(data_fields = [:attending, :score])(agent)
	@test with_data["data"] == Dict("attending" => true, "score" => 4)

	zero_based = autoagentprojector(id = a -> "agent-$(a.id)", x = a -> a.pos[1] - 1, y = a -> a.pos[2] - 1)(agent)
	@test zero_based["id"] == "agent-7"
	@test zero_based["x"] == 1.5
	@test zero_based["y"] == 2.5

	data = Dict(:id => 1, :wealth => 12)
	@test dictprojector([:id, :wealth]; rename = Dict(:wealth => :value))(data) == Dict("id" => 1, "value" => 12)
end
