using Printf

@testset "scan self" begin
    global files = 0
    global secs = 0.0
    global toks = 0
    global errs = 0
    function test_dir(src::AbstractString)
        global files, secs, toks, errs
        ds, fs = [], []
        for f in sort(readdir(src))
            p = joinpath(src, f)
            if isdir(p)
                push!(ds, p)
                continue
            end
            _, x = splitext(f)
            x == ".jl" && push!(fs, p)
        end
        if !isempty(fs)
            for p in fs
                files += 1
                # name = splitdir(p)[end]
                b = IOBuffer()
                print(b, open(read, p))
                seek(b, 0)
                secs += @elapsed xs = collect(scan(b, Scan.RawTok))
                toks += length(xs)
                seek(b, 0)
                xs = collect(scan(String(take!(b))))
                for x in xs
                    x.kind === Scan.ERROR && (errs += 1)
                end
            end
        end
        for d in ds
            test_dir(d)
        end
    end
    path = joinpath(dirname(@__FILE__), "../..")
    test_dir(joinpath(path, "src"))
    test_dir(joinpath(path, "test"))
    println("Scanned ", files, " files in ", @sprintf("%3.4f", secs), " seconds with ", toks, " tokens and ", errs, " errors")
    @test errs == 0
end