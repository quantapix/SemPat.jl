@testset_lifted "record" begin
    @lift struct TestA
        a
        b
    end
    @lift @as_record TestA
    @lift struct TestB{A}
        x::A
        y::Int
    end
    @lift @as_record TestB
    @lift @as_record struct TestC
        a
        b
    end
    @testset "match" begin
        @test @match TestA(1, 2) begin
            TestA(1, 2) => true
            _ => false
        end
    end
    @testset "extract" begin
        @test @match TestA(1, 2) begin
            TestA(a=1) => true
            _ => false  
        end
        @test @match TestA(1, 2) begin
            TestA(b=2) => true
            _ => false
        end
    end
    @testset "pun" begin
        @test @match TestA(1, 2) begin
            TestA(;a=1) => true
            _ => false
        end
        @test @match TestA(1, 2) begin
            TestA(;b=2) => true
            _ => false
        end
        @test @match TestA(1, 2) begin
            TestA(;b) => b == 2
            _ => false
        end        
    end
    @testset "param" begin
        @test @match TestB(1, 2) begin
            TestB{A}(_) where A => A == typeof(1)
            _ => false
        end
    end
    @testset "decl" begin
        @test @match TestC(1, 2) begin
            TestC(1, 2) => true
            _ => false
        end
    end
    @lift @data TestD{B} begin
        TestD_1(x::Int, y::Int, z::B)
        TestD_2(x::Real, y::Real, z::B)
        TestD_3(x::Complex, y::Complex, z::B)
    end
    f(x::TestD) = @match x begin
        TestD_1(;z) => z
        TestD_2(;z) => z
        TestD_3(;z) => z
        _ => false
    end 
    c1 = TestD_1(0, 0, 1)
    c2 = TestD_2(0.0, 0.0, 1.0)
    c3 = TestD_3(0.0 + im, 0.0 + im, 1.0 + im)
    @lift struct TestE{B} <: TestD{B} 
        x::UInt
        y::UInt
        z::B
    end
    @lift @as_record TestE
    c0 = TestE(UInt(0x000), UInt(0xFFF), UInt(0x111))
    @testset "new records" begin
        @test f(c0) == false
        @test f(c1) == 1
        @test f(c2) == 1.0
        @test f(c3) == 1.0 + im
    end
    f(x::TestE) = @match x begin
        TestE(;z) => z
        _ => false
    end
    @testset "new impls" begin
        @test f(c0) == 0x111
        @test f(c1) == 1
        @test f(c2) == 1.0
        @test f(c3) == 1.0 + im
    end
end
