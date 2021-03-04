struct Q end
struct Do end
struct Many end
struct GuardBy end

struct Where
    val
    ty
    params::AbstractArray{T,1} where {T}
end

parse(::Module, s::String) = literal(s)
parse(::Module, q::QuoteNode) = literal(q.value)
parse(m::Module, p::QuotePat) = and([decons_isa(QuoteNode), decons((x, _...) -> :($x.value), [parse(m, p.val)])])
function parse(m::Module, s::Symbol)
    if s === :_; wildcard()
    elseif s === :nothing; literal(nothing)
    else
        if isdefined(m, s)
            t = getfield(m, s)
            is_enum(t) && return post_parse(t, x -> parse(m, x), [], [], [])
        end
        effect_capture(s)
    end
end
function parse(m::Module, e::Expr)
    eval = m.eval
    p(x) = parse(m, x)
    @switch_raw e begin
        @case Expr(:||, xs); return or(map(p, xs))
        @case Expr(:&&, xs); return and(map(p, xs))
        @case Expr(:if, [x, Expr(:block, _)])
        return guard() do _, scope, _; scope_vars(x, scope) end
        @case Expr(:let, xs)
        b = xs[1]
        @assert b isa Expr
        return if b.head === :(=)
            @assert b.args[1] isa Symbol
            effect_bind(b.args[1], b.args[2], capture=true)
        else
            @assert b.head === :block
            bs = Function[effect_bind(x.args[1], x.args[2], capture=true) for x in b.args]
            push!(bs, wildcard())
            and(bs)
        end
        @case Expr(:&, [x])
        return guard() do t, scope, _; scope_vars(:($t == $x), scope) end
        @case Expr(:vect, xs)
        t, xs = ellipsis_split(xs)
        return t isa Val{:vec} ? decons_vec([p(x) for x in xs]) :
            let (init, mid, tail) = xs; decons_vec3([p(x) for x in init], p(mid), [p(x) for x in tail])
        end
        @case Expr(:tuple, xs)
        return decons_tuple([p(x) for x in xs])
        @case Expr(:quote, [x])
        return p(to_expr(x))
        @case Expr(:ref, [t, xs...])
        return post_parse(eval(t), p, xs)
        @case Expr(:where, [Expr(:call, [:($t{$(ts...)}), xs...]) || Expr(:call, [t, xs...]) && let ts = [] end, ps...]) && if t !== Where; end
        return post_parse(eval(t), p, ps, ts, xs)
        @case (Expr(:call, [:($t{$(ts...)}), xs...]) || Expr(:call, [t, xs...]) && let ts = [] end) && if t !== Where; end
        return post_parse(eval(t), p, [], ts, xs)
        @case Expr(:curly, [t, ts...])
        return post_parse(eval(t), p, [], ts, [])
        @case :($v::$t where {$(ps...)}) || :(::$t where {$(ps...)}) && let v = :_; end || :($v::$t) && let ps = []; end || :(::$t) && let v = :_, ps = []; end
        return parse(m, Where(v, t, ps))
        @case :($t[$v for $c in $cs if $cond]) || :($t[$v for $c in $cs]) && let cond = true; end || :[$v for $c in $cs if $cond] && let t = Any; end || :[$v for $c in $cs] && let cond = true, t = Any; end && if cs isa Symbol; end
        return parse_compreh(t, p, v, c, cs, cond)
        @case u
        error("Unrecognized pattern $(repr(u))")
    end
end

function get_tparams(xs::AbstractArray{T,1})::AbstractSet{Symbol} where T
    ss = Set{Symbol}()
    for x in xs
        get_tparams!(ss, x)
    end
    ss
end

function get_tparams_ordered(xs::AbstractArray{T,1})::Vector{Symbol} where T
    ss = Symbol[]
    for x in xs
        get_tparams!(ss, x)
    end
    unique!(ss)
    ss
end

function parse(m::Module, w::Where)
    p(x) = parse(m, x)
    @switch_raw w begin
        @case Where(val, t, ts)
        tset = get_tparams(ts)::Set{Symbol}
        should_guess, ty_guess = type_from(m, t, tset)
        ts = collect(tset)
        sort!(ts)
        g = guard() do target, scope, _
            if isempty(ts); return should_guess ? scope_vars(:($target isa $t), scope) : true end
            tp_ret = Expr(:tuple, ts...)
            targns = Symbol[]
            fn = gensym("extract type params")
            testn = gensym("test type params")
            ty_accurate = gensym("accurate type param")
            ret = Expr(:block)
            for x in ts
                push!(targns, gensym(x))
            end
            push!(ret.args,
                :($fn(::Type{$ty_accurate}) where {$(ts...),$ty_accurate <: $t} = $tp_ret),
                :($fn(_) = nothing),
                :($testn = $fn(typeof($target))),
                Expr(:if, :($testn !== nothing), Expr(:block, Expr(:(=), Expr(:tuple, targns...), testn), true), false, ),)
            for i in eachindex(ts); scope[ts[i]] = targns[i] end
            ret
        end
        return and([decons_isa(ty_guess), g, p(val)])
    end
end
parse(::Module, x) = isprimitivetype(typeof(x)) ? literal(x) : error("invalid literal $x")

function post_parse(::typeof(:), ::Function, ps::AbstractArray, ts::AbstractArray, xs::AbstractArray)
    @assert isempty(ps) && isempty(ts)
    guard() do t, scope, _
        e = Expr(:call, :, xs...)
        scope_vars(:($t in $e), scope)
    end
end
function post_parse(::Type{Capture}, p::Function, ps::AbstractArray, ts::AbstractArray, xs::AbstractArray)
    @assert isempty(ps) && isempty(ts)
    @assert length(xs) === 1
    function fn(::Any, ::Int, scope::Chain{Symbol,Symbol}, ::Any)
        e = Expr(:call, Dict)
        each_chain(scope) do k, v
            k = QuoteNode(k)
            push!(e.args, :($k => $v))
        end
        e
    end
    decons(fn, [p(xs[1])])
end
function post_parse(::Type{Expr}, p::Function, ps::AbstractArray, ts::AbstractArray, xs::AbstractArray)
    @assert isempty(ps) && isempty(ts)
    @switch_raw xs begin
        @case [Expr(:..., [_]), _...]
        return and([
              decons_isa(Expr), 
              decons_view(x -> :([$x.head, $x.args...]), p(Expr(:vect, xs...)))
              ])
        @case _
    end
    tuple = decons_tuple([p(xs[1]), p(Expr(:vect, view(xs, 2:length(xs))...))])
    and([
          decons_isa(Expr), 
          decons_view(x -> :($x.head, $x.args), tuple)
      ])
end
function post_parse(::Type{Core.SimpleVector}, p::Function, ps::AbstractArray, ts::AbstractArray, xs::AbstractArray)
    @assert isempty(ps) && isempty(ts)
    t, xs = ellipsis_split(xs)
    return t isa Val{:vec} ? decons_svec([p(x) for x in xs]) :
        let (init, mid, tail) = xs; decons_svec3([p(x) for x in init], p(mid), [p(x) for x in tail])
    end
end
function post_parse(::Type{QuoteNode}, p::Function, ps::AbstractArray, ts::AbstractArray, xs::AbstractArray)
    @assert isempty(ps) && isempty(ts)
    @assert length(xs) === 1
    p(QuotePat(xs[1]))
end
function post_parse(::Type{Some}, p::Function, ps::AbstractArray, ts::AbstractArray, xs::AbstractArray)
    @assert isempty(ps) && isempty(ts)
    @assert length(xs) === 1
    fn(x, i::Int, _...) = (@assert i === 1; :($x.value))
    decons(Combo("Some", (t, _...) -> Some{T} where {T <: t}; guard1=Uncached(x -> :($x !== nothing))), fn, [p(xs[1])])
end
function post_parse(::Type{Dict}, p::Function, ps::AbstractArray, ts::AbstractArray, xs::AbstractArray)
    isempty(ps) || return p(Where(Expr(:call, t, xs...), Expr(:curly, t, ts...), ps))
    ps = Pair[]
    for x in xs
        @switch_raw x begin
            @case :($a => $b)
            push!(ps, a => b)
            continue
            @case _
            error("A Dict sub-pattern should be `(a::Symbol) => b`.")
        end
    end
    function fn(x, i::Int, scope::Chain{Symbol,Symbol}, ::Any)
        k, v = ps[i]
        if k isa Union{Expr,Symbol}; k = scope_vars(k, scope) end
        :(haskey($x, $k) ? Some($x[$k]) : nothing)
    end
    t = isempty(ts) ? decons_isa(Dict) : p(:(::$Dict{$(ts...)}))
    d = decons(fn, [p(Expr(:call, Some, x.second)) for x in ps])
    and([t, d])
end
function post_parse(::Type{And}, p::Function, xs::AbstractArray)
    @assert !isempty(xs)
    and([p(x) for x in xs])
end
function post_parse(::Type{Or}, p::Function, xs::AbstractArray)
    @assert !isempty(xs)
    or([p(x) for x in xs])
end
function post_parse(::Type{Q}, p::Function, xs::AbstractArray)
    @assert length(xs) === 1
    p(Expr(:quote, xs[1]))
end
function post_parse(t::Type{Do}, p::Function, ps::AbstractArray, ts::AbstractArray, xs::AbstractArray)
    @assert isempty(ps) && isempty(ts)
    post_parse(t, p, xs)
end
function post_parse(t::Type{Many}, p::Function, ps::AbstractArray, ts::AbstractArray, xs::AbstractArray)
    @assert isempty(ps) && isempty(ts)
    post_parse(t, p, xs)
end
function post_parse(::Type{GuardBy}, ::Function, ps::AbstractArray, ts::AbstractArray, xs::AbstractArray)
    @assert isempty(ps) && isempty(ts)
    @assert length(xs) === 1
    guard() do t, _, _; :($(xs[1])($t)) end
end

function type_from(m::Module, x, ps::Set{Symbol})
    @switch_raw x begin
        @case :($t{$(args...)})
        t′ = type_from(m, t, ps)[2]
        t′ isa Type || error("$t should be a type!")
        t = t′
        rt_type_check = true
        if t === Union
            args = map(args) do a
                t′ = type_from(m, a, ps)[2]
                t′ isa Type ? t′ : Any
            end
            t = Union{args...}
        end
        return true, t
        @case t::Type
        return false, t
        @case ::Symbol
        x in ps || isdefined(m, x) && return (false, getfield(m, x))
        return true, Any
        @case _
        return true, Any
    end
end

function post_parse(::Type{Do}, ::Function, xs::AbstractArray)
    foreach(allow_assign!, xs)
    effect() do _, scope, _
        e = Expr(:block)
        for x in xs
            @switch x begin
                @case :($s = $v) && if s isa Symbol; end
                s′ = get(() -> nothing, scope, s)
                flag = true
                if s′ === nothing; s′ = s; flag = false
                else @assert s′ === s
                end
                push!(e.args, Expr(:(=), s′, scope_vars(v, scope)))
                if !flag; scope[s] = s′ end
                @case _
                push!(e.args, scope_vars(x, scope))
            end
        end
        e
    end
end
function post_parse(::Type{Many}, ::Function, xs::AbstractArray)
    @assert length(xs) === 1
    foreach(allow_assign!, xs)
    x = xs[1]
    old = repr(Expr(:call, :Do, xs...))
    new = repr(Expr(:let, Expr(:block, xs...), Expr(:block)))
    guard() do tgt, scope, ln
        tok = gensym("loop token")
        i = gensym("loop iter")
        case(x) = Expr(:macrocall, Symbol("@case"), ln, x)
        b = quote
            $(case(x))
            continue
            $(case(:_))
            $tok = false
            break
        end
        e = Expr(:macrocall, GlobalRef(Match, Symbol("@switch")), ln, i, b)
        exit = quote
            $tok = true
            for $i in $tgt; $e end
            $tok
        end
        scope_vars!(exit, scope)
    end
end

function allow_assign!(e::Expr)
    if e.head === :kw || e.head === :(=)
        @assert e.args[1] isa Symbol
        e.head = :(=)
    end
end

function parse_fields(t::Type, p::Function, ps::AbstractArray, ts::AbstractArray, xs::AbstractArray)
    isempty(ps) || return p(Where(Expr(:call, t, xs...), Expr(:curly, t, ts...), ps))
    partials = Symbol[]
    ns = fieldnames(t)
    fs = []
    @switch xs begin
        @case [Expr(:parameters, kw...), xs...]
        @case let kw = [] end
    end
    l = length(xs)
    if all(Meta.isexpr(x, :kw) for x in xs)
        for x in xs
            n = x.args[1]
            n in ns || error("$t has no field $n")
            push!(partials, n)
            push!(fs, p(x.args[2]))
        end
    elseif length(ns) === l
        append!(fs, map(p, xs))
        append!(partials, ns)
    elseif l === 1 && xs[1] === :_
    elseif l !== 0; error("count of fields should be 0 or fields($ns)")
    end
    for f in kw
        @switch f begin
            @case ::Symbol
            f in ns || error("unknown field $f for $t")
            push!(partials, f)
            push!(fs, effect_capture(f))
            continue
            @case Expr(:kw, k::Symbol, v)
            k in ns || error("unknown field $k for $t")
            push!(partials, k)
            push!(fs, and([effect_capture(k), p(v)]))
            continue
            @case _
            error("unknown pattern $f in $t")
        end
    end
    r = decons_struct(t, partials, fs)
    isempty(ts) && return r
    and([p(Expr(:(::), Expr(:curly, t, ts...))), r])
end

function parse_compreh(ty, p::Function, pat, recons, seq, cond)
    eltype = type_from(p.m, ty, Set{Symbol}())[2]
    function fn(target, ::Int, scope::Chain{Symbol,Symbol}, ln::LineNumberNode)
        tok = gensym("uncompreh token")
        i = gensym("uncompreh iter")
        vec = gensym("uncompreh seq")
        flag = gensym("uncompreh flag")
        f = gensym("uncompreh func")
        reconstruct_tmp = gensym("reconstruct")
        case(x) = Expr(:macrocall, Symbol("@case"), ln, x)
        body = quote
            $(case(pat))
            $reconstruct_tmp = $recons
            if $flag isa $Val{true}; return $reconstruct_tmp
            else
                if $cond; push!($vec.value, $reconstruct_tmp) end
                return true
            end
            $(case(:_))
            if $flag isa $Val{true}; error("impossible")
            else return false
            end
        end
        stmt = Expr(:macrocall, GlobalRef(Match, Symbol("@switch")), ln, i, body)
        exit = quote
            $Base.@inline $f($i, $flag::$Val) = $stmt
            $vec = $Base._return_type($f, $Tuple{$Base.eltype($target),$Val{true}})[]
            $vec = $Some($vec)
            for $i in $target
                $tok = $f($i, $Val(false))
                $tok && continue
                $vec = nothing
                break
            end
            $vec
        end
        scope_vars(exit, scope)
    end
    return and([
    decons_isa(AbstractArray{T,1} where {T <: eltype}), 
    decons(fn, [p(Expr(:call, Some, seq))])
    ])
end

function get_tparams!(syms, x)
    @switch x begin
        @case :($a >: $_) || :($a <: $_)
        @assert a isa Symbol
        push!(syms, a)
        return
        @case :($_ >: $b >: $_) || :($_ <: $b <: $_)
        @assert b isa Symbol    
        push!(syms, b)
        return
        @case ::Symbol
        push!(syms, x)
        return
        @case _
        return
    end
end
