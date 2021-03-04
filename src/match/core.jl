const _one = LineNumberNode(1, :unused)

make_flow(e::Expr) = make_flow(Root(e))
make_flow(r::Root) = make_flow!(copy(r.ex), Dict{Symbol,Symbol}())
function make_flow!(e::Expr, d::Dict{Symbol,Symbol})
    xs = e.args
    for i in eachindex(xs)
        x = xs[i]
        if x isa Flow
            n = get!(d, x.val) do; gensym(x.val) end
            xs[i] = Expr(:macrocall, x.op, _one, n)
        elseif x isa Root; xs[i] = make_flow(x)
        elseif x isa Expr; make_flow!(x, d)
        end
    end
    e
end

const _case = Symbol("@case")

function make_switch(t, p, ln::LineNumberNode, mod_or_eval)
    @assert Meta.isexpr(p, :block)
    cs = Clause[]
    bs = Bodies()
    b = nothing
    ln′ = ln
    i = 0
    for x in p.args
        if Meta.isexpr(x, :macrocall) && x.args[1] === _case && length(x.args) == 3
            i += 1
            f = try
                parse(mod_or_eval, x.args[3])
            catch e
                e isa ErrorException && throw(PackError(ln′, e.msg))
                rethrow()
            end
            push!(cs, (f => (ln′, i)))
            b = bs[i] = Expr(:block)
        else
            flag = x isa LineNumberNode
            if i !== 0 && !flag
                push!(b.args, ln′)
                push!(b.args, x)
            end
            flag && (ln′ = x)
        end
    end
    build(t, cs, bs, ln; hygienic=false)
end

macro switch_raw(t, p)
    esc(make_switch(t, p, __source__, __module__.eval) |> make_flow)
end

macro switch(t, p)
  esc(make_switch(t, p, __source__, __module__) |> make_flow)
end

function make_capture(pat, x, ln::LineNumberNode, m)
    pat = Expr(:quote, pat)
    s = :__SCOPE_CAPTURE__
    scope = Expr(:call, Capture, s)
    e = Expr(:&&, pat, scope)
    tgt = Expr(:block, :($e => $s))
    make_match(x, tgt, ln, m)
end

macro capture(p)
  t = gensym("expr")
  h = Expr(:call, t, t)
  e = make_capture(p, t, __source__, __module__) |> make_flow
  esc(Expr(:function, h, e))
end

macro capture(p, t)
  esc(make_capture(p, t, __source__, __module__) |> make_flow)
end

bname(s::Symbol) = Symbol(Base.match(r"^@?(.*?)_+(_str)?$", string(s)).captures[1])

bsym(s::Symbol) = Symbol(split(string(s), "_")[1])
bsym(b::TyBind) = b.name

get_binds(x) = (bs = Any[]; get_binds(x, bs); bs)
function get_binds(x, bs)
    isa(x, QuoteNode) ? get_binds(x.value, bs) : 
      is_bind(x) || (is_slurp(x) && x ≠ :__) ? push!(bs, bname(x)) :
        isa(x, TyBind) ? push!(bs, x.name) :
          isa(x, OrBind) ? (get_binds(x.left, bs); get_binds(x.right, bs)) :
            is_tb(x) ? push!(bs, bsym(x)) :
              is_expr(x, :$) ? bs :
                isa(x, Expr) ? map(p -> get_binds(p, bs), [x.head, x.args...]) : 
                  bs
end

macro try_like(x)
  quote
      r = $(esc(x))
      r isa LikeError && return r
      r
  end
end

macro mate(p, t)
  bs = get_binds(t)
  t = tybind(orbind(t))
  quote
      $([:($(esc(b)) = nothing) for b in bs]...)
      r = try_like($(esc(Expr(:quote, t))), $(esc(p)))
      if r === nothing; false
      else
          $([:($(esc(b)) = get(r, $(esc(Expr(:quote, b))), nothing)) for b in bs]...)
          true
      end
  end
end

function make_clause(x, yes, no=nothing)
    bs = get_binds(x)
    x = tybind(orbind(x))
    f(x) = :(let $(esc(:env)) = d, $((:($(esc(b)) = get(d, $(Expr(:quote, b)), nothing)) for b in bs)...); $x end)
    quote
        d = try_like($(Expr(:quote, x)), tgt)
        d === nothing ? $no : $(f(esc(yes)))
    end
end

make_if(xs, no=nothing) = foldr((c, x) -> :($(c[1]) ? $(c[2]) : $x), xs; init=no)

function get_clauses(e)
  line = nothing
  cs = []
  for x in e.args
      is_line(x) && (line = x; continue)
      r = try_like(:(pat_ => yes_), x)
      r === nothing && error("Invalid like clause $x")
      pat, yes = r[:pat], r[:yes]
      push!(cs, (pat, :($line; $yes)))
  end
  cs
end

macro like(t, p)
  @assert is_expr(p, :block)
  e = quote; tgt = $(esc(t)) end
  push!(e.args, foldr((c, b) -> make_clause(c..., b), get_clauses(p); init=nothing))
  return e
end

