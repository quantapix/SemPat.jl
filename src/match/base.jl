QType = Union{DataType,Union,UnionAll}

struct Chain{K,V}
    dict::Dict{K,V}
    init::Ref{Chain{K,V}}
end

abstract type Cond end

struct CheckCond <: Cond; ex end
struct TrueCond <: Cond; ex end
TrueCond() = TrueCond(true)

struct AndCond <: Cond
  left::Cond
  right::Cond
end

struct OrCond <: Cond
  left::Cond
  right::Cond
end

abstract type Prep end

struct Skip <: Prep end
struct Cached <: Prep; fn::Function end
(x::Cached)(y) = x.fn(y)
struct Uncached <: Prep; fn::Function end
(x::Uncached)(y) = x.fn(y)

struct Combo
    repr::AbstractString
    tcons::Function
    guard1::Prep
    view::Prep
    guard2::Prep
end
Combo(r, tcons; guard1=Skip(), view=Skip(), guard2=Skip()) = Combo(r, tcons, guard1, view, guard2)

struct TyBind
    name::Symbol
    ts::Set{Any}
end

function TyBind(s::Symbol)
    is_tb(s) || return s
    ts = map(Symbol, split(string(s), "_"))
    n = popfirst!(ts)
    totype(x::Symbol) = string(x)[1] in 'A':'Z' ? x : Expr(:quote, x)
    ts = map(totype, ts)
    Expr(:$, :(TyBind($(Expr(:quote, n)), Set{Any}([$(ts...)]))))
end

tybind(x) = x
tybind(s::Symbol) = TyBind(s)
tybind(e::Expr) = is_expr(e, :line) ? e : Expr(tybind(e.head), map(tybind, e.args)...)

struct OrBind; left; right end

OrBind_(a, b) = OrBind(a, b)
OrBind_(p...) = foldl(OrBind_, p)

function OrBind(x)
    is_or(x) || return x
    OrBind_(x.args[2:end]...)
end

orbind(x) = x
orbind(s::Symbol) = s
orbind(e::Expr) = is_or(e) ? orbind(OrBind(e)) : Expr(e.head, map(orbind, e.args)...)
orbind(b::OrBind) = OrBind(orbind(b.left), orbind(b.right))

struct Capture end
struct QuotePat; val::Any end

PackUnsolvedException = ErrorException

struct LikeError; pat; ex end

struct PackError <: Exception
    ln::Union{LineNumberNode,Nothing}
    msg::String
end

struct InternalException <: Exception; msg::String end
struct SyntaxError <: Exception; msg::String end
struct UnknownExtension <: Exception; ext::Union{String,Symbol} end
