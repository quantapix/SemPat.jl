function after_ws(s::Scanner)
    accept_batch(s, is_ws)
    emit(s, WS)
end

function after_comment(s::Scanner, act=true)
    if peek_one(s) != '='
        while true
            c = peek_one(s)
            (c == '\n' || is_eof(c)) && return act ? emit(s, COMMENT) : empty(tok_type(s))
            read_one(s)
        end
    else
        c = read_one(s)
        b, e = 1, 0
        while true
            is_eof(c) && return act ? emit_err(s, EOF_COMMENT_ERR) : empty(tok_type(s))
            c2 = read_one(s)
            if c == '#' && c2 == '='; b += 1
            elseif c == '=' && c2 == '#'; e += 1
            end
            b == e && return act ? emit(s, COMMENT) : empty(tok_type(s))
            c = c2
        end
    end
end

function after_greater(s::Scanner)
    if accept(s, '>')
        if accept(s, '>'); accept(s, '=') ? emit(s, UNSIGNED_BITSHIFT_EQ) : emit(s, UNSIGNED_BITSHIFT)
        else accept(s, '=') ? emit(s, RBITSHIFT_EQ) : emit(s, RBITSHIFT)
        end
    elseif accept(s, '='); emit(s, GREATER_EQ)
    elseif accept(s, ':'); emit(s, ISSUPERTYPE)
    else emit(s, GREATER)
    end
end

function after_less(s::Scanner)
    if accept(s, '<'); accept(s, '=') ? emit(s, LBITSHIFT_EQ) : emit(s, LBITSHIFT)
    elseif accept(s, '='); emit(s, LESS_EQ)
    elseif accept(s, ':'); emit(s, ISSUBTYPE)
    elseif accept(s, '|'); emit(s, LPIPE)
    else emit(s, LESS)
    end
end

function after_equal(s::Scanner)
    if accept(s, '='); accept(s, '=') ? emit(s, EQ3) : emit(s, EQ2)
    else accept(s, '>') ? emit(s, PAIR_ARROW) : emit(s, EQ)
    end
end

function after_colon(s::Scanner)
    if accept(s, ':'); emit(s, DECL)
    else accept(s, '=') ? emit(s, COLON_EQ) : emit(s, COLON)
    end
end

function after_exclaim(s::Scanner)
    if accept(s, '='); accept(s, '=') ? emit(s, NOT_IS) : emit(s, NOT_EQ)
    else emit(s, NOT)
    end
end

after_percent(s::Scanner) = accept(s, '=') ? emit(s, REM_EQ) : emit(s, REM)

function after_bar(s::Scanner)
    if accept(s, '='); emit(s, OR_EQ)
    elseif accept(s, '>'); emit(s, RPIPE)
    else accept(s, '|') ? emit(s, LAZY_OR) : emit(s, OR)
    end
end

function after_plus(s::Scanner)
    if accept(s, '+'); emit(s, PLUSPLUS)
    else accept(s, '=') ? emit(s, PLUS_EQ) : emit(s, PLUS)
    end
end

function after_minus(s::Scanner)
    if accept(s, '-'); accept(s, '>') ? emit(s, RIGHT_ARROW) : emit_err(s, OP_ERR)
    elseif accept(s, '>'); emit(s, ANON_FUNC)
    else accept(s, '=') ? emit(s, MINUS_EQ) : emit(s, MINUS)
    end
end

function after_star(s::Scanner)
    if accept(s, '*'); emit_err(s, OP_ERR)
    else accept(s, '=') ? emit(s, STAR_EQ) : emit(s, STAR)
    end
end

after_circumflex(s::Scanner) = accept(s, '=') ? emit(s, CIRCUMFLEX_EQ) : emit(s, CIRCUMFLEX_ACCENT)
after_div(s::Scanner) = accept(s, '=') ? emit(s, DIVISION_EQ) : emit(s, DIVISION_SIGN)
after_dollar(s::Scanner) = accept(s, '=') ? emit(s, EX_OR_EQ) : emit(s, EX_OR)
after_xor(s::Scanner) = accept(s, '=') ? emit(s, XOR_EQ) : emit(s, XOR)

function accept_num(s::Scanner, f::F) where {F}
    while true
        c, c2 = peek_two(s)
        c == '_' && !f(c2) && return
        if f(c) || c == '_'; read_one(s)
        else return
        end
    end
end

function after_digit(s::Scanner, k)
    accept_num(s, isdigit)
    c, c2 = peek_two(s)
    if c == '.'
        c2 == '.' && return emit(s, k)
        if is_op_start(c2) && c2 !== ':'
            read_one(s)
            return emit_err(s)
        elseif (!(isdigit(c2) ||
          is_ws(c2) ||
          is_id_start(c2)
          || c2 == '('
          || c2 == ')'
          || c2 == '['
          || c2 == ']'
          || c2 == '{'
          || c2 == '}'
          || c2 == ','
          || c2 == ';'
          || c2 == '@'
          || c2 == '`'
          || c2 == '"'
          || c2 == ':'
          || c2 == '?'
          || is_eof(c2)))
            k = INTEGER
            return emit(s, k)
        end
        read_one(s)
        k = FLOAT
        accept_num(s, isdigit)
        c, c2 = peek_two(s)
        if (c == 'e' || c == 'E' || c == 'f') && (isdigit(c2) || c2 == '+' || c2 == '-')
            k = FLOAT
            read_one(s)
            accept(s, "+-")
            if accept_batch(s, isdigit)
                c, c2 = peek_two(s)
                if c === '.' && !is_doted_two(c2, ' ')
                    accept(s, '.')
                    return emit_err(s, NUM_CONST_ERR)
                end
            else return emit_err(s)
            end
        elseif c == '.' && (is_id_start(c2) || is_eof(c2))
            read_one(s)
            return emit_err(s, NUM_CONST_ERR)
        end
    elseif (c == 'e' || c == 'E' || c == 'f') && (isdigit(c2) || c2 == '+' || c2 == '-')
        k = FLOAT
        read_one(s)
        accept(s, "+-")
        if accept_batch(s, isdigit)
            c, c2 = peek_two(s)
            if c === '.' && !is_doted_two(c2, ' ')
                accept(s, '.')
                return emit_err(s, NUM_CONST_ERR)
            end
        else return emit_err(s)
        end
    elseif position(s) - from(s) == 1 && s.chars[1] == '0'
        k == INTEGER
        if c == 'x'
            k = HEX_INT
            read_one(s)
            !(is_hex(c2) || c2 == '.') && return emit_err(s, NUM_CONST_ERR)
            accept_num(s, is_hex)
            if accept(s, '.'); accept_num(s, is_hex)
            end
            if accept(s, "pP")
                k = FLOAT
                accept(s, "+-")
                accept_num(s, isdigit)
            end
        elseif c == 'b'
            !is_biny(c2) && return emit_err(s, NUM_CONST_ERR)
            read_one(s)
            accept_num(s, is_biny)
            k = BIN_INT
        elseif c == 'o'
            !is_octal(c2) && return emit_err(s, NUM_CONST_ERR)
            read_one(s)
            accept_num(s, is_octal)
            k = OCT_INT
        end
    end
    return emit(s, k)
end

function after_prime(s)
    k = s.last
    if k == ID || k == DOT || k ==  RPAREN || k ==  RSQUARE || k ==  RBRACE || k == PRIME || is_lit(k); emit(s, PRIME)
    else
        readon(s)
        if accept(s, '\''); return accept(s, '\'') ? emit(s, CHAR) : emit(s, CHAR)
        end
        while true
            c = read_one(s)
            if is_eof(c); return emit_err(s, EOF_CHAR_ERR)
            elseif c == '\\'
                if is_eof(read_one(s)); return emit_err(s, EOF_CHAR_ERR)
                end
            elseif c == '\''; return emit(s, CHAR)
            end
        end
    end
end

function after_amper(s::Scanner)
    if accept(s, '&'); emit(s, LAZY_AND)
    elseif accept(s, "="); emit(s, AND_EQ)
    else emit(s, AND)
    end
end

function after_quote(s::Scanner, act=true)
    if accept(s, '"')
        if accept(s, '"')
            if read_string(s, STRING3); act ? emit(s, STRING3) : empty(tok_type(s))
            else act ? emit_err(s, EOF_STRING_ERR) : empty(tok_type(s))
            end
        else act ? emit(s, STRING) : empty(tok_type(s))
        end
    else
        if read_string(s, STRING); act ? emit(s, STRING) : empty(tok_type(s))
        else act ? emit_err(s, EOF_STRING_ERR) : empty(tok_type(s))
        end
    end
end

function read_string(s::Scanner, k::Kind)
    function terminated()
        if k == STRING && s.chars[1] == '"'; true
        elseif k == STRING3 && s.chars[1] == s.chars[2] == s.chars[3] == '"'
            read_one(s)
            read_one(s)
            true
        elseif k == CMD && s.chars[1] == '`'; true
        elseif k == CMD3 && s.chars[1] == s.chars[2] == s.chars[3] == '`'
            read_one(s)
            read_one(s)
            true
        else false
        end
    end
    while true
        c = read_one(s)
        if c == '\\'
            is_eof(read_one(s)) && return false
            continue
        end
        if terminated(); return true
        elseif is_eof(c); return false
        end
        if c == '$'
            c = read_one(s)
            if terminated(); return true
            elseif is_eof(c); return false
            elseif c == '('
                o = 1
                while o > 0
                    c = read_one(s)
                    is_eof(c) && return false
                    if c == '('; o += 1
                    elseif c == ')'; o -= 1
                    elseif c == '"'; after_quote(s, false)
                    elseif c == '`'; after_cmd(s, false)
                    elseif c == '#'; after_comment(s, false)
                    end
                end
            end
        end
    end
end

function after_forwardslash(s::Scanner)
    if accept(s, "/"); accept(s, "=") ? emit(s, FWD_SLASH2_EQ) : emit(s, FWD_SLASH2)
    else accept(s, "=") ? emit(s, FWD_SLASH_EQ) : emit(s, FWD_SLASH)
    end
end

after_backslash(s::Scanner) = accept(s, '=') ? emit(s, BACKSLASH_EQ) : emit(s, BACKSLASH)

function after_dot(s::Scanner)
    if accept(s, '.'); accept(s, '.') ? emit(s, DOT3) : emit(s, DOT2)
    elseif Base.isdigit(peek_one(s))
        readon(s)
        after_digit(s, FLOAT)
    else
        c, c2 = peek_two(s)
        if is_doted(c)
            s.doted = true
            next_token(s, false)
        elseif c == '+'
            s.doted = true
            read_one(s)
            after_plus(s)
        elseif c == '-'
            s.doted = true
            read_one(s)
            after_minus(s)
        elseif c == '*'
            s.doted = true
            read_one(s)
            after_star(s)
        elseif c == '/'
            s.doted = true
            read_one(s)
            after_forwardslash(s)
        elseif c == '\\'
            s.doted = true
            read_one(s)
            after_backslash(s)
        elseif c == '^'
            s.doted = true
            read_one(s)
            after_circumflex(s)
        elseif c == '<'
            s.doted = true
            read_one(s)
            after_less(s)
        elseif c == '>'
            s.doted = true
            read_one(s)
            after_greater(s)
        elseif c == '&'
            s.doted = true
            read_one(s)
            accept(s, "=") ? emit(s, AND_EQ) : emit(s, AND)
        elseif c == '%'
            s.doted = true
            read_one(s)
            after_percent(s)
        elseif c == '=' && c2 != '>'
            s.doted = true
            read_one(s)
            after_equal(s)
        elseif c == '|' && c2 != '|'
            s.doted = true
            read_one(s)
            after_bar(s)
        elseif c == '!' && c2 == '='
            s.doted = true
            read_one(s)
            after_exclaim(s)
        elseif c == '⊻'
            s.doted = true
            read_one(s)
            after_xor(s)
        elseif c == '÷'
            s.doted = true
            read_one(s)
            after_div(s)
        elseif c == '=' && c2 == '>'
            s.doted = true
            read_one(s)
            after_equal(s)
        else emit(s, DOT)
        end
    end
end

function after_cmd(s::Scanner, act=true)
    if accept(s, '`') # 
        if accept(s, '`') # """
            if read_string(s, CMD3); act ? emit(s, CMD3) : empty(tok_type(s))
            else act ? emit_err(s, EOF_CMD_ERR) : empty(tok_type(s))
            end
        else act ? emit(s, CMD) : empty(tok_type(s))
        end
    else 
        if read_string(s, CMD); act ? emit(s, CMD) : empty(tok_type(s))
        else act ? emit_err(s, EOF_CMD_ERR) : empty(tok_type(s))
        end
    end
end

function read_rest(s, c)
    while true
        c, c2 = peek_two(s)
        (!is_id(c) || (c == '!' && c2 == '=')) && break
        x = read_one(s)
    end
    emit(s, ID)
end

emit_rest(s, c) = is_id(c) ? read_rest(s, c) : emit(s, ID)

function try_read(s, xs, k, c)
    for x in xs
        c = peek_one(s)
        if c != x; return is_id(c) ? read_rest(s, c) : emit(s, ID)
        else read_one(s)
        end
    end
    is_id(peek_one(s)) ? read_rest(s, c) : emit(s, k)
end

function after_identifier(s, c)
    if c == 'a'; try_read(s, ('b', 's', 't', 'r', 'a', 'c', 't'), ABSTRACT, c)
    elseif c == 'b'
        c = peek_one(s)
        if c == 'a'
            c = read_one(s)
            try_read(s, ('r', 'e', 'm', 'o', 'd', 'u', 'l', 'e'), BAREMODULE, c)
        elseif c == 'e'
            c = read_one(s)
            try_read(s, ('g', 'i', 'n'), BEGIN, c)
        elseif c == 'r'
            c = read_one(s)
            try_read(s, ('e', 'a', 'k'), BREAK, c)
        else emit_rest(s, c)
        end
    elseif c == 'c'
        c = peek_one(s)
        if c == 'a'
            c = read_one(s)
            try_read(s, ('t', 'c', 'h'), CATCH, c)
        elseif c == 'o'
            read_one(s)
            c = peek_one(s)
            if c == 'n'
                read_one(s)
                c = peek_one(s)
                if c == 's'
                    read_one(s)
                    c = peek_one(s)
                    try_read(s, ('t',), CONST, c)
                elseif c == 't'
                    read_one(s)
                    c = peek_one(s)
                    try_read(s, ('i', 'n', 'u', 'e'), CONTINUE, c)
                else emit_rest(s, c)
                end
            else emit_rest(s, c)
            end
        else emit_rest(s, c)
        end
    elseif c == 'd'; try_read(s, ('o'), DO, c)
    elseif c == 'e'
        c = peek_one(s)
        if c == 'l'
            read_one(s)
            c = peek_one(s)
            if c == 's'
                read_one(s)
                c = peek_one(s)
                if c == 'e'
                    read_one(s)
                    c = peek_one(s)
                    if !is_id(c); emit(s, ELSE)
                    elseif c == 'i'
                        c = read_one(s)
                        try_read(s, ('f'), ELSEIF, c)
                    else emit_rest(s, c)
                    end
                else emit_rest(s, c)
                end
            else emit_rest(s, c)
            end
        elseif c == 'n'
            c = read_one(s)
            try_read(s, ('d'), END, c)
        elseif c == 'x'
            c = read_one(s)
            try_read(s, ('p', 'o', 'r', 't'), EXPORT, c)
        else emit_rest(s, c)
        end
    elseif c == 'f'
        c = peek_one(s)
        if c == 'a'
            c = read_one(s)
            try_read(s, ('l', 's', 'e'), FALSE, c)
        elseif c == 'i'
            c = read_one(s)
            try_read(s, ('n', 'a', 'l', 'l', 'y'), FINALLY, c)
        elseif c == 'o'
            c = read_one(s)
            try_read(s, ('r'), FOR, c)
        elseif c == 'u'
            c = read_one(s)
            try_read(s, ('n', 'c', 't', 'i', 'o', 'n'), FUNCTION, c)
        else emit_rest(s, c)
        end
    elseif c == 'g'; try_read(s, ('l', 'o', 'b', 'a', 'l'), GLOBAL, c)
    elseif c == 'i'
        c = peek_one(s)
        if c == 'f'
            read_one(s)
            c = peek_one(s)
            is_id(c) ? read_rest(s, c) : emit(s, IF)
        elseif c == 'm'
            read_one(s)
            c = peek_one(s)
            if c == 'p'
                read_one(s)
                c = peek_one(s)
                if c == 'o'
                    read_one(s)
                    c = peek_one(s)
                    if c == 'r'
                        read_one(s)
                        c = peek_one(s)
                        if c == 't'
                            read_one(s)
                            c = peek_one(s)
                            if !is_id(c); emit(s, IMPORT)
                            elseif c == 'a'
                                c = read_one(s)
                                try_read(s, ('l', 'l'), IMPORTALL, c)
                            else emit_rest(s, c)
                            end
                        else emit_rest(s, c)
                        end
                    else emit_rest(s, c)
                    end
                else emit_rest(s, c)
                end
            else emit_rest(s, c)
            end
        elseif c == 'n'
            read_one(s)
            c = peek_one(s)
            is_id(c) ? read_rest(s, c) : emit(s, IN)
        elseif (@static VERSION >= v"0.6.0-dev.1471" ? true : false) && c == 's'
            c = read_one(s)
            try_read(s, ('a'), ISA, c)
        else emit_rest(s, c)
        end
    elseif c == 'l'
        c = peek_one(s)
        if c == 'e'
            read_one(s)
            try_read(s, ('t'), LET, c)
        elseif c == 'o'
            read_one(s)
            try_read(s, ('c', 'a', 'l'), LOCAL, c)
        else emit_rest(s, c)
        end
    elseif c == 'm'
        c = peek_one(s)
        if c == 'a'
            c = read_one(s)
            try_read(s, ('c', 'r', 'o'), MACRO, c)
        elseif c == 'o'
            c = read_one(s)
            try_read(s, ('d', 'u', 'l', 'e'), MODULE, c)
        elseif c == 'u'
            c = read_one(s)
            try_read(s, ('t', 'a', 'b', 'l', 'e'), MUTABLE, c)
        else emit_rest(s, c)
        end
    elseif c == 'o'; try_read(s, ('u', 't', 'e', 'r'), OUTER, c)
    elseif c == 'p'; try_read(s, ('r', 'i', 'm', 'i', 't', 'i', 'v', 'e'), PRIMITIVE, c)
    elseif c == 'q'; try_read(s, ('u', 'o', 't', 'e'), QUOTE, c)
    elseif c == 'r'; try_read(s, ('e', 't', 'u', 'r', 'n'), RETURN, c)
    elseif c == 's'; try_read(s, ('t', 'r', 'u', 'c', 't'), STRUCT, c)
    elseif c == 't'
        c = peek_one(s)
        if c == 'r'
            read_one(s)
            c = peek_one(s)
            if c == 'u'
                c = read_one(s)
                try_read(s, ('e'), TRUE, c)
            elseif c == 'y'
                read_one(s)
                c = peek_one(s)
                if !is_id(c); emit(s, TRY)
                else
                    c = read_one(s)
                    emit_rest(s, c)
                end
            else emit_rest(s, c)
            end
        elseif c == 'y'
            read_one(s)
            c = peek_one(s)
            if c == 'p'
                read_one(s)
                c = peek_one(s)
                if c == 'e'
                    read_one(s)
                    c = peek_one(s)
                    if !is_id(c); emit(s, TYPE)
                    else
                        c = read_one(s)
                        emit_rest(s, c)
                    end
                else emit_rest(s, c)
                end
            else emit_rest(s, c)
            end
        else emit_rest(s, c)
        end
    elseif c == 'u'; try_read(s, ('s', 'i', 'n', 'g'), USING, c)
    elseif c == 'w'
        c = peek_one(s)
        if c == 'h'
            read_one(s)
            c = peek_one(s)
            if c == 'e'
                c = read_one(s)
                try_read(s, ('r', 'e'), WHERE, c)
            elseif c == 'i'
                c = read_one(s)
                try_read(s, ('l', 'e'), WHILE, c)
            else emit_rest(s, c)
            end
        else emit_rest(s, c)
        end
    else emit_rest(s, c)
    end
end
