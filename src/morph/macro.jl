macro theory(h, b)
    make_theory(h, b)
end

macro signature(h, b)
    make_theory(h, b, sig=true)
end

macro instance(h, b)
    h = parse_bind(h)
    fs, ss = parse_instance(b)
    e = :(make_instance($(esc(h.name)), $(esc(h.params)), $fs, $ss))
    Expr(:block, Expr(:call, esc(:eval), e), :(Core.@__doc__ abstract type $(esc(gensym(:instance_doc))) end))
end

macro syntax(h, mod, b=nothing)
    if isnothing(b); b = Expr(:block) end
    @assert b.head == :block
    n, ts = @match h begin
        Expr(:curly, n::Symbol, ts...) => (n, ts)
        n::Symbol => (n, [])
        _ => throw(ParseError("Invalid syntax sig $h"))
    end
    fs = map(parse_func, strip_lines(b).args)
    e = Expr(:call, :make_syntax, Expr(:quote, n), esc(Expr(:ref, :Type, ts...)), esc(mod), esc(nameof(__module__)), fs)
    Expr(:block, Expr(:call, esc(:eval), e), :(Core.@__doc__ $(esc(n))))
end

macro picture(h, b)
    n, p = @match h begin
        Expr(:call, n::Symbol, s::Symbol) => (n, :($(mod_ref(:Picture))($s)))
        Expr(:(<:), n::Symbol, p::Symbol) => (n, :(copy($p)))
        _ => throw(ParseError("Invalid picture header $h"))
    end
    e = Expr(:let, Expr(:block), cast_picture(p, b))
    esc(Expr(:(=), n, e))
end

macro program(ps, xs...)
    Expr(:call, GlobalRef(ParseJuliaPrograms, :parse_wirings), esc(ps), (QuoteNode(x) for x in xs)...)
end

macro relation(xs...)
    :(parse_relations($((QuoteNode(x) for x in xs)...)))
end

macro tensors(xs...)
    :(parse_tensors($((QuoteNode(x) for x in xs)...)))
end
