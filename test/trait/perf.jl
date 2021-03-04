@lift @trait Monoid{T} begin
    mempty::Type{T} => T
    (⊕)::[T, T] => T
end
@lift @impl Monoid{Int} begin
    mempty(_) = 0
    ⊕ = +
end
@lift @impl Monoid{Vector{T}} where T begin
    mempty(_) = T[]
    ⊕ = vcat
end

# 100 ⊕ 2 |> println
# @btime 100 ⊕ 2
# @btime 100 + 2
# @btime vcat([1, 2, 3], [3, 4, 5])
# @btime [1, 2, 3] ⊕ [3, 4, 5]
# @btime 1 ⊕ 2
