################################################################################
### Normal Form for Lambda-Julia types
### ----------------------------------------------------------------------------
### 
### NOTE. To be included after [AST.jl] and [errors.jl]
################################################################################

# Uncomment includes below to get better support from an editor 
#=
include("../syntax/AST.jl")
include("../errors.jl")
include("../aux/aux.jl")
using DataStructures
# =#

module LJ_NormalForm

using ..lj:
      # ../syntax/AST.jl
        ASTBase, TAny, TUnion, EmptyUnion, TVar, TApp, TWhere, TTuple, TName,
        TDataType, TUnionAll, TSuperUnion, TType, TSuperTuple, TValue,
        print_collection,
      # ../aux/migration_aux.jl
        is_notfound_marker,
      # ../errors.jl
        LJErrApplicationException

using DataStructures

export lj_normalize_type, lj_fold_union_tuple, lj_make_vars_unique

import Base.==
import Base.show
import Base.isless

# to convert Tuple{Union{}} into Union{}
PULL_BOTTOM = true
# to keep where inside Tuple if Union{} is inside
WHERE_IN_TUPLE = false

@assert xor(PULL_BOTTOM, WHERE_IN_TUPLE) "Inconsistent normalization settings about Union{}"

## auxiliary functions
include("aux_nf.jl")

#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ Conversion into NF

# to generate new variable names and keep track of already used ones
# we will maintain a dictionary with base parts of names,
# e.g. base(T111) == base(T3) == base(T) == T

## Takes LJ AST and returns corresponding normalized type
lj_normalize_type(t :: ASTBase) :: ASTBase =
    lj_normalize_type(t, UsedVarsDict())

## Takes LJ AST, a list of reserved variable names,
## and returns corresponding normalized type
function lj_normalize_type(t :: ASTBase, used_vars :: UsedVarsDict) ::
         ASTBase
    throw(LJErrApplicationException("lj_normalize_type(t::ASTBase,::UsedVarsDict) " * 
    "shouldn't be called (t == $(t))"))
end

######################################################## Trivia

## Simple cases are covered by return the same value
lj_normalize_type(t :: PrimitiveSimpleType, used_vars :: UsedVarsDict) ::
    PrimitiveSimpleType = t

lj_normalize_type(t :: TVar, used_vars :: UsedVarsDict) :: TVar = t

lj_normalize_type(t :: TUnionAll, used_vars :: UsedVarsDict) :: TUnionAll =
    TUnionAll(lj_normalize_type(t.t, used_vars))

lj_normalize_type(t :: TType, used_vars :: UsedVarsDict) :: TType =
    TType(lj_normalize_type(t.t, used_vars))

######################################################## TApp

## name{t1, ..., tn} ==> name{nt1, ..., ntn}
function lj_normalize_type(t :: TApp, used_vars :: UsedVarsDict) :: TApp
    nt = lj_normalize_type(t.t, used_vars)
    if !isa(nt, TName)
        throw(LJErrApplicationException("lj_normalize_type(t::TApp): " *
              "expected t == name{t1,..tn}, got $(t)"))
    end
    nts :: Vector{ASTBase} = map(t -> lj_normalize_type(t, used_vars), t.ts)
    TApp(nt, nts)
end

######################################################## Union

function lj_normalize_type(t :: TUnion, used_vars :: UsedVarsDict) :: ASTBase
    n = length(t.ts)
    # TUnion{} represents Bottom
    if n == 0
        return t
    elseif n == 1
        return lj_normalize_type(t.ts[1], used_vars)
    end
    # t.ts containts at least 2 elements
    nts :: Vector{ASTBase} = map(t -> lj_normalize_type(t, used_vars), t.ts)
    nts_s :: Vector{Vector{ASTBase}} = map(flatten_union, nts)
    TUnion(vcat(nts_s...))
end

######################################################## Where

## (v, lb, ub)
TVarBoundInfo = Tuple{TVar, ASTBase, ASTBase}

function lj_normalize_type(t :: TWhere, used_vars :: UsedVarsDict) :: ASTBase
    v = t.tvar.sym
    varname_add!(string(v), used_vars)
    nt_body = lj_normalize_type(t.t, used_vars)
    ntv = TVar(v)
    nlb = lj_normalize_type(t.lb, used_vars)
    nub = lj_normalize_type(t.ub, used_vars)
    varname_remove!(string(v), used_vars)
    # if nt_body is a union, we need to move [where] inside a union
    if isa(nt_body, TUnion)
        move_where_in_union(nt_body, (ntv, nlb, nub))
    # otherwise it is a valid where-type, and we just add a bound
    else 
        TWhere(nt_body, ntv, nlb, nub)
    end
end

## Puts a bound into every element of the union
move_where_in_union(tu :: TUnion, bound :: TVarBoundInfo) :: TUnion =
    TUnion(map(t -> move_where_in_union(t, bound), tu.ts))

function move_where_in_union(wt :: ASTBase, bound :: TVarBoundInfo) :: ASTBase
    (tv, lb, ub) = bound
    # we only add where-bound if it is needed
    if occurs_free(tv, wt)
        TWhere(wt, tv, lb, ub)
    else
        wt
    end
end

######################################################## Tuple

function lj_normalize_type(t :: TTuple, used_vars :: UsedVarsDict) :: ASTBase
    n = length(t.ts)
    # special case for simplicity
    if n == 0
        return t
    end
    sts = ASTBase[]
    # now we have to process elements of the tuple
    nts :: Vector{ASTBase} = map(t -> lj_normalize_type(t, used_vars), t.ts)
    # we pull up unions first
    v_wts :: Vector{Vector{ASTBase}} = pull_up_union(nts)
    # and now we have to pull up where-types from each vector of types
    wtuples = ASTBase[]
    for wtsi in v_wts
        if !WHERE_IN_TUPLE || all(tt -> tt != EmptyUnion, wtsi)
          (sts, bounds) = # Vector{ASTBase}, Vector{TVarBoundInfo}}
            pull_up_where(wtsi, used_vars)
        else
          (sts, bounds) = (wtsi, TVarBoundInfo[])
        end
        tuple = TTuple(sts)
        wti = tuple
        for (tv, lb, ub) in bounds
            wti = TWhere(wti, tv, lb, ub)
            varname_remove!(string(tv.sym), used_vars)
        end
        push!(wtuples, wti)
    end
    # if we got just one tuple with wheres, we return it
    if length(wtuples) == 1
        wtuples[1]
    # otherwise we make a union
    else
        TUnion(wtuples)
    end
end

#----------------------------------------- Pull up Where

## Takes a vector of where types [wts] corresponding to [Tuple{wts}]
## and pulls up where-bounds from [wts],
## returning a pair [(sts, bounds)],
## where [sts] is a vector of simple types inside [wts],
## and [bounds] are all pulled-out bounds, possibly renamed.
## E.g. [Vector{T} where T, Ref{T} where T] => ([Vector{T}, Ref{T1}], [T,T1])
function pull_up_where(wts :: Vector{ASTBase}, used_vars :: UsedVarsDict) ::
         Tuple{Vector{ASTBase}, Vector{TVarBoundInfo}}
    sts = ASTBase[]
    bounds = TVarBoundInfo[]
    for wti in wts
        (sti, bsi) = extract_where(wti)
        (sti, bsi) = freshen_wheres!(sti, bsi, used_vars)
        push!(sts, sti)
        bounds = vcat(bounds, reverse(bsi))
    end
    (sts, bounds)
end

## Takes simple type [st] together with where-bounds [bounds]
## and renames bound variables if necessary
function freshen_wheres!(st :: ASTBase, bounds :: Vector{TVarBoundInfo},
                         used_vars :: UsedVarsDict) ::
                         Tuple{ASTBase, Vector{TVarBoundInfo}}
    n = length(bounds)
    for i in 1:n
      (tv, lb, ub) = bounds[i]
      v = tv.sym
      vs = string(v)
      # variable has not been used: we don't need to do anything
      if !varname_in(vs, used_vars)
        varname_add!(vs, used_vars)
      # we need to rename variable and all its ocurrences
      else
        # if v == :T, v_new = :Ti
        vs_new = varname_gen_new!(vs, used_vars)
        varname_add!(vs_new, used_vars)
        v_new = Symbol(vs_new)
        bounds[i] = (TVar(v_new), lb, ub)
        # rename tv into tv_new everywhere further
        for j in (i+1):n
            (tvj, lbj, ubj) = bounds[j]
            bounds[j] = (rename_var(v, v_new, tvj)
                        ,rename_var(v, v_new, lbj)
                        ,rename_var(v, v_new, ubj))
        end
        st = rename_var(v, v_new, st)
      end
    end
    (st, bounds)
end

## Takes a where type [wt]
## and returns its core simple type and a vector of bounds (in reversed order),
## e.g. Vector{T} where T<:S where S<:Int =>
##      (Vector{T}, [(S,_,Int), (T,_,S)])
function extract_where(wt :: TWhere) :: Tuple{ASTBase, Vector{TVarBoundInfo}}
    bounds = TVarBoundInfo[]
    while isa(wt, TWhere)
        push!(bounds, (wt.tvar, wt.lb, wt.ub))
        wt = wt.t
    end
    (wt, bounds)
end
extract_where(st :: ASTBase) = (st, TVarBoundInfo[])

#----------------------------------------- Pull up Union

## Takes a vector of normal types [nts] corresponding to [Tuple{nts}]
## and returns a vector of vectors of where types [{wt1, wt2, ..., wtn}]
##   corresponding to [Union{Tuple{wt1}, Tuple{wt2}, ..., Tuple{wtn}}]
function pull_up_union(nts :: Vector{ASTBase}) :: Vector{Vector{ASTBase}}
    # let nts be [Union{Float,Int}, Int, Union{Bool,String}]
    v_wts :: Vector{Vector{ASTBase}} = Vector{ASTBase}[]
    for nt in nts
        push!(v_wts, flatten_union(nt))
    end
    # then v_wts is [[Float,Int], [Int], [Bool,String]],
    # and we need to convert it into [[Float,Int,Bool], [Float,Int,String],
    #   [Int,Int,Bool], [Int,Int,String]]
    ans :: Vector{Vector{ASTBase}} = Vector{ASTBase}[]
    n_tuple = length(v_wts)
    i_tuple = 0
    last_tuple = Vector{Int}(n_tuple)
    for i in 1:n_tuple 
      last_tuple[i] = 0
    end
    while i_tuple >= 0
      # all elements of the tuple are picked
      if i_tuple == n_tuple
        # write down the tuple
        push!(ans, select_elems(v_wts, last_tuple))
        i_tuple -= 1
      # there are elements of the tuple to be yet picked
      else # i < n
        i_tuple += 1
        # not all elements of v_wts[i_tuple] have been used
        if last_tuple[i_tuple] < length(v_wts[i_tuple])
            last_tuple[i_tuple] = last_tuple[i_tuple] + 1
        # all elements have been used
        else
            last_tuple[i_tuple] = 0
            i_tuple -= 2 # to return to the previous vector of elements
        end
      end
    end
    ans
end

## From vectors in [v_xs]
## picks corresponding elements with numbers from [is],
## i.e. returns the vector [v_xs[1][is[1]], v_xs[2][is[2]], ...]
function select_elems(v_xs :: Vector{Vector{T}}, is :: Vector{Int}) ::
         Vector{T} where T
  @assert (length(v_xs) == length(is)) "select_elems: expects |v_xs|==|is|"
  map(i -> v_xs[i][is[i]], 1:length(is))
end

#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ Anti-Normalization

function lj_fold_union_tuple(t :: ASTBase) :: Tuple{ASTBase, Bool}
    t1 = pull_up_where_union(t)
    t2 = fold_union_tuple(t1)
    (t2, t1 != t2)
end

# JB TODO: add environment to keep track of diagonal variables

function fold_union_tuple(t :: ASTBase) :: ASTBase
    throw(LJErrApplicationException("fold_union_tuple(t::ASTBase) " * 
    "shouldn't be called (t == $(t))"))
end

fold_union_tuple(t :: PrimitiveSimpleType) :: PrimitiveSimpleType = t

## expects a normalized type with wheres pulled outside unions
function fold_union_tuple(t :: TUnion) :: ASTBase
    # special case for Bottom
    if length(t.ts) == 0
        return t
    end
    ts = map(fold_union_tuple, t.ts)
    # first, separate non-tuple elements from tuples
    nontuples = filter(te -> !isa(te, TTuple), ts)
    # we want to go through all tuples anf fold them
    tuples = filter(te -> isa(te, TTuple), ts)
    # if no tuples, we are done
    if length(tuples) == 0
        return TUnion(ts)
    end
    # now an algorithm...
    # ad-hoc for tuples of length 1
    one_tuples :: Vector{ASTBase} = filter(tup -> length(tup.ts) == 1, tuples)
    if length(one_tuples) <= 1
        return TUnion(ts)
    end
    result_tuples :: Vector{ASTBase} = filter(tup -> length(tup.ts) != 1, tuples)
    one_tuple_elems :: Vector{ASTBase} = map(tup -> tup.ts[1], one_tuples)
    push!(result_tuples, TTuple(ASTBase[TUnion(one_tuple_elems)]))
    elems = vcat(result_tuples, nontuples)
    if length(elems) == 1
        elems[1]
    else
        TUnion(elems)
    end
    # JB TODO: algorithm for general case
    #=
    nonprocessed_tuples = length(tuples)
    # skip zero-length tuples
    zero_tuples = filter(tup -> length(tup.ts) == 0, tuples)
    result_tuples = vcat(result_tuples, zero_tuples)
    nonprocessed_tuples -= length(zero_tuples)
    one_tuples = filter(tup -> length(tup.ts) == 1, tuples)
    tuple_len = 1
    while nonprocessed_tuples > 0
        # tuples of a given length
        tuples_curr = filter(tup -> length(tup.ts) == tuple_len, tuples)
        nonprocessed_tuples -= tuples_curr
        tuple_elem = 1
    end
    =#
end

fold_union_tuple(t :: TVar) :: TVar = t

## Expects a normalized t == name{...}
fold_union_tuple(t :: TApp) :: TApp =
    TApp(t.t, map(te -> fold_union_tuple(te), t.ts))

function fold_union_tuple(t :: TWhere) :: TWhere
    lb = fold_union_tuple(t.lb)
    ub = fold_union_tuple(t.ub)
    tt = fold_union_tuple(t.t)
    TWhere(tt, t.tvar, lb, ub, t.diag)
end

fold_union_tuple(t :: TTuple) :: TTuple =
    TTuple(map(te -> fold_union_tuple(te), t.ts))

fold_union_tuple(t :: TUnionAll) :: TUnionAll =
    TUnionAll(fold_union_tuple(t.t))

fold_union_tuple(t :: TType) :: TType =
    TType(fold_union_tuple(t.t))

######################################################## Sorting ASTBase

## for now we use a stupid lexicographical sorting of strings

isless(t1 :: ASTBase, t2 :: ASTBase) = isless(string(t1), string(t2))

######################################################## Pull Where out of Union

## Expects a normalized type as an argument
## and moves where-binds outside unions
pull_up_where_union(t :: ASTBase) :: ASTBase =
    pull_up_where_union_impl(lj_make_vars_unique(t))

function pull_up_where_union_impl(t :: ASTBase) :: ASTBase
    throw(LJErrApplicationException("pull_where_union_impl(t::ASTBase) " * 
    "shouldn't be called (t == $(t))"))
end

pull_up_where_union_impl(t :: PrimitiveSimpleType) :: PrimitiveSimpleType = t

const TVarBoundInfoDiag = Tuple{TVar, ASTBase, ASTBase, Bool}

function pull_up_where_union_impl(t :: TUnion) :: ASTBase
    ts = map(pull_up_where_union_impl, t.ts)
    # take elements of the union and split them into
    # main parts and var bindings
    elems :: Vector{Tuple{ASTBase, Vector{TVarBoundInfoDiag}}} =
        map(te -> extract_where_diag(te), t.ts)
    # extract main parts and bounds
    ts = map(elem -> elem[1], elems)
    bounds = map(elem -> elem[2], elems)
    # sort main parts
    ts = sort(ts)
    # form the result type
    t :: ASTBase = TUnion(ts)
    # add bounds
    for bs in bounds
      for (v, lb, ub, diag) in bs
        t = TWhere(t, v, lb, ub, diag)
      end
    end
    t
end

pull_up_where_union_impl(t :: TVar) :: TVar = t

## Expects a normalized t == name{...}
pull_up_where_union_impl(t :: TApp) :: TApp =
    # no where can appear from inside application
    TApp(t.t, map(te -> pull_up_where_union_impl(te), t.ts))

function pull_up_where_union_impl(t :: TWhere) :: TWhere
    lb = pull_up_where_union_impl(t.lb)
    ub = pull_up_where_union_impl(t.ub)
    tt = pull_up_where_union_impl(t.t)
    TWhere(tt, t.tvar, lb, ub, t.diag)
end

pull_up_where_union_impl(t :: TTuple) :: TTuple =
    TTuple(map(te -> pull_up_where_union_impl(te), t.ts))

pull_up_where_union_impl(t :: TUnionAll) :: TUnionAll =
    TUnionAll(pull_up_where_union_impl(t.t))

pull_up_where_union_impl(t :: TType) :: TType =
    TType(pull_up_where_union_impl(t.t))

#----------------------------------------- Extract Where

function extract_where_diag(wt :: TWhere) :: 
    Tuple{ASTBase, Vector{TVarBoundInfoDiag}}
    bounds = TVarBoundInfoDiag[]
    while isa(wt, TWhere)
        push!(bounds, (wt.tvar, wt.lb, wt.ub, wt.diag))
        wt = wt.t
    end
    (wt, bounds)
end
extract_where_diag(st :: ASTBase) = (st, TVarBoundInfoDiag[])

end # module LJ_NormalForm
