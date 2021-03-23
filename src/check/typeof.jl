lj_typeof(::TAny, ::TyDeclCol, env::Env) = TDataType()
lj_typeof(::TDataType, ::TyDeclCol, env::Env) = TDataType()
lj_typeof(::TSuperUnion, ::TyDeclCol, env::Env) = TDataType()
lj_typeof(::TUnionAll, ::TyDeclCol, env::Env) = TDataType()
function lj_typeof(t::TType, tds::TyDeclCol, env::Env)
    lj_typeable(t.t, tds, env)
    TDataType()
end
function lj_typeof(t::TTuple, tds::TyDeclCol, env::Env)
    all(map(t -> lj_typeable(t, tds, env), t.ts)) ? TDataType() : lj_error("Malformed tuple component")
end
lj_typeof(::TSuperTuple, ::TyDeclCol, env::Env) = TDataType()
function lj_typeof(t::TName, tds::TyDeclCol, env::Env)
    if all(isnumber, String(t.name)); return TDataType()
    end
    param_num = lj_lookup_params_cnt(t, tds)
    param_num == 0 ? TDataType() : compose_unionalls(param_num)
end
function lj_typeof(t::TApp, tds::TyDeclCol, env::Env)
  if length(t.ts) == 0
    lj_typeof(t.t, tds, env)
  elseif length(t.ts) == 1
    @assert lj_typeable(t.ts[1], tds, env)
    tt = lj_typeof(t.t, tds, env)
    @assert isa(tt, TUnionAll) "expected TUnionAll"
    tt.t
  else
    lj_typeof(TApp(TApp(t.t, [t.ts[1]]), t.ts[2:end]), tds, env)
  end
end
function lj_typeof(t::TUnion, ::TyDeclCol, ::Env)
  ts = t.ts
  if length(ts) == 1
    TDataType()
  elseif length(ts) == 0
    TName("TypeofBottom", "Core")
  else
    TSuperUnion()
  end
end
lj_typeof(t::TVar, ::TyDeclCol, env::Env) = env_defines(env, t) ? TDataType() : lj_error(string("typeof: variable ", t, " undefined in ", env))
function lj_typeof(t::TWhere, tds::TyDeclCol, env::Env)
  tv = t.tvar
  tt = t.t
  if env_conflict(env, t.tvar); (tv, tt) = freshen(env, t.tvar, t.t)
  end
  env_add!(env, tv, t.lb, t.ub, tds)
  t_ty = lj_typeof(tt, tds, env)
  TUnionAll(t_ty)
end
lj_typeof(t::TValue, ::TyDeclCol, ::Env) = lj_parse_type(string(typeof(eval(Meta.parse(t.v))))) # this is crazy, but

function lj_typeof_full(t::ASTBase, tds::TyDeclCol, env::Env)
  typeable = t -> lj_typeable(t, tds, env)
  if is_kind(t) || isa(t, TAny) || isa(t, TTuple) && all(typeable, t.ts) || isa(t, TApp) && isa(t.t, TWhere) && false || isa(t, TName) && lj_lookup_params_cnt(t) == 0 || isa(t, TApp) && false
    return TDataType()
  elseif isa(t, TUnion) && all(typeable, t.ts) || isa(t, TApp) && isa(t.t, TWhere) && false ||
    return TUnion()
  elseif isa(t, TApp) && isa(t.t, TWhere) && false || isa(t, TName) && lj_lookup_params_cnt(t) == 0 || isa(t, TApp) && isa(t, TApp) && false #= TODO: check_params =#
    return TUnionAll()
  elseif isa(t, TWhere)
    if env_conflict(env, t.tvar); (tv, tt) = freshen(env, t.tvar, t.t)
    end
    env_add!(env, tv, t.lb, t.ub, tds)
    if lj_typeable(tt, tds, env); return TUnionAll()
    end
  else
    throw(LJErrTypeNotWF())
  end
end

function lj_typeable(t::ASTBase, tds::TyDeclCol, env::Env)
  lj_typeof(t, tds, env)
  true
end

compose_unionalls(n::Int) = n == 0 ? TDataType() : TUnionAll(compose_unionalls(n - 1))
