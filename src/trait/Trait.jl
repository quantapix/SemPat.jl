module Trait
using ..Utils
using ..Match

export @traitdef, @traitimpl, @traitfn, @check_fast_traitdispatch, is_trait
export @trait, @impl, @impl!, instance

function instance end
function check_heritage end
function impl end

include("base.jl")
include("utils.jl")
include("core.jl")
include("impl.jl")
include("traits.jl")

end
