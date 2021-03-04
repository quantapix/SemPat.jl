################################################################################
### Simplification of Lambda-Julia types
### ----------------------------------------------------------------------------
###
### NOTE. To be included after [AST.jl],
###       [env.jl], [typeof.jl], and [subtype_xml.jl]
################################################################################

# Uncomment includes below to get better support from an editor
#=
include("syntax/AST.jl")
include("env.jl")
include("typeof.jl")
include("subtype_xml.jl")
# =#

################################################################################
#
# Simplified representation of a union: collapse all pairs subtype:supertype
# to a supertype
#

function lj_simplify_union(ts, tds, env)
  if isempty(ts)
    return ts
  end
  ts1 =
        reduce(
          (r,t) -> simple_join2(r, t, tds, env),
          ts)
  #println("simpl-union: $(ts1)")
  [ts1]
end

function simple_join2(t1::ASTBase, t2::ASTBase, tds, env)
  #println("Hi, simple_join2, inp:\n\t$(t1), $(t2)")
  if t1 == EmptyUnion || t2 == TAny || t1 == t2
    #println("1")
    return t2
  elseif t2 == EmptyUnion || t1 == TAny
    #println("2")
    return t1
  elseif !(is_type(t1, tds, env) || isa(t1, TVar)) ||
         !(is_type(t2, tds, env) || isa(t2, TVar))
    #println("3")
    return TAny()
  elseif in_union(t1, t2)
    #println("4")
    return t1
  elseif in_union(t2, t1)
    #println("5")
    return t2
#    if (jl_is_kind(a) && jl_is_type_type(b) && jl_typeof(jl_tparam0(b)) == a)
#        return a;
#    if (jl_is_kind(b) && jl_is_type_type(a) && jl_typeof(jl_tparam0(a)) == b)
#       return b;
  elseif !has_free_vars(t1) && !has_free_vars(t2)
    if lj_subtype(t1, t2, tds).sub
      #println("6")
      return t2
    end
    if lj_subtype(t2, t1, tds).sub
      #println("7")
      return t1
    end
  end
  #println("8")
  TUnion([t1, t2])
end

is_type(t, tds, env) = is_kind(lj_typeof(t, tds, env))

in_union(t1 :: ASTBase, t2 :: ASTBase) = t1 == t2

function in_union(t1 :: TUnion, t2 :: ASTBase)
  any(t -> in_union(t, t2), t1.ts)
end

has_free_vars(t) = length(free_variables(t)) != 0

################################################################################
#
#  Simplify representation of a type (as in sec. 3 of the LabdaJulia paper)
#
function lj_simplify(t :: ASTBase, :: Any, ::Env)
    #return t
    throw(ErrorException("`lj_simplify` is partial: $(t)"))
end

# Leaf cases
lj_simplify(t :: TDataType, :: Any, ::Env) = t
lj_simplify(t :: TUnionAll, :: Any, ::Env) = t
lj_simplify(t :: TSuperUnion, :: Any, ::Env) = t
lj_simplify(t :: TSuperTuple, :: Any, ::Env) = t
lj_simplify(t :: TAny, :: Any, ::Env) = t
lj_simplify(t :: TVar, :: Any, ::Env) = t
lj_simplify(t :: TName, :: Any, ::Env) =
    #t.name == "TypeofBottom" ? lj_parse_type("Type{Union{}}") :
    t
lj_simplify(t :: TValue, :: Any, ::Env) = t

lj_simplify(t :: TType, tds:: Any, env::Env) =
    TType(lj_simplify(t.t, tds, env))

lj_simplify(t :: TApp, tds :: Any, env::Env) =
    TApp(lj_simplify(t.t, tds, env), map(t -> lj_simplify(t, tds, env), t.ts))

lj_simplify(t :: TTuple, tds :: Any, env::Env) =
    TTuple(map(t -> lj_simplify(t, tds, env), t.ts))

# Discards redundant elems of `Union{t1, ..., tn}`
function lj_simplify(t :: TUnion, tds :: Any, env :: Env)
    #println("simpl(TUnion) inp: $(t)")
    #dump(t)
    ts = map(t -> lj_simplify(t, tds, env), t.ts)
    #dump(ts)
    ts1 = lj_simplify_union(ts, tds, env)
    #dump(ts1)
    if length(ts1) != 1 # 0, 2, 3, ...
      res = TUnion(ts1)
    else
      res = ts1[1]
    end
    #println("simpl(TUnion) res: $(res)")
    #dump(res)
    res
end

# 1) T where T <: ub -> ub (in part., T where T -> Any)
# 2) t where T -> t [if T \not\in FV(t)]
function lj_simplify(t :: TWhere, tds :: Any, env :: Env)
    # Env management
    #println("simpl(TWhere) inp: $(t), env: $(env)")
    # dump(t)
    tv = t.tvar
    tt = t.t
    if env_conflict(env, t.tvar)
      #println("conflict!")
      (tv, tt) = freshen(env, t.tvar, t.t) #println("tt: $(tt)")
    else
      #println("not a conflict")
    end
    #println("env: $(env)")

    env1 = copy(env)
    env_add!(env1, tv, t.lb, t.ub, tds)

    simpl_t = lj_simplify(tt, tds, env1)
    #println(simpl_t)

    #println("tv.sym: ", tv.sym)
    if !(tv.sym in free_variables(simpl_t))
      #println("return sym")
      return simpl_t
    end

    #println("simpl head:")
    #dump(simpl_t)
    if isa(simpl_t, TVar) && simpl_t == tv
        return t.ub
    end
    res = TWhere(simpl_t, tv, t.lb, t.ub)
    #println("simpl(TWhere) res: $(res)")
    #dump(res)
    res
end
