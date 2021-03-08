@testset "UnionFind" begin
    for T in [Int, UInt8, Int8, UInt16, Int16, UInt32, Int32, UInt64]
    @testset "eltype = $(T)" begin
        s = UnionFind(T(10))
        s2 = UnionFind{T}(10)
        @testset "basic" begin
            @test length(s) == 10
            @test length(s2) == 10
            @test eltype(s) == T
            @test eltype(s2) == T
            @test eltype(typeof(s)) == T
            @test eltype(typeof(s2)) == T
            for i = 1:10; @test find!(s, T(i)) == T(i) end
            @test_throws BoundsError find!(s, T(11))
            @test !is_colloc(s, T(2), T(3))
        end

        @testset "union!" begin
            union!(s, T(2), T(3))
            @test in_same_set(s, T(2), T(3))
            @test find!(s, T(3)) == T(2)
            union!(s, T(3), T(2))
            @test in_same_set(s, T(2), T(3))
            @test find!(s, T(3)) == T(2)
        end

        @testset "more" begin
            @test_throws MethodError push!(s, T(22))
            @test push!(s) == T(11)
            @test union!(s, T(8), T(7)) == T(8)
            @test union!(s, T(5), T(6)) == T(5)
            @test union!(s, T(8), T(5)) == T(8)
            @test find!(s, T(6)) == T(8)
            union!(s, T(2), T(6))
            @test find!(s, T(2)) == T(8)
            root1 = find!(s, T(6))
            root2 = find!(s, T(2))
            @test root_union!(s, T(root1), T(root2)) == T(8)
            @test union!(s, T(5), T(6)) == T(8)
        end
    end
end

@testset "overflow" begin
    for T in [UInt8, Int8]
        s = UnionFind(T(typemax(T) - 1))
        push!(s)
        @test_throws ArgumentError push!(s)
    end
end
