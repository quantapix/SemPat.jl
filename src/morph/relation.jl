# [TensorOperations.jl](https://github.com/Jutho/TensorOperations.jl)
# [TensorCast.jl](https://github.com/mcabbott/TensorCast.jl)

export RelationDiagram, UntypedRelationDiagram, TypedRelationDiagram,
  @relation, @tensors, @eval_tensors,
  parse_relations, parse_tensors, compile_tensor_expr

using Compat
using ..Match: @match

using ...CategoricalAlgebra.CSets, ...Present
using ...WiringDiagrams.UndirectedWiringDiagrams
using ...WiringDiagrams.MonoidalUndirectedWiringDiagrams:
  TheoryUntypedHypergraphDiagram, TheoryHypergraphDiagram

@picture TheoryRelationDiagram <: TheoryUntypedHypergraphDiagram begin
    Variable::Data
    variable::Attr(Junction, Variable)
end

const RelationDiagram = AbstractACSetType(TheoryRelationDiagram)
const UntypedRelationDiagram = ACSetType(TheoryRelationDiagram, index=[:box, :junction, :outer_junction], unique_index=[:variable])

@picture TheoryTypedRelationDiagram <: TheoryHypergraphDiagram begin
    Variable::Data
    variable::Attr(Junction, Variable)
end

const TypedRelationDiagram = ACSetType(TheoryTypedRelationDiagram, index=[:box, :junction, :outer_junction], unique_index=[:variable])

RelationDiagram{Name}(ports::Int) where {Name} = UntypedRelationDiagram{Name,Symbol}(ports)
RelationDiagram{Name}(ports::AbstractVector{T}) where {T,Name} = TypedRelationDiagram{T,Name,Symbol}(ports)







macro eval_tensors(diagram, tensor_macro)
    compile_expr = :(compile_tensor_expr($(esc(diagram)),
    assign_op=:(:=), assign_name=gensym("out")))
    Expr(:call, esc(:eval),
       :(_eval_tensors($compile_expr, $(QuoteNode(tensor_macro)))))
end
function _eval_tensors(tensor_expr, macro_expr)
    @match macro_expr begin
        Expr(:macrocall, args...) => Expr(:macrocall, args..., tensor_expr)
        _ => error("Expression $macro_expr is not a macro call")
    end
end


