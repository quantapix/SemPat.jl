using Scan
using BenchmarkTools
using Printf

function scan_perf(::Type{T}=Scan.Token) where T <: Scan.QToken
    files = 0
    toks = 0
    errs = 0
    d = dirname(Base.find_source_file("int.jl"))
    for dir in (d, Sys.STDLIB)
        for (root, _, fs) in walkdir(dir)
            for f in fs
                if endswith(f, ".jl")
                    files += 1
                    f = joinpath(root, f)
                    s = scan(read(f, String)::String, T)
                    while !Scan.eof(s)
                        t = Scan.next_token(s)
                        toks += 1
                        if t.kind == Scan.ERROR; errs += 1
                        end
                    end
                end
            end
        end
    end
    files, toks, errs
end

fs, ts, es = scan_perf()
time_tok = @belapsed scan_perf()
time_raw = @belapsed scan_perf(Scan.RawToken)
println("Scanned ", fs, " files, ", ts, " tokens, and ", es, " errors")
println("Time Token: ", @sprintf("%3.4f", time_tok), " seconds")
println("Time RawToken: ", @sprintf("%3.4f", time_raw), " seconds")
