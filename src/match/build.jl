Goto = Int
Link = Tuple{LineNumberNode,Goto}
Clause = Pair{Function,Link}
Branch = Pair{Box,Link}

struct Root
    ex::Expr
end

struct Flow
    op::Symbol
    val::Symbol
end

abstract type QCase end

struct Jump <: QCase
    goto::Goto
end

struct Case <: QCase
    box::Box
    ln::LineNumberNode
    sub::QCase
end
Case(b::Branch) = Case(b.first, b.second[1], Jump(b.second[2]))

struct Cases <: QCase
    cs::Vector{QCase}
end

struct CaseMap <: QCase
    cs::Dict{QType,QCase}
end

get_property(t::Target, ::Val{:ty}) = getfield(t, :ty)[]
get_property(t::Target, ::Val{:val}) = getfield(t, :val)
function get_property(t::Target{B}, ::Val{:with_ty}) where {B}
    run(x::QType) = Target{B}(t.val, Ref{QType}(x))
    run(x::QType, ::Val{B′}) where {B′} = Target{B′}(t.val, Ref{QType}(x))
    run
end
function get_property(t::Target{B}, ::Val{:with_val}) where {B}
    run(x) = Target{B}(x, getfield(t, :ty))
    run(x, ::Val{B′}) where {B′} = Target{B′}(x, getfield(t, :ty))
    run
end
function get_property(t::Target, ::Val{:narrow!})
    function (x::QType)
        r = getfield(t, :ty)
        if r[] <: x
        else r[] = x
        end
    end
end
get_property(t::Target{B}, ::Val{:clone}) where {B} = Target{B}(t.val, Ref{QType}(t.ty))

Base.getproperty(t::Target, s::Symbol) = get_property(t, Val(s))

function build(x, cs::Vector{Clause}, bs::Bodies, ln; hygienic=true)
    env = Env(bs, hygienic, gensym(:return), gensym(:exit))
    build(x, build_cases(cs), ln, env)
end
function build(x, c::QCase, ln::LineNumberNode, env::Env)
    t = Target{true}(x, Ref{QType}(Any))
    b = Expr(:block)
    es = b.args
    if env.hygienic; push!(es, :($(env.ret) = nothing)) end
    build!(t, es, c, env)
    pushfirst!(es, init_syms(env.cache))
    push!(es, Expr(:call, error, "match non-exhaustive at $ln"))
    push!(es, Flow(Symbol("@label"), env.exit))
    push!(es, env.ret)
    if env.hygienic; b = Expr(:let, Expr(:block), b) end
    Root(b)
end
function build!(::Target, es::Vector, j::Jump, env::Env)
    b = env.bs[j.goto]
    if env.hygienic
        e = Expr(:block)
        each_chain(env.scope) do k, v; push!(e.args, :($k = $v)) end
        b = Expr(:let, e, b)
    else each_chain(env.scope) do k, v; push!(es, :($k = $v)) end
    end
    r = env.ret
    push!(es, :($r = $b))
    push!(es, Flow(Symbol("@goto"), env.exit))
end
function build!(t::Target{B}, es::Vector, c::Case, env::Env) where {B}
    if B && !(c.sub isa Jump)
        s = gensym()
        push!(es, :($s = $(t.val)))
        t = t.with_val(s, Val(false))
    end
    f = unbox(c.box, c.ln)(unpack())
    push!(es, c.ln)
    e = to_expr(f(env, t))
    b = Expr(:block)
    build!(t, b.args, c.sub, env)
    push!(es, e === true ? b : Expr(:if, e, b))
end
function build!(t::Target{B}, es::Vector, cs::Cases, env::Env) where {B}
    if B
        s = gensym()
        push!(es, :($s = $(t.val)))
        t = t.with_val(s, Val(false))
    end
    for c in cs.cs
        build!(t.clone, es, c, env(;scope=child(env.scope)))
    end
end
function build!(t::Target{B}, es::Vector, cm::CaseMap, env::Env) where {B}
    if B
        s = gensym()
        push!(es, :($s = $(t.val)))
        t = t.with_val(s, Val(false))
    else s = t.val
    end
    for (ty, c) in cm.cs
        b = Expr(:block)
        cache = child(env.cache)
        build!(t.with_ty(ty), b.args, c, env(;scope=child(env.scope), cache))
        update_parent!(cache)
        push!(es, Expr(:if, :($s isa $ty), b))
    end
end

function split_ors!(to::Vector{Branch}, from::Vector{Branch})
  for (b, l) in from
      if b.box isa Or; split_ors!(to, Branch[b′ => l for b′ in b.box.bs])
      else push!(to, b => l)
      end
  end
end

function build_cases(cs::Vector{Clause})
    xs = Branch[]
    packs::Packs{2} = (types_pack(), box_pack())
    for (f, l) in cs; push!(xs, Box(f(packs)...) => l) end
    bs = Branch[]
    split_ors!(bs, xs)
    top = reduce(typejoin, QType[b.ty for (b, _) in bs]; init=Any)
    build_cases(top, bs)
end
function build_cases(top::QType, bs::Vector{Branch})::QCase
    if length(bs) === 1; return Case(bs[1]) end
    @assert !isempty(bs)
    ts = Vector{QType}(undef, length(bs))
    groups = [1]
    for i in eachindex(bs)
        t = bs[i].first.ty
        @assert t <: top
        if t === top
            push!(groups, i)
            push!(groups, i + 1)
            ts[i] = t
            continue
        end
        js = Int[]
        xs = QType[]
        for j in groups[end]:i - 1
            if typeintersect(t, ts[j]) !== Base.Bottom
                push!(js, j)
                push!(xs, ts[j])
            end
        end
        join = reduce(typejoin, xs, init=t)
        for j in js; ts[j] = join end
        ts[i] = join
    end
    push!(groups, length(bs) + 1)
    n = length(groups)
    if n === 2 && all(ts .=== top); return Cases([Case(b) for b in bs]) end
    cs = QCase[]
    for i in 1:n - 1
        s = groups[i]
        e = groups[i + 1] - 1
        if s === e; push!(cs, Case(bs[s])); continue
        elseif s > e; continue
        end
        d = Dict{QType,Vector{Branch}}()
        for j in s:e
            xs = get!(d, ts[j]) do; Branch[] end
            push!(xs, bs[j])
        end
        ps = Pair{QType,QCase}[k => build_cases(k, v) for (k, v) in d]
        push!(cs, CaseMap(Dict(ps)))
    end
    length(cs) === 1 ? cs[1] : Cases(cs)
end
