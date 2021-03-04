macro nest(p, f, x)
    quote
        local old = getfield($(esc(p)).nest, $f)
        setfield!($(esc(p)).nest, $f, true)
        y = $(esc(x))
        setfield!($(esc(p)).nest, $f, old)
        y
    end
end

macro nonest(p, f, x)
    quote
        local old = getfield($(esc(p)).nest, $f)
        setfield!($(esc(p)).nest, $f, false)
        y = $(esc(x))
        setfield!($(esc(p)).nest, $f, old)
        y
    end
end

macro nest_paren(p, x)
    quote
        local old = $(esc(p)).nest.paren
        $(esc(p)).nest.paren = true
        y = $(esc(x))
        $(esc(p)).nest.paren = old
        y
    end
end

macro nest_square(p, x)
    quote
        local old = $(esc(p)).nest.square
        $(esc(p)).nest.square = true
        y = $(esc(x))
        $(esc(p)).nest.square = old
        y
    end
end

macro nest_brace(p, x)
    quote
        local old = $(esc(p)).nest.brace
        $(esc(p)).nest.brace = true
        y = $(esc(x))
        $(esc(p)).nest.brace = old
        y
    end
end

macro nest_rank(p, r, x)
    quote
        local old = $(esc(p)).nest.rank
        $(esc(p)).nest.rank = $(esc(r))
        y = $(esc(x))
        $(esc(p)).nest.rank = old
        y
    end
end

struct Saved
    newline::Bool
    semicol::Bool
    inmacro::Bool
    tuple::Bool
    comma::Bool
    insquare::Bool
    range::Bool
    ifop::Bool
    ws::Bool
    wsop::Bool
    unary::Bool
    rank::Int
end

Saved(n::Nest) = Saved(n.newline, n.semicol, n.inmacro, n.tuple, n.comma, n.insquare, n.range, n.ifop, n.ws, n.wsop, n.unary, n.rank)

function from_saved!(n::Nest, s::Saved)
    n.newline = s.newline
    n.semicol = s.semicol
    n.inmacro = s.inmacro
    n.tuple = s.tuple
    n.comma = s.comma
    n.insquare = s.insquare
    n.range = s.range
    n.ifop = s.ifop
    n.ws = s.ws
    n.wsop = s.wsop
    n.unary = s.unary
    n.rank = s.rank
end

function to_blank!(n::Nest)
  n.newline = true
  n.semicol = true
  n.inmacro = false
  n.tuple = false
  n.comma = false
  n.insquare = false
  n.range = false
  n.ifop = false
  n.ws = false
  n.wsop = false
  n.unary = false
  n.rank = -1
end

macro blank(p, x)
    quote
        local old = Saved($(esc(p)).nest)
        to_blank!($(esc(p)).nest)
        y = $(esc(x))
        from_saved!($(esc(p)).nest, old)
        y
    end
end
