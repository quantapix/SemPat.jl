function split_def(x)
    msg = "Not a function: $(repr(x))"
    @assert(@mate(long_fun(x), function (fcall_ | fcall_) body_ end), msg)
    w, wps = get_wheres(fcall)
    f = xs = kw = ret = nothing
    if @mate(w, ((f_(xs__; kw__)) | (f_(xs__; kw__)::ret_) | (f_(xs__)) | (f_(xs__)::ret_)))
    elseif is_expr(w, :tuple)
        if length(w.args) > 1 && is_expr(w.args[1], :parameters)
            xs = w.args[2:end]
            kw = w.args[1].args
        else xs = w.args
        end
    elseif is_expr(w, :(::)); xs = Any[w]
    else throw(ArgumentError(msg))
    end
    if f !== nothing
        @assert(@mate(f, (n_{ps__} | n_)), msg)
        d = Dict(:name => n, :args => xs, :kwargs => (kw === nothing ? [] : kw), :body => body)
    else
        ps = nothing
        d = Dict(:args => xs, :kwargs => (kw === nothing ? [] : kw), :body => body)
    end
    if ret !== nothing; d[:rtype] = ret end
    if wps !== nothing; d[:whereparams] = wps end
    if ps !== nothing; d[:params] = ps end
    d
end

function join_def(d::Dict)
    ret = get(d, :rtype, nothing)
    ps = get(d, :params, [])
    wps = get(d, :whereparams, [])
    body = block(d[:body])
    if haskey(d, :name)
        n = d[:name]
        np = isempty(ps) ? n : :($n{$(ps...)})
        if isempty(wps)
            if ret === nothing
                @q(function $np($(d[:args]...); $(d[:kwargs]...))
                    $(body.args...)
                end)
            else
                @q(function $np($(d[:args]...); $(d[:kwargs]...))::$ret
                    $(body.args...)
                end)
            end
        else
            if ret === nothing
                @q(function $np($(d[:args]...); $(d[:kwargs]...)) where {$(wps...)}
                    $(body.args...)
                end)
            else
                @q(function $np($(d[:args]...); $(d[:kwargs]...))::$ret where {$(wps...)}
                    $(body.args...)
                end)
            end
        end
    else
        if isempty(d[:kwargs]); arg = :($(d[:args]...),)
        else arg = Expr(:tuple, Expr(:parameters, d[:kwargs]...), d[:args]...)
        end
        if isempty(wps)
            if ret === nothing; @q($arg -> $body)
            else @q(($arg::$ret) -> $body)
            end
        else
            if ret === nothing; @q(($arg where {$(wps...)}) -> $body)
            else @q(($arg::$ret where {$(wps...)}) -> $body)
            end
        end
    end
end

function join_arg(n, ty, is_splat, default)
    x = n === nothing ? :(::$ty) : :($n::$ty)
    x2 = is_splat ? Expr(:..., x) : x
    return default === nothing ? x2 : Expr(:kw, x2, default)
end

macro splitjoin(x)
    dict = split_def(x)
    esc(rebuilddef(strip_lines(dict)))
end

function splitarg(x)
    splitvar(x) =
      @like x begin
        ::T_ => (nothing, T)
        n_::T_ => (n, T)
        y_ => (y, :Any)
    end
    (splat = @mate(x, x′_...)) || (x′ = x)
    if @mate(x′, y_ = default_)
        @assert default !== nothing "Use quoted `nothing` in splitarg"
        (splitvar(y)..., splat, default)
    else (splitvar(x′)..., splat, nothing)
    end
end

function _flatten(e)
    is_expr(e, :block) || return e
    b = Expr(:block)
    for x in e.args
        is_expr(x, :block) ? append!(b.args, x.args) : push!(b.args, x)
    end
    return length(b.args) == 1 ? b.args[1] : b
end

flatten(x) = postwalk(_flatten, x)

function split_struct(x)
    x = strip_lines(x)
    x = flatten(x)
    d = Dict{Symbol,Any}()
    if @mate(x, struct h_ es__ end); d[:mutable] = false
    elseif @mate(x, mutable struct h_ es__ end); d[:mutable] = true
    else parse_error(x)
    end
    if @mate h np_ <: super_; nothing
    elseif @mate h np_; super = :Any
    else parse_error(x)
    end
    d[:supertype] = super
    if @mate np n_{ps__}; nothing
    elseif @mate np n_; ps = []
    else parse_error(x)
    end
    d[:name] = n
    d[:params] = ps
    d[:fields] = []
    d[:constructors] = []
    for e in es
        if @mate e f_::T_; push!(d[:fields], (f, T))
        elseif e isa Symbol; push!(d[:fields], (e, Any))
        else push!(d[:constructors], e)
        end
    end
    d
end

function join_struct(x)::Expr
    n = x[:name]
    ps = x[:params]
    np = isempty(ps) ? n : :($n{$(ps...)})
    h = :($np <: $(x[:supertype]))
    fs = map(join_field, x[:fields])
    b = quote; $(fs...); $(x[:constructors]...) end
    Expr(:struct, x[:mutable], h, b)
end

function join_field(x)
    f, T = x
    :($f::$T)
end

symlit(x) = @mate(x, :(f_)) && isa(f, Symbol)
isatom(x) = symlit(x) || typeof(x) ∉ (Symbol, Expr)
atoms(f, x) = postwalk(x -> isatom(x) ? f(x) : x, x)

get_val(d::AbstractDict, k::Symbol) =
  haskey(d, k) ? d[k] :
    haskey(d, string(k)) ? d[string(k)] :
      error("Invalid destructure `$k` from $d")
get_val(d::AbstractDict, k::Symbol, default) =
  haskey(d, k) ? d[k] :
    haskey(d, string(k)) ? d[string(k)] :
      default
get_val(xs, k, v) = get(xs, k, v)
get_val(xs, k) = getindex(xs, k)

get_key(xs...) = :($get_val($(xs...)))
get_field(x, i) = :(getfield($x, $i))
get_field(x, i, default) = error("Invalid destructure with defaults")

function destruct_key(pat, v, f)
    @like pat begin
        _Symbol => destruct_key(:($pat = $(Expr(:quote, pat))), v, f)
        x_Symbol || y_ => destruct_key(:($x = $(Expr(:quote, x)) || $y), v, f)
        (x_ = y_) => destruct(x, destruct_key(y, v, f))
        x_ || y_ => f(v, x, y)
        _ => atoms(i -> f(v, i), pat)
    end
end

destruct_keys(ps, v, f, n=gensym()) = :($n = $v; $(map(x -> destruct_key(x, n, f), ps)...); $n)

function destruct(pat, v)
    @like pat begin
        x_Symbol => :($pat = $v)
        (x_ = y_) => destruct(x, destruct(y, v))
        [ps__] => destruct_keys(ps, v, get_key)
        x_[ps__] => destruct(x, destruct(:([$(ps...)]), v))
        x_.(ps__,) => destruct(x, destruct_keys(ps, v, get_field))
        x_.pat_ | x_.(pat_) => destruct(:($x.($pat,)), v)
        _ => error("Invalid destructure $pat")
    end
end

macro destructure(x)
    @mate(x, p_ = v_) || error("@destructure pat = val")
    esc(destruct(p, v))
end
