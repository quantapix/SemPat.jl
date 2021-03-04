mutable struct Formatter
    doc::Document
    indent::Int
    off::Int
    line_offset::Int

    # If true, output is formatted text otherwise
    # it's source text
    on::Bool
    opts::Opts
end
Formatter(doc, opts) = Formatter(doc, 0, 1, 0, true, opts)

@inline nspaces(s::Formatter) = s.indent
@inline hascomment(d::Document, line::Integer) = haskey(d.comments, line)
@inline has_semicol(d::Document, line::Integer) = line in d.semicols

@inline function cursor_loc(s::Formatter, off::Integer)
    l = s.doc.range_to_line[off:off]
    r = s.doc.line_to_range[l]
    return (l, off - first(r) + 1, length(r))
end
@inline cursor_loc(s::Formatter) = cursor_loc(s, s.off)
@inline function on_same_line(s::Formatter, offset1::Int, offset2::Int)
    l = s.doc.range_to_line[offset1:offset1]
    r = s.doc.line_to_range[l]
    return offset2 in r
end
