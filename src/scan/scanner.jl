mutable struct Scanner{S <: IO,T <: QToken}
    io::S
    io_from::Int
    from_row::Int
    from_col::Int
    from_pos::Int
    row::Int
    col::Int
    pos::Int
    last::Kind
    store::IOBuffer
    chars::Tuple{Char,Char,Char}
    chars_pos::Tuple{Int,Int,Int}
    doread::Bool
    doted::Bool
end

function Scanner(s::S, T::Type{Q}=Token) where {S,Q <: QToken}
    c1 = ' '
    p1 = position(s)
    if is_eof(s)
        c2, p2 = EOF_CHAR, p1
        c3, p3 = EOF_CHAR, p1
    else
        c2 = read(s, Char)
        p2 = position(s)
        if is_eof(s); c3, p3 = EOF_CHAR, p1
        else
            c3 = read(s, Char)
            p3 = position(s)
        end
    end
    Scanner{S,T}(s, position(s), 1, 1, position(s), 1, 1, position(s), ERROR, IOBuffer(), (c1, c2, c3), (p1, p2, p3), false, false)
end
Scanner(s::AbstractString, T::Type{Q}=Token) where Q <: QToken = Scanner(IOBuffer(s), T)

tok_type(::Scanner{S,T}) where {S,T} = T

scan(x, ::Type{Token}) = Scanner(x, Token)
scan(x, ::Type{RawTok}) = Scanner(x, RawTok)
scan(x) = Scanner(x, Token)

Base.show(io::IO, s::Scanner) = print(io, typeof(s), " at position: ", position(s))

Base.position(s::Scanner) = s.chars_pos[1]
# Base.position(s::Scanner) = Base.position(s.io)

Base.seekstart(s::Scanner) = seek(s.io, s.io_from)
Base.seek(s::Scanner, x) = seek(s.io, x)

Base.IteratorSize(::Type{Scanner{S,T}}) where {S,T} = Base.SizeUnknown()
Base.IteratorEltype(::Type{Scanner{S,T}}) where {S,T} = Base.HasEltype()
Base.eltype(::Type{Scanner{S,T}}) where {S,T} = T

function Base.iterate(s::Scanner)
    seekstart(s)
    s.from_row = 1
    s.from_col = 1
    s.from_pos = position(s)
    s.row = 1
    s.col = 1
    s.pos = s.io_from
    t = next_token(s)
    t, t.kind == ENDMARKER
end
function Base.iterate(s::Scanner, done)
    done && return nothing
    t = next_token(s)
    t, t.kind == ENDMARKER
end

from(s::Scanner) = s.from_pos
from!(s::Scanner, i::Integer) = s.from_pos = i

seek2from!(s::Scanner) = seek(s, from(s))

peek_one(s::Scanner) = s.chars[2]
peek_two(s::Scanner) = s.chars[2], s.chars[3]

is_eof(s::Scanner) = is_eof(s.io)

function start_token!(s::Scanner)
    s.from_pos = s.chars_pos[1]
    s.from_row = s.row
    s.from_col = s.col
end

function read_one(s::Scanner{S}) where {S <: IO}
    c = read_one(s.io)
    s.chars = (s.chars[2], s.chars[3], c)
    s.chars_pos = (s.chars_pos[2], s.chars_pos[3], position(s.io))
    s.doread && write(s.store, s.chars[1])
    if s.chars[1] == '\n'
        s.row += 1
        s.col = 1
    elseif !is_eof(s.chars[1]); s.col += 1
    end
    s.chars[1]
end

function read_ws(s, nl, sc)
    while is_ws(peek_one(s))
        c = read_one(s)
        c == '\n' && (nl = true)
        c == ';' && (sc = true)
    end
    nl, sc
end

function readon(s::Scanner{S,Token}) where {S <: IO}
    s.store.size != 0 && take!(s.store)
    write(s.store, s.chars[1])
    s.doread = true
    s.chars[1]
end
readon(s::Scanner{S,RawTok}) where {S <: IO} = s.chars[1]

function readoff(s::Scanner{S,Token})  where {S <: IO}
    s.doread = false
    s.chars[1]
end
readoff(s::Scanner{S,RawTok}) where {S <: IO} = s.chars[1]

function accept(s::Scanner, f::Union{Function,Char,Vector{Char},String})
    c = peek_one(s)
    if isa(f, Function); ok = f(c)
    elseif isa(f, Char); ok = c == f
    else ok = c in f
    end
    ok && read_one(s)
    ok
end

function accept_batch(s::Scanner, f)
    ok = false
    while accept(s, f)
        ok = true
    end
    ok
end

function try_suff(k)
    (begin_ops < k < end_ops) && 
    !(k == DOT3 ||
    EQ <= k <= XOR_EQ ||
    k == COND ||
    k == RIGHT_ARROW ||
    k == LAZY_OR ||
    k == LAZY_AND ||
    k == ISSUBTYPE ||
    k == ISSUPERTYPE ||
    k == IN ||
    k == ISA ||
    k == COLON_EQUALS ||
    k == COLON2_EQUAL ||
    k == COLON ||
    k == DOT2 ||
    k == EX_OR ||
    k == DECL ||
    k == WHERE ||
    k == DOT ||
    k == NOT ||
    k == TRANSPOSE ||
    k == ANON_FUNC ||
    NOT_SIGN <= k <= QUAD_ROOT
    ) 
end

function emit(s::Scanner{S,Token}, k::Kind, e::TokErr=NO_ERR) where S
    suff = false
    if (k == ID || is_lit(k) || k == COMMENT || k == WS); v = String(take!(s.store))
    elseif k == ERROR; v = String(s.io.data[(s.from_pos + 1):position(s)])
    elseif try_suff(k)
        v = ""
        while is_op_suff(peek_one(s))
            v = string(v, read_one(s))
            suff = true
        end
    else v = ""
    end
    l = Span(Loc(s.from_row, s.from_col), Loc(s.row, s.col - 1))
    p = Span(from(s), position(s) - 1)
    t = Token(k, l, p, v, e, s.doted, suff)
    s.doted = false
    s.last = k
    readoff(s)
    t
end

function emit(s::Scanner{S,RawTok}, k::Kind, e::TokErr=NO_ERR) where S
    suff = false
    if try_suff(k)
        while is_op_suff(peek_one(s))
            read_one(s)
            suff = true
        end
    end
    l = Span(Loc(s.from_row, s.from_col), Loc(s.row, s.col - 1))
    p = Span(from(s), position(s) - 1)
    t = RawTok(k, l, p, e, s.doted, suff)
    s.doted = false
    s.last = k
    readoff(s)
    t
end

emit_err(s::Scanner, e::TokErr=UNKNOWN) = emit(s, ERROR, e)

function next_token(s::Scanner, start=true)
    start && start_token!(s)
    c = read_one(s)
    if is_eof(c); emit(s, ENDMARKER)
    elseif is_ws(c)
        readon(s)
        after_ws(s)
    elseif (f = get(dispatch, c, nothing)) !== nothing; f(s)::tok_type(s)
    elseif is_id_start(c)
        readon(s)
        after_identifier(s, c)
    elseif isdigit(c)
        readon(s)
        after_digit(s, INTEGER)
    elseif (k = get(OP_MAP, c, ERROR)) != ERROR; emit(s, k)
    else emit_err(s)
    end
end

include("after.jl")

const dispatch = Dict{Char,Function}(
  '-' => after_minus,
  ',' => s -> emit(s, COMMA),
  ';' => s -> emit(s, SEMICOL),
  ':' => after_colon,
  '!' => after_exclaim,
  '?' => s -> emit(s, COND),
  '.' => after_dot,
  '"' => function (s) readon(s); after_quote(s) end,
  '(' => s -> emit(s, LPAREN),
  ')' => s -> emit(s, RPAREN),
  '[' => s -> emit(s, LSQUARE),
  ']' => s -> emit(s, RSQUARE),
  '{' => s -> emit(s, LBRACE),
  '}' => s -> emit(s, RBRACE),
  '@' => s -> emit(s, AT_SIGN),
  '*' => after_star,
  '/' => after_forwardslash,
  '\'' => after_prime,
  '\\' => after_backslash,
  '&' => after_amper,
  '#' => function (s) readon(s); after_comment(s) end,
  '%' => after_percent,
  '`' => function (s) readon(s); after_cmd(s) end,
  '^' => after_circumflex,
  '+' => after_plus,
  '÷' => after_div,
  '<' => after_less,
  '=' => after_equal,
  '>' => after_greater,
  '|' => after_bar,
  '~' => s -> emit(s, APPROX),
  '⊻' => after_xor,
  '$' => after_dollar,
)
