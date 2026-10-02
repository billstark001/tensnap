"""Order layer declarations by explicit prerequisite ids within an environment."""
function _order_layer_dependencies(entries, idof, depsof, typeoffn)
	by_id = Dict{String, Any}()
	for entry in entries
		id = String(idof(entry))
		isempty(id) && error("layer id cannot be empty")
		haskey(by_id, id) && error("duplicate layer id: $(id)")
		by_id[id] = entry
	end
	position = Dict(String(idof(entry)) => index for (index, entry) in enumerate(entries))
	ordered = Any[]
	active = Set{String}()
	visited = Set{String}()
	function visit(id)
		id in visited && return
		id in active && error("cyclic layer dependency: $(id)")
		push!(active, id)
		entry = by_id[id]
		refs = sort!(collect(pairs(depsof(entry))); by = pair -> get(position, String(last(pair)), 0))
		for (role, dependency_id) in refs
			dependency = String(dependency_id)
			haskey(by_id, dependency) || error("layer $(id) depends on missing layer $(dependency)")
			role == "agent" && typeoffn(by_id[dependency]) != "agent" &&
				error("layer $(id) requires agent layer $(dependency)")
			visit(dependency)
		end
		delete!(active, id)
		push!(visited, id)
		push!(ordered, entry)
	end
	for entry in entries
		visit(String(idof(entry)))
	end
	return ordered
end
