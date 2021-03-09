module EGraphs

using RuntimeGeneratedFunctions
RuntimeGeneratedFunctions.init(@__MODULE__)

options = Dict{Symbol, Any}(
    :verbose => false,
    :printiter => false,
)

macro log(args...)
    quote options[:verbose] && @info($(args...)) end |> esc
end

export options

import ..Rule
import ..get_funsym
import ..get_funargs
import ..set_funsym!
import ..set_funargs!


using ..Util

include("enode.jl")
export isenode

include("egg.jl")
export find
export EClass
export EGraph
export AbstractAnalysis
export merge!
export addexpr!
export addanalysis!
export rebuild!

include("analysis.jl")


include("ematch.jl")
include("Schedulers/Schedulers.jl")

include("saturation.jl")
export saturate!
include("equality.jl")
export areequal
export @areequal
export @areequalg

include("extraction.jl")
export extract!
export ExtractionAnalysis
export astsize
export astsize_inv
export @extract

end
