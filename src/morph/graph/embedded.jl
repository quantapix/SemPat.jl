σ(x::AbstractACSet, args...) = subpart(x, args..., :σ)
α(x::AbstractACSet, args...) = subpart(x, args..., :α)
ϕ(x::AbstractACSet, args...) = subpart(x, args..., :ϕ)

trace_vertices(x::AbstractACSet) = cycles(σ(x))
trace_edges(x::AbstractACSet) = cycles(α(x))
trace_faces(x::AbstractACSet) = cycles(ϕ(x))

@picture TheoryRotationGraph <: TheoryHalfEdgeGraph begin
  σ::Hom(H,H)
  compose(σ, vertex) == vertex
end

const AbstractRotationGraph = AbstractACSetType(TheoryRotationGraph)
const RotationGraph = CSetType(TheoryRotationGraph, index=[:vertex])

α(g::AbstractRotationGraph) = inv(g)
ϕ(g::AbstractRotationGraph) = sortperm(inv(g)[σ(g)]) # == (σ ⋅ inv)⁻¹

function add_corolla!(g::AbstractRotationGraph, valence::Int; kw...)
  v = add_vertex!(g; kw...)
  n = nparts(g, :H)
  add_parts!(g, :H, valence; vertex=v, σ=circshift((n+1):(n+valence), -1))
end

pair_half_edges!(g::AbstractRotationGraph, h, h′) = set_subpart!(g, [h; h′], :inv, [h′; h])

@picture TheoryRotationSystem(FreeSchema) begin
  H::Ob
  σ::Hom(H,H)
  α::Hom(H,H)
  compose(α, α) == id(H)
end

const AbstractRotationSystem = AbstractACSetType(TheoryRotationSystem)
const RotationSystem = CSetType(TheoryRotationSystem)

# ϕ == (σ⋅α)⁻¹ == α⁻¹ ⋅ σ⁻¹
ϕ(sys::AbstractRotationSystem) = sortperm(α(sys)[σ(sys)])

function add_corolla!(sys::AbstractRotationSystem, valence::Int)
  n = nparts(sys, :H)
  add_parts!(sys, :H, valence; σ=circshift((n+1):(n+valence), -1))
end

pair_half_edges!(sys::AbstractRotationSystem, h, h′) = set_subpart!(sys, [h; h′], :α, [h′; h])

@picture TheoryHypermap(FreeSchema) begin
  H::Ob
  σ::Hom(H,H)
  α::Hom(H,H)
  ϕ::Hom(H,H)
  compose(σ, α, ϕ) == id(H)
end

@picture TheoryCombinatorialMap <: TheoryHypermap begin
  compose(α, α) == id(H)
end

const AbstractCombinatorialMap = AbstractACSetType(TheoryCombinatorialMap)
const CombinatorialMap = CSetType(TheoryCombinatorialMap)
