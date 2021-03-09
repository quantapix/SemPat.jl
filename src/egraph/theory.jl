# Theories can just be vectors of rules!

macro theory(e)
    e = macroexpand(__module__, e)
    e = rm_lines(e)
    if isexpr(e, :block)
        Vector{Rule}(e.args .|> x -> Rule(x; mod=__module__))
    else
        error("theory is not in form begin a => b; ... end")
    end
end

"""
A Theory is either a vector of [`Rule`](@ref) or
a compiled, callable function.
"""
const Theory = Union{Vector{Rule}, Function}
