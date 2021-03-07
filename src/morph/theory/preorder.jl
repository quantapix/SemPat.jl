@theory ThinCategory{Ob,Hom} <: Category{Ob,Hom} begin
    f == g ⊣ (A::Ob, B::Ob, f::Hom(A, B), g::Hom(A, B))
end

@syntax FreeThinCategory{ObExpr,HomExpr} ThinCategory begin
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
end

@theory ThinSymmetricMonoidalCategory{Ob,Hom} <: SymmetricMonoidalCategory{Ob,Hom} begin
    f == g ⊣ (A::Ob, B::Ob, f::Hom(A, B), g::Hom(A, B))
end

@syntax FreeThinSymmetricMonoidalCategory{ObExpr,HomExpr} ThinSymmetricMonoidalCategory begin
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::Hom, g::Hom) = associate(new(f, g))
end

@theory Preorder{Elt,Leq} begin
    Elt::TYPE
    Leq(lhs::Elt, rhs::Elt)::TYPE
    @op (≤) := Leq

  # Preorder axioms are lifted to term constructors in the GAT.
    reflexive(A::Elt)::(A ≤ A) # ∀ A there is a term reflexive(A) which codeies A≤A
    transitive(f::(A ≤ B), g::(B ≤ C))::(A ≤ C) ⊣ (A::Elt, B::Elt, C::Elt)

  # Axioms of the GAT are equivalences on terms or scodeification rules in the logic
    f == g ⊣ (A::Elt, B::Elt, f::(A ≤ B), g::(A ≤ B))
  # Read as (f⟹ A≤B ∧ g⟹ A≤B) ⟹ f ≡ g
end

@syntax FreePreorder{ObExpr,HomExpr} Preorder begin
    transitive(f::Leq, g::Leq) = associate(new(f, g; strict=true))
end

# TODO: a GAT-homomorphism between the Preorder GAT and the ThinCategory GAT
# this is a morphism is *GAT* the category whose objects are GATs
# and whose morphisms are algebraic structure preserving maps

# @functor F(Preorder(Elt, Leq))::ThinCategory(Ob, Hom) begin
#   Elt ↦ Ob
#   Leq ↦ Hom
#   reflexive ↦ id
#   transitive ↦ compose
# end