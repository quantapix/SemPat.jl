tok(str, i=1) = collect(scan(str))[i]

@testset "tokens" begin
    for s in ["a", IOBuffer("a")]
        l = scan(s)
        @test Scan.read_one(l) == 'a'
        # @test l.current_pos == 0
        l_old = l
        @test l == l_old
        @test Scan.is_eof(l)
        @test Scan.read_one(l) == Scan.EOF_CHAR
        # @test l.current_pos == 0
    end
end
@testset "unicode" begin
    str = "𝘋 =2β"
    for s in [str, IOBuffer(str)]
        l = scan(s)
        kinds = [Scan.ID, Scan.WS, Scan.OP, Scan.INTEGER, Scan.ID, Scan.ENDMARKER]
        token_strs = ["𝘋", " ", "=", "2", "β", ""]
        for (i, n) in enumerate(l)
            @test Scan.kind(n) == kinds[i]
            @test unscan(n) == token_strs[i]
            @test Scan.from_loc(n) == (1, i)
            @test Scan.to_loc(n) == (1, i - 1 + length(token_strs[i]))
        end
    end
end
@testset "complex code" begin
    str = """
    function foo!{T<:Bar}(x::{T}=12)
        @time (x+x, x+x);
    end
    try
        foo
    catch
        bar
    end
    @time x+x
    y[[1 2 3]]
    [1*2,2;3,4]
    "string"; 'c'
    (a&&b)||(a||b)
    # comment
    #= comment
    is done here =#
    2%5
    a'/b'
    a.'\\b.'
    `command`
    12_sin(12)
    {}
    '
    """
    # Generate the following with
    # ```
    # for t in Scan.kind.(collect(scan(str)))
    #    print("Scan.", t, ",")
    # end
    # ```
    # and *check* it afterwards.
    kinds = [Scan.KW,Scan.WS,Scan.ID,Scan.LBRACE,Scan.ID,
            Scan.OP,Scan.ID,Scan.RBRACE,Scan.LPAREN,Scan.ID,Scan.OP,
            Scan.LBRACE,Scan.ID,Scan.RBRACE,Scan.OP,Scan.INTEGER,Scan.RPAREN,

            Scan.WS,Scan.AT_SIGN,Scan.ID,Scan.WS,Scan.LPAREN,
            Scan.ID,Scan.OP,Scan.ID,Scan.COMMA,Scan.WS,
            Scan.ID,Scan.OP,Scan.ID,Scan.RPAREN,Scan.SEMICOL,

            Scan.WS,Scan.KW,

            Scan.WS,Scan.KW,
            Scan.WS,Scan.ID,
            Scan.WS,Scan.KW,
            Scan.WS,Scan.ID,
            Scan.WS,Scan.KW,

            Scan.WS,Scan.AT_SIGN,Scan.ID,Scan.WS,Scan.ID,
            Scan.OP,Scan.ID,

            Scan.WS,Scan.ID,Scan.LSQUARE,Scan.LSQUARE,Scan.INTEGER,Scan.WS,
            Scan.INTEGER,Scan.WS,Scan.INTEGER,Scan.RSQUARE,Scan.RSQUARE,

            Scan.WS,Scan.LSQUARE,Scan.INTEGER,Scan.OP,Scan.INTEGER,Scan.COMMA,Scan.INTEGER,
            Scan.SEMICOL,Scan.INTEGER,Scan.COMMA,Scan.INTEGER,Scan.RSQUARE,

            Scan.WS,Scan.STRING,Scan.SEMICOL,Scan.WS,Scan.CHAR,

            Scan.WS,Scan.LPAREN,Scan.ID,Scan.OP,Scan.ID,Scan.RPAREN,Scan.OP,
            Scan.LPAREN,Scan.ID,Scan.OP,Scan.ID,Scan.RPAREN,

            Scan.WS,Scan.COMMENT,

            Scan.WS,Scan.COMMENT,

            Scan.WS,Scan.INTEGER,Scan.OP,Scan.INTEGER,

            Scan.WS,Scan.ID,Scan.OP,Scan.OP,Scan.ID,Scan.OP,

            Scan.WS,Scan.ID,Scan.OP,Scan.OP,Scan.OP,Scan.ID,Scan.OP,Scan.OP,

            Scan.WS,Scan.CMD,

            Scan.WS,Scan.INTEGER,Scan.ID,Scan.LPAREN,Scan.INTEGER,Scan.RPAREN,

            Scan.WS,Scan.LBRACE,Scan.RBRACE,

            Scan.WS,Scan.ERROR,Scan.ENDMARKER]

    for (i, n) in enumerate(scan(str))
        @test Scan.kind(n) == kinds[i]
    end
    for (i, n) in enumerate(scan(str, Scan.RawTok))
        @test Scan.kind(n) == kinds[i]
    end
    @testset "roundtrippability" begin
        @test join(unscan.(collect(scan(str)))) == str
        @test unscan(collect(scan(str))) == str
        @test unscan(scan(str)) == str
        @test_throws ArgumentError unscan("blabla")
    end
    @test all((t.pos.to - t.pos.from + 1) == sizeof(unscan(t)) for t in scan(str))
end
@testset "issue 5, '..'" begin
    @test Scan.kind.(collect(scan("1.23..3.21"))) == [Scan.FLOAT,Scan.OP,Scan.FLOAT,Scan.ENDMARKER]
end
@testset "issue 17, >>" begin
    @test unscan(tok(">> ")) == ">>"
end
@testset "test added operators" begin
    @test tok("1+=2",  2).kind == Scan.PLUS_EQ
    @test tok("1-=2",  2).kind == Scan.MINUS_EQ
    @test tok("1:=2",  2).kind == Scan.COLON_EQ
    @test tok("1*=2",  2).kind == Scan.STAR_EQ
    @test tok("1^=2",  2).kind == Scan.CIRCUMFLEX_EQ
    @test tok("1÷=2",  2).kind == Scan.DIVISION_EQ
    @test tok("1\\=2", 2).kind == Scan.BACKSLASH_EQ
    @test tok("1\$=2", 2).kind == Scan.EX_OR_EQ
    @test tok("1-->2", 2).kind == Scan.RIGHT_ARROW
    @test tok("1>:2",  2).kind == Scan.ISSUPERTYPE
end
@testset "infix" begin
    @test tok("1 in 2",  3).kind == Scan.IN
    @test tok("1 in[1]", 3).kind == Scan.IN
    if VERSION >= v"0.6.0-dev.1471"
        @test tok("1 isa 2",  3).kind == Scan.ISA
        @test tok("1 isa[2]", 3).kind == Scan.ISA
    else
        @test tok("1 isa 2",  3).kind == Scan.ID
        @test tok("1 isa[2]", 3).kind == Scan.ID
    end
end
@testset "tokenizing true/false literals" begin
    @test tok("somtext true", 3).kind == Scan.TRUE
    @test tok("somtext false", 3).kind == Scan.FALSE
    @test tok("somtext tr", 3).kind == Scan.ID
    @test tok("somtext falsething", 3).kind == Scan.ID
end
@testset "tokenizing juxtaposed numbers and dotted operators/identifiers" begin
    @test (t -> t.val == "1234"    && t.kind == Scan.INTEGER )(tok("1234 .+1"))
    @test (t -> t.val == "1234.0"  && t.kind == Scan.FLOAT   )(tok("1234.0.+1"))
    @test (t -> t.val == "1234.0"  && t.kind == Scan.FLOAT   )(tok("1234.0 .+1"))
    @test (t -> t.val == "1234."   && t.kind == Scan.FLOAT   )(tok("1234.f(a)"))
    @test (t -> t.val == "1234"    && t.kind == Scan.INTEGER )(tok("1234 .f(a)"))
    @test (t -> t.val == "1234.0." && t.kind == Scan.ERROR   )(tok("1234.0.f(a)"))
    @test (t -> t.val == "1234.0"  && t.kind == Scan.FLOAT   )(tok("1234.0 .f(a)"))
end
@testset "lexing anon functions '->' " begin
    @test tok("a->b", 2).kind == Scan.ANON_FUNC
end
@testset "comments" begin
    toks = collect(scan("""
       #
       \"\"\"
       f
       \"\"\"
       1
       """))
    kinds = [Scan.COMMENT, Scan.WS,
             Scan.STRING3, Scan.WS,
             Scan.INTEGER, Scan.WS,
             Scan.ENDMARKER]
    @test Scan.kind.(toks) == kinds
end
@testset "primes" begin
    tokens = collect(scan(
    """
    ImageMagick.save(fn, reinterpret(ARGB32, [0xf0884422]''))
    D = ImageMagick.load(fn)
    """))
    @test string(unscan(tokens[16])) == string(unscan(tokens[17])) == "'"
    @test tok("'a'").val == "'a'"
    @test tok("'a'").kind == Scan.CHAR
    @test tok("''").val == "''"
    @test tok("''").kind == Scan.CHAR
    @test tok("'''").val == "'''"
    @test tok("'''").kind == Scan.CHAR
    @test tok("''''", 1).kind == Scan.CHAR
    @test tok("''''", 2).kind == Scan.PRIME
    @test tok("()'", 3).kind == Scan.PRIME
    @test tok("{}'", 3).kind == Scan.PRIME
    @test tok("[]'", 3).kind == Scan.PRIME
end
@testset "keywords" begin
    for kw in    ["function",
                    "abstract",
                    "baremodule",
                    "begin",
                    "break",
                    "catch",
                    "const",
                    "continue",
                    "do",
                    "else",
                    "elseif",
                    "end",
                    "export",
                    # "false",
                    "finally",
                    "for",
                    "function",
                    "global",
                    "let",
                    "local",
                    "if",
                    "import",
                    "importall",
                    "macro",
                    "module",
                    "mutable",
                    "primitive",
                    "quote",
                    "return",
                    "struct",
                    # "true",
                    "try",
                    "type",
                    "using",
                    "while"]
        @test Scan.kind(tok(kw)) == Scan.KW
    end
end
@testset "issue in PR #45" begin
    @test length(collect(scan("x)"))) == 3
end
@testset "errors" begin
    @test tok("#=   #= =#", 1).kind == Scan.ERROR
    @test tok("'dsadsa", 1).kind == Scan.ERROR
    @test tok("aa **", 3).kind == Scan.ERROR
    @test tok("aa \"   ", 3).kind == Scan.ERROR
    @test tok("aa \"\"\" \"dsad\" \"\"", 3).kind == Scan.ERROR
end
@testset "xor_eq" begin
    @test tok("1 ⊻= 2", 3).kind == Scan.XOR_EQ
end
@testset "lex binary" begin
    @test tok("0b0101").kind == Scan.BIN_INT
end
@testset "show" begin
    io = IOBuffer()
    show(io, collect(scan("\"abc\nd\"ef"))[1])
    @test String(take!(io)) == "1,1-2,2          STRING         \"\\\"abc\\nd\\\"\""
end
@testset "interpolation" begin
    ts = collect(scan(""""str: \$(g("str: \$(h("str"))"))" """))
    @test length(ts) == 3
    @test ts[1].kind == Scan.STRING
    ts = collect(scan("""\"\$\""""))
    @test ts[1].kind == Scan.STRING
    t_err = tok("\"\$(fdsf\"")
    @test t_err.kind == Scan.ERROR
    @test t_err.err == Scan.EOF_STRING_ERR
    @test Scan.from_loc(t_err) == (1, 1)
    @test Scan.to_loc(t_err) == (1, 8)
end
@testset "inferred" begin
    l = scan("abc")
    @inferred Scan.next_token(l)
    l = scan("abc", Scan.RawTok)
    @inferred Scan.next_token(l)
end
@testset "modifying function names (!) followed by operator" begin
    @test tok("a!=b",  2).kind == Scan.NOT_EQ
    @test tok("a!!=b", 2).kind == Scan.NOT_EQ
    @test tok("!=b",   1).kind == Scan.NOT_EQ
end
@testset "lex integers" begin
    @test tok("1234").kind == Scan.INTEGER
    @test tok("12_34").kind == Scan.INTEGER
    @test tok("_1234").kind == Scan.ID
    @test tok("1234_").kind == Scan.INTEGER
    @test tok("1234_", 2).kind == Scan.ID
    @test tok("1234x").kind == Scan.INTEGER
    @test tok("1234x", 2).kind == Scan.ID
end
@testset "floats with trailing `.` " begin
    @test tok("1.0").kind == Scan.FLOAT
    @test tok("1.a").kind == Scan.FLOAT
    @test tok("1.(").kind == Scan.FLOAT
    @test tok("1.[").kind == Scan.FLOAT
    @test tok("1.{").kind == Scan.FLOAT
    @test tok("1.)").kind == Scan.FLOAT
    @test tok("1.]").kind == Scan.FLOAT
    @test tok("1.{").kind == Scan.FLOAT
    @test tok("1.,").kind == Scan.FLOAT
    @test tok("1.;").kind == Scan.FLOAT
    @test tok("1.@").kind == Scan.FLOAT
    @test tok("1.").kind == Scan.FLOAT
    @test tok("1.\"text\" ").kind == Scan.FLOAT
    @test tok("1..").kind == Scan.INTEGER
    @test Scan.kind.(collect(scan("1f0./1"))) == [Scan.FLOAT, Scan.OP, Scan.INTEGER, Scan.ENDMARKER]
end
@testset "lex octal" begin
    @test tok("0o0167").kind == Scan.OCT_INT
end
@testset "lex float/bin/hex/oct w underscores" begin
    @test tok("1_1.11").kind == Scan.FLOAT
    @test tok("11.1_1").kind == Scan.FLOAT
    @test tok("1_1.1_1").kind == Scan.FLOAT
    @test tok("_1.1_1", 1).kind == Scan.ID
    @test tok("_1.1_1", 2).kind == Scan.FLOAT
    @test tok("0x0167_032").kind == Scan.HEX_INT
    @test tok("0b0101001_0100_0101").kind == Scan.BIN_INT
    @test tok("0o01054001_0100_0101").kind == Scan.OCT_INT
    @test Scan.kind.(collect(scan("1.2."))) == [Scan.ERROR, Scan.ENDMARKER]
    @test tok("1__2").kind == Scan.INTEGER
    @test tok("1.2_3").kind == Scan.FLOAT
    @test tok("1.2_3", 2).kind == Scan.ENDMARKER
    @test Scan.kind.(collect(scan("3e2_2"))) == [Scan.FLOAT, Scan.ID, Scan.ENDMARKER]
    @test Scan.kind.(collect(scan("1__2"))) == [Scan.INTEGER, Scan.ID, Scan.ENDMARKER]
    @test Scan.kind.(collect(scan("0x2_0_2"))) == [Scan.HEX_INT, Scan.ENDMARKER]
    @test Scan.kind.(collect(scan("0x2__2"))) == [Scan.HEX_INT, Scan.ID, Scan.ENDMARKER]
    @test Scan.kind.(collect(scan("3_2.5_2"))) == [Scan.FLOAT, Scan.ENDMARKER]
    @test Scan.kind.(collect(scan("3.2e2.2"))) == [Scan.ERROR, Scan.INTEGER, Scan.ENDMARKER]
    @test Scan.kind.(collect(scan("3e2.2"))) == [Scan.ERROR, Scan.INTEGER, Scan.ENDMARKER]
    @test Scan.kind.(collect(scan("0b101__101"))) == [Scan.BIN_INT, Scan.ID, Scan.ENDMARKER]
end
@testset "floating points" begin
    @test tok("1.0e0").kind == Scan.FLOAT
    @test tok("1.0e-0").kind == Scan.FLOAT
    @test tok("1.0E0").kind == Scan.FLOAT
    @test tok("1.0E-0").kind == Scan.FLOAT
    @test tok("1.0f0").kind == Scan.FLOAT
    @test tok("1.0f-0").kind == Scan.FLOAT
    @test tok("0e0").kind == Scan.FLOAT
    @test tok("0e+0").kind == Scan.FLOAT
    @test tok("0E0").kind == Scan.FLOAT
    @test tok("201E+0").kind == Scan.FLOAT
    @test tok("2f+0").kind == Scan.FLOAT
    @test tok("2048f0").kind == Scan.FLOAT
    @test tok("1.:0").kind == Scan.FLOAT
    @test tok("0x00p2").kind == Scan.FLOAT
    @test tok("0x00P2").kind == Scan.FLOAT
    @test tok("0x0.00p23").kind == Scan.FLOAT
    @test tok("0x0.0ap23").kind == Scan.FLOAT
    @test tok("0x0.0_0p2").kind == Scan.FLOAT
    @test tok("0x0_0_0.0_0p2").kind == Scan.FLOAT
    @test tok("0x0p+2").kind == Scan.FLOAT
    @test tok("0x0p-2").kind == Scan.FLOAT
end
@testset "1e1" begin
    @test tok("1e", 1).kind == Scan.INTEGER
    @test tok("1e", 2).kind == Scan.ID
end
@testset "jl06types" begin
    @test tok("mutable").kind == Scan.MUTABLE
    @test tok("primitive").kind == Scan.PRIMITIVE
    @test tok("struct").kind == Scan.STRUCT
    @test tok("where").kind == Scan.WHERE
    @test tok("mutable struct s{T} where T",  1).kind == Scan.MUTABLE
    @test tok("mutable struct s{T} where T",  3).kind == Scan.STRUCT
    @test tok("mutable struct s{T} where T", 10).kind == Scan.WHERE
end
@testset "CMDs" begin
    @test tok("`cmd`").kind == Scan.CMD
    @test tok("```cmd```", 1).kind == Scan.CMD3
    @test tok("```cmd```", 2).kind == Scan.ENDMARKER
    @test tok("```cmd````cmd`", 1).kind == Scan.CMD3
    @test tok("```cmd````cmd`", 2).kind == Scan.CMD
end
@testset "where" begin
    @test tok("a where b", 3).kind == Scan.WHERE
end
@testset "IO position" begin
    io = IOBuffer("#1+1")
    skip(io, 1)
    @test length(collect(scan(io))) == 4
end
@testset "complicated interpolations" begin
    @test length(collect(scan("\"\$(())\""))) == 2
    @test length(collect(scan("\"\$(#=inline ) comment=#\"\")\""))) == 2
    @test length(collect(scan("\"\$(string(`inline ')' cmd`)\"\")\""))) == 2
    @test length(collect(scan("`\$((``))`"))) == 2
    @test length(collect(scan("`\$(#=inline ) comment=#``)`"))) == 2
    @test length(collect(scan("`\$(\"inline ) string\"*string(``))`"))) == 2
end
@testset "hex/bin/octal errors" begin
    @test tok("0x").kind == Scan.ERROR
    @test tok("0b").kind == Scan.ERROR
    @test tok("0o").kind == Scan.ERROR
    @test tok("0x 2", 1).kind == Scan.ERROR
    @test tok("0x.1p1").kind == Scan.FLOAT
end
@testset "dotted and suffixed operators" begin
    ops = collect(values(Scan.OP_REMAP))
    for op in ops
        op in (:isa, :in, :where, Symbol('\''), :?, :(:)) && continue
        str1 = "$(op)b"
        str2 = ".$(op)b"
        str3 = "a $op b"
        str4 = "a .$op b"
        str5 = "a $(op)₁ b"
        str6 = "a .$(op)₁ b"
        ex1 = Meta.parse(str1, raise=false)
        ex2 = Meta.parse(str2, raise=false)
        ex3 = Meta.parse(str3, raise=false)
        ex4 = Meta.parse(str4, raise=false)
        ex5 = Meta.parse(str5, raise=false)
        ex6 = Meta.parse(str6, raise=false)
        if ex1.head != :error # unary
            t1 = collect(scan(str1))
            exop1 = ex1.head == :call ? ex1.args[1] : ex1.head
            @test Symbol(Scan.unscan(t1[1])) == exop1
            if ex2.head != :error
                t2 = collect(scan(str2))
                exop2 = ex2.head == :call ? ex2.args[1] : ex2.head
                @test Symbol(Scan.unscan(t2[1])) == exop2
            end
        elseif ex3.head != :error # binary
            t3 = collect(scan(str3))
            exop3 = ex3.head == :call ? ex3.args[1] : ex3.head
            @test Symbol(Scan.unscan(t3[3])) == exop3
            if ex4.head != :error
                t4 = collect(scan(str4))
                exop4 = ex4.head == :call ? ex4.args[1] : ex4.head
                @test Symbol(Scan.unscan(t4[3])) == exop4
            elseif ex5.head != :error
                t5 = collect(scan(str5))
                exop5 = ex5.head == :call ? ex5.args[1] : ex5.head
                @test Symbol(Scan.unscan(t5[3])) == exop5
            elseif ex6.head != :error
                t6 = collect(scan(str6))
                exop6 = ex6.head == :call ? ex6.args[1] : ex6.head
                @test Symbol(Scan.unscan(t6[3])) == exop6
            end
        end
    end
end
@testset "perp" begin 
    @test tok("1 ⟂ 2", 3).kind == Scan.PERP 
end
@testset "outer" begin 
    @test tok("outer", 1).kind == Scan.OUTER
end
@testset "dot from" begin
    @test Scan.from_loc(tok("./")) == (1, 1)
    @test Scan.from_pos(tok(".≤")) == 0
end
@testset "token errors" begin
    @test tok("1.2e2.3", 1).err === Scan.NUM_CONST_ERR
    @test tok("1.2.", 1).err === Scan.NUM_CONST_ERR
    @test tok("1.2.f", 1).err === Scan.NUM_CONST_ERR
    @test tok("0xv", 1).err === Scan.NUM_CONST_ERR
    @test tok("0b3", 1).err === Scan.NUM_CONST_ERR
    @test tok("0op", 1).err === Scan.NUM_CONST_ERR
    @test tok("--", 1).err === Scan.OP_ERR
    @test tok("1**2", 2).err === Scan.OP_ERR
end
@testset "hat suffix" begin 
    @test tok("ŝ", 1).kind == Scan.ID
    @test unscan(collect(scan("ŝ", Scan.RawTok))[1], "ŝ") == "ŝ"
end
@testset "suffixed op" begin 
    s = "+¹"
    @test Scan.is_op(tok(s, 1).kind)
    @test unscan(collect(scan(s, Scan.RawTok))[1], s) == s
end
@testset "invalid float juxt" begin 
    s = "1.+2"
    @test tok(s, 1).kind == Scan.ERROR
    @test Scan.is_op(tok(s, 2).kind) 
    @test (t -> t.val == "1234." && t.kind == Scan.ERROR )(tok("1234.+1")) # requires space before '.'
    @test tok("1.+ ").kind == Scan.ERROR 
    @test tok("1.⤋").kind == Scan.ERROR
    @test tok("1.?").kind == Scan.ERROR
end


