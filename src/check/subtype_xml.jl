################################################################################
### Subtyping for Lambda-Julia types
### ----------------------------------------------------------------------------
###
### NOTE. To be included after [errors.jl], [aux.jl], [AST.jl], 
###       [env.jl], [typeof.jl], and [types_utils.jl]
################################################################################

# Uncomment includes below to get better support from an editor
#=
include("errors.jl")
include("aux/aux.jl")
include("syntax/AST.jl")
include("env.jl")
include("typeof.jl")
include("types_utils.jl")
# =#

#####################       Subtyping                 #####################

### search state

# whenever we find an exist right

mutable struct SS
  history :: Vector{Int}
  replay  :: Bool
  depth   :: Int
end

search_state = SS([],false,0)

function init_search_state()
  global search_state
  search_state = SS([],false,0)
end

function set_replay_search_state()
  global search_state
  search_state.replay = true
  search_state.depth = 0
end

function show(io::IO, ss::SS)
  print(io,"search_state.history: ", ss.history,"\n")
  print(io,"search_state.replay : ", ss.replay,"\n")
  print(io,"search_state,depth  : ", ss.depth,"\n")
end

### output of the algorithm

dump_stats = true

struct SR
  sub :: Bool
  env :: Env
  stats :: RulesStats
end

function show(io::IO, sr::SR)
  global dump_stats
  print(io,"= ",sr.sub,"\n= ",sr.env)
  if dump_stats
    show(io, sr.stats)
  end
end

### Stats counting

function stat_subtype(rn::String, state::ST_State, sr::SR)
  rs = get(state.stats, rn, (0,0))
  state.stats[rn] =  (rs[1]+1, rs[2] + (sr.sub ? 1 : 0))
end

### Debug

function debug_subtype(rn::String, t1::ASTBase, t2::ASTBase, env::Env, state::ST_State)
  global f_debug_count
  f_debug_count = f_debug_count + 1
  
  if f_debug
    debug_out(string("<rule id=\"",rn,"\">"))
    debug_out(string("<t1>",t1,"</t1>"))
    debug_out(string("<t2>",t2,"</t2>"))
    debug_out(string("<env>",env,"</env>"))
    #debug_out(string("<envFV>",free_variables(env),"</envFV>"))
  end
end

function debug_stat_subtype_result(rn::String, state::ST_State, sr::SR)
  stat_subtype(rules_map(rn), state, sr)
  debug_subtype_result(rn, sr)
end

function debug_stat_subtype_result(mn::String, rn::String, state::ST_State, sr::SR)
  stat_subtype(rn, state, sr)
  debug_subtype_result(mn, sr)
end

function debug_subtype_result(rn::String, sr::SR)
  if f_debug
    debug_out(string("<sub>",sr.sub,"</sub>"))
    debug_out(string("<env>",sr.env,"</env>"))
    debug_out(string("<id>",rn,"</id>"))
    debug_out(string("</rule>"))
  end
end

### counting of occurrences for the diagonal rule

### cannot be done statically, this code is left only of reference

# function count_occurs(v::TVar, t::ASTBase, in_cov::Bool, in_inv::Bool)
#   return Occurs(0,0)
# end

# function count_occurs(v::TVar, t::TVar, in_cov::Bool, in_inv::Bool)
#   if v == t
#     if in_inv
#       return Occurs(0,1)
#     elseif in_cov
#       return Occurs(1,0)
#     end
#   end
#   return Occurs(0,0)
# end

# function count_occurs(v::TVar, t::TTuple, in_cov::Bool, in_inv::Bool)
#   sum(map(t1 -> count_occurs(v,t1,true,in_inv), t.ts))
# end

# function count_occurs(v::TVar, t::TUnion, in_cov::Bool, in_inv::Bool)
#   sum(map(t1 -> count_occurs(v,t1,in_cov,in_inv), t.ts))
# end

# function count_occurs(v::TVar, t::TApp, in_cov::Bool, in_inv::Bool)
#   count_occurs(v,t.t,in_cov,in_inv) + sum(map(t1 -> count_occurs(v,t1,in_cov,true), t.ts))
# end

# function count_occurs(v::TVar, t::TType, in_cov::Bool, in_inv::Bool)
#   return count_occurs(v, t.t, in_cov, true)
# end

# function count_occurs(v::TVar, t::ASTBase)
#   return count_occurs(v,t,false,false)
# end

### consistency check for Env

function consistent_env_var(v::TVar, env::Env, tds::TyDeclCol, state::ST_State)
  # TODO: check with Jeff how they avoid recursive consistency checks.
  if state.in_consistency_check
    return true
  end

  new_state = state_set_in_consistency_check(state)
  
  env_work = Env(Base.filter!(ee -> !(isa(ee,EnvBarrier)), lj_flatten(vcat(env.curr, env.past))), [])
  env_work = deepcopy(env_work)

  vi = findlast(ee -> isa(ee,VEnv) && ee.var == v, env_work.curr)
  if is_notfound_marker(vi)
    lj_error(string("Internal: consistent_env on missing var.  v=",v,"\nenv= ",env_work,"\n"))
  end
  ve = env_work.curr[vi]

  if isa(ve.tag,TagLeft)
    return true
  end
      
  debug_out(string("<ConsistencyCheck>\n<v>",ve,"</v>"))
  if !(lj_subtype(ve.lb, ve.ub, tds, env_work, new_state).sub)
    debug_out("<out>Failed.</out>\n</ConsistencyCheck>")
      return false
    end
  # diagonal check
  if (!state.revised_rules && ve.occ.cov >= 2 && ve.occ.inv == 0 && ve.tag == TagRight()) ||
     (state.revised_rules && ve.static_diag && !ve.occ.disabled) 
    if !(is_concrete(ve.lb, tds))
      debug_out("<diagonal>false</diagonal>\n<out>Failure.</out>\n</ConsistencyCheck>")
      return false
    else
      debug_out("<diagonal>true</diagonal>")
    end
  end
  debug_out("<out>Success.</out>\n</ConsistencyCheck>")

  return true
end

function consistent_env(env::Env, tds::TyDeclCol, state::ST_State)
  if state.in_consistency_check
    return true
  end

  vl = lj_flatten(vcat(map(ee -> ee.var,
                           Base.filter(ee -> isa(ee,VEnv) && isa(ee.tag,TagRight),
                                       vcat(env.curr, env.past)))))
  return all(v -> consistent_env_var(v, env, tds, state), vl)
end

function sr_consistent_env(sr, tds, state)
  if sr.sub == true && !(consistent_env(sr.env, tds, state))
    return SR(false, sr.env, state.stats)
  else
    return sr
  end
end

### experiment: variable bounds cannot depend on discarded variables
### non currently checked

function closed_bounds_var(v::TVar, env)
  debug_out(string("<closedBoundsVar>v = ", v, "</closedBoundsVar>"))
  debug_out(string("<closedBoundsVar>env = ", env, "</closedBoundsVar>"))


  # TODO: refactor search in env
  vi = findlast(ee -> isa(ee,VEnv) && ee.var == v, env.curr)
  if is_notfound_marker(vi)
    lj_error(string("Internal: closed_bounds_var on missing var.  v=",v,"\nenv= ",env,"\n"))
  end
  ve = env.curr[vi]

  # collect all variables in ve.lb and ve.ub
  vars = vcat(free_variables(ve.lb), free_variables(ve.ub))

  # check if they are all defined in env.curr
  res = all(v -> env_sym_in_scope(env,v), vars)
  debug_out(string("<closedBoundsVar>res = ", res, "</closedBoundsVar>"))
  return res
end

### simple simplification of unions (taken from simple_join in subtype.c)

function simple_join(t1::ASTBase, t2::ASTBase)
  if t1 == TUnion([]) || t2 == TAny || t1 == t2
    return t2
  elseif t2 == TUnion([]) || t1 == TAny
    return t1
  # elseif isa(t1,TUnion) && in_union(t1,t2)
  #   return t2
  # elseif isa(t2,TUnion) && in_union(t2,t1)
  #   return t1
  else
    return TUnion([t1, t2])
  end
end
#
#
#     if (!(jl_is_type(a) || jl_is_typevar(a)) || !(jl_is_type(b) || jl_is_typevar(b)))
#         return (jl_value_t*)jl_any_type;
#     if (jl_is_uniontype(a) && in_union(a, b))
#         return a;
#     if (jl_is_uniontype(b) && in_union(b, a))
#         return b;
#     if (jl_is_kind(a) && jl_is_type_type(b) && jl_typeof(jl_tparam0(b)) == a)
#         return a;
#     if (jl_is_kind(b) && jl_is_type_type(a) && jl_typeof(jl_tparam0(a)) == b)
#         return b;
#     if (!jl_has_free_typevars(a) && !jl_has_free_typevars(b)) {
#         if (jl_subtype(a, b)) return b;
#         if (jl_subtype(b, a)) return a;
#     }
#     return jl_new_struct(jl_uniontype_type, a, b);
# }

#####################  Subtype algorithm ####################

# unless two types are one subtype of the other, they are not.

function lj_subtype(t1::ASTBase, t2::ASTBase, ::TyDeclCol, env::Env, state::ST_State)
    debug_subtype("ASTBase, ASTBase",t1,t2,env,state)
    # last hope, reflexivity
    sr = SR(t1 == t2, env, state.stats)
    debug_stat_subtype_result("ASTBase, ASTBase", 
        sr.sub ? unlj("Refl($(typeof(t1)))") 
               : unlj("($(typeof(t1)), $(typeof(t2)))"),
        state, sr)
    return sr
end

# any is supertype of all types

function lj_subtype_Any_Right(t1::ASTBase, t2::TAny, tds::TyDeclCol, env::Env, state::ST_State)
    sr = SR(true, env, state.stats)
    debug_stat_subtype_result("Any_Right", state, sr)
    return sr
end

function lj_subtype(t1::TType, t2::TAny, tds::TyDeclCol, env::Env, state::ST_State)
    debug_subtype("TType, TAny",t1,t2,env,state)
    lj_subtype_Any_Right(t1,t2,tds,env,state)
end

function lj_subtype(t1::TWhere, t2::TAny, tds::TyDeclCol, env::Env, state::ST_State)
    debug_subtype("TWhere, TAny",t1,t2,env,state)
    lj_subtype_Any_Right(t1,t2,tds,env,state)
end

function lj_subtype(t1::ASTBase, t2::TAny, tds::TyDeclCol, env::Env, state::ST_State)
    debug_subtype("ASTBase, TAny",t1,t2,env,state)
    lj_subtype_Any_Right(t1,t2,tds,env,state)
end

function lj_subtype(t1::TVar, t2::TAny, tds::TyDeclCol, env::Env, state::ST_State)
    debug_subtype("TVar, TAny",t1,t2,env,state)
    lj_subtype_Any_Right(t1,t2,tds,env,state)
end

# unions obey a forall/exist strategy

function lj_subtype(t1::TUnion, t2::TAny, tds::TyDeclCol, env::Env, state::ST_State)
    debug_subtype("TUnion, TAny",t1,t2,env,state)
    sr = SR(true, env, state.stats)
    debug_stat_subtype_result("TUnion, TAny", state, sr)
    return sr
end

function env_merge_barrier(env_new::Env, env_old::Env)
  # TODO: think about merging env.past...  is it always the same?  Answer, no.
  bi_new = findlast(ee -> isa(ee,EnvBarrier), env_new.curr)
  bi_old = findlast(ee -> isa(ee,EnvBarrier), env_old.curr)
  assert(bi_new == bi_old)
  # env = Env(append!(env_new.curr[1:bi_new], env_old.curr[bi_new+1:end]), env_old.past)
  # julia-0.7 changes behaviour of findlast:
  # if element is not found, it return [nothing] instead of 0
  if is_notfound_marker(bi_new)
    env = Env(Vector(env_old.curr[1:end]), vcat(env_new.past, env_old.past))
  else
    env = Env(append!(env_new.curr[1:bi_new], env_old.curr[bi_new+1:end]), vcat(env_new.past, env_old.past))
  end
  return env
end

function restore_occ_env_entry(ee::EnvEntry, env::Env)
  if isa(ee, EnvBarrier) || isa(ee.tag, TagLeft) || ee.occ.disabled
    return ee
  else
    ei = findlast(e -> isa(e,VEnv) && e.var == ee.var, env.curr)
    if is_notfound_marker(ei)
      error("Internal: restore_occ, not found")
    else
      return VEnv(ee.var, ee.lb, ee.ub, ee.tag,
                  Occurs(env.curr[ei].occ.disabled, env.curr[ei].occ.cov, env.curr[ei].occ.inv),
                  ee.static_diag)
    end
  end
end

function restore_occ_from_env(env::Env, init_env::Env)
  restored_env_curr = map(ee -> restore_occ_env_entry(ee,init_env), env.curr)
  return(Env(restored_env_curr, env.past))
end


function restore_occ_env_entry(ee::EnvEntry, occs_dict)
  if isa(ee, EnvBarrier) || isa(ee.tag, TagLeft) || ee.occ.disabled
    return ee
  else
    return VEnv(ee.var, ee.lb, ee.ub, ee.tag,
                Occurs(ee.occ.disabled, occs_dict[ee.var][1], occs_dict[ee.var][2]),
                ee.static_diag)
  end
end


function restore_occ_to_env(env::Env, occs_dict)
  restored_env_curr = map(ee -> restore_occ_to_env_entry(ee,occs_dict), env.curr)
  return(Env(restored_env_curr, env.past))
end

function save_occ(env::Env)
  occs_dict = Dict()
  for ee in env.curr
    if isa(ee, VEnv) && isa(ee.tag, TagRight)
      occs_dict[ee.var] = (ee.occ.cov, ee.occ.inv)
    end
  end
  return occs_dict
end

function update_max_occ(occs_dict, env::Env)
  for ee in env.curr
    if isa(ee, VEnv) && isa(ee.tag, TagRight)
      try
        if ee.occ.cov > occs_dict[ee.var][1] || ee.occ.inv > occs_dict[ee.var][2]
          occs_dict[ee.var] = (ee.occ.cov, ee.occ.inv)
        end
      catch error
        occs_dict[ee.var] = (ee.occ.cov, ee.occ.inv)
      end
    end
  end
end

function lj_subtype_Union_Left(t1::TUnion, t2:: ASTBase, tds::TyDeclCol, env::Env, state::ST_State)
  env_init = deepcopy(env)
  env_max_occ = save_occ(env_init)
  
  for ti in t1.ts
    env_saved = deepcopy(env)
    sr = lj_subtype(ti, t2, tds, env, state)
    if !sr.sub || !consistent_env(sr.env, tds, state)   # check consistency before discarding
      debug_stat_subtype_result("Union_Left", state, sr)
      return sr
    end

    if !state.revised_rules
      # merging is needed to get dynamic count of vars right
      # env = env_merge_barrier(sr.env, env_saved)
      update_max_occ(env_max_occ, sr.env)
      env = restore_occ_from_env(sr.env, env_init)
    else
      env = sr.env
    end
  end
  sr = SR(true, env, state.stats)
  debug_stat_subtype_result("Union_Left", state, sr)
  return sr
end

function lj_subtype(t1::TUnion, t2::TUnion, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TUnion, TUnion",t1,t2,env,state)
  lj_subtype_Union_Left(t1,t2,tds,env,state)
end

function lj_subtype(t1::TUnion, t2::TVar, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TUnion, TVar",t1,t2,env,state)

  #lj_subtype_Var_Right(t1,t2,tds,env,state)
  lj_subtype_Union_Left(t1,t2,tds,env,state)
end

function lj_subtype(t1::TUnion, t2::TType, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TUnion, TType",t1,t2,env,state)

  lj_subtype_Union_Left(t1,t2,tds,env,state)
end

function lj_subtype(t1::TUnion, t2::TWhere, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TUnion, TWhere",t1,t2,env,state)
  lj_subtype_Union_Left(t1,t2,tds,env,state)
end

function lj_subtype(t1::TUnion, t2::ASTBase, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TUnion, ASTBase",t1,t2,env,state)
  lj_subtype_Union_Left(t1,t2,tds,env,state)
end

function lj_subtype_Union_Right(t1::ASTBase, t2::TUnion, tds::TyDeclCol, env::Env, state::ST_State)
  (t2n, changed) = lj_fold_union_tuple(t2)
  if changed
    debug_subtype("ASTBase, TUnion-unlift",t1,t2n,env,state)
    sr = lj_subtype(t1, t2n, tds, env, state)
    debug_stat_subtype_result("Union-unlift_Right", state, sr)
    return sr
  else    
    sr = lj_subtype_Union_Right_internal(t1, t2, tds, env, state)
    return sr
  end
end

function lj_subtype_Union_Right_internal(t1::ASTBase, t2::TUnion, tds::TyDeclCol, env::Env, state::ST_State)
  global search_state

  env_saved = deepcopy(env)

  # check if replay mode is active
  # HACK: exhastive search is disabled in consistency checks
  if search_state.replay && !state.in_consistency_check

    # check depth against length of history
    if search_state.depth == length(search_state.history) - 1

      idx = search_state.history[search_state.depth+1]

      if idx == length(t2.ts)
        # we have explored all the options at this level
        deleteat!(search_state.history, length(search_state.history))
        sr = SR(false, env_saved, state.stats)
        debug_stat_subtype_result("Union_Right", state, sr)
        return sr
      else
        # we have not explored all the options at this level
        search_state.replay = false
        search_state.history[end] = idx+1

        sr = lj_subtype(t1,t2.ts[idx+1],tds,env_saved,state)
        debug_stat_subtype_result("Union_Right", state, sr)
        return sr
      end
    else
      # replay across one more depth level
      search_state.depth = search_state.depth + 1
      sr = lj_subtype(t1,t2.ts[search_state.history[search_state.depth]],tds,env_saved,state)
      debug_stat_subtype_result("Union_Right", state, sr)
      return sr
    end

  else
    if !state.in_consistency_check
      append!(search_state.history, 0)
      idx = 0
    end

    for ti in t2.ts
      if !state.in_consistency_check
        idx = idx + 1
        search_state.history[end] = idx
      end

      sr = lj_subtype(t1,ti,tds,env_saved,state)
      if sr.sub
        # If an inner test involving unions succeed, we should discard
        # the relevant bits of the history
        # A good example is:
        # lj_subtype("Tuple{Ref{Union{Bool, String}}, Any}",
        #            "Tuple{Ref{Union{Bool, String}}, Union{Bool, String}}")
        if length(search_state.history) >= 2  # FZN: check this 
          deleteat!(search_state.history, length(search_state.history)) 
        end
        
        debug_stat_subtype_result("Union_Right", state, sr)
        return sr
      end
      env_saved = deepcopy(env)
    end

    if !state.in_consistency_check
      deleteat!(search_state.history, length(search_state.history))
    end
    sr = SR(false, env_saved, state.stats)
    debug_stat_subtype_result("Union_Right", state, sr)
    return sr
  end
end

function lj_subtype(t1::TName, t2::TUnion, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TName, TUnion",t1,t2,env,state)
  lj_subtype_Union_Right(t1,t2,tds,env,state)
end

function lj_subtype(t1::TType, t2::TUnion, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TType, TUnion",t1,t2,env,state)
  lj_subtype_Union_Right(t1,t2,tds,env,state)
end

function lj_subtype(t1::TVar, t2::TUnion, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TVar, TUnion",t1,t2,env,state)
  # this helps to guide the search and get the forall/exist quantification right
  # it might not be complete if the Union in the v1 bound is not at top_level
  v1 = env_search(env, t1)
  if !state.revised_rules
    if (v1.tag == TagLeft() && isa(lift_union(v1.ub,env), TUnion)) || 
       (v1.tag == TagRight() && isa(lift_union(v1.lb,env), TUnion)) || 
       t2 == TUnion([])
      lj_subtype_Var_Left(t1,t2,tds,env,state)
    else
      lj_subtype_Union_Right(t1,t2,tds,env,state)
    end
  else
    if (v1.tag == TagLeft() && isa(v1.ub, TUnion)) || 
       (v1.tag == TagRight() && isa(v1.lb, TUnion)) || 
       t2 == TUnion([])
      lj_subtype_Var_Left(t1,t2,tds,env,state)
    else
      lj_subtype_Union_Right(t1,t2,tds,env,state)
    end
  end    
end

function lj_subtype(t1::ASTBase, t2::TUnion, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("ASTBase, TUnion",t1,t2,env,state)
  lj_subtype_Union_Right(t1, t2, tds, env, state)
end

# var_left

function lj_subtype_Var_Left(t1::TVar, t2::ASTBase, tds::TyDeclCol, env::Env, state::ST_State)
  v1 = env_search(env, t1)

  new_state = state_disable_occurrence_counting(state)
  
  work_env = deepcopy(env)

  if v1.tag == TagLeft()
    srt = lj_subtype(v1.ub, substitute(t2,t1,v1.ub), tds, substitute(work_env, t1,v1.ub), new_state)
    sr = SR(srt.sub, env, state.stats)
    debug_stat_subtype_result("Var_Left", "L_Left", state, sr)
  else
    # no need to substitute for TagRight
    # srt = lj_subtype(v1.lb, substitute(t2,t1,v1.lb), tds, work_env, new_state)
    srt = lj_subtype(v1.lb, t2, tds, work_env, new_state)

    # a priori we need to compute an intersection here.
    # Jeff says this is always the previous type, so let's assert this.
    # debug_out(string("\n@@ t = ", t2, "\n@@ u = ", v1.ub, "\n@@ check that meet(t,u) = t\n"))
    env_replace!(env, t1, v1.lb, t2, TagRight(), state)
    sr = SR(srt.sub, env, state.stats)
    debug_stat_subtype_result("Var_Left", "R_Left", state, sr)
  end
  return sr
end

function lj_subtype(t1::TVar, t2::ASTBase, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TVar, ASTBase",t1,t2,env,state)
  return lj_subtype_Var_Left(t1,t2,tds,env,state)
end

# var_right

function lj_subtype_Var_Right(t1::ASTBase, t2::TVar, tds::TyDeclCol, env::Env, state::ST_State)
  v2 = env_search(env, t2)

  new_state = state_disable_occurrence_counting(state)
  
  work_env = deepcopy(env)

  if v2.tag == TagLeft()
    srt = lj_subtype(substitute(t1,t2,v2.lb), v2.lb, tds, work_env, new_state)
    sr = SR(srt.sub, env, state.stats)
    debug_stat_subtype_result("Var_Right", "L_Right", state, sr)
  else
    srt = lj_subtype(substitute(t1,t2,v2.ub), v2.ub, tds, work_env, new_state)
    env_replace!(env, t2, simple_join(v2.lb, t1), v2.ub, TagRight(), state)
    sr = SR(srt.sub, env, state.stats)
    debug_stat_subtype_result("Var_Right", "R_Right", state, sr)
  end
  return sr
end

function lj_subtype(t1::ASTBase, t2::TVar, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("ASTBase, TVar",t1,t2,env,state)
  lj_subtype_Var_Right(t1,t2,tds,env, state)
end

function lj_subtype(t1::TType, t2::TVar, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TType, TVar",t1,t2,env,state)
  lj_subtype_Var_Right(t1,t2,tds,env, state)
end

# special case when comparing two vars
# TODO: think when one of the bounds is itself a variable

function outside(t1::TVar, t2::TVar, env::Env)
  tv1 = findlast(ee -> isa(ee,VEnv) && ee.var == t1, env.curr)
  tv2 = findlast(ee -> isa(ee,VEnv) && ee.var == t2, env.curr)
  ## Julia 0.6.0 returns 0 if [findlast] does not find an element,
  ## so the call [tv1 < tv2] is always valid.
  ## In julia 0.7.0 [findlast] returns nothing in this case.
  if is_notfound_marker(tv1)
    tv1 = 0
  end
  if is_notfound_marker(tv2)
    tv2 = 0
  end
  if tv1 < tv2
    tvb = findlast(ee -> isa(ee,EnvBarrier), env.curr[tv1:tv2])
    if is_notfound_marker(tvb)
      return false
    else
      return true
    end
  else
    return false
  end
end

function lj_subtype(t1::TVar, t2::TVar, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TVar, TVar",t1,t2,env,state)

  if t1 == t2
    sr = SR(true, env, state.stats)
    debug_stat_subtype_result("TVar, TVar", "Refl(TVar)", state, sr)
    return sr
  end

  v1 = env_search(env, t1)
  v2 = env_search(env, t2)

  new_state = state # state_disable_occurrence_counting(state)

  if (v2.tag == TagLeft() && v1.tag == TagLeft())
    return lj_subtype_Var_Left(t1,t2,tds,env,new_state)
  elseif v2.tag == TagLeft() && v1.tag == TagRight()
    debug_out(string("<Outside>",t1," - ",t2," : ",outside(t1,t2,env),"</Outside>"))
    if outside(t1,t2,env)
      env_aux = deepcopy(env)
      sr1 = lj_subtype(v2.ub,v2.lb,tds,env_aux,new_state)
      if !(sr1.sub)
        sr = SR(false, sr1.env, state.stats)
        debug_stat_subtype_result("TVar, TVar", "R_L", state, sr)
        return sr
      end
    end
    return lj_subtype_Var_Left(t1,t2,tds,env,new_state)

#     if v1.tag == TagLeft()
#       sr = lj_subtype(v1.ub, v2.lb, tds, env)
#     elseif v1.tag == TagRight()
# #      sr = lj_subtype_Var_Left(t1,t2,tds,env)
#       sr = lj_subtype(v1.lb, v2.lb, tds, env)
#       # a priori we need to compute an intersection here.
#       # Jeff says this is always the previous type, so let's assert this.
#       # debug_out(string("\n@@ t = ", t2, "\n@@ u = ", v1.ub, "\n@@ check that meet(t,u) = t\n"))
#       # env_replace!(sr.env, t1, v1.lb, v2.lb , TagRight())
#     end
  elseif v2.tag == TagRight()
    if v1.tag == TagLeft()
      if v2.ub == t1
        env_replace!(env, t2, simple_join(v2.lb, t1), v2.ub, TagRight(), new_state)
        sr = SR(true, env, state.stats)
      else
        # sr = lj_subtype(v1.ub, v2.ub, tds, env, state)
        # env_replace!(sr.env, t2, simple_join(v2.lb, t1), v2.ub, TagRight(), new_state)
        env_copy = deepcopy(env)
        srt = lj_subtype(v1.ub, v2.ub, tds, substitute(env_copy,t1,v1.ub), state)
        env_replace!(env, t2, simple_join(v2.lb, t1), v2.ub, TagRight(), new_state)
        sr = SR(srt.sub, env, state.stats)
      end
    elseif v1.tag == TagRight()
      env_copy = deepcopy(env)
      srt = lj_subtype(v1.lb, v2.ub, tds, env_copy, new_state)
      env_replace!(env, t2, simple_join(v2.lb, v1.lb), v2.ub, TagRight(), new_state)
      env_replace!(env, t1, v1.lb, v2.ub, TagRight(), new_state)
      sr = SR(srt.sub, env, state.stats)
    end
  end
  debug_stat_subtype_result("TVar, TVar", "R_Right", state, sr)
  return sr
end

# unionall

function lj_subtype_Where_Left(t1::TWhere, t2::ASTBase, tds::TyDeclCol, env::Env, state::ST_State)
  t1v = t1.tvar
  t1t = t1.t
  if env_conflict(env, t1.tvar)
    (t1v, t1t) = freshen(env, t1.tvar, t1.t)
  end
  env_add!(env, t1v, t1.lb, t1.ub, TagLeft(), t1.diag, tds)

  sr = lj_subtype(t1t, t2, tds, env, state)

  if sr.sub == true  && !(consistent_env_var(t1v, sr.env, tds, state))
    debug_out(string("<error>** env not consistent: ",env,"</error>"))
    sr = SR(false, sr.env, state.stats)
    env_delete!(sr.env, t1v)

    debug_stat_subtype_result("Where_Left", state, sr)
    return sr
  end

  env_delete!(sr.env, t1v)

  sr = SR(sr.sub, sr.env, state.stats)
  debug_stat_subtype_result("Where_Left", state, sr)
  return sr
end

function lj_subtype(t1::TWhere, t2::TWhere, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TWhere, TWhere",t1,t2,env,state)
  lj_subtype_Where_Left(t1,t2,tds,env,state)
end

function lj_subtype(t1::TWhere, t2::TType, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TWhere, TType",t1,t2,env,state)
  lj_subtype_Where_Left(t1,t2,tds,env,state)
end

function lj_subtype(t1::TWhere, t2::TUnion, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TWhere, TUnion",t1,t2,env,state)
  lj_subtype_Where_Left(t1,t2,tds,env,state)
end

function lj_subtype(t1::TWhere, t2::TVar, tds::TyDeclCol, env::Env, state::ST_State)
 debug_subtype("TWhere, TVar",t1,t2,env,state)
 #lj_subtype_Where_Left(t1,t2,tds,env,state)  
 lj_subtype_Var_Right(t1,t2,tds,env,state)  
end

function lj_subtype(t1::TWhere, t2::ASTBase, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TWhere, ASTBase",t1,t2,env,state)
  lj_subtype_Where_Left(t1,t2,tds,env,state)
end

function lj_subtype_Where_Right(t1::ASTBase, t2::TWhere, tds::TyDeclCol, env::Env, state::ST_State)
  t2v = t2.tvar
  t2t = t2.t
  if env_conflict(env, t2.tvar)
    (t2v, t2t) = freshen(env, t2.tvar, t2.t)
  end

  env_add!(env, t2v, t2.lb, t2.ub, TagRight(), t2.diag, tds)

  sr = lj_subtype(t1, t2t, tds, env, state)

  if sr.sub == true && !(consistent_env_var(t2v, sr.env, tds, state))
    # || !(closed_bounds_var(t2v, sr.env))) # experiment, checking closed bounds
    debug_out(string("<error>not consistent: ",env,"</error>"))
    env_delete!(sr.env, t2v)
    sr = SR(false, sr.env, state.stats)

    debug_stat_subtype_result("Where_Right", state, sr)
    return sr
  end

  env_delete!(sr.env, t2v)

  sr = SR(sr.sub, sr.env, state.stats)
  debug_stat_subtype_result("Where_Right", state, sr)
  return sr
end

function lj_subtype(t1::ASTBase, t2::TWhere, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("ASTBase, TWhere",t1,t2,env,state)
  if isa(t1,TName)
    # replace name by its definition (e.g. Pair(A,B) where A where B from Pair)
    new_t1 = def_from_name(t1, tds)
    sr = lj_subtype(new_t1, t2, tds, env, state)
  else
    if !state.revised_rules
      t1_lift_union = lift_union(t1, env)
      if t1 == t1_lift_union
        sr = lj_subtype_Where_Right(t1, t2, tds, env, state)
        return sr
      else
        sr = lj_subtype(t1_lift_union, t2, tds, env, state)
        stat_subtype("Lift_Union", state, sr)
        return sr
      end
#    sr = lj_subtype_Where_Right(t1,t2,tds,env,state)
    else
      sr = lj_subtype_Where_Right(t1, t2, tds, env, state)
    #  debug_subtype_result("ASTBase, TWhere",sr)
      return sr
    end
  end
end

function lj_subtype(t1::TName, t2::TWhere, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TName, TWhere",t1,t2,env,state)

  lj_subtype_Where_Right(t1,t2,tds,env,state)
end

function lj_subtype(t1::TVar, t2::TWhere, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TVar, TWhere",t1,t2,env,state)
  # lj_subtype_Where_Right(t1,t2,tds,env,state)  
  lj_subtype_Var_Left(t1,t2,tds,env,state)  
end

function lj_subtype(t1::TType, t2::TWhere, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TType, TWhere",t1,t2,env,state)
  lj_subtype_Where_Right(t1,t2,tds,env,state)
end

# tuples are covariant

function lj_subtype(t1::TTuple, t2::TSuperTuple, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TTuple, TSuperTuple",t1,t2,env,state)

  sr = SR(true, env, state.stats)
  debug_stat_subtype_result("TTuple, TSuperTuple", state, sr)
  return sr
end

function lj_subtype(t1::TTuple, t2::TUnion, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TTuple, ASTBase",t1,t2,env,state)

  if !state.revised_rules
    t1_lift_union = lift_union(t1, env)
    if t1 == t1_lift_union
      lj_subtype_Union_Right(t1, t2, tds, env, state)
    else
      sr = lj_subtype(t1_lift_union, t2, tds, env, state)
      stat_subtype("Lift_Union", state, sr)
      debug_subtype_result("TTuple, ASTBase",sr)
      return sr
    end
  else
    lj_subtype_Union_Right(t1, t2, tds, env, state)
  end
end

function lj_subtype(t1::TTuple, t2::TTuple, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TTuple, TTuple",t1,t2,env,state)

  if length(t1.ts) != length(t2.ts)
    sr = SR(false, env, state.stats)
    stat_subtype("Tuple", state, sr)
    return sr
  end

  if !state.revised_rules
    t1_lift_union = lift_union(t1, env)
    if t1 != t1_lift_union
      sr = lj_subtype(t1_lift_union,t2,tds,env,state)
      debug_subtype_result("TTuple, TTuple",sr)
      stat_subtype("Lift_Union", state, sr)
      return sr
    end
  end

  # this DOES NOT avoid the need for the exists backtracking
  # t2_lift_union = lift_union(t2)
  # if t2 != t2_lift_union
  #   sr = lj_subtype(t1,t2_lift_union,tds,env,state)
  #   debug_subtype_result(sr)
  #   return sr
  # end

  new_state = state_set_covariant_position(state)

  ts = [(t1.ts[i],t2.ts[i]) for i in 1:length(t1.ts)]
  env_iter = env
  sr = SR(true, env, state.stats)
  for tp in ts
    sr = lj_subtype(tp[1], tp[2], tds, env_iter, new_state)   # diagonal check
    if sr.sub == false
      debug_stat_subtype_result("TTuple, TTuple", state, sr)
      return sr
    else
      env_iter = sr.env
    end
  end
  if !consistent_env(sr.env, tds, state)
    sr = SR(false, sr.env, state.stats)
    debug_stat_subtype_result("TTuple, TTuple", state, sr)
    return sr
  end

  debug_stat_subtype_result("TTuple, TTuple", state, sr)
  return sr
end

function lj_subtype(t1::TName, t2::TName, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TName, TName",t1,t2,env,state)
  if t1 == t2
    sr = SR(true, env, state.stats)
    debug_stat_subtype_result("TName, TName", "Refl(Name)", state, sr)
  else
    td1 = lj_lookup(t1, tds)
    sr = lj_subtype(td1.super, t2, tds, env, state)
    debug_stat_subtype_result("TName, TName", "Name_Super", state, sr)
  end
  return sr
end

### type application is invariant

function lj_simplify_app(t::TApp)
  # Either the callee is a name, and there is nothing to simplify
  if isa(t.t, TName)
    return (false,t)
  # Or the callee is a where, and we compute the application
  elseif isa(t.t, TWhere)
    if length(t.ts) == 0
      return (true, t.t.t)
    elseif length(t.ts) == 1
      return (true, substitute(t.t.t, t.t.tvar, t.ts[1]))
    elseif length(t.ts) > 1
      return (true, TApp(substitute(t.t.t, t.t.tvar, t.ts[1]), t.ts[2:end]))
    end
  else
    error(string("LHS of a TApp is not TName or TWhere: ", t))
  end
end

function def_from_name(t::TName, tds)
  td = lj_lookup(t, tds)
  vars = map(v -> TVar(v[2]), td.params)
  new_t = TApp(t, vars)
  for v in td.params
    new_t = TWhere(new_t,TVar(v[2]),v[1],v[3])
  end
  return new_t
end

function search_supertype(t1::TAny, t2::ASTBase, tds)
  return (false,t1,t2)
end

function search_supertype(t1::TAny, t2::TAny, tds)
  return (true,t1,t2)
end

function search_supertype(t1::TName, t2::ASTBase, tds)
  if t1 == t2
    return (true,t1,t2)
  else
    td1 = lj_lookup(t1, tds)
    # debug_out(string("<ready>", td1, "</ready>"))
    search_supertype(td1.super, t2, tds)
  end
end

function search_supertype(t1::TType, t2::ASTBase, tds)
  return (false,t1,t2)
end

function search_supertype(t1::TType, t2::TType, tds)
  return (true,t1,t2)
end

function search_supertype(t1::TApp, t2::ASTBase, tds)
  # debug_out(string("<ss>", t1 ," ",t2,"</ss>"))
  if (isa(t2, TName) && t1.t == t2) || (isa(t2,TApp) && t1.t == t2.t)
    # debug_out(string("<found>", t1 ,"</found>"))
    return (true,t1,t2)
  else
    # search for t1.t def in tds
    # parse the def...  name { args } <: name' { args' }
    # build new t1 as name' { subst xxx }
    # iterate

    td1 = lj_lookup(t1.t, tds)

    # debug_out(string("<lookup>", td1, "</lookup>"))

    td1_vars = map(t -> t[2], td1.params)
    if length(td1_vars) < length(t1.ts)
      error(string("Too many parameters: ", t1.ts," for ", td1))
    end

    nt1 = td1.super
    nt1 = par_substitute(nt1, t1.ts, td1_vars)

    # debug_out(string("<ready>", nt1, "</ready>"))

    search_supertype(nt1, t2, tds)
  end
end

function invariance_check(t1::ASTBase, t2::ASTBase, tds::TyDeclCol, env::Env, state::ST_State)
  env_add!(env, EnvBarrier())

  debug_out("<LeftToRight>")
  debug_out(string("<env>", env,"</env>"))

  sr = lj_subtype(t1, t2, tds, env, state)

  debug_out(string("<sub>",sr.sub,"</sub>"))
  debug_out(string("<env>",sr.env,"</env>"))
  debug_out("</LeftToRight>")

  if sr.sub == true
    debug_out("<RightToLeft>")
    debug_out(string("<env>", sr.env,"</env>"))
    new_state = state_disable_occurrence_counting(state)

    sr = lj_subtype(t2, t1, tds, sr.env, new_state)

    debug_out(string("<sub>",sr.sub,"</sub>"))
    debug_out(string("<env>",sr.env,"</env>"))
    debug_out("</RightToLeft>")

  end

  env_delete!(sr.env, EnvBarrier())

  debug_subtype_result("InvCheck1",sr)
  return sr
end

function invariance_check(ts1::Vector{ASTBase}, ts2::Vector{ASTBase}, tds::TyDeclCol, env::Env, state::ST_State)
  env_add!(env, EnvBarrier())

  ts = [(ts1[i],ts2[i]) for i in 1:length(ts2)]
  sr = SR(true, env, state.stats)
  env_iter = env
  res = true
  new_state = state_disable_occurrence_counting(state)
  for tp in ts
    debug_out("<LeftToRight>")
    debug_out(string("<env>", env,"</env>"))
    sr = lj_subtype(tp[1], tp[2], tds, env_iter, state)
    res = res && sr.sub
    env_iter = sr.env
    debug_out(string("<sub>",sr.sub,"</sub>"))
    debug_out(string("<env>",sr.env,"</env>"))
    debug_out("</LeftToRight>")
    if res == false
      break
    end
    debug_out("<RightToLeft>")
    debug_out(string("<env>", env_iter,"</env>"))
    sr = lj_subtype(tp[2], tp[1], tds, env_iter, new_state)
    res = res && sr.sub
    env_iter = sr.env
    debug_out(string("<sub>",sr.sub,"</sub>"))
    debug_out(string("<env>",sr.env,"</env>"))
    debug_out("</RightToLeft>")
    if res == false
      break
    end
  end

  sr = SR(res, env_iter, state.stats)

  env_delete!(sr.env, EnvBarrier())

  debug_subtype_result("InvCheckGen",sr)
  return sr
end

function lj_subtype(t1::TApp, t2::TApp, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TApp, TApp",t1,t2,env,state)

  (flag1,st1) = lj_simplify_app(t1)
  (flag2,st2) = lj_simplify_app(t2)
  if flag1 || flag2
    debug_out(string("<simplifyApp>", st1, "</simplifyApp>"))
    debug_out(string("<simplifyApp>", st2, "</simplifyApp>"))
    sr = lj_subtype(st1, st2, tds, env, state)
    debug_stat_subtype_result("TApp, TApp", state, sr)
    return sr
  end

  (found,t1,t2) = search_supertype(t1,t2,tds)

  if !found
    sr = SR(false, env, state.stats)
    debug_stat_subtype_result("TApp, TApp", state, sr)
    return sr
  end

  new_state = state_set_invariant_position(state)
  sr = invariance_check(t1.ts, t2.ts, tds, env, new_state)
  stat_subtype("App_Inv", state, sr)
  return sr
end

# the degenerate cases
function lj_subtype(t1::TApp, t2::TName, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TApp, TName",t1,t2,env,state)

  (flag,st1) = lj_simplify_app(t1)
  if flag
    debug_out(string("<simplifyApp>", st1, "</simplifyApp>"))
    sr = lj_subtype(st1, t2, tds, env, state)
    debug_stat_subtype_result("TApp, TName", state, sr)
    return sr
  end

  (found,t1,t2) = search_supertype(t1,t2,tds)

  if !found
    sr = SR(false, env, state.stats)
    debug_stat_subtype_result("TApp, TName", state, sr)
    return sr
  end

  sr = SR((isa(t1,TApp) && t1.t == t2) || (isa(t1,TName) && t1 == t2), env, state.stats)
  debug_stat_subtype_result("TApp, TName", state, sr)
  return sr
end

function lj_subtype(t1::TApp, t2::ASTBase, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TApp, ASTBase",t1,t2,env,state)

  (flag,st1) = lj_simplify_app(t1)
  if flag
    debug_out(string("<simplifyApp>", st1, "</simplifyApp>"))
    sr = lj_subtype(st1, t2, tds, env, state)
  else
    sr = SR(false, env, state.stats)
  end
  debug_stat_subtype_result("TApp, ASTBase", unlj("App_T($(typeof(t2)))"), state, sr)
  return sr
end

function lj_subtype(t1::ASTBase, t2::TApp, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("ASTBase, TApp",t1,t2,env,state)

  (flag,st2) = lj_simplify_app(t2)
  if flag
    debug_out(string("<simplifyApp>", st2, "</simplifyApp>"))
    sr = lj_subtype(t1, st2, tds, env, state)
  else

    if isa(t1,TName)
      # replace name by its definition (e.g. Pair(A,B) where A where B from Pair)
      new_t1 = def_from_name(t1, tds)
      sr = lj_subtype(new_t1, t2, tds, env, state)
    else
      sr = SR(false, env, state.stats)
    end
  end
  debug_stat_subtype_result("ASTBase, TApp", unlj("($(typeof(t1)), T_App)"), state, sr)
  return sr
end

# the TApp ambiguities

function lj_subtype(t1::TApp, t2::TWhere, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TApp, TWhere",t1,t2,env,state)

  (flag,st1) = lj_simplify_app(t1)
  if flag
    debug_out(string("<simplifyApp>", st1, "</simplifyApp>"))
    sr = lj_subtype(st1, t2, tds, env, state)
    debug_subtype_result("TApp, TWhere",sr)
    return sr
  else
    return lj_subtype_Where_Right(t1,t2,tds,env,state)
  end
end

function lj_subtype(t1::TApp, t2::TUnion, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TApp, TUnion",t1,t2,env,state)

  (flag,st1) = lj_simplify_app(t1)
  if flag
    debug_out(string("<simplifyApp>", st1, "</simplifyApp>"))
    sr = lj_subtype(st1, t2, tds, env, state)
    debug_subtype_result("TApp, TUnion",sr)
    return sr
  else
    return lj_subtype_Union_Right(t1,t2,tds,env,state)
  end
end

function lj_subtype(t1::TApp, t2::TVar, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TApp, TVar",t1,t2,env,state)

  (flag,st1) = lj_simplify_app(t1)
  if flag
    debug_out(string("<simplifyApp>", st1, "</simplifyApp>"))
    sr = lj_subtype(st1, t2, tds, env, state)
    debug_subtype_result("TApp, TVar",sr)
    return sr
  else
    return lj_subtype_Var_Right(t1,t2,tds,env,state)
  end
end

function lj_subtype(t1::TApp, t2::TAny, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TApp, TAny",t1,t2,env,state)
  # TODO: should be Any_Right
  
  sr = SR(true, env, state.stats)
  debug_subtype_result("TApp, TAny",sr)
  return sr
end

function lj_subtype(t1::TWhere, t2::TApp, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TWhere, TApp",t1,t2,env,state)

  (flag,st2) = lj_simplify_app(t2)
  if flag
    debug_out(string("<simplifyApp>", st2, "</simplifyApp>"))
    sr = lj_subtype(t1, st2, tds, env, state)
    debug_subtype_result("TWhere, TApp",sr)
    return sr
  else
    return lj_subtype_Where_Left(t1,t2,tds,env,state)
  end
end

function lj_subtype(t1::TUnion, t2::TApp, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TUnion, TApp",t1,t2,env,state)

  (flag,st2) = lj_simplify_app(t2)
  if flag
    debug_out(string("<simplifyApp>", st2, "</simplifyApp>"))
    sr = lj_subtype(t1, st2, tds, env, state)
    debug_subtype_result("TUnion, TApp",sr)
    return sr
  else
    return lj_subtype_Union_Left(t1,t2,tds,env,state)
  end
end

function lj_subtype(t1::TVar, t2::TApp, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TVar, TApp",t1,t2,env,state)

  (flag,st2) = lj_simplify_app(t2)
  if flag
    debug_out(string("<simplifyApp>", st2, "</simplifyApp>"))
    sr = lj_subtype(t1, st2, tds, env, state)
    debug_subtype_result("TVar, TApp",sr)
    return sr
  else
    return lj_subtype_Var_Left(t1,t2,tds,env,state)
  end
end

# Type(T) is an invariant constructor (TODO: it is more complicated actually)
function lj_subtype(t1::TType, t2::TType, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TType, TType",t1,t2,env,state)

  new_state = state_set_invariant_position(state)
  sr = invariance_check(t1.t, t2.t, tds, env, new_state)
  stat_subtype("Type_Type", state, sr)
  return sr
end

function lj_subtype_Type_Left(t1::TType, t2::ASTBase, tds::TyDeclCol, env::Env, state::ST_State)

  # the following mimicks the code 872 - 882 of subtype.c
  # no attempt at understanding the rationale 
  if !(isa(t1.t, TVar))
    env_saved = deepcopy(env)
    to = lj_typeof(t1.t, tds, env_saved)
    sr = SR(to == t2, env, state.stats)
  else
    sr = SR(false, env, state.stats)
  end
  debug_stat_subtype_result("Type_Left", state, sr)
  return sr
end

function lj_subtype(t1::TType, t2::ASTBase, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TType, ASTBase",t1,t2,env,state)
  lj_subtype_Type_Left(t1,t2,tds,env,state)
end

function lj_subtype(t1::TType, t2::TApp, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TType, TApp",t1,t2,env,state)
  lj_subtype_Type_Left(t1,t2,tds,env,state)
end

function lj_subtype_Type_Right(t1::ASTBase, t2::TType, tds::TyDeclCol, env::Env, state::ST_State)
  # this implements:
  # https://github.com/JuliaLang/julia/pull/22701/commits/f0e3678d4cfa922341e26ceaf85dba5ce99f0c14

  if t1 == TName("TypeofBottom", "Core")  # hack around Core.TypeofBottom
    return lj_subtype(TType(TUnion([])), t2, tds, env, state)
  end
  
  if !(isa(t2.t, TVar)) || !is_kind(t1)
    sr = SR(false, env, state.stats)
    debug_subtype_result("Type_Right",sr)
    return sr
  end

  new_state = state_set_invariant_position(state)
  t2d = env_search(env, t2.t)
  # I believe this call is equivalent to checking that t2d.lb = Bottom
  sr = lj_subtype(TWhere(TType(TVar(:T)), TVar(:T), TUnion([]), TAny()), t2, tds, env, new_state)
  debug_stat_subtype_result("Type_Right", state, sr)
  return sr
end


function lj_subtype(t1::ASTBase, t2::TType, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("ASTBase, TType",t1,t2,env,state)
  lj_subtype_Type_Right(t1,t2,tds,env,state)
end

function lj_subtype(t1::TName, t2::TType, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TName, TType",t1,t2,env,state)

  if (string(t1.name) == "TypeofBottom") && t2.t == TUnion([])
    sr = SR(true, env, state.stats)
    debug_subtype_result("TName, TType",sr)
    return sr
  end    

  lj_subtype_Type_Right(t1,t2,tds,env,state)
end

function lj_subtype(t1::TApp, t2::TType, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TApp, TType",t1,t2,env,state)
  lj_subtype_Type_Right(t1,t2,tds,env,state)
end

function lj_subtype(t1::TVar, t2::TType, tds::TyDeclCol, env::Env, state::ST_State)
  debug_subtype("TVar, TType",t1,t2,env,state)
  lj_subtype_Var_Left(t1,t2,tds,env,state)
end

######################################################## Trivial Subtyping
## To be used in log validation, for logs often contain tests such as
## <huge-tuple> <: Tuple, or <huge-type> <: Any

@enum LJSubTrivialAns LJSUBT_TRUE LJSUBT_FALSE LJSUBT_UNDEF

lj_subtype_trivial(t1::ASTBase, t2::TAny) =
  (LJSUBT_TRUE, RulesStats(Dict{String,Tuple{Int,Int}}("Top" => (1,1))))

lj_subtype_trivial(t1::TTuple, t2::TSuperTuple) =
  (LJSUBT_TRUE, RulesStats(Dict{String,Tuple{Int,Int}}("SuperTuple" => (1,1))))
lj_subtype_trivial(t1::TSuperTuple, t2::TSuperTuple) =
  (LJSUBT_TRUE, RulesStats(Dict{String,Tuple{Int,Int}}("SuperTuple" => (1,1))))
lj_subtype_trivial(t1::TSuperTuple, t2::TTuple) =
  (LJSUBT_FALSE, RulesStats(Dict{String,Tuple{Int,Int}}()))

lj_subtype_trivial(t1::TName, t2::TTuple) =
  (LJSUBT_FALSE, RulesStats(Dict{String,Tuple{Int,Int}}()))

function lj_subtype_trivial(t1::TTuple, t2::TTuple) 
  if length(t1.ts) != length(t2.ts)
    return (LJSUBT_FALSE, RulesStats(Dict{String,Tuple{Int,Int}}("Tuple" => (1,0))))
  end
  # often we compare Tuple{typeof(f), ...} with Tuple{typeof(f), Any...}
  if length(t1.ts) == 0
    return (LJSUBT_TRUE, RulesStats(Dict{String,Tuple{Int,Int}}("Tuple" => (1,1))))
  end
  if t1.ts[1] == t2.ts[1] && all(t -> t == TAny(), t2.ts[2:end])
    len = length(t1.ts)
    return (LJSUBT_TRUE, RulesStats(Dict{String,Tuple{Int,Int}}("Tuple" => (1,1),
                                    "Top" => (len, len))))
  end
  (LJSUBT_UNDEF, RulesStats())
end

lj_subtype_trivial(t1::TName, t2::TName) =
  t1 == t2 ? 
  (LJSUBT_TRUE, RulesStats(Dict{String,Tuple{Int,Int}}("Refl(Name)" => (1,1)))) : 
  (LJSUBT_UNDEF, RulesStats())

lj_subtype_trivial(t1::TUnion, t2::ASTBase) =
  t1 == EmptyUnion ? 
  (LJSUBT_TRUE, RulesStats(Dict{String,Tuple{Int,Int}}("Union_Left" => (1,1)))) : 
  (LJSUBT_UNDEF, RulesStats())

lj_subtype_trivial(t1::TUnion, t2::TAny) =
  (LJSUBT_TRUE, RulesStats(Dict{String,Tuple{Int,Int}}("Top" => (1,1))))

lj_subtype_trivial(t1::ASTBase, t2::ASTBase) = (LJSUBT_UNDEF, RulesStats())
