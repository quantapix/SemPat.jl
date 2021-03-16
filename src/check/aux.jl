################################################################################
### General auxiliary functions used by Lambda-Julia
################################################################################

## Constant to control inclusion of the file
if !Core.isdefined(:LJ_SRC_FILE_AUX)
  const LJ_SRC_FILE_AUX = "aux/aux.jl"
end

include("migration_aux.jl") # to support julia-0.7

#----------------------------------------- Dependencies

dep1 = "DataStructures"
if Pkg.installed(dep1) == nothing
  Pkg.add(dep1)
end

using DataStructures

#----------------------------------------- Functions

function lj_flatten(x)
  [i for i in vcat(x...)]
end

# # -> HHHH only if not inside "..."
function replace_hashes_not_in_lits(s :: String)
    inlit = false
    res = ""
    for c in s
        if c == '#'
            res *= inlit ? "#" : "HHHH"
        else
            if c == '"'
                inlit = !inlit
            end
            res *= "$(c)"
        end
    end
    res
end

# A.B.C -> (C, A.B)
function split_last_dot(s :: String)
  rdot_i = findlast(lj_equalto('.'), s)
  if is_notfound_marker(rdot_i)
    (s, "")
  else
    (s[rdot_i+1:end], s[1:rdot_i-1])
  end
end

lj_expr_size(e :: Any) = 1
function lj_expr_size(e :: Expr)
  size = 1
  q = Queue(Any)
  for x in e.args
    enqueue!(q, x)
  end
  while !isempty(q)
    x = dequeue!(q)
    size += 1
    if isa(x, Expr)
      for y in x.args
        enqueue!(q, y)
      end
    end
  end
  size
end

rules_stats_table_head ="""

                   === stats ===
Rule Name                         # occs  success
"""

function show_dict_sort_v(io :: IO, d :: Dict)
    print(rules_stats_table_head)
    for kv in sort(collect(d), by=x -> -x[2][1])
      print(io, @sprintf "%-26s  =>  %8s     %3s" kv[1] kv[2][1] trunc(Int, ((kv[2][2] / kv[2][1]) * 100)))
      print(io, "%\n")
    end
end

unlj(s :: String) = replace(s, "lj.", "")

#----------------------------------------- Work with command line arguments

## Tries to extract a command line argument provided after the [arg].
## For example, for [script.jl foo -f bar zoo] and [arg == "-f"],
##   it returns Nullable("bar").
## For [script.jl] or [script.jl foo -f] and [arg == "-f"], returns Nullable().
function lj_tryget_ARG(arg :: String) :: Nullable{String}
    arg_i = findfirst(lj_equalto(arg), ARGS)
    # get position of [arg]
    if is_notfound_marker(arg_i)
      return Nullable{String}()
    end
    # try to get an element next to arg
    if length(ARGS) > arg_i
      return Nullable{String}(ARGS[arg_i + 1])
    else
      return Nullable{String}()
    end
end

function lj_ARG_provided(arg :: String) :: Bool
    arg_i = findfirst(lj_equalto(arg), ARGS)
    !is_notfound_marker(arg_i) &&
    length(ARGS) > arg_i
end

## Unsafe version of [lj_tryget_ARG]: to be used only if arg is indeed provided
function lj_get_ARG(arg :: String) :: String
    ARGS[findfirst(lj_equalto(arg), ARGS) + 1]
end

include("rules_map.jl")
