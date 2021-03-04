function make_match(t, p, ln::LineNumberNode, m::Module)
    Meta.isexpr(p, :block) || (p = Expr(:block, p))
    cs = Clause[]
    bs = Bodies()
    ln′ = ln
    i = 0
    for x in p.args
        @switch_raw x begin
            @case :($a => $b)
            i += 1
            f = try
                parse(m, a)
            catch e
                e isa ErrorException && throw(PackError(ln′, e.msg))
                rethrow()
            end
            push!(cs, (f => (ln′, i)))
            bs[i] = b
            @case ln′::LineNumberNode
            @case _
            error("Invalid match clause $x")
        end
    end
    build(t, cs, bs, ln; hygienic=true)
end

macro match(t, p)
  esc(make_match(t, p, __source__, __module__) |> make_flow)
end

function make_matchast(t, p, ln::LineNumberNode, m::Module)
    @switch p begin
        @case Expr(:quote, Expr(:block, xs...))
        ln′ = ln
        e = Expr(:block)
        for x in xs
            @switch_raw x begin
                @case :($a => $b)
                push!(e.args, ln′, :($(Expr(:quote, a)) => $b))
                @case ln′::LineNumberNode 
                @case _
                throw(SyntaxError("AST should be `a => b` $(string(ln′))"))
            end
        end
        return make_match(t, e, ln, m)
        @case _
        throw(SyntaxError("AST should be `a => b` $(string(ln))"))
    end
end

macro matchast(t, p)
  esc(make_matchast(t, p, __source__, __module__) |> make_flow)
end

function make_when(p, ln::LineNumberNode, m::Module)
    @switch p begin
        @case Expr(:let, Expr(:block, bs...) || b && let bs = [b] end, Expr(:block, ss...) || s && let ss = [s] end)
        return foldr(split_when(bs, ss, ln), init=:nothing) do (ln, xs, blk), last
            foldr(xs, init=blk) do x, prev
                @switch x begin
                    @case :($a = $b)
                    e = Expr(:block, ln, :($a => $prev), :(_ => $last))
                    return make_match(b, e, ln, m)
                    @case a::LineNumberNode
                    ln = a
                    return prev
                    @case :(if $a; $(_...) end) || :($a.?)
                    return Expr(:block, ln, :($a ? $prev : $last))
                    @case a
                    return Expr(:block, ln, Expr(:let, a, prev))
                end
            end
        end
        @case a 
        s = string(a)
        m = SubString(s, 1, min(length(s), 20))
        throw(SyntaxError("Expected let, got `$m` at $(string(ln))"))
    end
end

function split_when(bs, ss, ln)
    bss::Vector{Any} = [bs]
    blks::Vector{Any} = []
    ls = [ln]
    cur = []
    function add_block!()
        l = length(cur)
        s = l
        for i in l:-1:1
            s = i
            cur[i] isa LineNumberNode || break
        end
        push!(blks, Expr(:block, view(cur, 1:s)...))
        empty!(cur)
        nothing
    end
    for s in ss
        @switch s begin
            @case :(@when $ln begin $(bs...) end) || Q[@when $ln $e] && let bs = [e] end
            push!(bss, bs)
            push!(ls, ln)
            add_block!()
            continue
            @case Q[@otherwise $ln]
            push!(bss, [])
            push!(ls, ln)
            add_block!()
            continue
            @case a
            push!(cur, a)
            nothing
            continue
        end
    end
    add_block!()
    collect(zip(ls, bss, blks))
end

macro when(p)
  esc(make_when(p, __source__, __module__) |> make_flow)
end
macro when(x, p)
  @match x begin
      :($_ = $_) => let p′ = Expr(:let, Expr(:block, x), p)
          esc(make_when(p′, __source__, __module__) |> make_flow)
      end
      _ => throw(SyntaxError("No matching `@when a = b expr`"))
  end
end

macro otherwise()
  throw(SyntaxError("Use @otherwise in a @when block"))
end

function make_lambda(p, ln::LineNumberNode, m::Module)
    λ = gensym("λ")
    f(c, ss) = let b = Expr(:block, ss...); :($c => $b) end
    @switch p begin
        @case :($a -> $(bs...)) || :($a => $b) && let bs = [b] end
        ss = [f(a, bs)]
        @case let ss = [] end && Expr(:block, 
            Many[
              a::LineNumberNode && Do[push!(ss, a)] || 
              Or[:($a -> $(bs...)), :($a => $b) && let bs = [b] end] && Do[push!(ss, f(a, bs))]
              ]...)    
    end
    b = Expr(:block, ln, ss...)  
    e = make_match(λ, b, ln, m)
    Expr(:function, Expr(:call, λ, λ), Expr(:block, ln, make_flow(e)))
end

macro λ(p)
  esc(make_lambda(p, __source__, __module__))
end

function make_cond(p, ln::LineNumberNode, ::Module)
    @switch p begin
        @case Expr(:block, xs...)
        init = Expr(:call, throw, "No satisfied conditions $(string(ln))")
        ln′ = ln
        e = foldr(xs; init) do x, prev
            @switch_raw x begin
                @case ln′::LineNumberNode
                return prev
                @case  :(_ => $b)
                return b
                @case :($a => $b)
                return Expr(:if, a, b, Expr(:block, ln′, prev))
                @case _
                throw("Invalid conditional branches $ln′")
            end
        end
        return Expr(:block, ln, e)
        @case _
        throw(SyntaxError("AST should be `a => b` $(string(ln))"))
    end
end

macro cond(p)
  esc(make_cond(p, __source__, __module__))
end

function make_data(x, p, ln::LineNumberNode, m::Module)
    t, ts = @match x begin
        :($t{$(a...)}) => (t, get_tparams_ordered(a))
        :($t{$(a...)} <: $b) => (t, get_tparams_ordered(a))
        :($t <: $b) => (t, Symbol[])
        :($(t::Symbol)) => (t, Symbol[])
    end
    e = Expr(:block, :(abstract type $x end))
    make_data!(e.args, t, ts, p, ln, m)
    e
end

function make_data!(es::Vector, aty, ats::Vector{Symbol}, blk, ln, m)
    ft() = isempty(ats) ? aty : :($aty{$(ats...)})
    for c in blk.args
        @switch c begin
            @case Do[is_enum=false] &&
            (:($a{$(ts...)}::($(ps...),) => $(ret) where {$(bs...)})
            || :($a{$(ts...)}::($(ps...),) => $ret) && let bs = [] end
            || :($a{$(ts...)}::$ty => $ret where {$(bs...)}) && let ps = [ty] end
            || :($a{$(ts...)}::$ty => $ret) && let ps = [ty], bs = [] end
            || :($a::($(ps...),) => $(ret) where {$(bs...)}) && let ts = [] end
            || :($a::($(ps...),) => $ret) && let ts = [], bs = [] end
            || :($a::$ty => $ret where {$(bs...)}) && let ts = [], ps = [ty] end
            || :($a::$ty => $ret) && let ts = [], ps = [ty], bs = [] end
            || :($a($(ps...))) && let ret = ft(), bs = [], ts = ats end
            || :($a{$ts...}::$ret where {$(bs...)}) && if error("Gen enum $c is invalid") end && let ps = [] end
            || :($a{$ts...}::$ret) && if error("Gen enum $c is invalid") end && let ps = [], bs = [] end
            || :($(a::Symbol)::$ret) && Do[is_enum=true] && let ps = [], bs = [], ts = [] end
            || (a::Symbol) && Do[is_enum=true] && if isempty(ats) || error("Gen enum $a <: $(ft())") end && Do[is_enum=true] && let ret = ft(), ps = [], bs = [], ts = [] end
            )         
            n = is_enum ? Symbol(a, "'s constructor") : a
            ef = Expr(:block, ln)
            efs = ef.args
            fs = Symbol[]
            for i in eachindex(ps)
                p = ps[i]
                @match p begin
                    a::Symbol && (if Base.isuppercase(string(p)[1]) end && let f = Symbol("_$i"), ty = a end || let f = a, ty = Any end) || :($f::$ty) || (:(::$ty) || ty) && let f = Symbol("_$i") end => begin
                        push!(efs, :($f::$ty))
                        push!(fs, f)
                        nothing
                    end
                    _ => error("invalid field $p")
                end
            end              
            s = Expr(:struct, false, Expr(:(<:), Expr(:curly, n, ts...), ret), ef)              
            cons = if isempty(bs); nothing
            else
                e = Expr(:call, n, efs[2:end]...)
                xs = get_tparams_ordered(ts)
                Expr(:function,
                    Expr(:where, e, ts...),
                    Expr(:block, Expr(:let,
                        Expr(:block, bs...),
                        Expr(:call, :($n{$(xs...)}), fs...))))
            end
            rec = if is_enum
                Expr(:block, ln,
                    :($Match.post_parse(::$n, _, ps, ts, xs) = isempty(ts) && isempty(ps) && isempty(xs) && (return $Match.literal($a)) || error("Invalid enum $a")),
                    :($Match.is_enum(::$n) = true),
                    :(const $a = $n.instance),
                    :($Base.show(io::$IO, ::$n) = $Base.print(io, $(string(a))))
                )
            else make_record(n, ln, m)
            end
            push!(es, s, cons, rec)
            continue
            @case ln::LineNumberNode
            continue
            @case :($a{$(_...)}) && if error("invalid enum constructor $c, use $a") end
            @case _
            error("unrecognised data constructor $c")
        end
    end
end

macro data(t, p)
  esc(make_data(t, p, __source__, __module__))
end

function make_record(s, ::LineNumberNode, ::Module)
    f(x) = :($Match.post_parse(t::Type{$x}, p::Function, ps, ts, xs) = $Match.parse_fields(t, p, ps, ts, xs))
    @switch s begin
        @case ::Symbol
        return f(s)
        @case :(struct $a{$(_...)} 
            $(_...) 
        end) || 
        :(struct $a{$(_...)} <: $_
            $(_...) 
        end) || :(struct $a <: $_
            $(_...) 
        end) || :(struct $a 
            $(_...) 
        end)
        return Expr(:block, s, f(a))
        @case _
        error("Invalid structure $s")
    end
end

macro as_record(p)
  esc(make_record(p, __source__, __module__))
end

function make_active(x, tgt, ln::LineNumberNode, mod::Module)
    @switch x begin
        @case Expr(:call, Expr(:curly, t, type_args...) || t && let type_args = [] end, arg) && if t isa Symbol end
        @case _
        error("malformed pattern: $x")
    end
    definition = isdefined(mod, t) ? ln : :(struct $t end)
    parametric = isempty(type_args) ? [] : type_args
    prepr = "$x"
    token = gensym(prepr)
    v_ty = Val{(view, token)}
    v_val = Val((view, token))
    quote
        $definition
        (::$v_ty)($(parametric...), ) = $arg -> $tgt
        $ln
        function $Match.post_parse(t::($t isa Function ? typeof($t) : Type{$t}), self::Function, type_params, type_args, args)
            $ln
            isempty(type_params) || error("A ($t) pattern requires no type params.")
            parametric = isempty(type_args) ? [] : type_args
            n_args = length(args)
            trans(x) = Expr(:call, Expr(:call, $v_val, parametric...), x)
            function guard2(x)
                if n_args === 0; :($x isa Bool && $x)
                elseif n_args === 1
                    expr_s = "$t(x)"
                    msg = "Invalid use of active patterns"                      
                    :($x !== nothing && ($x isa $Some || $error($msg)))
                else :($x isa $Tuple && length($x) === $n_args)
                end
            end       
            fn = n_args <= 1 ? (x, _...) -> x : (x, i::Int, _...) -> :($x[$i])
            co = $Combo($prepr, (_...) -> Any; view=$Cached(trans), guard2=$Uncached(guard2))
            ps = if n_args === 0; []
            elseif n_args === 1; [self(Expr(:call, Some, args[1]))]
            else [self(e) for e in args]
            end    
            $decons(co, fn, ps)
        end
    end
end

macro active(t, p)
  esc(make_active(t, p, __source__, __module__))
end

"""
f(x::Foo, args...) = f(x.bar, args...)
g(x::Foo, args...) = g(x.bar, args...)
h(x::Foo, args...) = h(x.bar, args...)
"""
macro forward(x, fs)
    @capture(x, T_.field_) || error("Syntax: @forward T.x f, g, h")
    T = esc(T)
    fs = is_expr(fs, :tuple) ? map(esc, fs.args) : [esc(fs)]
    :($([:($f(x::$T, xs...; kw...) = (Base.@_inline_meta; $f(x.$field, xs...; kw...))) for f in fs]...); nothing)
end
