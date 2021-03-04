import Base: ==

signed_prod(lst) = length(lst) == 1 ? lst[1] : Base.prod(lst)
signed_sum(lst) = length(lst) == 1 ? lst[1] : Base.sum(lst)

abstract type Node end
==(n1::Node, n2::Node) = isequal(n1.val, n2.val)
calc(n::Float64) = n
mutable struct Inv <: Node val end
calc(i::Inv) = 1.0 / calc(i.val)
mutable struct Prd <: Node val end
calc(p::Prd) = signed_prod(map(calc, p.val))
mutable struct Neg <: Node val end
calc(n::Neg) = -calc(n.val)
mutable struct Sum <: Node val end
calc(s::Sum) = signed_sum(map(calc, s.val))

@testset "fix" begin
    @with_names begin
        spc = Drop(Star(Space()))
        @with_pre spc begin
            sum = Delayed()
            val = E"(" + spc + sum + spc + E")" | PFloat64()
        
            neg = Delayed()
            neg.matcher = (val | (E"-" + neg > Neg))
        
            mul = E"*" + neg
            div = E"/" + neg > Inv
            prd = neg + (mul | div)[0:end] |> Prd
        
            add = E"+" + prd
            sub = E"-" + prd > Neg
            sum.matcher = (prd + (add | sub)[0:end] |> Sum)
        
            all = sum + spc + Eos()
        end
    end
    parse_one(" 1 + 2 * 3 / 4 ", Trace(all); debug=true)
    for (src, v) in [
                   (" 1 ", 1),
                   (" - 1 ", -1),
                   (" 1 + 1 ", 2),
                   (" 1 - 1 ", 0),
                   (" - 1 - 1 ", -2)
                   ]
#    @test calc(parse_dbg(src, Trace(all))[1]) ≈ v
        @test calc(parse_one(src, Trace(all))[1]) ≈ v
        # println("$src = $v")
    end
end
@testset "print" begin
    # println(Seq())
    # println(e"a" + E"b" | p"c" > tuple)
end
@testset "names" begin
    @with_names begin
        a = Equal("a")
        b = Alt(a, Equal("c"))
    end
    @test a.name == :a
    @test b.name == :b
end
@testset "tests" begin
    @test parse_one("", Epsilon()) == []
    @test parse_one("", Insert("foo")) == ["foo"]
    @test parse_one("", Drop(Insert("foo"))) == []
    @test_throws PException parse_one("x", Equal("a")) 
    @test parse_one("a", Equal("a")) == ["a"]
    @test parse_one("aa", Equal("a")) == ["a"]
    @test_throws PException parse_one("a", Repeat(Equal("a"), 2, 2))
    @test parse_one("aa", Repeat(Equal("a"), 2, 2)) == ["a", "a"]
    @test parse_one("aa", Repeat(Equal("a"), 1, 2)) == ["a", "a"]
    @test parse_one("", Repeat(Equal("a"), 0, 0)) == []
    @test_throws PException parse_one("a", Repeat(Equal("a"), 2, 2; greedy=false); debug=true)
    @test parse_one("aa", Repeat(Equal("a"), 2, 2; greedy=false)) == ["a", "a"]
    @test parse_one("aa", Repeat(Equal("a"), 1, 2; greedy=false)) == ["a"]
    @test parse_one("", Repeat(Equal("a"), 0, 0; greedy=false)) == []

    @test parse_one("ab", Series(Pattern(r"a"), Dot(); flatten=false)) == Any[["a"], ['b']]
    @test parse_one("ab", Series(Pattern(r"a"), Dot())) == Any["a", 'b']
    @test parse_one("ab", Seq(Pattern(r"a"), Dot())) == ["a", 'b']
    @test parse_one("abc", Pattern("(.)(.)(.)", 1, 3) + Eos()) == ["a", "c"]
    @test parse_one("true", p"([Tt][Rr][Uu][Ee])|([Ff][Aa][Ll][Ss][Ee])" + Eos()) == ["true"]
    @test parse_one("abc", Seq(Equal("a"))) == ["a"]
    @test parse_one("abc", Seq(Equal("a"), Equal("b"))) == ["a", "b"]
    @test parse_one("abc", Seq(p"."[1:2], Equal("c"))) == ["a", "b", "c"]
    @test parse_one("abc", Seq(p"."[1:2], Equal("b"))) == ["a", "b"]
    @test parse_one("abc", Seq!(p"."[1:2], Equal("c"))) == ["a", "b", "c"]
    @test_throws PException  parse_one("abc", Seq!(p"."[1:2], Equal("b"))) == ["a", "b"]
    @test parse_one("abc", Seq(p"."[1:2], p"."[1:2])) == ["a", "b", "c"]
    @test parse_one("abc", Seq(p"."[1:2,:&], p"."[1:2])) == Any[["a"], ["b"], "c"]
    @test parse_one("abc", Seq(p"."[1:2,:&,:?], p"."[1:2])) == Any[["a"], "b", "c"]
    @test_throws ErrorException parse_one("abc", Seq(p"."[1:2,:&,:?,:x], p"."[1:2]))
    @test parse_one("abc", Seq(p"."[1:2], p"."[1:2], Equal("c"))) == ["a", "b", "c"]
    @test parse_one("ab", p"." + e"b") == ["a", "b"]
    @test parse_one("abc", p"." + e"b" + e"c") == ["a", "b", "c"]
    @test parse_one("abc", p"." + E"b" + e"c") == ["a", "c"]
    @test parse_one("b", Alt(e"a", e"b", e"c")) == ["b"]
    @test parse_one("b", Alt!(e"a", e"b", e"c")) == ["b"]
    @test collect(parse_all("b", Trace(Alt(Epsilon(), Repeat(e"b", 0, 1))))) == Array[[], ["b"], []]

    @test collect(parse_all("b", Alt(Epsilon(), Repeat(e"b", 0, 1; greedy=false)))) == Array[[], [], ["b"]]
    @test parse_one("abc", p"." + (e"b" | e"c")) == ["a", "b"]
    @test length(collect(parse_all("abc", p"."[0:3]))) == 4
    @test length(collect(parse_all("abc", p"."[1:2]))) == 2
    @test parse_one("abc", p"."[3] > tuple) == [("a", "b", "c")]
    @test parse_one("abc", p"."[3] > vcat) == Any[Any["a", "b", "c"]]
    @test_throws PException parse_one("abc", And(Equal("a"), Lookahead(Equal("c")), Equal("b")))
    @test parse_one("abc", And(Equal("a"), Not(Lookahead(Equal("c"))), Equal("b"))) == Any[["a"], [], ["b"]]
    @test parse_one("1.2", PFloat64()) == [1.2]
    m1 = Delayed()
    m1.matcher = Seq(Dot(), Opt(m1))
    # @test parse_one("abc", m1) == ['a', 'b', 'c']
    @test collect(parse_all("abc", Repeat(Failed(); flatten=false))) == Any[[]]
    @test collect(parse_all("abc", Repeat(Failed(); flatten=false, greedy=false))) == Any[[]]
    @test parse_one("12c", Lookahead(p"\d") + PInt()) == [12]
    @test parse_one("12c", Lookahead(p"\d") + PInt() + Dot()) == [12, 'c']
    @test_throws PException parse_one("12c", Not(Lookahead(p"\d")) + PInt() + Dot())
    @test collect(parse_all("123abc", Seq!(p"\d"[0:end], p"[a-z]"[0:end]))) == Any[Any["1", "2", "3", "a", "b", "c"]]
    @test parse_one("€", p"."; debug=true) == ["€"]

    for i in 1:10
        for greedy in (true, false)
            lo = rand(0:3)
            hi = lo + rand(0:2)
            r = Regex("a{$lo,$hi}" * (greedy ? "" : "?"))
            n = rand(0:4)
            s = repeat("a", n)
            m = match(r, s)
            # println("$lo $hi $s $r")
            if m === nothing
                @test_throws PException parse_one(s, Repeat(Equal("a"), lo, hi; greedy=greedy))
            else
                @test length(m.match) == length(parse_one(s, Repeat(Equal("a"), lo, hi; greedy=greedy)))
            end
        end
    end

    @test parse_one("ab", Seq(Equal("a"), Equal("b"))) == ["a", "b"]
    @test parse_one("abc", Dot() + Dot() + Dot()) == ['a', 'b', 'c']

    for backtrack in (true, false)
        @test map(x -> [length(x[1]), length(x[2])],
              collect(parse_all("aaa", 
                                Seq((Repeat(Equal("a"), 0, 3; backtrack=backtrack) > tuple),
                                    (Repeat(Equal("a"), 0, 3; backtrack=backtrack) > tuple))))) == 
                  Array[[3,0],
                        [2,1],[2,0],
                        [1,2],[1,1],[1,0],
                        [0,3],[0,2],[0,1],[0,0]]
        @test map(x -> [length(x[1]), length(x[2])],
              collect(parse_all("aaa", 
                                Seq((Repeat(Equal("a"), 0, 3; backtrack=backtrack, greedy=false) > tuple),
                                    (Repeat(Equal("a"), 0, 3; backtrack=backtrack, greedy=false) > tuple))))) == 
                  Array[[0,0],[0,1],[0,2],[0,3],
                        [1,0],[1,1],[1,2],
                        [2,0],[2,1],
                        [3,0]]
    end
end
@testset "case" begin
    @test parse_one("foo", Case(p".*")) == ["Foo"]
    @test parse_dbg("foo", Trace(Case(p".*"))) == ["Foo"]
end
@testset "slow" begin
    function slow(n)
        # matcher = Repeat(Repeat(Equal("a"), 0, n), n, 0)
        # matcher = Seq(Repeat(Equal("a"), 0, ), Repeat(Equal("a"), 0, n))
        # for greedy in (true, false)
        for greedy in (true,)
            # println("greedy $greedy")
            matcher = Repeat(Equal("a"), 0, n; greedy=greedy)
            for i in 1:n
                matcher = Seq(Repeat(Equal("a"), 0, n; greedy=greedy), matcher)
            end
            source = repeat("a", n)
            for config in (NoCache, Cache)
                # println("$(config)")
                all1 = make_all(config)
                # @time collect(all1(source, matcher))
                # @time n = length(collect(all1(source, matcher)))
                # println("n results: $n")
                debug, all2 = make(Debug, source, matcher; delegate=config)
                collect(all2)
                # println("max depth: $(debug.max_depth)")
                # println("max iter: $(debug.max_iter)")
                # println("n calls: $(debug.n_calls)")
            end
        end
    end
    slow(3)
    # slow(7)
end
@testset "try" begin
    open("parse/comb/test1.txt", "r") do io
        for c in TrySource(io)
            # print(c)
        end
    end
    open("parse/comb/test1.txt", "r") do io
        s = TrySource(io)
        (c, state) = iterate(s)
        @test c == 'a'
        @test forwards(s, state) == "bcdefghijklmnopqrstuvwxyz\n"
    end
    # open("test1.txt", "r") do io
    #    parse_one_dbg(TrySource(io), Trace(p"[a-z]"[0:end] + e"m" > string); debug=true)
    # end
    for p in (parse_try, parse_try_cache, parse_try_dbg, parse_try_cache_dbg)
        open("parse/comb/test1.txt", "r") do io
            # @test_throws PException p(io, Trace(p"[a-z]"[0:end] + e"m" > string))
            @test_throws Any p(io, Trace(p"[a-z]"[0:end] + e"m" > string))
        end
        open("parse/comb/test1.txt", "r") do io
            result = p(io, Try(p"[a-z]"[0:end] + e"m" > string))
            # println(result)
            @test result == Any["abcdefghijklm"]
        end
        open("parse/comb/test1.txt", "r") do io
            result = p(io, Try(p"(.|\n)"[0:end] + e"5" > string))
            # println(result)
            @test result == Any["abcdefghijklmnopqrstuvwxyz\n012345"]
        end
        # @test_throws PError{LineIter} p("?", Alt!(p"[a-z]", p"\d", Error("not letter or number")))
        @test_throws Any p("?", Alt!(p"[a-z]", p"\d", Error("not letter or number")))
    end
end
@testset "debug" begin
    @test Parse.truncate("1234567890", 10) == "1234567890"
    @test Parse.truncate("1234567890",  9) == "1234...90"
    @test Parse.truncate("1234567890",  8) == "123...90"
    @test Parse.truncate("1234567890",  7) == "123...0"
    @test Parse.truncate("1234567890",  6) == "12...0"
    @test Parse.truncate("1234567890",  5) == "1...0"

    # println("one level")
    # parse_dbg("ab", Trace(Dot()))

    # println("multiple")
    # parse_dbg("ab", Equal("a") + Trace(Dot()[0:end]) + Equal("b"))

    grammar = p"\d+" + Eos()
    debug, task = make(Debug, "123abc", grammar; delegate=NoCache)
    @test_throws PException once(task)
    @test debug.max_iter == 4
end
