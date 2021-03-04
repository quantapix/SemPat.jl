if isdefined(@__MODULE__, :DEBUG)
    MQuerySymbol(x...) = Symbol(join(["MQuery", x...], "_"))
else
    MQuerySymbol(x...) = Symbol(join(["MQuery", x...], "."))
end

ARG = MQuerySymbol("ARG") # we just need limited mangled symbols here.
TYPE_ROOT = MQuerySymbol("TYPE_ROOT")

IN_TYPES = MQuerySymbol("IN", "TYPES")
IN_FIELDS = MQuerySymbol("IN", "FIELDS")
IN_SOURCE = MQuerySymbol("IN", "SOURCE")

OUT_TYPES = MQuerySymbol("OUT", "TYPES")
OUT_FIELDS = MQuerySymbol("MQuery", "OUT.FIELDS")
OUT_SOURCE = MQuerySymbol("MQuery", "OUT.SOURCE")
RECORD = MQuerySymbol("RECORD")

N = MQuerySymbol("N")
GROUPS = MQuerySymbol("GROUPS")
GROUP_KEY = MQuerySymbol("GROUP_KEY")

FN = MQuerySymbol("FN")
FN_RETURN_TYPES = MQuerySymbol("FN", "RETURN_TYPES")
FN_OUT_FIELDS = MQuerySymbol("FN", "OUT_FIELDS")

AGG = MQuerySymbol("AGG")
AGG_TYPES = MQuerySymbol("AGG", "TYPES")

_gen_sym_count = 0
function gen_sym()
    global _gen_sym_count
    let sym = MQuerySymbol("TMP", _gen_sym_count)
        _gen_sym_count = _gen_sym_count  + 1
        sym
    end
end

function gen_sym(a::Union{Symbol,Int,String})
    global _gen_sym_count
    MQuerySymbol("Symbol", a)
end

const MAX_FIELDS = 10

function return_type(f, ts::A) where {T <: Type,A <: AbstractArray{T,1}}
    ts = Base.return_types(f, ts)
    if length(ts) === 1
        ts[1]
    else
        Union{ts...}
    end
end


function return_type(f, ts::NTuple{N,T}) where {N,T <: Type}
    ts = Base.return_types(f, ts)
    if length(ts) === 1
        ts[1]
    else
        Union{ts...}
    end
end

function return_type(f, t::Type)
    return_type(f, (t,))
end

for i = 1:MAX_FIELDS
    types = [Symbol("T", j) for j = 1:i]
    inp = :(Type{Tuple{$(types...)}})
    out = Expr(:vect, types...)
    @eval @inline type_unpack(n::Int, ::$inp) where {$(types...)} = $out
end

function type_unpack(n::Int, :: Type{Tuple{}})
    throw("TypeError at query expression.")
end

function type_unpack(n::Int, :: Type{Any})
    fill(Any, n)
end

# using DataFrames

function get_fields
end

function get_records
end

function build_result
end

get_fields(df :: Dict{Symbol, Vector{T} where T}) = collect(keys(df))
get_records(df :: Dict{Symbol, Vector{T} where T}) = zip((df[key] for key in keys(df))...)
function build_result(::Type{Dict{Symbol, Vector{T} where T}}, fields, typs, source :: Base.Generator)
    res = Tuple(typ[] for typ in typs)
    for each in source
        push!.(res, each)
    end
    Dict(zip(fields, res))
end

# interface for DataFrames

# get_fields(df :: DataFrame) = collect(names(df))
# get_records(df :: DataFrame) = DataFrames.columns(df)
# function build_result(::Type{DataFrame}, fields, typs, source :: Base.Generator)
#     res = Tuple(typ[] for typ in typs)
#     for each in source
#         push!.(res, each)
#     end
#     DataFrame(collect(res), fields)
# end

ismacro(x :: Expr) = Meta.isexpr(x, :macrocall)
ismacro(_) = false

function flatten_macros(node :: Expr)
    @match node begin
    Expr(:macrocall, op :: Symbol, ::LineNumberNode, arg) ||
    Expr(:macrocall, op :: Symbol, arg) =>

    @match arg begin
    Expr(:tuple, args...) || a && Do(args = [a]) =>

    @match args begin
    [args..., GuardBy(ismacro) && tl] => [(op |> get_op, args), flatten_macros(tl)...]
    _ => [(op |> get_op, args)]

    end
    end
    end
end

function codegen(node)
    ops = flatten_macros(node)
    let rec(vec) =
        @match vec begin
            [] => []
            [(&generate_groupby, args1), (&generate_having, args2), tl...] =>
                [generate_groupby(args1, args2), rec(tl)...]
            [(hd, args), tl...] =>
                [hd(args), rec(tl)...]
        end
        init = quote
            let iter = $get_records($ARG),
                fields = $get_fields($ARG),
                types =$type_unpack($length(fields), $eltype(iter))
                (fields, types, iter)
            end
        end
        fn_body = foldl(rec(ops), init = init) do last, mk
            mk(last)
        end
        quote
            @inline function ($ARG :: $TYPE_ROOT, ) where {$TYPE_ROOT}
                let ($IN_FIELDS, $IN_TYPES, $IN_SOURCE) = $fn_body
                    $build_result(
                        $TYPE_ROOT,
                        $IN_FIELDS,
                        $IN_TYPES,
                        $IN_SOURCE
                    )
                end
            end
        end
    end
end

function generate_select
end

function generate_where
end

function generate_groupby
end

function generate_orderby
end

function generate_having
end

function generate_limit
end

const registered_ops = Dict{Symbol, Any}(
    Symbol("@select") => generate_select,
    Symbol("@where") => generate_where,
    Symbol("@groupby") => generate_groupby,
    Symbol("@having") => generate_having,
    Symbol("@limit") => generate_limit,
    Symbol("@orderby") => generate_orderby
)

function get_op(op_name)
    registered_ops[op_name]
end

macro select(node)
    codegen(Expr(:macrocall, Symbol("@select"), __source__, node)) |> esc
end


macro where(node)
    codegen(Expr(:macrocall, Symbol("@where"), __source__, node)) |> esc
end

macro groupby(node)
    codegen(Expr(:macrocall, Symbol("@groupby"), __source__, node)) |> esc
end

macro having(node)
    codegen(Expr(:macrocall, Symbol("@having"), __source__, node)) |> esc
end


macro orderby(node)
    codegen(Expr(:macrocall, Symbol("@orderby"), __source__, node)) |> esc
end


macro limit(node)
    codegen(Expr(:macrocall, Symbol("@limit"), __source__, node)) |> esc
end

using Base.Enums
using ..Match.Render
using DataStructures

struct Field
    name
    make
    var::Symbol
    typ
end

function query_routine(assigns            :: OrderedDict{Symbol, Any},
                       fn_in_fields       :: Vector{Field},
                       fn_returns         :: Any,
                       result; infer_type = true)
    @assert haskey(assigns, FN_OUT_FIELDS)

    fn_arguments = map(x -> x.var, fn_in_fields)
    fn_arg_types = Expr(:vect, map(x -> x.typ, fn_in_fields)...)

    function (inner_expr)
        let_seq = [
            Expr(:(=), Expr(:tuple, IN_FIELDS, IN_TYPES, IN_SOURCE), inner_expr),
            (:($name = $value) for (name, value) in assigns)...,
            :(@inline $FN($(fn_arguments...)) =  $fn_returns),
        ]
        if infer_type
            let type_infer = :($FN_RETURN_TYPES = $type_unpack($length($FN_OUT_FIELDS, ), $return_type($FN, $fn_arg_types)))
                push!(let_seq, type_infer)
            end
        end
        Expr(:let,
            Expr(
                :block,
                let_seq...
            ),
            result
        )
    end
end

# visitor to process the pattern `_.x, _,"x", _.(1)` inside an expression
function mk_visit(fields :: Dict{Any, Field}, assigns :: OrderedDict{Symbol, Any})
    visit = expr ->
    @match expr begin
        Expr(:. , :_, q :: QuoteNode) && Do(a = q.value) ||
        Expr(:., :_, Expr(:tuple, a)) =>
            @match a begin
                a :: Int =>
                    let field = get!(fields, a) do
                            var_sym = gen_sym(a)
                            Field(
                                a,
                                Expr(:ref, RECORD, a),
                                var_sym,
                                Expr(:ref, IN_TYPES, a)
                            )
                        end
                        field.var
                    end

                ::String && Do(b = Symbol(a)) ||
                b::Symbol =>
                    let field = get!(fields, b) do
                            idx_sym = gen_sym()
                            var_sym = gen_sym(b)
                            assigns[idx_sym] = Expr(:call, findfirst, x -> x === b, IN_FIELDS)
                            Field(
                                b,
                                Expr(:ref, RECORD, idx_sym),
                                var_sym,
                                Expr(:ref, IN_TYPES, idx_sym)
                            )
                        end
                        field.var
                    end
            end
        Expr(head, args...) => Expr(head, map(visit, args)...)
        a => a
    end
end

function fn_apply(fields :: Vector{Field})
    Expr(
        :let,
        let let_seq = (:($(field.var) = $(field.make)) for field in fields)
            Expr(:block, let_seq...)
        end,
        let args = (field.var for field in fields)
            :($FN($(args...)))
        end
    )
end

function generate_where(args :: AbstractArray)

    pred_in_fields = Dict{Any, Field}()
    assigns        = OrderedDict{Symbol, Any}(FN_OUT_FIELDS => IN_FIELDS)
    visit = mk_visit(pred_in_fields, assigns)
    pred = foldl(args, init=true) do last, arg
        boolean = visit(arg)
        if last === true
            boolean
        else
            Expr(:&&, last, boolean)
        end
    end

    fields :: Vector{Field} = pred_in_fields |> values |> collect
    # where expression generation
    query_routine(
        assigns,
        fields,
        pred,
        Expr(:tuple,
             IN_FIELDS,
             IN_TYPES,
             :($RECORD for $RECORD in $IN_SOURCE if $(fn_apply(fields)))
        );
        infer_type = false
    )
end

function generate_select(args :: AbstractArray)
    map_in_fields = Dict{Any, Field}()
    assigns = OrderedDict{Symbol, Any}()
    fn_return_elts   :: Vector{Any} = []
    fn_return_fields :: Vector{Any} = []
    visit = mk_visit(map_in_fields, assigns)
    # process selectors
    predicate_process(arg) =
        @match arg begin
        :(!$pred($ (args...) )) && Do(ab=true) ||
        :($pred($ (args...) )) && Do(ab=false) ||
        :(!$pred) && Do(ab=true, args=[])      ||
        :($pred) && Do(ab=false, args=[])      =>
            let idx_sym = gen_sym()
                assigns[idx_sym] =
                    Expr(
                        :call,
                        findall,
                        ab ?
                            :(@inline function ($ARG,) !$pred($string($ARG,), $(args...)) end) :
                            :(@inline function ($ARG,) $pred($string($ARG,), $(args...)) end)
                        , IN_FIELDS
                    )
                idx_sym
            end
        end
    foreach(args) do arg
        @match arg begin
            :_ =>
                let field = get!(map_in_fields, all) do
                        var_sym = gen_sym()
                        push!(fn_return_elts, Expr(:..., var_sym))
                        push!(fn_return_fields, Expr(:..., IN_FIELDS))
                        Field(
                            all,
                            RECORD,
                            var_sym,
                            :($Tuple{$IN_TYPES...})
                        )
                    end
                    nothing
                end

            :(_.($(args...))) =>
                let indices = map(predicate_process, args)
                    if haskey(map_in_fields, arg)
                        throw("The columns `$(string(arg))` are selected twice!")
                    elseif !isempty(indices)
                        idx_sym = gen_sym()
                        var_sym = gen_sym()
                        field = begin
                            assigns[idx_sym] =
                                length(indices) === 1 ?
                                indices[1] :
                                Expr(:call, intersect, indices...)
                            push!(fn_return_elts, Expr(:..., var_sym))
                            push!(fn_return_fields, Expr(:..., Expr(:ref, IN_FIELDS, idx_sym)))
                            Field(
                                arg,
                                Expr(:ref, RECORD, idx_sym),
                                var_sym,
                                Expr(:curly, Tuple, Expr(:..., Expr(:ref, IN_TYPES, idx_sym)))
                            )
                        end
                        map_in_fields[arg] = field
                        nothing
                    end
                end
           :($a => $new_field) || a && Do(new_field = Symbol(string(a))) =>
                let new_value = visit(a)
                    push!(fn_return_fields, QuoteNode(new_field))
                    push!(fn_return_elts, new_value)
                    nothing
                end
        end
    end
    fields = map_in_fields |> values |> collect
    assigns[FN_OUT_FIELDS] = Expr(:vect, fn_return_fields...)
    # select expression generation
    query_routine(
        assigns,
        fields,
        Expr(:tuple, fn_return_elts...),
        Expr(
            :tuple,
            FN_OUT_FIELDS,
            FN_RETURN_TYPES,
            :($(fn_apply(fields)) for $RECORD in $IN_SOURCE)
        ); infer_type = true
    )
end


function generate_groupby(args :: AbstractArray, having_args :: Union{Nothing, AbstractArray} = nothing)
    group_in_fields = Dict{Any, Field}()
    having_in_fields = Dict{Any, Field}()
    assigns = OrderedDict{Symbol, Any}()
    visit_group_fn = mk_visit(group_in_fields, assigns)
    visit_having = mk_visit(having_in_fields, assigns)

    group_fn_return_vars = []
    group_fn_return_elts = []

    foreach(args) do arg
        @match arg begin
            :($b => $a) || b && Do(a = Symbol(string(b))) =>
                let field = a
                    push!(group_fn_return_vars, a)
                    push!(group_fn_return_elts, visit_group_fn(b))
                    nothing
                end
        end
    end

    cond_expr = having_args === nothing ? nothing :
        let cond =
            foldl(having_args) do last, arg
                Expr(:&&, last, visit_having(arg))
            end

            quote
                if !($cond)
                    continue
                end
            end
        end


    group_fn_return_fields = map(QuoteNode, group_fn_return_vars)
    ngroup_key = length(group_fn_return_vars)

    group_fields = group_in_fields |> values |> collect
    bindings_inside_for_loop = [
        (:($(field.var) = $(field.make)) for field in group_fields)...,
        (:($(field.var) = $(field.make)) for (key, field) in having_in_fields if !haskey(group_in_fields, key))...
    ]

    assigns[FN_OUT_FIELDS] = Expr(:vect, group_fn_return_fields...)
    group_fn_required_vars = [field.var for field in values(group_in_fields)]

    group_key_lhs = Expr(:tuple, group_fn_return_vars...)
    group_key_rhs = Expr(:call, FN, group_fn_required_vars...)

    # groupby expression generation
    query_routine(
        assigns,
        group_fields,
        Expr(:tuple, group_fn_return_elts...),
        let out_fields = Expr(:vcat, FN_OUT_FIELDS, IN_FIELDS),
            out_types = Expr(:vcat, FN_RETURN_TYPES, AGG_TYPES)
            quote
                $AGG_TYPES = [$Vector{each} for each in $IN_TYPES]
                $GROUPS = $Dict{$Tuple{$FN_RETURN_TYPES...}, $Tuple{$AGG_TYPES...}}()
                $N = $length($IN_FIELDS,)
                for $RECORD in $IN_SOURCE
                    $(bindings_inside_for_loop...)
                    $GROUP_KEY = $group_key_lhs = $group_key_rhs
                    $cond_expr
                    $AGG =
                        $get!($GROUPS, $GROUP_KEY) do
                            Tuple(typ[] for typ in $IN_TYPES)
                        end
                    ($push!).($AGG, $RECORD,)
                end
                (
                    $out_fields,
                    $out_types,
                    ((k..., v...) for (k, v) in $GROUPS)
                )
            end
        end
    )
end
