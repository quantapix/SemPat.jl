const TVarSym = Symbol
const TNameSym = Symbol
const TAttrSym = Symbol

abstract type ASTBase end

struct TAny <: ASTBase end

struct TUnion <: ASTBase
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
    diag::Bool
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

import Base.==

==(t1::TUnion, t2::TUnion) = t1.ts == t2.ts
==(t1::TApp, t2::TApp) = t1.t == t2.t && t1.ts == t2.ts
==(t1::TVar, t2::TVar) = t1.sym == t2.sym

function ==(t1::TWhere, t2::TWhere)
    t1.t == t2.t && t1.tvar == t2.tvar &&
    t1.lb == t2.lb && t1.ub == t2.ub &&
    t1.diag == t2.diag # ROSSEXP
end

==(t1::TTuple, t2::TTuple) = t1.ts == t2.ts

skip_pre_dot(s::String) = contains(s, ".") ? (true, s[searchindex(s, ".") + 1:end]) : (false, "")

function search_left_dot(t1::TName, t2::TName)
    (f, s1) = skip_pre_dot(string(t1.name))
    f ? Symbol(s1) == t2.name || search_left_dot(TName(Symbol(s1)), t2) : false
end

function search_right_dot(t1::TName, t2::TName)
    (f, s2) = skip_pre_dot(string(t2.name))
    f ? t1.name == Symbol(s2) || search_right_dot(t1, TName(Symbol(s2))) : false
end

==(t1::TName, t2::TName) = t1.name == t2.name && (t1.qual == t2.qual || t1.qual == "" || t2.qual == "")
==(t1::TUnionAll, t2::TUnionAll) = true
==(t1::TType, t2::TType) = t1.t == t2.t
==(t1::TSuperTuple, t2::TSuperTuple) = true
==(t1::TValue, t2::TValue) = t1.v == t2.v
==(t1::TyDecl, t2::TyDecl) = "$(t1.name)" == "$(t2.name)"

import Base.hash

hash(td::TyDecl, h::UInt64) = hash("$(td.name)", h)

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

show(io::IO, ::TAny) = print(io, "Any")
show(io::IO, t::TUnion) = print_collection(io, t.ts, "Union{", "}")

function show(io::IO, ts::Vector{ASTBase})
    if length(ts) >= 2; map(t -> print(io, t, ", "), ts[1:end - 1])
    end
    if length(ts) >= 1; print(io, ts[end])
    end
end

show(io::IO, t::TApp) = print(io, t.t, "{", t.ts, "}")
show(io::IO, t::TVar) = print(io, t.sym)

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

show(io::IO, t::TTuple) = print_collection(io, t.ts, "Tuple{", "}")
show(io::IO, t::TName) = print(io, t.qual, isempty(t.qual) ? "" : "::", t.name)
show(io::IO, ::TDataType) = print(io, "DataType")
show(io::IO, ::TUnionAll) = print(io, "UnionAll")
show(io::IO, ::TSuperUnion) = print(io, "Union")
show(io::IO, t::TType) = print(io, "Type{", t.t, "}")
show(io::IO, ::TSuperTuple) = print(io, "Tuple")
show(io::IO, t::TValue) = print(io, t.v)

free_variables(t::ASTBase) = Vector{TVarSym}()
free_variables(t::TUnion) = lj_flatten(vcat(map(ts1 -> free_variables(ts1), t.ts)))
free_variables(t::TApp) = lj_flatten(vcat(free_variables(t.t), map(ts1 -> free_variables(ts1), t.ts)))
free_variables(t::TVar) = [t.sym]
free_variables(t::TWhere) = lj_flatten(vcat(Base.filter(v -> v != t.tvar.sym, free_variables(t.t)), free_variables(t.lb), free_variables(t.ub)))
free_variables(t::TTuple) = lj_flatten(vcat(map(ts1 -> free_variables(ts1), t.ts)))
free_variables(t::TUnionAll) = free_variables(t.t)
free_variables(t::TType) = free_variables(t.t)

all_variables(t::ASTBase) = Vector{TVarSym}()
all_variables(t::TUnion) = lj_flatten(vcat(map(ts1 -> all_variables(ts1), t.ts)))
all_variables(t::TApp) = lj_flatten(vcat(all_variables(t.t), map(ts1 -> all_variables(ts1), t.ts)))
all_variables(t::TVar) = [t.sym]
all_variables(t::TWhere) = lj_flatten(vcat(all_variables(t.t), all_variables(t.lb), all_variables(t.ub)))
all_variables(t::TTuple) = lj_flatten(vcat(map(ts1 -> all_variables(ts1), t.ts)))
all_variables(t::TUnionAll) = all_variables(t.t)
all_variables(t::TType) = all_variables(t.t)

is_kind(t::ASTBase) = isa(t, TDataType) || isa(t, TSuperUnion) || isa(t, TUnionAll) || t == TName("TypeofBottom", "Core")

rename(t::ASTBase, on::TVar, nn::TVar) = substitute(t, on, nn)

function substitute(t::ASTBase, ::TVar, ::ASTBase)
    @assert any(tbase -> isa(t, tbase), [TAny, TName, TDataType, TSuperUnion, TSuperTuple, TValue])
    return t
end
substitute(t::TUnion, on::TVar, t1::ASTBase) = TUnion(map(ts1 -> substitute(ts1, on, t1), t.ts))
substitute(t::TApp, on::TVar, t1::ASTBase) = TApp(substitute(t.t, on, t1),  map(ts1 -> substitute(ts1, on, t1), t.ts))
substitute(t::TVar, on::TVar, t1::ASTBase) = t.sym == on.sym ? t1 : t
substitute(t::TTuple, on::TVar, t1::ASTBase) = TTuple(map(ts1 -> substitute(ts1, on, t1), t.ts))
substitute(t::TUnionAll, on::TVar, t1::ASTBase) = TUnionAll(substitute(t.t, on, t1))
substitute(t::TType, on::TVar, t1::ASTBase) = TType(substitute(t.t, on, t1))
function substitute(t::TWhere, on::TVar, t1::ASTBase)
    if t.tvar.sym == on.sym; return TWhere(t.t, t.tvar, substitute(t.lb, on, t1), substitute(t.ub, on, t1))
    end
    TWhere(substitute(t.t, on, t1), t.tvar, substitute(t.lb, on, t1), substitute(t.ub, on, t1))
end

betared(t::Union{TName,TAny,TDataType,TUnionAll,TSuperUnion,TSuperTuple,TValue,TVar}) = t
betared(t::Union{TUnion,TTuple}) = typeof(t)(map(betared, t.ts))
betared(t::TType) = TType(betared(t.t))
betared(t::TWhere) = TWhere(betared(t.t), t.tvar, t.lb, t.ub)
function betared(t::TApp)
    if length(t.ts) == 0; return betared(t.t)
    elseif isa(t.t, TWhere)
        tnew = substitute(t.t.t, t.t.tvar, t.ts[1])
        return betared(TApp(tnew, t.ts[2:end]))
    end
    TApp(betared(t.t), map(betared, t.ts))
end

