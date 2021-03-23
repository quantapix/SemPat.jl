module LJ_UpperBound

using ..lj:
        ASTBase, TAny, TUnion, EmptyUnion, TVar, TApp, TWhere, TTuple, TName,
        TDataType, TUnionAll, TSuperUnion, TType, TSuperTuple, TValue,
        print_collection,
        is_notfound_marker,
        LJErrApplicationException

using ..lj.LJ_NormalForm:
        UsedVarsDict, varname_base, varname_in,
        varname_gen_new!, varname_add!, varname_remove!,
        PrimitiveSimpleType, rename_var

using ..lj.LJ_Diagonality:
        TyVarMarker, TVM_Undef, TVM_Cov, TVM_Inv,
        DiagEnv, copy, diagenv_in, diagenv_get,
        diagenv_add!, diagenv_remove!, diagenv_mark!

export lj_upper_bound

function lj_upper_bound(t::ASTBase)::Tuple{ASTBase,Bool}
    t = make_vars_distinct(t)
    (oi, u, f) = upper_bound(DiagEnv(), false, t)
    (u, f)
end

OccurInfo = Tuple{Int,Int,Int}
OccurInfoDict = Dict{Symbol,OccurInfo}

occinfo_get(occinfo::OccurInfoDict, v::Symbol)::OccurInfo = haskey(occinfo, v) ? occinfo[v] : (0, 0, 0)

function occinfo_merge(ois::Vector{OccurInfoDict})::OccurInfoDict
    occinfo = OccurInfoDict()
    for oi in ois
      for (v, (c, i, n)) in oi
        (c_tot, i_tot, n_tot) = (0, 0, 0)
        if haskey(occinfo, v); (c_tot, i_tot, n_tot) = occinfo[v]
        end
        occinfo[v] = (c_tot + c, i_tot + i, n_tot + n)
      end
    end
    occinfo
end

function occinfo_join(ois::Vector{OccurInfoDict})::OccurInfoDict
    occinfo = OccurInfoDict()
    for oi in ois
      for (v, (c, i, n)) in oi
        (c_tot, i_tot, n_tot) = (0, 0, 0)
        if haskey(occinfo, v); (c_tot, i_tot, n_tot) = occinfo[v]
        end
        occinfo[v] = (max(c_tot, c), max(i_tot, i), max(n_tot, n))
      end
    end
    occinfo
end

## where flag == true if upper-bound is different from the source type
UBResult = Tuple{OccurInfoDict,ASTBase,Bool}

function upper_bound(::DiagEnv, ident::Bool, t::ASTBase)::UBResult
  throw(LJErrApplicationException("upper_bound(::DiagEnv,::Bool, t::ASTBase) " * 
  "shouldn't be called (t == $(t))"))
end

TTrivialType = Union{TAny,TName,TDataType,TSuperUnion,TSuperTuple,TValue}

upper_bound(::DiagEnv, ident::Bool, t::TTrivialType)::UBResult = (OccurInfoDict(), t, false)
upper_bound(::DiagEnv, ident::Bool, t::TUnionAll)::UBResult = (OccurInfoDict(), t, false)
function upper_bound(gamma::DiagEnv, ::Bool, t::TVar)::UBResult
    v = t.sym
    m = diagenv_get(gamma, v)
    occ = (m == TVM_Inv) ? 
          (0, 1, 0) : 
          ((m == TVM_Cov) ? (1, 0, 0) : (0, 0, 1))
    occinfo = OccurInfoDict(v => occ)
    (occinfo, t, false)
end
function upper_bound(gamma::DiagEnv, ident::Bool, t::TTuple)::UBResult
    results = UBResult[]
    gamma_cov = copy(gamma)
    diagenv_mark!(gamma_cov, TVM_Cov)
    for te::ASTBase in t.ts
        ubr::UBResult = upper_bound(gamma_cov, ident, te)
        push!(results, ubr)
    end
    occinfo = occinfo_merge(map(r -> r[1], results))
    (occinfo, t, false)
end
function upper_bound(gamma::DiagEnv, ::Bool, t::TApp)::UBResult
    results = UBResult[]
    gamma_inv = copy(gamma)
    diagenv_mark!(gamma_inv, TVM_Inv)
    for te::ASTBase in t.ts
        ubr::UBResult = upper_bound(gamma_inv, true, te)
        push!(results, ubr)
    end
    occinfo = occinfo_merge(map(r -> r[1], results))
    (occinfo, t, false)
end
function upper_bound(gamma::DiagEnv, ::Bool, t::TType)::UBResult
    gamma_inv = copy(gamma)
    diagenv_mark!(gamma_inv, TVM_Inv)
    (occinfo, tt_new, changed) = upper_bound(gamma_inv, true, t.t)
    (occinfo, t, false)
end
function upper_bound(gamma::DiagEnv, ident::Bool, t::TWhere)::UBResult
    gamma_new = copy(gamma)
    v = t.tvar.sym
    diagenv_add!(gamma_new, v)
    (tt_oi, tt_new, changed) = upper_bound(gamma_new, ident, t.t)
    t_new = t
    if !ident
      (c, i, n) = occinfo_get(tt_oi, v)
      if c > 0
          tt_new = substitute_var(t.tvar, t.ub, tt_new)
          changed = true
      end
      (tt_oi, tt_new_dummy, changed_dummy) = upper_bound(gamma_new, true, tt_new)
      (c, i, n) = occinfo_get(tt_oi, v)
      t_new = tt_new
      if (c + i + n) > 0; t_new = TWhere(tt_new, t.tvar, t.lb, t.ub, false)
      end
    end
    (lb_oi, lb_new, lb_changed) = upper_bound(gamma, true, t.lb)
        (ub_oi, ub_new, ub_changed) = upper_bound(gamma, true, t.ub)
    if haskey(tt_oi, v); pop!(tt_oi, v)
    end
    occinfo = occinfo_join([lb_oi, ub_oi, tt_oi])
    (occinfo, t_new, changed)
end
function upper_bound(gamma::DiagEnv, ident::Bool, t::TUnion)::UBResult
    if length(t.ts) == 0; return (OccurInfoDict(), t, false)
    end
    results = map(te -> upper_bound(gamma, ident, te), t.ts)
    ois = map(r -> r[1], results)
    ts  = map(r -> r[2], results)
    occinfo = occinfo_merge(ois)
    (occinfo, TUnion(ts), any(map(r -> r[3], results)))
end

make_vars_distinct(t::ASTBase) = make_vars_distinct(t, UsedVarsDict())
make_vars_distinct(t::ASTBase, ::UsedVarsDict)::ASTBase = throw(LJErrApplicationException("make_vars_distinct(t::ASTBase, :: UsedVarsDict) " * "shouldn't be called (t == $(t))"))
make_vars_distinct(t::PrimitiveSimpleType, ::UsedVarsDict)::PrimitiveSimpleType = t
make_vars_distinct(t::TUnion, used_vars::UsedVarsDict)::TUnion = TUnion(map(te -> make_vars_distinct(te, used_vars), t.ts))
make_vars_distinct(t::TVar, ::UsedVarsDict)::TVar = t
make_vars_distinct(t::TApp, ::UsedVarsDict)::TApp = t
make_vars_distinct(t::TTuple, used_vars::UsedVarsDict)::TTuple = TTuple(map(te -> make_vars_distinct(te, used_vars), t.ts))
make_vars_distinct(t::TUnionAll, ::UsedVarsDict)::TUnionAll = t
make_vars_distinct(t::TType, ::UsedVarsDict)::TType = t
function make_vars_distinct(t::TWhere, used_vars::UsedVarsDict)::TWhere
    v = t.tvar
    vs = String(v.sym)
    tt = t.t
    if varname_in(vs, used_vars)
        vs_new = varname_gen_new!(vs, used_vars)
        varname_add!(vs_new, used_vars)
        v_new = Symbol(vs_new)
        v = TVar(v_new)
        tt = rename_var(t.tvar.sym, v_new, t.t)
    else
        varname_add!(vs, used_vars)
    end
    tt = make_vars_distinct(tt, used_vars)
    lb = make_vars_distinct(t.lb, used_vars)
    ub = make_vars_distinct(t.ub, used_vars)
    TWhere(tt, v, lb, ub, t.diag)
end

substitute_var(::TVar, ::ASTBase, t::ASTBase)::ASTBase = throw(LJErrApplicationException("substitute_var(::TVar,dt::ASTBase,t::ASTBase) " * "shouldn't be called (t == $(t))"))
substitute_var(::TVar, ::ASTBase, t::PrimitiveSimpleType)::PrimitiveSimpleType = t
substitute_var(v::TVar, dt::ASTBase, t::TUnion)::TUnion = TUnion(map(te -> substitute_var(v, dt, te), t.ts))
substitute_var(v::TVar, dt::ASTBase, t::TTuple)::TTuple = TTuple(map(te -> substitute_var(v, dt, te), t.ts))
substitute_var(v::TVar, dt::ASTBase, t::TVar)::ASTBase = t == v ? dt : t
substitute_var(::TVar, ::ASTBase, t::TApp)::TApp = t
substitute_var(::TVar, ::ASTBase, t::TUnionAll)::TUnionAll = t
substitute_var(::TVar, ::ASTBase, t::TType)::TType = t
function substitute_var(v::TVar, dt::ASTBase, t::TWhere)::TWhere
    tt = t.t
    if t.tvar != v; tt = substitute_var(v, dt, tt)
    end
    TWhere(tt, t.tvar, t.lb, t.ub, t.diag)
end

end
