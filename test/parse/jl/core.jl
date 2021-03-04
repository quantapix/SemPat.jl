randop() = rand(["-->", "→", "||", "&&", "<", "==", "<:", ">:", "<|", "|>", ":", "+", "-", ">>", "<<", "*", "/", "//", "^", "↑", "::", ".", "->"])

function test_expr(s, show=true)
    x, p = JLParse.parse(Parser(s))
    x0 = Expr(x)
    x1 = remlineinfo!(Meta.parse(s))
    if JLParse.has_err(p) || x0 != x1
        if show
            println("Mismatched Meta and JLParse when parsing $s")
            println("Parser:\n $p\n")
            println("Exp2:\n $x\n")
            println("Converted:\n $x0\n")
            println("Meta Expr:\n $x1\n")
        end
        false
    end
    true
end

test_expr_broken(s) = test_expr(s, false)

@testset "core" begin
    @test Meta.parse("(1,)") == Expr(:tuple, 1)
    @testset "show" begin
        x = JLParse.parse("a + (b*c) - d")
        @test sprint(show, x) ===
        """
        1:13  BinyOpCall
        1:10   BinyOpCall
        1:2     a
        3:4     OP: PLUS
        5:10    InvisBracks
        5:5      (
        6:8      BinyOpCall
        6:6       b
        7:7       OP: STAR
        8:8       c
        9:10     )
       11:12   OP: MINUS
       13:13   d
      """        
    end
    @testset "opers" begin
        @testset "biny" begin
            for iter = 1:25
                str = join([["x$(randop())" for i = 1:19]; "x"])
                @test test_expr(str)
            end
        end
        @testset "cond" begin
            @test test_expr("a ? b : c")
            @test test_expr("a ? b : c : d")
            @test test_expr("a ? b : c : d : e")
            @test test_expr("a ? b : c : d : e")
        end
        @testset "dot" begin
            @test "a.b"  |> test_expr
            @test "a.b.c"  |> test_expr
            @test "(a(b)).c"  |> test_expr
            @test "(a).(b).(c)"  |> test_expr
            @test "(a).b.(c)"  |> test_expr
            @test "(a).b.(c+d)"  |> test_expr
        end
        @testset "uny" begin
            @test "+" |> test_expr
            @test "-" |> test_expr
            @test "!" |> test_expr
            @test "~" |> test_expr
            @test "&" |> test_expr
#            @test "::" |> test_expr
            @test "<:" |> test_expr
            @test ">:" |> test_expr
            @test "¬" |> test_expr
            @test "√" |> test_expr
            @test "∛" |> test_expr
            @test "∜" |> test_expr
        end
        @testset "uny 2" begin
            @test "a=b..." |> test_expr
            @test "a-->b..." |> test_expr
            @test "a&&b..." |> test_expr
            @test "a||b..." |> test_expr
            @test "a<b..." |> test_expr
            @test "a:b..." |> test_expr
            @test "a+b..." |> test_expr
            @test "a<<b..." |> test_expr
            @test "a*b..." |> test_expr
            @test "a//b..." |> test_expr
            @test "a^b..." |> test_expr
            @test "a::b..." |> test_expr
            @test "a where b..." |> test_expr
            @test "a.b..." |> test_expr
        end
        @testset "uny op calls" begin
            @test "+(a,b)" |> test_expr
            @test "-(a,b)" |> test_expr
            @test "!(a,b)" |> test_expr
            @test "¬(a,b)" |> test_expr
            @test "~(a,b)" |> test_expr
            @test "<:(a,b)" |> test_expr
            @test "√(a,b)" |> test_expr
            @test "\$(a,b)" |> test_expr
            @test ":(a,b)" |> test_expr
            @test "&a" |> test_expr
            @test "&(a,b)" |> test_expr
            @test "::a" |> test_expr
            @test "::(a,b)" |> test_expr
        end
        @testset "where rank" begin
            @test "a = b where c = d" |> test_expr
            @test "a = b where c" |> test_expr
            @test "b where c = d" |> test_expr
            @test "a ? b where c : d" |> test_expr
            @test "a --> b where c --> d" |> test_expr
            @test "a --> b where c" |> test_expr
            @test "b where c --> d" |> test_expr
            @test "a || b where c || d" |> test_expr
            @test "a || b where c" |> test_expr
            @test "b where c || d" |> test_expr
            @test "a && b where c && d" |> test_expr
            @test "a && b where c" |> test_expr
            @test "b where c && d" |> test_expr
            @test "a <: b where c <: d" |> test_expr
            @test "a <: b where c" |> test_expr
            @test "b where c <: d" |> test_expr
            @test "a <| b where c <| d" |> test_expr
            @test "a <| b where c" |> test_expr
            @test "b where c <| d" |> test_expr
            @test "a : b where c : d" |> test_expr
            @test "a : b where c" |> test_expr
            @test "b where c : d" |> test_expr
            @test "a + b where c + d" |> test_expr
            @test "a + b where c" |> test_expr
            @test "b where c + d" |> test_expr
            @test "a << b where c << d" |> test_expr
            @test "a << b where c" |> test_expr
            @test "b where c << d" |> test_expr
            @test "a * b where c * d" |> test_expr
            @test "a * b where c" |> test_expr
            @test "b where c * d" |> test_expr
            @test "a // b where c // d" |> test_expr
            @test "a // b where c" |> test_expr
            @test "b where c // d" |> test_expr
            @test "a ^ b where c ^ d" |> test_expr
            @test "a ^ b where c" |> test_expr
            @test "b where c ^ d" |> test_expr
            @test "a :: b where c :: d" |> test_expr
            @test "a :: b where c" |> test_expr
            @test "b where c :: d" |> test_expr
            @test "a.b where c.d" |> test_expr
            @test "a.b where c" |> test_expr
            @test "b where c.d" |> test_expr
            @test "a where b where c" |> test_expr
        end
    end
    @testset "type annos" begin
        @testset "curly" begin
            @test "x{T}" |> test_expr
            @test "x{T,S}" |> test_expr
            @test "a.b{T}" |> test_expr
            @test "a(b){T}" |> test_expr
            @test "(a(b)){T}" |> test_expr
            @test "a{b}{T}" |> test_expr
            @test "a{b}(c){T}" |> test_expr
            @test "a{b}.c{T}" |> test_expr
            @test """x{T,
        S}""" |> test_expr
        end
    end
    @testset "tuples" begin
        @test head(JLParse.parse("1,")) === JLParse.ErrTok
        @test "1,2" |> test_expr
        @test "1,2,3" |> test_expr
        @test "()" |> test_expr
        @test "(==)" |> test_expr
        @test "(1)" |> test_expr
        @test "(1,)" |> test_expr
        @test "(1,2)" |> test_expr
        @test "(a,b,c)" |> test_expr
        @test "(a...)" |> test_expr
        @test "((a,b)...)" |> test_expr
        @test "a,b = c,d" |> test_expr
        @test "(a,b) = (c,d)" |> test_expr
    end
    @testset "calls" begin
        @testset "simple" begin
            @test "f(x)" |> test_expr
            @test "f(x,y)" |> test_expr
            @test "f(g(x))" |> test_expr
            @test "f((x,y))" |> test_expr
            @test "f((x,y), z)" |> test_expr
            @test "f(z, (x,y), z)" |> test_expr
            @test "f{a}(x)" |> test_expr
            @test "f{a<:T}(x::T)" |> test_expr
        end
        @testset "kw" begin
            @test "f(x=1)" |> test_expr
            @test "f(x=1,y::Int = 1)" |> test_expr
        end
        @testset "compact decl" begin
            @test "f(x) = x" |> test_expr
            @test "f(x) = g(x)" |> test_expr
            @test "f(x) = (x)" |> test_expr
            @test "f(x) = (x;y)" |> test_expr
            @test "f(g(x)) = x" |> test_expr
            @test "f(g(x)) = h(x)" |> test_expr
        end
        @testset "std decl" begin
            @test "function f end" |> test_expr
            @test "function f(x) x end" |> test_expr
            @test "function f(x); x; end" |> test_expr
            @test "function f(x) x; end" |> test_expr
            @test "function f(x); x end" |> test_expr
            @test "function f(x) x;y end" |> test_expr
            @test """function f(x) x end""" |> test_expr
            @test """function f(x,y =1) x end""" |> test_expr
            @test """function f(x,y =1;z =2) x end""" |> test_expr
        end
        @testset "anonymous" begin
            @test "x->y" |> test_expr
            @test "(x,y)->x*y" |> test_expr
            @test """function ()
            return
        end""" |> test_expr
        end
    end
    @testset "types" begin
        @testset "abstract" begin
            @test "abstract type t end" |> test_expr
            @test "abstract type t{T} end" |> test_expr
            @test "abstract type t <: S end" |> test_expr
            @test "abstract type t{T} <: S end" |> test_expr
        end
        @testset "primitive" begin
            @test "primitive type Int 64 end" |> test_expr
            @test "primitive type Int 4*16 end" |> test_expr
        end
        @testset "structs" begin
            @test "struct a end" |> test_expr
            @test "struct a; end" |> test_expr
            @test "struct a; b;end" |> test_expr
            @test """struct a
                arg1
                end""" |> test_expr
            @test """struct a <: T
                arg1::Int
                arg2::Int
                end""" |> test_expr
            @test """struct a
                arg1::T
                end""" |> test_expr
            @test """struct a{T}
                arg1::T
                a(args) = new(args)
                end""" |> test_expr
            @test """struct a <: Int
                arg1::Vector{Int}
                end""" |> test_expr
            @test """mutable struct a <: Int
                arg1::Vector{Int}
                end""" |> test_expr
        end
    end
    @testset "modules" begin
        @testset "import" begin
            @test "import ModA" |> test_expr
            @test "import .ModA" |> test_expr
            @test "import ..ModA.a" |> test_expr
            @test "import ModA.subModA" |> test_expr
            @test "import ModA.subModA: a" |> test_expr
            @test "import ModA.subModA: a, b" |> test_expr
            @test "import ModA.subModA: a, b.c" |> test_expr
            @test "import .ModA.subModA: a, b.c" |> test_expr
            @test "import ..ModA.subModA: a, b.c" |> test_expr
        end
        @testset "export" begin
            @test "export ModA" |> test_expr
            @test "export a, b, c" |> test_expr
        end
    end
    @testset "generators" begin
        @test "(y for y in X)" |> test_expr
        @test "((x,y) for x in X, y in Y)" |> test_expr
        @test "(y.x for y in X)" |> test_expr
        @test "((y) for y in X)" |> test_expr
        @test "(y,x for y in X)" |> test_expr
        @test "((y,x) for y in X)" |> test_expr
        @test "[y for y in X]" |> test_expr
        @test "[(y) for y in X]" |> test_expr
        @test "[(y,x) for y in X]" |> test_expr
        @test "Int[y for y in X]" |> test_expr
        @test "Int[(y) for y in X]" |> test_expr
        @test "Int[(y,x) for y in X]" |> test_expr
        @test """
            [a
            for a = 1:2]""" |> test_expr
        @test "[ V[j][i]::T for i=1:length(V[1]), j=1:length(V) ]" |> test_expr
        @test "all(d ≥ 0 for d in B.dims)" |> test_expr
        @test "(arg for x in X)" |> test_expr
        @test "(arg for x in X for y in Y)" |> test_expr
        @test "(arg for x in X for y in Y for z in Z)" |> test_expr
        @test "(arg for x in X if A)" |> test_expr
        @test "(arg for x in X if A for y in Y)" |> test_expr
        @test "(arg for x in X if A for y in Y if B)" |> test_expr
        @test "(arg for x in X if A for y in Y for z in Z)" |> test_expr
        @test "(arg for x in X if A for y in Y if B for z in Z)" |> test_expr
        @test "(arg for x in X if A for y in Y if B for z in Z if C)" |> test_expr
        @test "(arg for x in X, y in Y for z in Z)" |> test_expr
        @test "(arg for x in X, y in Y if A for z in Z)" |> test_expr
    end
    @testset "macros " begin
        @test "macro m end" |> test_expr
        @test "macro m() end" |> test_expr
        @test "macro m() a end" |> test_expr
        @test "@mac" |> test_expr
        @test "@mac a b c" |> test_expr
        @test "@mac f(5)" |> test_expr
        @test "(@mac x)" |> test_expr
        @test "Mod.@mac a b c" |> test_expr
    # @test "[@mac a b]" |> test_expr
        @test "@inline get_chunks_id(i::Integer) = _div64(Int(i)-1)+1, _mod64(Int(i) -1)" |> test_expr
        @test "@inline f() = (), ()" |> test_expr
        @test "@sprintf(\"%08d\", id)" |> test_expr
        @test "[@m @n a for a in A]" |> test_expr
    end
    @testset "square " begin
        @testset "vect" begin
            @test "[x]" |> test_expr
            @test "[(1,2)]" |> test_expr
            @test "[x...]" |> test_expr
            @test "[1,2,3,4,5]" |> test_expr
        end
        @testset "ref" begin
            @test "t[i]" |> test_expr
            @test "t[i, j]" |> test_expr
        end
        @testset "vcat" begin
            @test "[x;]" |> test_expr
            @test "[x;y;z]" |> test_expr
            @test """[x
                  y
                  z]""" |> test_expr
            @test """[x
                  y;z]""" |> test_expr
            @test """[x;y
                  z]""" |> test_expr
            @test "[x,y;z]" |> test_expr
        end
        @testset "typed_vcat" begin
            @test "t[x;]" |> test_expr
            @test "t[x;y]" |> test_expr
            @test """t[x
                   y]""" |> test_expr
            @test "t[x;y]" |> test_expr
            @test "t[x y; z]" |> test_expr
            @test "t[x, y; z]" |> test_expr
        end
        @testset "hcat" begin
            @test "[x y]" |> test_expr
        end
        @testset "typed_hcat" begin
            @test "t[x y]" |> test_expr
        end
        @testset "compreh" begin
            @test "[i for i = 1:10]" |> test_expr
            @test "Int[i for i = 1:10]" |> test_expr
        end
    end
    @testset "kw blocks" begin
        @testset "if" begin
            @test "if cond end" |> test_expr
            @test "if cond; a; end" |> test_expr
            @test "if cond a; end" |> test_expr
            @test "if cond; a end" |> test_expr
            @test """if cond
                    1
                    1
                end""" |> test_expr
            @test """if cond
                else
                    2
                    2
                end""" |> test_expr
            @test """if cond
                    1
                    1
                else
                    2
                    2
                end""" |> test_expr
            @test "if 1<2 end" |> test_expr
            @test """if 1<2
                    f(1)
                    f(2)
                end""" |> test_expr
            @test """if 1<2
                    f(1)
                elseif 1<2
                    f(2)
                end""" |> test_expr
            @test """if 1<2
                    f(1)
                elseif 1<2
                    f(2)
                else
                    f(3)
                end""" |> test_expr
            @test "if cond a end" |> test_expr
        end
        @testset "try" begin
        # @test "try f(1) end" |> test_expr
        # @test "try; f(1) end" |> test_expr
        # @test "try; f(1); end" |> test_expr
            @test "try; f(1); catch e; e; end" |> test_expr
            @test "try; f(1); catch e; e end" |> test_expr
            @test "try; f(1); catch e e; end" |> test_expr
            @test """try
                    f(1)
                catch
                end""" |> test_expr
            @test """try
                    f(1)
                catch
                    error(err)
                end""" |> test_expr
            @test """try
                    f(1)
                catch err
                    error(err)
                end""" |> test_expr
            @test """try
                    f(1)
                catch
                    error(err)
                finally
                    stop(f)
                end""" |> test_expr
            @test """try
                    f(1)
                catch err
                    error(err)
                finally
                    stop(f)
                end""" |> test_expr
            @test """try
                    f(1)
                finally
                    stop(f)
                end""" |> test_expr
        end
        @testset "for" begin
            @test """for i = 1:10
                    f(i)
                end""" |> test_expr
            @test """for i = 1:10, j = 1:20
                    f(i)
                end""" |> test_expr
        end
        @testset "let" begin
            @test """let x = 1
                    f(x)
                end""" |> test_expr
            @test """let x = 1, y = 2
                    f(x)
                end""" |> test_expr
            @test """let
                    x
                end""" |> test_expr
        end
        @testset "do" begin
            @test """f(X) do x
                    return x
                end""" |> test_expr
            @test """f(X,Y) do x,y
                    return x,y
                end""" |> test_expr
            @test "f() do x body end" |> test_expr
        end
    end
    @testset "triple-quoted string" begin
        @test val(JLParse.parse("\"\"\" \" \"\"\"")) == " \" "
        @test val(JLParse.parse("\"\"\"a\"\"\"")) == "a"
        @test val(JLParse.parse("\"\"\"\"\"\"")) == ""
        @test val(JLParse.parse("\"\"\"\n\t \ta\n\n\t \tb\"\"\"")) == "a\n\nb"
        @test Expr(JLParse.parse("\"\"\"\ta\n\tb \$c\n\td\n\"\"\"")) == Expr(:string, "\ta\n\tb ", :c, "\n\td\n")
        @test Expr(JLParse.parse("\"\"\"\n\ta\n\tb \$c\n\td\n\"\"\"")) == Expr(:string, "\ta\n\tb ", :c, "\n\td\n")
        @test Expr(JLParse.parse("\"\"\"\n\ta\n\tb \$c\n\td\n\t\"\"\"")) == Expr(:string, "a\nb ", :c, "\nd\n")
        @test Expr(JLParse.parse("\"\"\"\n\t \ta\$(1+\n1)\n\t \tb\"\"\"")) == Expr(:string, "a", :(1 + 1), "\nb")
        ws = "                         "
        "\"\"\"\n$ws%rv = atomicrmw \$rmw \$lt* %0, \$lt %1 acq_rel\n$(ws)ret \$lt %rv\n$ws\"\"\"" |> test_expr
        ws1 = "        "
        ws2 = "    "
        "\"\"\"\n$(ws1)a\n$(ws1)b\n$(ws2)c\n$(ws2)d\n$(ws2)\"\"\"" |> test_expr
        "\"\"\"\n$(ws1)a\n\n$(ws1)b\n\n$(ws2)c\n\n$(ws2)d\n\n$(ws2)\"\"\"" |> test_expr
        @test "\"\"\"\n$(ws1)α\n$(ws1)β\n$(ws2)γ\n$(ws2)δ\n$(ws2)\"\"\"" |> test_expr
        @test "\"\"\"Float\$(bit)\"\"\"" |> test_expr
        @test JLParse.parse("\"\"\"abc\$(de)fg\"\"\"")[3].kind == Scan.STRING
        @test JLParse.parse("\"\"\"abc(de)fg\"\"\"").kind == Scan.STRING3
    end
    @testset "updates" begin
        @test "[ V[j][i]::T for i=1:length(V[1]), j=1:length(V) ]" |> test_expr
        @test "all(d ≥ 0 for d in B.dims)" |> test_expr
        @test ":(=)" |> test_expr
        @test ":(1)" |> test_expr
        @test ":(a)" |> test_expr
        @test "(@_inline_meta(); f(x))" |> test_expr
        @test "isa(a,b) != c" |> test_expr
        @test "isa(a,a) != isa(a,a)" |> test_expr
        @test "@mac return x" |> test_expr
        @test head(JLParse.parse("a,b,").args[4]) === JLParse.ErrTok
        @test "m!=m" |> test_expr
        @test "+(x...)" |> test_expr
        @test "+(promote(x,y)...)" |> test_expr
        @test "\$(x...)" |> test_expr #
        @test "ccall(:gethostname, stdcall, Int32, ())" |> test_expr
        @test "@inbounds @ncall a b c" |> test_expr
        @test "(a+b)``" |> test_expr
        @test "(-, ~)" |> test_expr
        @test """function +(x::Bool, y::T)::promote_type(Bool,T) where T<:AbstractFloat
                return ifelse(x, oneunit(y) + y, y)
            end""" |> test_expr
        @test """finalizer(x,x::GClosure->begin
                    ccall((:g_closure_unref,Gtk.GLib.libgobject),Void,(Ptr{GClosure},),x.handle)
                end)""" |> test_expr
        @test "function \$A end" |> test_expr
        @test "&ctx->exe_ctx_ref" |> test_expr
        @test ":(\$(docstr).\$(TEMP_SYM)[\$(key)])" |> test_expr
        @test "SpecialFunctions.\$(fsym)(n::Dual)" |> test_expr
        @test "(Base.@_pure_meta;)" |> test_expr
        @test "@M a b->(@N c = @O d e f->g)" |> test_expr
        @test "! = f" |> test_expr
        @test "[a=>1, b=>2]" |> test_expr
        @test "a.\$(b)" |> test_expr
        @test "a.\$f()" |> test_expr
        @test "4x/y" |> test_expr
        @test """
              ccall(:jl_finalize_th, Void, (Ptr{Void}, Any,),
                          Core.getptls(), o)
              """ |> test_expr
        @test """
              A[if n == d
                  i
              else
                  (indices(A,n) for n = 1:nd)
              end...]
              """ |> test_expr
        @test """
              @spawnat(p,
                  let m = a
                      isa(m, Exception) ? m : nothing
                  end)
              """ |> test_expr #
        @test "[@spawn f(R, first(c), last(c)) for c in splitrange(length(R), nworkers())]" |> test_expr
        @test "M.:(a)" |> test_expr
        @test """
              begin
                  for i in I for j in J
                      if cond
                          a
                      end
                  end end
              end""" |> test_expr
        @test "-f.(a.b + c)" |> test_expr
        @test ":(import Base: @doc)" |> test_expr
        @test "[a for a in A for b in B]" |> test_expr
        @test "+(a,b,c...)" |> test_expr
        @test """@testset a for t in T
                  t
              end""" |> test_expr
        @test "import Base.==" |> test_expr
        @test "a`text`" |> test_expr
        @test "a``" |> test_expr
        @test "a`text`b" |> test_expr
        @test "[a; a 0]" |> test_expr
        @test "[a, b; c]" |> test_expr
        @test "t{a; b} " |> test_expr
        @test "a ~ b + c -d" |> test_expr
        @test "y[j=1:10,k=3:2:9; isodd(j+k) && k <= 8]" |> test_expr
        @test "(8=>32.0, 12=>33.1, 6=>18.2)" |> test_expr
        @test "(a,b = c,d)" |> test_expr
        @test "[ -1 -2;]" |> test_expr
        @test "-2y" |> test_expr # rank
        @test "'''" |> test_expr # scan
        @test """
                if j+k <= deg +1
                end
                """ |> test_expr
        @test "function f() ::T end" |> test_expr
        @test "import Base: +, -, .+, .-" |> test_expr
        @test "[a +   + l]" |> test_expr
        @test "@inbounds C[i,j] = - α[i] * αjc" |> test_expr
        @test "@inbounds C[i,j] = - n * p[i] * pj" |> test_expr
        @test """
                if ! a
                    b
                end
                """ |> test_expr
        @test "[:-\n:+]" |> test_expr
        @test "::a::b" |> test_expr
        @test "-[1:nc]" |> test_expr
        @test "f() where {a} = b" |> test_expr
        @test "@assert .!(isna(res[2]))" |> test_expr # v0.6
        @test "-((attr.rise / PANGO_SCALE)pt).value" |> test_expr
        @test "!(a = b)" |> test_expr
        @test "-(1)a" |> test_expr
        @test "!(a)::T" |> test_expr
        @test "a::b where T<:S" |> test_expr
        @test "+(x::Bool, y::T)::promote_type(Bool,T) where T<:AbstractFloat" |> test_expr
        @test "T where V<:(T where T)" |> test_expr
        @test "function ^(z::Complex{T}, p::Complex{T})::Complex{T} where T<:AbstractFloat end" |> test_expr
        @test "function +(a) where T where S end" |> test_expr
        @test "function -(x::Rational{T}) where T<:Signed end" |> test_expr
        @test "\$(a)(b)" |> test_expr
        @test "if !(a) break end" |> test_expr
        @test "module a() end" |> test_expr
        @test "M.r\"str\" " |> test_expr
        @test "f(a for a in A if cond)" |> test_expr
        @test "\"dimension \$d is not 1 ≤ \$d ≤ \$nd\" " |> test_expr
        @test "-(-x)^1" |> test_expr
        @test """
        "\\\\\$ch"
        """ |> test_expr
        @test "µs" |> test_expr # normalize unicode
        @test """(x, o; p = 1) -> begin
              return o, p
              end""" |> test_expr # normalize unicode
        @test """(x, o...; p...) -> begin
              return o, p
              end""" |> test_expr # normalize unicode
        @test "function func() where {A where T} x + 1 end" |> test_expr # nested where
        @test "(;x)" |> test_expr # issue 39
        @test """let f = ((; a = 1, b = 2) -> ()),
              m = first(methods(f))
              @test DSE.keywords(f, m) == [:a, :b]
          end""" |> test_expr
        @test "-1^a" |> test_expr
        @test "function(f, args...; kw...) end" |> test_expr
        @test "2a * b" |> test_expr
        @test "(g1090(x::T)::T) where {T} = x+1.0" |> test_expr
        @test "(:) = Colon()" |> test_expr
        @test "a + in[1]" |> test_expr
        @test "function f(ex) +a end" |> test_expr
        @test "x`\\\\`" |> test_expr
        @test "x\"\\\\\"" |> test_expr
        @test "x\"\\\\ \"" |> test_expr
        @test "a.{1}" |> test_expr
        @test "@~" |> test_expr
        @test "\$\$(x)" |> test_expr
        @test "\$\$(x)" |> test_expr
        @test JLParse.head(JLParse.parse("=")) === JLParse.ErrTok
        @test JLParse.head(JLParse.parse("~")) === JLParse.OP
        @test "(1:\n2)" |> test_expr
        @test "a[: ]" |> test_expr
    end
    @testset "interpolation error" begin
        x = JLParse.parse("\"a \$ b\"")
        @test x.fullspan == 7
        @test JLParse.head(x[2]) === JLParse.ErrTok
        x = JLParse.parse("\"a \$# b\"")
        @test x.fullspan == 8
        @test JLParse.head(x[2]) === JLParse.ErrTok
    end
    #= 
    @testset "brokens" begin
        @test_broken "\$(a) * -\$(b)" |> test_expr_broken
    end =#
    # test_fsig_decl(str) = (x->x.id).(JLParse._get_fsig(JLParse.parse(str)).defs)
    # @testset "func-sig variable declarations" begin
    #     @test test_fsig_decl("f(x) = x") == [:x]
    #     @test test_fsig_decl("""function f(x)
    #         x
    #     end""") == [:x]
    #     @test test_fsig_decl("f{T}(x::T) = x") == [:T, :x]
    #     @test test_fsig_decl("""function f{T}(x::T)
    #         x
    #     end""") == [:T, :x]
    #     @test test_fsig_decl("f(x::T) where T = x") == [:T, :x]
    #     @test test_fsig_decl("""function f(x::T) where T
    #         x
    #     end""") == [:T, :x]
    #     @test test_fsig_decl("f(x::T{S}) where T where S = x") == [:T, :S, :x]
    #     @test test_fsig_decl("""function f(x::T{S}) where T where S
    #         x
    #     end""") == [:T, :S, :x]
    # end
    @testset "spans" begin
        JLParse.parse(raw"""
            "ABC$(T)"
            """).fullspan >= 9
        JLParse.parse("\"_\"").fullspan == 3
        JLParse.parse("T.mutable && print(\"Ok\")").fullspan == 24
        JLParse.parse("(\"\$T\")").fullspan == 6
        JLParse.parse("\"\"\"\$T is not supported\"\"\"").fullspan == 25
        JLParse.parse("using Compat: @compat\n").fullspan == 22
        JLParse.parse("primitive = 1").fullspan == 13
    end
    @testset "command or string" begin
        @test "```αhelloworldω```" |> test_expr
        @test "\"αhelloworldω\"" |> test_expr
    end
    @testset "floats with underscore" begin
        @test "30.424_876_125_859_513" |> test_expr
    end
    @testset "errors" begin
        @test head(JLParse.parse("1? b : c ")[1]) === JLParse.ErrTok
        @test head(JLParse.parse("1 ?b : c ")[2]) === JLParse.ErrTok
        @test head(JLParse.parse("1 ? b :c ")[4]) === JLParse.ErrTok
        @test head(JLParse.parse("1:\n2")[2]) === JLParse.ErrTok
        @test head(JLParse.parse("1.a")[1]) === JLParse.ErrTok
        @test head(JLParse.parse("f ()")) === JLParse.ErrTok
        @test head(JLParse.parse("f{t} ()")) === JLParse.ErrTok
        @test head(JLParse.parse(": a")[1]) === JLParse.ErrTok
        @test head(JLParse.parse("const a")[2]) === JLParse.ErrTok
        @test head(JLParse.parse("const a = 1")[2]) === JLParse.BinyOpCall
        @test head(JLParse.parse("const global a")[2]) === JLParse.ErrTok
        @test head(JLParse.parse("const global a = 1")[2]) === JLParse.Global
    end
    @testset "tuple params" begin
        @test "1,2,3" |> test_expr
        @test "1;2,3" |> test_expr
        @test "1,2;3" |> test_expr
        @test "(1,2,3)" |> test_expr
        @test "(1;2,3)" |> test_expr
        @test "(1,2;3)" |> test_expr
        @test "f(;)" |> test_expr
    end
    @testset "docs" begin
        @test "\"doc\"\nT" |> test_expr
        @test "@doc \"doc\" T" |> test_expr
        @test "@doc \"doc\"\nT" |> test_expr
        @test "@doc \"doc\n\n\n\"\nT" |> test_expr
        @test "begin\n@doc \"doc\"\n\nT\nend" |> test_expr
        @test "@doc \"I am a module\" ModuleMacroDoc" |> test_expr
    end
    @testset "braces" begin
        @test "{a}" |> test_expr
        @test "{a, b}" |> test_expr
        @test "{a, b; c}" |> test_expr
        @test "{a, b; c = 1}" |> test_expr
        @test "{a b}" |> test_expr
        @test "{a b; c}" |> test_expr
        @test "{a b; c = 1}" |> test_expr
    end
    @testset "import ranking dot" begin
        @test JLParse.parse("using . M")[2].fullspan == 2
        @test JLParse.parse("using .. M")[3].fullspan == 2
        @test JLParse.parse("using ... M")[4].fullspan == 2
    end
    @testset "issues" begin
        @test """
            function foo() where {A <:B}
                body
            end""" |> test_expr
        @test """
            function foo() where {A <: B}
                body
            end""" |> test_expr
        x = JLParse.parse("""
            a ? b 
            function f end""")
        @test length(x) == 5 # make sure we always give out an Exp2 of the right length
        @test head(x[4]) === JLParse.ErrTok
        @test head(x[4][1]) === JLParse.OP
        x = JLParse.parse("""
            quote 
                \"\"\"
                txt
                \"\"\"
                sym
            end""")
        @test head(x[2][1][1]) === JLParse.GlobalRefDoc
        @test test_expr(":var\"id\"")
        @test test_expr("\"\$( a)\"")
        @test test_expr("\"\$(#=comment=# a)\"")
        @test test_expr("function f(a; where = false) end")
    end
    @testset "function defs" begin
        @test JLParse.def_func(JLParse.parse("function f end"))
        @test JLParse.def_func(JLParse.parse("function f() end"))
        @test JLParse.def_func(JLParse.parse("function f()::T end"))
        @test JLParse.def_func(JLParse.parse("function f(x::T) where T end"))
        @test JLParse.def_func(JLParse.parse("function f{T}() end"))
        @test JLParse.def_func(JLParse.parse("f(x) = x"))
        @test JLParse.def_func(JLParse.parse("f(x)::T = x"))
        @test JLParse.def_func(JLParse.parse("f{T}(x)::T = x"))
        @test JLParse.def_func(JLParse.parse("f{T}(x)::T = x"))
        @test JLParse.def_func(JLParse.parse("*(x,y) = x"))
        @test JLParse.def_func(JLParse.parse("*(x,y)::T = x"))
        @test JLParse.def_func(JLParse.parse("!(x::T)::T = x"))
        @test JLParse.def_func(JLParse.parse("a + b = a"))
        @test JLParse.def_func(JLParse.parse("a/b = x"))
        @test !JLParse.def_func(JLParse.parse("a.b = x"))
    end
    @testset "datatype defs" begin
        @test JLParse.def_struct(JLParse.parse("struct T end"))
        @test JLParse.def_struct(JLParse.parse("mutable struct T end"))
        @test JLParse.def_mutable(JLParse.parse("mutable struct T end"))
        @test JLParse.def_abstract(JLParse.parse("abstract type T end"))
    # @test JLParse.def_abstract(JLParse.parse("abstract T"))
        @test JLParse.def_primitive(JLParse.parse("primitive type a b end"))
    end
    @testset "get_name" begin
        @test val(JLParse.get_name(JLParse.parse("struct T end"))) == "T"
        @test val(JLParse.get_name(JLParse.parse("struct T{T} end"))) == "T"
        @test val(JLParse.get_name(JLParse.parse("struct T <: T end"))) == "T"
        @test val(JLParse.get_name(JLParse.parse("struct T{T} <: T end"))) == "T"
        @test val(JLParse.get_name(JLParse.parse("mutable struct T end"))) == "T"
        @test val(JLParse.get_name(JLParse.parse("mutable struct T{T} end"))) == "T"
        @test val(JLParse.get_name(JLParse.parse("mutable struct T <: T end"))) == "T"
        @test val(JLParse.get_name(JLParse.parse("mutable struct T{T} <: T end"))) == "T"
        @test val(JLParse.get_name(JLParse.parse("abstract type T end"))) == "T"
        @test val(JLParse.get_name(JLParse.parse("abstract type T{T} end"))) == "T"
        @test val(JLParse.get_name(JLParse.parse("abstract type T <: T end"))) == "T"
        @test val(JLParse.get_name(JLParse.parse("abstract type T{T} <: T end"))) == "T"
    # NEEDS FIX: v0.6 dep
    # @test JLParse.get_name(JLParse.parse("abstract T")).val == "T"
    # @test JLParse.get_name(JLParse.parse("abstract T{T}")).val == "T"
    # @test JLParse.get_name(JLParse.parse("abstract T <: T")).val == "T"
    # @test JLParse.get_name(JLParse.parse("abstract T{T} <: T")).val == "T"
        @test val(JLParse.get_name(JLParse.parse("function f end"))) == "f"
        @test val(JLParse.get_name(JLParse.parse("function f() end"))) == "f"
        @test val(JLParse.get_name(JLParse.parse("function f()::T end"))) == "f"
        @test val(JLParse.get_name(JLParse.parse("function f(x::T) where T end"))) == "f"
        @test val(JLParse.get_name(JLParse.parse("function f{T}() end"))) == "f"
        @test JLParse.str_value(JLParse.get_name(JLParse.parse("function +() end"))) == "+"
        @test JLParse.str_value(JLParse.get_name(JLParse.parse("function (+)() end"))) == "+"
        @test JLParse.str_value(JLParse.get_name(JLParse.parse("+(x,y) = x"))) == "+"
        @test JLParse.str_value(JLParse.get_name(JLParse.parse("+(x,y)::T = x"))) == "+"
        @test JLParse.str_value(JLParse.get_name(JLParse.parse("!(x)::T = x"))) == "!"
        @test JLParse.str_value(JLParse.get_name(JLParse.parse("!(x) = x"))) == "!"
    end
    # @testset "get_sig_params" begin
    #     f = x -> JLParse.str_value.(JLParse.get_args(JLParse.parse(x)))
    #     @test f("function f(a) end") == ["a"]
    #     @test f("function f(a::T) end") == ["a"]
    #     @test f("function f(a,b) end") == ["a", "b"]
    #     @test f("function f(a::T,b::T) end") == ["a", "b"]
    #     @test f("function f(a::T,b::T) where T end") == ["a", "b"]
    #     @test f("function f{T}(a::T,b::T) where T end") == ["a", "b"]
    #     @test f("function f{T}(a::T,b::T;c = 1) where T end") == ["a", "b", "c"]

    #     @test f("a -> a") == ["a"]
    #     @test f("a::T -> a") == ["a"]
    #     @test f("(a::T) -> a") == ["a"]
    #     @test f("(a,b) -> a") == ["a", "b"]

    #     @test f("map(1:10) do a
    #         a
    #     end") == ["a"]
    #     @test f("map(1:10) do a,b
    #         a
    #     end") == ["a", "b"]
    # end
    @testset "has_err" begin
        @test JLParse.has_err(JLParse.parse(","))
        @test JLParse.has_err(JLParse.parse("foo(bar(\"\$ x\"))"))
        @test !JLParse.has_err(JLParse.parse("foo(bar(\"\$x\"))"))
    end
end
