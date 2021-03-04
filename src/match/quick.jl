export @qmutable, @qstruct
export @qmutable_fp, @qstruct_fp
export @qstruct_np, @qmutable_np
export @qfunctor
export @destruct

const special_kw = [:_define_show, :_concise_show]

function construct end

@generated roottypeof(x) = roottype(x)
roottype(t::Type) = Base.typename(t).wrapper
type_parameters(x) = x.parameters
fieldtypes(t::Type) = tuple((fieldtype(t, n) for n in fieldnames(t))...)
tuple_parameters(::Type{T}) where {T<:Tuple} = type_parameters(T)
@generated tuple_parameters_stable(::Type{T}) where {T<:Tuple} =
    :(error("This is broken; it returns a type-tuples, but those cannot be fully-typed, they are instead Tuple{DataType, DataType, ...}. TODO: perhaps we can return Some{...}?"))
    #tuple(type_parameters(T)...)
@generated type_length(::Type{T}) where T = length(fieldnames(T))
is_mutable(::Type{T}) where T = T.mutable
@generated fieldsof(x) = :(tuple($([:(x.$n) for n in fieldnames(x)]...)))

type_simple_name(t::Type)::Symbol = t.name.name

function parse_funcall(x)
    if @mate(x, f_(xs__; kw__) do; constraints_ end); return (f, xs, kw, constraints)
    elseif @mate(x, f_(xs__) do; constraints_ end); return (f, xs, Any[], constraints)
    end
    if @mate(x, f_(xs__; kw__))
    elseif @mate(x, f_(xs__)); kw = Any[]
    else error("Not a funcall: $x")
    end
    if !isempty(xs) && @mate(xs[1], ()->constraints_); xs = xs[2:end]
    else constraints = nothing
    end
    return (f, xs, kw, constraints)
end

get_sym(e::Symbol) = e
function get_sym(e::Expr)
    @assert e.head==:(::)
    e.args[1]
end

function build_show_def(define_show::Bool, concise_show::Bool, name, fields, kwfields)
    if !define_show && !concise_show return nothing end
    quote
        function Base.show(io::IO, obj::$name)
            print(io, $(concise_show ? string(name) : @q(typeof(obj))))
            write(io, "(")
            $([@q begin
               show(io, obj.$(get_sym(field)));
               $(field==last(fields) ? nothing : @q(write(io, ", ")))
               end
               for field in fields]...)
            $(if !isempty(kwfields)
              @q(write(io, "; ")) end)
            $([@q begin
               write(io, $(string(get_sym(kwfield)))); write(io, "=");
               show(io, obj.$(get_sym(kwfield)));
               $(kwfield==last(kwfields) ? nothing : @q(write(io, ", ")))
               end
               for kwfield in kwfields]...)
            write(io, ")")
        end
    end
end

function all_type_vars_present(tx, xs)
    s = Set(tx)
    for x in xs
        prewalk(x) do x
            if isa(x, Symbol); delete!(s, x)
            end
            x
        end
    end
    isempty(s)
end

narrow_typeof(::Type{T}) where {T} = Type{T}
narrow_typeof(::T) where {T} = T

function qexpansion(def, mutable, fully_parametric, narrow_types)
    if !@mate(def, typ_def_ <: parent_type_)
        typ_def = def
        parent_type = :Any
    end
    typ, args, kw, constraints = parse_funcall(typ_def)
    typ_def = @q($typ($(args...); $(kw...)))
    if fully_parametric; typ, typ_def, args, kw = make_parametric(typ, typ_def, args, kw)
    end
    get_type_var(v::Symbol) = v
    get_type_var(e::Expr) = e.args[1]
    if @mate(typ, name_{type_params__})
        parametric = true
        type_vars = map(get_type_var, type_params)
        type_with_vars = @q($name{$(type_vars...)})
    else
        type_vars = []
        type_params = []
        parametric = false
        name = typ
        type_with_vars = name
    end
    fields = Any[]; kwfields = Any[]
    constr_args = Any[]; constr_kw = Any[]
    o_constr_args = Any[]; o_constr_kw = Any[]
    new_args = Any[]
    arg_names = Symbol[]
    reg_kw = Any[]
    for arg in args
        arg_name, arg_type, slurp, default = splitarg(arg)
        if slurp
            @assert arg_type == :Any "Slurping with type arguments not supported"
            @assert default === nothing "Slurping with default not supported"
            arg_type = :Tuple
            push!(constr_args, arg)
            push!(o_constr_args, arg)
        else
            push!(constr_args, default === nothing ? arg_name : Expr(:kw, arg_name, default))
            push!(o_constr_args, arg_name)
        end
        push!(fields, @q($arg_name::$arg_type))
        push!(new_args, arg_name)
        push!(arg_names, arg_name)
    end
    define_show = nothing
    concise_show = false
    for kwarg in kw
        arg_name, arg_type, slurp, default = splitarg(kwarg)
        if arg_name == :_define_show
            define_show = default::Bool
            continue
        end
        if arg_name == :_concise_show
            concise_show = default::Bool
            continue
        end
        if slurp
            @assert arg_type == :Any "Slurping with type arguments not supported"
            @assert default === nothing "Slurping with default not supported"
            arg_type = Base.Iterators.Pairs
            push!(new_args, arg_name)
            push!(constr_kw, kwarg)
            push!(o_constr_kw, kwarg)
        else
            push!(new_args, arg_name)
            push!(constr_kw,
                  default === nothing ? arg_name : Expr(:kw, arg_name, default))
            push!(o_constr_kw, Expr(:kw, arg_name, arg_name))
        end
        push!(reg_kw, kwarg)
        push!(kwfields, @q($arg_name::$arg_type))
        push!(arg_names, arg_name)
    end
    if define_show === nothing; define_show = !isempty(kwfields) end
    if narrow_types; given_types = [@q($Match.narrow_typeof($a)) for a in (fields..., kwfields...)]
    else given_types = type_vars
    end
    inner_constr = quote
        function $type_with_vars($(constr_args...); $(constr_kw...)) where {$(type_params...)}
            $constraints
            new{$(type_vars...)}($(new_args...))
        end
    end
    straight_constr = :($name($(args...); $(reg_kw...)) where {$(type_vars...)} = $name{$(given_types...)}($(o_constr_args...); $(o_constr_kw...)))
    type_def =
        quote
            Base.@__doc__ $(Expr(:struct,
                                 mutable, Expr(:<:, typ, parent_type),
                                 Expr(:block, fields..., kwfields...,
                                      inner_constr,
                                      ((parametric && all_type_vars_present(type_vars, [args; kw])) ? [straight_constr] : [])...)))
        end
    construct_def = quote
         function $Match.construct(::Type{$name}, $(arg_names...))
             $name($(o_constr_args...); $(o_constr_kw...))
         end
         function $Utils.constrof(::Type{<:$name})
             (xs...) -> $Match.construct($name, xs...)
         end
    end
    @gensym obj
    unpack_def = quote
        macro $(Symbol(:unpack_, name))(obj_expr)
            esc(Expr(:block, Expr(:(=), $(Expr(:quote, obj)), obj_expr), $([Expr(:quote, :($arg = $obj.$arg)) for arg in arg_names]...)))
        end
    end
    esc(Expr(:toplevel,
             type_def,
             construct_def,
             build_show_def(define_show, concise_show, name, fields, kwfields),
             unpack_def,
             nothing))
end

macro qstruct(x)
    return qexpansion(x, false, false, false)
end

macro qmutable(x)
    return qexpansion(x, true, false, false)
end

function make_parametric(typ, typ_def, args, kw)
    all_types = []
    type_counter = 1
    function new_type(parent)
        new_ty = Symbol(:T, type_counter)
        type_counter += 1
        push!(all_types, @q($new_ty <: $parent))
        return new_ty
    end
    #add_type(field::Symbol) = @q($field::$(new_type()))
    function add_type(field)
        name, parent_type, slurp, val = splitarg(field)
        @assert !slurp "Slurping not supported. TODO"
        if name in special_kw; field
        elseif val===nothing; @q($name::$(new_type(parent_type)))
        else Expr(:kw, @q($name::$(new_type(parent_type))), val)
        end
    end
    typed_args = map(add_type, args)
    typed_kw = map(add_type, kw)
    new_typ = @q($typ{$(all_types...)})
    if type_counter == 1; (typ, typ_def, args, kw)
    else (new_typ, @q($new_typ($(typed_args...); $(typed_kw...))), typed_args, typed_kw)
    end
end

macro qstruct_fp(x)
    return qexpansion(x, false, true, false)
end

macro qmutable_fp(x)
    return qexpansion(x, true, true, false)
end

macro qstruct_np(x)
    return qexpansion(x, false, true, true)
end
macro qmutable_np(x)
    return qexpansion(x, true, true, true)
end

macro qfunctor(fdef0)
    if @mate(fdef0, A_ <: parenttype_); fdef = A
    else
        fdef = fdef0
        parenttype = :Any
    end
    di = split_def(fdef)
    type_def = di[:name]
    if @mate(type_def, typename_(args__; kw__)); all_args = map(first ∘ splitarg, vcat(args, kw))
    else
        @assert @mate(type_def, typename_(args__))
        all_args = map(first ∘ splitarg, args)
    end
    di[:name] = :(__self__::$typename)
    if @mate(type_def, tname_{Ts__}(__)); di[:whereparams] = tuple(Ts..., get(di, :whereparams, ())...)
    end
    di[:body] =
        @q begin
            $(Expr(:tuple, all_args...)) = $(Expr(:tuple, [:(__self__.$arg) for arg in all_args]...))
            $(di[:body])
        end
    esc(quote
        $Match.@qstruct $type_def <: $parenttype
        $(join_def(di))
        end)
end

check_destructurable(x) = nothing

macro destruct_assignment(x)
    if @mate(x, typ_(args__; kw__) = rhs_); nothing
    elseif @mate(x, typ_(args__) = rhs_); kw = []
    elseif @mate(x, (args__,) = rhs_)
        kw = []
        typ = Tuple
    else
        @assert @mate(x, lhs_ = _)
        return esc(x)
    end
    obj = rhs isa Symbol ? rhs : gensym(:obj)  # to avoid too many gensyms
    body = []
    for (i, a) in enumerate(args)
        push!(body, :($Match.@destruct_assignment $a = $Base.getfield($obj, $i)))
    end
    for x in kw
        local_var, prop = @mate(x, a_ = b_) ? (a, b) : (x, x)
        prop::Symbol
        push!(body, :($local_var = $obj.$prop))
    end
    esc(@q begin
        $obj = $rhs::$typ
        $Match.check_destructurable($obj)
        $(body...)
        end)
end

macro destruct_function(fdef)
    di = split_def(fdef)
    prologue = []
    function proc_arg(a)
        if @mate(a, f_(__))
            @gensym g
            push!(prologue, :($Match.@destruct_assignment $a = $g))
            :($g::$f)
        else a
        end
    end
    if haskey(di, :name); di[:name] = proc_arg(di[:name])
    end
    di[:args] = map(proc_arg, di[:args])
    di[:kw] = map(proc_arg, get(di, :kw, []))
    di[:body] = @q begin
        $(prologue...)
        $(di[:body])
    end
    return esc(join_def(di))
end

macro destruct(e::Expr)
    if @mate(e, lhs_ := rhs_)
        esc(:($Match.@destruct_assignment $lhs = $rhs))
    elseif @mate(e, for x_ in seq_ body__ end)
        @gensym g
        esc(@q begin
            for $g in $seq
                $Match.@destruct_assignment $x = $g
                $(body...)
            end
            end)
    elseif is_def(e); esc(:($Match.@destruct_function $e))
    else error("Invalid expression $e")
    end
end

macro d(e)
    esc(:($Match.@destruct $e))
end
