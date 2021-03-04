is_enum(_) = false

is_inrange(i, range, len) = range ≠ (0, 0) && i ≥ range[1] && i ≤ len + 1 - range[2]

is_or(x) = is_expr(x, :call) && x.args[1] in (:or_, :|)

is_structdef(x) = Meta.isexpr(x, :struct)

is_tb(s::Symbol) = !(endswith(string(s), "_") || endswith(string(s), "_str")) && occursin("_", string(s))
is_tb(x) = false

is_like(pat, x) = false

namify(s::Symbol) = s
namify(e::Expr) = namify(e.args[1])

walk(x, inner, outer) = outer(x)
walk(e::Expr, inner, outer) = outer(Expr(e.head, map(inner, e.args)...))

prewalk(f, x)  = walk(f(x), x -> prewalk(f, x), identity)
postwalk(f, x) = walk(x, x -> postwalk(f, x), f)

strip_lines(x) = prewalk(rm_lines, x)
replace(e, p, s) = prewalk(x -> x == p ? s : x, e)

macro q(x)
    esc(Expr(:quote, strip_lines(x)))
end
export @q

"""
[a, b..., c] -> :vec3 => [a], b, [c]
[a, b, c]    -> :vec => [a, b, c]
"""
function ellipsis_split(xs::AbstractArray{T,1}) where {T}
    i = findfirst(x -> Meta.isexpr(x, :...), xs)
    i === nothing ? Val(:vec) => xs : Val(:vec3) => (xs[1:i - 1], xs[i].args[1], xs[i + 1:end],)
end

function make_expr!(es::Vector, xs::Vector, c::CheckCond)
    e = c.ex
    if !isempty(xs)
        e = Expr(:block, xs..., e)
        empty!(xs)
    end
    push!(es, e)
end
function make_expr!(::Vector, xs::Vector, c::TrueCond)
    e = c.ex
    e isa Union{Bool,Int,Float64,Nothing} && return
    push!(xs, e)
    nothing
end
function make_expr!(es::Vector, xs::Vector, c::AndCond)
    make_expr!(es, xs, c.left)
    make_expr!(es, xs, c.right)
end
function make_expr!(es::Vector, xs::Vector, c::OrCond)
    es′ = []
    xs′ = []
    make_expr!(es′, xs′, c.left)
    left = to_expr(es′, xs′)
    empty!(es′)
    empty!(xs′)
    make_expr!(es′, xs′, c.right)
    right = to_expr(es′, xs′)
    empty!(es′)
    empty!(xs′)
    bool_or = Expr(:||, left, right)
    if !isempty(xs)
        bool_or = Expr(:block, xs..., bool_or)
        empty!(xs)
    end
    push!(es, bool_or)
end

to_expr(s::Symbol, _...) = QuoteNode(s)
to_expr(n::QuoteNode, _...) = QuotePat(to_expr(n.value))
function to_expr(e::Expr, vect=false)
    Meta.isexpr(e, :$) && return e.args[1]
    vect ? 
    Expr(:call, Expr, QuoteNode(e.head), Expr(:vect, (to_expr(x, vect) for x in e.args if !(x isa LineNumberNode))...)) :
    Expr(:call, Expr, QuoteNode(e.head), (to_expr(x) for x in e.args if !(x isa LineNumberNode))...)
end
function to_expr(c::Cond)
    es = []
    xs = []
    make_expr!(es, xs, c)
    to_expr(es, xs)
end
function to_expr(es::Vector, xs::Vector)
    bool_and(a, b) = Expr(:&&, a, b)
    if isempty(xs)
        isempty(es) && return true
        foldr(bool_and, es)
    else
        init = Expr(:block, xs..., true)
        foldr(bool_and, es, init=init)
    end
end
to_expr(x, _...) = x

function inexpr(e, x)
    r = false
    postwalk(e) do y
        if y == x; r = true
        end
        return y
    end
    return r
end

_unresolve(x) = x
_unresolve(f::Function) = methods(f).mt.name

unresolve(x) = prewalk(_unresolve, x)

function gensym_name(s::Symbol)
    m = Base.match(r"##(.+)#\d+", String(s))
    m === nothing || return m.captures[1]
    m = Base.match(r"#\d+#(.+)", String(s))
    m === nothing || return m.captures[1]
    return "x"
end

function gensym_ids(e)
    c = 0
    d = Dict{Symbol,Symbol}()
    prewalk(e) do x
        is_gensym(x) ? get!(() -> Symbol(gensym_name(x), "_", c += 1), d, x) : x
    end
end

function gensym_alias(e)
    left = copy(animals)
    d = Dict{Symbol,Symbol}()
    prewalk(e) do x
        is_gensym(x) ? get!(() -> pop!(left), d, x) : x
    end
end

macro expand(x)
    :(gensym_alias(macroexpand($(__module__), $(x,)[1])))
end

"""
@> x f = f(x)
@> x g f == f(g(x))
@> x a b c d e == e(d(c(b(a(x)))))
@> x g(y, z) f == f(g(x, y, z))
@> x g f(y, z) == f(g(x), y, z)
"""
macro >(xs...)
    thread(x) = is_expr(x, :block) ? thread(rm_lines(x).args...) : x
    thread(x, e) =
        is_expr(e, :call, :macrocall) ? Expr(e.head, e.args[1], x, e.args[2:end]...) :
        is_expr(e, :block) ? thread(x, rm_lines(e).args...) : Expr(:call, e, x)
    thread(x, es...) = reduce(thread, es, init=x)
    esc(thread(xs...))
end

"""
@>> x g(y, z) f == f(g(y, z, x))
@>> x g f(y, z) == f(y, z, g(x))
"""
macro >>(xs...)
    thread(x) = is_expr(x, :block) ? thread(rm_lines(x).args...) : x
    thread(x, e) =
        is_expr(e, :call, :macrocall) ? Expr(e.head, e.args..., x) :
        is_expr(e, :block) ? thread(x, rm_lines(e).args...) : Expr(:call, e, x)
    thread(x, es...) = reduce(thread, es, init=x)
    esc(thread(xs...))
end
