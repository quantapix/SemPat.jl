module Perf
using BenchmarkTools
using BenchmarkTools: Benchmark, TrialEstimate
using InteractiveUtils
using SemPats.Lens
using StaticArrays
using Test

struct AB{A,B}
    a::A
    b::B
end

function lens_set_a((x, v))
    @set x.a = v
end

function hand_set_a((x, v))
    AB(v, x.b)
end

function lens_set_ab((x, v))
    @set x.a.b = v
end

function hand_set_ab((x, v))
    a = AB(x.a.a, v)
    AB(a, x.b)
end

function lens_set_a_and_b((x, v))
    o1 = @set x.a = v
    o2 = @set o1.b = v
end

function hand_set_a_and_b((x, v))
    AB(v, v)
end

function lens_set_i((x, v, i))
    @inbounds (@set x[i] = v)
end

function hand_set_i((x, v, i))
    @inbounds Base.setindex(x, v, i)
end

function benchmark_lens_vs_hand(lens::Benchmark, hand::Benchmark)
    tl = minimum(run(lens))
    th = minimum(run(hand))
    @show th
    @show tl
    @test th.memory == tl.memory
    @test th.allocs == tl.allocs
    @test th.time <= 2 * tl.time
end

function uniquecounts(iter)
    r = Dict{eltype(iter),Int}()
    for x in iter
        r[x] = get!(r, x, 0) + 1
    end
    r
end

function test_ir_lens_vs_hand(lens::Core.CodeInfo, hand::Core.CodeInfo)
    heads(x) = [e.head for e in x.code if e isa Expr]
    hl = heads(lens)
    hh = heads(hand)
    @test Set(hl) == Set(hh)
    @test count(==(:new), hl) == count(==(:new), hh)
    @test uniquecounts(hl) == uniquecounts(hh)
end

using SemPats.Lens: Compo
is_fast_compo_order(x) = true
is_fast_compo_order(l::Compo{<:Compo,<:Any}) = is_fast_compo_order(l.outer)
is_fast_compo_order(l::Compo{<:Any,<:Compo}) = false
is_fast_compo_order(l::Compo{<:Compo,<:Compo}) = false

@testset "default composition orders are fast" begin
    @assert is_fast_compo_order(∘(first, last, eltype))
    @assert is_fast_compo_order((first ∘ last) ∘ eltype)
    @assert !is_fast_compo_order(first ∘ (last ∘ eltype))
    @test is_fast_compo_order(revcompose(eltype, last, first))
    # @test_broken is_fast_compo_order(first ⨟ last ⨟ eltype)
    @test is_fast_compo_order(first ∘ last ∘ eltype)
    @test is_fast_compo_order(@lens _)
    @test is_fast_compo_order(@lens _ |> first |> last |> eltype)
    @test is_fast_compo_order(@lens _.a.b)
    @test is_fast_compo_order(@lens _[1][2][3])
    @test is_fast_compo_order(@lens first(last(_)))
    @test is_fast_compo_order(@lens last(_)[2].a |> first)
end

let
    x = AB(AB(1, 2), :b)
    v = (1, 2)
    @testset "$(y.lens)" for y in [
            (lens = lens_set_a, hand = hand_set_a, xs = (x, v)),
            (lens = lens_set_a, hand = hand_set_a, xs = (x, v)),
            (lens = lens_set_ab, hand = hand_set_ab, xs = (x, v)),
            (lens = lens_set_a_and_b, hand = hand_set_a_and_b, xs = (x, v)),
            (lens = lens_set_i, hand = hand_set_i, xs = (@SVector[1,2], 10, 1))
            ]
        fl = y.lens
        fh = y.hand
        xs = y.xs
        @assert fh(xs) == fl(xs)
        @testset "IR" begin
            il, _ = @code_typed fl(xs)
            ih, _ = @code_typed fh(xs)
            test_ir_lens_vs_hand(il, ih)
        end
        @testset "benchmark" begin
            bl = @benchmarkable $fl($xs)
            bh = @benchmarkable $fh($xs)
            benchmark_lens_vs_hand(bl, bh)
        end
    end
end

function compo_right_assoc(x, v)
    l = @lens(_.d) ∘ (@lens(_.c) ∘ (@lens(_.b) ∘ @lens(_.a)))
    set(x, l, v)
end

function compo_left_assoc(x, v)
    l = ((@lens(_.d) ∘ @lens(_.c)) ∘ @lens(_.b)) ∘ @lens(_.a)
    set(x, l, v)
    set(x, l, v)
end

function compo_default_assoc(x, v)
    l = @lens _.a.b.c.d
    set(x, l, v)
end

@testset "Lens composition compiler prefered associativity" begin
    x = (a = (b = (c = (d = 1, d2 = 2), c2 = 2), b2 = 3), a2 = 2)
    v = 2.2
    @test compo_left_assoc(x, v) == compo_default_assoc(x, v)
    @test compo_right_assoc(x, v) == compo_default_assoc(x, v)
    b_default = minimum(@benchmark compo_default_assoc($x, $v))
    println("Default associative composition: $b_default")
    b_left = minimum(@benchmark compo_left_assoc($x, $v))
    println("Left associative composition: $b_left")
    b_right = minimum(@benchmark compo_right_assoc($x, $v))
    println("Right associative composition: $b_right")
    @test b_default.allocs == 0
    @test_broken b_right.allocs == 0
    @test b_left.allocs == 0
    @test b_right.time > 2b_default.time
    @test b_left.time ≈ b_default.time rtol = 0.8
end

end
