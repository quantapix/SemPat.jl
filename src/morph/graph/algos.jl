using DataStructures: Stack

function connected_components(g::AbstractACSet)::Vector{Vector{Int}}
    π = connected_component_projection(g)
    components = [ Int[] for c in codom(π) ]
    for v in dom(π)
        push!(components[π(v)], v)
    end
    components
end

function connected_component_projection end

abstract type TopologicalSortAlgorithm end
struct TopologicalSortByDFS <: TopologicalSortAlgorithm end

function topological_sort(g::AbstractACSet; alg::TopologicalSortAlgorithm=TopologicalSortByDFS())
    topological_sort(g, alg)
end

function topological_sort(g::AbstractACSet, ::TopologicalSortByDFS)
    vs = Int[]
    marking = fill(Unmarked, nv(g))
    for v in reverse(vertices(g))
        marking[v] == Unmarked || continue
        marking[v] = TempMarked
        stack = Stack{Int}()
        push!(stack, v)
        while !isempty(stack)
            u = first(stack)
            u_out = outneighbors(g, u)
            i = findfirst(u_out) do w
                marking[w] != TempMarked || error("Graph is not acyclic: $g")
                marking[w] == Unmarked
            end
            if isnothing(i)
                marking[u] = Marked
                push!(vs, u)
                pop!(stack)
            else
                w = u_out[i]
                marking[w] = TempMarked
                push!(stack, w)
            end
        end
    end
    reverse!(vs)
end

@enum TopologicalSortDFSMarking Unmarked = 0 TempMarked = 1 Marked = 2

function transitive_reduction!(g::AbstractACSet; sorted=nothing)
    lengths = longest_paths(g, sorted=sorted)
    transitive_edges = filter(edges(g)) do e
        lengths[tgt(g, e)] - lengths[src(g, e)] != 1
    end
    rem_edges!(g, transitive_edges)
    return g
end

function longest_paths(g::AbstractACSet; sorted::Union{AbstractVector{Int},Nothing}=nothing)
    if isnothing(sorted); sorted = topological_sort(g)
    end
    lengths = fill(0, nv(g))
    for v in sorted
        lengths[v] = mapreduce(max, inneighbors(g, v), init=0) do u
            lengths[u] + 1
        end
    end
    lengths
end
