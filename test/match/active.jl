@testset_lifted "active" begin
    @testset "regular" begin
        @lift @active TestA(x) begin
            if x > 0; nothing
            else Some(x)
            end
        end
        @test :b === (@match 15 begin
            TestA(_) => :a
            _ => :b
        end)
        @test -15 == (@match -15 begin
            TestA(a) => a
            _ => 0
        end)
    end
    @testset "parametric" begin
        @lift @active TestB{r::Regex}(x) begin
            ret = match(r, x)
            ret === nothing || return Some(ret)
        end
        @test (@match "123" begin
            TestB{r"\d+"}(x) => x.match
            _ => @error ""
        end) == "123"
        @test_throws Any @match "abc" begin
            TestB{r"\d+"}(x) => x
            _ => @error ""
        end
    end
    @testset "custom" begin
        @lift struct TestC end
        @lift @active TestC{a,b}(arg) begin
            a <= arg <= b
        end
        @lift @active TestD(a) begin
            a % 2 === 0
        end
        @lift Match.is_enum(::Type{TestD}) = true
        function parity(x)
            @match x begin
                TestD => :even
                _ => :odd
            end
        end
        @test :even === parity(4)
        @test :odd === parity(3)
        @test 2 == @match 3 begin
            TestC{1,2} => 1
            TestC{3,4} => 2
            TestC{5,6} => 3
            TestC{7,8} => 4
        end
    end
    @testset "drop" begin
        @lift @active TestE(x) begin
            x
        end
        @test_throws Any @match 1 begin
            TestE(1) => 1
        end
    end
    @testset "sugar" begin
        @test @match (1, 2) begin
            Match.And[
                (1, _),
                (_, 2)
            ] => true
            _ => false
        end
    end
end