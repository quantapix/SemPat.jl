################################################################################
### Environment for LJ Subtyping
### ----------------------------------------------------------------------------
### 
### NOTE. To be included after [errors.jl], [aux.jl], and [AST.jl]
################################################################################

# Uncomment includes below to get better support from an editor
#=
include("errors.jl")
include("aux/aux.jl")
include("syntax/AST.jl")
# =#

######################################################## Debug

function debug_out(s::String)
  global f_debug_count
  if f_debug
    f_debug_count = f_debug_count + 1
    if f_debug_count > 10000
      lj_error("POOR MAN INFINITE LOOP DETECTION")
    end
    @printf "%s\n" s
  end
end

######################################################## Stats

#
# Base class for various statistics
abstract type Stats end
#
struct RulesStats <: Stats
  s :: Dict{String, Tuple{Int,Int}}
  RulesStats() = new(Dict())
  RulesStats(d :: Dict) = new(d)
end

import Base.getindex, Base.setindex!, Base.get
getindex(rs :: RulesStats, key :: String) = rs.s[key]
function setindex!(rs :: RulesStats, val, key :: String)
  rs.s[key] = val
end
get(rs :: RulesStats, key :: String, def) = get(rs.s, key, def)

# this adds RHS stats to LHS updating LHS in-place
function addStats(x :: RulesStats, y :: RulesStats) 
    merge!((rs1, rs2) -> (rs1[1] + rs2[1], rs1[2] + rs2[2]), x.s, y.s)
end

function show(io::IO, rs::RulesStats)
  global dump_stats
  show_dict_sort_v(io, rs.s)
end

### state used for flags: counting occurrences, consistency_check_enabled, ...
##  TODO: the covariant_position and invariant_position counters are not used any-longer
##        and should be removed.
struct ST_State <: Stats
  in_consistency_check :: Bool
  occurrence_counting  :: Bool   # for diagonal rule
  covariant_position   :: Bool   # for diagonal rule
  invariant_position   :: Bool   # for diagonal rule
  stats                :: RulesStats # gather stats about rule use
  revised_rules        :: Bool   # if true, use the revised rules
end

ST_initial_state_std() = ST_State(false, true, false, false, RulesStats(), false)
ST_initial_state_revised() = ST_State(false, true, false, false, RulesStats(), true)

function state_set_in_consistency_check(state::ST_State)
  return ST_State(true, state.occurrence_counting, state.covariant_position, state.invariant_position, state.stats, state.revised_rules)
end

function state_disable_occurrence_counting(state::ST_State)
  return ST_State(state.in_consistency_check, false, state.covariant_position, state.invariant_position, state.stats, state.revised_rules)
end

function state_set_covariant_position(state::ST_State)
  if state.invariant_position
    return state
  else
    return ST_State(state.in_consistency_check, state.occurrence_counting, true, false, state.stats, state.revised_rules)
  end
end

function state_set_invariant_position(state::ST_State)
  return ST_State(state.in_consistency_check, state.occurrence_counting, false, true, state.stats, state.revised_rules)
end


######################################################## Env
### var environment for subtyping

abstract type EnvEntry end

abstract type VEnvTag end
struct TagLeft <: VEnvTag end
struct TagRight <: VEnvTag end
struct TagNotMatter <: VEnvTag end

struct Occurs
  disabled :: Bool
  cov :: Int
  inv :: Int
end

import Base.+
import Base.zero

function (+)(o1::Occurs, o2::Occurs)
  if o1.disabled || o2.disabled
    return Occurs(true, 0, 0)
  else
    return (Occurs(false, o1.cov+o2.cov, o1.inv+o2.inv))
  end
end

function zero(::Type{Occurs})
  return Occurs(false, 0, 0)
end

function show(io::IO, occ::Occurs)
  print(io,string("[",occ.disabled,"|",occ.cov,"|",occ.inv,"]"))
  print(io,"")
end

# This is incorrect because it does not take into account where
# variables have been introduced.  An alternative, correct, solution
# based on barriers is implemented by the increase_occ_alt function
# below

# function increase_occ(occ::Occurs, state::ST_State)
#   if state.occurrence_counting && !occ.disabled
#     if state.covariant_position && !state.invariant_position
#       return Occurs(false,occ.cov+1, occ.inv)
#     elseif !state.covariant_position && state.invariant_position
#       return Occurs(false,occ.cov, occ.inv+1)
#     elseif !state.covariant_position && !state.invariant_position
#       return Occurs(false,occ.cov, occ.inv)  # not sure about this
#     else
#       lj_error(string("Inconsistent state: ", state))
#     end
#   else
#     return occ
#   end
# end



struct VEnv <: EnvEntry
  var :: TVar
  lb  :: ASTBase
  ub  :: ASTBase
  tag :: VEnvTag
  occ :: Occurs
  static_diag :: Bool
end



function show(io::IO, venv::VEnv)
  print(io,"[",venv.var," ^",venv.ub," _",venv.lb," ",venv.tag,
           " ", venv.occ, " ", venv.static_diag, "] ")
end

function show(io::IO, ::TagLeft)
  print(io,"L")
end

function show(io::IO, ::TagRight)
  print(io,"R")
end

struct EnvBarrier <: EnvEntry end

function show(io::IO, ::EnvBarrier)
  print(io, "|Barrier| ")
end

struct Env
  curr :: Vector{EnvEntry}
  past :: Vector{VEnv}
end

fresh_env() = Env([], [])

import Base.copy
copy(e :: Env) = Env(copy(e.curr), copy(e.past))

function show(io::IO, env::Env)
  map(ee -> print(io,ee), env.past)
  print(io," ||| ")
  map(ee -> print(io,ee), env.curr)
end

# free variables in a venv

function free_variables(ee::VEnv)
  return lj_flatten(vcat(ee.var.sym, free_variables(ee.lb), free_variables(ee.ub)))
end

function free_variables(ee::EnvBarrier)
  return []
end

function free_variables(env::Env)
  return lj_flatten(vcat(map(ee -> free_variables(ee), env.curr),
                      map(ee -> free_variables(ee), env.past)))
end

# substitutions over environments (for var_left instantiation)

function substitute(ee::EnvBarrier, v::TVar, t::ASTBase)
  return ee
end

function substitute(ee::VEnv, v::TVar, t::ASTBase)
  if v == ee.var
    return ee
  else
    return VEnv(ee.var, substitute(ee.lb,v,t), substitute(ee.ub,v,t), ee.tag, ee.occ, ee.static_diag)
  end
end

function substitute(env::Env, v::TVar, t::ASTBase)
  env1 = Env(map(ee -> substitute(ee,v,t), env.curr), map(ee -> substitute(ee,v,t), env.past))
  return env1
end

### gensym and freshen

# function lj_gensym(a::Union{Env,ASTBase}, v::TVar)
#   fv = free_variables(a)
#   i = 1
#   while true
#     if !(Symbol(v,i) in fv)
#       return TVar(Symbol(v,i))
#     end
#     i = i+1
#   end
# end

function lj_gensym(t::ASTBase, v::TVar)
  fv = all_variables(t)
  i = 1
  while true
    if !(Symbol(v,i) in fv)
      return TVar(Symbol(v,i))
    end
    i = i+1
  end
end

function lj_gensym(e::Env, t::ASTBase, v::TVar)
  fv = vcat(free_variables(e), all_variables(t))
  i = 1
  while true
    if !(Symbol(v,i) in fv)
      return TVar(Symbol(v,i))
    end
    i = i+1
  end
end

function freshen(env::Env, v::TVar, t::ASTBase)
  vn = lj_gensym(env, t, v)
  t1 = rename(t,v,vn)
  debug_out(string("<Freshen>\n<v>",v,"</v>\n<vn>",vn,"</vn>\n</Freshen>"))
  return (vn,t1)
end

### add entry to env, possibly alpha-renaming if variable clash

function env_conflict(env::Env, v::TVar)
  if v.sym in free_variables(env)
    return true
  else
    return false
  end
end

function env_add!(env::Env, eb::EnvBarrier)
  append!(env.curr, [eb])
end

function env_add!(env::Env, v::TVar, lb::ASTBase, ub::ASTBase, tag::VEnvTag, sd::Bool, tds::TyDeclCol = TyDeclCol())
  # TODO: check if empty default tds is Ok
  # poor man test for alpha conversion
  if env_conflict(env,v)
    lj_error(string("Alpha-renaming error.\nv = ",VEnv(v,lb,ub,tag),"\nenv = ", env,"\n"))
  end
  if is_concrete(lb, tds)
    append!(env.curr, [VEnv(v, lb, ub, tag, Occurs(false,0,0),sd)])
  else
    append!(env.curr, [VEnv(v, lb, ub, tag, Occurs(true,0,0),sd)])
  end
end

function env_add!(env::Env, v::TVar, lb::ASTBase, ub::ASTBase, tds::TyDeclCol = TyDeclCol())
  # TODO: check if empty default tds is Ok
  # FZN: what is this used for?
  env_add!(env, v, lb, ub, TagNotMatter(), false, tds)
end

function increase_occ_alt(v::VEnv, state::ST_State, env::Env)
  if state.occurrence_counting && !v.occ.disabled
    # search for index of v, and index of last barrier
    # if after last barrier, increase; otherwise unchanged
    tv = findlast(ee -> isa(ee,VEnv) && ee.var == v.var, env.curr)
    if is_notfound_marker(tv)
      tv = 0
    end
    tb = findlast(ee -> isa(ee,EnvBarrier), env.curr)
    if is_notfound_marker(tb)
      tb = 0
    end

    if tv > tb
      # covariant
      return Occurs(false,v.occ.cov+1, v.occ.inv)
    else
      return Occurs(false,v.occ.cov, v.occ.inv+1)
    end

  else
    return v.occ
  end
end


function env_replace!(env::Env, v::TVar, lb::ASTBase, ub::ASTBase, tag::VEnvTag, state::ST_State)
  tvi = findlast(ee -> isa(ee,VEnv) && ee.var == v, env.curr)
  if is_notfound_marker(tvi)
    # search in curr.past
    tvi = findlast(ee -> isa(ee,VEnv) && ee.var == v, env.past)
    if is_notfound_marker(tvi)
      lj_error(string("Internal: env_replace on missing var.  v=",v,"\nenv= ",env,"\nlb= ",lb,"\nub= ",ub,"\n"))
    else
      # new_occ = increase_occ(env.past[tvi].occ, state)
      # new_occ = increase_occ_alt(env.past[tvi], state, env)
      new_occ = env.past[tvi].occ
      env.past[tvi] = VEnv(v, lb, ub, tag, new_occ, env.past[tvi].static_diag)
    end
  else
    #    new_occ = increase_occ(env.curr[tvi].occ, state)
    new_occ = increase_occ_alt(env.curr[tvi], state, env)
    env.curr[tvi] = VEnv(v, lb, ub, tag, new_occ, env.curr[tvi].static_diag)
  end
end

function env_search(env::Env, tv::TVar)
  tvi = findlast(ee -> isa(ee,VEnv) && ee.var == tv , env.curr)
  if is_notfound_marker(tvi)
    tvi = findlast(ee -> ee.var == tv , env.past)
    if is_notfound_marker(tvi)
      lj_error(string("Internal: type variable not in scope: ",tv,"\n env: ",env))
    end
    return env.past[tvi]
  end
  return env.curr[tvi]
end

function env_defines(env::Env, tv::TVar)
  tvi = findlast(ee -> isa(ee,VEnv) && ee.var == tv , env.curr)
  if is_notfound_marker(tvi)
    tvi = findlast(ee -> ee.var == tv , env.past)
    if is_notfound_marker(tvi)
      return false
    end
    return true
  end
  return true
end

function env_sym_in_scope(env::Env, tv)
  tvi = findlast(ee -> isa(ee,VEnv) && ee.var == TVar(tv) , env.curr)
  if is_notfound_marker(tvi)
    return false
  end
  return true
end

function env_delete!(env::Env, tv::TVar)
  # debug_out(string("<EnvDelete>",tv))
  assert(env.curr[end].var == tv)
  dv = pop!(env.curr)     
  append!(env.past, [dv]) 

  # FZN EXPERIMENT
  # if env.curr[end].tag == TagRight()
  #   dv = pop!(env.curr)
  #   # for i in 1:length(env.curr)
  #   #   ee = env.curr[i]
  #   #   if isa(ee,VEnv)
  #   #     debug_out(string("<eeBefore>", env.curr[i], "</eeBefore>"))
  #   #     nub = substitute(ee.ub, tv, dv.ub)
  #   #     nlb = substitute(ee.lb, tv, dv.ub)
  #   #     env.curr[i] = VEnv(ee.var, nlb, nub, ee.tag, ee.occ, ee.static_diag)
  #   #     debug_out(string("<eeAfter>", env.curr[i], "</eeAfter>"))
  #   #   end
  #   #end
  # else
  #   dv = pop!(env.curr)        # FZN this was the old code
  #   append!(env.past, [dv]) 
  # end
  
  #
  #
  # for i in 1:length(env)
  #   ee = env[i]
  #   if isa(ee,VEnv)
  #     debug_out(string("<eeBefore>", env[i], "</eeBefore>"))
  #     nub = substitute(ee.ub, tv, TAny())
  #     nlb = substitute(ee.lb, tv, TUnion([]))
  #     env[i] = VEnv(ee.var, nlb, nub, ee.tag)
  #     debug_out(string("<eeAfter>", env[i], "</eeAfter>"))
  #
  #   end
  # end
  # debug_out("</EnvDelete>")
  # filter!(ee -> !(isa(ee,VEnv)) || ee.var != tv, env)
end

function env_delete!(env::Env, ::EnvBarrier)
  @assert isa(env.curr[end], EnvBarrier) "Barrier expected but got $(env.curr[end])"
  pop!(env.curr)
end


##### parallel_substitution

function par_substitute(t::ASTBase, ts::Vector{ASTBase}, vs::Vector{Symbol})
  free_vars = free_variables(t) 
  target_vars = vs
  vars_in_ts = lj_flatten(vcat(map(t1 -> free_variables(t1), ts)))

  for v in vars_in_ts
    if v in target_vars
      nv = lj_gensym(t,TVar(v))
      t = substitute(t,TVar(v),nv)
      target_vars[findfirst(target_vars,v)] = nv.sym
    end
  end
   
  for (t1,v1) in zip(ts, vs)
    t = substitute(t, TVar(v1), t1)
  end
  return t
end
