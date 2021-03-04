#module QGraph

function __init__()
  @require LightGraphs = "093fc24a-ae57-5d10-9952-331d41423f4d" begin
    import .LightGraphs
    import .LightGraphs: SimpleGraph, SimpleDiGraph

    function (::Type{LG})(g::Union{AbstractGraph,AbstractSymmetricGraph}) where LG <: Union{SimpleGraph,SimpleDiGraph}
      lg = LG(nv(g))
      for (s, t) in zip(src(g), tgt(g))
        LightGraphs.add_edge!(lg, s, t)
      end
      lg
    end

    function SimpleGraph(g::AbstractHalfEdgeGraph)
      lg = SimpleGraph(nv(g))
      for e in half_edges(g)
        e′ = inv(g, e)
        if e <= e′
          LightGraphs.add_edge!(lg, vertex(g, e), vertex(g, e′))
        end
      end
      lg
    end
  end

  @require MetaGraphs = "626554b9-1ddb-594c-aa3c-2596fe9399a5" begin
    import .MetaGraphs
    import .MetaGraphs: MetaGraph, MetaDiGraph
        
    MetaDiGraph(g::AbstractWeightedGraph{U}) where U = to_weighted_metagraph(MetaDiGraph{Int,U}, g)
    MetaGraph(g::AbstractSymmetricWeightedGraph{U}) where U = to_weighted_metagraph(MetaGraph{Int,U}, g)

    function to_weighted_metagraph(MG::Type{<:MetaGraphs.AbstractMetaGraph}, g)
      mg = MG(nv(g))
      for (s, t, w) in zip(src(g), tgt(g), weight(g))
        MetaGraphs.add_edge!(mg, s, t, :weight, w)
      end
      mg
    end
  end
end

include("embedded.jl")
include("property.jl")
include("algos.jl")

#end
