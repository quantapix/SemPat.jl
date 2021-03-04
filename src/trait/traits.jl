@traitdef IsAny{X}
@traitimpl IsAny{X} <- (x -> true)(X)
export IsAny

@traitdef IsNothing{X}
@traitimpl IsNothing{X} <- (x -> false)(X)
export IsNothing

@traitdef IsBits{X}
Base.@pure is_bits(X) = X.isbitstype
@traitimpl IsBits{X} <- is_bits(X)
export IsBits

@traitdef IsImmutable{X}
Base.@pure is_immutable(X) = !X.mutable
@traitimpl IsImmutable{X}  <- is_immutable(X)
export IsImmutable

@traitdef IsCallable{X}
@traitimpl IsCallable{X} <- (X -> (X <: Function ||  length(methods(X)) > 0))(X)
export IsCallable

@traitdef IsConcrete{X}
@traitimpl IsConcrete{X} <- isconcretetype(X)
export IsConcrete

@traitdef IsContiguous{X}
@traitimpl IsContiguous{X} <- Base.iscontiguous(X)
export IsContiguous

@traitdef IsIndexLinear{X}
is_idx_linear(X) = IndexStyle(X) == IndexLinear() ? true : IndexStyle(X) == IndexCartesian() ? false : error("Not recognized")
@traitimpl IsIndexLinear{X} <- is_idx_linear(X)
export IsIndexLinear

@traitdef IsIterator{X}
trait(::Type{IsIterator{X}}) where {X} = hasmethod(iterate, Tuple{X}) ? IsIterator{X} : Not{IsIterator{X}}
export IsIterator
