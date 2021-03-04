module Lens
using ..Utils
using ..Match

include("core.jl")

#=
function __init__()
    @require StaticArrays = "90137ffa-7385-5640-81b9-e52037218182" begin
        setindex(a::StaticArrays.StaticArray, args...) = Base.setindex(a, args...)
    end
end
=#

end
