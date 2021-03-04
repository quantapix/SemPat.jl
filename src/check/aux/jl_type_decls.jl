################################################################################
### Dumping and parsing of Julia type declarations
################################################################################

## Constant to control inclusion of the file
if !Core.isdefined(:LJ_SRC_FILE_JL_TYPE_DECLS)
  const LJ_SRC_FILE_JL_TYPE_DECLS = "aux/jl_type_decls.jl"
end

#----------------------------------------- Dependencies

# dependencies
deps = ["JSON", "DataStructures"]

for d in deps
    if Pkg.installed(d) == nothing
      Pkg.add(d)
    end
end

#----------------------------------------- Module

module LJ_DeclsDumping

export
    TyVarInfo, TypeInfo,
    lj_dump_subtypes, lj_parse_decls_dump_json

using DataStructures
using JSON

######################################################## Dumping Julia Types

########################################## Data types

### Representing type information for storage (in JSON), 
#      later recover in TyDecl

struct TyVarInfo
    name :: String # :Sym or Symbol("Sym")
    lb   :: String
    ub   :: String
end

struct TypeInfo
    attr :: Int
    name :: String
    qual :: String
    params :: Vector{TyVarInfo}
    super  :: String
    str    :: String
end

########################################## Functions

#----------------------------------------- Dumping types

function dump_ty_decl(t :: Union{DataType, UnionAll})
    #println("tydecl: ", t)
    s = supertype(t)
    # aux functions [convert_tyvars], [chop_qual], etc. are defined below
    tyvars = convert_tyvars(get_tyvars(t))
    (tname, qual) = chop_qual(string(t))
    s_body = string(get_body(s))
    tinfo = TypeInfo( get_attr(t), tname, qual, tyvars
                    , replace_hashes(string(get_body(s))), string(t))
    tinfo
end

function lj_dump_subtypes(start::Union{DataType, UnionAll}) :: Vector{TypeInfo}
  typeInfos = TypeInfo[]   # vector of typeinfos
  tq = Queue(Type)         # queue  of unprocessed types
  for t in subtypes(start)
    if t != start
      enqueue!(tq, t)
    else
      # dump the start type immediately 
      push!(typeInfos, dump_ty_decl(start))
    end
  end
  # dump all types from the queue, add subtypes into the queue
  while !isempty(tq) 
    nexttype = dequeue!(tq)

    if nexttype == typeof($)
      continue
    end
    push!(typeInfos, dump_ty_decl(nexttype))

    sts = subtypes(nexttype)
    for subt in sts
      enqueue!(tq, subt)
    end
  end
  typeInfos
end

#----------------------------------------- Traversing Julia's AST

function get_tyvars(t) :: Vector{TypeVar}
    tyvars = []
    while Core.isdefined(t, :body)
        push!(tyvars, t.var)
        t = t.body
    end
    tyvars
end

function get_body(t)
    while Core.isdefined(t, :body)
        t = t.body
    end
    t
end

const attr_struct = 1
const attr_mutable_struct = 2
const attr_abstract_type = 3

function get_attr(t)
    tb = get_body(t)
    if !tb.abstract
        r = attr_struct
        if !isimmutable(t)
            r = attr_mutable_struct
        end
        r
    else
        attr_abstract_type
    end
end

#----------------------------------------- Other aux functions

replace_hashes(s :: String) = replace(s, '#', "HHHH")

## Converts TypeVar into TyVarInfo, and replaces hashes in names
function convert_tyvars(tvs :: Vector{TypeVar}) :: Vector{TyVarInfo}
    stvs = []
    for tv in tvs
        name = sprint(show, Symbol(replace_hashes(string(tv.name))))
        ub = replace_hashes(string(tv.ub))
        lb = replace_hashes(string(tv.lb))
        push!(stvs, TyVarInfo(name, lb, ub))
    end
    stvs
end

function chop_qual(s)
  # find last dot before type parameters start (`{`) -- this is border b/w
  # qualification and name
  qualname = split(s, '{')[1]  
  ps2 = split(qualname, '.')
  prefix = join(ps2[1:end-1], '.')
  name = ps2[end]
  
  if contains(prefix, "(")
    ps3 = split(prefix, '(')
    qual = join(ps3[2:end], '(')
    op = ps3[1] * "("
  else
    qual = prefix
    op= ""
  end
  name = op * name
  (name, qual)
end

######################################################## Parsing TypeInfo

## Parses JSON data and returns a vector of TypeInfos
function lj_parse_decls_dump_json(tinfos_json) :: Vector{TypeInfo}
    tinfos = TypeInfo[]
    for ti_json in tinfos_json
        ti = lj_parse_tinfo_json(ti_json)
        push!(tinfos, ti)
    end
    tinfos
end

function lj_parse_tinfo_json(tinfo_json) :: TypeInfo
    name = tinfo_json["name"]
    qual = tinfo_json["qual"]
    params = lj_parse_tinfo_params_json(tinfo_json["params"])
    super = tinfo_json["super"]
    attr = eval(parse(tinfo_json["attr"]))
    str = tinfo_json["str"]
    TypeInfo(attr, name, qual, params, super, str)
end

function lj_parse_tinfo_params_json(ti_params_json) :: Vector{TyVarInfo}
    tvars = TyVarInfo[]
    for param_json in ti_params_json
        tvar = lj_parse_tvarinfo_json(param_json)
        push!(tvars, tvar)
    end
    tvars
end

function lj_parse_tvarinfo_json(tvarinfo_json) :: TyVarInfo
    name = tvarinfo_json["name"]
    lb   = tvarinfo_json["lb"]
    ub   = tvarinfo_json["ub"]
    TyVarInfo(name, lb, ub)
end

end # module LJ_DeclsDumping