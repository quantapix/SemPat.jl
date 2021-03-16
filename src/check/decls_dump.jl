
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
