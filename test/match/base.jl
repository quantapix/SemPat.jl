@testset "basic" begin
    @testset "Int" begin
        @testset "affirm: 1-10" begin
            @test all(1:10) do a
                @match a begin
                    1 => a == 1
                    2 => a == 2
                    3 => a == 3
                    4 => a == 4
                    5 => a == 5
                    6 => a == 6
                    7 => a == 7
                    8 => a == 8
                    9 => a == 9
                    10 => a == 10
                end
            end
        end
        @testset "negate: 1-10" begin
            @test !any(1:10) do a
                @match a begin
                    1 => a != 1
                    2 => a != 2
                    3 => a != 3
                    4 => a != 4
                    5 => a != 5
                    6 => a != 6
                    6 => a != 6
                    7 => a != 7
                    8 => a != 8
                    9 => a != 9
                    10 => a != 10
                end
            end
        end
    end
    @testset "Number" begin
        x = map(Float64, 1:10)
        @testset "affirm: 1-10" begin
            @test all(x) do a
                @match a begin
                    1.0 => a == 1.0
                    2.0 => a == 2.0
                    3.0 => a == 3.0
                    4.0 => a == 4.0
                    5.0 => a == 5.0
                    6.0 => a == 6.0
                    7.0 => a == 7.0
                    8.0 => a == 8.0
                    9.0 => a == 9.0
                    10.0 => a == 10.0
                end
            end
        end
        @testset "negate: 1-10" begin
            foreach(x) do a
                @test !(@match a begin
                    1.0 => a != 1.0
                    2.0 => a != 2.0
                    3.0 => a != 3.0
                    4.0 => a != 4.0
                    5.0 => a != 5.0
                    6.0 => a != 6.0
                    6.0 => a != 6.0
                    7.0 => a != 7.0
                    8.0 => a != 8.0
                    9.0 => a != 9.0
                    10.0 => a != 10.0
                end)
            end
        end
    end
    @testset "string" begin
        @test @match "aaaa" begin
            "1234" => false
            "aaaa" => true
            1234 => false
        end
    end
    @testset "Or" begin
        @test @match 1 begin
            2 => false
            3 => false
            (4 || 5 || 1) => true
        end
    end
    @testset "And" begin
        @test @match 2 begin
            "1" || 1 => false
            2   && 1 => false
            10  || 2 && ::Int => true
        end
    end
    @testset "pred" begin
        @test @match 10 begin
            x && if x^2 > 200 end => false
            x && if (x - 3)^3 < 125 end => false
            x => x === 10
        end
    end
    @testset "wildcard" begin
        @test @match 100 begin
            1 && 100 => false
            _ => true
        end
    end
    @testset "Ref" begin
        @test @match 100 begin
            (&100) =>  true
            _ =>  false
        end
        a = "123"
        @test @match a begin
            (&a) =>  true
            _ =>  false
        end
    end
    @testset "null dict" begin
        x = Dict(:a => nothing)
        @test @match x begin
            Dict(:a => a) => a === nothing
            _ => false
        end
    end
    @testset "uppercase" begin
        @test 2 === @match 1 begin
            A => A + 1
        end
    end
    @testset "mutation" begin
        @test @match [1, 2, 3] begin
            Many(::Int) => true
            _ => false
        end
        @test 9 == @match [1, 2, 3,  "a", "b", "c", :a, :b, :c] begin
            Do(count=0) && Many[
                a::Int && Do(count=count + a) ||
                ::String ||
                ::Symbol && Do(count=count + 1)
            ] => count
        end
        #=
        @test @match 1 begin
            let x = 1 end && Do[x=2] => (x == 2)
            _ => false
        end
        =#
    end
end