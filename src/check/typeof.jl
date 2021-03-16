################################################################################
### Typeof for Lambda-Julia types
### ----------------------------------------------------------------------------
###
### NOTE. To be included after [errors.jl], [aux_AST.jl], 
###       [AST.jl], [parsing.jl], and [env.jl]
################################################################################

# Uncomment includes below to get better support from an editor
#=
include("errors.jl")
include("aux/aux_AST.jl")
include("syntax/AST.jl")
include("syntax/parsing.jl")
include("env.jl")
# =#

##### Implementation of LambdaJulia's typeof

# (ANY)
function lj_typeof(t::TAny, ::TyDeclCol, env::Env)
  return TDataType()
end

# (DATATYPE)
function lj_typeof(t::TDataType, ::TyDeclCol, env::Env)
  return TDataType()
end

# (UNIONT)
function lj_typeof(t::TSuperUnion, ::TyDeclCol, env::Env)
  return TDataType()
end

# (UNIONALL)
function lj_typeof(t::TUnionAll, ::TyDeclCol, env::Env)
  return TDataType()
end

# (TYPET)
function lj_typeof(t::TType, tds::TyDeclCol, env::Env)
  lj_typeable(t.t, tds, env)
  TDataType()
end

# (TUPLE)
function lj_typeof(t::TTuple, tds::TyDeclCol, env::Env)
  if all(map(t -> lj_typeable(t, tds, env), t.ts))
    TDataType()
  else
    lj_error("Malformed tuple component")
  end
end

# (SUPERTUPLE)
function lj_typeof(::TSuperTuple, ::TyDeclCol, env::Env)
  return TDataType()
end

# (NAME_DATATYPE)
function lj_typeof(t :: TName, tds :: TyDeclCol, env::Env)
  if all(isnumber, String(t.name))
    return TDataType()
  else
    param_num = lj_lookup_params_cnt(t, tds)
    if param_num == 0
      return TDataType()                  # (NAME_DATATYPE)
    else
      return compose_unionalls(param_num) # (NAME_DATATYPE_2)
    end
  end
end

# (APP) -- parametric instantiation
function lj_typeof(t::TApp, tds::TyDeclCol, env::Env)
  if length(t.ts) == 0                # empty `{}` is not a TApp at all
    return lj_typeof(t.t, tds, env)
  elseif length(t.ts) == 1            # (APP_ONE)
    # two preconditions:
    #
    # 1) type argument of parametric instantiation should be a valid type
    @assert lj_typeable(t.ts[1], tds, env)
    #
    # 2) type of a head should be UnionAll
    tt = lj_typeof(t.t, tds, env)
    #head_t = lj_typeof(t.t, tds)
    @assert isa(tt, TUnionAll) "expected TUnionAll"
    tt.t
  else                               # (APP_MANY)
    # recurse...
    return lj_typeof(TApp(TApp(t.t, [t.ts[1]]), t.ts[2:end]), tds, env)
  end
end

# (UNION)
function lj_typeof(t::TUnion, tds::TyDeclCol, env::Env)
  ts = t.ts
  #
  if length(ts) == 1
    return TDataType()                            # (UNION_UNION)
  elseif length(ts) == 0 # TODO: This is adhoc rule to mimic Julia, a hack
    return TName("TypeofBottom", "Core")          # (BOTTOM)
  else
    return TSuperUnion()                          # (UNION_NOT_UNION)
  end
end

# (VAR)
function lj_typeof(t::TVar, tds::TyDeclCol, env::Env)
  if env_defines(env, t)
    return TDataType()          # Not sure DataType is correct, but will do 
  else
    lj_error(string("typeof: variable ",t," undefined in ", env))
  end
end

# (WHERE)
function lj_typeof(t::TWhere, tds::TyDeclCol, env::Env)
  # skip some checks:
  # @assert t.t <> t.tvar # 1
  # @assert T \in ftv(t)  # 2
  tv = t.tvar
  tt = t.t
  if env_conflict(env, t.tvar)
    (tv, tt) = freshen(env, t.tvar, t.t)
  end
  env_add!(env, tv, t.lb, t.ub, tds)

  t_ty = lj_typeof(tt, tds, env)
  return TUnionAll(t_ty)
end

function lj_typeof(t::TValue, tds::TyDeclCol, env::Env)
  #throw(LJErrTermInType("$(t)"))
  return lj_parse_type(string(typeof(eval(Meta.parse(t.v))))) # this is crazy, but
  # for a value we just fall back to Julia's typeof and then move bacl to our AST
end

function lj_typeof_full(t::ASTBase, tds::TyDeclCol, env::Env)
  typeable = t -> lj_typeable(t, tds, env)
  if      is_kind(t)                                     ||
          isa(t, TAny)                                   ||
          isa(t, TTuple) && 
            all(typeable, t.ts)
          isa(t, TApp)       && 
            isa(t.t, TWhere) && 
            #typeable(t.)
            false #= TODO: subst =#                      ||
          isa(t, TName)  && 
            lj_lookup_params_cnt(t) == 0 ||
          isa(t, TApp)   && 
            false #= TODO: check_params =#
    return TDataType()
  elseif  isa(t, TUnion) && all(typeable, t.ts) ||
          isa(t, TApp)       && 
            isa(t.t, TWhere) && 
            false #= TODO: subst =#                      ||
    return TUnion()
  elseif  isa(t, TApp)       &&
            isa(t.t, TWhere) &&
            false #= TODO: subst =#                      ||
          isa(t, TName)  && 
            lj_lookup_params_cnt(t) == 0 ||
          isa(t, TApp)   && 
          isa(t, TApp)   && 
            false #= TODO: check_params =#
    return TUnionAll()
  elseif isa(t, TWhere) # the only case when `env` grows
    if env_conflict(env, t.tvar)
      (tv, tt) = freshen(env, t.tvar, t.t)
    end
    env_add!(env, tv, t.lb, t.ub, tds)
    if lj_typeable(tt, tds, env)
      return TUnionAll()
    end
  else
    throw(LJErrTypeNotWF())
  end
end

# Check if we can type given type
function lj_typeable(t::ASTBase, tds::TyDeclCol, env::Env)
  lj_typeof(t, tds, env)
  true
end

######################       Auxiliary functions       ######################

function compose_unionalls(n::Int)
  n == 0 ? TDataType() : TUnionAll(compose_unionalls(n-1))
end
