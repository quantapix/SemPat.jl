################################################################################
### Aux functions for normalization of AST types
### ----------------------------------------------------------------------------
###
### NOTE. To be included into [normal-form.jl]; uses [errors.jl] and [AST.jl]
################################################################################

# Uncomment includes below to get better support from an editor
#=
include("../syntax/AST.jl")
include("../errors.jl")
using DataStructures
# =#

######################################################## Name Management

## Dictionary with information about used type variable names
const UsedVarsDict = Dict{String, Dict{String,Int}}

## Takes variable name and returns its base name
## (everything before the first digit)
function varname_base(name :: String) :: String
    i_digit = findfirst(c -> c in "0123456789", name)
    if is_notfound_marker(i_digit)
        name
    else
        name[1:i_digit-1]
    end
end

## Returns true if variable name is used
function varname_in(name :: String, used_vars :: UsedVarsDict) :: Bool
    base = varname_base(name)
    if !haskey(used_vars, base)
        return false
    end
    haskey(used_vars[base], name) && used_vars[base][name] > 0
end

## Returns variable name that is not used with the same base as in [name]
function varname_gen_new!(name :: String, used_vars :: UsedVarsDict) :: String
    base = varname_base(name)
    if !haskey(used_vars, base)
        used_vars[base] = Dict{String,Int}()
    end
    used_names = used_vars[base]
    name = base
    counter = 0
    while haskey(used_names, name)
        counter += 1
        name = base * string(counter)
    end
    name
end

function varname_add!(name :: String, used_vars :: UsedVarsDict)
    base = varname_base(name)
    if !haskey(used_vars, base)
        used_vars[base] = Dict{String,Int}()
    end
    used_names = used_vars[base]
    if !haskey(used_names, name)
        used_names[name] = 0
    end
    used_names[name] += 1
end


function varname_remove!(name :: String, used_vars :: UsedVarsDict) :: Bool
    base = varname_base(name)
    if !haskey(used_vars, base)
        return false
    end
    used_names = used_vars[base]
    if !haskey(used_names, name)
        return false
    end
    used_names[name] -= 1
    return true
end

######################################################## AST aux

PrimitiveSimpleType = Union{TAny, TName, 
    TDataType, TSuperUnion, TSuperTuple, TValue}

######################################################## Syntax Aux

## Takes [Union{t1, ..., tn}]
## and returns a vector of elements of [t1]...[tn]
function flatten_union(tu :: TUnion) :: Vector{ASTBase}
    if !PULL_BOTTOM
      if tu == EmptyUnion
        return ASTBase[tu]
      end
    end
    wts = ASTBase[]
    nts_queue = Queue(ASTBase)
    for te in tu.ts
        enqueue!(nts_queue, te)
    end
    while !isempty(nts_queue)
        # take an element from the queue
        nti :: ASTBase = dequeue!(nts_queue)
        # if it is a union, split it
        if isa(nti, TUnion) && (PULL_BOTTOM || nti != EmptyUnion)
            for te in nti.ts
                enqueue!(nts_queue, te)
            end
        # otherwise it is a good element (only union is not a where type)
        else
            push!(wts, nti)
        end
    end
    wts
end
## Takes [wt] and returns a vector of one element [{wt}]
flatten_union(wt :: ASTBase) :: Vector{ASTBase} =
    ASTBase[wt]

######################################################## Free occurrence

## Returns [true] if there are free occurrences of variable [v] in type [nt]
function occurs_free(v :: TVar, nt::ASTBase) :: Bool
    throw(LJErrApplicationException("occurs_free(.., nt::ASTBase) " *
          "should not be called (nt == $(nt))"))
end

occurs_free(v :: TVar, nt::PrimitiveSimpleType) = false

occurs_free(v :: TVar, nt::TTuple) :: Bool =
    any(st -> occurs_free(v, st), nt.ts)

# JB: TApp expected to be name{t1, ..., tn}
occurs_free(v :: TVar, nt::TApp) :: Bool =
    any(nt -> occurs_free(v, nt), nt.ts)

occurs_free(v :: TVar, nt::TVar) :: Bool = nt == v

occurs_free(v :: TVar, nt::TUnionAll) :: Bool =
    occurs_free(v, nt.t)

occurs_free(v :: TVar, nt::TType) :: Bool =
    occurs_free(v, nt.t)

occurs_free(v :: TVar, nt::TUnion) :: Bool =
    any(nt -> occurs_free(v, nt), nt.ts)

occurs_free(v :: TVar, nt::TWhere) :: Bool =
    occurs_free(v, nt.lb) || occurs_free(v, nt.ub) ||
    (nt.tvar != v && occurs_free(v, nt.t))

######################################################## Renaming

## Renames all free occurrences of variable [sv] in type [nt] into [dv]
function rename_var(sv::Symbol, dv::Symbol, nt::ASTBase) :: ASTBase
    throw(LJErrApplicationException("rename_var(.., nt::ASTBase) " *
          "should not be called (nt == $(nt))"))
end

rename_var(sv::Symbol, dv::Symbol, nt::PrimitiveSimpleType) = nt

rename_var(sv::Symbol, dv::Symbol, nt::TTuple) :: TTuple =
    TTuple(map(st -> rename_var(sv, dv, st), nt.ts))

rename_var(sv::Symbol, dv::Symbol, nt::TApp) :: TApp =
    TApp(nt.t, map(nt -> rename_var(sv, dv, nt), nt.ts))

rename_var(sv::Symbol, dv::Symbol, nt::TVar) :: TVar =
    (nt.sym == sv) ? TVar(dv) : nt

rename_var(sv::Symbol, dv::Symbol, nt::TUnionAll) :: TUnionAll =
    TUnionAll(rename_var(sv, dv, nt.t))
    
rename_var(sv::Symbol, dv::Symbol, nt::TType) :: TType =
    TType(rename_var(sv, dv, nt.t))

rename_var(sv::Symbol, dv::Symbol, nt::TUnion) :: TUnion =
    TUnion(map(wt -> rename_var(sv, dv, wt), nt.ts))

rename_var(sv::Symbol, dv::Symbol, nt::TWhere) :: TWhere =
    let lb = rename_var(sv, dv, nt.lb),
        ub = rename_var(sv, dv, nt.ub),
        t = (nt.tvar.sym == sv) ? nt.t : rename_var(sv, dv, nt.t)
      TWhere(t, nt.tvar, lb, ub, nt.diag)
    end

######################################################## Rename all vars

## mapping of variables that require renaming
const VarsMap = Dict{Symbol, Symbol}

lj_make_vars_unique(t :: ASTBase) :: ASTBase =
    make_vars_unique(t, UsedVarsDict(), VarsMap())

function make_vars_unique(t :: ASTBase, 
         used_vars :: UsedVarsDict, rn_vars :: VarsMap) :: ASTBase
    throw(LJErrApplicationException("make_vars_unique" * "
    (t::ASTBase, ::UsedVarsDict, ::VarsMap) " * 
    "shouldn't be called (t == $(t))"))
end

make_vars_unique(t :: PrimitiveSimpleType, 
    used_vars :: UsedVarsDict, rn_vars :: VarsMap) :: PrimitiveSimpleType =
    t

make_vars_unique(t :: TUnion, 
    used_vars :: UsedVarsDict, rn_vars :: VarsMap) :: TUnion =
    TUnion(map(te -> make_vars_unique(te, used_vars, rn_vars), t.ts))

make_vars_unique(t :: TVar, 
    used_vars :: UsedVarsDict, rn_vars :: VarsMap) :: TVar =
    haskey(rn_vars, t.sym) ? TVar(rn_vars[t.sym]) : t

make_vars_unique(t :: TApp, 
    used_vars :: UsedVarsDict, rn_vars :: VarsMap) :: TApp =
    TApp(make_vars_unique(t.t, used_vars, rn_vars),
         map(te -> make_vars_unique(te, used_vars, rn_vars), t.ts))

function make_vars_unique(t :: TWhere, 
         used_vars :: UsedVarsDict, rn_vars :: VarsMap) :: TWhere
    # bounds are processed in the current context
    lb = make_vars_unique(t.lb, used_vars, rn_vars)
    ub = make_vars_unique(t.ub, used_vars, rn_vars)
    # if a variable has been used, we need to generate a new name,
    # and rename uses of the variable everywhere inside
    v = t.tvar.sym
    vs = String(v)
    v_new = v
    rn_vars_new = rn_vars
    if varname_in(vs, used_vars)
        vs_new = varname_gen_new!(vs, used_vars)
        varname_add!(vs_new, used_vars)
        v_new  = Symbol(vs_new)
        rn_vars_new = copy(rn_vars)
        rn_vars_new[v] = v_new
    else
        varname_add!(vs, used_vars)
    end
    tt = make_vars_unique(t.t, used_vars, rn_vars_new)
    TWhere(tt, TVar(v_new), lb, ub, t.diag)
end

make_vars_unique(t :: TTuple, 
    used_vars :: UsedVarsDict, rn_vars :: VarsMap) :: TTuple =
    TTuple(map(te -> make_vars_unique(te, used_vars, rn_vars), t.ts))

make_vars_unique(t :: TUnionAll, 
    used_vars :: UsedVarsDict, rn_vars :: VarsMap) :: TUnionAll =
    TUnionAll(make_vars_unique(t.t, used_vars, rn_vars))

make_vars_unique(t :: TType, 
    used_vars :: UsedVarsDict, rn_vars :: VarsMap) :: TType =
    TType(make_vars_unique(t.t, used_vars, rn_vars))

