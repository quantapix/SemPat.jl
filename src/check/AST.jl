# convenient type aliases
const TVarSym = Symbol # type parameters
const TNameSym = Symbol # names of types
const TAttrSym = Symbol

##### LambdaJulia's definition of types mirrored by the ASTBase's hierarchy
abstract type ASTBase end

struct TAny <: ASTBase end

struct TUnion <: ASTBase
    # ts is always normalised eg simplify_union(ts) = ts
    ts::Vector{ASTBase}
end

EmptyUnion = TUnion([])

struct TVar <: ASTBase
    sym::TVarSym
end

struct TApp <: ASTBase
    t::ASTBase
    ts::Vector{ASTBase}
end

struct TWhere <: ASTBase
    t::ASTBase
    tvar::TVar
    lb::ASTBase # lower bound
    ub::ASTBase # upper bound
    diag::Bool    # type var is diagonal # ROSSEXP
end

TWhere(t,ts) = TWhere(t, ts, EmptyUnion, TAny(), false) # ROSSEXP
TWhere(t,ts, diag) = TWhere(t, ts, EmptyUnion, TAny(), diag) # ROSSEXP
TWhere(t,ts,lb,ub) = TWhere(t, ts, lb, ub, false)

struct TTuple <: ASTBase
    ts::Vector{ASTBase}
end
struct TName <: ASTBase
    name::TNameSym
    qual::String
end
TName(name::Symbol) = TName(name, "")
TName(name::String) = TName(Symbol(name))
TName(name::String, qual::String) = TName(Symbol(name), qual)

struct TDataType <: ASTBase end
struct TUnionAll <: ASTBase
    t::ASTBase
end
struct TSuperUnion <: ASTBase end
struct TType <: ASTBase
    t::ASTBase
end
struct TSuperTuple <: ASTBase end
struct TValue <: ASTBase
    v::String
end

# ----------------------------------------- LJ Type Declaration

abstract type Attribute end
struct Abstract <: Attribute end
struct Concrete <: Attribute end
struct ConcreteImmutable <: Attribute end

const LjTyVar = Tuple{ASTBase,TVarSym,ASTBase}
const TyParams = Vector{LjTyVar}

struct TyDecl
    name::TNameSym
    qual::String
    params::TyParams
    super::ASTBase
    attr::Attribute
end

const TyDeclCol = Dict{String,TyDecl}

# ----------------------------------------- Equality

import Base.==

function ==(t1::TUnion, t2::TUnion)
    t1.ts == t2.ts
end

function ==(t1::TApp, t2::TApp)
    t1.t == t2.t && t1.ts == t2.ts
end

function ==(t1::TVar, t2::TVar)
    t1.sym == t2.sym
end

function ==(t1::TWhere, t2::TWhere)
    t1.t == t2.t && t1.tvar == t2.tvar &&
    t1.lb == t2.lb && t1.ub == t2.ub &&
    t1.diag == t2.diag # ROSSEXP
end

function ==(t1::TTuple, t2::TTuple)
    t1.ts == t2.ts
end

function skip_pre_dot(s::String)
    if contains(s, ".")
        return (true, s[searchindex(s, ".") + 1:end])
    else
        return (false, "")
    end
end

function search_left_dot(t1::TName, t2::TName)
    (f, s1) = skip_pre_dot(string(t1.name))
    if f
        return Symbol(s1) == t2.name || search_left_dot(TName(Symbol(s1)), t2)
    else
        return false
    end
end

function search_right_dot(t1::TName, t2::TName)
    (f, s2) = skip_pre_dot(string(t2.name))
    if f
        return t1.name == Symbol(s2) || search_right_dot(t1, TName(Symbol(s2)))
    else
        return false
    end
end

function ==(t1::TName, t2::TName)
#=  if t1.name == t2.name
    return true
  else
    return search_left_dot(t1,t2) || search_right_dot(t1,t2)
  end =#
  # Base.Int should be == Int, but Profile.Tree.Node != Tree.Node
    t1.name == t2.name && (t1.qual == t2.qual || t1.qual == "" || t2.qual == "")
  # && (endswith(t1.qual, t2.qual) || endswith(t2.qual, t1.qual))
end

function ==(t1::TUnionAll, t2::TUnionAll)
  # t1.t == t2.t
    true
end

function ==(t1::TType, t2::TType)
    t1.t == t2.t
end

function ==(t1::TSuperTuple, t2::TSuperTuple)
    true
end

function ==(t1::TValue, t2::TValue)
    t1.v == t2.v
end

function ==(t1::TyDecl, t2::TyDecl)
    "$(t1.name)" == "$(t2.name)"
end

import Base.hash

hash(td::TyDecl, h::UInt64) = hash("$(td.name)", h)

# ----------------------------------------- Pretty printing

function print_collection(io::IO, xs::Vector, pre_label::String, post_label::String)
    if Core.isdefined(:lj_newlines) && lj_newlines
        println(io, pre_label)
        i = 1
        for f in xs
            println(io, "[$(i)]  ", f)
            i += 1
        end
        print(io, post_label)
    else
        print(io, pre_label, xs, post_label)
    end
end

import Base.show

function show(io::IO, t::TAny)
    print(io, "Any")
end

function show(io::IO, t::TUnion)
    print_collection(io, t.ts, "Union{", "}")
end

function show(io::IO, ts::Vector{ASTBase})
    if length(ts) >= 2
        map(t -> print(io, t, ", "), ts[1:end - 1])
    end
    if length(ts) >= 1
        print(io, ts[end])
    end
end

function show(io::IO, t::TApp)
    print(io, t.t, "{", t.ts, "}")
end

function show(io::IO, t::TVar)
    print(io, t.sym)
end

function show(io::IO, t::TWhere)
    print(io, t.t)
    print(io, " where ")
    if t.ub != TAny()
        if t.lb != EmptyUnion
            if isa(t.lb, TWhere) 
                print(io, "(", t.lb, ")")
            else
                print(io, t.lb)
            end
            print(io, lj_showtype_xmlmode ? " &lt;: " : " <: ")
        end
        if t.diag print(io, "*") end  # diagonality marker # ROSSEXP
        print(io, t.tvar)
        print(io, lj_showtype_xmlmode ? " &lt;: " : " <: ")
        if isa(t.ub, TWhere) 
            print(io, "(", t.ub, ")")
        else
            print(io, t.ub)
        end
    else
        if t.diag print(io, "*") end  # diagonality marker # ROSSEXP
        print(io, t.tvar)
        if t.lb != EmptyUnion
            print(io, lj_showtype_xmlmode ? " &gt;: " : " >: ")
            if isa(t.lb, TWhere) 
                print(io, "(", t.lb, ")")
            else
                print(io, t.lb)
            end
        end
    end
end

function show(io::IO, t::TTuple)
    print_collection(io, t.ts, "Tuple{", "}")
end

function show(io::IO, t::TName)
  # print(io, replace(String(t.name),"HHHH","#"))
    print(io, t.qual, isempty(t.qual) ? "" : "::", t.name)
end

function show(io::IO, t::TDataType)
    print(io, "DataType")
end

function show(io::IO, t::TUnionAll)
    print(io, "UnionAll")
end

function show(io::IO, t::TSuperUnion)
    print(io, "Union")
end

function show(io::IO, t::TType)
    print(io, "Type{", t.t, "}")
end

function show(io::IO, t::TSuperTuple)
    print(io, "Tuple")
end

function show(io::IO, t::TValue)
    print(io, t.v)
end

# function show(io::IO, td::TyDecl)
#    TO BE DONE
# end


##### free variables

function free_variables(t::ASTBase)
  # covers TAny, TName, TDataType, TSuperUnion
    return Vector{TVarSym}()
end

function free_variables(t::TUnion)
    return lj_flatten(vcat(map(ts1 -> free_variables(ts1), t.ts)))
end

function free_variables(t::TApp)
    return lj_flatten(vcat(free_variables(t.t), map(ts1 -> free_variables(ts1), t.ts)))
end

function free_variables(t::TVar)
    return [t.sym]
end

function free_variables(t::TWhere)
    return lj_flatten(vcat(Base.filter(v -> v != t.tvar.sym, free_variables(t.t)),
                 free_variables(t.lb), free_variables(t.ub)))
end

function free_variables(t::TTuple)
    return lj_flatten(vcat(map(ts1 -> free_variables(ts1), t.ts)))
end

function free_variables(t::TUnionAll)
    return free_variables(t.t)
end

function free_variables(t::TType)
    return free_variables(t.t)
end

##### all variables

function all_variables(t::ASTBase)
  # covers TAny, TName, TDataType, TSuperUnion
    return Vector{TVarSym}()
end

function all_variables(t::TUnion)
    return lj_flatten(vcat(map(ts1 -> all_variables(ts1), t.ts)))
end

function all_variables(t::TApp)
    return lj_flatten(vcat(all_variables(t.t), map(ts1 -> all_variables(ts1), t.ts)))
end

function all_variables(t::TVar)
    return [t.sym]
end

function all_variables(t::TWhere)
    return lj_flatten(vcat(all_variables(t.t),
                         all_variables(t.lb), all_variables(t.ub)))
end

function all_variables(t::TTuple)
    return lj_flatten(vcat(map(ts1 -> all_variables(ts1), t.ts)))
end

function all_variables(t::TUnionAll)
    return all_variables(t.t)
end

function all_variables(t::TType)
    return all_variables(t.t)
end


##### IsKind

# is_kind
function is_kind(t::ASTBase)
    isa(t, TDataType) || isa(t, TSuperUnion) || isa(t, TUnionAll) || 
  t == TName("TypeofBottom", "Core")
end

##### Renaming

function rename(t::ASTBase, on::TVar, nn::TVar)
    return substitute(t, on, nn)
end

##### Substitution

function substitute(t::ASTBase, on::TVar, t1::ASTBase)
    @assert any(tbase -> isa(t, tbase), 
              [TAny, TName, TDataType, TSuperUnion, TSuperTuple, TValue])
    return t
end

function substitute(t::TUnion, on::TVar, t1::ASTBase) # including TUnion([]) ~= TBottom
    return TUnion(map(ts1 -> substitute(ts1, on, t1), t.ts))
end

function substitute(t::TApp, on::TVar, t1::ASTBase)
    return TApp(substitute(t.t, on, t1),  map(ts1 -> substitute(ts1, on, t1), t.ts))
end

function substitute(t::TVar, on::TVar, t1::ASTBase)
    if t.sym == on.sym
        return t1
    else
        return t
    end
end

function substitute(t::TWhere, on::TVar, t1::ASTBase)
    if t.tvar.sym == on.sym
        return TWhere(t.t, t.tvar, substitute(t.lb, on, t1), substitute(t.ub, on, t1))
    end
    return TWhere(substitute(t.t, on, t1),
                t.tvar, substitute(t.lb, on, t1), substitute(t.ub, on, t1))
end

function substitute(t::TTuple, on::TVar, t1::ASTBase)
    return TTuple(map(ts1 -> substitute(ts1, on, t1), t.ts))
end

function substitute(t::TUnionAll, on::TVar, t1::ASTBase)
    return TUnionAll(substitute(t.t, on, t1))
end

function substitute(t::TType, on::TVar, t1::ASTBase)
    return TType(substitute(t.t, on, t1))
end

#######  Beta reduction

betared(t::Union{TName,TAny,TDataType,TUnionAll,TSuperUnion,TSuperTuple,TValue,TVar}) = t

betared(t::Union{TUnion,TTuple}) = typeof(t)(map(betared, t.ts))

betared(t::TType) = TType(betared(t.t))

betared(t::TWhere) = TWhere(betared(t.t), t.tvar, t.lb, t.ub)

function betared(t::TApp)
    if length(t.ts) == 0
        return betared(t.t)
    elseif isa(t.t, TWhere)
        tnew = substitute(t.t.t, t.t.tvar, t.ts[1])
        return betared(TApp(tnew, t.ts[2:end]))
    else
        return TApp(betared(t.t), map(betared, t.ts))
    end
end

