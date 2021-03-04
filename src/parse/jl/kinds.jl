const AssignOp      = 1
const CondOp        = 2
const ArrowOp       = 3
const LazyOrOp      = 4
const LazyAndOp     = 5
const CompOp        = 6
const PipeOp        = 7
const ColonOp       = 8
const PlusOp        = 9
const TimesOp       = 10
const RationalOp    = 11
const ShiftOp       = 12
const PowerOp       = 13
const DeclOp        = 14
const WhereOp       = 15
const DotOp         = 16
const PrimeOp       = 16
const Dot3Op        = 7
const AnonOp        = 14

@enum(Head,
ID,
NONSTDID,
PUNCT,
OP,
KW,
LIT,
NoHead,
Call,
UnyOpCall,
BinyOpCall,
WhereOpCall,
CondOpCall,
ChainOpCall,
ColonOpCall,
Abstract,
Begin,
Block,
Braces,
BracesCat,
Const,
Comparison,
Curly,
Do,
Filter,
Flatten,
For,
FuncDef,
Generator,
Global,
GlobalRefDoc,
If,
Kw,
Let,
Local,
Macro,
MacroCall,
MacroName,
Mutable,
Outer,
Params,
Primitive,
Quote,
Quotenode,
InvisBracks,
StringH,
Struct,
Try,
TupleH,
FileH,
Return,
While,
x_Cmd,
x_Str,
ModuleH,
BareModule,
Top,
Export,
Import,
Using,
Compreh,
DictCompreh,
TypedCompreh,
Hcat,
TypedHcat,
Ref,
Row,
Vcat,
TypedVcat,
Vect,
ErrTok)

@enum(ErrKind,
    OddToken,
    CannotJuxtapose,
    OddWS,
    OddNL,
    ExpectedAssign,
    OddAssignOp,
    MissingCond,
    MissingNest,
    MissingColon,
    InvalidIter,
    InterpTrailingWS,
    TooLongChar,
    Unknown)

const NoKind = Scan.begin_kws
