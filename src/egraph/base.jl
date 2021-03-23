using Base.Meta

macro theory(e)
    e = macroexpand(__module__, e)
    e = rm_lines(e)
    if isexpr(e, :block); Vector{Rule}(e.args .|> x -> Rule(x; mod=__module__))
    else error("theory is not begin a => b; ... end")
    end
end

const Theory = Union{Vector{Rule},Function}

macro matcher(te)
    if Meta.isexpr(te, :block)
        te = rm_lines(te)
        t = compile_theory(Vector{Rule}(te.args .|> Rule), __module__)
    else
        if !isdefined(__module__, te) error(`theory $theory not found!`) end
        t = getfield(__module__, te)
        if t isa Vector{Rule}; t = compile_theory(t, __module__) end
        if !t isa Function error(`$te is not a valid theory`) end
    end
    t
# quote (x) -> ($t)(x) end
end

struct Id
    id::Int
end

@auto_hash_equals mutable struct Term
    head::Symbol
    args::Array{Id}
end

mutable struct EClass
    nodes::Array{Term}
    parents::Array{Tuple{Term,Id}}
end

#= 
pub struct EClass<L, D> {
  pub id: Id,
  pub nodes: Vec<L>,
  pub data: D,
  pub(crate) parents: Vec<(L, Id)>,
} =#

using DataStructures

mutable struct EGraph
    unionfind::UnionFind
    memo::Dict{Term,Id}
    classes::Dict{Id,EClass}
    dirty_unions::Array{Id}
end

#= 
pub struct EGraph<L: Language, N: Analysis<L>> {
    /// The `Analysis` given when creating this `EGraph`.
    pub analysis: N,
    pending: Vec<(L, Id)>,
    analysis_pending: IndexSet<(L, Id)>,
    memo: HashMap<L, Id>,
    unionfind: UnionFind,
    classes: HashMap<Id, EClass<L, N::Data>>,
    pub(crate) classes_by_op: HashMap<std::mem::Discriminant<L>, HashSet<Id>>,
} =#

EGraph() = EGraph(UnionFind(0), Dict(), Dict(), [])

find_root!(e::EGraph, id::Id) = Id(DataStructures.find_root!(e.unionfind, id.id))

in_same_class(e::EGraph, t1::Term, t2::Term) = in_same_set(e.unionfind, e.memo[t1], e.memo[t2])

function canonicalize!(e::EGraph, t::Term)
    t.args = [ find_root!(e, a) for a in t.args ]
end

function find_class!(e::EGraph, t::Term)
    canonicalize!(e, t) # t.args = [ find_root!(e, a) for a in t.args ]
    if haskey(e.memo, t)
        id = e.memo[t]
        return find_root!(e, id)
    else
        return nothing
    end
end

function Base.push!(e::EGraph, t::Term)
    id = find_class!(e, t)
    if id === nothing
        id = Id(push!(e.unionfind))
        cls = EClass([t], [])
        for child in t.args
            push!(e.classes[child].parents,  (t, id))
        end
        e.classes[id] = cls
        e.memo[t] = id
        return id
    else
        return id
    end
end

function Base.union!(e::EGraph, id1::Id, id2::Id)
    id1 = find_root!(e, id1)
    id2 = find_root!(e, id2)
    if id1 != id2
        id3 = Id(union!(e.unionfind, id1.id, id2.id))
        if id3 == id1
            to = id1
            from = id2
        elseif id3 == id2
            to = id2
            from = id1
        else
            @assert false
        end
        push!(e.dirty_unions, id3)
        for t in e.classes[from].nodes
            push!(e.classes[to].nodes, t) 
        end
        for t in e.classes[to].nodes
            delete!(e.memo, t)
            canonicalize!(e, t)
            e.memo[t] = to
        end
        for (p, id) in e.classes[from].parents
            push!(e.classes[to].parents, (p, find_root!(e, id)))
        end
        delete!(e.classes, from) 
    end 
    
end

function repair!(e::EGraph, id::Id)
    cls = e.classes[id]
    for (t, t_id) in cls.parents
        delete!(e.memo, t)
        canonicalize!(e, t)
        e.memo[t] = find_root!(e, t_id)
    end
    new_parents = Dict()
    for (t, t_id) in cls.parents
        canonicalize!(e, t)
        if haskey(new_parents, t)
            union!(e, t_id, new_parents[t])
        end
        new_parents[t] = find_root!(e, t_id)
    end
    e.classes[id].parents = [ (p, id) for (p, id) in new_parents]
end

function rebuild!(e::EGraph)
    while length(e.dirty_unions) > 0
        todo = Set([ find_root!(e, id) for id in e.dirty_unions])
        e.dirty_unions = []
        for id in todo
            repair!(e, id)
        end
    end
end

function constant!(e::EGraph, x::Symbol)
    t = Term(x, [])
    push!(e, t)
end

term!(e::EGraph, f::Symbol) = (args...) -> begin
    t = Term(f, collect(args))
    push!(e,  t)
end

using LightGraphs
using GraphPlot
using Colors

function graph(e::EGraph) 
    nverts = length(e.memo)
    g = SimpleDiGraph(nverts)
    vertmap = Dict([ t => n for (n, (t, id)) in enumerate(e.memo)])
  #= for (id, cls) in e.classes
      for t1 in cls.nodes
          for (t2,_) in cls.parents
              add_edge!(g, vertmap[t2], vertmap[t1])
          end
      end
  end =#
    for (n, (t, id)) in enumerate(e.memo)
        for n2 in t.args
            for t2 in e.classes[n2].nodes
                add_edge!(g, n, vertmap[t2])
            end
        end
    end
    nodelabel = [ t.head for (t, id) in e.memo]
    classmap = Dict([ (id, n)  for (n, id) in enumerate(Set([ id.id for (t, id) in e.memo]))])
    nodecolor = [classmap[id.id] for (t, id) in e.memo]
    return g, nodelabel, nodecolor
end

function graphplot(e::EGraph) 
    g, nodelabel, nodecolor = graph(e)
    nodefillc = distinguishable_colors(maximum(nodecolor), colorant"blue")
    gplot(g, nodelabel=nodelabel, nodefillc=nodefillc[nodecolor])
end

e = EGraph()
a = constant!(e, :a)
f = term!(e, :f)
apply(n, f, x) = n == 0 ? x : apply(n - 1, f, f(x))

union!(e, a, apply(6, f, a))
display(graphplot(e))

union!(e, a, apply(9, f, a))
rebuild!(e)
display(graphplot(e))