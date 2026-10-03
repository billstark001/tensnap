using Test
using TenSnap

@testset "map and matrix agent layers" begin
    model = Dict(:flags => Dict("z" => false, "a" => true),
                 :cells => [1 2; 3 4])
    map_layer = map_agent_layer("flags", m -> m[:flags])
    map_items = map_layer.items(model)
    @test getindex.(map_items, "id") == ["a", "z"]
    @test map_items[2]["data"]["value"] === false
    invalid = Dict("items" => [map_items[1], map_items[1]])
    @test_throws ErrorException map_layer.restore.validate(invalid, model)
    @test model[:flags]["z"] === false

    configured_map = map_agent_layer("configured", m -> m[:flags];
        fields = Dict("alive" => "value", "label" => "key", "fixed" => literal("ready")),
        icon = "square", size = 1)
    configured_item = configured_map.items(model)[1]
    @test configured_item["alive"] === true
    @test configured_item["label"] == "a"
    @test configured_item["fixed"] == "ready"
    @test configured_item["icon"] == "square"
    @test configured_item["size"] == 1
    nested_model = Dict(:flags => Dict("a" => (alive = true,)))
    nested_layer = map_agent_layer("nested", m -> m[:flags]; fields = Dict("alive" => :alive))
    @test nested_layer.items(nested_model)[1]["alive"] === true
    @test_throws ErrorException map_agent_layer("bad", m -> m[:flags];
        fields = Dict("color" => "value"), color = "red")
    map_layer.restore.replace([map_items[2]], model)
    @test model[:flags] == Dict("z" => false)

    matrix_layer = matrix_agent_layer("cells", m -> m[:cells]; orientation = :row_col)
    matrix_items = matrix_layer.items(model)
    @test matrix_items[1]["id"] == "cell:0:0"

    configured_matrix = matrix_agent_layer("configured", m -> m[:cells];
        orientation = :row_col, fields = Dict("raw" => "value", "source_row" => "row"),
        color = "navy", icon = "square")
    configured_cell = configured_matrix.items(model)[1]
    @test configured_cell["raw"] == 1
    @test configured_cell["source_row"] == 1
    @test configured_cell["color"] == "navy"
    @test (matrix_items[1]["x"], matrix_items[1]["y"]) == (0, 1)
    snapshot = Dict("metadata" => matrix_layer.data(model), "items" => matrix_items)
    matrix_layer.restore.validate(snapshot, model)
    matrix_layer.restore.replace(matrix_items, model)
    @test model[:cells] == [1 2; 3 4]
    @test_throws ErrorException matrix_layer.restore.validate(
        Dict("metadata" => snapshot["metadata"], "items" => matrix_items[2:end]), model)
    @test model[:cells] == [1 2; 3 4]
end
