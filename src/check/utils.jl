is_concrete(t::ASTBase, tds::TyDeclCol) = false
is_concrete(t::TUnion, tds::TyDeclCol) = all(t -> isa(t, TType) && isa(lj_typeof(t.t, tds, Env([], [])), TDataType), t.ts)
is_concrete(t::Union{TVar,TDataType}, ::TyDeclCol) = true
function is_concrete(t::TApp, tds::TyDeclCol)
    if isa(t.t, TName)
        tdt = lj_lookup(t.t, tds)
        return tdt.attr != Abstract() && length(tdt.params) == length(t.ts)
    end
    false
end
function is_concrete(t::TName, tds::TyDeclCol)
    tdt = lj_lookup(t, tds)
    tdt.attr != Abstract() && length(tdt.params) == 0
end

function lift_union(t::TTuple, env::Env)
    for i in 1:length(t.ts)
        if isa(t.ts[i], TUnion) && length(t.ts[i].ts) > 0
            ts_u = ASTBase[]
            for tj in t.ts[i].ts
                ts_t = copy(t.ts)
                ts_t[i] = tj
                push!(ts_u, TTuple(ts_t))
            end
            return TUnion(ts_u)
        elseif isa(t.ts[i], TWhere)
            ua = t.ts[i]
            uav, uat = ua.tvar, ua.t
            if env_conflict(env, ua.tvar); (uav, uat) = freshen(env, ua.tvar, ua.t)
            end
            ts_t = copy(t.ts)
            ts_t[i] = uat
            return TWhere(TTuple(ts_t), uav, ua.lb, ua.ub)
        end
    end
    t
end

lift_union(t::ASTBase, ::Env) = t

function lift_union_full(t::ASTBase)
    tl = no_union(t)
    length(tl) == 1 ? tl[1] : TUnion(tl)
end

function no_union(t::ASTBase)
    lj_error(string("no_union not implemented for: ", t))
end

no_union(t::TDataType) = [t]
no_union(t::TAny) = [t]
no_union(t::TName) = [t]
no_union(t::TVar) = [t]
no_union(t::TSuperTuple) = [t]
no_union(t::TUnionAll) = [t]
no_union(t::TSuperUnion) = [t]
no_union(t::TType) = [t]
no_union(t::TValue) = [t]
no_union(t::TUnion) = reduce(vcat, Vector{ASTBase}(), map(no_union, t.ts))
no_union(t::TApp) = [t]
no_union(t::TWhere) = [t]
function no_union(t::TTuple)
    rec = Vector{Vector{ASTBase}}()
    reduce((_, t) -> push!(rec, no_union(t)), rec, t.ts)
    r = cartesian(rec)
    res = Vector{ASTBase}()
    reduce((_, ts) -> push!(res, TTuple(ts)), res, r)
    res
end

function cartesian(x::Vector{Vector{T}} where T)
    res = (typeof(x))()
    push!(res, eltype(x)())
        if isempty(x); return res
    end
    pop!(res)
    rec = cartesian(x[2:end])
    for i in 1:length(x[1])
        res = vcat(res, map(z -> vcat([x[1][i]], z), rec))
    end
    res
end
