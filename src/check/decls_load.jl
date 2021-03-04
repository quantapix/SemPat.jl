################################################################################
### Loading declarations of Julia types
### ----------------------------------------------------------------------------
### 
### NOTE. To be included after [AST.jl], and [parsing.jl]
################################################################################

# Uncomment includes below to get better support from an editor
#=
include("syntax/AST.jl")
include("syntax/parsing.jl")
# =#

using JSON

function create_tydecls(decls_fname :: String)
  tds_json = JSON.parsefile(decls_fname)
  tds = TyDecl[]
  for td_json in tds_json
    try
      td = lj_parse_tydecl_json(td_json)
      push!(tds, td)
    catch e
      #if Core.isdefined(:f_debug) && f_debug
        #println(e)
      #end
    end
  end
  tds
end

make_tydecl_dict(tds) = 
    Dict(zip( map(td-> "$(td.qual)::$(td.name)", tds)
            , tds))