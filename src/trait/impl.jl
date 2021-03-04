import InteractiveUtils

is_not(e::Expr) = e.head == :call
is_not(::Symbol) = false

struct TypeVars{C} end
Base.iterate(::TypeVars{:upper}, state=1) = (Symbol("X$state"), state + 1)
Base.iterate(::TypeVars{:lower}, state=1) = (Symbol("x$state"), state + 1)

macro traitimpl(tr)
    if tr.head == :curly || (tr.head == :call && tr.args[1] == :!)
        not = tr.args[1] == :Not || is_not(tr) ? (tr = tr.args[2]; true) : false
        n = esc(tr.args[1])
        ts = Any[]
        ws = Any[]
        for (t, v) in zip(tr.args[2:end], TypeVars{:upper}())
            push!(ts, esc(v))
            push!(ws, Expr(:(<:), esc(v), esc(t)))
        end
        h = :(::Type{$n{$(ts...)}})
        h = :($Trait.trait($h) where {$(ws...)})
        if not; :($h = Not{$n{$(ts...)}}; nothing)
        else :($h = $n{$(ts...)}; nothing)
        end
    elseif tr.head == :call
        @assert tr.args[1] == :<
        n, ts, f, xs = @match tr begin
            :(Not{$n{$(ts...)}} < - $f($(xs...))) => (n, ts, Expr(:call, GlobalRef(Trait, :!), f), xs)
            :($n{$(ts...)} < - $f($(xs...))) => (n, ts, f, xs)
            _ => error("Cannot parse $tr")
        end
        h = :(::Type{$n{$(ts...)}})
        h = :($Trait.trait($h) where {$(ts...)})
        esc(:($h = $f($(xs...)) ? $n{$(ts...)} : Not{$n{$(ts...)}}; nothing))
    else error("Cannot parse $tr")
    end
end

cache = Dict()
let
    global traitfn
    function traitfn(tfn, __module__, __source__)
        # Need
        # f(x::X,Y::Y) where {X,Y} = f(trait(Tr1{X,Y}), x, y)
        # f(::False, x, y)= ...
        if tfn.head == :macrocall
            hasmac = true
            mac = tfn.args[1]
            tfn = tfn.args[3]
        else hasmac = false
        end
        fhead = tfn.args[1]
        fbody = tfn.args[2]
        out = @match fhead begin
            :($f($(xs...); $(kw...)) where $(ws...)) => (f, ws, xs, kw)
            :($f($(xs...)) where $(ws...)) => (f, ws, xs, [])
            :($f($(xs...); $(kw...))) => (f, [], xs, kw)
            :($f($(xs...))) => (f, [], xs, [])
            _ => nothing
        end
        out === nothing && error("Cannot parse $fhead")
        f, ws, xs, kw = out
        if length(ws) == 0; maybe_traitor = true
        else
            if ws[1] isa Expr && ws[1].head == :parameters
                maybe_traitor = false
                length(ws) < 2 && error("Cannot parse $ws")
                ts = ws[2:end]
                trait = ws[1].args[1]
            elseif ws[1] isa Expr && ws[1].head == :bracescat
                maybe_traitor = false
                length(ws) != 1 && error("Cannot parse $ws")
                ts = ws[1].args[1:1]
                trait = ws[1].args[2]
            else maybe_traitor = true
            end
        end
        if !maybe_traitor
            trait0 = trait
            ts0 = ts
            ys = insertdummy(xs)
        else
            ts0 = deepcopy(ws)
            ts = ws
            out = nothing
            i = 0
            vararg = false
            for outer i in eachindex(xs)
                a = xs[i]
                vararg = a.head == :...
                if vararg; a = a.args[1]
                end
                out = @match a begin
                    :($x:::: $ Tr) => (x, nothing, Tr)
                    :(:::: $ Tr) => (nothing, nothing, Tr)
                    :($x::$T::$Tr) => (x, T, Tr)
                    :(::$T::$Tr) => (nothing, T, Tr)
                    _ => nothing
                end
                out !== nothing && break
            end
            out === nothing && error("No trait found in function signature")
            x, t, trait0 = out
            if t === nothing
                t = gensym()
                push!(ts, t)
            elseif length(ts) == 0 
                t2 = t
                t = gensym()
                push!(ts, :($t <: $t2))
            end
            if is_not(trait0); trait = :(!($(trait0.args[2]){$t}))
            else trait = :($trait0{$t})
            end
            ys = deepcopy(xs)
            if vararg
                xs[i] = x === nothing ? nothing : :($x...,).args[1]
                ys[i] = x === nothing ? :(::$t...,).args[1] : :($x::$t...,).args[1]
            else
                xs[i] = x === nothing ? nothing : :($x)
                ys[i] = x === nothing ? :(::$t) : :($x::$t)
            end
            ys = insertdummy(ys)
        end
        if is_not(trait)
            trait0_opposite = trait0
            trait = trait.args[2]
            val = :(::Type{$Trait.Not{$trait}})
        else
            trait0_opposite = Expr(:call, :!, trait0)  # generate the opposite
            val = :(::Type{$trait})
        end
        head = Match.prewalk(rm_lines, :($f($val, $(strip_kw(ys)...); $(kw...)) where {$(ts...)}))
        ex = hasmac ? Expr(:macrocall, mac, __source__, :($head = $fbody)) : :($head = $fbody)
        k = (__module__, f, ts0, strip_kw(xs), trait0_opposite)
        haskw = length(kw) > 0
        dispatchfn = if !(k in keys(cache))
            cache[k] = (haskw, xs)
            if !haskw
                :($f($(ys...)) where {$(ts...)} = (Base.@_inline_meta(); $f($Trait.trait($trait), $(strip_type(strip_kw(ys))...))))
            else
                :($f($(ys...);kw...) where {$(ts...)} = (Base.@_inline_meta(); $f($Trait.trait($trait), $(strip_type(strip_kw(ys))...); kw...)))
            end
        else
            if cache[k][1] != haskw
                return :(error("Both `Tr` and `!Tr` need same kwargs"))
            end
            if cache[k][2] != xs
                return :(error("Both `Tr` and `!Tr` need identical default values"))
            end
            delete!(cache, k)
            nothing
        end
        return rm_lines(quote
            $dispatchfn
            Base.@__doc__ $ex
        end)
    end
end

macro traitfn(tfn)
    esc(traitfn(tfn, __module__, __source__))
end

insertdummy(s::Symbol) = s
insertdummy(xs::AbstractArray) = Any[insertdummy(x) for x in xs]
function insertdummy(e::Expr)
    if e.head == :(::) && length(e.args) == 1; Expr(:(::), gensym(), e.args[1])
    elseif e.head == :...; Expr(:..., insertdummy(e.args[1]))
    else e
    end
end

function findline(e::Expr)
    e.head == :line && return e
    for x in e.args
        y = findline(x)
        isa(y, Expr) && return y
    end
    nothing
end
findline(_) = nothing

macro check_fast_traitdispatch(Tr, Arg=:Int, verbose=false)
    if Base.JLOptions().code_coverage == 1
        @warn "The Trait.@check_fast_traitdispatch macro only works when running Julia without --code-coverage"
        return nothing
    end
    test_fn = gensym()
    test_fn_null = gensym()
    nl = gensym()
    nl_null = gensym()
    out = gensym()
    esc(quote
        $test_fn_null(x) = 1
        $nl_null = Trait.llvm_lines($test_fn_null, ($Arg,))
        @traitfn $test_fn(x:::: $ Tr) = 1
        @traitfn $test_fn(x::::(!$Tr)) = 2
        $nl = Trait.llvm_lines($test_fn, ($Arg,))
        $out = $nl == $nl_null
        if $verbose && !$out; println("Number of llvm code lines $($nl) but should be $($nl_null).")
        end
        $out
    end)
end

function llvm_lines(f, xs)
    io = IOBuffer()
    # Base.code_native(io, f, xs)
    InteractiveUtils.code_llvm(io, f, xs)
    count(x -> x == '\n', String(take!(copy(io))))
end

