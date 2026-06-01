@testset "wire codec supports JSON and MessagePack" begin
	json = TenSnap._encode("metadata_update", Dict("time" => 3))
	@test json isa String
	msgpack = TenSnap._encode("metadata_update", Dict("time" => 3); use_msgpack = true)
	@test msgpack isa Vector{UInt8}
	@test MsgPack.unpack(msgpack)["type"] == "metadata_update"

	scenario = Scenario(use_msgpack = true)
	decoded = TenSnap._decode(scenario, msgpack)
	@test decoded["payload"]["time"] == 3
	decoded_json = TenSnap._decode(scenario, json)
	@test decoded_json["payload"]["time"] == 3

	json_scenario = Scenario(use_msgpack = false)
	decoded_msgpack = TenSnap._decode(json_scenario, msgpack)
	@test decoded_msgpack["type"] == "metadata_update"
	@test decoded_msgpack["payload"]["time"] == 3
end
