using Base.Meta

struct Var
    name::Symbol
    num_esc::Int
end

function bind(v::Var)
    x = v.name
    for i = 1:v.num_esc
        x = esc(x)
    end
    :($x = $x)
end

function wrap_closure(m, c)
    x = macroexpand(m, c)
    if isexpr(x, :error); return c
    end
    if isexpr(x, :do) && length(x.args) >= 2 && isexpr(x.args[2], :(->)); x = x.args[2]
    end
    if isexpr(x, :(->))
        y = x.args[1]
        if isa(y, Symbol); ys = [y]
        else
            @assert isexpr(y, :tuple)
            ys = y.args
        end
    elseif isexpr(x, :function)
        @assert isexpr(x.args[1], :call)
        ys = x.args[1].args[2:end]
    else throw(ArgumentError("arg must be a closure"))
    end
    bs = Var[Var(y, 0) for y in ys]
    @assert isa(x.args[2], Expr) && x.args[2].head == :block
    vs = Var[]
    find_vars!(vs, bs, x.args[2], 0)
    quote
        let $(map(bind, vs)...)
            $c
        end
    end
end

"""
    @closure closure_expression

Wrap the closure definition `closure_expression` in a let block to encourage
the julia compiler to generate improved type information.  For example:

```julia
callfunc(f) = f()

function foo(n)
   for i=1:n
       if i >= n
           callfunc(@closure ()->println("Hello \$i"))
       end
   end
end
```
"""
macro closure(c)
    esc(wrap_closure(__module__, c))
end
export @closure

function find_vars!(vs, bs, x, num_esc)
    if isa(x, Symbol)
        v = Var(x, num_esc)
        if !(v in bs); v ∈ vs || push!(vs, v)
        end
        return vs
    elseif isa(x, Expr)
        if x.head == :quote || x.head == :line || x.head == :inbounds; return vs
        end
        if x.head == :(=)
            find_lhs!(vs, bs, x.args[1], num_esc)
            find_vars!(vs, bs, x.args[2], num_esc)
        elseif x.head == :kw; find_vars!(vs, bs, x.args[2], num_esc)
        elseif x.head == :for || x.head == :while || x.head == :comprehension || x.head == :let
            inners = copy(bs)
            find_vars!(vs, inners, x.args, num_esc)
        elseif x.head == :try
            find_vars!(vs, copy(bs), x.args[1], num_esc)
            catches = copy(bs)
            !isa(x.args[2], Symbol) || push!(catches, Var(x.args[2], num_esc))
            find_vars!(vs, catches, x.args[3], num_esc)
            if length(x.args) > 3
                finallies = copy(bs)
                find_vars!(vs, finallies, x.args[4], num_esc)
            end
        elseif x.head == :call; find_vars!(vs, bs, x.args[2:end], num_esc)
        elseif x.head == :local
            foreach(x.args) do e
                if !isa(e, Symbol); find_vars!(vs, bs, e, num_esc)
                end
            end
        elseif x.head == :(::); find_lhs!(vs, bs, x, num_esc)
        elseif x.head == :escape; find_vars!(vs, bs, x.args[1], num_esc + 1)
        else find_vars!(vs, bs, x.args, num_esc)
        end
    end
    vs
end

find_vars!(vs, bs, xs::Vector, num_esc) = foreach(x -> find_vars!(vs, bs, x, num_esc), xs)

function find_lhs!(vs, bs, x, num_esc)
    if isa(x, Symbol)
        v = Var(x, num_esc)
        v ∈ bs || push!(bs, v)
    elseif isa(x, Expr)
        if x.head == :tuple; find_lhs!(vs, bs, x.args, num_esc)
        elseif x.head == :(::)
            find_vars!(vs, bs, x.args[2], num_esc)
            find_lhs!(vs, bs, x.args[1], num_esc)
        else find_vars!(vs, bs, x.args, num_esc)
        end
    end
end

find_lhs!(vs, bs, xs::Vector, num_esc) = foreach(x -> find_lhs!(vs, bs, x, num_esc), xs)

#=
let b1 = (1, 2)
  begin
      function f1(a1::Tuple{A,B}) where {A,B}
          b2 = a1[1]
          function f2(a2::A)
              A
              b3 = a1[2]
              function f3(a3::B)
                 # B # if don't explicitly give a `B` here, err can be raised
                  a2 + a3
              end
              f3(b3)
          end
          f2(b2)
      end
      f1(b1)
  end
end
=#
