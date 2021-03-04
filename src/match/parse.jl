parse(_, ::LineNumberNode) = wildcard()
parse(::Function, q::QuoteNode) = literal(q.value)
parse(::Function, s::String) = literal(s)
parse(::Function, s::Symbol) = s === :_ ? wildcard() : effect_capture(s)
function parse(eval::Function, e::Expr)
    p(x)::Function = parse(eval, x)
    hd = e.head
    xs = e.args
    n = length(xs)
    if hd === :||
        @assert n === 2
        l, r = xs
        or(p(l), p(r))
    elseif hd === :&&
        @assert n === 2
        l, r = xs
        and(p(l), p(r))
    elseif hd === :if
        @assert n === 2
        let x = xs[1]; guard() do _, scope, _; scope_vars(x, scope) end
        end
    elseif hd === :let
        b = xs[1]
        @assert b isa Expr
        if b.head === :(=)
            @assert b.args[1] isa Symbol
            effect_bind(b.args[1], b.args[2], capture=true)
        else
            @assert b.head === :block
            bs = Function[effect_bind(x.args[1], x.args[2], capture=true) for x in b.args]
            push!(bs, wildcard())
            and(bs)
        end
    elseif hd === :&
        @assert n === 1
        guard() do t, scope, _; scope_vars(:($t == $xs[1]), scope) end
    elseif hd === :(::)
        if n === 2
            n, t = xs
            and(decons_isa(eval(t)), p(n))
        else
            @assert n === 1
            decons_isa(eval(xs[1]))
        end
    elseif hd === :vect
        t, xs = ellipsis_split(xs)
        t isa Val{:vec} ? decons_vec([p(x) for x in xs]) :
            let (init, mid, tail) = xs; decons_vec3([p(x) for x in init], p(mid), [p(x) for x in tail]) end
    elseif hd === :tuple
        decons_tuple([p(x) for x in xs])
    elseif hd === :call
        let f = xs[1], xs′ = view(xs, 2:length(xs))
            n′ = n - 1
            t = eval(f)
            if t === Core.svec
                tag, xs = ellipsis_split(xs′)
                return tag isa Val{:vec} ? decons_svec([p(x) for x in xs]) :
                    let (init, mid, tail) = xs; decons_svec3([p(x) for x in init], p(mid), [p(x) for x in tail]) end
            end
            ss = Symbol[]
            fs = []
            ks = fieldnames(t)
            if n′ >= 1 && Meta.isexpr(xs′[1], :parameters)
                kw = xs′[1].args
                xs′ = view(xs′, 2:length(xs′))
            else kw = []
            end
            if length(ks) === length(xs′)
                append!(fs, [p(x) for x in xs′])
                append!(ss, ks)
            elseif length(ss) !== 0
                error("count of fields should be 0 or same as fields($ks)")
            end
            for k in kw
                if k isa Symbol
                    k in ks || error("unknown field $k for $t")
                    push!(ss, k)
                    push!(fs, effect_capture(k))
                elseif Meta.isexpr(k, :kw)
                    k, v = k.args
                    k in ks || error("unknown field $k for $t")
                    @assert k isa Symbol
                    push!(ss, k)
                    push!(fs, and(effect_capture(k), p(v)))
                end
            end
            decons_struct(t, ss, fs)
        end
    elseif hd === :quote
        p(to_expr(xs[1], true))
    else error("not implemented expr=>pattern for '($hd)'")
    end
end
parse(::Function, x) = isprimitivetype(typeof(x)) ? literal(x) : error("invalid literal $x")
