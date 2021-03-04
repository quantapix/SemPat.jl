abstract type AbstractPropertyGraph{T} end

@picture TheoryPropertyGraph <: TheoryGraph begin
    Props::Data
    vprops::Attr(V, Props)
    eprops::Attr(E, Props)
end

const _AbstractPropertyGraph{T} = AbstractACSet{SchemaType(TheoryPropertyGraph)...,Tuple{Dict{Symbol,T}}}
const _PropertyGraph{T} = ACSet{SchemaType(TheoryPropertyGraph)...,Tuple{Dict{Symbol,T}},(:src, :tgt),()}

struct PropertyGraph{T,G <: _AbstractPropertyGraph{T}} <: AbstractPropertyGraph{T}
    graph::G
    gprops::Dict{Symbol,T}
end

PropertyGraph{T,G}(; kw...) where {T,G <: _AbstractPropertyGraph{T}} = PropertyGraph(G(), Dict{Symbol,T}(kw...))
PropertyGraph{T}(; kw...) where T = PropertyGraph{T,_PropertyGraph{T}}(; kw...)

@picture TheorySymmetricPropertyGraph <: TheorySymmetricGraph begin
    Props::Data
    vprops::Attr(V, Props)
    eprops::Attr(E, Props)
    compose(inv, eprops) == eprops # Edge involution preserves edge properties.
end

const _AbstractSymmetricPropertyGraph{T} = AbstractACSet{SchemaType(TheorySymmetricPropertyGraph)...,Tuple{Dict{Symbol,T}}}
const _SymmetricPropertyGraph{T} = ACSet{SchemaType(TheorySymmetricPropertyGraph)...,Tuple{Dict{Symbol,T}},(:src,),()}

struct SymmetricPropertyGraph{T,G <: _AbstractSymmetricPropertyGraph{T}} <:
    AbstractPropertyGraph{T}
    graph::G
    gprops::Dict{Symbol,T}
end

SymmetricPropertyGraph{T,G}(; kw...) where {T,G <: _AbstractSymmetricPropertyGraph{T}} = SymmetricPropertyGraph(G(), Dict{Symbol,T}(kw...))
SymmetricPropertyGraph{T}(; kw...) where T = SymmetricPropertyGraph{T,_SymmetricPropertyGraph{T}}(; kw...)

gprops(g::AbstractPropertyGraph) = g.gprops
vprops(g::AbstractPropertyGraph, v) = subpart(g.graph, v, :vprops)
eprops(g::AbstractPropertyGraph, e) = subpart(g.graph, e, :eprops)

get_gprop(g::AbstractPropertyGraph, key::Symbol) = gprops(g)[key]
get_vprop(g::AbstractPropertyGraph, v, key::Symbol) = broadcast(v) do v; vprops(g, v)[key] end
get_eprop(g::AbstractPropertyGraph, e, key::Symbol) = broadcast(e) do e; eprops(g, e)[key] end

set_gprop!(g::AbstractPropertyGraph, key::Symbol, value) = (gprops(g)[key] = value)
set_vprop!(g::AbstractPropertyGraph, v, key::Symbol, value) = broadcast(v, value) do v, value; vprops(g, v)[key] = value end
set_eprop!(g::AbstractPropertyGraph, e, key::Symbol, value) = broadcast(e, value) do e, value; eprops(g, e)[key] = value end

set_gprops!(g::AbstractPropertyGraph; kw...) = merge!(gprops(g), kw)
set_gprops!(g::AbstractPropertyGraph, d::AbstractDict) = merge!(gprops(g), d)

set_vprops!(g::AbstractPropertyGraph, v::Int; kw...) = merge!(vprops(g, v), kw)
set_vprops!(g::AbstractPropertyGraph, v::Int, d::AbstractDict) = merge!(vprops(g, v), d)

set_eprops!(g::AbstractPropertyGraph, e::Int; kw...) = merge!(eprops(g, e), kw)
set_eprops!(g::AbstractPropertyGraph, e::Int, d::AbstractDict) = merge!(eprops(g, e), d)

@inline nv(g::AbstractPropertyGraph) = nv(g.graph)
@inline ne(g::AbstractPropertyGraph) = ne(g.graph)
@inline src(g::AbstractPropertyGraph, args...) = src(g.graph, args...)
@inline tgt(g::AbstractPropertyGraph, args...) = tgt(g.graph, args...)
@inline inv(g::SymmetricPropertyGraph, args...) = inv(g.graph, args...)
@inline vertices(g::AbstractPropertyGraph) = vertices(g.graph)
@inline edges(g::AbstractPropertyGraph) = edges(g.graph)
@inline has_vertex(g::AbstractPropertyGraph, v::Int) = has_vertex(g.graph, v)
@inline has_edge(g::AbstractPropertyGraph, e::Int) = has_edge(g.graph, e)

add_vertex!(g::AbstractPropertyGraph{T}; kw...) where T = add_vertex!(g, Dict{Symbol,T}(kw...))
add_vertex!(g::AbstractPropertyGraph{T}, d::Dict{Symbol,T}) where T = add_part!(g.graph, :V, vprops=d)

add_vertices!(g::AbstractPropertyGraph{T}, n::Int) where T = add_parts!(g.graph, :V, n, vprops=[Dict{Symbol,T}() for i = 1:n])

add_edge!(g::AbstractPropertyGraph{T}, src::Int, tgt::Int; kw...) where T = add_edge!(g, src, tgt, Dict{Symbol,T}(kw...))
add_edge!(g::PropertyGraph{T}, src::Int, tgt::Int, d::Dict{Symbol,T}) where T = add_part!(g.graph, :E, src=src, tgt=tgt, eprops=d)

function add_edges!(g::PropertyGraph{T}, srcs::AbstractVector{Int}, tgts::AbstractVector{Int}, eprops=nothing) where T
    @assert (n = length(srcs)) == length(tgts)
    if isnothing(eprops); eprops = [Dict{Symbol,T}() for i = 1:n]
    end
    add_parts!(g.graph, :E, n, src=srcs, tgt=tgts, eprops=eprops)
end

add_edge!(g::SymmetricPropertyGraph{T}, src::Int, tgt::Int, d::Dict{Symbol,T}) where T = add_edges!(g, src:src, tgt:tgt, [d])

function add_edges!(g::SymmetricPropertyGraph{T}, srcs::AbstractVector{Int}, tgts::AbstractVector{Int}, eprops=nothing) where T
    @assert (n = length(srcs)) == length(tgts)
    if isnothing(eprops); eprops = [ Dict{Symbol,T}() for i = 1:n ]
    end
    invs = nparts(g.graph, :E) .+ [(n + 1):2n; 1:n]
    eprops = [eprops; eprops]
    add_parts!(g.graph, :E, 2n, src=[srcs; tgts], tgt=[tgts; srcs], inv=invs, eprops=eprops)
end

function PropertyGraph{T}(g::Graph, make_vprops, make_eprops; gprops...) where T
    pg = PropertyGraph{T}(; gprops...)
    add_vertices!(pg, nv(g))
    add_edges!(pg, src(g), tgt(g))
    for v in vertices(g)
        set_vprops!(pg, v, make_vprops(v))
    end
    for e in edges(g)
        set_eprops!(pg, e, make_eprops(e))
    end
    pg
end

PropertyGraph{T}(g::Graph; gprops...) where T = PropertyGraph{T}(g, v -> Dict(), e -> Dict(); gprops...)

function SymmetricPropertyGraph{T}(g::SymmetricGraph, make_vprops, make_eprops; gprops...) where T
    pg = SymmetricPropertyGraph{T}(; gprops...)
    add_vertices!(pg, nv(g))
    for v in vertices(g)
        set_vprops!(pg, v, make_vprops(v))
    end
    for e in edges(g)
        if e <= inv(g, e)
            e1, e2 = add_edge!(pg, src(g, e), tgt(g, e))
            set_eprops!(pg, e1, make_eprops(e))
        end
    end
    pg
end

SymmetricPropertyGraph{T}(g::SymmetricGraph; gprops...) where T = SymmetricPropertyGraph{T}(g, v -> Dict(), e -> Dict(); gprops...)
