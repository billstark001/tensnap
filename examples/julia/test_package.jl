using Pkg

const EXAMPLES_DIR = @__DIR__
const ROOT_DIR = normpath(joinpath(EXAMPLES_DIR, "..", ".."))
const TENSNAP_PACKAGE_DIR = joinpath(ROOT_DIR, "packages", "tensnap-julia")

Pkg.activate(TENSNAP_PACKAGE_DIR)
Pkg.instantiate()
Pkg.test()
