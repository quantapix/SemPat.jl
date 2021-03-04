using DataStructures: OrderedDict

SyEx = Union{Symbol,Expr}
Ctxt = OrderedDict{Symbol,SyEx}

@auto_hash_equals struct QFunc
    call::Expr
    ret::Union{SyEx,Nothing}
    code::Union{Expr,Nothing}
    doc::Union{String,Nothing}
    QFunc(call, r=nothing, c=nothing, d=nothing) = new(call, r, c, d)
end

@auto_hash_equals struct QSig
    name::Symbol
    types::Vector{SyEx}
end

@auto_hash_equals struct TypeCons
    name::Symbol
    params::Vector{Symbol}
    ctx::Ctxt
    doc::Union{String,Nothing}
    TypeCons(n, ps, c, d=nothing) = new(n, ps, c, d)
end

@auto_hash_equals struct TermCons
    name::Symbol
    params::Vector{Symbol}
    typ::SyEx
    ctx::Ctxt
    doc::Union{String,Nothing}
    TermCons(n, ps, t, c, d=nothing) = new(n, ps, t, c, d)
end

@auto_hash_equals struct AxiomCons
    name::Symbol
    left::SyEx
    right::SyEx
    ctx::Ctxt
    doc::Union{String,Nothing}
    AxiomCons(n, l, r, c, d=nothing) = new(n, l, r, c, d)
end

@auto_hash_equals struct Theory
    types::Vector{TypeCons}
    terms::Vector{TermCons}
    axioms::Vector{AxiomCons}
    aliases::Dict{Symbol,Symbol}
end

struct Bind
    name::Symbol
    params::Vector{Symbol}
end

struct Head
    main::Bind
    base::Vector{Bind}
    Head(m, b=[]) = new(m, b)
end

struct SyntaxDomainError <: Exception
    constructor::Symbol
    args::Vector
end

struct Picture{Theory,Name}
    syntax::Module
    gens::NamedTuple
    gen_name_index::Dict{Name,Pair{Symbol,Int}}
    equations::Vector{Pair}
end

function Picture{Name}(m::Module) where Name
    Theory = m.theory()
    t = GAT.theory(Theory)
    ns = Tuple(x.name for x in t.types)
    xs = ((getfield(m, x){:gen})[] for x in ns)
    Picture{Theory,Name}(m, NamedTuple{ns}(xs), Dict{Name,Pair{Symbol,Int}}(), Pair[])
end
Picture(m::Module) = Picture{Symbol}(m)

struct Block
    code::Expr
    ins::Vector{<:SyEx}
    outs::Vector{<:SyEx}
end

abstract type CompileState end

mutable struct SimpleState <: CompileState
    nvars::Int
    SimpleState(; nvars::Int=0) = new(nvars)
end

abstract type QExpr{T} end
abstract type CatExpr{T} <: QExpr{T} end
abstract type ObExpr{T} <: CatExpr{T} end
abstract type HomExpr{T} <: CatExpr{T} end

abstract type Hom2Expr{T} <: CatExpr{T} end

abstract type HomVExpr{T} <: CatExpr{T} end
abstract type HomHExpr{T} <: CatExpr{T} end

Ob(m::Module, xs...) = Ob(m.Ob, xs...)

function Ob(ty::Type, xs...)
    if length(xs) <= 1; throw(MethodError(Ob, [ty, xs...]))
    end
    [Ob(ty, x) for x in xs]
end
