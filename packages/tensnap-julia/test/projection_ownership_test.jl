mutable struct ProjectionCopyProbe <: AbstractVector{Int}
	values::Vector{Int}
end
const PROJECTION_COPY_COUNT = Ref(0)
Base.size(value::ProjectionCopyProbe) = size(value.values)
Base.getindex(value::ProjectionCopyProbe, index::Int) = value.values[index]
function Base.deepcopy_internal(value::ProjectionCopyProbe, memo::IdDict)
	haskey(memo, value) && return memo[value]
	PROJECTION_COPY_COUNT[] += 1
	result = ProjectionCopyProbe(copy(value.values))
	memo[value] = result
	return result
end

@testset "projection and publication ownership" begin
	for mode in (:builtin, :boundary, :custom, :owned, :double, :borrow)
		probe = ProjectionCopyProbe([0])
		agent = Dict{String, Any}("id" => "a", "data" => Dict("counts" => probe))
		model = Dict("agents" => [agent])
		projector = if mode == :custom
			identity
		elseif mode == :owned
			item -> Dict{String, Any}("id" => item["id"], "data" => Dict("counts" => ProjectionCopyProbe(copy(item["data"]["counts"].values))))
		else
			dictprojector([:id, :data])
		end
		l = agents_layer("agents", m -> m["agents"]; projector = projector,
			projector_owns_values = mode == :owned ? true : nothing,
			projector_deep_copy = !(mode in (:borrow, :boundary)),
			deep_copy = mode == :double ? true : mode == :borrow ? false : nothing)
		PROJECTION_COPY_COUNT[] = 0
		first = TenSnap._layer_items(l, model)
		@test PROJECTION_COPY_COUNT[] == (mode == :double ? 2 : mode in (:owned, :borrow) ? 0 : 1)
		TenSnap._remember_layer_items!(l, first)
		probe.values[1] = 1
		_, updates, _ = TenSnap._layer_item_deltas!(l, model)
		@test first[1]["data"]["counts"][1] == (mode == :borrow ? 1 : 0)
		@test length(updates) == (mode == :borrow ? 0 : 1)
	end
end

@testset "tuple and binary projection values are independent" begin
	nested = Dict{String, Any}("count" => 0)
	bytes = UInt8[1, 2, 3]
	item = Dict("id" => "a", "data" => Dict("tuple" => (nested,), "bytes" => bytes))
	projected = dictprojector()(item)
	nested["count"] = 1
	bytes[1] = 9
	@test projected["data"]["tuple"][1]["count"] == 0
	@test projected["data"]["bytes"] == UInt8[1, 2, 3]
	encoded = TenSnap._encode("item_create", Dict("env_id" => "e", "layer_id" => "a", "items" => [projected]); use_msgpack = true, normalized = true)
	@test MsgPack.unpack(encoded)["payload"]["items"][1]["data"]["bytes"] == UInt8[1, 2, 3]
	@test TenSnap._wire_value(projected) === projected
	parent = UInt8[0, 1, 2, 3]
	subview = view(parent, 2:3)
	owned_view = dictprojector()(Dict("id" => "view", "data" => subview))["data"]
	parent[2] = 9
	@test owned_view == UInt8[1, 2]
	@test owned_view isa Vector{UInt8}

end

@testset "custom-owned sources detach injected values" begin
	for kind in (:map, :matrix)
		value = Dict{String, Any}("count" => 0)
		if kind == :map
			model = Dict("items" => Dict("a" => value))
			l = map_agent_layer("items", m -> m["items"]; project = (_m, _k, _v) -> Dict(), projector_owns_values = true)
		else
			model = Dict("items" => reshape([value], 1, 1))
			l = matrix_agent_layer("items", m -> m["items"]; orientation = :row_col, project = (_m, _r, _c, _v) -> Dict(), projector_owns_values = true)
		end
		first = only(TenSnap._layer_items(l, model))
		value["count"] = 1
		@test first["data"]["value"]["count"] == 0
	end
end

@testset "manual publication copy override" begin
	for copy_values in (true, false)
		s = Scenario()
		l = agents_layer("agents", _ -> Any[])
		add_environment!(s, environment("world"; layers = [l]))
		item = Dict{String, Any}("id" => "a", "data" => Dict("count" => 0))
		published = only(create_items!(s, "world", "agents", [item]; deep_copy = copy_values))
		item["data"]["count"] = 1
		@test published["data"]["count"] == (copy_values ? 0 : 1)
	end
end

@testset "explicit built-in source ownership does not duplicate detachment" begin
	for kind in (:map, :matrix)
		probe = ProjectionCopyProbe([0])
		model = kind == :map ? Dict("items" => Dict("a" => probe)) : Dict("items" => reshape([probe], 1, 1))
		l = kind == :map ? map_agent_layer("items", m -> m["items"]; projector_owns_values = true) :
			matrix_agent_layer("items", m -> m["items"]; orientation = :row_col, projector_owns_values = true)
		PROJECTION_COPY_COUNT[] = 0
		TenSnap._layer_items(l, model)
		@test PROJECTION_COPY_COUNT[] == 1
	end
end

@testset "ownership does not imply wire normalization" begin
	projector = _ -> Dict{String, Any}("id" => "a", "data" => Dict{Symbol, Any}(
		:kind => :ready, :parts => (Dict(:bytes => UInt8[1, 2]),)))
	l = agents_layer("agents", _ -> [nothing]; projector = projector, projector_owns_values = true)
	published = only(TenSnap._layer_items(l, nothing))
	@test published["data"]["kind"] == "ready"
	@test published["data"]["parts"] isa Vector
	payload = Dict("env_id" => "world", "layer_id" => "agents", "items" => [published])
	frame = TenSnap._encode("item_create", payload; use_msgpack = true, normalized = true)
	decoded = MsgPack.unpack(frame)["payload"]["items"][1]
	@test decoded["data"]["parts"][1]["bytes"] == UInt8[1, 2]
	@test decoded["data"]["parts"][1]["bytes"] isa Vector{UInt8}

	# Manual no-copy publication still normalizes custom portable representations.
	s = Scenario()
	manual = only(create_items!(s, "world", "agents", [projector(nothing)]; deep_copy = false))
	@test manual["data"]["kind"] == "ready"
	@test manual["data"]["parts"] isa Vector
end

@testset "custom safe publication detaches changed records only" begin
	probe = ProjectionCopyProbe([0])
	item = Dict{String, Any}("id" => "a", "data" => probe)
	l = agents_layer("agents", identity; projector = identity)
	TenSnap._remember_layer_items!(l, TenSnap._layer_items(l, [item]))
	PROJECTION_COPY_COUNT[] = 0
	TenSnap._layer_item_deltas!(l, [item])
	@test PROJECTION_COPY_COUNT[] == 0
	probe.values[1] = 1
	_, updates, _ = TenSnap._layer_item_deltas!(l, [item])
	@test PROJECTION_COPY_COUNT[] == 1
	probe.values[1] = 2
	@test updates[1]["data"][1] == 1
end

@testset "built-in scans materialize only changed owned fields" begin
	for kind in (:dict, :auto, :map, :matrix), precise in (false, true)
		probe = ProjectionCopyProbe([0])
		agent = Dict{String, Any}("id" => "a", "x" => 0, "y" => 0, "data" => Dict("counts" => probe))
		model = Dict("agents" => [agent], "map" => Dict("a" => agent["data"]), "matrix" => reshape([agent["data"]], 1, 1))
		l = if kind == :map
			map_agent_layer("items", m -> m["map"]; changed = precise ? (_m, _k, _v) -> true : nothing)
		elseif kind == :matrix
			matrix_agent_layer("items", m -> m["matrix"]; orientation = :row_col, changed = precise ? (_m, _r, _c, _v) -> true : nothing)
		else
			projector = kind == :dict ? dictprojector([:id, :x, :data]) : autoagentprojector(fields = [:data])
			agents_layer("items", m -> m["agents"]; projector = projector,
				item_id = precise ? item -> item["id"] : nothing, changed = precise ? _item -> true : nothing)
		end
		initial = TenSnap._remember_layer_items!(l, TenSnap._layer_items(l, model))
		PROJECTION_COPY_COUNT[] = 0
		@test all(isempty, TenSnap._layer_item_deltas!(l, model))
		@test PROJECTION_COPY_COUNT[] == 0
		if kind in (:dict, :auto)
			agent["x"] = 1
			_, updates, _ = TenSnap._layer_item_deltas!(l, model)
			@test only(updates)["x"] == 1
			@test PROJECTION_COPY_COUNT[] == 0
			@test only(values(l.last_items))["data"] === initial[1]["data"]
		end
		probe.values[1] = 1
		_, updates, _ = TenSnap._layer_item_deltas!(l, model)
		@test length(updates) == 1
		@test PROJECTION_COPY_COUNT[] == 1
		retained = initial[1]["data"]
		kind in (:map, :matrix) && (retained = retained["value"])
		@test retained["counts"][1] == 0
		probe.values[1] = 2
		@test only(values(l.last_items))["data"] != agent["data"]
	end
end
