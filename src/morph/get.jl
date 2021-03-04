function get_type(t::Theory, n::Symbol)::TypeCons
    ii = findall(x -> x.name == n, t.types)
    length(ii) < 1 && error("Type constructor for $n is missing")
    length(ii) > 1 && error("Type constructor for $n is overloaded")
    t.types[ii[1]]
end

function equations(c::Ctxt, t::Theory)::Vector{Pair}
    eqs = Pair[]
    ns = collect(keys(c))
    for (beg, var) in enumerate(ns)
        for n in ns[beg + 1:end]
            e = c[n]
            if isa(e, Symbol) && !has_type(t, e); continue
            end
            e = isa(e, Symbol) ? Expr(:call, e) : e
            cons = get_type(t, e.args[1])
            accessors = cons.params[findall(e.args[2:end] .== var)]
            append!(eqs, (Expr(:call, x, n) => var for x in accessors))
        end
    end
    eqs
end

function equations(ps::Vector{Symbol}, c::Ctxt, t::Theory)::Vector{Pair}
    xs = [(expand_in_ctx(l, ps, c, t) => expand_in_ctx(r, ps, c, t)) for (l, r) in equations(c, t)]
    filter(x -> x.first != x.second, xs)
end
equations(c::TermCons, t::Theory)::Vector{Pair} = equations(c.params, c.ctx, t)

function interface(t::Theory)::Vector{QFunc}
    [accessors(t); constructors(t); alias_functions(t)]
end

#=
function interface(t::Theory)::Vector{QFunc}
  [GAT.interface(t); [GAT.constructor(cons_for_gen(x), t) for x in t.types];]
end
=#

accessors(t::Theory)::Vector{QFunc} = vcat(map(accessors, t.types)...)
function accessors(c::TypeCons)::Vector{QFunc}
    [QFunc(Expr(:call, x, Expr(:(::), c.name)), strip_type(c.ctx[x])) for x in c.params]
end

constructors(t::Theory)::Vector{QFunc} = [constructor(x, t) for x in t.terms]

function alias_functions(t::Theory)::Vector{QFunc}
  ts = [t.types; t.terms]
  collect(Iterators.flatten(map(collect(t.aliases)) do a
      dests = filter(i -> i.name == last(a), map(x -> x, ts))
      if isempty(dests); throw(ParseError("Cannot alias undefined type or term $a"))
      end
      map(dests) do d
          c = constructor(d, t)
          c.call.args[1] = first(a)
          xs = map(c.call.args[2:end]) do x
              @match x begin
                  Expr(:(::), Expr(:curly, :Type, ty)) => ty
                  Expr(:(::), p, ty) => p
                  _ => throw(ParseError("Cannot parse argument $x for alias $a"))
              end
          end
          QFunc(c.call, c.ret, Expr(:call, d.name, xs...))
      end
  end))
end
