function make_method(ty, sig::Sig, typs::Ts, deps::Ds) where {Ts <: AbstractArray{Symbol},Ds <: AbstractArray{Pair{Symbol,Expr}}}
    by_typs = intersect!(sig.infer, typs)
    by_deps  = setdiff!(Set(typs), by_typs)
    infer = Expr[]
    for (x, e) in deps
        if x in by_deps
            push!(infer, e)
            delete!(by_deps, x)
        end
    end
    n = sig.name
    if !isempty(by_deps)
        x = join(map(string, collect(by_deps)), ", ")
        error("Cannot infer param(s) ($x) for $n, trait $ty")
    end
    ts = sig.ts
    ret = sig.ret
    ws = sig.ws
    @when let :($t{$(xs...)}) = ts, (t === Tuple).?
        b = gensym(string(n))
        ns = [Symbol(b, i) for i in 1:length(xs)]
        annos = [:($n::$x) for (n, x) in zip(ns, xs)]
        @q begin
            function $n($(annos...)) where {$(by_typs...),$(ws...)}
                $(infer...)
                ($ty($(typs...)).$n($(ns...)))::$ret
            end
        end
        @otherwise
        error("Invalid method $n($ts) for trait $ty")
    end
end

function default_make_code(w::Wheres, c::Code)
    f = Symbol("mk.", c.name)
    def = @q begin
        $f($(w.ts...)) where {$(w.ws...)} = $(c.ex)
    end
    (c.name, f, def)
end

function default_make_method(ty, n)
    @assert n isa Val
    f(::Val{n}) where n = n
    error("No default method $(f(n)) for $ty")
end

mk_trait(ts::Ts) where Ts <: AbstractArray{Symbol} = @match ts begin
    [] => Nil
    [x, xs...] => :($Cons{$x,$(mk_trait(xs))})
end

function make_trait(t, block, ln::LineNumberNode)
    sups, tr = pull_trait(t)
    deps = Vector{Pair{Symbol,Expr}}()
    @when :($t where {$(ws...)}) = tr begin
        tr = t
        if !isempty(ws)
            foreach(ws) do w
                @when :($(t::Symbol) = $_) = w begin
                    push!(deps, t => w)
                    @otherwise
                    error("Malformed dependency $w for trait $t")
                end
            end
        end
    end
    @when let :($ty{$(ts...)}) = tr,
            Expr(:block, xs...) = block
        ms = filter(x -> !(x isa LineNumberNode), map(pull_method, xs))
        ss = filter(x -> x isa Sig, ms)
        cs = filter(x -> x isa Code, ms)
        vs = map(pull_var, ts)
        ifaces = [make_method(ty, s, vs, deps) for s in ss]
        n = Symbol(string(ty), "#instance")
        ns = map(x -> x.name, ss)
        ts = map(x -> Symbol(x, "#t"), ns)
        fs = [:($n::$t) for (n, t) in zip(ns, ts)]
        (default_mks,  warn_mks) =
          let xs = map(x -> default_make_code(Wheres(vs), x), cs)
            map(x -> x[3], xs),
              map(xs) do (n, mk, _)
                @q begin
                    $ln
                    $Trait.default_make_method(::Type{$ty}, ::Val{$(QuoteNode(n))}) = $mk
                    $ln
                end
            end
        end
        @q begin
            $ln
            abstract type $tr <: $PTrait{$(mk_trait(vs))} end
            struct $n{$(ts...)}
                $(fs...)
            end
            $Trait.check_heritage(::Type{$ty}, $(vs...)) = begin
                $(sups...)
                nothing
            end
            $Trait.instance(::Type{$ty}) = $n
            $(ifaces...)
            $(default_mks...)
            $(warn_mks...)
            $ln
        end
        @otherwise
        error("Malformed trait $tr definition")
    end
end

(tr::Type{<:PTrait})(xs...) = begin
    Trait.check_heritage(tr, xs...)
    ts = join(map(string, xs), ", ")
    error("Not impled trait $tr for ($ts)")
end

macro trait(t, block=Expr(:block))
    make_trait(t, block, __source__) |> esc
end

function make_code(tr::Type{<:PTrait}, block, sups, ts::AbstractArray, ws::AbstractArray, ln::LineNumberNode; gen::Bool)
    ms = @when Expr(:block, xs...) = block begin
        xs
        @otherwise
        [block]
    end
    fs = fieldnames(Trait.instance(tr)) |> collect
    ns = fs |> Set
    ps = Pair{Symbol,Any}[]
    for i in 1:length(ms)
        push!(ps, @when (n, x) = pull_code!(ms[i]) begin
            delete!(ns, n)
            n => x
            @otherwise
            :_ => ms[i]
        end)
    end
    for n in ns
        mk = default_make_method(tr, Val(n))
        push!(ps, n => :($mk($(ts...))))
    end
    ss = Dict{Symbol,Symbol}()
    b = gensym(string(tr))
    defs = map(ps) do (n, x)
        if n === :_; x
        else
            s = Symbol(b, "#", n)
            ss[n] = s
            :($s = let; $x end)
        end
    end
    xs = [:(::Type{$t}) for t in ts]
    if gen
        @q begin
            $ln
            Base.@generated $ln function (::Type{$tr})($(xs...)) where {$(ws...)}
                $ln
                $check_heritage($tr, $(ts...))
                $(sups...)
                $(defs...)
                $(Trait.instance(tr))($([ss[f] for f in fs]...))
            end
        end
    else
        @q begin
            $ln
            function (::Type{$tr})($(xs...)) where {$(ws...)}
                $ln
                $check_heritage($tr, $(ts...))
                $(sups...)
                $(defs...)
                $(Trait.instance(tr))($([ss[f] for f in fs]...))
            end
        end
    end
end

function make_code(x, block, ln::LineNumberNode, m::Module; gen::Bool=false)
    ws = Any[]
    sups, x = pull_trait(x)
    @when :($t where {$(xs...)}) = x begin
        x = t
        ws = xs
    end
    @when :($t{$(ts...)}) = x begin
        make_code(m.eval(t), block, sups, ts, ws, ln; gen)
        @otherwise 
        error("Instance should be 'Trait{A, B}' instead of '$x'")
    end
end

macro impl(x, block)
    make_code(x, block, __source__, __module__) |> esc
end

macro impl(x)
    make_code(x, Expr(:block), __source__, __module__) |> esc
end

macro impl!(x, block)
    make_code(x, block, __source__, __module__; gen=true) |> esc
end

macro impl!(x)
    make_code(x, Expr(:block), __source__, __module__; gen=true) |> esc
end

