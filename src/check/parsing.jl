dep1 = "JSON"
if Pkg.installed(dep1) == nothing
  Pkg.add(dep1)
end
eval(Meta.parse("using $(dep1)"))

#----------------------------------------- Code

################       AST conversion utilities       #################

##### Convert Julia's AST to LambdaJulia's one
#
if !Core.isdefined(:sym_map) # to avoid annoying warnings
const sym_map = Dict{Symbol, ASTBase}(
    :Any        => TAny(), :ANY => TAny(),
    :DataType   => TDataType(),
    :Union      => TSuperUnion(),
    :Tuple      => TSuperTuple(),
    :UnionAll   => TUnionAll(TDataType()),
    #
    # Aliases go below
    :Int        => TName(:Int64)
)
end

function convert_ast(ast :: Symbol, vars :: Vector{Symbol} = Symbol[])
    if haskey(sym_map, ast)
        sym_map[ast]
    elseif ast == :Vector
        convert_ast(Meta.parse("Array{T,1} where T"))
    elseif ast == :Type
        convert_ast(Meta.parse("Type{T} where T"))
    elseif ast == :Varargs
        throw(ErrorException("Varargs -- NIY"))
    else
        # @printf ("@@@ %s\n") ast
        name_i = findfirst(lj_equalto(ast), vars)
        if !is_notfound_marker(name_i)
            TVar(ast)
        else
            TName(ast)
        end
    end
end

function convert_ast(ast :: Any, vars :: Vector{Symbol} = Symbol[])
    TValue(string(ast))
end

function convert_ast(ast :: Expr, vars :: Vector{Symbol} = Symbol[])
    # println("convert_ast(Expr) with $ast")
    if ast.head == :curly  # instantiation of parametric type
        if          ast.args[1] == :Type              # Type{t'}
            TType(convert_ast(ast.args[2], vars))
            #TName(:T)
        else
            args = map(a -> convert_ast(a, vars), ast.args[2:end])

            if      ast.args[1] == :Tuple             # Tuple {t1 , .. , tn}
                TTuple(args)

            elseif  ast.args[1] == :Union || 
                    isa(ast.args[1], Expr) && ast.args[1].head == :. &&
                    "$(convert_name(ast.args[1]))" in ["Base.Union", "Core.Union"]
                                                          # Union{t1, ... , tn}
                TUnion(args)
            elseif  ast.args[1] == :Vector  # translating Vectors to 1D Arrays
                TApp(TName(:Array), vcat(args, ASTBase[TValue("1")]))
            else # user-defined parametric type instantiation
                TApp(convert_ast(ast.args[1], vars), args)
            end
        end
    elseif ast.head == :where                        # Where
        bnd_p = convert_param(ast.args[2], vars)
        TWhere( convert_ast(ast.args[1], vcat([bnd_p[2]], vars))
              , TVar(bnd_p[2])
              , bnd_p[1]
              , bnd_p[3])
    elseif ast.head in [:<:, :>:, :comparison]      # bounded
        bnd_v = convert_param(ast)
        #println("WARNING: Bounds unused in $(ast)")
        #throw(ErrorException("$(ast)"))
        TVar(bnd_v[2])# TVar(bnd_v[2], bnd_v[1], bnd_v[3])
    elseif ast.head == :.
        s = "$(convert_name(ast))"
        (n, q) = split_last_dot(s)
        if n == "Any" && (q in ["Base", "Core"])
          TAny()
        else
          TName(n,q)
        end
    elseif ast.head == :call
        if ast.args[2] == :Type
          return TUnionAll(TDataType())
        end
        if ast.args[1] == :Symbol # TODO
            TValue(string(ast))
        end
        if ast.args[1] == :getfield
          s = string(ast.args[2])
          (n, q) = split_last_dot(s)
          return TName("getfield($(n), $(ast.args[3]))", q)
        end
        if ast.args[1] == :typeof
          s = string(ast.args[2])
          (n, q) = split_last_dot(s)
          return TName("typeof($(Symbol(n)))", q)
        end
        return TValue(string(ast))
    elseif ast.head == :tuple
        TValue(string(ast))
    elseif ast.head == :incomplete
        throw(LJErrCannotParse("$(ast)"))
    else
        throw(ErrorException("convert_ast: unknown syntactic form: $(ast)"))
    end
end

#######      Helpers for legacy `convert_tydecl`     #######

# Convert type parameter to a triple (ASTBase, TVar, ASTBase)

# T -> (EmptyUnion, TVarSym, TAny)
convert_param(v :: Symbol, vars :: Vector{Symbol} = Symbol[]) =
    (EmptyUnion, v, TAny())

function convert_param(bnd_var :: Expr, vars :: Vector{Symbol} = Symbol[])
    if (bnd_var.head == :<:) # only upper bound
        ( EmptyUnion
        , bnd_var.args[1]
        , convert_ast(bnd_var.args[2], vars)
        )
    elseif (bnd_var.head == :>:) # only lower bound
        ( convert_ast(bnd_var.args[2], vars)
        , bnd_var.args[1]
        , TAny()
        )
    else # both bounds
        ( convert_ast(bnd_var.args[1], vars)
        , bnd_var.args[3]
        , convert_ast(bnd_var.args[5], vars)
        )
    end
end

convert_name_fun(sym :: Symbol) = sym
convert_name_fun(qname :: Expr) = Symbol(convert_name(qname.args[1]),
                                     ".#",
                                     qname.args[2].value)

convert_name(sym :: Symbol) = sym
convert_name(qname :: Expr) = Symbol(convert_name(qname.args[1]),
                                     ".",
                                     qname.args[2].value)

# NON-parametric, NON-bounded type declaration
is_decl_plain(decl_head :: Symbol) = true
is_decl_plain(decl_head :: Expr) = decl_head.head == :.

is_decl_bounded(decl_head :: Expr) = decl_head.head === :<:

is_decl_bounded_non_param(decl_head) =
    isa(decl_head.args[1], Symbol) || decl_head.args[1].head == :.

#######    Legacy `convert_tydecl`   #######
#
# NOTE: Below is legacy overcomplicated code for converting
#       type declarations into TyDecl objects. Now we use JSON as
#       an input for conversion utility (cf. lj_parse_tydecl_json)
#
# Convert a string with a type declaration to TyDecl object:
function convert_tydecl(td :: Expr)
    @assert (td.head in [:abstract, :type, :struct, :bitstype]) "ERROR: convert_tydecl, unexpected head: $(td)"
    attr = td.head == :abstract ? Abstract() : Concrete()
    empty_params = Vector{Tuple{ASTBase, TVarSym, ASTBase}}[]
    decl_head = td.head == :abstract ? td.args[1] : td.args[2]
    super  = TAny()
    if is_decl_plain(decl_head)
        # println("unbounded non-parametric")
        name   = convert_name(decl_head)
        params = empty_params
    else
        if is_decl_bounded(decl_head) # bounded type declaration
            if is_decl_bounded_non_param(decl_head)
                # println("bounded non-parametric")
                name   = convert_name(decl_head.args[1])
                params = empty_params
            else
                # println("bounded parametric")
                # our current knowledge of Julia'sAST implies this:
                @assert decl_head.args[1].head === :curly "Should be bounded parametric type: $(decl_head)"
                name   = convert_name(decl_head.args[1].args[1])
                params = map(convert_param, decl_head.args[1].args[2:end])
            end
            super  = convert_ast( decl_head.args[2]
                                , isempty(params) ? Symbol[]
                                                  : map(x -> x[2],  params))
        else  # unbounded parametric
            # println("unbounded parametric")
            @assert decl_head.head === :curly "Should be unbounded parametric type: $(decl_head)"
            name   = convert_name(decl_head.args[1])
            params = map(convert_param, decl_head.args[2:end])
        end
    end
    TyDecl(Symbol("$(name)"), "", params, super, attr)
end

##########   Helper functions for converting type info        ##########
#                   (former type declarations)

function lj_parse_params(tyvars_json)
    tyVars = []
    tyVarNamesSoFar = Symbol[]
    for tv_json in tyvars_json
        name = eval(Meta.parse(tv_json["name"]))
        lb = convert_ast(Meta.parse(tv_json["lb"]), tyVarNamesSoFar)
        ub = convert_ast(Meta.parse(tv_json["ub"]), tyVarNamesSoFar)
        push!(tyVarNamesSoFar, name)
        push!(tyVars, (lb, name, ub))
    end
    (tyVars, tyVarNamesSoFar)
end

####################        Entry functions         ###############

# parse a string with a type into our AST
lj_parse_type(s :: String) = convert_ast(Meta.parse(replace_hashes_not_in_lits(s)))

# This type declaration parsing utility uses legacy `convert_tydecl`
# We use this only occasionally for simple types (no hashes, no typeofs).
# Full-fledged utility to turn strings into TyDecls is lj_parse_tydecl_json.
function lj_parse_tydecl_simple(s::String)
  convert_tydecl(Meta.parse(s))
end

# Convert a json encoding of a type object to TyDecl object
# JSON format is what `decls_dump.jl` outputs
function lj_parse_tydecl_json(t_json)
  try
  # `attr_map` really should be top-level, but get annoying because of:
  # WARNING: redefining constant (const decl was removed due to julia-0.7)
  attr_map = [ConcreteImmutable(), Concrete(), Abstract()]

  attr = attr_map[t_json["attr"]]
  name = Symbol(t_json["name"])
  (params, names) = lj_parse_params(t_json["params"])

  super = convert_ast( Meta.parse(t_json["super"])
                     , isempty(names) ? Symbol[] : names)
  TyDecl(name, t_json["qual"], params, super, attr)
  catch e
    throw(ErrorException("FAIL on lj_parse_tydecl_json:\n$(e)\n$(sprint(JSON.print, t_json, 2))\n"))
  end
  #td
end

