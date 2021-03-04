Bodies = Dict{Int,Any}
Context = @NamedTuple{ty, ln}
OptLine = Union{LineNumberNode,Nothing}

Scope = Chain{Symbol,Symbol}
Cache = Chain{Pair{QType,Any},Tuple{Symbol,Bool}}

Pack = @NamedTuple{and, or, literal, wildcard, decons, guard, effect}
Packs{N} = NTuple{N,Pack}

struct Env
    scope::Scope
    cache::Cache
    bs::Bodies
    hygienic::Bool
    ret::Symbol
    exit::Symbol
end
Env(bs::Bodies, hygienic::Bool, ret::Symbol, exit::Symbol) = Env(Scope(), Cache(), bs, hygienic, ret, exit)

function (env::Env)(;scope::Union{Nothing,Scope}=nothing,cache::Union{Nothing,Cache}=nothing)
    scope === nothing && (scope = env.scope)
    cache === nothing && (cache = env.cache)
    Env(scope, cache, env.bs, env.hygienic, env.ret, env.exit)
end

function init_syms(c::Cache)
    b = Expr(:block)
    xs = b.args
    each_chain_dup(c) do _, (s, _); push!(xs, :($s = nothing)) end
    if isempty(xs); true else b end
end

struct Target{B}
    val
    ty::Ref{QType}
end

empty = Context((nothing, nothing))

and(xs...) = and(collect(xs))
function and(fs::Vector{<:Function}, c::Context=empty)
    run(p::Pack) = p.and([f(p) for f in fs], c)
    function run(ps::Packs{N}) where N
        r = Vector{Any}(undef, N)
        xs = [f(ps) for f in fs]
        for i in 1:N; r[i] = ps[i].and(xs) end
        r
    end
    function run(env::Env, t::Target{false})::Cond
        @assert !isempty(fs)
        f = fs[1]
        xs = view(fs, 2:length(fs))
        (flag, env, r) = foldl(xs, init=(true, env, f(env, t))) do (flag, env, prev), x
            y = flag && prev isa TrueCond
            if !y && flag; env = env(cache=child(env.cache)) end
            y, env, AndCond(prev, x(env, t))
        end
        if !flag; update_parent!(env.cache) end
        r
    end
    function run(env::Env, t::Target{true})::Cond
        t′ = t.with_val(gensym(), Val(false))
        AndCond(TrueCond(:($(t′.val) = $(t.val))), run(env, t′))
    end
    run
end

or(xs...) = or(collect(xs))
function or(fs::Vector{<:Function}, c::Context=empty)
    run(p::Pack) = p.or([f(p) for f in fs], c)
    function run(ps::Packs{N}) where N
        r = Vector{Any}(undef, N)
        xs = [f(ps) for f in fs]
        for i in 1:N; r[i] = ps[i].or(xs) end
        r
    end
    function run(env::Env, t::Target{false})::Cond
        @assert !isempty(fs)
        cs = Cond[]
        scope = env.scope
        cache = env.cache
        ss = Dict{Symbol,Symbol}[]
        for f in fs
            s = child(scope)
            push!(cs, f(env(;scope=s, cache), t.clone))
            push!(ss, s.dict)
        end
        n = length(fs)
        ks = reduce(intersect!, (keys(x) for x in ss[2:n]), init=Set(keys(ss[1])))
        for k in ks
            s = gensym(k)
            for i in eachindex(cs)
                old = ss[i][k]
                cs[i] = AndCond(cs[i], TrueCond(:($s = $old)))
            end
            scope[k] = s
        end
        foldr(OrCond, cs)
    end
    function run(env::Env, t::Target{true})::Cond
        t′ = t.with_val(gensym(), Val(false))
        AndCond(TrueCond(:($(t′.val) = $(t.val))), run(env, t′))
    end
    run
end

function literal(x, c::Context=empty)
    run(p::Pack) = p.literal(x, c)
    function run(ps::Packs{N}) where N
        r = Vector{Any}(undef, N)
        for i in 1:N; r[i] = ps[i].literal(x) end
        r
    end
    function run(::Env, t::Target)::Cond
        ty = typeof(x)
        if x isa Symbol; x = QuoteNode(x) end
        (isprimitivetype(ty) || ty.size == 0 && !ty.mutable) ? CheckCond(:($(t.val) === $x)) : CheckCond(:($(t.val) == $x))
    end
    run
end

function wildcard(c::Context=empty)
    run(p::Pack) = p.wildcard(c)
    function run(ps::Packs{N}) where N
        r = Vector{Any}(undef, N)
        for i in 1:N; r[i] = ps[i].wildcard() end
        r
    end
    run(::Env, ::Target)::Cond = TrueCond()
    run
end

const UNCACHED = 0
const MAY_CACHE = 1
const CACHED = 2

function _memo(f::Function, c::Cache, p::Prep; ty::QType, depend::Union{Nothing,Prep}=nothing)
    if p isa Uncached; f(nothing, UNCACHED)
    elseif p isa Cached
        k = depend === nothing ? p : (depend => p)
        k = Pair{QType,Any}(ty, k)
        v = get(c, k, nothing)::Union{Tuple{Symbol,Bool},Nothing} 
        if v === nothing; (s, flag) = (gensym("cache"), false,)
        else (s, flag) = v
        end
        if flag; f(s, CACHED)
        else
            f(s, MAY_CACHE)
            c[k] = (s, true)
        end
    end
end

decons(f::Function, fs) = decons(Combo("identity", (_...) -> Any), f, fs)
decons(c::Combo, fs; extract=(_, _) -> error("invalid")) = decons(c, extract, fs)
function decons(co::Combo, fn::Function, fs, c::Context=empty)
    run(p::Pack) = p.decons(co, fn, [f(p) for f in fs], c)
    function run(ps::Packs{N}) where N
        r = Vector{Any}(undef, N)
        xs = [f(ps) for f in fs]
        for i in 1:N; r[i] = ps[i].decons(co, fn, xs) end
        r
    end
    ty = c.ty
    ln = c.ln
    function run(env::Env, t::Target{false})::Cond
        scope = env.scope
        cache = env.cache
        s::Symbol = t.val
        r = t.ty <: ty ? TrueCond() : (t.narrow!(ty); CheckCond(:($(t.val) isa $ty)))
        _memo(cache, co.guard1; ty) do x, flag
            if flag === UNCACHED; r = AndCond(r, CheckCond(co.guard1(s)))
            elseif flag === CACHED; r = AndCond(r, CheckCond(:($x.value)))
            else
                @assert flag === MAY_CACHE
                g = co.guard1(s)
                cached = Expr(:if, :($x === nothing), :($x = Some($g)))
                r = AndCond(r, AndCond(TrueCond(cached), CheckCond(:($x.value))))
            end
        end
        w::Any = s
        _memo(cache, co.view; ty) do x, flag
            if flag === UNCACHED
                w = gensym()
                v = co.view(s)
                r = AndCond(r, TrueCond(:($w = $v)))
            elseif flag === CACHED; w = :($x.value)
            else
                @assert flag === MAY_CACHE
                v = co.view(s)
                cached = Expr(:if, :($x === nothing), :($x = Some($v)))
                r = AndCond(r, TrueCond(cached))
                w = :($x.value)
            end
        end
        _memo(cache, co.guard2;ty,depend=co.view) do x, flag
            if flag === UNCACHED; r = AndCond(r, CheckCond(co.guard2(w)))
            elseif flag === CACHED; r = AndCond(r, CheckCond(:($x.value)))
            else
                @assert flag === MAY_CACHE
                g = co.guard2(w)
                cached = Expr(:if, :($x === nothing), :($x = Some($g)))
                r = AndCond(r, AndCond(TrueCond(cached), CheckCond(:($x.value))))
            end
        end
        for i in eachindex(fs)
            f = fs[i]
            cache = Cache()
            field = Target{true}(fn(w, i, scope, ln), Ref{QType}(Any))
            c = f(env(;cache), field)
            r = AndCond(r, AndCond(TrueCond(init_syms(cache)), c))
        end
        r
    end
    function run(env::Env, t::Target{true})::Cond
        t′ = t.with_val(gensym(), Val(false))
        AndCond(TrueCond(:($(t′.val) = $(t.val))), run(env, t′))
    end
    run
end

function guard(f::Function, c::Context=empty)
    run(p::Pack) = p.guard(f, c)
    function run(ps::Packs{N}) where N
        r = Vector{Any}(undef, N)
        for i in 1:N; r[i] = ps[i].guard(f) end
        r
    end
    function run(env::Env, t::Target{false})::Cond
        r = f(t.val, env.scope, c.ln)
        r === true ? TrueCond() : CheckCond(r)
    end
    function run(env::Env, t::Target{true})::Cond
        t′ = t.with_val(gensym(), Val(false))
        AndCond(TrueCond(:($(t′.val) = $(t.val))), run(env, t′))
    end
    run
end

function effect(f::Function, c::Context=empty)
    run(p::Pack) = p.effect(f, c)
    function run(ps::Packs{N}) where N
        r = Vector{Any}(undef, N)
        for i in 1:N; r[i] = ps[i].effect(f) end
        r
    end
    run(env::Env, t::Target{false})::Cond = TrueCond(f(t.val, env.scope, c.ln))
    function run(env::Env, t::Target{true})::Cond
        t′ = t.with_val(gensym(), Val(false))
        AndCond(TrueCond(:($(t′.val) = $(t.val))), run(env, t′))
    end
    run
end

function unpack()::Pack
    Pack((and,
      or,
      literal,
      wildcard,
      decons,
      guard,
      effect))
end

function types_pack()::Pack
    function and(xs)
        @assert !isempty(xs)
        ts = getindex.(xs, 1)
        t = reduce(typeintersect, ts)
        if t === Base.Bottom; error("empty intersection for $(ts)") end
        t
    end
    function or(xs)
        ts = getindex.(xs, 1)
        Union{ts...}
    end
    function literal(x)
        t = typeof(x)
        t === String ? AbstractString : t
    end
    wildcard() = Any
    function decons(c::Combo, _, xs)
        ts = getindex.(xs, 1)
        try
            c.tcons(ts...)
        catch e
            join(map(repr, ts), ",")
            if e isa MethodError && e.f === c.tcons
                s = join(repeat(String["_"], length(ts)), ", ")
                error("invalid deconstructor $(c.repr)($(s))")
            end
            rethrow()
        end
    end
    guard(_) = Any
    effect(_) = Any
    (;and, or, literal, wildcard, decons, guard, effect)
end

abstract type QBox end

struct Box
    ty::QType
    box::QBox
end

struct And <: QBox; bs::Vector{Box} end
struct Or <: QBox; bs::Vector{Box} end
struct Literal{T} <: QBox; val::T end
struct Wildcard <: QBox end
struct Decons <: QBox; co::Combo; fn::Function; bs::Vector{Box} end
struct Guard <: QBox; fn end
struct Effect <: QBox; fn end

function box_pack()::Pack
    b(x) = Box(x[1], x[2])
    and(xs::Vector{Vector{Any}}) = And(Box[b(x) for x in xs])
    or(xs::Vector{Vector{Any}}) = Or(Box[b(x) for x in xs])
    decons(c::Combo, fn::Function, xs) = Decons(c, fn, Box[b(x) for x in xs])
    (;and, or, literal=Literal, wildcard=Wildcard, decons, guard=Guard, effect=Effect)
end

unbox(b::Box, ln::LineNumberNode) = unbox(Context((b.ty, ln)), b.box)
unbox(c::Context, x::And) = and([unbox(b, c.ln) for b in x.bs], c)
unbox(c::Context, x::Or) = or([unbox(b, c.ln) for b in x.bs], c)
unbox(c::Context, x::Literal) = literal(x.val, c)
unbox(c::Context, ::Wildcard) = wildcard(c)
unbox(c::Context, x::Decons) = decons(x.co, x.fn, [unbox(b, c.ln) for b in x.bs], c)
unbox(c::Context, x::Guard) = guard(x.fn, c)
unbox(c::Context, x::Effect) = effect(x.fn, c)

function decons_isa(t, repr="isa $t")
    decons(Combo(repr, (_...) -> t), [])
end

seq_idx(x, i::Int, _...) = :($x[$i])
mk_type(i::Int, ::Type{T}) where {T} = isabstracttype(T) ? TypeVar(Symbol(:var, i), T) : T

function decons_tuple(fs, repr="Tuple")
    function tcons(xs...)
        ts = [mk_type(i, xs[i]) for i in eachindex(xs)]
        foldl(ts, init=Tuple{ts...}) do prev, t
            t isa TypeVar ? UnionAll(t, prev) : prev
        end
    end
    decons(Combo(repr, tcons), seq_idx, fs)
end

len_eq(x, n::Int) = n === 0 ? :(isempty($x)) : :(length($x) === $n)

function decons_vec(fs, repr="1DVector")
    n = length(fs)
    c = Combo(repr, (_...) -> AbstractArray; guard1=Uncached(x -> len_eq(x, n)))
    decons(c, seq_idx, fs)
end

function decons_svec(fs, repr="svec")
    n = length(fs)
    c = Combo(repr, (_...) -> Core.SimpleVector; guard1=Uncached(x -> :(ndims($x) === 1 && length($x) === $n)))
    decons(c, seq_idx, fs)
end

function decons_vec3(init, f, tail, repr="1DVector Pack")
    n = length(init) + length(tail)
    c = Combo(repr, (_...) -> AbstractArray; guard1=Uncached(x -> :(ndims($x) === 1 && length($x) >= $n)))
    n1 = length(init)
    n2 = length(tail)
    function fn(x, i::Int, _...)
        if i <= n1; :($x[$i])
        elseif i === n1 + 1
            n2 === 0 ? :($SubArray($x, ($(n1 + 1):length($x),)) ) :
              :($SubArray($x, ($(n1 + 1):length($x) - $n2,)) )
        else
            d = i - n1 - 1
            j = n2 - d
            r = j == 0 ? :($x[end]) : :($x[end - $j])
            :($r)
        end
    end
    decons(c, fn, [init; f; tail])
end

function decons_svec3(init, f, tail, repr="svec Pack")
    n = length(init) + length(tail)
    c = Combo(repr, (_...) -> Core.SimpleVector; guard1=Uncached(x -> :(length($x) >= $n)))
    n1 = length(init)
    n2 = length(tail)
    function fn(x, i::Int, _...)
        if i <= n1; :($x[$i])
        elseif i === n1 + 1
            n2 === 0 ? :($x[$(n1 + 1):end]) : :($x[$(n1 + 1):end - $n2])
        else
            d = i - n1 - 1
            j = n2 - d
            j == 0 ? :($x[end]) : :($x[end - $j])
        end
    end
    decons(c, fn, [init; f; tail])
end

function decons_struct(t, fields, fs, repr="$t")
    c = Combo(repr, (_...) -> t)
    decons(c, (x, i::Int, _...) -> :($x.$(fields[i])), fs)
end

self_idx(x, i::Int, _...) = (@assert i === 1; x)

function decons_view(t, f, repr="ViewBy($t)")
    c = Combo(repr, (_...) -> Any; view=Cached(t))
    decons(c, self_idx, [f])
end

function decons_view_fast(tcons, t, f, repr="ViewBy($t, tcons=$tcons)")
    c = Combo(repr, tcons; view=Cached(t))
    decons(c, self_idx, [f])
end

function effect_bind(s::Symbol, x; capture=false)
    function f(_, scope::Chain{Symbol,Symbol}, ::OptLine)
        x = capture ? scope_vars(x, scope) : x
        s = scope[s] = gensym(s)
        :($s = $x)
    end
    effect(f)
end

function effect_capture(s::Symbol)
    function f(t, scope::Chain{Symbol,Symbol}, ::OptLine)
        if t isa Symbol
            scope[s] = t
            return
        end
        s = scope[s] = gensym(s)
        :($(s) = $t)
    end
    effect(f)
end
