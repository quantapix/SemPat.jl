################################################################################
### Domain errors of Lambda-Julia
################################################################################

## Constant to control inclusion of the file
if !Core.isdefined(:LJ_SRC_FILE_ERRORS)
  const LJ_SRC_FILE_ERRORS = "errors.jl"
end

#----------------------------------------- Logging

function lj_error(s)
  println(STDERR, "\nERROR: ",s)
  throw(ErrorException("lj_error is called: " * s))
end

#----------------------------------------- Types

abstract type LJErr <: Exception
end

struct LJErrTypeNotWF <: LJErr # constant I is in type
end
struct LJErrNameNotFound <: LJErr
  name :: String
end

struct LJErrNameAmbiguous <: LJErr
  name :: String
end

struct LJErrIInType <: LJErr # constant I is in type
end

struct LJErrGetfield <: LJErr
  name :: String
end

struct LJErrFreeVar <: LJErr
  name :: String
end

struct LJErrTypeTooLarge <: LJErr
end

struct LJErrTermInType <: Exception
    term :: String
end

struct LJErrCannotParse <: Exception
    err :: String
end
LJErrCannotParse() = LJErrCannotParse("unknown")

struct LJErrApplicationException <: LJErr
  msg :: String
end