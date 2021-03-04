pull_var(u::Union{Symbol,Expr})::Symbol = @match u begin
    :($v <: $_) => v
    :($v >: $_) => v
    :($_ >: $v >: $_) => v
    :($_ <: $v <: $_) => v
    v::Symbol => v
end

pull_name(::LineNumberNode) = nothing
function pull_name(x)
    name(y) = @when (:($n($(_...))) || n) && if n isa Symbol end = y begin
        n
        @when :($n::$_) = y
        name(n)
        @when :($n where {$(_...)}) = y
        name(n)
        @otherwise
        nothing
    end
    n = @match x begin
        Expr(:(=), y, _) => name(y)
        Expr(:function, y, _) => name(y)
        Expr(:macrocall, _..., y) => name(y)
        _ => nothing
    end
    n === nothing ? nothing : (n, x)
end

add_name!(::LineNumberNode, ::Set{Symbol}) = nothing
function add_name!(x, ns::Set{Symbol})
    y = pull_name(x)
    y === nothing && error("Not a named def: $x")
    push!(ns, y[1])
    nothing
end

pull_code!(::LineNumberNode) = nothing
function pull_code!(x)
    code!(y) = @when (:($n($(_...)))) && if n isa Symbol end = y begin
        y.args[1] = gensym(n)
        n
        @when n::Symbol = y
        n
        @when :($n::$_) = y
        code!(n)
        @when :($n where {$(_...)}) = y
        code!(n)
        @otherwise
        nothing
    end
    n = @match x begin
        Expr(:(=), y, _) => code!(y)
        Expr(:function, y, _) => code!(y)
        Expr(:macrocall, _..., y) => code!(y)
        _ => nothing
    end
    n === nothing ? nothing : (n, x)
end

infer(x)::Set{Symbol} = @match x begin
    :[$(ts...)] => union!(map(infer, ts)...)
    :($t where {$(ws...)}) => setdiff!(infer(t), map(pull_var, ws))
    Expr(_, ts...) => union!(map(infer, ts)...)
    Expr(_) => Set(Symbol[])
    t::Symbol => Set([t])
    _ => Set(Symbol[])
end

function pull_sig(n::Symbol, xs::AbstractArray, ret, ws::AbstractArray)
    ts = :($Tuple{$(xs...)})
    Sig(n, ts, ret, ws, infer(:($ts where {$(ws...)})))
end

function pull_method(u::Union{Expr,LineNumberNode})::Method
    @match u begin
        :($n::[$(ts...)] where {$(ws...)} => $ret) => pull_sig(n, ts, ret, ws)
        :($n::[$(ts...)] => $ret) => pull_sig(n, ts, ret, Any[])
        :($n::$t where {$(ws...)} => $ret) => pull_sig(n, [t], ret, ws)
        :($n::$t => $ret) => pull_sig(n, [t], ret, Any[])
        ::LineNumberNode => u
        _ => begin
            d = pull_name(u)
            d === nothing && error("Invalid method $u")
            Code(d[1], d[2])
        end
    end
end

function pull_trait(x)
    es = Expr[]
    @when :($s >: $t) = x begin
        x = t
        for y in @match s begin
          :[$(ys...)] => ys
          ::Expr => Expr[s]
          _ => error("Invalid trait: expected a{b, c}, got $s")
          end
            @match y begin
                :($a{$(bs...)}) => push!(es, Expr(:call, a, bs...))
                _ => error("Invalid trait: expected a{b, c}, got $y")
            end
        end
    end
    es, x
end

function get_dependency(x)
    error("Invalid dependency $x, expected '{T2 = f(T1), T3 = g(T1)}'")
end

strip_type(s::Symbol) = s
strip_type(xs::AbstractArray) = Any[strip_type(x) for x in xs]
strip_type(e::Expr) = @match e begin
    Expr(:(::), xs...) => xs[1]
    Expr(:..., xs...) => Expr(:..., strip_type(xs[1]))
    Expr(:kw, k, v) => Expr(:kw, strip_type(k), v)
    _ => error("Cannot parse $e")
end

strip_kw(x) = x
strip_kw(xs::AbstractArray) = Any[strip_kw(x) for x in xs]
strip_kw(e::Expr) = @match e begin
    Expr(:(::), _...) || Expr(:..., _...) => e
    Expr(:kw, k, _) => k
    _ => error("Cannot parse $e")
end
