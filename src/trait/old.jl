function strip_type(e::Expr)
    if e.head == :(::); e.args[1]
    elseif e.head == :...; Expr(:..., strip_type(e.args[1]))
    elseif e.head == :kw
        @assert length(e.args) == 2
        Expr(:kw, strip_type(e.args[1]), e.args[2])
    else error("Cannot parse $e")
    end
end

function strip_kw(e::Expr)
    if e.head == :(::) || e.head == :...; e
    elseif e.head == :kw
        @assert length(e.args) == 2
        e.args[1]
    else error("Cannot parse $e")
    end
end

macro traitimpl(tr)
    if tr.head == :curly || (tr.head == :call && tr.args[1] == :!)
        negated = tr.args[1] == :Not || is_not(tr) ? (tr = tr.args[2]; true) : false
        ts = tr.args[2:end]
        n = esc(tr.args[1])
        curly = Any[]
        ps = Any[]
        for (t, v) in zip(ts, GenerateTypeVars{:upcase}())
            push!(curly, Expr(:(<:), esc(v), esc(t)))
            push!(ps, esc(v))
        end
        x = :(::Type{$n{$(ps...)}})
        f = :($curmod.trait($x) where {$(curly...)})
      # isfnhead = :($curmod.is_trait($arg) where {$(curly...)})
        if !negated
            quote
                $f = $n{$(ps...)}
                nothing
            end
        else
            quote
                $f = Not{$n{$(ps...)}}
                nothing
            end
        end
    elseif tr.head == :call
        @assert tr.args[1] == :<
        negated, Tr, P1, f, P2 = @like tr begin
            Not{Tr_{P1__}} < - f_(P2__) => (true, Tr, P1, f, P2)
            Tr_{P1__} < - f_(P2__) => (false, Tr, P1, f, P2)
        end
        if negated; f = Expr(:call, GlobalRef(Trait, :!), f)
        end
        esc(quote
            function Trait.trait(::Type{$Tr{$(P1...)}}) where {$(P1...)}
                return $f($(P2...)) ? $Tr{$(P1...)} : Not{$Tr{$(P1...)}}
            end
            nothing
        end)
    else error("Cannot parse $tr")
    end
end
