################################################################################
### Diagonal rule detection for Normalized Lambda-Julia types
### ----------------------------------------------------------------------------
### 
### NOTE. To be included after [normal-form.jl] and [types-aux.jl]
################################################################################

# Uncomment includes below to get better support from an editor
#=
include("../syntax/AST.jl")
include("../errors.jl")
using DataStructures
# =#

module LJ_Diagonality

using ..lj:
      # ../syntax/AST.jl
      ASTBase, TAny, TUnion, TVar, TApp, TWhere, TTuple, TName,
      TDataType, TUnionAll, TSuperUnion, TType, TSuperTuple, TValue,
      TyDeclCol,
      print_collection,
    # ../aux/migration_aux.jl
      is_notfound_marker,
    # ../errors.jl
      LJErrApplicationException

export mark_diagonal_vars

import Base.copy

## To detect diagonality, we use the relation
##     Gamma |- nt -| M ~ nt'
## For more on this, check out [notes/alt-lj-subtype/jl-type-diagonal.md]

######################################################## Aux

#----------------------------------------- Environment

## Marker of a type variable position in the environment
## (undefined, covariant, invariant).
## Note. Order is important!
@enum TyVarMarker TVM_Undef TVM_Cov TVM_Inv

## Type of environment Gamma in diagonality relation:
##     dictionary Var -> Vector{TyVarMarker}
## ([Vector] is used in case if there are several variables with the same name)
DiagEnv = Dict{Symbol, Vector{TyVarMarker}}

## Deep copy of environment
function copy(gamma :: DiagEnv) :: DiagEnv
    gamma_new = DiagEnv()
    for v in keys(gamma)
        gamma_new[v] = TyVarMarker[]
        for m in gamma[v]
            push!(gamma_new[v], m)
        end
    end
    gamma_new
end

## Adds a new variable into [gamma] with [undef] marker
function diagenv_add!(gamma :: DiagEnv, v :: Symbol)
    if !haskey(gamma, v)
        gamma[v] = TyVarMarker[]
    end
    push!(gamma[v], TVM_Undef)
end

## Removes a variable from [gamma]
function diagenv_remove!(gamma :: DiagEnv, v :: Symbol) :: Bool
    if !haskey(gamma, v)
        return false
    end
    if length(gamma[v]) > 0
        pop!(gamma[v])
        true
    else
        false
    end
end

## Returns true if a variable is in [gamma]
diagenv_in(gamma :: DiagEnv, v :: Symbol) :: Bool =
    haskey(gamma, v) && length(gamma[v]) > 0

## Returns marker of a variable
diagenv_get(gamma :: DiagEnv, v :: Symbol) :: TyVarMarker =
    gamma[v][end]

## Marks variables with weaker markers as having marker `m`:
## undef vars can be marked with both covariant and invariant markers,
## covariant vars can be remarked as invariant,
## invariant vars cannot be remarked.
function diagenv_mark!(gamma :: DiagEnv, m :: TyVarMarker) :: DiagEnv
    for (v, ms) in gamma
      for i in 1:length(ms)
        if ms[i] < m
            ms[i] = m
        end
      end
    end
    gamma
end

#----------------------------------------- Occurrence Info

## Pair of counters (covariant, invariant)
OccurInfo = Tuple{Int,Int}

## Dictionary of occurrence information 
OccurInfoDict = Dict{Symbol, OccurInfo}

occinfo_get(occinfo :: OccurInfoDict, v :: Symbol) :: OccurInfo =
    haskey(occinfo, v) ? occinfo[v] : (0,0)

## Merges occurrence info about all variables across [ois]
function occinfo_merge(ois :: Vector{OccurInfoDict}) :: OccurInfoDict
    occinfo = OccurInfoDict()
    for oi in ois
      for (v, (c, i)) in oi
        (c_tot, i_tot) = (0, 0)
        if haskey(occinfo, v)
            (c_tot, i_tot) = occinfo[v]
        end
        occinfo[v] = (c_tot + c, i_tot + i)
      end
    end
    occinfo
end

## Joins occurrence info about all variables across [ois]
## (takes max occurrence infos)
function occinfo_join(ois :: Vector{OccurInfoDict}) :: OccurInfoDict
    occinfo = OccurInfoDict()
    for oi in ois
      for (v, (c, i)) in oi
        (c_tot, i_tot) = (0, 0)
        if haskey(occinfo, v)
            (c_tot, i_tot) = occinfo[v]
        end
        occinfo[v] = (max(c_tot, c), max(i_tot,i))
      end
    end
    occinfo
end

#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ Occurence based function

## Takes normalized LJ type and marks diagonal variables in where-types
mark_diagonal_vars(t :: ASTBase) :: ASTBase =
    mark_diag(DiagEnv(), t)[2]

## Output of diagonality relation
DiagResult = Tuple{OccurInfoDict, ASTBase}

function mark_diag(gamma :: DiagEnv, t :: ASTBase) :: DiagResult
    throw(LJErrApplicationException("mark_diag(:: DiagEnv, t::NTNormalTy) " * 
    "shouldn't be called (t == $(t))"))
end

######################################################## Simple Types

#----------------------------------------- Trivia

TTrivialType = Union{TAny, TName, 
    TDataType, TSuperUnion, TSuperTuple, TValue}

mark_diag(gamma :: DiagEnv, t :: TTrivialType) :: DiagResult =
    (OccurInfoDict(), t)

# TODO: what should be done with t.t?
mark_diag(gamma :: DiagEnv, t :: TUnionAll) :: DiagResult =
    let (occinfo, tt) = mark_diag(gamma, t.t)
    (occinfo, TUnionAll(tt))
    end

#----------------------------------------- Type Variable

function mark_diag(gamma :: DiagEnv, t :: TVar) :: DiagResult
    @assert diagenv_in(gamma, t.sym) "mark_diag(::DiagEnv, ::TVar): t.sym must be in gamma"
    v = t.sym
    m = diagenv_get(gamma, v)
    # we consider T in [Tuple{T} where T] as covariant,
    # while T in [where U<:T where T] neutral
    occ = (m == TVM_Inv) ? 
            (0, 1) : 
            ((m == TVM_Cov) ? (1, 0) : (0, 0))
    occinfo = OccurInfoDict(v => occ)
    (occinfo, t)
end

#----------------------------------------- Tuple

function mark_diag(gamma :: DiagEnv, t :: TTuple) :: DiagResult
    results = DiagResult[]
    # create copy of gamma and mark it covariant
    gamma_cov = copy(gamma)
    diagenv_mark!(gamma_cov, TVM_Cov)
    # run diagonality marking on elements of the tuple
    for te :: ASTBase in t.ts
        dr :: DiagResult = mark_diag(gamma_cov, te)
        push!(results, dr)
    end
    # merge occinfos
    occinfo = occinfo_merge(map(r -> r[1], results))
    # build result tuple
    t_new = TTuple(map(r -> r[2], results))
    (occinfo, t_new)
end

#----------------------------------------- Name Application

## Expects [t] to be name{t1, ..., tn}
function mark_diag(gamma :: DiagEnv, t :: TApp) :: DiagResult
    @assert isa(t.t, TName) "mark_diag(::DiagEnv, ::TApp): t.t must be name"
    results = DiagResult[]
    # create copy of gamma and mark it invariant
    gamma_inv = copy(gamma)
    diagenv_mark!(gamma_inv, TVM_Inv)
    # run diagonality marking on elements of the application
    for te :: ASTBase in t.ts
        dr :: DiagResult = mark_diag(gamma_inv, te)
        push!(results, dr)
    end
    # merge occinfos
    occinfo = occinfo_merge(map(r -> r[1], results))
    # build result type
    t_new = TApp(t.t, map(r -> r[2], results))
    (occinfo, t_new)
end

#----------------------------------------- Type{t}

function mark_diag(gamma :: DiagEnv, t :: TType) :: DiagResult
    # create copy of gamma and mark it invariant
    gamma_inv = copy(gamma)
    diagenv_mark!(gamma_inv, TVM_Inv)
    # run diagonality on inside type
    (occinfo, tt_new) = mark_diag(gamma_inv, t.t)
    (occinfo, TType(tt_new))
end

######################################################## Where-Type

## TODO: it is not clear whether we should take into account all occurences
## of variables or only those not in bounds.
## E.g. in   Tuple{T,T, S,S} where T>:Vector{S} where S
## should S be diagonal or not?

## Here we ignore bounds on type variables
## and determine diagonality based completely on their positions
function mark_diag(gamma :: DiagEnv, t :: TWhere) :: DiagResult
    # run diagonality on bounds
    (lb_oi, lb_new) = mark_diag(gamma, t.lb)
    (ub_oi, ub_new) = mark_diag(gamma, t.ub)
    # create copy of gamma and add new type variable in it
    gamma_new = copy(gamma)
    v = t.tvar.sym
    diagenv_add!(gamma_new, v)
    # run diagonality on the underlying type
    (tt_oi, tt_new) = mark_diag(gamma_new, t.t)
    # choose concreteness based on the counters
    (c, i) = occinfo_get(tt_oi, v)
    concrete :: Bool = c > 1 && i == 0
    # join occinfos but remove info about [v] for it's been discharged
    if haskey(tt_oi, v)
        pop!(tt_oi, v)
    end
    occinfo = occinfo_join([lb_oi, ub_oi, tt_oi])
    (occinfo, TWhere(tt_new, t.tvar, lb_new, ub_new, concrete))
end

######################################################## Union Type

function mark_diag(gamma :: DiagEnv, t :: TUnion) :: DiagResult
    # Union{}, which is Bottom, is a special case 
    if length(t.ts) == 0
        return (OccurInfoDict(), t)
    end
    # simply run diagonality on subtypes and merge occinfos
    results = map(te -> mark_diag(gamma, te), t.ts)
    ois = map(r -> r[1], results)
    ts  = map(r -> r[2], results)
    occinfo = occinfo_merge(ois)
    (occinfo, TUnion(ts))
end

end # module LJ_Diagonality
