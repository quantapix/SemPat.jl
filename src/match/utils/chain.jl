Chain(d::Dict{K, V}, i::Chain{K, V}) where {K, V} = Chain(d, Ref(i))
Chain(d::Dict{K, V}) where {K, V} = Chain(d, Ref{Chain{K, V}}())
Chain{K, V}() where {K, V} = Chain(Dict{K, V}())

function child(c::Chain{K, V}) where {K, V}
    Chain(Dict{K, V}(), c)
end

function parent(c::Chain{K, V}) where {K, V}
    c.init[]
end

function update_parent!(c::Chain{K, V}) where {K, V}
    p = c.init[]
    for (k, (s, _)) in c.dict; p[k] = (s, false) end
end

function Base.get(c::Chain{K, V}, k::K)::V where {K, V}
    get(c.dict, k) do
        isassigned(c.init) ? get(c.init[], k) : throw(KeyError(k))
        end
end

function Base.get(c::Chain{K, V}, k::K, default) where {K, V}
    get(c.dict, k) do
        isassigned(c.init) ? get(c.init[], k, default) : default
        end
end

function Base.get(f::Function, c::Chain{K, V}, k::K) where {K, V}
    get(c.dict, k) do
        isassigned(c.init) ? get(f, c.init[], k) : f()
        end
end

function Base.get!(f::Function, c::Chain{K, V}, k::K)::V where {K, V}
    get!(c.dict, k) do
        f()
    end
end

Base.getindex(c::Chain, k) = Base.get(c, k)

function Base.setindex!(c::Chain{K, V}, v::V, k::K) where {K, V}
    c.dict[k] = v
end

function each_chain(f::Function, c::Chain{K,V}) where {K,V}
  ks = Set{K}()
  while true
      for (k, v) in c.dict
          if k in ks; continue
          else push!(ks, k)
          end
          f(k, v)
      end
      if isassigned(c.init); c = c.init[]
      else return
      end
  end
end

function each_chain_dup(f::Function, c::Chain{K,V}) where {K,V}
  while true
      for (k, v) in c.dict; f(k, v) end
      if isassigned(c.init); c = c.init[]
      else return
      end
  end
end

function scope_vars(x, scope::Chain{Symbol,Symbol})
    b = Expr(:block)
    each_chain(scope) do k, v
        push!(b.args, :($k = $v))
    end
    isempty(b.args) ? x : Expr(:let, b, x)
end
function scope_vars!(x, scope::Chain{Symbol,Symbol})
    b = Expr(:block)
    each_chain(scope) do k, v
        if k !== v
            a = :($k = $v)
            push!(b.args, a)
        end
    end
    isempty(b.args) ? x : Expr(:let, b, x)
end

