block(x) = is_expr(x, :block) ? x : :($x;)

function unblock(x)
    is_expr(x, :block) || return x
    xs = rm_lines(x).args
    length(xs) == 1 || return x
    return unblock(xs[1])
end

merge_blocks(a, b) =
  is_expr(a, :block) && !is_expr(b, :block) ? (a, Expr(:block, b)) :
  !is_expr(a, :block) && is_expr(b, :block) ? (Expr(:block, a), b) :
  (a, b)

function normalise(x)
    x = unblock(x)
    is_expr(x, :inert) && (x = Expr(:quote, x.args[1]))
    isa(x, QuoteNode) && (x = Expr(:quote, x.value))
    is_expr(x, :kw) && (x = Expr(:(=), x.args...))
    return x
end

assoc!(d, k, v) = (d[k] = v; d)

macro no_like(p, t)
    :(return LikeError($(esc(p)), $(esc(t))))
end

function store!(d, k, v)
    haskey(d, k) && !(d[k] == v) && @no_like(k, v)
    assoc!(d, k, v)
end

function get_slurp_range(x)
    c = length(filter(is_slurp, x))
    c == 0 && return 0, 0
    c > 1 && error("Pack may only contain one slurp")
    l, r = 1, 1
    while !is_slurp(x[l]) l += 1 end
    while !is_slurp(x[end + 1 - r]) r += 1 end
    return l, r
end

like_inner(p::QuoteNode, t::QuoteNode, d) = like(p.value, t.value, d)
function like_inner(p::Expr, t::Expr, d)
    @try_like like(p.head, t.head, d)
    p, t = rm_lines(p), rm_lines(t)
    r = get_slurp_range(p.args)
    ss = Any[]
    i = 1
    for x in p.args
        i > length(t.args) && (is_slurp(x) ? @try_like(store!(d, bname(x), ss)) : @no_like(p, t))
        while is_inrange(i, r, length(t.args))
            push!(ss, t.args[i])
            i += 1
        end
        if is_slurp(x); x ≠ :__ && @try_like store!(d, bname(x), ss)
        else
            @try_like like(x, t.args[i], d)
            i += 1
        end
    end
    i == length(t.args) + 1 || @no_like(p, t)
    return d
end
like_inner(p::TyBind, t, d) = is_expr(t, p.ts...) ? (d[bsym(p)] = t; d) : @no_like(p, t)
function like_inner(p::OrBind, t, d)
    r = try_like(p.left, t)
    r === nothing ? like(p.right, t, d) : merge!(d, r)
end
function like_inner(p, t, d)
    p == t || @no_like(p, t)
    return d
end

like(::LineNumberNode, ::LineNumberNode, _) = nothing
like(p, t) = like(p, t, Dict())
function like(p, t, d)
    p = normalise(p)
    p == :_ && return d
    is_bind(p) && return store!(d, bname(p), t)
    t = normalise(t)
    p, t = merge_blocks(p, t)
    is_slurp(p) && return store!(d, bname(p), Any[t])
    return like_inner(p, t, d)
end

function try_like(p, t)
    r = like(p, t)
    r isa LikeError ? nothing : r
end

function resyntax(e)
    prewalk(e) do x
        @like x begin
            setfield!(x_, :f_, x_.f_ + v_) => :($x.$f += $v)
            setfield!(x_, :f_, v_) => :($x.$f = $v)
            getindex(x_, i__) => :($x[$(i...)])
            tuple(xs__) => :($(xs...),)
            adjoint(x_) => :($x)
            _ => x
        end
    end
end

function long_fun(x)
    if @mate(x, (arg_ -> body_)); Expr(:function, arg isa Symbol ? :($arg,) : arg, body)
    elseif is_shortdef(x)
        @assert @mate(x, (fcall_ = body_))
        Expr(:function, fcall, body)
    else x
    end
end
longdef(x) = prewalk(long_fun, x)

function short_fun(x)
    @like x begin
        function f_(args__) body_ end => @q $f($(args...)) = $(body.args...)
        function f_(args__) where T__ body_ end => @q $f($(args...)) where $(T...) = $(body.args...)
        function f_(args__)::rtype_ body_ end => @q $f($(args...))::$rtype = $(body.args...)
        function f_(args__)::rtype_ where T__ body_ end => @q ($f($(args...))::$rtype) where $(T...) = $(body.args...)
        function (args__,) body_ end => @q ($(args...),) -> $(body.args...)
        ((args__,) -> body_) => x
        (arg_ -> body_) => @q ($arg,) -> $(body.args...)
        _ => x
    end
end
shortdef(x) = prewalk(short_fun, x)

function get_wheres(x)
    if @mate(x, (f_ where {ps__}))
        f2, ps2 = get_wheres(f)
        (f2, (ps..., ps2...))
    else (x, ())
    end
end

is_shortdef(x) = (@mate(x, (f_ = c_)) && (@mate(get_wheres(f)[1], (g_(xs__) | g_(xs__)::t_))))

is_def(x) = is_shortdef(x) || long_fun(x) !== nothing

# is_like(pat::Expr, x) = !(@like(pat, x) isa LikeError)
