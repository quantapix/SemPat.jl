using DataStructures
using Base.Meta

struct EClass
    id::Int64
end

"""
Check if an expr is an enode ⟺ all args are e-classes
"""
function isenode(e::Expr)
    return all(x -> x isa EClass, get_funargs(e))
end
# literals are enodes
isenode(x::EClass) = false
isenode(x) = true

### Definition 2.3: canonicalization
iscanonical(U::UnionFind, n::Expr) = n == canonicalize(U, n)
iscanonical(U::UnionFind, e::EClass) = find_root!(U, e.id) == e.id

# canonicalize an e-term n
# throws a KeyError from find_root! if any of the child classes
# was not found as the representative element in a set in U
function canonicalize(U::UnionFind, n::Expr)
    @assert isenode(n)
    ne = copy(n)
    set_funargs!(ne, [EClass(find_root!(U, x.id)) for x ∈ get_funargs(ne)])
    @debug("canonicalized ", n, " to ", ne)
    return ne
end

# canonicalize in place
function canonicalize!(U::UnionFind, n::Expr)
    @assert isenode(n)
    set_funargs!(n, [EClass(find_root!(U, x.id)) for x ∈ get_funargs(n)])
    @debug("canonicalized ", n)
    return n
end


# literals are already canonical
canonicalize(U::UnionFind, n) = n
canonicalize!(U::UnionFind, n) = n
