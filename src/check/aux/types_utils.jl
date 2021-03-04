################################################################################
### Various utilities for working with Lambda-Julia types:
### is_concrete, lift_union, etc.
### ----------------------------------------------------------------------------
###
### NOTE. To be included after [errors.jl], [aux_AST], [AST.jl],
###       [env.jl], and [typeof.jl]
################################################################################

# Uncomment includes below to get better support from an editor
#=
include("errors.jl")
include("aux/aux_AST.jl")
include("syntax/AST.jl")
include("env.jl")
include("typeof.jl")
# =#

##### is_concrete

function is_concrete(t::ASTBase, tds::TyDeclCol)
  # covers TAny, TSuperUnion, TSuperTuple, TType, TUnionAll, TValue
  return false
end

function is_concrete(t::TUnion, tds::TyDeclCol)
  # special case: a Union of Type{t} is concrete because DataType is concrete
  if all(t -> isa(t,TType) && isa(lj_typeof(t.t, tds, Env([],[])), TDataType),
         t.ts)
    return true
  end
  return false
end

function is_concrete(t::Union{TVar, TDataType}, ::TyDeclCol)
  return true
end

function is_concrete(t::TApp, tds::TyDeclCol)
  # t.t must be concrete, and params must be fully instantiated
  if isa(t.t, TName)
    tdt = lj_lookup(t.t,tds)
    # tdt_vars = map(t -> t[2], tdt.params)
    return tdt.attr != Abstract() && length(tdt.params) == length(t.ts)
  else
    return false
  end
end

function is_concrete(t::TName, tds::TyDeclCol)
  # t must be concrete, and have no parameters
  tdt = lj_lookup(t,tds)
  s = (tdt.attr != Abstract() && length(tdt.params) == 0)
end

################################################################################
#
# Returns a union of types calculated via picking one element of first
# union inside top-level Tuple at a time: 
#
#    Tuple{Union{A,B}, Union{B,C}} → 
#       Union{Tuple{A, Union{C,D}}, Tuple{B, Union{C,D}}}
#
# Likewise it lifts unionall it if happens to go before plain unions.
#
# Consequtive calls to this routine
# approach a "disjunctive normal form", i.e. when a type consists of
# 0 or more top layers of Unions and UnionAlls (in no particular order) 
# and then a tuple not containing immediate unions in its components.
#
function lift_union(t :: TTuple, env::Env)
  for i in 1:length(t.ts)
    if isa(t.ts[i], TUnion) && length(t.ts[i].ts) > 0 # lift finite union
      ts_u = ASTBase[]
      for tj in t.ts[i].ts
        ts_t = copy(t.ts)
        ts_t[i] = tj
        push!(ts_u, TTuple(ts_t))
      end
      return TUnion(ts_u)
    elseif isa(t.ts[i], TWhere)   # lift UnionAll
      ua = t.ts[i]
      uav, uat = ua.tvar, ua.t
      if env_conflict(env, ua.tvar)
        (uav, uat) = freshen(env, ua.tvar, ua.t)
      end
      ts_t = copy(t.ts)
      ts_t[i] = uat
      return TWhere(TTuple(ts_t), uav, ua.lb, ua.ub)
    end
  end
  t
end

lift_union(t :: ASTBase, env::Env) = t

#
# Returns the collection of types calculated via picking one element of first
# union at the top level or inside top-level Tuple constructor at a time
# Bascially: greedy version of `lift_union` above
#
function lift_union_full(t::ASTBase)
  tl = no_union(t)
  if length(tl) == 1
    tl[1]
  else
    TUnion(tl)
  end
end

function no_union(t :: ASTBase)
    lj_error(string("no_union not implemented for: ",t))
end

no_union(t :: TDataType) = [t]
no_union(t :: TAny) = [t]
no_union(t :: TName) = [t]
no_union(t :: TVar) = [t]
no_union(t :: TSuperTuple) = [t]
no_union(t :: TUnionAll) = [t]
no_union(t :: TSuperUnion) = [t]
no_union(t :: TType) = [t]
no_union(t :: TValue) = [t]

no_union(t :: TUnion) = reduce(vcat, Vector{ASTBase}(), map(no_union, t.ts))

# A: We are unsure what to do with these two:
no_union(t :: TApp) = [t]
no_union(t :: TWhere) = [t]

function no_union(t :: TTuple)
    rec = Vector{Vector{ASTBase}}()
    reduce((_, t) -> push!(rec, no_union(t)), rec, t.ts)

    r = cartesian(rec)

    res = Vector{ASTBase}()
    reduce((_, ts) -> push!(res, TTuple(ts)), res, r)
    res
end

# Cartesian product of x[i]'s
function cartesian(x :: Vector{Vector{T}} where T)
    res = (typeof(x))()      # --> empty 2D array
    push!(res, eltype(x)())  # --> 1-element 2D array: [[]]
    if isempty(x)
        return res
    end
    pop!(res)                # again empty
    rec = cartesian(x[2:end])
    for i in 1:length(x[1])
        res = vcat(res, map(z -> vcat([x[1][i]], z), rec))
    end
    res
end
