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

include("lj_inc.jl")

end

using ..lj
