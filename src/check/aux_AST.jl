function lj_lookup(t :: TName, tds :: TyDeclCol)
    key = "$(t.qual)::$(t.name)"
    key_orig = key   # source qualified key
    found = true
    while !haskey(tds, key)
        i  = findfirst(lj_equalto('.'), key)
        if is_notfound_marker(i)
          found = false
          break
        end
        key = key[i+1:end]
    end
    if found
      return tds[key]
    end
    # last try of key: unqualified name (':' always occurs in key)
    unqual_name = key[findfirst(lj_equalto(':'), key):end]
    if haskey(tds, unqual_name)
      return tds[unqual_name]
    end
    # if no entries found so far,
    # try to find records that *contain* original or unqualified name
    ambig = false
    tds_keys = keys(tds)
    for name in [key_orig, unqual_name]
      # first try to find all records that contain a key
      candidates = findall(s -> endswith(s, name), tds_keys)
      # if we found exactly one candidate, return it
      if length(candidates) == 1
        return tds[collect(tds_keys)[candidates[1]]]
      # if candidates are ambiguous, remember this fact and go out
      elseif length(candidates) > 1
        ambig = true
        break
      end
    end
    # we didn't find exact match
    # first, process special cases
    if key == "::I"
      throw(LJErrIInType())
    elseif startswith(key, "::getfield")
      throw(LJErrGetfield(key))
    # if ambig == true, we have several candidates
    elseif ambig
      throw(LJErrNameAmbiguous(key_orig))
    # otherwise we don't have information on type
    else
      throw(LJErrNameNotFound("$(t)"))
    end
end

## Return the number of type parameters for a given name
lj_lookup_params_cnt(t :: TName, tds :: TyDeclCol) =
    length(lj_lookup(t, tds).params)

#----------------------------------------- Size of Type

function lj_AST_size(t :: ASTBase)
  throw(LJErrApplicationException("lj_AST_size(t::ASTBase) " * 
  "shouldn't be called (t == $(t))"))
end

SimpleSize1Type = Union{TAny, TVar, TName, TValue,
  TDataType, TUnionAll, TSuperUnion, TSuperTuple}

lj_AST_size(t :: SimpleSize1Type) = 1

lj_AST_size(t :: Union{TUnion, TTuple}) =
  1 + (length(t.ts) > 0 ? sum(map(te -> lj_AST_size(te), t.ts)) : 0)

lj_AST_size(t :: TApp) =
  lj_AST_size(t.t) + 
  (length(t.ts) > 0 ? sum(map(te -> lj_AST_size(te), t.ts)) : 0)

lj_AST_size(t :: TWhere) =
  lj_AST_size(t.t) + 1 + lj_AST_size(t.ub) + lj_AST_size(t.lb)

lj_AST_size(t :: TType) = 1 + lj_AST_size(t.t)

#----------------------------------------- Number of Unions in Type

function lj_AST_count_union(t :: ASTBase)
  throw(LJErrApplicationException("lj_AST_count_union(t::ASTBase) " * 
  "shouldn't be called (t == $(t))"))
end

lj_AST_count_union(t :: SimpleSize1Type) = 0

lj_AST_count_union(t :: TUnion) =
  1 + (length(t.ts) > 0 ? sum(map(te -> lj_AST_count_union(te), t.ts)) : 0)

lj_AST_count_union(t :: TTuple) =
  length(t.ts) > 0 ? sum(map(te -> lj_AST_count_union(te), t.ts)) : 0

lj_AST_count_union(t :: TApp) =
  lj_AST_count_union(t.t) + 
  (length(t.ts) > 0 ? sum(map(te -> lj_AST_count_union(te), t.ts)) : 0)

lj_AST_count_union(t :: TWhere) =
    lj_AST_count_union(t.t) + lj_AST_count_union(t.ub) + lj_AST_count_union(t.lb)

lj_AST_count_union(t :: TType) = 1 + lj_AST_count_union(t.t)

