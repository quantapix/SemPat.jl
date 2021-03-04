function read_comment(s)
    if peek_one(s) != '='
        while true
            c = peek_one(s)
            (c == '\n' || is_eof(c)) && return true
            read_one(s)
        end
    else
        c = read_one(s)
        b, e = 1, 0
        while true
            is_eof(c) && return false
            c2 = read_one(s)
            if c == '#' && c2 == '='; b += 1
            elseif c == '=' && c2 == '#'; e += 1
            end
            b == e && return true
            c = c2
        end
    end
end

function read_ws_comment(s, c::Char)
    nl = c == '\n'
    sc = c == ';'
    if c == '#'; nl = read_comment(s)
    else nl, sc = read_ws(s, nl, sc)
    end
    while is_ws(peek_one(s)) || peek_one(s) == '#' || peek_one(s) == ';'
        c = read_one(s)
        if c == '#'
            read_comment(s)
            nl = nl || peek_one(s) == '\n'
            sc = sc || peek_one(s) == ';'
        elseif c == ';'; sc = true
        else nl, sc = read_ws(s, nl, sc)
        end
    end
    nl, sc
end

function scan_ws_comment(s::Scanner, c::Char)
    nl, sc = read_ws_comment(s, c)
    Scan.emit(s, sc ? Scan.SEMICOL_WS : nl ? Scan.NEWLINE_WS : Scan.WS)
end

function compare(x::Expr, y::Expr)
    if x == y; true
    elseif x.head != y.head; (x, y)
    elseif length(x.args) != length(y.args); (x.args, y.args)
    else
        for i = 1:length(x.args)
            !compare(x.args[i], y.args[i]) && return false
        end
        true
    end
end
compare(x, y) = x == y ? true : (x, y)

unescape(s::AbstractString) = sprint(unescape, s, sizehint=lastindex(s))
function unescape(io, s::AbstractString)
    a = Iterators.Stateful(s)
    for c in a
        if !isempty(a) && c == '\\'
            c = popfirst!(a)
            if c == 'x' || c == 'u' || c == 'U'
                n = k = 0
                m = c == 'x' ? 2 :
                    c == 'u' ? 4 : 8
                while (k += 1) <= m && !isempty(a)
                    nc = Base.peek(a)
                    n = '0' <= nc <= '9' ? n << 4 + nc - '0' :
                        'a' <= nc <= 'f' ? n << 4 + nc - 'a' + 10 :
                        'A' <= nc <= 'F' ? n << 4 + nc - 'A' + 10 : break
                    popfirst!(a)
                end
                if k == 1; n = 0 end
                if m == 2; write(io, UInt8(n))
                else print(io, Char(n))
                end
            elseif '0' <= c <= '7'
                k = 1
                n = c - '0'
                while (k += 1) <= 3 && !isempty(a)
                    c  = Base.peek(a)
                    n = ('0' <= c <= '7') ? n << 3 + c - '0' : break
                    popfirst!(a)
                end
                if n > 255; n = 255 end
                write(io, UInt8(n))
            else print(io, c == 'a' ? '\a' : c == 'b' ? '\b' : c == 't' ? '\t' : c == 'n' ? '\n' : c == 'v' ? '\v' : c == 'f' ? '\f' :  c == 'r' ? '\r' : c == 'e' ? '\e' : c)
            end
        else print(io, c)
        end
    end
end

function is_valid_esc(s::AbstractString)
    a = Iterators.Stateful(s)
    for c in a
        if !isempty(a) && c == '\\'
            c = popfirst!(a)
            if c == 'x' || c == 'u' || c == 'U'
                n = k = 0
                m = c == 'x' ? 2 :
                    c == 'u' ? 4 : 8
                while (k += 1) <= m && !isempty(a)
                    nc = Base.peek(a)
                    n = '0' <= nc <= '9' ? n << 4 + (nc - '0') :
                        'a' <= nc <= 'f' ? n << 4 + (nc - 'a' + 10) :
                        'A' <= nc <= 'F' ? n << 4 + (nc - 'A' + 10) : break
                    popfirst!(a)
                end
                if k == 1 || n > 0x10ffff
                    u = m == 4 ? 'u' : 'U'
                    return false
                end
            elseif '0' <= c <= '7'
                k = 1
                n = c - '0'
                while (k += 1) <= 3 && !isempty(a)
                    c = Base.peek(a)
                    n = ('0' <= c <= '7') ? n << 3 + c - '0' : break
                    popfirst!(a)
                end
                n > 255 && return false
            else c == 'a' || c == 'b' || c == 't' || c == 'n' || c == 'v' || c == 'f' || c == 'r' || c == 'e' || c == '\\' || c == '"' || c == '\'' || return false
            end
        end
    end
    true
end
