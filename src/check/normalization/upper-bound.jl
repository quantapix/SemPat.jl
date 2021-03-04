################################################################################
### Upper Bound of normalizaed Lambda-Julia types
### ----------------------------------------------------------------------------
### 
### NOTE. To be included after [AST.jl], [errors.jl], [normal-form.jl], 
### and [diagonality.jl]
################################################################################

module LJ_UpperBound

using ..lj:
      # ../syntax/AST.jl
        ASTBase, TAny, TUnion, EmptyUnion, TVar, TApp, TWhere, TTuple, TName,
        TDataType, TUnionAll, TSuperUnion, TType, TSuperTuple, TValue,
        print_collection,
      # ../aux/migration_aux.jl
        is_notfound_marker,
      # ../errors.jl
        LJErrApplicationException

using ..lj.LJ_NormalForm:
      # normal-form.jl
        UsedVarsDict, varname_base, varname_in,
        varname_gen_new!, varname_add!, varname_remove!,
      # aux_nf.jl
        PrimitiveSimpleType, rename_var

using ..lj.LJ_Diagonality:
      # diagonality.jl
        TyVarMarker, TVM_Undef, TVM_Cov, TVM_Inv,
        DiagEnv, copy, diagenv_in, diagenv_get,
        diagenv_add!, diagenv_remove!, diagenv_mark!

export lj_upper_bound

#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ Upper Bound

## Returns an upper bound of [t] and a flag whether it differs from [t]
function lj_upper_bound(t :: ASTBase) :: Tuple{ASTBase, Bool}
  ## To make building an upper bound easier, we first want to convert
  ## types such as [Tuple{T,S} where S where T<:S where S]
  ## into [Tuple{T,S1} where S1 where T<:S where S].
  t = make_vars_distinct(t)
  ## Calculate an upper bound
  (oi, u, f) = upper_bound(DiagEnv(), false, t)
  (u, f)
end

# JB: Algorithm is very similar to occurrence-based marking of diagonal vars.
# We count occurrences to remove unneccessary wheres.
# For example, Tuple{T} where T<:U ==> Tuple{U},
# while Tuple{T,Ref{T}} where T<:U ==> Tuple{U,Ref{T}} where T<:U.
#
# Thus, when we are in a non-where type, we simply count occurrences
#   and return the same type.
# When we are in a where-type in non-ident mode: 
#   we check if there are covariant occurrences to substitute
#   and call substitute_var if so;
#   then, if there are no invariant occurrences, we remove the where-binding.
# In ident mode we do nothing besides counting,
#   because it means that we are inside invariant constructor,
# If substitution took place, we say true; otherwise we say false in UBresult.

######################################################## Occurrence Info

## Triple of counters (covariant, invariant, neutral)
OccurInfo = Tuple{Int,Int,Int}

## Dictionary of occurrence information 
OccurInfoDict = Dict{Symbol, OccurInfo}

occinfo_get(occinfo :: OccurInfoDict, v :: Symbol) :: OccurInfo =
    haskey(occinfo, v) ? occinfo[v] : (0,0,0)

## Merges occurrence info about all variables across [ois]
function occinfo_merge(ois :: Vector{OccurInfoDict}) :: OccurInfoDict
    occinfo = OccurInfoDict()
    for oi in ois
      for (v, (c, i, n)) in oi
        (c_tot, i_tot, n_tot) = (0, 0, 0)
        if haskey(occinfo, v)
            (c_tot, i_tot, n_tot) = occinfo[v]
        end
        occinfo[v] = (c_tot + c, i_tot + i, n_tot + n)
      end
    end
    occinfo
end

## Joins occurrence info about all variables across [ois]
## (takes max occurrence infos)
function occinfo_join(ois :: Vector{OccurInfoDict}) :: OccurInfoDict
    occinfo = OccurInfoDict()
    for oi in ois
      for (v, (c, i, n)) in oi
        (c_tot, i_tot, n_tot) = (0, 0, 0)
        if haskey(occinfo, v)
            (c_tot, i_tot, n_tot) = occinfo[v]
        end
        occinfo[v] = (max(c_tot, c), max(i_tot,i), max(n_tot, n))
      end
    end
    occinfo
end

######################################################## Function Signature

## (occur-info, upper-bound, flag)
## where flag == true if upper-bound is different from the source type
UBResult = Tuple{OccurInfoDict, ASTBase, Bool}

## Actual implementation 
## (if ident == true, we are in identity mode — only count occurrences;
##  otherwise we build an upper bound)
function upper_bound(gamma :: DiagEnv, ident::Bool, t :: ASTBase) :: UBResult
  throw(LJErrApplicationException("upper_bound(::DiagEnv,::Bool, t::ASTBase) " * 
  "shouldn't be called (t == $(t))"))
end
  
######################################################## Simple Types

#----------------------------------------- Trivia

TTrivialType = Union{TAny, TName, 
    TDataType, TSuperUnion, TSuperTuple, TValue}

upper_bound(gamma :: DiagEnv, ident::Bool, t :: TTrivialType) :: UBResult =
    (OccurInfoDict(), t, false)

# TODO: what should be done with t.t?
upper_bound(gamma :: DiagEnv, ident::Bool, t :: TUnionAll) :: UBResult =
    (OccurInfoDict(), t, false)

#----------------------------------------- Type Variable

function upper_bound(gamma :: DiagEnv, ident::Bool, t :: TVar) :: UBResult
    v = t.sym
    m = diagenv_get(gamma, v)
    occ = (m == TVM_Inv) ? 
          (0, 1, 0) : 
          ((m == TVM_Cov) ? (1, 0, 0) : (0, 0, 1))
    occinfo = OccurInfoDict(v => occ)
    (occinfo, t, false)
end

#----------------------------------------- Tuple

function upper_bound(gamma :: DiagEnv, ident::Bool, t :: TTuple) :: UBResult
    results = UBResult[]
    # create copy of gamma and mark it covariant
    gamma_cov = copy(gamma)
    diagenv_mark!(gamma_cov, TVM_Cov)
    # run counting on elements of the tuple
    for te :: ASTBase in t.ts
        ubr :: UBResult = upper_bound(gamma_cov, ident, te)
        push!(results, ubr)
    end
    # merge occinfos
    occinfo = occinfo_merge(map(r -> r[1], results))
    # nothing can change in a normalized tuple without wheres
    (occinfo, t, false)
end

#----------------------------------------- Name Application

## Expects [t] to be name{t1, ..., tn}
function upper_bound(gamma :: DiagEnv, ident::Bool, t :: TApp) :: UBResult
    results = UBResult[]
    # create copy of gamma and mark it invariant
    gamma_inv = copy(gamma)
    diagenv_mark!(gamma_inv, TVM_Inv)
    # run counting on elements of the application with ident == true,
    # becaus we don't change under invariant constructor
    for te :: ASTBase in t.ts
        ubr :: UBResult = upper_bound(gamma_inv, true, te)
        push!(results, ubr)
    end
    # merge occinfos
    occinfo = occinfo_merge(map(r -> r[1], results))
    # we don't change [t] for it is invariant
    (occinfo, t, false)
end

#----------------------------------------- Type{t}

function upper_bound(gamma :: DiagEnv, ident::Bool, t :: TType) :: UBResult
    # create copy of gamma and mark it invariant
    gamma_inv = copy(gamma)
    diagenv_mark!(gamma_inv, TVM_Inv)
    # run counting on inside type
    (occinfo, tt_new, changed) = upper_bound(gamma_inv, true, t.t)
    # we don't change [t] for it is invariant
    (occinfo, t, false)
end

######################################################## Where-Type

function upper_bound(gamma :: DiagEnv, ident::Bool, t :: TWhere) :: UBResult
    # create copy of gamma and add new type variable in it
    gamma_new = copy(gamma)
    v = t.tvar.sym
    diagenv_add!(gamma_new, v)
    # run counting on the underlying type
    (tt_oi, tt_new, changed) = upper_bound(gamma_new, ident, t.t)
    # if we are in ident mode (meaning we are inside invariant constructor),
    # then there is nothing more to be done;
    # otherwise, we have to build an upper bound
    t_new = t
    if !ident
      # first, we get counters info
      (c, i, n) = occinfo_get(tt_oi, v)
      # if there are covariant occurrences of the variable,
      # we have to substitute them for the variable's upper bound
      if c > 0
          # substitutes only in covariant positions
          tt_new = substitute_var(t.tvar, t.ub, tt_new)
          changed = true # remember that the type changed
      end
      # now we need to rerun counting without further replacing for ub
      (tt_oi, tt_new_dummy, changed_dummy) = 
        upper_bound(gamma_new, true, tt_new)
      (c, i, n) = occinfo_get(tt_oi, v)
      # if there are other occurrences of the variable (e.g. in the bounds),
      # we have to keep where-binding, otherwise it can be removed
      t_new = tt_new
      if (c + i + n) > 0
          # TODO: the variable cannot be diagonal, can it?
          # anyway, diagonality will be recalculated...
          t_new = TWhere(tt_new, t.tvar, t.lb, t.ub, false)
      end
    end
    # run counting on bounds (bounds do not change! so ident==true)
    (lb_oi, lb_new, lb_changed) = upper_bound(gamma, true, t.lb)
    (ub_oi, ub_new, ub_changed) = upper_bound(gamma, true, t.ub)
    # remove info about [v] for it's been discharged
    if haskey(tt_oi, v)
      pop!(tt_oi, v)
    end
    occinfo = occinfo_join([lb_oi, ub_oi, tt_oi])
    (occinfo, t_new, changed)
end

######################################################## Union Type

function upper_bound(gamma :: DiagEnv, ident::Bool, t :: TUnion) :: UBResult
    # Union{}, which is Bottom, is a special case 
    if length(t.ts) == 0
        return (OccurInfoDict(), t, false)
    end
    # simply run diagonality on subtypes and merge occinfos
    results = map(te -> upper_bound(gamma, ident, te), t.ts)
    ois = map(r -> r[1], results)
    ts  = map(r -> r[2], results)
    occinfo = occinfo_merge(ois)
    (occinfo, TUnion(ts), any(map(r -> r[3], results)))
end


#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ Aux Functons

######################################################## Renaming Covariant Vars

## Make all variables bound in covariant wheres distinct
make_vars_distinct(t :: ASTBase) = make_vars_distinct(t, UsedVarsDict())

function make_vars_distinct(t :: ASTBase, used_vars :: UsedVarsDict) :: ASTBase
  throw(LJErrApplicationException("make_vars_distinct(t::ASTBase, :: UsedVarsDict) " * 
  "shouldn't be called (t == $(t))"))
end

#----------------------------------------- Implementation

make_vars_distinct(t :: PrimitiveSimpleType, used_vars :: UsedVarsDict) ::
    PrimitiveSimpleType = t

make_vars_distinct(t :: TUnion, used_vars :: UsedVarsDict) :: TUnion =
    TUnion(map(te -> make_vars_distinct(te, used_vars), t.ts))

make_vars_distinct(t :: TVar, used_vars :: UsedVarsDict) :: TVar = t

# JB NOTE: we can keep names in invariant constructors,
# because we are not going to substitute inside invariant constructors.
# TODO: is it ok for the upper_bound algorithm?
make_vars_distinct(t :: TApp, used_vars :: UsedVarsDict) :: TApp = t

make_vars_distinct(t :: TTuple, used_vars :: UsedVarsDict) :: TTuple =
    TTuple(map(te -> make_vars_distinct(te, used_vars), t.ts))

make_vars_distinct(t :: TUnionAll, used_vars :: UsedVarsDict) :: TUnionAll = t

# JB NOTE: same as TApp
make_vars_distinct(t :: TType, used_vars :: UsedVarsDict) :: TType = t

function make_vars_distinct(t :: TWhere, used_vars :: UsedVarsDict) :: TWhere
  v = t.tvar
  vs = String(v.sym)
  tt = t.t
  # if this variable has already been used, we rename it
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
  # TODO: do we need to rename vars in bounds?
  lb = make_vars_distinct(t.lb, used_vars)
  ub = make_vars_distinct(t.ub, used_vars)
  TWhere(tt, v, lb, ub, t.diag)
end

######################################################## Covariant Substitution

## Substitutes covariant occurrences of var [v] with type [dt] in type [t]
## NOTE. Assumes that no variable capture can occur
function substitute_var(v :: TVar, dt :: ASTBase, t :: ASTBase) :: ASTBase
  throw(LJErrApplicationException("substitute_var(::TVar,dt::ASTBase,t::ASTBase) " * 
  "shouldn't be called (t == $(t))"))
end

#----------------------------------------- Implementation

substitute_var(v :: TVar, dt :: ASTBase, t :: PrimitiveSimpleType) :: PrimitiveSimpleType = t

substitute_var(v :: TVar, dt :: ASTBase, t :: TUnion) :: TUnion =
  TUnion(map(te -> substitute_var(v, dt, te), t.ts))

substitute_var(v :: TVar, dt :: ASTBase, t :: TTuple) :: TTuple =
  TTuple(map(te -> substitute_var(v, dt, te), t.ts))

substitute_var(v :: TVar, dt :: ASTBase, t :: TVar) :: ASTBase =
  t == v ? dt : t

# JB NOTE: we do not substitute anything in invariant constructors
substitute_var(v :: TVar, dt :: ASTBase, t :: TApp) :: TApp = t

substitute_var(v :: TVar, dt :: ASTBase, t :: TUnionAll) :: TUnionAll = t

# JB NOTE: same as TApp
substitute_var(v :: TVar, dt :: ASTBase, t :: TType) :: TType = t

function substitute_var(v :: TVar, dt :: ASTBase, t :: TWhere) :: TWhere
  # TODO: seems that we shouldn't substitute in bounds lb/ub
  tt = t.t
  if t.tvar != v
    tt = substitute_var(v, dt, tt)
  end
  TWhere(tt, t.tvar, t.lb, t.ub, t.diag)
end

end # module LJ_UpperBound
