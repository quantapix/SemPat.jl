if !Core.isdefined(:LJ_MAIN_FILE)
const LJ_MAIN_FILE = "lj.jl"
end

function lj_println_info(s :: String)
    println("--- LJ-INFO: " * s)
end

lj_println_info("LJ init")

# general helper functions
include("aux/aux.jl")
include("aux/errors.jl")

#----------------------------------------- Dependencies

# dependencies
if !Core.isdefined(:deps)
deps = ["JSON", "DataStructures"]
end

#----------------------------------------- Dump decls
### Pseudo-decls for types from Base library
#
# Choose 0 for simple bootstrap (about a dozen of type declarations)
#        1 for loading full dump of pseudo Base type declarations (can be slow):
#        2 custom decls dump: provide filename in the var:
#           decls_dump_file

# to avoid annoying warnings
if !Core.isdefined(:DECLS_MODE_DEFAULT)
## use a base decls-file by default
const DECLS_MODE_DEFAULT = 1
## name of the base decls-file
const BASE_DECLS_DUMP_FILE = "decls_base_inferred.json"
## by default produce an error if a decls-file is not found
const FORCE_DUMP_DEFAULT = false
end

#----------------------------------------- Print options

## Set [true] to print types in an xml-friendly format
lj_showtype_xmlmode = false

function lj_set_showtype_xmlmode(v :: Bool)
    global lj_showtype_xmlmode = v
end

## Set [true] to print types with new lines
lj_newlines = false

#----------------------------------------- Subtype options

## Flag whether print out debug information
f_debug = false
## Counter for loop detection
f_debug_count = 1

function set_f_debug(v :: Bool)
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

function lj_set_hugetype_errormode(v :: Bool)
    global lj_hugetype_errormode = v
end

const LJ_MAX_NTYPE_SIZE = 2000
const LJ_MAX_UNION_COUNT = 16

#----------------------------------------- Lambda-Julia files
lj_println_info("include LJ files")

# syntax
include("syntax/AST.jl")
include("aux/aux_AST.jl")
include("syntax/parsing.jl")

# loading type declarations
include("decls_load.jl")

#println("Current base_types_decls: $(parsed_base_ty_decls)")
#dump(parsed_base_ty_decls)

#----------------------------------------- Lambda-Julia files

# normalization and diagonalization (uses [is_concrete] from [types_utils.jl])
include("aux/nf-diag.jl") # ROSSEXP

# subtyping and related
include("env.jl")
include("aux/typeof.jl")
include("aux/types_utils.jl")
include("subtype_xml.jl")
include("aux/simplify.jl")
include("aux/type_validator.jl")

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

    # Set decls mode
    if lj_ARG_provided("-dm")
        decls_mode = Meta.parse(lj_get_ARG("-dm"))
    end
    if !Core.isdefined(Main, :decls_mode)
        decls_mode = DECLS_MODE_DEFAULT
    else
        decls_mode = Main.decls_mode
    end

    # User decls-file name
    if lj_ARG_provided("-fd")
        decls_dump_file = lj_get_ARG("-fd")
    end

    # Force dumping
    force_dump = FORCE_DUMP_DEFAULT
    if lj_ARG_provided("-dump")
        try
          force_dump = Bool(Meta.parse(lj_get_ARG("-dump")))
        catch
          throw(LJErrApplicationException("-dump must be boolean"))
        end
    end

    # Select a decls-file based on the settings
    if decls_mode == 0
        base_types_decls_fname = joinpath(dirname(@__FILE__()), "decls_minimal.json")
    elseif decls_mode == 1
        base_types_decls_fname = joinpath(dirname(@__FILE__()), BASE_DECLS_DUMP_FILE)
    elseif decls_mode == 2 # custom dump: should be stored in decls_dump_file
        base_types_decls_fname = Main.decls_dump_file
    else
        throw(LJErrApplicationException("Unsupported decls_mode value"))
    end

    #-----------------------------------------  Pseudo Base type declarations
    
    # dumping julia type declarations if necessary
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

