@testset_lifted "when" begin
    @lift @data TestA begin
        TestA_1(Int)
        TestA_2(Int)
    end
    @testset "basic" begin
        @test 3 == @when (a, b) = (1, 2) begin
            a + b
            @otherwise
            0
        end
        @test 0 == @when (a, b) = () begin
            a + b
            @otherwise
            0
        end
        @test (1, 2, 3) == @when let (a, 1) = (1, 1), [b, c, 5] = [2, 3, 5]
            (a, b, c)
        end
        x = 1
        @test :int == @when let (_, _) = x
            :tuple
            @when begin ::Float64 = x end
            :float
            @when ::Int = x
            :int
            @otherwise
            :unknown
        end
        x = 1
        y = (1, 2)
        cond1 = true
        cond2 = true
        @test 3 == @when let cond1.?, (a, b) = x
            a + b
            @when begin if cond2 end
                (a, b) = y
            end
            a + b
        end
    end
    @testset "only @when" begin
        @test 2 == @when let (a, 1) = (2, 1)
            a
        end
        @test 2 == @when (a, 1) = (2, 1) a
        @test 2 === @when let 1 = 1
            2
        end
        @test 2 === @when 1 = 1 2
        @test 1 === @when let a = 1
            a
        end
        @test 1 === @when a = 1 a
        @test nothing === @when let (a, b) = 1
            a + b
        end
        @test nothing === @when (a, b) = 1 a + b
        ab = (2, 3)
        @test 5 === @when let (a, b) = ab
            a + b
        end
        @test 5 === @when (a, b) = ab a + b
    end
    @testset "@data" begin
        v1 = TestA_1(2)
        v2 = TestA_2(2)
        @test 200 === @when let TestA_1(x) = v1, @inline WhenAction(x) = 100x
            WhenAction(x)
        end
        @test 200 === @when TestA_1(x) = v1 begin
            100x
        end
        @test nothing === @when let TestA_1(x) = v2, @inline WhenAction(x) = 100x
            WhenAction(x)
        end
    end
    @testset "preds" begin
        @test 2 === @when let if 1 > 0 end
            2
        end
        @test 3 === @when let (a, b) = (1, 2), (1 > 0).?
            a + b
        end
    end
    @testset "@when in @when" begin
        function f1(args...)
            x = Tuple(args)
            @when (a, 1) = x begin
                a
                @when (b, 2) = x
                (2, b)
            end
        end
        @test f1(111, 1) == 111
        @test f1(222, 1) == 222
        @test f1(111, 2) == (2, 111)
        @test f1(222, 2) == (2, 222)
        @test f1() === nothing
        function f2(args...)
            x = Tuple(args)
            @when (a, 1) = x begin
                a
                @when (b, 2) = x
                (:b, b)
                @when (c, 3) = x
                (:c, c)
            end
        end
        @test f2(10, 1) == 10
        @test f2(20, 2) == (:b, 20)
        @test f2(30, 3) == (:c, 30)
        @test f2() === nothing
    end
    @testset "@otherwise" begin
        function f1(args...)
            x = Tuple(args)
            @when (a, 1) = x begin
                a
                @otherwise
                x
            end
        end
        @test f1(1) == (1,)
        @test f1(1, 2) == (1, 2)
        @test f1(2, 1) == 2
        function f2(args...)
            x = Tuple(args)
            @when (a, 1) = x begin
                a
                @when (b, 2) = x
                (:b, b)
                @when (c, 3) = x
                (:c, c)
                @otherwise
                x
            end
        end
        @test f2(1) == (1,)
        @test f2(1, 0) == (1, 0)
        @test f2(10, 1) == 10
        @test f2(20, 2) == (:b, 20)
        @test f2(30, 3) == (:c, 30)
        xy = (1, 3)
        @test 0 == @when let (a, 1) = xy
            a
            @otherwise
            0
        end
        @test 1 == @when let (a, 3) = xy
            a
            @otherwise
            0
        end
        z = 5
        @test 1 == @when let (a, 3) = xy, 5 = z
            a
            @otherwise
            0
        end
        @test 0 == @when let (a, 1) = xy, 5 = z
            a
            @otherwise
            0
        end
        @test 0 == @when let (a, 3) = xy, 6 = z
            a
            @otherwise
            0
        end
    end
    @testset "bidings" begin
        function f1(xy, z)
            @when let (a, 1) = xy, 5 = z
                a
                @otherwise
                0
            end
        end
        @test f1((123, 1), 5) == 123
        @test f1((123, 3), 5) == 0
        @test f1((123, 1), 1) == 0
        function f2(ab, c, d, e)
            @when let (a, 1) = ab, 5 = c
                a, c
                @when begin :cpp = d; 2.0 = e end
                d, e
                @otherwise
                0
            end
        end
        @test f2((9, 1), 5, :c, 1.0) == (9, 5)
        @test f2((9, 1), 5, :cpp, 2.0) == (9, 5)
        @test f2((9, 2), 5, :cpp, 2.0) == (:cpp, 2.0)
        @test f2((9, 0), 5, :c00, 2.0) == 0
        @test f2((9, 1), 0, :c00, 2.0) == 0
        @test f2((9, 0), 5, :cpp, 0.0) == 0
        @test f2((9, 1), 0, :cpp, 0.0) == 0
    end
    @testset "multi" begin
        s = (1, 2, 3)
        @test 2 == @when (a, 2, 3) = s begin
            k = 1
            if a > 2; k *= a
            else k += a
            end
            k
            @otherwise
            throw("")
        end
        s = (20, 3)
        @test 100 == @when (10, 3) = s begin
            a = 10
            a = 10
            a = a * a
            a
            @otherwise
            a = 10
            a = 10
            a = a * a
            a
        end
    end
    @testset "error" begin
        @test_macro_throws MethodError @when
        @test_macro_throws SyntaxError @when x 1
        @test_macro_throws SyntaxError("No matching `@when a = b expr`") @when 1 1
        @test_macro_throws SyntaxError @when 1
        @test_macro_throws SyntaxError @when x
        @test_macro_throws SyntaxError @when @when
        @test_macro_throws SyntaxError @when begin end
        @test_macro_throws SyntaxError("Use @otherwise in a @when block") @otherwise
    end
end