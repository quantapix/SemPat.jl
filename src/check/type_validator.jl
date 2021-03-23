lj_lookup(t::String) = lj_lookup(lj_parse_type(t), parsed_base_ty_decls)

function lj_simplify(t::String, tds::Vector{String})
    tds1 = merge(parsed_base_ty_decls, make_tydecl_dict(isempty(tds) ? TyDecl[] : map(lj_parse_tydecl_simple, tds)))
    tp = lj_parse_type(t)
    lj_simplify(tp, tds1, Env([], []))
end
    function lj_simplify(t::String)
    tds1 = parsed_base_ty_decls
    tp = lj_parse_type(t)
    lj_simplify(tp, tds1, Env([], []))
end

function lj_typeof(t::String, tds::Vector{String})
    tp = lj_parse_type(t)
    tds1 = merge(parsed_base_ty_decls, make_tydecl_dict(isempty(tds) ? TyDecl[] : map(lj_parse_tydecl_simple, tds)))
    t1 = lj_simplify(tp, tds1, Env([], []))
    lj_typeof(t1, tds1, Env([], []))
end
function lj_typeof(t::String)
    tp = lj_parse_type(t)
    lj_typeof_ast_entry(tp)
end

function lj_typeof_ast_entry(tp::ASTBase)
    tds1 = parsed_base_ty_decls
    t1 = lj_simplify(tp, tds1, Env([], []))
    lj_typeof(t1, tds1, Env([], []))
end

lj_supertype(t1::String, t2::String) = lj_subtype(t2, t1)

function lj_subtype(t1::ASTBase, t2::ASTBase, tds::TyDeclCol=TyDeclCol([]))
  init_debug()
  init_search_state()
  while true
    sr = lj_subtype(t1, t2, tds, Env([], []), ST_initial_state_std())
    if sr.sub && consistent_env(sr.env, tds, ST_initial_state_std()); return sr
    else
      if search_state.history == []
        return SR(false, sr.env, sr.stats)
      else
        debug_out(string("\n", search_state, "\n"))
        set_replay_search_state()
      end
    end
  end
end

function lj_subtype(t1::String, t2::String, tds::Vector{String}=String[])
  tds1 = merge(parsed_base_ty_decls, make_tydecl_dict(isempty(tds) ? TyDecl[] : map(lj_parse_tydecl_simple, tds)))
  nt1 = lj_parse_type(t1)
  nt2 = lj_parse_type(t2)
  lj_subtype_ast_entry(nt1, nt2, tds1)
end

function lj_subtype_ast_entry(t1::ASTBase, t2::ASTBase, tds1=parsed_base_ty_decls)
  if f_debug; @printf "\n<?xml version=\"1.0\"?>\n<check>\n"
  end
  if lj_hugetype_errormode
    if lj_AST_count_union(t1) > LJ_MAX_UNION_COUNT || lj_AST_count_union(t2) > LJ_MAX_UNION_COUNT
      throw(LJErrTypeTooLarge())
    end
  end
  nt1 = betared(t1)
  nt2 = betared(t2)
  if lj_hugetype_errormode
    if lj_AST_size(nt1) > LJ_MAX_NTYPE_SIZE || lj_AST_size(nt2) > LJ_MAX_NTYPE_SIZE
      throw(LJErrTypeTooLarge())
    end
  end
  sr = lj_subtype(nt1, nt2, tds1)
  if f_debug; @printf "</check>\n"
  end
  sr
end

lj_supertype_revised(t1::String, t2::String) = lj_subtype_revised(t2, t1)

function lj_subtype_revised(t1::ASTBase, t2::ASTBase, tds::TyDeclCol=TyDeclCol([]))
  init_debug()
  init_search_state()
  while true
      sr = lj_subtype(t1, t2, tds, Env([], []), ST_initial_state_revised())
    if sr.sub && consistent_env(sr.env, tds, ST_initial_state_revised()); return sr
    else
        if search_state.history == []
        return SR(false, sr.env, sr.stats)
      else
        debug_out(string("\n", search_state, "\n"))
        set_replay_search_state()
      end
    end
  end
end

function lj_subtype_revised(t1::String, t2::String, tds::Vector{String}=String[])
  tds1 = merge(parsed_base_ty_decls, make_tydecl_dict(isempty(tds) ? TyDecl[] : map(lj_parse_tydecl_simple, tds)))
  nt1 = lj_parse_type(t1)
  nt2 = lj_parse_type(t2)
  lj_subtype_ast_entry_revised(nt1, nt2, tds1)
end

function lj_subtype_ast_entry_revised(t1::ASTBase, t2::ASTBase, tds1=parsed_base_ty_decls)
  if f_debug; @printf "\n<?xml version=\"1.0\"?>\n<check>\n"
  end
  if lj_hugetype_errormode
    if lj_AST_count_union(t1) > LJ_MAX_UNION_COUNT || lj_AST_count_union(t2) > LJ_MAX_UNION_COUNT
      throw(LJErrTypeTooLarge())
    end
  end
  nt1 = lj_normalize_type(betared(t1), true, tds1)
  nt2 = lj_normalize_type(betared(t2), true, tds1)
  if lj_hugetype_errormode
    if lj_AST_size(nt1) > LJ_MAX_NTYPE_SIZE || lj_AST_size(nt2) > LJ_MAX_NTYPE_SIZE
      throw(LJErrTypeTooLarge())
    end
  end
  sr = lj_subtype_revised(nt1, nt2, tds1)
  if f_debug; @printf "</check>\n"
  end
  sr
end

lj_subtype_trivial(t1::String, t2::String) = lj_subtype_trivial(lj_parse_type(t1), lj_parse_type(t2))
lj_subtype_trivial_ast_entry(t1::ASTBase, t2::ASTBase) = lj_subtype_trivial(t1, t2)

