################################################################################
### Dumping declarations of Julia types
### ----------------------------------------------------------------------------
### 
### NOTE. This file can be used as a standalone script to dump declarations;
###       it uses (and includes if necessary) files
###       [errors.jl], [aux.jl], and [jl_type_decls.jl]
###
### By default, the script dumps declarations of types available in [Main]
###   into a file with the name defined in the variable [fname_decls] if
###   the variable itself is defined.
### If [fname_decls] is not defined and no command line arguments are given,
###   declarations are dumped into [decls_base_inferred.json].
### If [fname_decls] is not defined and there is a command line argument
###   [-fd <name>], declarations are dumped into the [<name>] file.
################################################################################

#----------------------------------------- Dependencies

# Conditional includes to allow for standalone usage
if !Core.isdefined(:LJ_SRC_FILE_ERRORS) 
  include("errors.jl")
end
if !Core.isdefined(:LJ_SRC_FILE_AUX) 
  include("aux.jl")
end
if !Core.isdefined(:LJ_SRC_FILE_JL_TYPE_DECLS) 
  include("jl_type_decls.jl")
end

using JSON

#----------------------------------------- Functions

function lj_dump_decls_json(start_type, fname_decls :: String)
    lj_tis = LJ_DeclsDumping.lj_dump_subtypes(start_type)
    open(fname_decls, "w") do f
        JSON.print(f, lj_tis, 2)
    end
end

#----------------------------------------- Dumping

if !Core.isdefined(:fname_decls)
    local arg = lj_tryget_ARG("-fd")
    fname_decls = arg.hasvalue ? arg.value : "decls_base_inferred.json"
end

print("Dumping type declarations... ")
start_type = Any
lj_dump_decls_json(start_type, fname_decls)
println("Done")
