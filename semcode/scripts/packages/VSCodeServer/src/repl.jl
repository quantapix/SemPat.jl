# Most of the code here is copied from the Juno codebase

using REPL
using REPL.LineEdit

isREPL() = isdefined(Base, :active_repl) &&
           isdefined(Base.active_repl, :interface) &&
           isdefined(Base.active_repl.interface, :modes) &&
           isdefined(Base.active_repl, :mistate) &&
           isdefined(Base.active_repl.mistate, :current_mode)

juliaprompt = "julia> "

current_prompt = juliaprompt

function get_main_mode(repl=Base.active_repl)
    mode = repl.interface.modes[1]
    mode isa LineEdit.Prompt || error("no julia repl mode found")
    mode
end

function hideprompt(f)
    isREPL() || return f()

    repl = Base.active_repl
    mistate = repl.mistate
    mode = mistate.current_mode

    buf = String(take!(copy(LineEdit.buffer(mistate))))

    # clear input buffer
    truncate(LineEdit.buffer(mistate), 0)
    LineEdit.refresh_multi_line(mistate)

    print(stdout, "\e[1K\r")
    r = f()

    flush(stdout)
    flush(stderr)
    sleep(0.05)

    # TODO Fix this
    # pos = @rpc cursorpos()
    pos = 1, 1
    pos[1] != 0 && println()

    # restore prompt
    if applicable(LineEdit.write_prompt, stdout, mode)
        LineEdit.write_prompt(stdout, mode)
    elseif mode isa LineEdit.PrefixHistoryPrompt || :parent_prompt in fieldnames(typeof(mode))
        LineEdit.write_prompt(stdout, mode.parent_prompt)
    else
        printstyled(stdout, current_prompt, color=:green)
    end

    truncate(LineEdit.buffer(mistate), 0)

    # restore input buffer
    LineEdit.edit_insert(LineEdit.buffer(mistate), buf)
    LineEdit.refresh_multi_line(mistate)
    r
end

function hook_repl(repl)
    if !isdefined(repl, :interface)
        repl.interface = REPL.setup_interface(repl)
    end
    main_mode = get_main_mode(repl)

    if VERSION > v"1.5-"
        for i in 1:20 # repl backend should be set up after 10s -- fall back to the pre-ast-transform approach otherwise
            isdefined(Base, :active_repl_backend) && continue
            sleep(0.5)
        end
        if isdefined(Base, :active_repl_backend)
            push!(Base.active_repl_backend.ast_transforms, ast -> transform_backend(ast, repl, main_mode))
            return
        end
    end

    main_mode.on_done = REPL.respond(repl, main_mode; pass_empty=false) do line
        quote
            $(evalrepl)(Main, $line, $repl, $main_mode)
        end
    end
end

function transform_backend(ast, repl, main_mode)
    quote
        $(evalrepl)(Main, $(QuoteNode(ast)), $repl, $main_mode)
    end
end

function evalrepl(m, line, repl, main_mode)
    return try
        JSONRPC.send_notification(conn_endpoint[], "repl/starteval", nothing)
        r = run_with_backend() do
            fix_displays()
            f = () -> repleval(m, line, REPL.repl_filename(repl, main_mode.hist))
            PROGRESS_ENABLED[] ? Logging.with_logger(f, VSCodeLogger()) : f()
        end
        if r isa EvalError
            display_repl_error(stderr, r.err, r.bt)
            nothing
        else
            r
        end
    catch err
        # This is for internal errors only.
        Base.display_error(stderr, err, catch_backtrace())
        nothing
    finally
        JSONRPC.send_notification(conn_endpoint[], "repl/finisheval", nothing)
    end
end

# don't inline this so we can find it in the stacktrace
@noinline function repleval(m, code::String, file)
    args = VERSION >= v"1.5" ? (REPL.softscope, m, code, file) : (m, code, file)
    return include_string(args...)
end

@noinline function repleval(m, code, _)
    return Base.eval(m, code)
end

# basically the same as Base's `display_error`, with internal frames removed
function display_repl_error(io, err, bt)
    st = stacktrace(crop_backtrace(bt))
    printstyled(io, "ERROR: "; bold=true, color=Base.error_color())
    showerror(IOContext(io, :limit => true), err, st)
    println(io)
end
display_repl_error(io, err::LoadError, bt) = display_repl_error(io, err.error, bt)

function withpath(f, path)
    tls = task_local_storage()
    hassource = haskey(tls, :SOURCE_PATH)
    hassource && (path′ = tls[:SOURCE_PATH])
    tls[:SOURCE_PATH] = path
    try
        return f()
    finally
        hassource ? (tls[:SOURCE_PATH] = path′) : delete!(tls, :SOURCE_PATH)
    end
end
