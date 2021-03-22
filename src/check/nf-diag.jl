# push!(LOAD_PATH, "normalization")
# normalization on AST types
# using LJ_NormalForm
include("normal-form.jl")
# marking diagonal variables based on occurrence infos
# using LJ_Diagonality
include("diagonality.jl")
# calculating an upper bound of a type
# using LJ_UpperBound
include("upper-bound.jl")

lj_parse_and_normalize_type(s::String, mark_diag::Bool=true,
    tds::TyDeclCol=parsed_base_ty_decls
)::ASTBase =
    lj_normalize_type(betared(lj_parse_type(s)), mark_diag, tds)

function lj_normalize_type(t::ASTBase, mark_diag::Bool=true,
    tds::TyDeclCol=parsed_base_ty_decls
)::ASTBase
    # normalize type
    # t  = LJ_NormalForm.lj_make_vars_unique(t)
    nt = LJ_NormalForm.lj_normalize_type(t)
    # mark_diag = false
    if mark_diag
        # mark diagonal variables if asked
        dnt = LJ_Diagonality.mark_diagonal_vars(nt)
        # unmark diagonal variables with non-concrete lower bounds
        dnt = lj_unmark_diag(dnt, tds)
    else
        nt
    end
end

lj_fold_union_tuple(t::ASTBase)::Tuple{ASTBase,Bool} =
    LJ_NormalForm.lj_fold_union_tuple(t)

lj_fold_union_tuple(t::String)::ASTBase =
    lj_fold_union_tuple(
        lj_parse_and_normalize_type(t)
    )[1]

lj_upper_bound(t::ASTBase)::Tuple{ASTBase,Bool} =
    LJ_UpperBound.lj_upper_bound(t)

function lj_unmark_diag(t::ASTBase, tds::TyDeclCol)::ASTBase
    throw(LJErrApplicationException(
    "lj_unmark_diag(::ASTBase, tds) shouldn't be called"))
end

const LJDiagSimpleTys = Union{TAny,TVar,TName,TValue,TDataType,TSuperUnion,TSuperTuple}

lj_unmark_diag(t::LJDiagSimpleTys, tds::TyDeclCol)::LJDiagSimpleTys = t

lj_unmark_diag(t::TUnion, tds::TyDeclCol)::TUnion =
    TUnion(map(te -> lj_unmark_diag(te, tds), t.ts))

function lj_unmark_diag(t::TApp, tds::TyDeclCol)::TApp
    @assert isa(t.t, TName) "lj_unmark_diag(t::TApp,tds): t.t expected to be TName"
    TApp(t.t, map(te -> lj_unmark_diag(te, tds), t.ts))
end

lj_unmark_diag(t::TTuple, tds::TyDeclCol)::TTuple =
    TTuple(map(te -> lj_unmark_diag(te, tds), t.ts))

lj_unmark_diag(t::TUnionAll, tds::TyDeclCol)::TUnionAll =
    TUnionAll(lj_unmark_diag(t.t, tds))

lj_unmark_diag(t::TType, tds::TyDeclCol)::TType =
    TType(lj_unmark_diag(t.t, tds))

function lj_unmark_diag(t::TWhere, tds::TyDeclCol)::TWhere
    tt = lj_unmark_diag(t.t, tds)
    lb = lj_unmark_diag(t.lb, tds)
    ub = lj_unmark_diag(t.ub, tds)
    diag = t.diag
    # unset diagonality if lower bound is not concrete and not bottom
    if diag && !(lb == EmptyUnion || is_concrete(lb, tds))
        diag = false
    end
    TWhere(tt, t.tvar, lb, ub, diag)
end
