__precompile__()

module lj

export lj_typeof, lj_typeof_ast_entry,
  lj_subtype, lj_subtype_ast_entry,
  lj_subtype_revised, lj_subtype_ast_entry_revised,
  lj_subtype_trivial, lj_subtype_trivial_ast_entry,
  lj_parse_type, 
  lj_parse_and_normalize_type, lj_normalize_type,
  show_dict_sort_v, replace_hashes_not_in_lits, usingTest,
  ASTBase, Stats, RulesStats, LJ_NormalForm, 
  lj_AST_size, lj_AST_count_union,
  LJErrNameNotFound, LJErrTypeNotWF, LJErrNameAmbiguous,
  LJErrIInType, LJErrGetfield, LJErrFreeVar,
  LJErrTypeTooLarge, LJErrTermInType,
  LJErrCannotParse, LJErrApplicationException,
  LJSUBT_TRUE, LJSUBT_FALSE, LJSUBT_UNDEF, LJ_MAIN_FILE,
  addStats,
  lj_set_showtype_xmlmode,
  set_f_debug, init_debug,
  lj_set_hugetype_errormode

module_mode = true

if !Core.isdefined(:LJ_MAIN_FILE)
    const LJ_MAIN_FILE = "lj.jl"
end
  
function lj_println_info(s::String)
  println("--- LJ-INFO: " * s)
end
  
lj_println_info("LJ init")
  
include("aux/aux.jl")
include("aux/errors.jl")
  
if !Core.isdefined(:deps)
    deps = ["JSON", "DataStructures"]
end
  
  if !Core.isdefined(:DECLS_MODE_DEFAULT)
  ## use a base decls-file by default
    const DECLS_MODE_DEFAULT = 1
  ## name of the base decls-file
    const BASE_DECLS_DUMP_FILE = "decls_base_inferred.json"
  ## by default produce an error if a decls-file is not found
    const FORCE_DUMP_DEFAULT = false
end
  
  lj_showtype_xmlmode = false
  
  function lj_set_showtype_xmlmode(v::Bool)
    global lj_showtype_xmlmode = v
end
  lj_newlines = false

  f_debug = false
  ## Counter for loop detection
  f_debug_count = 1
  
  function set_f_debug(v::Bool)
    global f_debug = v
    global lj_showtype_xmlmode
      # set xml-mode, because debug prints xml
    if f_debug
        lj_showtype_xmlmode = true
    end
end
  
  function init_debug()
    global f_debug_count = 1
end
  
  ## Flag whether to raise an error on huge normalized types
  lj_hugetype_errormode = false
  
  function lj_set_hugetype_errormode(v::Bool)
    global lj_hugetype_errormode = v
end
  
  const LJ_MAX_NTYPE_SIZE = 2000
  const LJ_MAX_UNION_COUNT = 16
  lj_println_info("include LJ files")
  
  include("AST.jl")
  include("aux.jl")
  include("parsing.jl")
  
  # loading type declarations
  include("decls_load.jl")
  
  # println("Current base_types_decls: $(parsed_base_ty_decls)")
  # dump(parsed_base_ty_decls)
  
  # normalization and diagonalization (uses [is_concrete] from [types_utils.jl])
  include("nf-diag.jl") # ROSSEXP
  
  # subtyping and related
  include("env.jl")
  include("typeof.jl")
  include("types_utils.jl")
  include("subtype_xml.jl")
  include("simplify.jl")
  include("type_validator.jl")
  
  lj_println_info("LJ loaded")
  
  parsed_base_ty_decls = TyDeclCol([])
  
  function __init__()
    lj_println_info("Install LJ dependencies")
    for d in deps
        if Pkg.installed(d) == nothing
            Pkg.add(d)
        end
    end
  
    lj_println_info("Dump decls (if needed)")
    if lj_ARG_provided("-dm")
        decls_mode = Meta.parse(lj_get_ARG("-dm"))
    end
    if !Core.isdefined(Main, :decls_mode)
        decls_mode = DECLS_MODE_DEFAULT
    else
        decls_mode = Main.decls_mode
    end
    if lj_ARG_provided("-fd")
        decls_dump_file = lj_get_ARG("-fd")
    end
    force_dump = FORCE_DUMP_DEFAULT
    if lj_ARG_provided("-dump")
        try
            force_dump = Bool(Meta.parse(lj_get_ARG("-dump")))
        catch
            throw(LJErrApplicationException("-dump must be boolean"))
        end
    end
    if decls_mode == 0
        base_types_decls_fname = joinpath(dirname(@__FILE__()), "decls_minimal.json")
    elseif decls_mode == 1
          base_types_decls_fname = joinpath(dirname(@__FILE__()), BASE_DECLS_DUMP_FILE)
      elseif decls_mode == 2 # custom dump: should be stored in decls_dump_file
          base_types_decls_fname = Main.decls_dump_file
      else
          throw(LJErrApplicationException("Unsupported decls_mode value"))
    end
    if !isfile(base_types_decls_fname)
        if force_dump
            fname_decls = base_types_decls_fname
            include("aux/decls_dump.jl")
        else
            throw(LJErrApplicationException("Decls file $(base_types_decls_fname) not found"))
        end
    end
        
    print("Loading type declarations... ")
    preparsed_tydecls = create_tydecls(base_types_decls_fname)
    global parsed_base_ty_decls = make_tydecl_dict(preparsed_tydecls)
    println("Done")
end
    

end

using ..lj
