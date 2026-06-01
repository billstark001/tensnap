module TenSnap

using Base64
using Dates
using HTTP
using JSON3
using MsgPack
using SHA
using UUIDs

export Scenario, Parameter, Action, Chart, Environment, Layer
export add_parameter!, add_action!, add_chart!, add_environment!, add_layer!, register_model!
export remove_parameter!, remove_action!, remove_chart!, remove_environment!, remove_layer!
export create_items!, update_items!, delete_items!, replace_layer_items!, publish_asset!, delete_asset!, request_screenshot!
export run!, step!, reset!, sync!, clear_charts!, log!
export parameter, action, chart, environment, layer, agents_layer, grid_layer, patch_layer, edge_layer
export dictprojector, propertyprojector, autoagentprojector, agents_getter

include("constants.jl")
include("utils.jl")
include("projectors.jl")
include("components.jl")
include("scenario.jl")
include("layers.jl")
include("assets.jl")
include("screenshots.jl")
include("codec.jl")
include("sync.jl")
include("runtime.jl")

end # module
