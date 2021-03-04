using BinaryBuilder

name = "z3"
version = v"4.8.8"

sources = [
    GitSource("https://github.com/Z3Prover/z3.git", "ad55a1f1c617a7f0c3dd735c0780fc758424c7f1"),
    ArchiveSource("https://julialang-s3.julialang.org/bin/linux/armv7l/1.3/julia-1.3.1-linux-armv7l.tar.gz", "965c8fab2214f8ce1b3d449d088561a6de61be42543b48c3bbadaed5b02bf824"; unpack_target="julia-arm-linux-gnueabihf"),
    ArchiveSource("https://julialang-s3.julialang.org/bin/linux/x64/1.3/julia-1.3.1-linux-x86_64.tar.gz", "faa707c8343780a6fe5eaf13490355e8190acf8e2c189b9e7ecbddb0fa2643ad"; unpack_target="julia-x86_64-linux-gnu"),
    ArchiveSource("https://github.com/Gnimuc/JuliaBuilder/releases/download/v1.3.0/julia-1.3.0-x86_64-apple-darwin14.tar.gz", "f2e5359f03314656c06e2a0a28a497f62e78f027dbe7f5155a5710b4914439b1"; unpack_target="julia-x86_64-apple-darwin14"),
    ArchiveSource("https://github.com/Gnimuc/JuliaBuilder/releases/download/v1.3.0/julia-1.3.0-x86_64-w64-mingw32.tar.gz", "c7b2db68156150d0e882e98e39269301d7bf56660f4fc2e38ed2734a7a8d1551"; unpack_target="julia-x86_64-w64-mingw32"),
]

script = raw"""
case $target in
  arm-linux-gnueabihf|x86_64-linux-gnu)
    Julia_PREFIX=${WORKSPACE}/srcdir/julia-$target/julia-1.3.1
    Julia_ARGS="-DZ3_BUILD_JULIA_BINDINGS=True -DJulia_PREFIX=${Julia_PREFIX}"
    ;;
  x86_64-apple-darwin14|x86_64-w64-mingw32)
    Julia_PREFIX=${WORKSPACE}/srcdir/julia-$target/juliabin
    Julia_ARGS="-DZ3_BUILD_JULIA_BINDINGS=True -DJulia_PREFIX=${Julia_PREFIX}"
    ;;
esac

cd $WORKSPACE/srcdir/z3/

mkdir z3-build && cd z3-build
cmake -DCMAKE_INSTALL_PREFIX=${prefix} \
    -DCMAKE_FIND_ROOT_PATH="${prefix}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TARGET_TOOLCHAIN} \
    ${Julia_ARGS} \
    ..
make -j${nproc}
make install
install_license ${WORKSPACE}/srcdir/z3/LICENSE.txt
"""

platforms_libcxxwrap = [
    Platform("x86_64", "linux"; libc="glibc"),
    Platform("x86_64", "macos")
]

platforms = filter(x -> !(x in platforms_libcxxwrap), supported_platforms())

platforms_libcxxwrap = expand_cxxstring_abis(platforms_libcxxwrap)
platforms = expand_cxxstring_abis(platforms)

products_libcxxwrap = [
    LibraryProduct("libz3", :libz3),
    LibraryProduct("libz3jl", :libz3jl),
    ExecutableProduct("z3", :z3)
]

products = [
    LibraryProduct("libz3", :libz3),
    ExecutableProduct("z3", :z3)
]

dependencies = Dependency[
    Dependency("libcxxwrap_julia_jll")
]

non_reg_ARGS = filter(arg -> arg != "--register", ARGS)

using BinaryBuilder, Pkg, LibGit2

function should_build_platform(platform)
    requested_platforms = filter(arg -> !occursin(r"^--.*", arg), ARGS)
    if isone(length(requested_platforms))
        any(platforms_match.(Ref(platform), split(requested_platforms[1], ",")))
    else
        iszero(length(requested_platforms))
    end
end

function get_tree_hash(tree::LibGit2.GitTree)
    oid_ptr = Ref(LibGit2.GitHash())
    oid_ptr = ccall((:git_tree_id, :libgit2), Ptr{LibGit2.GitHash}, (Ptr{Cvoid},), tree.ptr)
    oid_ptr == C_NULL && throw("bad tree ID: $tree")
    return unsafe_load(oid_ptr)
end

function get_addable_spec(name::AbstractString, version::VersionNumber)
    Pkg.Registry.update()
    ctx = Pkg.Types.Context()
    uuid = first(Pkg.Types.registry_resolve!(ctx, Pkg.Types.PackageSpec(name=name))).uuid
    tree_hashes = Base.SHA1[]
    paths = Pkg.Operations.registered_paths(ctx, uuid)
    for path in paths
        vers = Pkg.Operations.load_versions(ctx, path; include_yanked=true)
        tree_hash = get(vers, version, nothing)
        tree_hash !== nothing && push!(tree_hashes, tree_hash)
    end
    if isempty(tree_hashes)
        error("Unable to find mapping for $(name) v$(version)")
    end
    tree_hash_sha1 = first(tree_hashes)
    tree_hash_bytes = tree_hash_sha1.bytes
    url = "https://github.com/JuliaBinaryWrappers/$(name).jl"
    git_commit_sha = nothing
    mktempdir() do dir
        repo = LibGit2.clone(url, dir)
        LibGit2.with(LibGit2.GitRevWalker(repo)) do walker
            LibGit2.push_head!(walker)
            for oid in walker
                tree = LibGit2.peel(LibGit2.GitTree, LibGit2.GitCommit(repo, oid))
                if all(get_tree_hash(tree).val .== tree_hash_bytes)
                    git_commit_sha = LibGit2.string(oid)
                    break
                end
            end
        end
    end
    if git_commit_sha === nothing
        error("Unable to find corresponding revision in $(name) v$(version) for tree hash $(bytes2hex(tree_hash_bytes))")
    end
    repo = Pkg.Types.GitRepo(rev=git_commit_sha, source=url)
    return Pkg.Types.PackageSpec(
        name=name,
        uuid=uuid,
        version=version,
        tree_hash=tree_hash_sha1,
        repo=repo,
    )
end

if any(should_build_platform.(triplet.(platforms_libcxxwrap)))
    build_tarballs(non_reg_ARGS, name, version, sources, script, platforms_libcxxwrap, products_libcxxwrap, dependencies; preferred_gcc_version=v"8")
end
if any(should_build_platform.(triplet.(platforms)))
    build_tarballs(ARGS, name, version, sources, script, platforms, products, dependencies; preferred_gcc_version=v"8")
end
