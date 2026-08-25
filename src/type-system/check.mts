import { BigIntValue, NumberValue, Value, type ObjectValue, SymbolValue } from '../value.mts';
import type { ThrowCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { surroundingAgent } from '../execution-context/Agent.mts';
import { ContractFactsOf } from '../abstract-ops/runtime-types.mts';
import { resolvedAlias } from './resolving-aliases.mts';
import { type MetadataRecord,
  builtinTypeRecord, libraryTypeRecord, displayType, makePrimitive, voidType, type TypeRecord, namedNumericLiteralRecord, BoundTypeRecordForName,
  parameter, type ParameterRecord, anyType as anyTypeRecord, generatorDeclaredType, generatorParameters,
  neverType, libraryTypeRecord as libraryType } from './records.mts';
import { CanonicalizeType } from './intern.mts';
import {
  iterationInterfaceRecord, identityRecord, setParsedIdentityDeclaration, getParsedIdentityDeclaration,
} from './iteration-types.mts';
import { SoAColumnsOf } from './layout.mts';

import { badKindedArgument } from './records.mts';
import { voidType as voidTypeRecord } from './records.mts';

/** The topic's binding name (#sec-pipeline-operator); `%` is not an IdentifierName, so no program can write it. */
const TOPIC_NAME = '%';
import { Diverges } from './divergence.mts';
import { IsSubtype, SameType, IsAssignable } from './relations.mts';
import { isBitLaneType } from './vector-ops.mts';
import {
  NarrowTo, NarrowFrom, nullishType, empty,
} from './narrowing.mts';
import { MetadataObjectFromType, fitsNumericType, KeyTypesOf, IndexedAccessTypeRecord } from './runtime.mts';
import { isWideIntegerType } from './arithmetic.mts';
import { resolveOverloadByTypes } from './overloads.mts';
import { wrapToType } from './arithmetic.mts';
import { isFloatTypeName, isIntegerTypeName, numericLibraryRows } from './numeric-signatures.mts';
import { inferRegExpLiteralType } from './regexp-inference.mts';
import { Atoms, AtomsOfType } from './Atoms.mts';
import { R, Throw } from '#self';

/**
 * proposal-runtime-types #sec-static-type-of-an-expression and #sec-type-errors
 * A post-parse walk computing the Static Type of expressions and raising the
 * specification's type errors. The Static Type of anything the checker does
 * not model is ~any~, so under the gradual rule silence is sound: an error is
 * raised only where both sides of a judgment are statically known. Scoping is
 * simplified to one frame per function; block-level shadowing inside one
 * function is approximated by overwriting, which cannot introduce a false
 * positive because an unknown type is ~any~.
 */

type Known = TypeRecord | null;

/**
 * proposal-runtime-types #sec-primitive-metadata: two parameterizations of one
 * base with different metadata are related only as the metadata subtype
 * judgment admits, and the judgment consults `subtype` hooks, which are user
 * code. This pass is synchronous and runs at parse, so it does not decide such
 * a pair; it DEFERS it, and the checking pass (check-pass.mts), which runs
 * after parse and before the source text evaluates (#sec-type-errors), judges
 * the deferred pairs where an effectful context exists. The obligations are
 * keyed by the root Parse Node so that pass retrieves exactly its own source
 * text's pairs.
 */
export interface DeferredMetadataCheck {
  readonly source: TypeRecord & { readonly Kind: 'parameterized' };
  readonly target: TypeRecord & { readonly Kind: 'parameterized' };
}
const deferredMetadataChecks = new WeakMap<object, readonly DeferredMetadataCheck[]>();

/** Identity of the self type a method's [[ThisType]] uses (#sec-this-adoption). */
const SELF_THIS = { type: 'SelfThisMarker' } as unknown as ParseNode;

/**
 * The [[ThisType]] a METHOD carries, as one record.
 *
 * PLAN-nominal-records.md v2 item 2.3. The checker built this per class and per
 * interface, which is fine because identity of a ~nominal~ is its
 * [[Declaration]] and they all share SELF_THIS. It is exported because the
 * RUNTIME record for an interface has to attach the SAME marker: a class's
 * method member carries it, and [[ThisType]] is contravariant with absence
 * meaning something - so a marked source against an unmarked target is refused,
 * and a method-bearing interface could not be satisfied by the class that
 * declared it.
 */
export const SelfThisTypeRecord = { Kind: 'nominal', Declaration: SELF_THIS, Arguments: [] } as unknown as TypeRecord;

export function TakeDeferredMetadataChecks(root: object): readonly DeferredMetadataCheck[] {
  return deferredMetadataChecks.get(root) ?? [];
}

/**
 * proposal-runtime-types #sec-metadata-narrowing: "A comparison against a
 * compile-time constant narrows the metadata of a parameterized value ... the
 * metadata whose portion for each meta type _M_ defining `narrow` is the result
 * of `narrow` of _M_ applied to MetadataPortion(_m_, _M_), the String naming
 * _op_, and _c_, and whose portion for each other meta type is unchanged."
 *
 * `narrow` is USER CODE and this pass is synchronous, so the comparison is
 * RECORDED here and resolved by the checking pass, which can call a hook. That
 * is the same boundary a DeferredMetadataCheck crosses, for the same reason.
 *
 * It is not the same USE, though, and the difference is why this needs a table
 * of its own: a deferred check yields a verdict consumed after the walk, while
 * a narrowing yields a TYPE the walk itself must then check against. The
 * resolution therefore feeds a second walk rather than a report.
 *
 * [[Parent]] is what makes nesting work in one resolution sweep. The clause
 * requires composition - `if (v >= 0)` giving `bounds: 0..` and "a further
 * `if (v <= 343)` intersect that bound to `0..=343`" - and a request resolved
 * against the DECLARED type would give the inner branch `..=343`. The nesting is
 * known here, so it is recorded rather than searched for later.
 */
export interface NarrowingRequest {
  /** The test node, which keys the resolution table. */
  readonly key: object;
  /** The binding the comparison speaks about. */
  readonly name: string;
  /** The comparison, as the String the hook is passed. */
  readonly operator: string;
  /** The compile-time constant compared against. */
  readonly constant: Value;
  /** The binding's parameterized type as this walk knows it. */
  readonly subject: TypeRecord & { readonly Kind: 'parameterized' };
  /** The enclosing request's key, or null at the outermost. */
  readonly parent: object | null;
}

const narrowingRequests = new WeakMap<object, readonly NarrowingRequest[]>();

/**
 * #sec-bounds-checks: "The index of a read or write of a fixed-length
 * `[N].<T>` is known to be below _N_, because _N_ is a compile-time constant
 * and the index is a value generic, a `where`-constrained parameter, or the
 * counter of a `for` over a range with that bound. The bound is proven
 * statically and no check is performed."
 *
 * This records the accesses for which that proof holds. It has no observable
 * effect: eliding a check that would have PASSED changes no program's
 * behaviour, which is why the clause is phrased as what an implementation
 * establishes rather than as behaviour. The set is what a production engine
 * consumes, and what a test can assert so the proof's SOUNDNESS is pinned - the
 * cases where it must NOT fire being the ones that matter.
 */
const boundsProvenAccesses = new WeakMap<object, Set<object>>();

/**
 * Uses of a `const` bound to a compile-time numeric constant. The binary
 * operator asks its OPERAND NODE whether it is a literal - `isNumericLiteralOperand`
 * - and these answer yes, so `K * r` adopts `r`'s type exactly as `3.14 * r`
 * does. Marked here because only the checker knows which binding a name
 * resolves to; consulted at evaluation because that is where the value is made.
 */
/**
 * The resolved contextual type of each `new.(...)`, recorded by the checker
 * because only it knows what a position requires.
 */
const targetTypedNewTypes = new WeakMap<object, TypeRecord>();

export function TargetTypedNewType(node: object): TypeRecord | undefined {
  return targetTypedNewTypes.get(node);
}

const constLiteralUses = new WeakSet<object>();

export function IsConstLiteralUse(node: object): boolean {
  return constLiteralUses.has(node);
}

/**
 * Uses of a `let` whose initializer IS a compile-time numeric constant. Such a
 * binding deliberately does not adopt - a mutable binding's type must be fixed,
 * or a reassignment has nothing to check against - but it is the one shape where
 * the failure has a one-word fix, so the diagnostic can say so instead of
 * reporting an unexplained type mismatch.
 */
const letConstantUses = new WeakSet<object>();

export function IsLetConstantUse(node: object): boolean {
  return letConstantUses.has(node);
}

export function TakeBoundsProvenAccesses(root: object): ReadonlySet<object> {
  return boundsProvenAccesses.get(root) ?? new Set();
}

/**
 * TEST HOOK. The count from the most recent check, because the proof is
 * otherwise unreachable: eliding a check that would have PASSED is
 * unobservable, and the set is keyed on a root a script cannot name. Without
 * this the analysis could only be verified by temporary instrumentation, which
 * verifies it once rather than keeping it verified.
 */
let lastBoundsProvenCount = 0;

export function BoundsProvenCountForLastCheck(): number {
  return lastBoundsProvenCount;
}

export function TakeNarrowingRequests(root: object): readonly NarrowingRequest[] {
  return narrowingRequests.get(root) ?? [];
}

/**
 * The narrowed type each request resolved to, keyed by the request's node.
 *
 * Written by the checking pass, which can call `narrow`, and read by the walk,
 * which cannot. Two entries per request: the type the TRUE branch narrows to and
 * the type the FALSE branch does, since #sec-metadata-narrowing narrows the
 * false branch "by the negation of _op_" rather than leaving it alone.
 */
export interface NarrowingResolution {
  readonly whenTrue: TypeRecord;
  readonly whenFalse: TypeRecord;
}

const narrowingResolutions = new WeakMap<object, Map<object, NarrowingResolution>>();

export function SetNarrowingResolutions(root: object, table: Map<object, NarrowingResolution>): void {
  narrowingResolutions.set(root, table);
}

export function GetNarrowingResolution(root: object, key: object): NarrowingResolution | undefined {
  return narrowingResolutions.get(root)?.get(key);
}

/**
 * #sec-primitive-metadata: "a metadata object whose own key no meta type
 * claims is a type error at the parameterization that writes it". The keys
 * are COLLECTED during the walk and adjudicated by the checking pass, because
 * claims register when a MetaDeclaration EVALUATES: deciding here would
 * reject a parameterization written above its meta type, which is legal.
 * Mirrors the deferred-metadata channel above (the plan's Phase 3, F44).
 */
export interface UnclaimedKeyCheck {
  readonly node: ParseNode;
  readonly display: string;
  readonly base: TypeRecord;
  readonly keys: readonly string[];
}
const unclaimedKeyChecks = new WeakMap<object, readonly UnclaimedKeyCheck[]>();

/**
 * A binding declared with a type and NO initializer, held for the pass.
 *
 * PLAN-default-timing.md phase 1. #sec-defaultvalueof: "It is a type error to
 * declare a binding or a field with a type _t_ and no initializer when
 * DefaultValueOf(_t_) is ~none~", and #sec-type-errors makes a type error
 * determinable before the text runs an Early Error. The engine reported it at
 * DECLARATION EVALUATION instead, so `if (false) { let x: I; }` was never
 * checked at all and the diagnostic arrived after the program had begun.
 *
 * Collected here and DECIDED in the pass, for the reason the two channels above
 * are: the answer needs `DefaultValueOf`, which is an evaluator, and it needs
 * the source text's own `meta` declarations to have been processed - a
 * registered `default` supplies one for a type that has no structural zero.
 * This walk is synchronous and runs before that, so it can only collect.
 *
 * [[MetaNamesUnprocessed]] carries D4's guard: the names of types that a `meta`
 * declaration the pre-evaluation loop did NOT process could supply a default
 * for. The loop scans a Script's top-level items, so a `meta` nested in a block
 * is invisible to it while being perfectly visible to the running program.
 */
export interface DefaultRequirement {
  readonly node: ParseNode;
  readonly type: TypeRecord;
  readonly display: string;
  /**
   * The name the annotation WROTE, where it wrote one.
   *
   * D4's guard compares against the name a `meta` declaration targets, and a
   * meta declaration targets a NAME - `meta T { ... }` - while [[Display]] is
   * the resolved type, `uint.<8> | string` for the same annotation. Comparing
   * displays found nothing and the guard never fired.
   */
  readonly annotationName?: string;
}
const defaultRequirements = new WeakMap<object, readonly DefaultRequirement[]>();

export function TakeDefaultRequirements(root: object): readonly DefaultRequirement[] {
  return defaultRequirements.get(root) ?? [];
}

/** Type names a `meta` declaration nested where the pass cannot see it names. */
const blockScopedMetaNames = new WeakMap<object, ReadonlySet<string>>();

export function TakeBlockScopedMetaNames(root: object): ReadonlySet<string> {
  return blockScopedMetaNames.get(root) ?? new Set();
}

export function TakeUnclaimedKeyChecks(root: object): readonly UnclaimedKeyCheck[] {
  return unclaimedKeyChecks.get(root) ?? [];
}

/**
 * proposal-runtime-types #sec-overload-resolution: a call the checker resolved
 * to a numeric value family FROM ITS CONTEXT ALONE must execute that family's
 * row at run time, so the resolution is recorded per CallExpression node and
 * EvaluateCall reads it to type the literal arguments before the dispatch
 * wrapper selects a row. Recorded only where every argument is a numeric
 * literal the checker proved to fit, so the runtime wrap is lossless by
 * construction; everything else stays on the runtime's own dispatch, which is
 * the ~any~ path's backstop.
 */
const staticCallResolutions = new WeakMap<object, TypeRecord & { Kind: 'primitive' }>();

export function TakeStaticCallResolution(node: object): (TypeRecord & { Kind: 'primitive' }) | undefined {
  return staticCallResolutions.get(node);
}

// proposal-runtime-types (spec sec-enums): what the checker records about an enum
// declaration so a switch over an enum value can be checked: the member names in
// declaration order, to match a `case E.Member` label and to report a missing one.
interface EnumInfo {
  readonly names: readonly string[];
}

interface Frame {
  readonly bindings: Map<string, TypeRecord>;

  /**
   * Names bound by a `const` whose initializer is a compile-time numeric
   * constant. Held in the FRAME so it is scoped exactly as the bindings beside
   * it: a parallel stack was not pushed per scope, so an inner `let K` inherited
   * an outer `const K`'s treatment and adopted a type it must not.
   */
  readonly constLiterals: Set<string>;

  /**
   * The literal type of each such `const`'s initializer.
   *
   * #sec-static-type-of-an-expression: a use of one "produces the value the
   * initializer would have produced had it been written at that position", so a
   * position that refuses the written literal must refuse the use. The names
   * alone could not answer that - `const k = 300; let a: uint8 = k` reported at
   * RUN TIME where `let a: uint8 = 300` reports before the program runs.
   */
  readonly constLiteralTypes: Map<string, TypeRecord>;

  /** Names bound by a `let` to a numeric constant; see `letConstantUses`. */
  readonly letConstants: Set<string>;

  /**
   * Names this frame binds IMMUTABLY - a `const` declaration. Read by
   * `derivationIsStable`: a call through such a name cannot be a call to a
   * replaced function, which is what lets its return annotation license an
   * elision.
   */
  readonly immutableNames: Set<string>;

  /**
   * Every name this frame declares, whether or not it got a type. An
   * unannotated `let` registers NO binding - its type is null - so the bindings
   * map cannot answer "does this frame shadow the name", which is what the
   * const-literal lookup needs in order to stop at an inner `let`.
   */
  readonly declaredNames: Set<string>;
  // The names this frame NARROWS rather than declares. sec-narrowing: "a
  // narrowed binding is invalidated by an assignment that leaves the narrowed
  // type", so an assignment has to find the DECLARED type to check against and
  // then drop the narrowing - which needs the two kinds of entry told apart
  // (F78).
  readonly narrowed?: Set<string>;
  readonly aliases: Map<string, TypeRecord>;
  // Enum declarations in scope, by enum name, and the bindings known to hold an
  // enumerator of one, by variable name to enum name.
  readonly enums: Map<string, EnumInfo>;
  readonly enumBindings: Map<string, string>;
}


function emptyFrame(): Frame {
  return {
    bindings: new Map(),
    constLiterals: new Set<string>(),
    constLiteralTypes: new Map<string, TypeRecord>(),
    letConstants: new Set<string>(),
    immutableNames: new Set<string>(),
    declaredNames: new Set<string>(),
    aliases: new Map(),
    enums: new Map(),
    enumBindings: new Map(),
  };
}

/**
 * A copy of _frame_, so that checking an entry that is then REJECTED leaves the
 * session as it was.
 *
 * Every field is carried, including the three that look like they describe only
 * the current entry. `constLiterals`, `letConstants`, and `declaredNames` are
 * what isNumericConstantExpression reads: without them a `const K = 5;` in an
 * earlier entry stops being a numeric constant in a later one. `narrowed` is
 * not carried - a narrowing is established by control flow within an entry and
 * does not survive one.
 */
function cloneFrame(frame: Frame): Frame {
  return {
    bindings: new Map(frame.bindings),
    constLiterals: new Set(frame.constLiterals),
    constLiteralTypes: new Map(frame.constLiteralTypes),
    immutableNames: new Set(frame.immutableNames),
    letConstants: new Set(frame.letConstants),
    declaredNames: new Set(frame.declaredNames),
    aliases: new Map(frame.aliases),
    enums: new Map(frame.enums),
    enumBindings: new Map(frame.enumBindings),
  };
}

function widen(t: TypeRecord): TypeRecord {
  return t.Kind === 'literal' ? t.Base : t;
}

/**
 * #sec-check-elision: "A check is required only where the static types do not
 * already establish the result." The checker proves that at a boundary and
 * records the annotation whose check may be skipped; the run time consults the
 * same set (F81).
 *
 * The condition is narrower than the clause's first bullet reads, and the
 * narrowing is the whole correctness argument. A LITERAL is assignable to
 * `uint8` and still needs converting - `let x: uint8 = 5` must produce a uint8
 * value, not the Number 5 - so assignability alone does not license skipping
 * the boundary. What licenses it is that the value is ALREADY of the target
 * type: a non-literal static type that is assignable needs no representation
 * change, so the boundary would return it unchanged.
 */
const elidableAnnotations = new WeakSet<object>();

/**
 * proposal-runtime-types: whether a conversion to this target has an EFFECT
 * beyond passing the value through.
 *
 * An elision is sound only where the boundary would return the value unchanged.
 * The conditions below already exclude an `~any~` or `~literal~` SOURCE for that
 * reason - both convert, and eliding a conversion loses it - but a TARGET can
 * convert too, and `Span.<T>` does: #sec-span-coercion says the coercion
 * MATERIALIZES, producing a window distinct from the array coerced.
 *
 * Eliding it left the window unbuilt. A `Span.<T>` bound by a `let` or returned
 * from a function was then the array itself, carrying `push` and `capacity` and
 * subject to no liveness rule - every guarantee the type states, absent,
 * because the checker proved the boundary "had nothing to do".
 *
 * This is a predicate rather than a test for `Span` inline because the rule is
 * about conversions that do something, and `Span.<T>` is only today's instance.
 */
function conversionHasEffect(target: TypeRecord | null | undefined): boolean {
  if (!target) {
    return false;
  }
  return target.Kind === 'nominal'
    && (target as { LibraryName?: string }).LibraryName === 'Span';
}

/**
 * Whether a contextual type asks for a `bigint`, through a union as well as
 * directly: `let x: bigint | undefined = 9007199254740993` wants the same
 * reading as the bare annotation.
 */
/** The width of a decimal type, or *undefined* where the type is not one. */
function decimalWidthOf(t: TypeRecord): 32 | 64 | 128 | undefined {
  const base = t.Kind === 'literal' ? t.Base : t;
  if (base.Kind !== 'primitive') {
    return undefined;
  }
  switch (base.Name) {
    case 'decimal32': return 32;
    case 'decimal64': return 64;
    case 'decimal128': return 128;
    default: return undefined;
  }
}

function bigintTarget(t: TypeRecord): boolean {
  if (t.Kind === 'primitive') {
    return t.Name === 'bigint';
  }
  if (t.Kind === 'union') {
    // PLAN-number-bigint-coercion.md. A union is a bigint target only where NO
    // arm already accepts the literal as a Number. `some` alone made every
    // union containing `bigint` one, so `let x: number | bigint = 5` propagated
    // the literal to `bigint` and the binding held `5n`:
    //
    //   typeof x   // "bigint"     x === 5   // false     x + 1  // TypeError
    //
    // #sec-type-membership makes a union's arms ALTERNATIVES - "a value belongs
    // to a union if it belongs to any member" - so a literal that already
    // belongs to one arm has no reason to be converted for another. The Number
    // arm is preferred because the literal is written as a Number; a `5n` is a
    // BigInt literal and reaches the bigint arm on its own.
    return t.Members.some(bigintTarget) && !t.Members.some(numberLiteralTarget);
  }
  return false;
}

/**
 * Whether a type accepts an integer numeric literal AS A NUMBER, without
 * conversion.
 *
 * PLAN-number-bigint-coercion.md: this is the half `bigintTarget` was missing.
 * `number` and every sized numeric type hold `5` as written; `bigint` does not,
 * which is why it is the one numeric name excluded here.
 */
function numberLiteralTarget(t: TypeRecord): boolean {
  if (t.Kind === 'literal') {
    return numberLiteralTarget(t.Base as TypeRecord);
  }
  if (t.Kind === 'primitive') {
    // `number` is the untyped one; the sized names are the typed numerics that
    // hold an integer literal as written. `bigint` is deliberately absent - it
    // is the arm this predicate exists to lose to.
    return t.Name === 'number' || t.Name === 'int' || t.Name === 'uint'
      || t.Name === 'float' || t.Name === 'decimal';
  }
  if (t.Kind === 'union') {
    return t.Members.some(numberLiteralTarget);
  }
  return false;
}

/**
 * The exact mathematical value a numeric literal denotes, where it denotes an
 * integer, read from the source text. Returns *null* where the literal is not
 * an integer, where it is already a BigInt literal (which needs no help), or
 * where no source text was retained - an older parse node, or one this engine
 * synthesized.
 */
function exactBigIntOf(node: ParseNode.NumericLiteral): bigint | null {
  if (typeof node.value === 'bigint') {
    return null;
  }
  const text = node.SourceText;
  if (typeof text !== 'string' || text.length === 0) {
    return null;
  }
  // A separator is not part of the value; a fraction or an exponent means the
  // literal does not denote an integer, and BigInt() would throw rather than
  // answer. Legacy octal is excluded deliberately: `0755` denotes 493 in
  // sloppy mode and 755 to BigInt, and a literal whose reading depends on the
  // mode is not one to be clever with.
  const cleaned = text.replace(/_/g, '');
  if (!/^(0[xXoObB][0-9a-fA-F]+|[1-9][0-9]*|0)$/.test(cleaned)) {
    return null;
  }
  try {
    return BigInt(cleaned);
  } catch {
    return null;
  }
}

/** Numeric literals the checker read at `bigint`, consulted by NumericValue. */
const bigintLiterals = new WeakSet<object>();

export function IsBigIntContextLiteral(node: object): boolean {
  return bigintLiterals.has(node);
}

/**
 * Numeric literals the checker read at a DECIMAL type, with the width to build
 * them at - consulted by NumericValue, exactly as the bigint mark is.
 *
 * PLAN-decimal.md stage B. "In a decimal context the literal `0.1` is the
 * decimal one tenth, where in a `float64` context the same `0.1` is the nearest
 * binary float", and the cohort member comes from the SOURCE TEXT: `1.0` is
 * 10 x 10^-1 where `1.00` is 100 x 10^-2, and by the time the lexer has made a
 * double the two are indistinguishable.
 */
const decimalLiterals = new WeakMap<object, 32 | 64 | 128>();

export function DecimalContextLiteralWidth(node: object): 32 | 64 | 128 | undefined {
  return decimalLiterals.get(node);
}

/**
 * Numeric literals the checker read at a WIDE INTEGER type, with the exact value
 * to build them from - consulted by NumericValue, exactly as the two marks above
 * are.
 *
 * #sec-integer-types gives `int.<N>` "exactly 2**N values", and a double
 * distinguishes those only to 53 bits, so `let x: int64 = 9007199254740993;`
 * was the double ...992 before anything could consult the type.
 * #sec-literalvalueintype takes "the mathematical value denoted by the literal,
 * as defined by the numeric literal grammar, BEFORE ANY ROUNDING", and the
 * source text is where that value still exists.
 */
const wideIntegerLiterals = new WeakMap<object, { value: bigint, type: TypeRecord }>();

export function WideIntegerContextLiteral(node: object): { value: bigint, type: TypeRecord } | undefined {
  return wideIntegerLiterals.get(node);
}

/**
 * proposal-runtime-types #sec-inferred-return-types: the published inferred
 * return type of a function, keyed by its declaration node.
 *
 * The run time needs it for the reason it needs a written annotation: the
 * check-site table gives a `return` in a function with a declared OR PUBLISHED
 * return type a RequireType, and without that the published type is a claim
 * nothing verifies - a type the checker hands to callers and the boundary never
 * tests. It is a WeakMap rather than a field on the function object because the
 * checker computes it over declarations, before any function object exists.
 */
const publishedReturnTypes = new WeakMap<object, TypeRecord>();

/**
 * The instance type the checker built for a class declaration, by its node.
 *
 * PLAN-nominal-records.md phase 2: the runtime's own record for the same class
 * reads [[Base]] and [[Structure]] from here rather than computing them again.
 */
const publishedClassTypes = new WeakMap<object, TypeRecord>();

export function PublishedClassTypeOf(declaration: object): TypeRecord | undefined {
  return publishedClassTypes.get(declaration);
}

/**
 * The ABSTRACT members a class declares, by name, with their declared types.
 *
 * PLAN-abstract-implementation.md, the checking-pass migration. Published beside
 * the class record because the two rules of #sec-abstract-classes are questions
 * about a CHAIN - "a class not declared `abstract` leaves an inherited abstract
 * method unimplemented" - and the chain is walked through [[Base]], whose
 * declarations this is keyed by.
 */
const publishedAbstractMembers = new WeakMap<object, ReadonlyMap<string, TypeRecord | null>>();

export function PublishedAbstractMembersOf(declaration: object): ReadonlyMap<string, TypeRecord | null> | undefined {
  return publishedAbstractMembers.get(declaration);
}

export function PublishedReturnTypeOf(declaration: object): TypeRecord | undefined {
  return publishedReturnTypes.get(declaration);
}

export function IsCheckElided(annotation: object): boolean {
  return elidableAnnotations.has(annotation);
}

/**
 * proposal-runtime-types: the static knowledge one console entry leaves for the
 * next.
 *
 * The checks this proposal inserts are STATIC (#table-check-sites), and a
 * lexical binding has no run-time typed-storage boundary to catch what they
 * miss - the note in performDevtoolsEval says as much. So a console that
 * evaluates each entry as its own script forgets every declared type at the
 * entry boundary: `let n: uint8 = 1;` then `n = 300;` was accepted, and a
 * `switch` over an enum-typed binding declared earlier was not checked for
 * exhaustiveness, while the same text in ONE entry is refused.
 *
 * A session carries the top-level frame between entries, which is exactly that
 * knowledge. It is deliberately NOT a concatenation of the session's source: a
 * console permits `let a = 1;` twice, and concatenating two accepted entries
 * produces "Identifier a already declared" from the parser.
 */
export interface CheckSession {
  frame: Frame;
  enumNodes: Map<string, ParseNode>;
}

export function CreateCheckSession(): CheckSession {
  return { frame: emptyFrame(), enumNodes: new Map() };
}

/**
 * Checks _script_ as the next entry of _session_, and returns the state to
 * carry forward beside the errors.
 *
 * The caller commits `next` only if it accepts the entry - a rejected entry must
 * leave no declarations behind - which is why the session is not mutated here.
 */
export function CheckScriptInSession(script: ParseNode.Script, session: CheckSession): { errors: ObjectValue[], next: CheckSession } {
  const next: CheckSession = { frame: cloneFrame(session.frame), enumNodes: new Map(session.enumNodes) };
  const errors = CheckStatementList(script.ScriptBody?.StatementList ?? null, script, next);
  return { errors, next };
}

export function CheckScript(script: ParseNode.Script): ObjectValue[] {
  return checkInTwoPasses(script.ScriptBody?.StatementList ?? null, script);
}

/**
 * Check _list_ twice: once to DECLARE, and once to report.
 *
 * Inferred return types are published before the walk, because a call's Static
 * Type must be settled before the walk checks the calls. That order left a body
 * reading anything the list itself declares - a module-scope
 * `let arr: [].<uint8>` - with nothing to read, while a body CALLING a function
 * declared beside it published, because signatures ARE collected first. The
 * asymmetry was invisible except as an inference that silently did not happen.
 *
 * Declaring the bindings earlier does not work, and the reason is not the order
 * but the memoization: a type is not complete until the walk has seen every
 * declaration that adds to it - an interface whose computed key waits on a
 * `const`, or any name a `partial interface` extends - and resolving an
 * annotation early CACHES the incomplete record. Both were measured, and both
 * are silent: the member simply stops being checked.
 *
 * So the declarations are made by a whole first pass, in order, with its
 * diagnostics discarded; the frame it produces is handed to the second pass,
 * whose publication then sees every type in its final form. The second pass
 * reports. Everything a pass accumulates is local to the call, so the second
 * starts clean.
 */
function checkInTwoPasses(statementList: readonly ParseNode[] | null, root: ParseNode, session?: CheckSession): ObjectValue[] {
  const declaring: CheckSession = session
    ? { frame: cloneFrame(session.frame), enumNodes: new Map(session.enumNodes) }
    : CreateCheckSession();
  CheckStatementList(statementList, root, declaring);
  return CheckStatementList(statementList, root, declaring);
}

/**
 * proposal-runtime-types #sec-inference-fixpoint: the types a module makes
 * available under each exported name, recorded when the module is checked so
 * that an IMPORTING module can read them.
 *
 * A module's own text determines these - `export function fx(): uint32` says
 * what `fx` is without reference to anything imported - so they are collected
 * during the ordinary parse-time check and read later, at link time, when the
 * graph is resolved and an importer can be told what it is importing.
 */
const moduleExportedTypes = new WeakMap<object, Map<string, Known>>();

export function ExportedTypesOf(module: ParseNode.Module): Map<string, unknown> | undefined {
  return moduleExportedTypes.get(module as unknown as object) as Map<string, unknown> | undefined;
}

export function CheckModule(module: ParseNode.Module): ObjectValue[] {
  // Module items are a superset of statements; import/export wrappers are
  // walked structurally, and their inner declarations checked as usual.
  const session = CreateCheckSession();
  // Declared first, reported second - see checkInTwoPasses. A module's own
  // top-level bindings are invisible to its inference for the same reason a
  // script's are, so the same two passes apply; the frame is already threaded
  // here, which is what the pass needs.
  CheckStatementList(module.ModuleBody?.ModuleItemList ?? null, module, session);
  const errors = CheckStatementList(module.ModuleBody?.ModuleItemList ?? null, module, session);
  // Every top-level declaration of the module, keyed by its LOCAL name. An
  // importer resolves an import to the exporting module and a binding name -
  // which is that local name - so nothing here needs to read export syntax, and
  // a re-export or a renamed export resolves through the same lookup.
  const exported = new Map<string, Known>(session.frame.bindings);
  moduleExportedTypes.set(module as unknown as object, exported);
  return errors;
}

/**
 * Check _module_ again with the types of the names it IMPORTS supplied.
 *
 * The parse-time check above runs before the module graph is resolved, so an
 * imported name is undeclared there and a call of it is ~any~. This pass runs at
 * link time, when every dependency has been parsed and its exported types
 * recorded, and it can therefore report what the first pass could not: that a
 * value crossing a module boundary does not fit the annotation it is given.
 *
 * Running the whole check twice reports nothing twice, because a module whose
 * first pass found errors never reaches linking. Every error this pass finds is
 * one that needed an import to see.
 */
export function CheckModuleWithImports(module: ParseNode.Module, imported: ReadonlyMap<string, unknown>): ObjectValue[] {
  if (imported.size === 0) {
    return [];
  }
  const session = CreateCheckSession();
  for (const [name, t] of imported) {
    session.frame.bindings.set(name, t as TypeRecord);
    session.frame.declaredNames.add(name);
    // An import binding cannot be assigned, so a call through it is stable for
    // #sec-elision-stability - the exporting module's own mutation is what the
    // stability rule there judges, and this pass does not see it.
    session.frame.immutableNames.add(name);
  }
  return CheckStatementList(module.ModuleBody?.ModuleItemList ?? null, module, session);
}

function CheckStatementList(statementList: readonly ParseNode[] | null, root: ParseNode, session?: CheckSession): ObjectValue[] {
  const errors: ObjectValue[] = [];
  const deferred: DeferredMetadataCheck[] = [];
  const unclaimed: UnclaimedKeyCheck[] = [];
  /** PLAN-default-timing.md phase 1: declarations the pass must answer for. */
  const defaultsNeeded: DefaultRequirement[] = [];
  /** D4: type names named by a `meta` the pre-evaluation loop cannot reach. */
  const nestedMetaNames = new Set<string>();
  // The outermost frame is the session's where there is one, so a console entry
  // sees what earlier entries declared. It is already a copy (see
  // CheckScriptInSession), so checking writes the next state into it and the
  // caller decides whether to keep it.
  /**
   * Names the source text assigns to anywhere, and whether it contains a direct
   * `eval`. Read by `immutablyBound` for the elision-stability judgment of
   * #sec-check-elision. Collected once over the whole text rather than as the
   * walk proceeds, because an assignment may appear textually after the call
   * whose elision it invalidates.
   */
  const assignedNames = new Set<string>();
  let hasDirectEval = false;
  const collectMutations = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      for (const c of node) {
        collectMutations(c);
      }
      return;
    }
    const n = node as Record<string, unknown> & { type?: string };
    if (typeof n.type !== 'string') {
      return;
    }
    const targetName = (t: unknown): void => {
      const x = t as { type?: string, name?: string } | null | undefined;
      if (x && x.type === 'IdentifierReference' && typeof x.name === 'string') {
        assignedNames.add(x.name);
      }
    };
    if (n.type === 'AssignmentExpression') {
      targetName(n.LeftHandSideExpression);
    } else if (n.type === 'UpdateExpression') {
      targetName(n.LeftHandSideExpression ?? n.UnaryExpression);
    } else if (n.type === 'ForInStatement' || n.type === 'ForOfStatement') {
      targetName(n.LeftHandSideExpression);
    } else if (n.type === 'CallExpression') {
      const callee = n.CallExpression ?? n.MemberExpression;
      const c = callee as { type?: string, name?: string } | null | undefined;
      if (c && c.type === 'IdentifierReference' && c.name === 'eval') {
        hasDirectEval = true;
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'parent' || key === 'location' || key === 'strict' || key === 'sourceText') {
        continue;
      }
      collectMutations(n[key]);
    }
  };

  /** The `this` a non-arrow literal adopted from its contextual signature. */
  const contextualThisTypes = new Map<ParseNode, Known>();
  /** The type that OWNS the signature a literal adopted, where one is known. */
  const contextualThisOwners = new Map<ParseNode, Known>();
  /**
   * The type parameters in scope, innermost last. A generic declaration binds
   * its parameters for its whole signature and body, so they are pushed while
   * that declaration is read and popped after.
   */
  // PLAN-parameter-composition Stage A. A scope maps each name to its RESOLVED
  // constraint, or null where it declares none. It was a `Set<string>` - names
  // only - which is why `#sec-issubtype`'s [[Constraint]] step had nothing to
  // read and `function f<T: string>(x: T): string { return x; }` was refused.
  const typeParameterScopes: Map<string, Known | null>[] = [];

  const typeParameterInScope = (name: string): boolean => typeParameterScopes.some((scope) => scope.has(name));

  /** The innermost resolved constraint bound to _name_, or null where it has none. */
  const typeParameterConstraintOf = (name: string): Known | null => {
    for (let i = typeParameterScopes.length - 1; i >= 0; i -= 1) {
      const scope = typeParameterScopes[i];
      if (scope.has(name)) {
        return scope.get(name) ?? null;
      }
    }
    return null;
  };

  /**
   * Push _declaration_'s type parameters, each with its RESOLVED constraint.
   *
   * The scope is pushed BEFORE the constraints resolve and filled in order,
   * because a constraint may read an earlier parameter - `<T, K: keyof T>` is
   * the ordinary case - and `#sec-generic-functions` evaluates them in
   * declaration order for that reason. A parameter is entered with a null
   * constraint before its OWN constraint resolves, so a self-reference
   * terminates rather than recurring.
   */
  const pushTypeParameterScopeOf = (declaration: ParseNode | null | undefined): boolean => {
    const list = (declaration as unknown as {
      TypeParameters?: {
        TypeParameterList?: readonly {
          BindingIdentifier?: { name?: string },
          TypeParameterConstraint?: ParseNode.Type | null,
        }[],
      },
    } | null | undefined)?.TypeParameters?.TypeParameterList;
    if (!list || list.length === 0) {
      return false;
    }
    const scope = new Map<string, Known | null>();
    typeParameterScopes.push(scope);
    for (const tp of list) {
      const name = tp.BindingIdentifier?.name;
      if (!name) {
        continue;
      }
      scope.set(name, null);
      if (tp.TypeParameterConstraint) {
        scope.set(name, resolveType(tp.TypeParameterConstraint));
      }
    }
    return true;
  };

  /** A scope of names with no constraints, for a site that has only names. */
  const scopeOfNames = (names: Iterable<string>): Map<string, Known | null> => {
    const scope = new Map<string, Known | null>();
    for (const n of names) {
      scope.set(n, null);
    }
    return scope;
  };

  /** Read _declaration_'s type parameter names, or ~none~ where it binds none. */
  const typeParameterNamesOf = (declaration: ParseNode | null | undefined): readonly string[] | null => {
    const list = (declaration as unknown as {
      TypeParameters?: { TypeParameterList?: readonly { BindingIdentifier?: { name?: string } }[] },
    } | null | undefined)?.TypeParameters?.TypeParameterList;
    if (!list || list.length === 0) {
      return null;
    }
    const names = list.map((tp) => tp.BindingIdentifier?.name ?? '').filter((n) => n !== '');
    return names.length > 0 ? names : null;
  };


  const frames: Frame[] = [session ? session.frame : emptyFrame()];
  const returnTypes: Known[] = [];

  /**
   * Depth of branches whose guard this walk cannot judge yet.
   *
   * PLAN-declarative-checker-facts.md phase 3. #sec-declared-narrowing lets a
   * CALL be the test - `if (isU8(box))` - and the callee's [[Narrows]] is
   * readable only once its type is, which for a constructed guard means once
   * its alias has evaluated (phase 2). The PARSE-TIME walk runs before that, so
   * it sees an unknown callee, narrows nothing, and reported the guarded branch
   * as an early error - a verdict the later walk, which CAN narrow, was never
   * able to overturn.
   *
   * So the first walk defers instead: inside a branch guarded by a call it
   * cannot resolve, it collects no errors and leaves the judgment to the walk
   * that runs after the pre-evaluation. This is the same division of labour
   * `narrowingRequestOf` already makes for a bounds comparison, expressed as a
   * suppression because the fact here is not a request to be answered later -
   * it is the same walk, later, with a type it lacked.
   */
  let deferredGuardDepth = 0;

  /**
   * The function whose PUBLISHED return type produced the type currently being
   * checked, where there is one.
   *
   * An inference-sourced error names a type the program never wrote, and
   * without saying where it came from the reader is left to work out why a
   * function they did not annotate has a type at all. #sec-inferred-return-types
   * makes participation non-local on purpose - an annotation's reach travels
   * through returns - so the diagnostic has to carry what the reach was.
   */
  /**
   * What ANCHORED a contribution, phrased for a diagnostic.
   *
   * Participation is non-local by design (#sec-anchored-contributions): an
   * annotation's reach travels through returns, so a function nobody annotated
   * can acquire a type, and the question a reader is left with is not "which
   * return" but "which annotation". `function g() { return f(); }` publishes
   * because `f` declares a return type, possibly in another module, and naming
   * `f` is the sentence that closes the gap.
   */
  const anchorDescription = (expr: ParseNode | null | undefined): string | null => {
    if (!expr || typeof expr !== 'object') {
      return null;
    }
    // A call: the callee is what supplied the type.
    if (expr.type === 'CallExpression') {
      const callee = (expr as { CallExpression?: ParseNode }).CallExpression as { type?: string, name?: string } | undefined;
      if (callee?.type === 'IdentifierReference' && callee.name) {
        return callee.name;
      }
      return null;
    }
    // A read of an annotated name: the name is what supplied it.
    if (expr.type === 'IdentifierReference') {
      const name = (expr as unknown as { name?: string }).name;
      return name ?? null;
    }
    return null;
  };

  const callProvenance = new WeakMap<object, string>();

  /** The anchor a published type was derived from, by declaration node. */
  const publishedAnchors = new WeakMap<object, string>();
  const callAnchors = new WeakMap<object, string>();

  /**
   * Where each member of a published union came from.
   *
   * Naming the function answers "why does this have a type"; naming the anchor
   * answers "which annotation". A union leaves a third question, and it is the
   * one a reader of a multi-return function actually asks: of `uint32 | string`
   * refused at a `string`, WHICH return produced the `uint.<32>`. The members
   * are joined from contributions, so the answer exists at the moment they are
   * collected and nowhere afterwards.
   */
  const publishedOrigins = new WeakMap<object, { type: TypeRecord, from: string }[]>();
  const callOrigins = new WeakMap<object, { type: TypeRecord, from: string }[]>();
  let provenanceNote: string | null = null;
  let anchorNote: string | null = null;
  let originNotes: { type: TypeRecord, from: string }[] | null = null;

  const report = (source: TypeRecord, target: TypeRecord) => {
    if (deferredGuardDepth > 0) {
      return;
    }
    // #sec-published-return-types, the diagnostic: where a published UNION is
    // refused, name the member that does not fit and the return it came from.
    if (provenanceNote && originNotes && source.Kind === 'union') {
      const offending = (source as { Members: readonly TypeRecord[] }).Members
        .filter((m) => !IsAssignable(m, target));
      if (offending.length === 1) {
        const origin = originNotes.find((o) => SameType(o.type, offending[0]!));
        if (origin) {
          const completion = Throw.TypeError('$1 is not assignable to $2, and it is the inferred return type of $3, whose $4 comes from $5', Value(displayType(source)), Value(displayType(target)), Value(provenanceNote), Value(displayType(offending[0]!)), Value(origin.from)) as ThrowCompletion;
          errors.push(completion.Value as ObjectValue);
          return;
        }
      }
    }
    let completion: ThrowCompletion;
    if (provenanceNote && anchorNote) {
      completion = Throw.TypeError('$1 is not assignable to $2, and it is the inferred return type of $3, which is what $4 declares', Value(displayType(source)), Value(displayType(target)), Value(provenanceNote), Value(anchorNote)) as ThrowCompletion;
    } else if (provenanceNote) {
      completion = Throw.TypeError('$1 is not assignable to $2, and it is the inferred return type of $3', Value(displayType(source)), Value(displayType(target)), Value(provenanceNote)) as ThrowCompletion;
    } else {
      completion = Throw.TypeError('$1 is not assignable to $2', Value(displayType(source)), Value(displayType(target))) as ThrowCompletion;
    }
    errors.push(completion.Value as ObjectValue);
  };

  /** Run _check_ with the provenance of _initializer_, where it has one. */
  const withProvenance = (initializer: ParseNode | null | undefined, check: () => void): void => {
    const previous = provenanceNote;
    const previousAnchor = anchorNote;
    const previousOrigins = originNotes;
    provenanceNote = initializer ? callProvenance.get(initializer as unknown as object) ?? null : null;
    anchorNote = initializer ? callAnchors.get(initializer as unknown as object) ?? null : null;
    originNotes = initializer ? callOrigins.get(initializer as unknown as object) ?? null : null;
    try {
      check();
    } finally {
      provenanceNote = previous;
      anchorNote = previousAnchor;
      originNotes = previousOrigins;
    }
  };

  // #sec-contextual-types: a numeric literal whose value fits a numeric value
  // type is assignable to it; the boundary constructs the typed value. This is
  // the permanent contextual-typing rule (not a stopgap): after R1/R3 the value
  // space is genuinely distinct, and this is how a plain literal enters it.
  const literalFitsNumericType = (sourceRaw: TypeRecord, targetRaw: TypeRecord): boolean => {
    // `shared uint8` is `uint8` for the purpose of this rule. `IsSubtype` already
    // looks through the marker (relations.mts), but a numeric literal reaches a
    // numeric type by CONVERSION rather than by subtyping, and this path did not
    // - so `let s: shared uint8 = 1;` was refused the moment the annotation
    // resolved, while the runtime converted and admitted it.
    //
    // PLAN-checker-type-resolution, C2's `SharedType` gap: the annotation was
    // left UNRESOLVED to avoid that refusal, which bought silence at the cost of
    // the whole annotation being unchecked. Looking through here is what lets it
    // be resolved.
    const source = sourceRaw.Kind === 'shared' ? sourceRaw.Target as TypeRecord : sourceRaw;
    const target = targetRaw.Kind === 'shared' ? targetRaw.Target as TypeRecord : targetRaw;
    if (source.Kind === 'literal' && target.Kind === 'primitive'
        && ['uint', 'int', 'float16', 'float32', 'float64', 'float128', 'bigint'].includes(target.Name)
        && source.Value instanceof NumberValue
        && fitsNumericType(R(source.Value) as number, target.Name, target.Arguments)) {
      return true;
    }
    // A BigInt literal at `bigint` is the same rule with the other literal
    // kind: the value is already of the target type (F66).
    if (source.Kind === 'literal' && target.Kind === 'primitive' && target.Name === 'bigint'
        && source.Value instanceof BigIntValue) {
      return true;
    }
    if (target.Kind === 'union') {
      return target.Members.some((m) => literalFitsNumericType(source, m));
    }
    return false;
  };

  // Metadata erased: a ~parameterized~ record replaced by its base, through
  // unions and intersections. This is exactly the view resolveType gave before
  // it learnt to build ~parameterized~ records, and judging non-deferred shapes
  // on it keeps this pass's diagnostics byte-identical to what they were: the
  // one new judgment this cycle adds, the metadata subtype judgment, is the
  // checking pass's, not this one's.
  const eraseMetadata = (t: TypeRecord): TypeRecord => {
    if (t.Kind === 'parameterized') {
      return eraseMetadata(t.Base);
    }
    if (t.Kind === 'union' || t.Kind === 'intersection') {
      return { Kind: t.Kind, Members: t.Members.map(eraseMetadata) };
    }
    return t;
  };

  /**
   * Whether _target_ is a class with a one-parameter constructor admitting
   * _source_ - the first declaring form of sec-user-defined-conversions. One
   * parameter exactly: a constructor of two is reached through target-typed
   * construction, not through a conversion.
   */
  const convertingConstructorAccepts = (target: TypeRecord, source: TypeRecord): boolean => {
    if (target.Kind !== 'nominal') {
      return false;
    }
    const decl = (target as unknown as { Declaration?: ParseNode }).Declaration;
    const body = (decl as unknown as {
      ClassTail?: { ClassBody?: readonly ParseNode[] | null } | null,
    } | undefined)?.ClassTail?.ClassBody;
    if (!body) {
      return false;
    }
    for (const member of body) {
      if ((member as { type?: string }).type !== 'MethodDefinition') {
        continue;
      }
      const m = member as unknown as {
        static?: boolean,
        ClassElementName?: { name?: string, value?: string } | null,
        UniqueFormalParameters?: readonly ParseNode[] | null,
      };
      const name = m.ClassElementName?.name ?? m.ClassElementName?.value;
      if (m.static || name !== 'constructor') {
        continue;
      }
      const params = m.UniqueFormalParameters ?? [];
      if (params.length !== 1) {
        continue;
      }
      const annotation = (params[0] as unknown as {
        TypeAnnotation?: { Type: ParseNode.Type } | null,
      }).TypeAnnotation;
      if (!annotation) {
        return true;
      }
      const want = resolveType(annotation.Type);
      if (want && (IsAssignable(source, want) || literalFitsNumericType(source, want))) {
        return true;
      }
    }
    return false;
  };

  /**
   * Whether _source_ is a class declaring `operator T()` for _target_ - the
   * second declaring form of sec-user-defined-conversions, converting the
   * receiver. The mirror of the converting constructor: that one is declared on
   * the TARGET, this one on the SOURCE.
   */
  const declaresConversionTo = (source: TypeRecord, target: TypeRecord): boolean => {
    if (source.Kind !== 'nominal') {
      return false;
    }
    const decl = (source as unknown as { Declaration?: ParseNode }).Declaration;
    const body = (decl as unknown as {
      ClassTail?: { ClassBody?: readonly ParseNode[] | null } | null,
    } | undefined)?.ClassTail?.ClassBody;
    if (!body) {
      return false;
    }
    for (const member of body) {
      const m = member as unknown as {
        type?: string,
        OperatorName?: string | null,
        Type?: ParseNode.Type | null,
      };
      if (m.type !== 'OperatorDefinition' || m.OperatorName || !m.Type) {
        continue;
      }
      const to = resolveType(m.Type);
      if (to && SameType(to, target)) {
        return true;
      }
    }
    return false;
  };

  /**
   * Whether _target_ is a class declaring `operator T(value: S)` for its own
   * type - the third declaring form of sec-user-defined-conversions, "the form a
   * type declares when its constructor is already spoken for". Declared on the
   * TARGET like a converting constructor, but taking a parameter, and running
   * with no receiver.
   */
  const declaresInboundConversion = (target: TypeRecord, source: TypeRecord): boolean => {
    if (target.Kind !== 'nominal') {
      return false;
    }
    const decl = (target as unknown as { Declaration?: ParseNode }).Declaration;
    const body = (decl as unknown as {
      ClassTail?: { ClassBody?: readonly ParseNode[] | null } | null,
    } | undefined)?.ClassTail?.ClassBody;
    if (!body) {
      return false;
    }
    for (const member of body) {
      const m = member as unknown as {
        type?: string,
        OperatorName?: string | null,
        Type?: ParseNode.Type | null,
        FormalParameters?: readonly ParseNode[] | null,
      };
      if (m.type !== 'OperatorDefinition' || m.OperatorName || !m.Type) {
        continue;
      }
      const params = m.FormalParameters ?? [];
      if (params.length !== 1) {
        continue;
      }
      const to = resolveType(m.Type);
      if (!to || !SameType(to, target)) {
        continue;
      }
      const ann = (params[0] as unknown as { TypeAnnotation?: { Type: ParseNode.Type } | null }).TypeAnnotation;
      if (!ann) {
        return true;
      }
      const want = resolveType(ann.Type);
      if (want && (IsAssignable(source, want) || literalFitsNumericType(source, want))) {
        return true;
      }
    }
    return false;
  };

  /**
   * proposal-runtime-types #sec-isobjectsubtype: an object type "is subtyped in
   * depth only through a `readonly` member. A `readonly` member is covariant,
   * since a value read from it and never written through it need only be of the
   * required type." The "never written through it" is what makes that sound, and
   * this is where it is made true for an object type.
   *
   * Checked here rather than at the store, which is where a class's `readonly`
   * field is checked, because the two are not the same kind of fact. A class's
   * `readonly` belongs to the OBJECT - the declaring class says so and the
   * instance carries it - while an object type's belongs to the REFERENCE. One
   * object can be viewed through both a readonly and a writable type, and the
   * boundary hands back the same object rather than a copy:
   *
   *   type RO = { readonly x: uint8 };  type RW = { x: uint8 };
   *   let o = { x: 1 };  let a: RW = o;  let b: RO = o;   // a === b === o
   *
   * A mark on the object could not tell `a.x = 2` from `b.x = 2`, and which one
   * won would be the order the two bindings were declared in. The view exists
   * only in this pass, so the check does too.
   *
   * The consequence, which is narrower than a class field's guarantee: a write
   * through a value whose static type is not known here - an `any` - is not
   * refused, and cannot be without per-reference tracking.
   */
  const requireWritableMember = (lhs: ParseNode | null | undefined) => {
    if (!lhs || lhs.type !== 'MemberExpression') {
      return;
    }
    const m = lhs as unknown as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null, Expression?: ParseNode | null };
    const objType = m.MemberExpression ? structureOf(staticType(m.MemberExpression)) : null;
    if (!objType || objType.Kind !== 'object') {
      return;
    }
    let key: string | SymbolValue | undefined;
    if (m.IdentifierName) {
      key = m.IdentifierName.name;
    } else if (m.Expression) {
      // A symbol-keyed store, `v[s] = ...`, resolved the way the assignability
      // check below resolves it: the computed expression names a symbol `const`,
      // which carries the key minted for its declaration.
      const computed = m.Expression as { type?: string, name?: string };
      const declaration = computed.type === 'IdentifierReference' && typeof computed.name === 'string'
        ? symbolConsts.get(computed.name)
        : undefined;
      if (declaration) {
        key = symbolKeyFor(declaration) as unknown as string;
      }
    }
    if (key === undefined) {
      return;
    }
    const prop = objType.Properties.find((candidate) => candidate.key === key);
    if (prop && (prop as { readonly?: boolean }).readonly) {
      const completion = Throw.TypeError('$1 is a readonly member and cannot be assigned', typeof key === 'string' ? Value(key) : key) as ThrowCompletion;
      errors.push(completion.Value as ObjectValue);
    }
  };

  /**
   * #sec-published-return-types, the second reading: subtyping and
   * assignability read the DECLARED return where one is declared and the
   * PUBLISHED one otherwise.
   *
   * The published type lives in its own field so that identity, overload-set
   * formation, and ranking keep reading the declared one; a comparison of two
   * function types has to be told to look at the other field, and this
   * materializes a record that says what the function actually returns. It is
   * what lets an unannotated method satisfy an annotated interface, and an
   * unannotated function be refused by a function-typed position it does not
   * fit.
   */
  /**
   * #sec-generic-functions: _t_ with each type parameter replaced by what the
   * call bound it to.
   *
   * A generic call's Static Type was not computed at all, so
   * `function first<T>(a: [].<T>): T {}` called as `first.<uint32>([1])` had no
   * type and an assignment of it was unchecked - the DECLARED path, before any
   * question of inferring one.
   */
  /**
   * Whether _t_ still mentions a type parameter.
   *
   * A call that supplies no type arguments binds nothing, and this proposal
   * does not yet infer a binding from the arguments, so a parameter or return
   * that names one is UNCONSTRAINED at such a call: comparing an argument
   * against a bare `T` would refuse `id(5)` for `function id<T>(v: T): T`,
   * which is the ordinary way a generic is called.
   */
  const mentionsTypeParameter = (t: Known): boolean => {
    if (!t) {
      return false;
    }
    if (t.Kind === 'parameter') {
      return true;
    }
    const withMembers = t as { Members?: readonly TypeRecord[] };
    if (withMembers.Members?.some((m) => mentionsTypeParameter(m))) {
      return true;
    }
    const withArgs = t as { Arguments?: readonly (TypeRecord | number)[] };
    if (withArgs.Arguments?.some((a) => typeof a !== 'number' && mentionsTypeParameter(a))) {
      return true;
    }
    const withElement = t as { Element?: TypeRecord };
    return !!withElement.Element && mentionsTypeParameter(withElement.Element);
  };

  /**
   * #sec-generic-functions: bind a signature's type parameters from the
   * ARGUMENTS of a call that supplies none explicitly.
   *
   * `id(5)` says what `T` is as plainly as `id.<uint8>(5)` does, and without
   * reading it the argument check has nothing to compare against and the call
   * has no Static Type. Matching walks the parameter type and the argument type
   * together and binds a parameter position to whatever stands opposite it; the
   * first binding for a name wins, since a later disagreement is the caller's
   * error rather than a reason to rebind.
   */
  const bindTypeParametersFromArguments = (
    parameters: readonly { Type?: Known }[],
    argumentTypes: readonly Known[],
    names: ReadonlySet<string>,
    into: Map<string, TypeRecord>,
  ): void => {
    const match = (param: Known, arg: Known): void => {
      if (!param || !arg) {
        return;
      }
      if (param.Kind === 'parameter') {
        const name = (param as { Name: string }).Name;
        if (names.has(name) && !into.has(name)) {
          into.set(name, widen(arg) as TypeRecord);
        }
        return;
      }
      const pArgs = (param as { Arguments?: readonly (TypeRecord | number)[] }).Arguments;
      const aArgs = (arg as { Arguments?: readonly (TypeRecord | number)[] }).Arguments;
      if (pArgs && aArgs) {
        pArgs.forEach((pa, i) => {
          const aa = aArgs[i];
          if (typeof pa !== 'number' && aa !== undefined && typeof aa !== 'number') {
            match(pa, aa);
          }
        });
        return;
      }
      const pEl = (param as { Element?: TypeRecord }).Element;
      const aEl = (arg as { Element?: TypeRecord }).Element;
      if (pEl && aEl) {
        match(pEl, aEl);
      }
    };
    parameters.forEach((p, i) => match(p.Type ?? null, argumentTypes[i] ?? null));
  };

  const substituteTypeParameters = (t: Known, bindings: ReadonlyMap<string, TypeRecord>): Known => {
    if (!t) {
      return t;
    }
    if (t.Kind === 'parameter') {
      return bindings.get((t as { Name: string }).Name) ?? t;
    }
    const withMembers = t as { Members?: readonly TypeRecord[] };
    if (withMembers.Members) {
      return {
        ...t,
        Members: withMembers.Members.map((m) => substituteTypeParameters(m, bindings) as TypeRecord),
      } as Known;
    }
    const withArgs = t as { Arguments?: readonly (TypeRecord | number)[] };
    if (withArgs.Arguments && withArgs.Arguments.length > 0) {
      return {
        ...t,
        Arguments: withArgs.Arguments.map((a) => (typeof a === 'number'
          ? a
          : substituteTypeParameters(a, bindings) as TypeRecord)),
      } as Known;
    }
    const withElement = t as { Element?: TypeRecord };
    if (withElement.Element) {
      return { ...t, Element: substituteTypeParameters(withElement.Element, bindings) as TypeRecord } as Known;
    }
    return t;
  };

  const effectiveFunctionType = (t: Known): Known => {
    if (!t || t.Kind !== 'function') {
      return t;
    }
    const sigs = t.Signatures as readonly { Return: Known, InferredReturn?: Known }[];
    if (!sigs.some((g) => !g.Return && g.InferredReturn)) {
      return t;
    }
    return {
      ...t,
      Signatures: sigs.map((g) => (g.Return || !g.InferredReturn ? g : { ...g, Return: g.InferredReturn })),
    } as unknown as Known;
  };

  const requireAssignable = (source: Known, target: Known) => {
    if (!source || !target) {
      return;
    }
    if (target.Kind === 'function') {
      // Reassigning from a helper that may answer null loses the narrowing the
      // early return above established, and every use below then reads as
      // possibly-null. The effective type of a non-null source is non-null.
      const effective = effectiveFunctionType(source);
      if (!effective) {
        return;
      }
      source = effective;
    }
    // #sec-primitive-metadata: two parameterizations of one base. Structurally
    // equivalent metadata is one type and passes below; different metadata is
    // the metadata subtype judgment's question, which consults `subtype` hooks
    // (user code), so this synchronous pass defers the pair to the checking
    // pass rather than deciding it. A mixed position, a parameterization
    // meeting its bare base, is the construction boundary (F33) and stays
    // outside this pass, which the erasure below preserves.
    if (source.Kind === 'parameterized' && target.Kind === 'parameterized'
        && displayType(source.Base) === displayType(target.Base)) {
      if (!IsAssignable(source, target)) {
        deferred.push({ source, target } as DeferredMetadataCheck);
      }
      return;
    }
    // proposal-runtime-types (#sec-ranges): assignability between range types.
    // The shapes are not related by name alone - every shape implements
    // `RangeBounds`, which is "the interface a consumer of an arbitrary range is
    // written against" - and the bounds reach a record as ordinals or as literal
    // records depending on how they were written, so both spellings compare.
    if (source && target && source.Kind === 'nominal' && target.Kind === 'nominal'
        && isRangeFamilyName(source.LibraryName) && isRangeFamilyName(target.LibraryName)) {
      // Every range satisfies `RangeBounds`, and a bare shape name with no
      // arguments constrains only the shape.
      if (target.LibraryName !== 'RangeBounds') {
        if (source.LibraryName !== target.LibraryName) {
          report(source, target);
          return;
        }
        for (let i = 1; i < target.Arguments.length; i += 1) {
          const want = boundOrdinalOf(target.Arguments[i]);
          const got = boundOrdinalOf(source.Arguments[i]);
          if (want !== null && got !== null && want !== got) {
            report(source, target);
            return;
          }
        }
      }
      // The element follows the ordinary rules, so a literal endpoint that fits
      // the annotated element type is admitted as it is anywhere else.
      const se = source.Arguments[0];
      const te = target.Arguments[0];
      if (typeof se !== 'number' && typeof te !== 'number' && se && te && !IsAssignable(se, te)
          && !literalFitsNumericType(se, te) && !SameType(se, te)) {
        report(source, target);
      }
      return;
    }
    const erasedSource = eraseMetadata(source);
    const erasedTarget = eraseMetadata(target);
    // #sec-contextual-types: a numeric literal within a numeric value type's
    // range converts losslessly at the boundary, so it is statically
    // assignable; the run-time boundary constructs the typed value.
    if (literalFitsNumericType(erasedSource, erasedTarget)) {
      return;
    }
    // A BigInt literal at a FLOAT family follows the checked rule the runtime
    // applies (F38): admitted exactly where the width represents it exactly,
    // an Early Error where it would round. An integer family stays reported:
    // exactness at the wide widths is the pinned prerequisite.
    // (Discriminated by the VALUE: staticType currently labels a BigInt
    // literal's Base as `number`, a mislabel F38 pins, so the Base name is
    // not the reliable half here.)
    if (erasedSource && erasedSource.Kind === 'literal'
        && erasedTarget && erasedTarget.Kind === 'primitive' && isFloatTypeName(erasedTarget.Name)
        && erasedSource.Value instanceof BigIntValue) {
      const big = R(erasedSource.Value) as bigint;
      const rounded = wrapToType(Number(big), erasedTarget);
      if (Number.isFinite(rounded) && BigInt(rounded) === big) {
        return;
      }
    }
    // proposal-runtime-types #sec-vector-lanes: the broadcast. "`vector.<T, N>`
    // declares a cast operator from T", so a value of the lane type is
    // assignable to the vector and fills every lane.
    //
    // This is stated HERE rather than in IsAssignable, and the difference is
    // the whole reason two earlier attempts were unsound. IsAssignable is
    // consulted by paths that then pass the value through unchanged, so
    // admitting the lane type there let a `float32` sit in a `float32x4`
    // binding unconverted. This site reports or does not report; the value it
    // governs still reaches requireMembership, which performs the conversion.
    if (erasedTarget.Kind === 'primitive' && erasedTarget.Name === 'vector'
        && erasedTarget.Arguments.length === 2
        && !(erasedSource.Kind === 'primitive' && erasedSource.Name === 'vector')) {
      // Only the LANE type converts, which is the refusal the clause states: a
      // `float32` reaches `float32x4` and not `float64x2`.
      const laneTarget = erasedTarget.Arguments[0] as TypeRecord;
      // A BIT VECTOR takes a whole integer, not a lane value: #sec-vector-lanes
      // has lane i of a `vector.<uint.<1>, N>` be bit i of an N-bit integer, so
      // `let a: boolean8 = 0b00000010` is a conversion of the number and not a
      // broadcast of it. Testing against the lane type would refuse it, since 2
      // is not a value of `uint.<1>`.
      if (isBitLaneType(laneTarget)) {
        const numeric = erasedSource.Kind === 'literal' ? eraseMetadata(erasedSource.Base as TypeRecord) : erasedSource;
        if (numeric.Kind === 'primitive' && (numeric.Name === 'uint' || numeric.Name === 'int' || numeric.Name === 'number')) {
          return;
        }
        if (erasedSource.Kind === 'literal'
            && typeof (erasedSource.Value as { numberValue?(): number })?.numberValue === 'function') {
          return;
        }
      }
      if (IsAssignable(erasedSource, laneTarget)) {
        return;
      }
      // A numeric LITERAL reaches the lane type the way it reaches any numeric
      // value type - `let a: float32x4 = 1` is the design's own example, and it
      // is the same admission that lets `let a: uint8 = 5` through. The literal
      // narrowing above returns before this branch, so the check is repeated
      // here against the lane rather than the vector.
      if (erasedSource.Kind === 'literal') {
        const literalToLane = eraseMetadata(erasedSource.Base as TypeRecord);
        const fitsLane = laneTarget.Kind === 'primitive'
          && typeof (erasedSource.Value as { numberValue?(): number })?.numberValue === 'function'
          && fitsNumericType(
            (erasedSource.Value as { numberValue(): number }).numberValue(),
            laneTarget.Name,
            laneTarget.Arguments,
          );
        if (IsAssignable(literalToLane, laneTarget) || fitsLane) {
          return;
        }
      }
      report(erasedSource, erasedTarget);
      return;
    }
    // The reverse bit-vector conversion, admitted for the same reason as the
    // forward one: a `vector.<uint.<1>, N>` reads back as the integer whose bit
    // i is lane i, so it is assignable to an integer type.
    if (erasedSource.Kind === 'primitive' && erasedSource.Name === 'vector'
        && erasedSource.Arguments.length === 2
        && isBitLaneType(erasedSource.Arguments[0] as TypeRecord)
        && erasedTarget.Kind === 'primitive'
        && (erasedTarget.Name === 'uint' || erasedTarget.Name === 'int')) {
      return;
    }
    if (!IsAssignable(erasedSource, erasedTarget)) {
      // sec-user-defined-conversions form 1: a constructor taking one parameter
      // of type S converts S to T. Reached only AFTER assignability fails, which
      // is both the clause's ordering and the ranking it needs - a value that
      // already fits is never routed through a user conversion, so declaring a
      // constructor cannot change which overload an existing call selects.
      if (convertingConstructorAccepts(erasedTarget, erasedSource)
        || declaresConversionTo(erasedSource, erasedTarget)
        || declaresInboundConversion(erasedTarget, erasedSource)) {
        return;
      }
      report(erasedSource, erasedTarget);
    }
  };

  // #sec-overload-resolution over the numeric library's listing
  // (table-numeric-library-signatures), driven statically. The listing's
  // structure collapses the general algorithm: every signature takes its
  // numeric parameters at ONE type and no numeric value type is assignable to
  // another, so a typed argument names the only viable family, two different
  // typed arguments are viable at no signature, and with no typed argument the
  // contextual type (#sec-contextual-types) selects the family through the
  // return filter, which is R8's specialized call. The Number signature is
  // every listed function's default: resolution to it types nothing and
  // records nothing, so an untyped program stays exactly as silent as before.
  const numericFamilyOf = (t: Known): (TypeRecord & { Kind: 'primitive' }) | 'bigint' | null => {
    if (!t || t.Kind !== 'primitive') {
      return null;
    }
    if (isIntegerTypeName(t.Name) || isFloatTypeName(t.Name) || t.Name === 'number') {
      return t;
    }
    return t.Name === 'bigint' ? 'bigint' : null;
  };

  const mathCallName = (call: ParseNode): string | null => {
    const m = (call as { CallExpression?: ParseNode }).CallExpression as { type?: string, MemberExpression?: ParseNode, IdentifierName?: { name: string } | null } | undefined;
    if (!m || m.type !== 'MemberExpression' || !m.MemberExpression || !m.IdentifierName) {
      return null;
    }
    if (m.MemberExpression.type !== 'IdentifierReference' || (m.MemberExpression as unknown as { name: string }).name !== 'Math') {
      return null;
    }
    // A locally bound `Math` shadows the intrinsic and is not the listing's; a
    // REPLACED global `Math` is not detectable here, the same corner the
    // name-based builtin type resolution already lives with.
    if (lookup('Math')) {
      return null;
    }
    const name = m.IdentifierName.name;
    return numericLibraryRows.has(name) ? name : null;
  };

  const pushCallError = (message: string, ...values: Value[]) => {
    const raise = Throw.TypeError as unknown as (m: string, ...vs: Value[]) => ThrowCompletion;
    const completion = raise(message, ...values);
    errors.push(completion.Value as ObjectValue);
  };

  const resolvedNumericCalls = new WeakSet<object>();
  const checkNumericCall = (call: ParseNode, contextual: Known): Known => {
    const name = mathCallName(call);
    if (!name) {
      return null;
    }
    if (resolvedNumericCalls.has(call)) {
      return (staticCallResolutions.get(call) as Known) ?? null;
    }
    resolvedNumericCalls.add(call);
    const allArgs = (call as { Arguments?: readonly ParseNode[] }).Arguments ?? [];
    const argNodes = allArgs.filter((a) => a.type !== 'AssignmentRestElement');
    let family: (TypeRecord & { Kind: 'primitive' }) | null = null;
    let sawBigint = false;
    let mixed = false;
    const literals: { value: number, record: TypeRecord }[] = [];
    let everyArgProven = allArgs.length === argNodes.length;
    for (const a of argNodes) {
      const t = staticType(a);
      if (t && t.Kind === 'literal') {
        const base = t.Base;
        if (base.Kind === 'primitive' && base.Name === 'number' && t.Value instanceof NumberValue) {
          literals.push({ value: R(t.Value) as number, record: t });
        } else if (base.Kind === 'primitive' && base.Name === 'bigint') {
          sawBigint = true;
        } else {
          everyArgProven = false;
        }
        continue;
      }
      const fam = numericFamilyOf(t);
      if (fam === 'bigint') {
        sawBigint = true;
      } else if (fam && fam.Name !== 'number') {
        if (family && displayType(family) !== displayType(fam)) {
          mixed = true;
        } else {
          family = fam;
        }
      } else {
        // A `number`-typed value belongs to the untyped signature, and an
        // unknown argument is ~any~: neither names a family nor proves the
        // call for recording.
        everyArgProven = false;
      }
    }
    if (sawBigint) {
      // The bigint column resolves at run time this cycle; F37 pins it.
      return null;
    }
    if (mixed) {
      // "Every signature takes its numeric parameters at one type."
      pushCallError('$1 has no signature taking values of two numeric types', Value(`Math.${name}`));
      return null;
    }
    const ctxCandidate = numericFamilyOf(contextual);
    const ctxFamily = ctxCandidate === 'bigint' ? null : ctxCandidate;
    const row = numericLibraryRows.get(name)!;
    const chosen = family ?? (ctxFamily && ctxFamily.Name !== 'number' ? ctxFamily : null);
    if (!chosen) {
      // The Number signature: silent and unrecorded, as today.
      return null;
    }
    const rowExists = isIntegerTypeName(chosen.Name) ? row.integer !== undefined : (isFloatTypeName(chosen.Name) && row.float);
    if (!rowExists) {
      if (family) {
        pushCallError('$1 has no signature taking a value of type $2', Value(`Math.${name}`), Value(displayType(chosen)));
      } else {
        pushCallError('$1 has no signature returning $2', Value(`Math.${name}`), Value(displayType(chosen)));
      }
      return null;
    }
    const returned: TypeRecord = row.integer === 'imul' && isIntegerTypeName(chosen.Name)
      ? (builtinTypeRecord('int32') as TypeRecord)
      : chosen;
    if (ctxFamily && displayType(returned) !== displayType(ctxFamily)) {
      // The contextual filter of ResolveOverload: no viable signature returns
      // what the position requires. This also covers a `number` context over a
      // value-typed argument, since `number` is assignable from no value type.
      pushCallError('$1 has no signature returning $2', Value(`Math.${name}`), Value(displayType(ctxFamily)));
      return null;
    }
    let literalsFit = true;
    for (const lit of literals) {
      // #sec-literal-overload-ranking: a literal argument takes the chosen
      // parameter's type where it can represent it, and is a type error where
      // it cannot; the plan's out-of-range-literal Early Error, uniformly.
      if (!fitsNumericType(lit.value, chosen.Name, chosen.Arguments)) {
        report(lit.record, chosen);
        literalsFit = false;
      }
    }
    if (!family && everyArgProven && literalsFit && argNodes.length > 0 && literals.length === argNodes.length) {
      staticCallResolutions.set(call, chosen);
    }
    return returned;
  };

  /**
   * Each element of an array literal against the element type, and the arity
   * against a FIXED extent. A spread contributes an unknown number of elements
   * of an unknown type, so it stops both judgments rather than being guessed
   * at - the alternative is reporting an arity the program does not have.
   */
  const checkArrayLiteralAgainst = (node: ParseNode.ArrayLiteral, target: TypeRecord & { Kind: 'array' }) => {
    const elements = node.ElementList ?? [];
    let spread = false;
    let count = 0;
    for (const el of elements) {
      if (!el || typeof el !== 'object') {
        continue;
      }
      if ((el as ParseNode).type === 'SpreadElement') {
        spread = true;
        walk(el as ParseNode);
        continue;
      }
      if ((el as ParseNode).type === 'Elision') {
        count += 1;
        continue;
      }
      count += 1;
      requireAssignable(staticTypeIn(el as ParseNode, target.Element), target.Element);
      walk(el as ParseNode);
    }
    // "A fixed extent `[N].<T>` requires the literal to have length N", which
    // the run time already enforces and the checker could not see.
    if (!spread && typeof target.Extent === 'number' && count !== target.Extent) {
      report({ Kind: 'array', Element: target.Element, Extent: count }, target);
    }
  };

  /**
   * Each member of an object literal against the property the target declares.
   * A member the target does not declare is left alone here: the freshness rule
   * of #sec-literal-freshness makes it an error, and that judgment is a
   * different one from this - it belongs with the rule that states it, not
   * bolted onto the member check.
   */
  /**
   * Whether an index signature's KEY type admits this property name. A `string`
   * signature admits every string key; a literal or union key type admits the
   * names it names. Written against the key TYPE rather than testing a value,
   * since this pass has a name and not a value to test.
   */
  const keyAdmittedBy = (key: string | SymbolValue, keyType: TypeRecord): boolean => {
    if (typeof key !== 'string') {
      return keyType.Kind === 'primitive' && keyType.Name === 'symbol';
    }
    if (keyType.Kind === 'primitive') {
      return keyType.Name === 'string';
    }
    if (keyType.Kind === 'literal') {
      const v = keyType.Value as { stringValue?(): string };
      return typeof v?.stringValue === 'function' && v.stringValue() === key;
    }
    if (keyType.Kind === 'union') {
      return keyType.Members.some((m) => keyAdmittedBy(key, m));
    }
    return false;
  };

  const checkObjectLiteralAgainst = (node: ParseNode.ObjectLiteral, target: TypeRecord & { Kind: 'object' }, fresh: boolean) => {
    for (const member of node.PropertyDefinitionList ?? []) {
      if (!member || (member as ParseNode).type !== 'PropertyDefinition') {
        walk(member as ParseNode);
        continue;
      }
      const def = member as unknown as {
        PropertyName?: { name?: string, value?: string } | null,
        AssignmentExpression?: ParseNode,
      };
      const key = memberKeyOf(def.PropertyName);
      const declared = key === undefined
        ? undefined
        : target.Properties.find((prop) => prop.key === key);
      if (declared && def.AssignmentExpression) {
        // PLAN-declarative-checker-facts.md phase 1b. A method's [[ThisType]]
        // is the SELF MARKER - "the receiver this method expects" - which has
        // no members, so a literal adopting it got a `this` that was typed and
        // unusable. The OWNER is what the marker stands for, and this is the
        // one place that knows it: the loop is walking `target`'s properties.
        //
        // Recorded rather than resolved into the signature: ANALYSIS-self-marker
        // -resolution.md rules that out, since [[ThisType]] is contravariant and
        // a real owner in the signature would refuse a richer class where a
        // narrower interface is wanted - the ordinary use of `implements`. The
        // marker stays the marker for every comparison; only the reading site
        // sees a structure.
        contextualThisOwners.set(def.AssignmentExpression, target as Known);
        requireAssignable(staticTypeIn(def.AssignmentExpression, declared.type), declared.type);
      }
      // #sec-literal-freshness: "an own property the expected type neither
      // declares nor admits through an index signature is a type error,
      // reported against the property". Checked HERE and not at the boundary,
      // because "freshness is a property of the literal and not of its type, so
      // it is lost the moment the value is bound to a name and read back" - the
      // literal is a fact about the syntax, and this is the only pass that sees
      // it. `f({ a: 1, b: 2 })` is checked freshly and `f(o)` is not.
      //
      // Without it "an all-optional shape is a supertype of nearly everything,
      // and width subtyping admits any literal against it, which is correct for
      // a value that reached the position through a binding and useless for one
      // written at the position".
      if (fresh && declared === undefined && key !== undefined
          && !target.IndexSignatures.some((ix) => keyAdmittedBy(key, ix.Key))) {
        const shown = typeof key === 'string' ? Value(key) : key;
        const completion = Throw.TypeError('$1 is not declared by $2', shown, Value(displayType(target))) as ThrowCompletion;
        errors.push(completion.Value as ObjectValue);
      }
      if (def.AssignmentExpression) {
        walk(def.AssignmentExpression);
      }
    }
  };

  /**
   * A bound argument's ordinal - `Bound.Closed` is 0 and `Bound.Open` is 1 -
   * whether it reached the record as the ordinal itself or as a literal record
   * carrying it, or null where the argument names no bound at all.
   */
  const boundOrdinalOf = (arg: TypeRecord | number | undefined): number | null => {
    if (typeof arg === 'number') {
      return arg;
    }
    const t = arg as { Kind?: string, Value?: { numberValue?(): number } } | undefined;
    if (t?.Kind === 'literal' && typeof t.Value?.numberValue === 'function') {
      return t.Value.numberValue();
    }
    return null;
  };

  /** The names #sec-ranges gives a range value; each carries its element first. */
  const isRangeFamilyName = (name: string | undefined): boolean => name === 'Range'
    || name === 'RangeFrom' || name === 'RangeTo' || name === 'RangeFull' || name === 'RangeBounds';

  /** The RETURN type a function literal's position wants, read by its own arm. */
  const contextualReturnTypes = new Map<ParseNode, Known>();
  /** The adopted `this` types of the literals currently being checked, innermost last. */
  const thisTypeFrames: Known[] = [];

  const staticTypeIn = (node: ParseNode | null | undefined, contextual: Known): Known => {
    if (!node) {
      return null;
    }
    // A FUNCTION LITERAL at a function-typed position takes that position's
    // RETURN type as the context for its body, just as it takes the position's
    // parameter types for its parameters. Without this the body is typed in
    // isolation and a literal inside it keeps its literal type: the return of
    // `() => ({ value: 1, done: false })` reads as an object of LITERAL types,
    // which is not assignable to `{ value: uint8, done: boolean }` however
    // plainly the program meant it. Recorded here, where a node meets its
    // contextual type, and read by the literal's own arm in `staticType`.
    if ((node.type === 'ArrowFunction' || node.type === 'FunctionExpression')
      && contextual && contextual.Kind === 'function' && contextual.Signatures.length === 1) {
      const wanted = contextual.Signatures[0].Return;
      if (wanted) {
        contextualReturnTypes.set(node, wanted as Known);
      }
      // PLAN-declarative-checker-facts.md phase 1. #sec-this-adoption: "Where a
      // non-arrow function literal's contextual type is a ~function~ type whose
      // applicable signature has a [[ThisType]], the literal adopts it: `this`
      // within the body has that type, and the literal's own signature has that
      // [[ThisType]]. An ARROW adopts nothing, since it has no `this` of its own
      // to give a type to, and the `this` it closes over is already typed where
      // it was written."
      //
      // Recorded here, where the node meets its contextual type, for the same
      // reason the return is: this operation is the only place that knows both.
      // The arrow is excluded at the recording rather than at the reading, so
      // that an arrow nested in an adopting literal sees the OUTER `this` by
      // finding no frame of its own - which is what closing over it means.
      const wantedThis = (contextual.Signatures[0] as { ThisType?: TypeRecord }).ThisType;
      if (wantedThis !== undefined && node.type === 'FunctionExpression') {
        contextualThisTypes.set(node, wantedThis as Known);
      }
    }
    // sec-new-expressions: `new.(...)` constructs the type its POSITION requires.
    // This operation is where a node meets its contextual type, so it is where
    // the type is recorded for evaluation to read - the runtime has no
    // contextual type of its own.
    if (node.type === 'TargetTypedNew') {
      if (!contextual || contextual.Kind === 'any') {
        // "a position that requires no type gives nothing to construct" - a
        // Syntax Error rather than an inference, because inferring the type
        // would be the binding-type inference this proposal does not perform.
        errors.push((Throw.SyntaxError('$1 requires a contextual type', Value('new.()')) as ThrowCompletion).Value as ObjectValue);
        return null;
      }
      if (contextual.Kind !== 'nominal') {
        report(contextual, contextual);
        return null;
      }
      targetTypedNewTypes.set(node as object, contextual);
      return contextual;
    }
    if (node.type === 'CallExpression') {
      // proposal-runtime-types #sec-overloading-on-return-type: "the contextual
      // type of a call is the type its position requires". This operation has
      // it and sees the call; the walk that RESOLVES overloads has the call and
      // not the type. Recording it on the node bridges them without threading a
      // target through every recursion of the walk - the walk reads it back
      // where it resolves, and a call in no contextual position simply has none.
      if (contextual) {
        (node as unknown as { ContextualType?: Known }).ContextualType = contextual;
      }
      const resolved = checkNumericCall(node, contextual);
      if (resolved) {
        return resolved;
      }
    }
    // An ARRAY or OBJECT literal takes its contextual type apart and checks
    // its parts against it. This is F37's standing pin, and until now the only
    // check on a literal's contents was the RUNTIME boundary: `let a:
    // [].<uint8> = [1, 300]` inside a never-called function raised nothing at
    // all, while `let x: uint8 = 300` had been an Early Error since Phase 3.
    // The two are the same mistake written at different depths.
    //
    // Recursing through staticTypeIn rather than staticType is what makes the
    // parts behave like the whole: an element adopts the element type by the
    // literal rule, a nested literal takes its own contextual type apart in
    // turn, and a numeric literal at a `bigint` element reads its source text
    // exactly as it does at a binding (F85).
    // proposal-runtime-types (#sec-ranges): a RANGE literal takes its contextual
    // type apart the way an array literal does. Its shape and bounds are its
    // own - the markers in the source fix them - but its ELEMENT type comes
    // from the position, which is literal propagation: `0..<10` at a
    // `ClosedOpenRange.<uint8>` is a range of `uint8`, not of `number`.
    //
    // Taking the element from the literal instead is what made an earlier
    // attempt at this reject correct programs: the endpoints' base is `number`,
    // so `let r: ClosedOpenRange.<uint8> = 0..<10` failed as
    // "ClosedOpenRange.<number> is not assignable to ClosedOpenRange.<uint8>".
    // proposal-runtime-types #sec-type-propagation-to-literals: `&&`, `||`, and
    // `??` produce one of their OPERANDS, so a contextual type applies to the
    // operands rather than to the operator. `const c: uint32 = x || 10` means
    // the `10` is a `uint32`, the same as `const c: uint32 = 10` does; typing
    // the operand in isolation instead made the result
    // `a literal type of number | uint.<32>` and refused the program at its own
    // annotation. The left operand takes the context too, since a conditional
    // default is written `x || 10` exactly where `x` is already of the wanted
    // type.
    if (node.type === 'LogicalANDExpression' || node.type === 'LogicalORExpression'
        || node.type === 'CoalesceExpression') {
      return logicalResultType(node, (part) => staticTypeIn(part, contextual), contextual);
    }
    if (node.type === 'ConditionalExpression') {
      // As for the short-circuit operators: the contextual type applies to the
      // ARMS, since it is an arm that is produced, so `let c: uint32 = b ? 1 : 2`
      // builds both literals at `uint32`.
      const c = node as unknown as { AssignmentExpression_a?: ParseNode, AssignmentExpression_b?: ParseNode };
      const a = staticTypeIn(c.AssignmentExpression_a as ParseNode, contextual);
      const b = staticTypeIn(c.AssignmentExpression_b as ParseNode, contextual);
      if (!a || !b) {
        return null;
      }
      // #sec-type-propagation-to-literals, as for a short-circuit operand: a
      // literal arm IS of the position's type where it fits, and a literal
      // inside the joined union would otherwise never meet the target.
      const adopt = (t: TypeRecord): TypeRecord => (contextual && t.Kind === 'literal'
        && (IsAssignable(t, contextual) || literalFitsNumericType(t, contextual))
        ? contextual
        : t);
      return joinTypes(adopt(a), adopt(b));
    }
    if (node.type === 'RangeExpression') {
      const r = node as ParseNode.RangeExpression;
      const contextualElement = contextual && contextual.Kind === 'nominal'
        && isRangeFamilyName(contextual.LibraryName)
        && typeof contextual.Arguments[0] !== 'number'
        ? (contextual.Arguments[0] as TypeRecord | undefined) ?? null
        : null;
      // The endpoints are checked against that element, so an out-of-range one
      // is caught here exactly as an array element is.
      const fromEndpoint = (n: ParseNode | null): TypeRecord | null => {
        const t = staticTypeIn(n as ParseNode | null, contextualElement);
        return t && t.Kind === 'literal' ? t.Base : t;
      };
      const start = fromEndpoint(r.RangeStart as ParseNode | null);
      const end = fromEndpoint(r.RangeEnd as ParseNode | null);
      const element = contextualElement ?? start ?? end;
      const ordinal = (bound: 'closed' | 'open' | null) => (bound === 'open' ? 1 : 0);
      if (!r.RangeStart && !r.RangeEnd) {
        return libraryTypeRecord('RangeFull', element ? [element] : []);
      }
      if (!element) {
        return null;
      }
      if (r.RangeStart && r.RangeEnd) {
        return libraryTypeRecord('Range', [element, ordinal(r.RangeStartBound), ordinal(r.RangeEndBound)]);
      }
      if (r.RangeStart) {
        return libraryTypeRecord('RangeFrom', [element, ordinal(r.RangeStartBound)]);
      }
      return libraryTypeRecord('RangeTo', [element, ordinal(r.RangeEndBound)]);
    }
    // #sec-static-type-of-an-expression: a use of an unannotated `const` whose
    // initializer is a compile-time numeric constant "produces the value the
    // initializer would have produced had it been written at that position". So
    // at a position that WANTS a numeric type, the use reports the initializer's
    // literal type and is judged exactly as the written literal is:
    // `const k = 300; let a: uint8 = k` is refused before the program runs,
    // where it previously reported at run time, and `const k = 3` still fits.
    //
    // Only where a contextual type asks. Elsewhere the binding keeps the ~any~
    // Static Type this proposal gives every unannotated one, so `Reflect.typeOf`
    // still reads the value and nothing else about the binding changes. A `let`
    // is excluded by the clause, and is excluded here: its frame records it
    // separately.
    if (contextual && node.type === 'IdentifierReference') {
      const useName = (node as unknown as { name?: string }).name;
      if (typeof useName === 'string') {
        for (let i = frames.length - 1; i >= 0; i -= 1) {
          const literal = frames[i].constLiteralTypes.get(useName);
          if (literal) {
            return literal;
          }
          if (frames[i].declaredNames.has(useName) || frames[i].letConstants.has(useName)) {
            break;
          }
        }
      }
    }
    if (node.type === 'ParenthesizedExpression') {
      const inner = (node as unknown as { Expression?: ParseNode }).Expression;
      if (inner && inner.type === 'ArrayLiteral' && contextual
          && (contextual.Kind === 'array' || contextual.Kind === 'tuple')) {
        return staticTypeIn(inner, contextual);
      }
    }
    if (node.type === 'ArrayLiteral' && contextual && contextual.Kind === 'tuple') {
      return null;
    }
    if (node.type === 'ArrayLiteral' && contextual && contextual.Kind === 'array') {
      checkArrayLiteralAgainst(node as ParseNode.ArrayLiteral, contextual);
      // The elements are checked above; the LITERAL still reports no type.
      //
      // Reporting the target instead manufactured assignability, and the
      // boundary was then elided as already-satisfied - so the conversion that
      // builds an Array carrying the element type never ran, and
      // `function f(): [].<uint8> { return [1]; }` handed back plain Numbers
      // while every neighbouring spelling converted. Reporting nothing leaves
      // the boundary in place, which is where the typed array is built.
      //
      // Withholding the type here rather than declaring the conversion
      // effectful is what keeps a widening VIEW an alias: `let wide: [].<any> =
      // narrow` has a source type of its own, is assignable, and is elided as
      // before, so a store through the wide view still reaches the narrow
      // array's storage and is checked against its element type
      // (#sec-array-types).
      return null;
    }
    if (node.type === 'ObjectLiteral' && contextual) {
      const shape = structureOf(contextual);
      if (shape && shape.Kind === 'object') {
        // Freshness applies to a STRUCTURAL type written at the position, and
        // is withheld in three places where the shape this pass can see is not
        // the whole of what the position admits:
        //
        // - `object`, which is the record `{ Kind: 'object', Properties: [],
        //   IndexSignatures: [] }` - indistinguishable from the empty shape
        //   `{}`, and refusing every property of a literal at `object` is far
        //   worse than not refusing one at `{}`;
        // - an INTERFACE, whose structure here does not carry what a `partial
        //   interface` contributes, so a member a partial declares reads as
        //   undeclared;
        // - a type carrying dependent refinements, where a `where` clause
        //   admits members the base shape does not list.
        //
        // Each is an incompleteness of the shape rather than of the rule, and
        // each is pinned by a test so the limit is recorded rather than assumed.
        const structural = contextual.Kind === 'object'
          && (shape.Properties.length > 0 || shape.IndexSignatures.length > 0)
          && (contextual as { Refinements?: readonly unknown[] }).Refinements === undefined;
        checkObjectLiteralAgainst(node as ParseNode.ObjectLiteral, shape, structural);
        return contextual;
      }
    }
    // A numeric LITERAL at a `bigint` contextual position is read from its
    // SOURCE TEXT rather than from the double the lexer produced. The rule was
    // bounded at 2**53 and refused beyond it, which never corrupted but meant
    // the `n` suffix was still required exactly where it is most tedious - the
    // large constants (F67). #sec-literalvalueintype converts from "the
    // mathematical value denoted by the literal", and the text is where that
    // value still exists.
    //
    // Marked as well as typed: the checker's answer and the run time's value
    // have to agree, so the same test that admits the literal records that its
    // evaluation must produce the BigInt. That is the elidable-annotation
    // channel again - the checker knows something at a node, and the run time
    // consults the mark.
    // A numeric LITERAL at a DECIMAL contextual position is read from its source
    // text too, and for a sharper reason than bigint's: the double is not
    // merely imprecise, it CANNOT REPRESENT THE ANSWER AT ALL, since `1.0` and
    // `1.00` are one double and two decimals.
    if (node.type === 'NumericLiteral' && contextual) {
      const width = decimalWidthOf(contextual);
      if (width !== undefined && typeof (node as ParseNode.NumericLiteral).SourceText === 'string') {
        decimalLiterals.set(node, width);
        return contextual;
      }
    }
    if (node.type === 'NumericLiteral' && contextual && bigintTarget(contextual)) {
      const exact = exactBigIntOf(node as ParseNode.NumericLiteral);
      if (exact !== null) {
        bigintLiterals.add(node);
        return { Kind: 'literal', Value: Value(exact), Base: makePrimitive('bigint') };
      }
    }
    // The same reading at a WIDE INTEGER position, and for the same reason the
    // decimal case gives: the double cannot represent the answer. `int64` has
    // values a double does not distinguish, so the literal's mathematical value
    // has to come from the text before the lexer rounded it.
    if (node.type === 'NumericLiteral' && contextual && isWideIntegerType(contextual as TypeRecord)) {
      const exact = exactBigIntOf(node as ParseNode.NumericLiteral);
      if (exact !== null) {
        const prim = contextual as TypeRecord & { Kind: 'primitive' };
        if (fitsNumericType(exact, prim.Name, prim.Arguments)) {
          // The TYPE is carried with the value so the literal evaluates straight
          // to a value OF it. Returning a BigInt and converting at the boundary
          // would be the tidier-looking route and is wrong: the checker may
          // ELIDE an annotation it has proved, and the raw BigInt would then be
          // the binding's value.
          wideIntegerLiterals.set(node, { value: exact, type: contextual as TypeRecord });
          return contextual;
        }
      }
    }
    return staticType(node);
  };

  const lookup = (name: string): Known => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const t = frames[i].bindings.get(name);
      if (t) {
        return t;
      }
    }
    return null;
  };

  /**
   * Whether a name is bound by the PROGRAM, and so shadows anything the engine
   * would otherwise resolve it to.
   *
   * `#sec-type-name-resolution`: a built-in type name resolves "through the
   * ordinary scope chain first and through the built-in table only where no user
   * binding of the name exists". The rule is there for compatibility - `string`,
   * `object` and their kin are among the most common identifiers in existing
   * code - and it applies to every name the engine binds, `Token` and the
   * `Reflect` namespace included.
   *
   * `PLAN-checker-type-resolution.md` stage A read its registry by written name
   * and never consulted scope, so the checker answered with the intrinsic where
   * the runtime, which walks the scope chain, answered with the binding. That is
   * a checker/runtime divergence about what an annotation MEANS - the defect that
   * plan exists to remove, reintroduced by it.
   *
   * Where a name IS shadowed the checker answers nothing rather than guessing:
   * it cannot know statically what a value binding holds, and the runtime
   * boundary already resolves it correctly. Abstaining is what makes the two
   * agree.
   */
  const shadowedByProgram = (name: string): boolean => {
    // `declaredNames`, not `bindings`: `declare` records a TYPE only where one is
    // known, and the shadow that matters most is exactly the one whose type is
    // not - `const Token = uint8;` binds the name while telling the checker
    // nothing about it. Asking `bindings` answers false for those and leaves the
    // divergence in place, which is what the first attempt at this did.
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      if (frames[i].declaredNames.has(name)) {
        return true;
      }
    }
    return false;
  };

  /**
   * The structural shape behind a type, where it has one: an object type is its
   * own, and a nominal type - a class or an interface - carries one in
   * [[Structure]]. Reading a member goes through here so that a class's fields
   * are visible WITHOUT making class assignability structural, which stays by
   * [[Declaration]] identity.
   */
  const structureOf = (t: Known): Known => {
    if (t && t.Kind === 'nominal') {
      const s = (t as unknown as { Structure?: TypeRecord }).Structure;
      return s ?? null;
    }
    return t;
  };

  /**
   * Class DECLARATIONS by name (F57), and their instance types built lazily and
   * memoized (F60). Lazily, because a class's structure now includes what it
   * INHERITS, and resolving heritage eagerly in declaration order would miss a
   * superclass declared later in the list or in an enclosing scope. The
   * in-progress set guards a heritage cycle, which is a ReferenceError at run
   * time but must not hang the checker.
   */
  const classNodes = new Map<string, ParseNode>();
  /**
   * Function declarations by name, for reading a BUILDER's contract.
   *
   * PLAN-where-on-methods.md, the assumed half. A contract's facts live on the
   * builder's |WhereClauses|, which are on its declaration node - and the
   * checker cannot reach a function OBJECT (it never touches the realm's
   * global), so the node is the only route. Collected the way `classNodes`
   * already is, and for the same reason: a callee may be declared after the
   * annotation that names it.
   */
  const functionNodes = new Map<string, ParseNode>();
  /**
   * A sealed class's direct subclasses, keyed by DECLARATION NODE.
   *
   * README: "A `sealed` class restricts `extends` to the module that declares
   * it. The set of direct subclasses is therefore FIXED AND KNOWN when the
   * module finishes evaluating" - so there is no `permits` clause to read and
   * the set is whatever this declaration list holds.
   *
   * Keyed by NODE rather than by name because a class instance type carries a
   * `Declaration`, not a `Name` - looking for a name is what made an earlier
   * attempt silently inert. Node identity also settles shadowing for free.
   */
  const sealedSubclasses = new Map<ParseNode, ParseNode[]>();
  /**
   * Interface declarations by name, and their structures (F61). The checker
   * resolved an interface name in a type position to NOTHING, so
   * `function f(i: I) { i.k = 300 }` was unchecked entirely - a bigger gap than
   * the one this cycle set out to close, which was only that a class did not
   * pick up the members of an interface it implements.
   */
  const interfaceNodes = new Map<string, ParseNode>();
  /** Alias declarations found by the name pre-pass, resolved on demand. */
  const aliasNodes = new Map<string, ParseNode>();
  /** `const k = Symbol(...)` bindings, by name: §6.6's unique symbol types. */
  const symbolConsts = new Map<string, ParseNode>();
  /**
   * One stable Symbol per symbol-`const` DECLARATION, minted for the checker's
   * own use. A Property Type Record's [[Key]] is "a String or a Symbol", so a
   * symbol-keyed member needs a Symbol to be keyed by - and a checker has no
   * access to the one the program will create at run time. Minting per
   * declaration gives the identity §6.6 asks for: two consts mint two symbols
   * and compare unequal, one const named twice resolves to one symbol and
   * compares equal, which is exactly the rule read where no value exists.
   */
  const symbolKeys = new Map<ParseNode, SymbolValue>();
  const symbolKeyFor = (declaration: ParseNode): SymbolValue => {
    let minted = symbolKeys.get(declaration);
    if (!minted) {
      minted = new SymbolValue(Value('symbol key'));
      symbolKeys.set(declaration, minted);
    }
    return minted;
  };
  /**
   * The comparable key a member name denotes: its literal text, or the minted
   * Symbol of the `const` a computed name resolves to. Shared by the interface
   * walk and the object-literal check so a declaration and a use agree by
   * construction rather than by two rules that must be kept in step (F58).
   */
  const memberKeyOf = (propertyName: { name?: string, value?: string, ComputedPropertyName?: { type?: string, name?: string } } | null | undefined): string | SymbolValue | undefined => {
    const literal = propertyName?.name ?? propertyName?.value;
    if (typeof literal === 'string') {
      return literal;
    }
    const computed = propertyName?.ComputedPropertyName;
    if (computed?.type === 'IdentifierReference' && typeof computed.name === 'string') {
      const declaration = symbolConsts.get(computed.name);
      if (declaration) {
        return symbolKeyFor(declaration);
      }
    }
    return undefined;
  };
  const interfaceTypeMemo = new Map<ParseNode, Known>();
  /**
   * proposal-runtime-types #sec-variance-static-semantics-early-errors: a
   * covariant parameter is well-formed only in OUTPUT positions and a
   * contravariant one only in INPUT positions, per #table-variance-positions -
   * a method return and a `readonly` field are output, a method parameter is
   * input, and a non-`readonly` field is BOTH, "so only an invariant parameter
   * may appear".
   *
   * This is the half that inference cannot have. A structural type derives its
   * variance from its members and so cannot be wrong about it; a DECLARATION is
   * a claim, and without this rule `interface Bad<out T> { value: T }` would
   * readmit by declaration exactly the unsoundness #sec-isobjectsubtype refuses
   * structurally - a write through the wider view into a slot the narrower view
   * believes holds something else.
   */
  const mentionsTypeName = (node: ParseNode | null | undefined, name: string): boolean => {
    if (!node || typeof node !== 'object') {
      return false;
    }
    const n = node as { type?: string, TypeName?: { IdentifierReference?: { name?: string } } };
    if (n.type === 'TypeReference' && n.TypeName?.IdentifierReference?.name === name) {
      return true;
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'location') {
        continue;
      }
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        if (child.some((c) => mentionsTypeName(c as ParseNode, name))) {
          return true;
        }
      } else if (child && typeof child === 'object' && 'type' in (child as object)
        && mentionsTypeName(child as ParseNode, name)) {
        return true;
      }
    }
    return false;
  };

  const checkVariancePositions = (declaration: ParseNode): void => {
    const d = declaration as unknown as {
      TypeParameters?: { TypeParameterList?: readonly { Variance?: string, BindingIdentifier?: { name?: string } }[] },
      InterfaceMemberList?: readonly ParseNode[] | null,
    };
    const params = d.TypeParameters?.TypeParameterList ?? [];
    for (const param of params) {
      const variance = param.Variance;
      const name = param.BindingIdentifier?.name;
      if (!variance || !name) {
        continue;
      }
      for (const member of d.InterfaceMemberList ?? []) {
        const tm = member as unknown as {
          type?: string,
          Readonly?: boolean,
          TypeAnnotation?: ParseNode.TypeAnnotation | null,
          MethodSignature?: { FunctionTypeParameterList?: readonly ParseNode[] | null, TypeAnnotation?: ParseNode.TypeAnnotation | null } | null,
        };
        if (tm.type !== 'TypeMember') {
          continue;
        }
        if (tm.MethodSignature) {
          // A method RETURN is output; a method PARAMETER is input.
          if (variance === 'contravariant' && mentionsTypeName(tm.MethodSignature.TypeAnnotation?.Type as ParseNode, name)) {
            pushCallError(`the contravariant type parameter "${name}" appears in an output position`);
          }
          if (variance === 'covariant') {
            for (const fp of tm.MethodSignature.FunctionTypeParameterList ?? []) {
              if (mentionsTypeName(fp, name)) {
                pushCallError(`the covariant type parameter "${name}" appears in an input position`);
              }
            }
          }
          continue;
        }
        if (!mentionsTypeName(tm.TypeAnnotation?.Type as ParseNode, name)) {
          continue;
        }
        // A field: `readonly` is output, and a writable one is ~both~, which
        // admits an invariant parameter only.
        if (!tm.Readonly) {
          pushCallError(`the ${variance} type parameter "${name}" appears in a writable field, which admits only an invariant parameter`);
        } else if (variance === 'contravariant') {
          pushCallError(`the contravariant type parameter "${name}" appears in an output position`);
        }
      }
    }
  };

  const interfaceTypeOf = (name: string): Known => {
    const node = interfaceNodes.get(name);
    if (!node) {
      return null;
    }
    const memo = interfaceTypeMemo.get(node);
    if (memo !== undefined) {
      return memo;
    }
    // #sec-type-alias-declarations lets a type refer to itself, and an
    // interface may do the same. The memo is published BEFORE the members are
    // walked so that a member naming this interface lands on it; publishing it
    // afterwards meant `interface I { next: I | null }` re-entered here for
    // every member and exhausted the host stack, which - since this runs at
    // check time - took the process down before any of the program ran.
    // Identity is by [[Declaration]], so the record handed out here is the
    // same type the completed one denotes; only its members are filled in
    // later, and they are filled into the array this record already holds.
    const Properties: { key: string, type: TypeRecord, optional: boolean, readonly?: boolean, writeType?: TypeRecord, protected?: boolean }[] = [];
    const inProgress = {
      Kind: 'nominal',
      Declaration: node,
      Arguments: [],
      Structure: { Kind: 'object', Properties, IndexSignatures: [] },
    } as unknown as Known;
    interfaceTypeMemo.set(node, inProgress);
    const decl = node as unknown as {
      InterfaceMemberList?: readonly ParseNode[] | null,
      TypeParameters?: { TypeParameterList?: readonly ParseNode[] } | null,
    };
    // PLAN-generic-interface-membership.md phase 1b (checker half). The same
    // erasure as the runtime's, in a separate structure: the checker keeps its
    // own `interfaceTypeMemo`, so `T` has to be in scope HERE too or the
    // checking pass compares against `{ x: any }` exactly as membership did.
    const ifaceParamNames = (decl.TypeParameters?.TypeParameterList ?? [])
      .map((tp) => (tp as { BindingIdentifier?: { name?: string } })?.BindingIdentifier?.name)
      .filter((n): n is string => typeof n === 'string');
    if (ifaceParamNames.length > 0) {
      typeParameterScopes.push(scopeOfNames(ifaceParamNames));
    }
    try {
    for (const member of decl.InterfaceMemberList ?? []) {
      if (member.type !== 'TypeMember') {
        continue;
      }
      const tm = member as unknown as {
        PropertyName?: { name?: string, value?: string } | null,
        Optional?: boolean,
        TypeAnnotation?: ParseNode.TypeAnnotation | null,
        MethodSignature?: { FunctionTypeParameterList?: readonly ParseNode[] | null, TypeAnnotation?: ParseNode.TypeAnnotation | null } | null,
        Readonly?: boolean,
      };
      const key = memberKeyOf(tm.PropertyName);
      if (key !== undefined && typeof key !== 'string') {
        // A SYMBOL-keyed member, keyed by the minted Symbol of the `const` its
        // computed name resolves to. Recorded like any other member from here
        // on, which is what lets a use site be compared against it.
        const memberType = tm.TypeAnnotation ? resolveType(tm.TypeAnnotation.Type) : null;
        if (memberType) {
          // The `readonly` flag rides along: an interface's structural form is
          // an ~object~ Type Record (#sec-object-types), so a member declared
          // readonly must reach the same rules an inline object type's does -
          // identity, depth covariance, and the write refusal. Dropping it here
          // made `interface I { readonly x: uint8 }` accept a write that the
          // inline spelling refused.
          Properties.push({ key: key as unknown as string, type: memberType, optional: !!tm.Optional, readonly: !!(tm as { Readonly?: boolean }).Readonly });
        }
        continue;
      }
      if (typeof key !== 'string') {
        // A COMPUTED key. §6.6 types one whose expression is a symbol literal -
        // a `const` bound to `Symbol(...)` - and nothing else can be typed at
        // all: a `let`, a parameter, or any other expression has no identity a
        // checker can compare. TypeScript refuses exactly this case ("A
        // computed property name in an interface must refer to an expression
        // whose type is a literal type or a 'unique symbol' type"), and
        // refusing is what makes the rule TOTAL - every member that is declared
        // is one the checker can judge, rather than some being declared and
        // unjudgeable, which reads as support.
        const computed = (tm.PropertyName as { ComputedPropertyName?: { type?: string, name?: string } } | null | undefined)?.ComputedPropertyName;
        // "a literal type OR a unique symbol type": a written string or number
        // is a literal type as much as a `const` symbol is, so `["s"]` and `[1]`
        // are as judgeable as `s` and `1` - they are the same member spelled
        // through brackets.
        const isWrittenLiteral = computed?.type === 'StringLiteral' || computed?.type === 'NumericLiteral';
        const namesSymbolConst = computed?.type === 'IdentifierReference'
          && typeof computed.name === 'string' && symbolConsts.has(computed.name);
        if (computed && !namesSymbolConst && !isWrittenLiteral) {
          const completion = Throw.TypeError('a computed member name must be a literal or a `const` bound to a Symbol') as ThrowCompletion;
          errors.push(completion.Value as ObjectValue);
        }
        continue;
      }
      if (tm.MethodSignature) {
        const Parameters: ParameterRecord[] = [];
        for (const p of tm.MethodSignature.FunctionTypeParameterList ?? []) {
          const ann = (p as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
          Parameters.push(parameter((ann ? resolveType(ann.Type) : null) ?? anyTypeRecord));
        }
        const Return = tm.MethodSignature.TypeAnnotation ? resolveType(tm.MethodSignature.TypeAnnotation.Type) : null;
        Properties.push({
          key,
          type: { Kind: 'function', Signatures: [{ Parameters, Return, Untyped: false, ThisType: selfThisType }] } as unknown as TypeRecord,
          optional: tm.Optional === true,
          // A METHOD is an OUTPUT position, which #sec-variance-annotations says
          // in as many words: "a covariant parameter is well-formed only where
          // it appears in output positions of the declaration, A METHOD RETURN
          // OR A `readonly` FIELD". So a method member is compared the way a
          // readonly one is - by IsSubtype, which is what lets function
          // subtyping decide its own variance - rather than by the invariance
          // #sec-isobjectsubtype requires of a WRITABLE data member.
          //
          // Without this, making writable members invariant refused a generator
          // where an `Iterable.<uint8>` was required, because the two agree on
          // that method through function subtyping and not by identity.
          readonly: true,
        });
        continue;
      }
      const t = tm.TypeAnnotation ? resolveType(tm.TypeAnnotation.Type) : null;
      if (t) {
        Properties.push({ key, type: t, optional: tm.Optional === true, readonly: !!(tm as { Readonly?: boolean }).Readonly });
      }
    }
    } finally {
      if (ifaceParamNames.length > 0) {
        typeParameterScopes.pop();
      }
    }
    // `Properties` is the array inside the record published above, filled in
    // place by the loop, so the published record is already the finished one.
    return inProgress;
  };
  const classTypeMemo = new Map<ParseNode, Known>();
  /** Class EXPRESSIONS seen by the walk, which no name registers - task A. */
  const classExpressionNodes = new Set<ParseNode>();
  const classTypesInProgress = new Set<ParseNode>();
  const classTypeOf = (name: string): Known => {
    const node = classNodes.get(name);
    return node ? instanceTypeOf(node) : null;
  };
  /**
   * proposal-runtime-types: an ENUM name used as a TYPE.
   *
   * The bare-|TypeReference| resolver consulted seven sources and no enum one,
   * so `function f(e: E)` gave the binding NO static type - which is why the
   * exhaustiveness check reaches enums by a NAME lookup on the binding rather
   * than by the subject's type, and why a `match` over an enum-typed value that
   * is not a plain identifier was never checked at all.
   *
   * MEMOIZED by declaration node, because `instanceTypeOf` is: a class has one
   * record per declaration, and an enum resolved freshly on each mention would
   * give the checker two records for one enum where the runtime has one.
   */
  // Carried across entries as well, and for the reason stated where it is
  // declared: an enum resolved freshly on each mention would give the checker two
  // records for one enum. Across entries the same holds - without this a later
  // entry resolves an enum name declared earlier to nothing.
  const enumNodes = session ? session.enumNodes : new Map<string, ParseNode>();
  const enumTypeMemo = new Map<ParseNode, Known>();
  const enumTypeOf = (name: string): Known => {
    const node = enumNodes.get(name);
    if (!node) {
      return null;
    }
    const memo = enumTypeMemo.get(node);
    if (memo !== undefined) {
      return memo;
    }
    const decl = node as unknown as {
      EnumMemberList?: readonly { Initializer?: ParseNode }[],
      TypeAnnotation?: { Type: ParseNode.Type },
    };
    // proposal-runtime-types #sec-enums: the members' VALUES, computed the way
    // enum evaluation computes them - an initializer's value, or the previous
    // numeric value plus one, starting at 0.
    //
    // These were previously all `undefined`, one per member, which counted the
    // members correctly and identified none of them. Since membership against
    // an enum is SameValue over this list, nothing was ever a member as far as
    // the checker was concerned, and so EVERY initializer of an enum-typed
    // binding was refused - `let x: E = 0` no less than `let x: E = 5` - while
    // the runtime, whose record carries real values, answered `0 is E`
    // correctly. An initializer the checker cannot read statically stays
    // undefined and simply matches nothing, which is imprecise rather than
    // wrong.
    const memberValues: (Value | undefined)[] = [];
    let nextAuto = 0;
    for (const member of decl.EnumMemberList ?? []) {
      let v: Value | undefined;
      if (member.Initializer) {
        const initializerType = staticType(member.Initializer as ParseNode);
        v = initializerType && initializerType.Kind === 'literal' ? initializerType.Value : undefined;
      } else {
        v = Value(nextAuto);
      }
      if (v instanceof NumberValue) {
        nextAuto = Number(v.numberValue()) + 1; // eslint-disable-line @engine262/mathematical-value -- a member's ordinal, not a mathematical value in the spec sense
      } else {
        nextAuto += 1;
      }
      memberValues.push(v);
    }
    const built: Known = {
      Kind: 'nominal',
      Declaration: node,
      Arguments: [],
      EnumMembers: memberValues,
      // An enum is a subtype of its underlying type (#sec-enums), which the
      // relation in IsSubtype can only apply if the record carries it.
      Underlying: decl.TypeAnnotation
        ? resolveType(decl.TypeAnnotation.Type) ?? undefined
        : builtinTypeRecord('number') ?? undefined,
    } as unknown as Known;
    enumTypeMemo.set(node, built);
    return built;
  };
  /** Construct signatures by class node, for checking `new C(...)` (F59). */
  const constructSignatures = new Map<ParseNode, { Parameters: ParameterRecord[] }>();

  const resolvingAliases = new Set<string>();
  const lookupAlias = (name: string): Known => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const t = frames[i].aliases.get(name);
      if (t) {
        return t;
      }
    }
    // Not yet WALKED, but declared. A function declaration's signature is built
    // before the walk reaches the alias that annotates a parameter, so the frame
    // is empty and the parameter became ~any~ - which is what made an
    // alias-typed parameter accept an out-of-range literal where the inline
    // spelling refused it. The pre-pass found the declaration; resolve it here.
    const node = aliasNodes.get(name);
    if (node !== undefined && !resolvingAliases.has(name)) {
      // An alias naming itself would otherwise recur forever; the walk's own
      // registration handles a legitimate recursive type by publishing a
      // placeholder first.
      resolvingAliases.add(name);
      try {
        const declared = (node as unknown as { Type?: ParseNode.Type | null }).Type;
        if (!declared) {
          return null;
        }
        // PLAN-declarative-checker-facts.md phase 2. A |ComputedType| -
        // `type G = makeG();` - resolves by EVALUATING, not by walking, so
        // `resolveType` below cannot answer for one and answers ~any~ instead:
        // the annotation admitted everything and the bad value was refused at
        // run time, where the inline spelling refuses it here.
        //
        // The evaluation has already happened. The pass pre-evaluates this
        // source text's type declarations before it walks (check-pass.mts), and
        // it runs after GlobalDeclarationInstantiation, so a callee declared in
        // the same text is initialized by then - which is why the
        // pre-evaluation SUCCEEDS and there is an answer to read.
        if (declared.type === 'ComputedType') {
          const evaluated = resolvedAlias(
            surroundingAgent.currentRealmRecord as unknown as object,
            name,
          ) as Known;
          if (evaluated) {
            return evaluated;
          }
        }
        const resolved = resolveType(declared);
        // An alias carrying WHERE CLAUSES is a nominal type wrapping its
        // structure, not the structure itself - that wrapper is where the
        // refinements live, and the discriminated-chain and freshness rules read
        // them off it. Resolving the bare type here would answer a structurally
        // equal record that has forgotten them, which is worse than answering
        // nothing: it looks right and refuses valid programs.
        const whereClauses = (node as unknown as { WhereClauses?: readonly unknown[] }).WhereClauses;
        if (whereClauses && whereClauses.length > 0) {
          return {
            Kind: 'nominal', Declaration: node, Arguments: [], Structure: resolved,
          } as unknown as Known;
        }
        return resolved;
      } finally {
        resolvingAliases.delete(name);
      }
    }
    // PLAN-declarative-checker-facts.md phase 2. Nothing in THIS source text
    // answers: either the alias is only mentioned here and declared elsewhere,
    // or its Type is a |ComputedType| - `type G = makeG();` - which resolves by
    // EVALUATING rather than by walking, so no walk of it can answer. Where
    // that evaluation has already happened in this realm the record is
    // published under the alias's name, and reading it is what keeps an
    // annotation of `G` from degrading to ~any~.
    //
    // LAST, deliberately. A declaration in this text wins over a name the realm
    // happens to carry, so a source text that redeclares an alias is judged
    // against its own and not against an earlier text's.
    const published = resolvedAlias(
      surroundingAgent.currentRealmRecord as unknown as object,
      name,
    ) as Known;
    if (published) {
      return published;
    }
    return null;
  };

  // The enum declaration named `name`, if one is in scope.
  const lookupEnum = (name: string): EnumInfo | null => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const e = frames[i].enums.get(name);
      if (e) {
        return e;
      }
    }
    return null;
  };

  // The enum a binding holds an enumerator of, if it is known to.
  /**
   * The enumerators a `switch` covers, and which enum it is over.
   *
   * PLAN-do-expressions.md: extracted so that the coverage is computed ONCE.
   * It was inline in the SwitchStatement walk, which is where the diagnostics
   * are raised, and completionTypeOf needed the same answer - a second copy
   * would have been a second thing to keep in step, and the two would have
   * disagreed the first time either moved.
   */
  const switchEnumCoverage = (n: ParseNode): { enumName: string, names: readonly string[], covered: Set<string>, invalid: { shown: string }[] } | null => {
    const sw = n as { Expression?: ParseNode, CaseBlock?: { CaseClauses_a?: readonly ParseNode[], CaseClauses_b?: readonly ParseNode[], DefaultClause?: ParseNode | null } };
    const disc = sw.Expression;
    const discName = disc && disc.type === 'IdentifierReference' ? (disc as { name: string }).name : null;
    const enumName = discName ? lookupEnumBinding(discName) : null;
    const info = enumName ? lookupEnum(enumName) : null;
    if (!info || !enumName) {
      return null;
    }
    const clauses = [
      ...(sw.CaseBlock?.CaseClauses_a ?? []),
      ...(sw.CaseBlock?.CaseClauses_b ?? []),
    ];
    const covered = new Set<string>();
    const invalid: { shown: string }[] = [];
    for (const clause of clauses) {
      const label = (clause as { Expression?: ParseNode }).Expression;
      let member: string | null = null;
      let labelEnum: string | null = null;
      if (label && label.type === 'MemberExpression') {
        const m = label as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null };
        if (m.MemberExpression && m.MemberExpression.type === 'IdentifierReference' && m.IdentifierName) {
          labelEnum = (m.MemberExpression as { name: string }).name;
          member = m.IdentifierName.name;
        }
      }
      if (member === null || labelEnum !== enumName || !info.names.includes(member)) {
        invalid.push({ shown: member !== null && labelEnum !== null ? `${labelEnum}.${member}` : 'a non-enumerator case' });
      } else {
        covered.add(member);
      }
    }
    return {
      enumName, names: info.names, covered, invalid,
    };
  };

  /**
   * Whether a `switch` covers every value its discriminant can take.
   *
   * #sec-completiontypeof reads this to decide whether a switch tail
   * contributes `undefined`, and the design reserves the word to enums and
   * sealed hierarchies - deliberately narrower than the atoms a `match` reads,
   * so a switch over a `boolean` is not exhaustive for this purpose.
   */
  const switchCoversDiscriminant = (n: ParseNode): boolean => {
    const block = (n as { CaseBlock?: { DefaultClause?: ParseNode | null } }).CaseBlock;
    if (block?.DefaultClause) {
      return true;
    }
    const coverage = switchEnumCoverage(n);
    if (!coverage) {
      return false;
    }
    return coverage.names.every((nm) => coverage.covered.has(nm));
  };

  const lookupEnumBinding = (name: string): string | null => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const e = frames[i].enumBindings.get(name);
      if (e) {
        return e;
      }
    }
    return null;
  };

  // The statically resolvable subset of types: built-ins and aliases declared
  // in the program. An unresolvable type is unknown, and unknown is ~any~.
  const resolveType = (node: ParseNode.Type): Known => {
    // table-metadata-values: a RANGE in type position. This resolver "mirrors
    // TypeNodeToTypeRecord so the checker and the runtime agree on what the
    // annotation means", and the range row reached the runtime resolver and not
    // this one - so `float64.<{ bounds: 0..<100 }>` resolved to NOTHING here,
    // and with it every parameterization whose metadata carries a range. Two
    // resolvers disagreeing is invisible until something asks the checker what
    // such an annotation means, which is why it went unnoticed.
    if ((node as ParseNode).type === 'RangeType') {
      const r = node as unknown as ParseNode.RangeType;
      const endpoint = (lit: ParseNode.LiteralType | null): Value | undefined => {
        if (lit === null) {
          return undefined;
        }
        const raw = lit.negated && typeof lit.value === 'number' ? -lit.value : lit.value;
        return Value(raw as never);
      };
      return {
        Kind: 'range',
        Start: endpoint(r.RangeTypeStart),
        End: endpoint(r.RangeTypeEnd),
        StartBound: r.RangeTypeStartBound ?? undefined,
        EndBound: r.RangeTypeEndBound ?? undefined,
      } as unknown as TypeRecord;
    }
    switch (node.type) {
      case 'TypeReference': {
        if (node.TypeName.MemberNames.length > 0 || node.TypeArguments) {
          const args: (TypeRecord | number)[] = [];
          if (node.TypeName.MemberNames.length > 0) {
            // A QUALIFIED name - `Reflect.Block`. This answered null
            // unconditionally, and a null type is treated as no constraint, so
            // every annotation naming one was silently never compared:
            // `PLAN-checker-type-resolution.md stage A`, R2.
            //
            // Resolved from the registry the intrinsics fill as they bind these
            // names, so the checker gets the SAME record the runtime walks the
            // binding to reach, rather than a second one built here. Type
            // ARGUMENTS on a qualified name are still out of reach and keep the
            // old answer.
            if (!node.TypeArguments) {
              // The BASE name decides: `Reflect.Block` means the intrinsic only
              // where the program has not bound `Reflect` itself.
              const base = node.TypeName.IdentifierReference.name;
              if (shadowedByProgram(base)) {
                return null;
              }
              const written = [base, ...node.TypeName.MemberNames.map((m) => m.name)].join('.');
              return (BoundTypeRecordForName(written) as Known | undefined) ?? null;
            }
            return null;
          }
          for (const a of node.TypeArguments!.TypeArgumentList) {
            const r = resolveType(a);
            if (!r) {
              return null;
            }
            let arg: TypeRecord | number = r;
            if (r.Kind === 'literal' && r.Value instanceof NumberValue) {
              arg = R(r.Value);
            }
            args.push(arg);
          }
          // #sec-parameterized-types: a primitive whose one type argument is an
          // object type is a metadata parameterization, `float32.<{ m: 1 }>`.
          // Mirrors TypeNodeToTypeRecord so the checker and the runtime agree on
          // what the annotation means; before this, builtinTypeRecord dropped the
          // object argument and every parameterization looked to this pass like
          // its bare base, which is why the metadata subtype judgment had no
          // static site.
          if (args.length === 1 && typeof args[0] !== 'number' && (args[0] as TypeRecord).Kind === 'object') {
            const base = builtinTypeRecord(node.TypeName.IdentifierReference.name);
            if (base && base.Kind === 'primitive') {
              const metadata = MetadataObjectFromType(args[0] as TypeRecord);
              const record: TypeRecord = { Kind: 'parameterized', Base: base, Metadata: metadata as unknown as MetadataRecord };
              const keys = Object.keys(metadata as unknown as Record<string, unknown>);
              // table-metadata-values: the value language is CLOSED - "Nothing
              // else is a metadata value. A function, an object other than the
              // forms above, and *undefined* are not." A property whose type is
              // none of the admitted forms is DROPPED by
              // `MetadataObjectFromType`, so `float64.<{ bounds: SomeClass }>`
              // was accepted and carried no bounds at all. The drop is
              // observable as a missing key, which finds it without writing the
              // form list twice.
              //
              // Only where the argument was WRITTEN INLINE. A parameterization's
              // object-typed argument is two things in one shape: a metadata
              // record, `float64.<{ bounds: 0..<10 }>`, whose properties must be
              // metadata values; and a type argument to a generic,
              // `Composite.<K>`, whose properties are ordinary types. The parser
              // already tells them apart - an inline record is an `ObjectType`
              // node and a name is a `TypeReference` - and the record they
              // resolve to does not.
              const argNode = node.TypeArguments!.TypeArgumentList[0] as ParseNode | undefined;
              if (argNode?.type === 'ObjectType') {
                for (const prop of (args[0] as TypeRecord & { Kind: 'object' }).Properties) {
                  if (typeof prop.key === 'string' && !(prop.key in (metadata as unknown as Record<string, unknown>))) {
                    report(prop.type, record);
                  }
                }
              }
              if (keys.length > 0) {
                unclaimed.push({ node, display: displayType(record), base, keys });
              }
              return record;
            }
          }
          // proposal-runtime-types: a parameterized type reference is a builtin
          // numeric (`int.<8>`) or a library type (`RegExp.<C, G>`, `Promise.<T>`,
          // `Map.<K, V>`). Without the library fallback a `RegExp.<C, G>` annotation
          // resolves to nothing here and its capture checking never runs.
          const parameterizedName = node.TypeName.IdentifierReference.name;
          // proposal-runtime-types: `Identity.<T>` REDUCES to T rather than
          // describing a shape, which is what makes it an alias and not one of
          // the iteration interfaces. It is consulted before them for that
          // reason - it answers with its argument, not with a record named
          // Identity - and only when applied, so a bare `Identity` stays a
          // declaration a higher-kinded parameter can bind.
          if (parameterizedName === 'Identity' && !lookupAlias(parameterizedName)) {
            const reduced = identityRecord(args);
            if (reduced) {
              return reduced;
            }
          }
          const builtinOrLibrary = builtinTypeRecord(parameterizedName, args)
            ?? iterationInterfaceRecord(parameterizedName, args)
            ?? libraryTypeRecord(parameterizedName, args);
          if (builtinOrLibrary) {
            return builtinOrLibrary;
          }
          // proposal-runtime-types #sec-generics: a USER class applied in an
          // annotation - `A.<uint16>` - reached none of the above and resolved
          // to nothing, so the arguments were dropped on this side too. Both
          // sides dropping them is why `const x: A.<uint16> = new A.<uint8>()`
          // matched: two empty argument lists agree.
          const userClass = classTypeOf(parameterizedName);
          if (userClass && userClass.Kind === 'nominal') {
            // proposal-runtime-types #sec-higher-kinded-parameters: this is the
            // resolver a type ANNOTATION reaches, and the runtime's is the one
            // a `const` reaches. Both attach arguments and both must validate
            // them, through the one helper - a rule enforced in one and not the
            // other is a rule that holds in some positions.
            const bad = badKindedArgument(userClass, args);
            if (bad) {
              // The specific diagnostics, not the generic assignability one.
              // "uint8 is not assignable to Box" is true and useless: the
              // mistake is that a higher-kinded parameter was given something
              // that is not a declaration, or one of the wrong arity, and a
              // reader needs to be told which.
              const completion = (bad.kind === 'not-generic'
                ? Throw.TypeError(
                  '$1 is not a generic declaration; $2 expects one taking $3 type arguments',
                  Value(displayType(bad.argument)), Value(bad.parameter), Value(String(bad.wanted)),
                )
                : Throw.TypeError(
                  '$1 takes $2 type arguments; $3 expects one taking $4',
                  Value(displayType(bad.argument)), Value(String(bad.supplied)),
                  Value(bad.parameter), Value(String(bad.wanted)),
                )) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
              return null;
            }
            return CanonicalizeType({ ...userClass, Arguments: args });
          }
          return userClass;
        }
        const name = node.TypeName.IdentifierReference.name;
        // #sec-generic-functions: a name a generic declaration BINDS denotes
        // that type parameter for the whole of the declaration - its parameter
        // annotations, its return annotation, and its body. Without this a bare
        // `T` resolved to nothing at all, so `function first<T>(): T {}` had no
        // return type to read and a call of it was unchecked however completely
        // it was annotated. Consulted first, because an inner binding shadows.
        if (typeParameterInScope(name)) {
          // #sec-issubtype: a parameter is a subtype of its constraint, so the
          // record has to carry one for that step to fire.
          const constraint = typeParameterConstraintOf(name);
          return (constraint
            ? { Kind: 'parameter', Name: name, Constraint: constraint }
            : { Kind: 'parameter', Name: name }) as Known;
        }
        // `BoundTypeRecordForName` covers `Token` and the 27 metadata interfaces,
        // which the runtime resolves off the global and this resolver did not
        // know: `PLAN-checker-type-resolution.md stage A`, R1.
        //
        // It sits LAST among the name lookups, after `interfaceTypeOf`, because
        // `partial interface ClassFieldMetadata { ... }` completes exactly these
        // names. Ahead of it, the intrinsic record - which declares no members -
        // shadowed the completed one and the added member stopped being checked,
        // silently. That is the failure `local-binding-transparency` pins, and
        // its comment predicts it: "Restricting that to builtin names made it
        // worse, since `partial interface` extends exactly those."
        //
        // Last is also the conservative place: this lookup answers only for a
        // name nothing else in the chain claims.
        return builtinTypeRecord(name) ?? iterationInterfaceRecord(name) ?? libraryTypeRecord(name) ?? lookupAlias(name) ?? classTypeOf(name) ?? enumTypeOf(name) ?? interfaceTypeOf(name) ?? (shadowedByProgram(name) ? null : (BoundTypeRecordForName(name) as Known | undefined)) ?? namedNumericLiteralRecord(name);
      }
      case 'PredefinedType':
        return node.keyword === 'void' ? voidType : makePrimitive('null');
      case 'ParenthesizedType':
        return resolveType(node.Type);
      // `PLAN-checker-type-resolution.md stage E`, closing the resolver gaps C2
      // reports. Each mirrors its arm of `TypeNodeToTypeRecord` exactly - the
      // record shape is the contract between the two resolvers, and building a
      // different one here is the mistake stage A's first attempt made with
      // `Token`.
      //
      // #sec-shared-types: `shared T` is a marker over its target. Resolving it
      // once made `let s: shared uint8 = 1;` an early error, because a numeric
      // literal reaches `uint8` by CONVERSION and that path did not look through
      // the marker; `literalFitsNumericType` now does, so the annotation can be
      // resolved and judged rather than left unreadable.
      case 'SharedType': {
        const Target = resolveType(node.Type);
        return Target ? { Kind: 'shared', Target } as Known : null;
      }
      // The references extension: `ref T` is { Kind: 'reference', Target }.
      case 'ReferenceType': {
        const Target = resolveType(node.Type);
        return Target ? { Kind: 'reference', Target } as Known : null;
      }
      // table-metadata-values: source and flags, never a RegExp object - the same
      // two fields the runtime reads, from the same node.
      //
      // The last blocking entry in C2's gap list. What blocked it was not
      // patterns: resolving it let the checker's unclaimed-key rule reach a
      // pattern metadata value as it already reached a numeric one, and the
      // RUNTIME did not enforce that rule at all, so tests written with an
      // unclaimed key failed. The runtime enforces it now
      // (`FINDING-unclaimed-metadata-key.md`), which needed a composite shape to
      // be built where the clause says it belongs first
      // (`FINDING-composite-shape-ignored.md`). Three findings, one order.
      case 'PatternType':
        return { Kind: 'pattern', Source: node.Source, Flags: node.Flags } as Known;
      // #sec-keyof: the Type Record `KeyTypesOf` answers for the operand. That
      // operation is already a plain function over records, so both resolvers
      // call the one implementation.
      case 'ComputedType': {
        // PLAN-where-on-methods.md, the ASSUMED half. #sec-checked-contracts:
        // "before specialization, where the application is deferred and no
        // result exists, the checker takes each clause as a known fact about the
        // ~application~ Type Record."
        //
        // ONLY where the builder carries a contract. A deferred call with no
        // clauses has nothing assumable about it, and answering `null` - which
        // the default arm does - is what leaves the boundary to specialization.
        // Producing a record for every computed type refused programs
        // specialization admits; this is that lesson, narrowed.
        const computed = node as unknown as ParseNode.ComputedType;
        // The callee is a |TypeReference|, so the name is on its |TypeName| -
        // reading `.name` off the reference itself answers undefined and the
        // producer never finds a builder.
        const calleeRef = computed.Callee as unknown as {
          TypeName?: { IdentifierReference?: { name?: string } }, name?: string,
        };
        const calleeName = calleeRef?.TypeName?.IdentifierReference?.name ?? calleeRef?.name;
        const builderNode = typeof calleeName === 'string' ? functionNodes.get(calleeName) : undefined;
        if (!builderNode) {
          return null as unknown as Known;
        }
        const facts = ContractFactsOf(builderNode as unknown as object, (argNode) => {
          const bare = (argNode as { type?: string, name?: string }).type === 'IdentifierReference'
            ? (argNode as { name?: string }).name
            : undefined;
          if (typeof bare === 'string' && typeParameterInScope(bare)) {
            const c = typeParameterConstraintOf(bare);
            return (c ? { Kind: 'parameter', Name: bare, Constraint: c } : { Kind: 'parameter', Name: bare }) as TypeRecord;
          }
          return undefined;
        });
        if (facts.length === 0) {
          return null as unknown as Known;
        }
        const args: Known[] = [];
        for (const a of (computed.Arguments as unknown as readonly ParseNode[]) ?? []) {
          const bare = (a as { type?: string, name?: string }).type === 'IdentifierReference'
            ? (a as { name?: string }).name
            : undefined;
          if (typeof bare === 'string' && typeParameterInScope(bare)) {
            const c = typeParameterConstraintOf(bare);
            args.push((c ? { Kind: 'parameter', Name: bare, Constraint: c } : { Kind: 'parameter', Name: bare }) as Known);
          } else {
            args.push(resolveType(a as ParseNode.Type));
          }
        }
        return { Kind: 'application', Builder: builderNode, Arguments: args, Facts: facts } as unknown as Known;
      }
      case 'KeyOfType': {
        const operand = resolveType(node.Type);
        return operand ? (KeyTypesOf(operand) as Known) : null;
      }
      // typeprogramming.md 4.1: `T[K]`. The walk is shared with the runtime
      // resolver rather than copied - see `IndexedAccessTypeRecord`. It answers
      // null where the runtime raises a type error, which is the difference
      // between the two resolvers' jobs: this one decides whether the annotation
      // denotes a type, and the boundary reports why it does not.
      case 'IndexedAccessType': {
        const objectType = resolveType(node.ObjectType);
        const indexType = resolveType(node.IndexType);
        if (!objectType || !indexType) {
          return null;
        }
        return IndexedAccessTypeRecord(objectType, indexType) as Known | null;
      }
      case 'UnionType':
      case 'IntersectionType': {
        const Members: TypeRecord[] = [];
        for (const m of node.Types) {
          const r = resolveType(m);
          if (!r) {
            return null;
          }
          Members.push(r);
        }
        return { Kind: node.type === 'UnionType' ? 'union' : 'intersection', Members };
      }
      case 'ArrayType': {
        if (node.ArrayExtent && node.ArrayExtent.type !== 'NumericLiteral') {
          return null;
        }
        // sec-array-and-tuple-types: an array type takes ONE type argument, its
        // element. A second was read as the length type in an early draft of
        // the design and never wired to anything, so `[4].<uint8, uint64>` and
        // even `[4].<uint8, uint64, uint32>` resolved with the extra arguments
        // DISCARDED and a plain `uint32` length - which made a typo and a
        // feature indistinguishable. Refused here rather than ignored; the
        // index type is fixed by the specification, not declared per array.
        if (node.TypeArguments && node.TypeArguments.TypeArgumentList.length > 1) {
          const completion = Throw.TypeError('an array type takes a single type argument') as ThrowCompletion;
          errors.push(completion.Value as ObjectValue);
          return null;
        }
        const el = node.TypeArguments && node.TypeArguments.TypeArgumentList.length > 0 ? resolveType(node.TypeArguments.TypeArgumentList[0]) : { Kind: 'any' as const };
        if (!el) {
          return null;
        }
        return { Kind: 'array', Element: el, Extent: node.ArrayExtent ? (node.ArrayExtent as { value: number }).value : 'dynamic' };
      }
      case 'TupleType': {
        const Elements = [];
        for (const e of node.TupleElementList) {
          const r = resolveType(e.Type);
          if (!r) {
            return null;
          }
          Elements.push({ Type: r, Rest: e.Rest, Initial: 'none' as const });
        }
        return { Kind: 'tuple', Elements };
      }
      case 'FunctionType': {
        const Parameters: ParameterRecord[] = [];
        for (const p of node.FunctionTypeParameterList) {
          const pn = p as { TypeAnnotation?: ParseNode.TypeAnnotation | null, Type?: ParseNode.Type | null, Rest?: boolean, Optional?: boolean, BindingIdentifier?: { name?: string } };
          // An unnamed parameter stores its type in [[Type]] and a named one
          // behind [[TypeAnnotation]]; `...[].<uint8>` is the unnamed form, so
          // reading only the annotation lost its type and made it `any`.
          const pt = pn.TypeAnnotation ?? (pn.Type ? ({ Type: pn.Type } as ParseNode.TypeAnnotation) : null);
          const r = pt ? resolveType(pt.Type) : { Kind: 'any' as const };
          if (!r) {
            return null;
          }
          // PLAN-rest-parameters.md phase 0: a function TYPE's parameters carry
          // the same record a declaration's do, which is what lets a rest be
          // written in a type at all.
          Parameters.push(parameter(r, {
            Name: pn.BindingIdentifier?.name ?? '', Rest: pn.Rest === true, Optional: pn.Optional === true,
          }));
        }
        const Return = resolveType(node.ReturnType);
        return { Kind: 'function', Signatures: [{ Parameters, Return }] };
      }
      case 'ObjectType': {
        const Properties = [];
        for (const member of node.TypeMemberList) {
          if (member.type !== 'TypeMember') {
            return null;
          }
          const key = (member.PropertyName as { name?: string, value?: string }).name ?? (member.PropertyName as { value?: string }).value;
          if (typeof key !== 'string' || !member.TypeAnnotation) {
            return null;
          }
          const r = resolveType(member.TypeAnnotation.Type);
          if (!r) {
            return null;
          }
          Properties.push({ key, type: r, optional: member.Optional, readonly: member.Readonly });
        }
        return { Kind: 'object', Properties, IndexSignatures: [] };
      }
      case 'LiteralType': {
        if (node.kind === 'imaginary') {
          return null;
        }
        const raw = node.negated && typeof node.value === 'number' ? -node.value : node.value;
        const base = node.kind === 'number' ? makePrimitive('number') : node.kind === 'string' ? makePrimitive('string') : node.kind === 'boolean' ? makePrimitive('boolean') : makePrimitive('bigint');
        return { Kind: 'literal', Value: Value(raw as never), Base: base };
      }
      default:
        return null;
    }
  };

  /** #sec-do-expressions: `do {}` is `void 0`, a value, and not the ~void~ type. */
  const undefinedType: TypeRecord = makePrimitive('undefined');

  /**
   * The yielded and returned types of a generator body.
   *
   * A `yield*` contributes its operand's Y rather than the operand itself, and
   * a nested function boundary contributes nothing - its yields and returns are
   * its own.
   */
  const collectGeneratorTypes = (node: ParseNode | undefined, yielded: TypeRecord[], returned: TypeRecord[]): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const n = node as { type?: string, AssignmentExpression?: ParseNode | null, hasStar?: boolean, Expression?: ParseNode | null };
    if (n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration'
      || n.type === 'ArrowFunction' || n.type === 'GeneratorExpression'
      || n.type === 'GeneratorDeclaration' || n.type === 'AsyncFunctionExpression'
      || n.type === 'AsyncArrowFunction' || n.type === 'ClassExpression'
      || n.type === 'ClassDeclaration' || n.type === 'DoExpression') {
      return;
    }
    if (n.type === 'YieldExpression') {
      const operand = n.AssignmentExpression ? staticType(n.AssignmentExpression) : null;
      if (n.hasStar) {
        const delegated = generatorParameters(operand);
        if (delegated) {
          yielded.push(delegated.Yield);
        }
      } else if (operand) {
        yielded.push(operand);
      }
    }
    if (n.type === 'ReturnStatement' && n.Expression) {
      const t = staticType(n.Expression);
      if (t) {
        returned.push(t);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'location') {
        continue;
      }
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        child.forEach((c) => collectGeneratorTypes(c as ParseNode, yielded, returned));
      } else if (child && typeof child === 'object' && 'type' in (child as object)) {
        collectGeneratorTypes(child as ParseNode, yielded, returned);
      }
    }
  };

  /**
   * The type of a statement list's completion value.
   *
   * PLAN-do-expressions.md phase 4, per #sec-completiontypeof: a union over the
   * TAILS, with divergence removing the paths that cannot produce one. Nothing
   * in it is new - divergence is phase 0's analysis, and the Early Errors of
   * #sec-do-expression-early-errors have already removed the forms whose
   * completion type would have been hard to state.
   */
  const completionTypeOf = (list: readonly ParseNode[] | undefined): Known => {
    if (!list || list.length === 0) {
      return undefinedType;
    }
    const last = list[list.length - 1] as ParseNode & {
      Expression?: ParseNode, StatementList?: readonly ParseNode[],
      Statement_a?: ParseNode, Statement_b?: ParseNode | null,
      LabelledItem?: ParseNode, Block?: { StatementList?: readonly ParseNode[] },
      Catch?: { Block?: { StatementList?: readonly ParseNode[] } } | null,
      CaseBlock?: { CaseClauses_a?: readonly ParseNode[], DefaultClause?: ParseNode | null, CaseClauses_b?: readonly ParseNode[] },
    };
    // A diverging tail contributes nothing, and a list all of whose paths
    // diverge is the empty union - `never` - which is a subtype of everything,
    // so `const port: uint16 = do { throw new E(); }` is accepted.
    if (Diverges(last, { switchCoversDiscriminant })) {
      return neverType;
    }
    const unionOf = (members: Known[]): Known => {
      const present = members.filter((m): m is TypeRecord => !!m);
      if (present.length !== members.length || present.length === 0) {
        return null;
      }
      return present.length === 1 ? present[0] : CanonicalizeType({ Kind: 'union', Members: present });
    };
    switch (last.type) {
      case 'ExpressionStatement':
        return last.Expression ? staticType(last.Expression) : undefinedType;
      case 'Block':
        return completionTypeOf(last.StatementList);
      case 'LabelledStatement':
        return completionTypeOf(last.LabelledItem ? [last.LabelledItem] : undefined);
      case 'IfStatement':
        if (!last.Statement_b) {
          // Refused by the Early Errors; the type is stated for completeness.
          return undefinedType;
        }
        return unionOf([
          completionTypeOf([last.Statement_a!]),
          completionTypeOf([last.Statement_b]),
        ]);
      case 'TryStatement': {
        const members: Known[] = [completionTypeOf(last.Block?.StatementList)];
        if (last.Catch?.Block) {
          members.push(completionTypeOf(last.Catch.Block.StatementList));
        }
        // A `finally` contributes nothing: its completion is discarded unless
        // it is abrupt.
        return unionOf(members);
      }
      case 'SwitchStatement': {
        const block = last.CaseBlock;
        const clauses = [
          ...(block?.CaseClauses_a ?? []),
          ...(block?.DefaultClause ? [block.DefaultClause] : []),
          ...(block?.CaseClauses_b ?? []),
        ];
        // A clause's trailing `break` has an EMPTY completion, so the value
        // falls back to the statement before it - that is what UpdateEmpty does
        // at run time, and `case E.A: 1; break;` completes with 1. Dropping it
        // here rather than in the general rule is deliberate: a `do` whose own
        // tail is a `break` genuinely diverges, since that break leaves the
        // expression, and only a clause's break is caught by its switch.
        const members = clauses.map((c) => {
          const list = (c as { StatementList?: readonly ParseNode[] }).StatementList ?? [];
          const trimmed = list.length > 0 && list[list.length - 1].type === 'BreakStatement'
            && !(list[list.length - 1] as { LabelIdentifier?: unknown }).LabelIdentifier
            ? list.slice(0, -1)
            : list;
          return completionTypeOf(trimmed);
        });
        // #sec-completiontypeof: an exhaustive switch takes no path where no
        // clause ran, so it contributes no `undefined`. Exhaustiveness here is
        // the SWITCH's, which this design reserves to enums and sealed
        // hierarchies and which is deliberately narrower than a `match`'s atoms
        // - a switch over a boolean covering true and false is not exhaustive
        // for this operation, and the clause says so.
        if (!switchCoversDiscriminant(last)) {
          members.push(undefinedType);
        }
        return unionOf(members);
      }
      default:
        return undefinedType;
    }
  };

  /**
   * proposal-runtime-types #sec-static-type-of-an-expression: the part of _t_
   * whose values are FALSY, which is what `a && b` yields when the left decides
   * the result. A type whose values are all truthy contributes nothing, so
   * `obj && f()` is just the type of `f()`.
   *
   * The parts are stated per KIND rather than per value: where a falsy value of
   * a kind exists but the system cannot write its literal type - a `uint32`
   * zero is a typed number, not a Number literal - the whole member stands in
   * for it. That is the widening license #sec-inferred-result-type already
   * grants ("an implementation may be imprecise about completion", in the
   * widening direction only): a wider answer is sound here because it names
   * more values than can occur, never fewer.
   */
  const falsyPartOf = (t: TypeRecord): TypeRecord | typeof empty => {
    const members = t.Kind === 'union' ? (t as { Members: readonly TypeRecord[] }).Members : [t];
    const kept: TypeRecord[] = [];
    for (const m of members) {
      switch (m.Kind) {
        // Every object, array, tuple, and function value is truthy.
        case 'object': case 'array': case 'tuple': case 'function': case 'nominal':
          break;
        case 'void':
          break;
        case 'literal':
          // A literal type names ONE value, so it is falsy or it is not.
          if (isFalsyLiteralValue((m as { Value: Value }).Value)) {
            kept.push(m);
          }
          break;
        case 'primitive': {
          const name = (m as { Name: string }).Name;
          if (name === 'undefined' || name === 'null') {
            kept.push(m);
            break;
          }
          if (name === 'boolean') {
            kept.push({ Kind: 'literal', Value: Value.false, Base: m } as TypeRecord);
            break;
          }
          if (name === 'symbol' || name === 'type') {
            break;
          }
          // A numeric, string, or bigint member: `0`, `''`, `0n`, and NaN are
          // reachable, and the member stands in for them.
          kept.push(m);
          break;
        }
        default:
          kept.push(m);
          break;
      }
    }
    if (kept.length === 0) {
      return empty;
    }
    return kept.length === 1 ? kept[0]! : CanonicalizeType({ Kind: 'union', Members: kept });
  };

  /** The part of _t_ whose values are TRUTHY, which `a || b` yields. */
  const truthyPartOf = (t: TypeRecord): TypeRecord | typeof empty => {
    const members = t.Kind === 'union' ? (t as { Members: readonly TypeRecord[] }).Members : [t];
    const kept: TypeRecord[] = [];
    for (const m of members) {
      switch (m.Kind) {
        case 'void':
          break;
        case 'literal':
          if (!isFalsyLiteralValue((m as { Value: Value }).Value)) {
            kept.push(m);
          }
          break;
        case 'primitive': {
          const name = (m as { Name: string }).Name;
          // `undefined` and `null` have exactly one value each, and it is falsy,
          // so neither survives a truthiness test - this is what makes
          // `x || d` on an optional drop the absent arm.
          if (name === 'undefined' || name === 'null') {
            break;
          }
          if (name === 'boolean') {
            kept.push({ Kind: 'literal', Value: Value.true, Base: m } as TypeRecord);
            break;
          }
          kept.push(m);
          break;
        }
        default:
          kept.push(m);
          break;
      }
    }
    if (kept.length === 0) {
      return empty;
    }
    return kept.length === 1 ? kept[0]! : CanonicalizeType({ Kind: 'union', Members: kept });
  };

  /**
   * The Static Type of `a && b`, `a || b`, and `a ?? b`: the part of the left
   * that SHORT-CIRCUITS, joined with the right. _typeOf_ is how an operand is
   * typed, which is what lets the contextual form pass a position's type down
   * to both operands while the plain form types them in isolation.
   */
  const logicalResultType = (node: ParseNode, typeOf: (n: ParseNode) => Known, contextual: Known = null): Known => {
    let leftNode: ParseNode;
    let rightNode: ParseNode;
    if (node.type === 'CoalesceExpression') {
      const co = node as ParseNode.CoalesceExpression;
      leftNode = co.CoalesceExpressionHead as ParseNode;
      rightNode = co.BitwiseORExpression as ParseNode;
    } else {
      const lg = node as unknown as {
        LogicalANDExpression?: ParseNode, LogicalORExpression?: ParseNode, BitwiseORExpression?: ParseNode,
      };
      const isAnd = node.type === 'LogicalANDExpression';
      leftNode = (isAnd ? lg.LogicalANDExpression : lg.LogicalORExpression) as ParseNode;
      rightNode = (isAnd
        ? lg.BitwiseORExpression
        : (node as unknown as { LogicalANDExpression: ParseNode }).LogicalANDExpression) as ParseNode;
    }
    const left = typeOf(leftNode);
    const right = typeOf(rightNode);
    if (!left || !right) {
      return null;
    }
    // `a && b` yields the left where it is FALSY, `a || b` where it is TRUTHY,
    // and `a ?? b` where it is NULLISH - the last being a membership question
    // the narrowing operations already answer, the same split the `??`
    // dead-test diagnostic reads. A part that cannot occur contributes nothing,
    // which is what makes `s || 'anon'` a plain `string`, `x ?? 10` on an
    // optional a plain `uint32`, and `obj && f()` the type of `f()`.
    const kept = node.type === 'CoalesceExpression'
      ? NarrowFrom(left, nullishType())
      : (node.type === 'LogicalANDExpression' ? falsyPartOf(left) : truthyPartOf(left));
    // Where the left ALWAYS short-circuits, the right is never evaluated and so
    // contributes nothing: `undefined && f()` is `undefined`, not
    // `undefined | uint32`. This is the dual of the case just below, where the
    // left never short-circuits and contributes nothing itself; between them
    // the two keep the type to the values the expression can actually produce.
    const passedOver = node.type === 'CoalesceExpression'
      ? NarrowTo(left, nullishType())
      : (node.type === 'LogicalANDExpression' ? truthyPartOf(left) : falsyPartOf(left));
    if (passedOver === empty && kept !== empty) {
      return kept as TypeRecord;
    }
    // #sec-type-propagation-to-literals: a literal in a contextual position IS
    // of that position's type where it fits. Elsewhere that is settled by the
    // assignability check, which reads the literal and the target together; a
    // literal INSIDE a union never meets the target that way, so
    // `const c: uint32 = x || 10` read as
    // `a literal type of number | uint.<32>` and was refused at its own
    // annotation. Adopting after the short-circuit split keeps the precision
    // that makes `0 || 10` just the right operand.
    const adopt = (t: TypeRecord): TypeRecord => (contextual && t.Kind === 'literal'
      && (IsAssignable(t, contextual) || literalFitsNumericType(t, contextual))
      ? contextual
      : t);
    const adoptedRight = adopt(right);
    return kept === empty ? adoptedRight : joinTypes(adopt(kept as TypeRecord), adoptedRight);
  };

  /** The union of two known types, canonicalized so member order never shows. */
  const joinTypes = (a: TypeRecord, b: TypeRecord): TypeRecord => (SameType(a, b)
    ? a
    : CanonicalizeType({ Kind: 'union', Members: [a, b] }));

  /**
   * Whether a literal type's value is falsy. The set is the language's: *false*,
   * *undefined*, *null*, `0` and `-0` and NaN, `0n`, and the empty String. A
   * TYPED number is the same question asked of the number it carries, since a
   * `uint32` zero is falsy exactly as `0` is.
   */
  const isFalsyLiteralValue = (v: Value): boolean => {
    if (v === Value.false || v === Value.undefined || v === Value.null) {
      return true;
    }
    // A TYPED number carries the Number it was built from, and a `uint32` zero
    // is falsy exactly as `0` is, so both spellings are unwrapped the same way.
    const inner = (v as { value?: Value }).value ?? v;
    if (typeof (inner as { numberValue?: () => number }).numberValue === 'function') {
      const x = Number((inner as { numberValue(): number }).numberValue()); // eslint-disable-line @engine262/mathematical-value -- a truthiness test, not a mathematical value in the spec sense
      return x === 0 || Number.isNaN(x);
    }
    if (inner instanceof BigIntValue) {
      return (inner as unknown as { bigintValue(): bigint }).bigintValue() === 0n;
    }
    if (typeof (inner as { stringValue?: () => string }).stringValue === 'function') {
      return (inner as { stringValue(): string }).stringValue() === '';
    }
    return false;
  };

  const staticType = (node: ParseNode): Known => {
    switch (node.type) {
      case 'TopicReference':
        return lookup(TOPIC_NAME) ?? null;
      case 'ArrowFunction':
      case 'FunctionExpression': {
        // proposal-runtime-types #table-check-sites makes an argument and an
        // annotated binding check sites, and a function LITERAL had no static
        // type at all - so nothing could be checked against anything at either.
        // A function DECLARATION was refused correctly and a literal of the same
        // shape was not, which is what said the gap was the literal rather than
        // the position it stood in.
        //
        // Built from what the literal WROTE DOWN: each parameter's annotation,
        // or the contextual type its position supplied, or ~any~; and the
        // return annotation, or an inferred one where the body is an
        // expression. A BLOCK body's return stays ~any~ - imprecise rather than
        // wrong - which means a block-bodied literal passes every check. That
        // is the limit of the checker's inference rather than a decision.
        const literal = node as unknown as {
          ArrowParameters?: readonly ParseNode[], FormalParameters?: readonly ParseNode[],
          TypeAnnotation?: ParseNode.TypeAnnotation | null,
        };
        const contextual = contextualParameterTypes.get(node) ?? [];
        const wantedReturn = contextualReturnTypes.get(node) ?? null;
        // Only an EXPRESSION body's type can be read: the expression IS the
        // return. A block body needs return-type inference this checker does
        // not have, and inferring it anyway answers `undefined` for a body that
        // simply never returns - which is not assignable to `void` and would
        // refuse `() => {}` at every position wanting one.
        const conciseArrow = node as unknown as { ConciseBody?: ParseNode };
        const conciseBodied = node.type === 'ArrowFunction'
          && conciseArrow.ConciseBody !== undefined
          && conciseArrow.ConciseBody.type !== 'FunctionBody';
        // Where the literal wrote no return type, its body cannot be read, and
        // its position wants nothing, there is NOTHING TO SAY - so say nothing
        // rather than claim ~any~. A claimed `any` is not the same as silence
        // downstream: `(function () { return ref x; })() = 5` asks whether the
        // callee returns a ref, and an `any` return answers "no" where an
        // absent type left the question to the run time.
        if (!literal.TypeAnnotation && !conciseBodied && wantedReturn === null) {
          return null;
        }
        const params = literal.ArrowParameters ?? literal.FormalParameters ?? [];
        const Parameters = params.map((prm, i) => {
          const named = prm as ParseNode.SingleNameBinding;
          const annotated = (prm as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
          const resolved = annotated ? resolveType(annotated.Type) : (contextual[i] ?? null);
          return parameter((resolved ?? anyTypeRecord) as TypeRecord, {
            Name: named.BindingIdentifier?.name ?? '',
            Rest: prm.type === 'BindingRestElement',
            // A parameter is OPTIONAL only where it has a default; the node
            // carries an Initializer for a defaulted one and nothing otherwise.
            Optional: (prm as { Initializer?: unknown | null }).Initializer != null,
          });
        });
        const Return = literal.TypeAnnotation
          ? resolveType(literal.TypeAnnotation.Type)
          : ((conciseBodied ? inferredReturnType(node, contextual as readonly Known[], wantedReturn) : null)
            // Where the body's type cannot be read - a BLOCK body, which needs
            // return-type inference this checker does not have - the literal
            // adopts the return its position wants rather than claiming ~any~.
            // Claiming ~any~ would be worse than saying nothing: `any` is not a
            // subtype of every type here, so a block-bodied callback would be
            // refused at every typed position, which is the opposite of the
            // imprecision intended. Adopting the wanted return leaves the
            // block-bodied case exactly as unchecked as it was.
            ?? wantedReturn);
        // #sec-this-adoption: "the literal's own signature has that
        // [[ThisType]]". The half that matters downstream - a literal that
        // adopted a `this` is a method-shaped value, so passing it onward to a
        // free-function type is refused for the same reason extracting a method
        // is.
        const adoptedThis = contextualThisTypes.get(node);
        return {
          Kind: 'function',
          Signatures: [{
            Parameters,
            Return: (Return ?? anyTypeRecord) as TypeRecord,
            Untyped: false,
            ...(adoptedThis ? { ThisType: adoptedThis as TypeRecord } : {}),
          }],
        } as unknown as Known;
      }
      case 'PipelineExpression': {
        // #sec-pipeline-operator: the topic has the left operand's type, and
        // the pipeline has the body's. The topic is declared in a frame of its
        // own, so lookup, narrowing, and shadowing by an inner pipeline are the
        // ordinary rules rather than three new ones.
        const p = node as ParseNode.PipelineExpression;
        const topic = staticType(p.PipelineExpression);
        const bindings = new Map<string, TypeRecord>();
        if (topic) {
          bindings.set(TOPIC_NAME, topic);
        }
        frames.push({
          bindings, constLiterals: new Set<string>(), constLiteralTypes: new Map<string, TypeRecord>(), letConstants: new Set<string>(), immutableNames: new Set<string>(), declaredNames: new Set<string>(), aliases: new Map(), enums: new Map(), enumBindings: new Map(),
        });
        try {
          return staticType(p.Body);
        } finally {
          frames.pop();
        }
      }
      case 'DoExpression': {
        const d = node as ParseNode.DoExpression;
        if (!d.star) {
          return completionTypeOf(d.Block?.StatementList);
        }
        // #sec-do-generator-expressions: Y, R, and N are found rather than
        // declared, there being no annotation site. N is `void` unless a
        // contextual type supplies it, since nothing in a body determines what
        // a caller will send to `next`.
        const yielded: TypeRecord[] = [];
        const returned: TypeRecord[] = [];
        collectGeneratorTypes(d.GeneratorBody as ParseNode | undefined, yielded, returned);
        const Y = yielded.length === 0 ? neverType
          : (yielded.length === 1 ? yielded[0] : CanonicalizeType({ Kind: 'union', Members: yielded }));
        const R = returned.length === 0 ? voidType
          : (returned.length === 1 ? returned[0] : CanonicalizeType({ Kind: 'union', Members: returned }));
        return libraryType(d.async ? 'AsyncGenerator' : 'Generator', [Y, R, voidType]);
      }
      case 'NumericLiteral': {
        // A BIGINT literal is a literal of `bigint`, not of `number`. It was
        // labelled `number`, which F38 pinned as cosmetic - it is not: with
        // the base wrong, `let x: bigint = 65n` failed as "a literal type of
        // number is not assignable to bigint", so the `bigint` type could not
        // be used with an annotation AT ALL (F66).
        // proposal-runtime-types #sec-complex-numbers: "An imaginary literal has
        // the type `complex`", so it is not a literal type of `number` - its
        // value is a pair rather than one of the values a literal type can name.
        // Literal propagation still applies "as it does to any numeric literal",
        // which is what puts a `4i` in a `complex64` position at `complex64`.
        if ((node as { Imaginary?: boolean }).Imaginary) {
          return builtinTypeRecord('complex', []);
        }
        const v = (node as { value: number | bigint }).value;
        return typeof v === 'bigint'
          ? { Kind: 'literal', Value: Value(v), Base: makePrimitive('bigint') }
          : { Kind: 'literal', Value: Value(v), Base: makePrimitive('number') };
      }
      case 'StringLiteral':
        return { Kind: 'literal', Value: Value((node as { value: string }).value), Base: makePrimitive('string') };
      case 'BooleanLiteral':
        return { Kind: 'literal', Value: (node as { value: boolean }).value ? Value.true : Value.false, Base: makePrimitive('boolean') };
      case 'RegularExpressionLiteral': {
        // proposal-runtime-types (regexp.md): a regular expression literal's type
        // is `RegExp.<Captures, Groups>` inferred from its pattern.
        const rx = node as { RegularExpressionBody: string, RegularExpressionFlags: string };
        return inferRegExpLiteralType(rx.RegularExpressionBody, rx.RegularExpressionFlags);
      }
      case 'IdentifierReference':
        return lookup((node as { name: string }).name);
      case 'ThisExpression':
        // PLAN-declarative-checker-facts.md phase 1. #sec-this-adoption: within
        // an adopting literal's body, "`this` has that type". Outside one there
        // is no frame and `this` keeps the type it had - which for a class body
        // is the receiver rule that clause leaves alone, and elsewhere is
        // nothing to say rather than a claimed ~any~.
        return thisTypeFrames.length > 0 ? thisTypeFrames[thisTypeFrames.length - 1]! : null;
      case 'ParenthesizedExpression':
        return staticType((node as { Expression: ParseNode }).Expression);
      // `f.<uint32>` is the function `f` with its type arguments supplied; the
      // arguments are read at the CALL, which is where they bind. Without this
      // the callee of a generic call had no Static Type, so the call had none
      // either and nothing downstream could be checked.
      case 'TypeArgumentsExpression':
        return staticType((node as unknown as { Expression: ParseNode }).Expression);
      case 'ArrayLiteral': {
        const elements = (node as unknown as { ElementList?: readonly ParseNode[] }).ElementList ?? [];
        if (elements.length === 0) {
          return null;
        }
        let allElementsLiteral = true;
        const members: TypeRecord[] = [];
        for (const el of elements) {
          if (!el || typeof el !== 'object') {
            continue;
          }
          let t: Known;
          if (el.type === 'Elision') {
            t = makePrimitive('undefined');
          } else if (el.type === 'SpreadElement') {
            const spread = staticType((el as unknown as { AssignmentExpression: ParseNode }).AssignmentExpression);
            t = spread && spread.Kind === 'array' ? (spread as { Element: TypeRecord }).Element : null;
          } else {
            t = staticType(el);
          }
          if (!t) {
            return null;
          }
          if (t.Kind !== 'literal') {
            allElementsLiteral = false;
          }
          const widened = widen(t);
          if (!members.some((m) => SameType(m, widened))) {
            members.push(widened);
          }
        }
        if (members.length === 0) {
          return null;
        }
        const element = members.length === 1 ? members[0]! : CanonicalizeType({ Kind: 'union', Members: members });
        if (allElementsLiteral) {
          literalDerivedArrays.add(node as unknown as object);
        }
        return { Kind: 'array', Element: element, Extent: 'dynamic' } as Known;
      }
      case 'TypedConversionExpression':
        return resolveType((node as unknown as { Type: ParseNode.Type }).Type);
      case 'CallExpression': {
        // proposal-runtime-types `sec-composite-types`: "The Static Type of a
        // call of the Composite function is the top composite type where the
        // call supplies no TypeArguments and no contextual type reaches it."
        // Without this the checker derives an ordinary object type for the
        // call, so `let c: Composite = Composite({x: 1})` was refused - the
        // runtime knew the value's type and the checker did not.
        // proposal-runtime-types #sec-type-prototype: `T.parse` and `T.tryParse`
        // answer a value OF T, and the checker knew neither - so
        // `let a: string = uint8.parse("1")` was accepted, and a generator
        // yielding one inferred `any` for its element type. The run time was
        // right throughout; only the static type was missing.
        const parseCallee = (node as { CallExpression?: ParseNode }).CallExpression as {
          type?: string, MemberExpression?: ParseNode, IdentifierName?: { name?: string } | null,
        } | undefined;
        if (parseCallee?.type === 'MemberExpression'
          && (parseCallee.IdentifierName?.name === 'parse' || parseCallee.IdentifierName?.name === 'tryParse')
          && parseCallee.MemberExpression) {
          const targetName = parseCallee.MemberExpression.type === 'IdentifierReference'
            ? (parseCallee.MemberExpression as unknown as { name?: string }).name
            : undefined;
          const target = targetName ? builtinTypeRecord(targetName) : null;
          if (target) {
            // `parse` answers a value OF the type. `tryParse` answers that or
            // *null*, and only `parse` is typed here: a union with null needs a
            // null record this checker does not have, and claiming the bare
            // type for tryParse would be WRONG in the direction that matters -
            // it would let `let a: uint8 = uint8.tryParse(s)` pass while the
            // value may be null.
            if (parseCallee.IdentifierName.name === 'parse') {
              return target as Known;
            }
          }
        }
        const calleeNode = (node as { CallExpression?: ParseNode }).CallExpression;
        if (calleeNode?.type === 'IdentifierReference'
          && (calleeNode as { name?: string }).name === 'Composite') {
          // The TOP composite type, which states no shape - and a shapeless
          // type satisfies no specific interface, so `let i: I = Composite(...)`
          // is refused and `Composite.<I>({...})` is what a program writes.
          // That is the clause's rule read plainly, and it is also the design's
          // OWN advice: "an unannotated `Composite` call in typed code produces
          // `number` fields, and code that means anything else should say so at
          // the creation site". Deriving a shape from the argument was tried and
          // is not this rule; the shape belongs to the typed creation form,
          // where the type is stated rather than guessed.
          return makePrimitive('Composite', []);
        }
        // A call's static type is the callee function type's return, when
        // known; the argument check happens in the walk.
        const callee = staticType((node as { CallExpression: ParseNode }).CallExpression);
        // `a.map(cb)` returns an array of the CALLBACK'S return type, which is
        // why F79 left it ~any~ rather than guessing. The inference happens
        // HERE rather than through a channel: a declaration asks for its
        // initializer's type before the walk reaches the call, so a value
        // recorded during the walk would arrive too late (F80). It is readable
        // for a concise-bodied arrow, whose body IS the returned expression;
        // a block body needs return-type inference the checker does not have,
        // and stays ~any~ - imprecise rather than wrong.
        const mem = (node as { CallExpression?: ParseNode }).CallExpression;
        const calledName = mem && mem.type === 'MemberExpression'
          ? (mem as unknown as { IdentifierName?: { name: string } | null }).IdentifierName?.name
          : undefined;
        if (calledName === 'map' || calledName === 'flatMap') {
          const recv = mem && (mem as unknown as { MemberExpression?: ParseNode }).MemberExpression
            ? staticType((mem as unknown as { MemberExpression: ParseNode }).MemberExpression)
            : null;
          const cbArg = (node as { Arguments?: readonly ParseNode[] }).Arguments?.[0];
          if (recv && recv.Kind === 'array' && cbArg) {
            const returned = inferredReturnType(cbArg, [recv.Element, builtinTypeRecord('uint', [32]), recv]);
            if (returned) {
              // `flatMap` flattens ONE level, so a callback returning an array
              // contributes that array's elements and one returning a value
              // contributes the value. Reading the element off the callback's
              // return is the whole difference from `map`.
              const element = calledName === 'flatMap' && returned.Kind === 'array' ? returned.Element : returned;
              return { Kind: 'array', Element: element, Extent: 'dynamic' } as unknown as Known;
            }
          }
        }
        // The SET OPERATIONS whose result draws from BOTH sides: the design
        // writes `union<U>(other: Set.<U>): Set.<T | U>` and the same for
        // `symmetricDifference`. The result therefore depends on an ARGUMENT's
        // type, which a signature written at the member access cannot express -
        // the same reason `map` is handled here rather than there.
        //
        // Where the other side's element type is UNKNOWN, `T | U` is unknown
        // and the result is ~any~. That is not a miss to fix later: a union
        // with an untyped set really can hold anything, and answering
        // `Set.<T>` would be wrong rather than imprecise.
        if (calledName === 'union' || calledName === 'symmetricDifference') {
          const recv = mem && (mem as unknown as { MemberExpression?: ParseNode }).MemberExpression
            ? staticType((mem as unknown as { MemberExpression: ParseNode }).MemberExpression)
            : null;
          if (recv && recv.Kind === 'nominal' && recv.LibraryName === 'Set' && recv.Arguments.length > 0) {
            const otherNode = (node as { Arguments?: readonly ParseNode[] }).Arguments?.[0];
            const other = otherNode ? staticType(otherNode) : null;
            const mine = recv.Arguments[0];
            if (other && other.Kind === 'nominal' && other.LibraryName === 'Set'
                && other.Arguments.length > 0 && typeof mine !== 'number') {
              const theirs = other.Arguments[0];
              if (typeof theirs !== 'number') {
                const Members = SameType(mine as TypeRecord, theirs as TypeRecord)
                  ? [mine as TypeRecord]
                  : [mine as TypeRecord, theirs as TypeRecord];
                // Canonicalized, because assignability compares a nominal's
                // ARGUMENTS by SameType: an uncanonicalized union built here
                // and the one an annotation resolves to are the same type and
                // would not have compared equal, so the correct annotation for
                // the result would have been rejected.
                const element: TypeRecord = Members.length === 1 ? Members[0]! : { Kind: 'union', Members };
                return { Kind: 'nominal', Declaration: recv.Declaration, Arguments: [element], LibraryName: 'Set' } as unknown as Known;
              }
            }
            return null;
          }
        }
        if (callee && callee.Kind === 'function' && callee.Signatures.length === 1) {
          // #sec-published-return-types: the Static Type of a call is the
          // DECLARED return where one is declared, and the published inferred
          // return otherwise. The two live in separate fields so that identity,
          // overload-set formation, ranking, and viability can read the
          // declared one alone.
          const only = callee.Signatures[0] as {
            Return: Known, InferredReturn?: Known, ProvisionalReturn?: Known, TypeParameterNames?: readonly string[],
          };
          // #sec-generic-functions: a call that supplies type arguments binds
          // them to the signature's type parameters, and the return type is
          // read with that binding applied. Without this a generic call had no
          // Static Type at all, however completely it was annotated.
          if (only.TypeParameterNames && only.TypeParameterNames.length > 0) {
            const spec = (node as { CallExpression?: ParseNode }).CallExpression as unknown as {
              type?: string, TypeArguments?: { TypeArgumentList?: readonly ParseNode[] },
            } | undefined;
            const argNodes = spec?.type === 'TypeArgumentsExpression' ? spec.TypeArguments?.TypeArgumentList : undefined;
            {
              const bindings = new Map<string, TypeRecord>();
              (argNodes ?? []).forEach((argNode, i) => {
                const name = only.TypeParameterNames![i];
                const bound = resolveType(argNode as ParseNode.Type);
                if (name && bound) {
                  bindings.set(name, bound);
                }
              });
              if (bindings.size === 0) {
                // No explicit arguments: read them from what was passed.
                const passed = ((node as { Arguments?: readonly ParseNode[] }).Arguments ?? [])
                  .map((a) => staticType(a as ParseNode));
                bindTypeParametersFromArguments(
                  (only as unknown as { Parameters?: readonly { Type?: Known }[] }).Parameters ?? [],
                  passed,
                  new Set(only.TypeParameterNames),
                  bindings,
                );
              }
              const declaredOrPublished = only.Return ?? only.InferredReturn ?? null;
              if (declaredOrPublished && bindings.size > 0) {
                return substituteTypeParameters(declaredOrPublished, bindings);
              }
            }
          }
          if (only.Return && mentionsTypeParameter(only.Return)) {
            // A generic return with no binding for its parameters says nothing
            // this call site can use.
            return null;
          }
          if (only.Return || only.InferredReturn) {
            if (!only.Return && only.InferredReturn) {
              const named = (node as { CallExpression?: ParseNode }).CallExpression as { type?: string, name?: string } | undefined;
              if (named?.type === 'IdentifierReference' && named.name) {
                callProvenance.set(node as unknown as object, named.name);
                const anchor = publishedAnchors.get(only as object);
                if (anchor) {
                  callAnchors.set(node as unknown as object, anchor);
                }
                const origins = publishedOrigins.get(only as object);
                if (origins) {
                  callOrigins.set(node as unknown as object, origins);
                }
              }
            }
            return only.Return ?? only.InferredReturn ?? null;
          }
          if (inferenceDepth > 0) {
            // A call of a function whose inference is running: a recursive
            // reference, which contributes `never` rather than an unknown.
            if (inferencesInProgress.has(only as object)) {
              return neverType;
            }
            return only.ProvisionalReturn ?? driveInference(only as object);
          }
          return null;
        }
        return null;
      }
      case 'YieldExpression': {
        // PLAN-do-expressions.md phase 1, #sec-generator-types. A `yield`
        // evaluates to what the caller sends to `next`, which is the enclosing
        // generator's N; a `yield*` evaluates to what the DELEGATED generator
        // RETURNED, which is its R. The second is the rule everyone gets
        // backwards, and it follows from the run time: `yield*` drives the
        // operand to completion and takes its return value.
        const y = node as { hasStar?: boolean, AssignmentExpression?: ParseNode | null };
        if (y.hasStar) {
          const operand = y.AssignmentExpression ? staticType(y.AssignmentExpression) : null;
          const delegated = generatorParameters(operand);
          return delegated ? delegated.Return : null;
        }
        const enclosing = generatorParameters(generatorTypes[generatorTypes.length - 1] ?? null);
        return enclosing ? enclosing.Next : null;
      }
      case 'MemberExpression': {
        const m = node as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null, Expression?: ParseNode | null };
        if (m.IdentifierName && m.MemberExpression) {
          const receiver = staticType(m.MemberExpression);
          // A method of a TYPED ARRAY takes the element type. The design gives a
          // typed collection element-typed method signatures, and the run time
          // enforces them (F68/F69); the checker knowing them is what turns
          // `a.includes(70000)` from a run-time RangeError into the Early Error
          // a statically determinable mistake deserves (F70).
          if (receiver && receiver.Kind === 'array') {
            // #index-type: one type describes every count an array reports or
            // accepts - its `length`, its `capacity`, an index, and a view's
            // length. It is named once HERE rather than written as `uint32` at
            // each site, so that the width is stated in one place and the two
            // counts stay comparable: "a capacity is at least a length" is
            // unstateable if `length` and `capacity` are not one type.
            //
            // `capacity` had no entry at all and so resolved to ~any~, which
            // let `let n: string = a.capacity` type-check on a proposal whose
            // subject is types.
            const name = (m.IdentifierName as { name: string }).name;
            if (name === 'length' || name === 'capacity') {
              // NOT literal-typed on a fixed extent, though the extent is a
              // compile-time constant and the type would be exact. `a.length`
              // evaluates to a TYPED value and `a.capacity` to a plain Number,
              // so a literal type is assignable from one and not the other:
              // `let n: 4 = a.capacity` passes and `let n: 4 = a.length` fails
              // the run-time boundary with "4 (typed) is not assignable". The
              // static types would be identical and the observable behaviour
              // would not, which is worse than the index type for both.
              //
              // #sec-array-and-tuple-types says of `length` that "the value
              // read is unchanged, a Number, and no conversion is applied at
              // run time", so the divergence is the engine's and settling it
              // is a prerequisite rather than part of this pass. The bounds
              // rule below does not depend on it: it reads [[Extent]] from the
              // type directly.
              return indexTypeRecord();
            }
            const sig = arrayMethodSignature(name, receiver.Element, receiver);
            if (sig) {
              return sig;
            }
          }
          // An iterating receiver: a Generator, an AsyncGenerator, or one of the
          // iteration interfaces. The element is the first type argument in
          // every case, which is what the shared shorthand guarantees.
          if (receiver && receiver.Kind === 'nominal' && receiver.Arguments.length > 0
              && (receiver.LibraryName === 'Generator' || receiver.LibraryName === 'AsyncGenerator'
                || receiver.LibraryName === 'IteratorHelper' || receiver.LibraryName === 'AsyncIteratorHelper')) {
            const first = receiver.Arguments[0];
            if (first !== undefined && typeof first !== 'number') {
              const sig = iteratorMethodSignature((m.IdentifierName as { name: string }).name, first);
              if (sig) {
                return sig;
              }
            }
          }
          // #sec-span-type: a WINDOW receiver. It reads like an array of its
          // element type and has none of the operations that change a length or
          // describe an allocation. Without this the receiver fell through to
          // ~any~, so `p.push(1)` on a `Span.<uint32>` type-checked and
          // `let s: string = p[0]` did too - the type existed and constrained
          // nothing, which is worse than not having it.
          {
            const spanElement = spanElementOfReceiver(receiver);
            if (spanElement) {
              const name = (m.IdentifierName as { name: string }).name;
              if (name === 'length') {
                return indexTypeRecord();
              }
              if (spanForbiddenMembers.has(name)) {
                const completion = Throw.TypeError(
                  '$1 is not declared by $2',
                  Value(name),
                  Value(displayType(receiver!)),
                ) as ThrowCompletion;
                errors.push(completion.Value as ObjectValue);
                return null;
              }
              const sig = arrayMethodSignature(name, spanElement, receiver!);
              if (sig) {
                return sig;
              }
            }
          }
          // #sec-structure-of-arrays: `fields` projects each of T's immediate
          // fields as a `Span.<F>` over that field's column. The projection has
          // BEEN a window since before the type had a name - it is stored the
          // way a buffer view is - and this is the checker learning to say so.
          //
          // Without it the whole chain was ~any~: `s.fields.x[0]` accepted a
          // `string` annotation, so the one place in the design already using
          // windows was the one place they went unchecked.
          if (receiver && receiver.Kind === 'nominal' && receiver.LibraryName === 'SoA'
              && receiver.Arguments.length > 0
              && (m.IdentifierName as { name: string }).name === 'fields') {
            const element = receiver.Arguments[0];
            // #sec-structure-of-arrays: a FIXED `SoA.<T, N>` projects columns
            // of exactly N, so the projection carries its length in its type -
            // which is what lets an access into it skip the per-element check.
            // A growable one projects a window whose length follows the
            // container and cannot be stated.
            const soaExtent = receiver.Arguments.length > 1 && typeof receiver.Arguments[1] === 'number'
              && receiver.Arguments[1] !== 0
              ? receiver.Arguments[1] as number
              : undefined;
            const spanOf = (el: TypeRecord) => (soaExtent === undefined
              ? libraryTypeRecord('Span', [el])!
              : libraryTypeRecord('Span', [el, soaExtent])!);
            if (element !== undefined && typeof element !== 'number') {
              // Columns from the LAYOUT where there is one - which covers a
              // primitive element, whose column is the element itself.
              const columns = SoAColumnsOf(element as TypeRecord);
              if (columns) {
                return {
                  Kind: 'object',
                  Properties: columns.map((c: { key: string, type: TypeRecord }) => ({
                    key: c.key,
                    type: spanOf(c.type),
                    optional: false,
                    readonly: true,
                  })),
                  IndexSignatures: [],
                } as unknown as Known;
              }
              // A CLASS element has no layout here: the layout is built when the
              // class is constructed and the checker runs before that. But a
              // layout is not what this needs - the columns are one per field,
              // and the checker already knows a class's fields and their types
              // as its Structure. Reading them from there types the projection
              // without waiting for a run-time artifact.
              //
              // The split is ONE LEVEL, matching #sec-structure-of-arrays: a
              // field that is itself a value type stays one column rather than
              // being flattened to its leaves.
              const structure = structureOf(element as Known);
              if (structure && structure.Kind === 'object') {
                return {
                  Kind: 'object',
                  Properties: structure.Properties.map((f) => ({
                    key: f.key,
                    type: spanOf(f.type),
                    optional: false,
                    readonly: true,
                  })),
                  IndexSignatures: [],
                } as unknown as Known;
              }
            }
          }
          // The same for a typed COLLECTION, which reaches the checker as the
          // nominal its annotation resolved to, carrying its type arguments.
          if (receiver && receiver.Kind === 'nominal' && receiver.Arguments.length > 0
              && (receiver.LibraryName === 'Set' || receiver.LibraryName === 'Map'
                || receiver.LibraryName === 'WeakSet' || receiver.LibraryName === 'WeakMap')) {
            const name = (m.IdentifierName as { name: string }).name;
            // #index-type, widened from arrays to containers: a typed
            // collection's `size` reads at the index type, as an array's
            // `length` and `capacity` do. One type for every count is what makes
            // `map.size < array.length` writable at all; before this it was a
            // TypeError, `size` being the one count in the language with no
            // type. The RUNTIME half is the two `size` accessors, and the two
            // must agree - a checker saying `uint64` over a run time answering a
            // Number is the disagreement shape this suite has been bitten by
            // before.
            if (name === 'size' && (receiver.LibraryName === 'Set' || receiver.LibraryName === 'Map')) {
              return indexTypeRecord();
            }
            // A WEAK collection has no `size`, and reading one was ~any~ - so
            // `let n: string = w.size` type-checked on a `WeakMap`. Refused by
            // name, the treatment `Span.<T>` already gives the operations it
            // does not have, because a member the type does not declare is a
            // mistake rather than an unknown.
            if (name === 'size') {
              const completion = Throw.TypeError(
                '$1 is not declared by $2',
                Value(name),
                Value(displayType(receiver)),
              ) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
              return null;
            }
            const sig = collectionMethodSignature(
              receiver.LibraryName,
              name,
              receiver.Arguments,
              receiver,
            );
            if (sig) {
              return sig;
            }
          }
          const objType = structureOf(receiver);
          if (objType && objType.Kind === 'object') {
            const prop = objType.Properties.find((p) => p.key === (m.IdentifierName as { name: string }).name);
            return prop ? prop.type : null;
          }
        }
        // A COMPUTED access, `a[i]`. This fell through to ~any~, so indexing a
        // typed array was untyped: `let b: boolean = a[0]` type-checked on a
        // `[4].<uint32>`. Element WRITES were checked all along, which made the
        // hole easy to miss - the asymmetry read as "indexing is checked" when
        // only half of it was.
        if (m.Expression && m.MemberExpression) {
          const receiver = staticType(m.MemberExpression);
          // #sec-span-type: an element read through a WINDOW has the element
          // type, exactly as one through the array it windows. There is no
          // extent to decide a literal index against - a window's length is a
          // run-time fact - so the bound below is the array's alone.
          const spanElement = spanElementOfReceiver(receiver);
          if (spanElement) {
            // #sec-span-type: a window whose length is STATED decides a literal
            // index exactly as a fixed extent does, and this is the whole point
            // of the length being in the type - an access it has proven is in
            // range needs no per-element check. A window whose length is not
            // stated has nothing to decide against and keeps the run-time check.
            const spanExtent = spanExtentOfReceiver(receiver);
            const spanIndex = m.Expression as { type?: string, value?: unknown };
            if (spanExtent !== undefined && spanIndex.type === 'NumericLiteral'
                && typeof spanIndex.value === 'number'
                && (!Number.isInteger(spanIndex.value) || spanIndex.value < 0 || spanIndex.value >= spanExtent)) {
              const completion = Throw.TypeError(
                '$1 is not an index of $2',
                Value(String(spanIndex.value)),
                Value(displayType(receiver!)),
              ) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
            return spanElement;
          }
          if (receiver && receiver.Kind === 'array') {
            // #sec-array-and-tuple-types: a fixed extent is part of the type
            // and is a compile-time constant, so an index written as a literal
            // is decidable HERE. Out of range it is refused before the program
            // runs rather than as the run-time RangeError it used to be, which
            // is what lets a bounds check be elided where the index is proven.
            //
            // Only a literal is decided: anything computed keeps the run-time
            // check, which stays the backstop for every other index.
            const index = m.Expression as { type?: string, value?: number };
            if (index.type === 'NumericLiteral' && typeof receiver.Extent === 'number'
                && typeof index.value === 'number'
                && (!Number.isInteger(index.value) || index.value < 0 || index.value >= receiver.Extent)) {
              const completion = Throw.TypeError(
                '$1 is not an index of $2',
                Value(String(index.value)),
                Value(displayType(receiver)),
              ) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
            return receiver.Element;
          }
          // PLAN-parameter-composition Stage B. The third arm. A computed access
          // with a String LITERAL key reads a declared property, and is the same
          // operation the annotation `T["n"]` denotes - so both call
          // `IndexedAccessTypeRecord` and cannot drift apart, which is what
          // `#sec-indexed-access-types` was written for.
          //
          // Before this, `o["n"]` had no Static Type at all while `o.n` did, so
          // `let v: string = o["n"]` was accepted for a `uint8` property. The
          // two spellings read the same property and now answer the same type.
          //
          // A key that is not a String literal type - `o[k]` for a `k: string` -
          // yields null here, as `IndexedTypeOf` yields ~empty~ for it, and
          // falls through to the same untyped result as before. That is correct:
          // such a key does not name a property.
          if (receiver) {
            const keyType = staticType(m.Expression as ParseNode);
            if (keyType) {
              const indexed = IndexedAccessTypeRecord(receiver, keyType);
              if (indexed) {
                return indexed as Known;
              }
            }
          }
        }
        return null;
      }
      case 'NewExpression': {
        // `new C()` produces an instance of C, so the class's instance type is
        // the expression's type - which is what lets `new C().x` be read at the
        // field's declared type (F59).
        const target = (node as { MemberExpression?: ParseNode }).MemberExpression;
        if (target && target.type === 'IdentifierReference') {
          return classTypeOf((target as { name: string }).name);
        }
        // proposal-runtime-types #sec-generics: `new A.<uint8>()` is an
        // instance of the APPLICATION, not of the bare class. The arguments
        // were parsed and then dropped here, so the instance's type carried an
        // empty argument list and `const x: A.<uint16> = new A.<uint8>()` had
        // nothing to disagree with. Comparison needed no change: SameArgumentList
        // already refuses a mismatch, which every library generic relies on.
        if (target && target.type === 'TypeArgumentsExpression') {
          const spec = target as unknown as {
            Expression: ParseNode, TypeArguments: { TypeArgumentList: readonly ParseNode[] },
          };
          if (spec.Expression.type === 'IdentifierReference') {
            const base = classTypeOf((spec.Expression as unknown as { name: string }).name);
            if (base && base.Kind === 'nominal') {
              const args = spec.TypeArguments.TypeArgumentList
                .map((a) => resolveType(a as unknown as ParseNode.Type)
                  // proposal-runtime-types #sec-higher-kinded-parameters: an
                  // argument binding a kinded parameter is a DECLARATION, and
                  // resolveType answers null for a bare generic name because it
                  // is not a type. The filter below then dropped it, the length
                  // check failed, and `new B.<Boxed>()` fell through to the
                  // bare `B` - which is assignable to every application, so no
                  // two applications were ever distinct at construction.
                  ?? (a.type === 'TypeReference'
                    ? classTypeOf((a as unknown as { TypeName: { IdentifierReference: { name: string } } })
                      .TypeName.IdentifierReference.name)
                      ?? lookupAlias((a as unknown as { TypeName: { IdentifierReference: { name: string } } })
                        .TypeName.IdentifierReference.name)
                    : null))
                .filter((a): a is TypeRecord => !!a);
              if (args.length === spec.TypeArguments.TypeArgumentList.length) {
                return CanonicalizeType({ ...base, Arguments: args });
              }
            }
            return base;
          }
        }
        return null;
      }
      case 'IsExpression':
        return makePrimitive('boolean');
      // A COMPARISON produces a boolean whatever it compares - `<`, `>`, `<=`,
      // `>=`, `in`, and `instanceof` by #sec-relational-operators, and the four
      // equality forms by #sec-equality-operators. Without these the checker had
      // no type for the most common boolean-valued expression in any program,
      // which is why `x && x < 10` was ~any~ even where both operands were
      // annotated, and why a function returning a comparison could not be
      // inferred.
      case 'RelationalExpression':
      case 'EqualityExpression': {
        // ...EXCEPT over vectors, where #sec-vector-lanes applies the operator
        // LANE-WISE and the result is a mask vector, not a scalar:
        // `int32x4(...) < int32x4(...)` is a `boolean32x4`. Claiming `boolean`
        // for it broke `const m: boolean32x4 = a < b` at its own annotation.
        // The mask's lane type is the vector clause's to name, so a vector
        // operand yields no static type here rather than a wrong one.
        const operandNodes = ['RelationalExpression', 'ShiftExpression', 'EqualityExpression']
          .map((k) => (node as unknown as Record<string, ParseNode | undefined>)[k])
          .filter((x): x is ParseNode => !!x && typeof x === 'object' && 'type' in x);
        const operandTypes = operandNodes.map((x) => staticType(x));
        // An operand whose type is not known could be a vector, so the answer is
        // withheld rather than guessed: an unknown operand keeps the comparison
        // unknown, which is what it was before this case existed.
        if (operandTypes.length < 2 || operandTypes.some((t) => !t
          || (t.Kind === 'primitive' && (t.Name === 'vector' || t.Name === 'Composite')))) {
          return null;
        }
        return makePrimitive('boolean');
      }
      case 'TemplateLiteral':
        return makePrimitive('string');
      // proposal-runtime-types #sec-static-type-of-an-expression: `&&`, `||`,
      // and `??` produce one of their OPERANDS, not a boolean, so their type is
      // the part of the left that short-circuits joined with the right's. These
      // had no case at all, so every one of them was ~any~ - which made
      // `const b: boolean = x && x < 10` pass the checker while the value on a
      // falsy left is a `uint32` zero, and made any function returning one of
      // these forms uninferable, since an ~any~ contribution poisons a join.
      case 'LogicalANDExpression':
      case 'LogicalORExpression':
      case 'CoalesceExpression':
        return logicalResultType(node, staticType);
      case 'ConditionalExpression': {
        // `t ? a : b` produces one of its ARMS, so its type is their join, the
        // same shape the short-circuit operators have. It had no case at all,
        // which made the most common way to write a two-valued result ~any~ -
        // and made every function whose body is one conditional uninferable,
        // since an ~any~ contribution poisons a join.
        const c = node as unknown as { AssignmentExpression_a?: ParseNode, AssignmentExpression_b?: ParseNode };
        const a = staticType(c.AssignmentExpression_a as ParseNode);
        const b = staticType(c.AssignmentExpression_b as ParseNode);
        if (!a || !b) {
          return null;
        }
        return joinTypes(a, b);
      }
      default:
        return null; // ~any~
    }
  };

  /**
   * A DECLARED function's signature, which the checker did not have: function
   * types were built only from FunctionType annotations, so `function f(v:
   * uint8) {}` put nothing in scope and no call to it was argument-checked at
   * all (F55 measured this; F56 fixes it). A parameter with no annotation is
   * ~any~, which makes the signature usable even when only some parameters are
   * typed, and a rest parameter suppresses the signature entirely rather than
   * inviting an arity mistake.
   */
  /**
   * A class's INSTANCE type. Until now a class name in a type position resolved
   * to nothing, so `function f(c: C) { c.x = 300 }` was unchecked, no field's
   * type was visible, and every value of a class type was ~any~ to the checker
   * (F57). The record is NOMINAL - assignability compares [[Declaration]]
   * identity, so two classes with the same fields stay distinct - and it
   * carries the declared fields as its [[Structure]], which is the same channel
   * an interface already uses. Private fields are deliberately absent: they are
   * not reachable through a member expression from outside, and the store to
   * one is checked at run time by its own path.
   */
  /**
   * `sec-match-exhaustiveness`: does an unguarded clause pattern cover an atom?
   *
   * "An unguarded clause covers an atom _a_ when its pattern's PatternType _pt_
   * satisfies IsSubtype(the type of _a_, _pt_)."
   *
   * **(measured)** `when { c: 'US' }` parses as a |MatchTypePattern| whose
   * `Type` is an object type - the pattern IS a type - so the specification's
   * primary rule handles it directly. A first draft read it as a structural
   * OBJECT PATTERN and walked named members against the atom's properties;
   * that node shape does not exist here, so it matched nothing and an
   * exhaustive `match` was reported as missing every branch.
   *
   * The clause's additional sentence about structural patterns covers the
   * positions where a pattern is NOT a type; subtyping is the general rule and
   * is what a discriminated chain needs.
   */
  const structuralPatternCovers = (pattern: ParseNode, atom: TypeRecord): boolean => {
    const p = pattern as unknown as { type?: string, Type?: ParseNode.Type };
    if (p.type !== 'MatchTypePattern' || !p.Type) {
      return false;
    }
    const patternType = resolveType(p.Type);
    return patternType ? IsSubtype(atom, patternType, []) : false;
  };

  const instanceTypeOf = (n: ParseNode): Known => {
    const memo = classTypeMemo.get(n);
    if (memo !== undefined) {
      return memo;
    }
    if (classTypesInProgress.has(n)) {
      return null;
    }
    classTypesInProgress.add(n);
    try {
      const built = classInstanceType(n);
      classTypeMemo.set(n, built);
      return built;
    } finally {
      classTypesInProgress.delete(n);
    }
  };

  /**
   * proposal-runtime-types #sec-this-adoption: the `this` a METHOD expects.
   *
   * "A method extracted from its class and called free of it is the case this
   * decides: its `this` is not of the type its body assumes, and the extraction
   * is a type error at the boundary that took it rather than a *TypeError*
   * inside it." So a method's signature has to say that it expects one.
   *
   * WHICH type it expects is the question, and the answer is not the class. A
   * method is always invoked on the object it was found on, so its `this` is
   * the RECEIVER, whatever the receiver's declared type - it is a self type
   * rather than a fixed one. Giving a class's method the class itself was
   * tried and refuses `class C implements I`: the class's method would expect a
   * `C` where the interface's expects an `I`, and `C` is the narrower of the
   * two, which contravariance rejects. That refusal is wrong, and it is wrong
   * because the premise is: the interface's method is reached only through an
   * object that HAS it, so the receiver is a `C` at every call either way.
   *
   * Every method therefore carries the same marker. Two methods agree on it, so
   * a class satisfies an interface declaring the same method; a method and a
   * FREE function do not, which is the extraction. An explicit [[ThisType]] -
   * the one `withThisType` writes - stays an ordinary type and is compared
   * contravariantly against another explicit one.
   */
  const selfThisType = { Kind: 'nominal', Declaration: SELF_THIS, Arguments: [] } as unknown as TypeRecord;

  const classInstanceType = (n: ParseNode): Known => {
    const cls = n as unknown as {
      BindingIdentifier?: { name: string } | null,
      ClassTail?: { ClassBody?: readonly ParseNode[] | null } | null,
    };
    const Properties: { key: string, type: TypeRecord, optional: boolean, writeType?: TypeRecord, protected?: boolean }[] = [];
    // Methods, accumulated per name because a method may be OVERLOADED exactly
    // as a function may (F59). A getter contributes its return type as the
    // property's type, since that is what reading the property yields; a setter
    // contributes nothing yet, and is the natural next step for checking a
    // store through an accessor.
    const methods = new Map<string, { Parameters: ParameterRecord[], Return: Known, Untyped: boolean }[]>();
    /**
     * PLAN-abstract-implementation.md, the checking-pass migration.
     * #sec-type-errors makes a determinable type error an Early Error, and both
     * abstract rules refused at class definition EVALUATION - so the marker
     * before the class ran, and a class in dead code was never checked.
     *
     * The checker skipped `AbstractMethodDefinition` entirely: this walk handles
     * `MethodDefinition` and nothing else, so an abstract member was absent from
     * the class structure and there was nothing to reason about. Collected here,
     * keyed the way the member push below keys everything, so the inherited walk
     * can find them by name.
     */
    const abstractMembers = new Map<string, TypeRecord | null>();
    const unusable = new Set<string>();
    let construct: { Parameters: ParameterRecord[] } | null = null;
    const accessorKeys = new Set<string>();
    const getterKeys = new Set<string>();
    const setterTypes = new Map<string, TypeRecord>();
    for (const el of cls.ClassTail?.ClassBody ?? []) {
      if (el.type === 'AbstractMethodDefinition') {
        // A member is abstract because it has no body; the keyword is optional.
        // Its annotation "types the implementations", so it is recorded with its
        // declared type where there is one - that is what rule 1 compares
        // against.
        const am = el as unknown as {
          ClassElementName?: { type?: string, name?: string, value?: string } | null,
          TypeAnnotation?: ParseNode.TypeAnnotation | null,
        };
        const akey = am.ClassElementName?.name ?? am.ClassElementName?.value;
        if (typeof akey === 'string' && am.ClassElementName?.type !== 'PrivateIdentifier') {
          abstractMembers.set(akey, am.TypeAnnotation ? resolveType(am.TypeAnnotation.Type) : null);
        }
        continue;
      }
      if (el.type === 'MethodDefinition') {
        const md = el as unknown as {
          TypeAnnotation?: ParseNode.TypeAnnotation | null,
          static?: boolean,
          ClassElementName?: { type?: string, name?: string, value?: string } | null,
          UniqueFormalParameters?: readonly ParseNode[] | null,
          PropertySetParameterList?: readonly ParseNode[] | null,
        };
        const key = md.ClassElementName?.name ?? md.ClassElementName?.value;
        if (md.static || typeof key !== 'string' || md.ClassElementName?.type === 'PrivateIdentifier') {
          continue;
        }
        if (key === 'constructor') {
          // The constructor is the class's CONSTRUCT signature, not a member of
          // the instance shape: `c.constructor` is the class, and typing it as
          // a method taking the constructor's parameters would be wrong twice
          // over. It is collected separately, for `new C(...)` (F59).
          const cparams: ParameterRecord[] = [];
          let cusable = true;
          for (const p of md.UniqueFormalParameters ?? []) {
            if (p.type !== 'SingleNameBinding' && p.type !== 'BindingElement') {
              cusable = false;
              break;
            }
            const pp = p as { TypeAnnotation?: ParseNode.TypeAnnotation | null, Initializer?: ParseNode | null, Optional?: boolean };
            cparams.push(parameter((pp.TypeAnnotation ? resolveType(pp.TypeAnnotation.Type) : null) ?? anyTypeRecord, {
              Name: (p as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name ?? '',
              Optional: pp.Optional === true || !!pp.Initializer,
            }));
          }
          if (cusable) {
            construct = { Parameters: cparams };
          }
          continue;
        }
        if (md.PropertySetParameterList) {
          // A setter gives the property its WRITE type, which is what a store
          // through the accessor must satisfy. It is kept apart from the read
          // type because a getter and setter pair may legitimately differ, and
          // before this a store through a setter was unchecked entirely while a
          // store to a field of the same name was caught (F61).
          const sp = md.PropertySetParameterList[0] as { TypeAnnotation?: ParseNode.TypeAnnotation | null } | undefined;
          const t = sp?.TypeAnnotation ? resolveType(sp.TypeAnnotation.Type) : null;
          if (t) {
            setterTypes.set(key, t);
          }
          continue;
        }
        if (!md.UniqueFormalParameters) {
          // A getter: the property reads at its declared return type, or at the
          // one inferred from its body (#sec-inference-and-function-forms). A
          // getter is the single-value position par excellence - it takes no
          // parameters and its body's returns ARE the property's type - so
          // reading it as untyped where a program wrote no annotation loses the
          // type for every read of the member.
          let t = md.TypeAnnotation ? resolveType(md.TypeAnnotation.Type) : null;
          if (!t) {
            const anchorage: { anchored: boolean, from?: string | null, origins?: { type: TypeRecord, from: string }[] } = { anchored: false };
            inferenceDepth += 1;
            let inferred: Known;
            try {
              inferred = inferredReturnType(el as ParseNode, [], null, anchorage);
            } finally {
              inferenceDepth -= 1;
            }
            // A getter declares no parameters, so it can only participate by
            // anchoring: what it returns must derive from a declared type.
            if (inferred && anchorage.anchored && inferred.Kind !== 'void') {
              t = inferred;
              publishedReturnTypes.set(el as unknown as object, inferred);
            }
          }
          if (t) {
            Properties.push({ key, type: t, optional: false });
            getterKeys.add(key);
          }
          continue;
        }
        const Parameters: ParameterRecord[] = [];
        const annotated: Known[] = [];
        let usable = true;
        for (const p of md.UniqueFormalParameters) {
          if (p.type !== 'SingleNameBinding' && p.type !== 'BindingElement') {
            usable = false;
            break;
          }
          const pp = p as { TypeAnnotation?: ParseNode.TypeAnnotation | null, Initializer?: ParseNode | null, Optional?: boolean };
          const resolved = pp.TypeAnnotation ? resolveType(pp.TypeAnnotation.Type) : null;
          annotated.push(resolved);
          Parameters.push(parameter(resolved ?? anyTypeRecord, { Optional: pp.Optional === true || !!pp.Initializer }));
        }
        if (!usable) {
          unusable.add(key);
          continue;
        }
        const Return = md.TypeAnnotation ? resolveType(md.TypeAnnotation.Type) : null;
        const Untyped = !md.TypeAnnotation && annotated.every((t) => t === null);
        const sigs = methods.get(key) ?? [];
        const signature: { Parameters: ParameterRecord[], Return: Known, Untyped: boolean, InferredReturn?: Known } = { Parameters, Return, Untyped };
        // #sec-inference-and-function-forms: a method's published type joins the
        // shape its member belongs to, so a member call types through it.
        if (!Return) {
          const anchorage: { anchored: boolean, from?: string | null, origins?: { type: TypeRecord, from: string }[] } = { anchored: false };
          inferenceDepth += 1;
          let inferred: Known;
          try {
            inferred = inferredReturnType(el as ParseNode, annotated, null, anchorage);
          } finally {
            inferenceDepth -= 1;
          }
          if (inferred && (annotated.some((t) => t !== null) || anchorage.anchored)) {
            const published = inferred.Kind === 'primitive' && inferred.Name === 'undefined'
              ? voidTypeRecord
              : inferred;
            signature.InferredReturn = published;
            publishedReturnTypes.set(el as unknown as object, published);
          }
        }
        sigs.push(signature);
        methods.set(key, sigs);
        continue;
      }
      if (el.type !== 'FieldDefinition') {
        continue;
      }
      const f = el as unknown as {
        TypeAnnotation?: ParseNode.TypeAnnotation | null,
        static?: boolean,
        ClassElementName?: { type?: string, name?: string, value?: string } | null,
      };
      if (f.static || !f.TypeAnnotation) {
        continue;
      }
      const key = f.ClassElementName?.name ?? f.ClassElementName?.value;
      if (typeof key !== 'string' || f.ClassElementName?.type === 'PrivateIdentifier') {
        continue;
      }
      const t = resolveType(f.TypeAnnotation.Type);
      if (t) {
        Properties.push({ key, type: t, optional: false, protected: (f as { protected?: boolean }).protected === true });
        // An `accessor` is a FieldDefinition carrying the marker, and it is the
        // one member kind whose OVERRIDE is invariant - recorded here because
        // the Properties list keeps a type per key and no member kind.
        if ((f as { accessor?: boolean }).accessor === true) {
          accessorKeys.add(key);
        }
      }
    }
    for (const [key, writeType] of setterTypes) {
      const existing = Properties.find((p) => p.key === key);
      if (existing) {
        (existing as { writeType?: TypeRecord }).writeType = writeType;
      } else {
        // Setter with no getter: the property is write-only as far as the
        // checker can see, so its read type is its write type.
        Properties.push({ key, type: writeType, optional: false, writeType });
      }
    }
    for (const [key, Signatures] of methods) {
      if (unusable.has(key) || Properties.some((p) => p.key === key)) {
        continue;
      }
      const selfSignatures = Signatures.map((sig) => ({ ...sig, ThisType: selfThisType }));
      Properties.push({ key, type: { Kind: 'function', Signatures: selfSignatures } as unknown as TypeRecord, optional: false });
    }
    // #sec-typed-classes: a subclass's instances have their superclass's
    // members too, so the inherited shape is merged UNDER the class's own
    // declarations - an override wins, which is what the prototype chain does
    // at run time (F60). Only a heritage clause naming a class is followed; an
    // expression like `class B extends mixin(A)` leaves the base unknown, and
    // an unknown base contributes nothing rather than guessing.
    // An `implements` clause contributes members too: a class that satisfies an
    // interface has that interface's members, and the checker could not see one
    // the class did not also declare itself (F61). Merged UNDER both the class's
    // own declarations and its heritage, since either is more specific.
    const implemented = (cls.ClassTail as { ImplementsClause?: readonly ParseNode[] | null } | null | undefined)?.ImplementsClause ?? [];
    for (const ref of implemented) {
      const iname = (ref as { TypeName?: { IdentifierReference?: { name?: string }, MemberNames?: readonly unknown[] } }).TypeName;
      const nm = iname?.MemberNames && iname.MemberNames.length > 0 ? undefined : iname?.IdentifierReference?.name;
      if (typeof nm !== 'string') {
        continue;
      }
      const it = interfaceTypeOf(nm);
      const istruct = it && it.Kind === 'nominal'
        ? (it as unknown as { Structure?: { Kind: string, Properties: readonly { key: string, type: TypeRecord, optional: boolean }[] } }).Structure
        : null;
      if (istruct && istruct.Kind === 'object') {
        for (const p of istruct.Properties) {
          if (!Properties.some((own) => own.key === p.key)) {
            Properties.push(p);
          }
        }
      }
    }
    // README, the accessor rules: "The within-class rule still applies to the
    // resulting pair, so the derived setter must also accept everything the
    // derived getter can return." Stated there of a DERIVED pair, but it is a
    // rule about any pair: a property whose getter yields a value its own setter
    // would refuse cannot round-trip, and `o.x = o.x` does not type.
    //
    // Assignability is exactly the right relation, INCLUDING for numerics, and
    // that took three cycles to see. Two of them treated `get x(): uint8` with
    // `set x(v: uint32)` as a legal pair the rule would wrongly refuse - but
    // README is explicit that "a value of one value type never implicitly
    // becomes a value of another. `uint8` does not widen to `uint16`", the rule
    // Rust, Swift, and Go use. So that pair genuinely does not round-trip and
    // the refusal is correct. What made it look wrong was the SUBCLASS case,
    // which was a real gap and is fixed.
    for (const [skey, stype] of setterTypes) {
      const getter = Properties.find((prop) => prop.key === skey);
      if (getter?.type && stype && !IsAssignable(getter.type, stype)) {
        report(getter.type, stype);
      }
    }
    const heritage = (cls.ClassTail as { ClassHeritage?: ParseNode | null } | null | undefined)?.ClassHeritage;
    const baseName = heritage && (heritage as { type?: string, name?: string }).type === 'IdentifierReference'
      ? (heritage as { name: string }).name
      : null;
    const base = baseName ? classTypeOf(baseName) : null;
    const baseStructure = base && base.Kind === 'nominal'
      ? (base as unknown as { Structure?: { Kind: string, Properties: readonly { key: string, type: TypeRecord, optional: boolean }[] } }).Structure
      : null;
    // AN ACCESSOR OVERRIDE IS INVARIANT, which README does not say and which
    // falls out of the two variance rules it does state meeting on ONE
    // declaration. A `get`/`set` pair may refine its halves separately - "a
    // derived getter may refine its type covariantly", "a derived setter is
    // contravariant" - but an `accessor` generates both halves from a single
    // annotation, so narrowing it breaks the setter (the base accepted more)
    // and widening it breaks the getter (the base promised less). Both
    // directions refused leaves equality.
    //
    // Checked with SameType rather than assignability in both directions
    // deliberately: it is the relation the rule actually names, and it does not
    // inherit whatever the assignability relation currently makes of subclasses
    // and numeric widths.
    if (baseStructure && baseStructure.Kind === 'object') {
      // README: "A derived getter may refine its type COVARIANTLY under the
      // same conversion free rule that governs method returns." So the derived
      // getter's type must be a subtype of the base's - every caller of the
      // base's getter still receives what it was promised.
      //
      // JUDGED ONLY WHERE THE RELATION IS SOUND, which today is between two
      // CLASS types. IsSubtype has no primitive case at all, so it reports a
      // numeric refinement as unrelated in both directions, and a rule that
      // trusted it would refuse `get x(): uint8` overriding `get x(): uint32` -
      // legal, and the exact false positive that kept the within-class rule out
      // twice. Numeric refinement is left unjudged rather than judged wrongly;
      // what unblocks it is a primitive case carrying the design's table of
      // free conversions.
      for (const key of getterKeys) {
        const own = Properties.find((prop) => prop.key === key);
        const inherited = baseStructure.Properties.find((prop) => prop.key === key);
        // Judged for every pair of types, not only class ones. Cycle 141
        // restricted this to nominals believing a numeric refinement would be
        // wrongly refused; README settles that one value type never implicitly
        // becomes another, so a differing numeric IS a failed refinement and
        // the restriction was unnecessary.
        if (own?.type && inherited?.type && !IsAssignable(own.type, inherited.type)) {
          report(own.type, inherited.type);
        }
      }
      // README: "A derived setter is CONTRAVARIANT: it must accept every value
      // the base setter accepts, and may accept more." So the BASE's write type
      // must be assignable to the derived's - the direction that makes a
      // narrowing (`set r(v: Dog)` over `set r(v: Animal)`) the error and a
      // widening legal, which is the reverse of the getter rule above.
      // `base` is a TypeRecord of any kind here; [[SetterTypes]] lives on the
      // ~nominal~ arm, which is the only kind a heritage clause can name.
      const baseSetters = base?.Kind === 'nominal' ? base.SetterTypes : undefined;
      if (baseSetters) {
        for (const [skey, ownWrite] of setterTypes) {
          const inheritedWrite = baseSetters.get(skey);
          if (inheritedWrite && ownWrite && !IsAssignable(inheritedWrite, ownWrite)) {
            report(inheritedWrite, ownWrite);
          }
        }
      }
      for (const key of accessorKeys) {
        const own = Properties.find((prop) => prop.key === key);
        const inherited = baseStructure.Properties.find((prop) => prop.key === key);
        if (own?.type && inherited?.type && !SameType(own.type, inherited.type)) {
          report(own.type, inherited.type);
        }
      }
    }
    const merged = baseStructure && baseStructure.Kind === 'object'
      ? [...baseStructure.Properties.filter((p) => !Properties.some((own) => own.key === p.key)), ...Properties]
      : Properties;
    const instance = {
      Kind: 'nominal',
      Declaration: n,
      Arguments: [],
      Structure: { Kind: 'object', Properties: merged, IndexSignatures: [] },
      // The class this one extends, so the subtype relation has a chain to
      // walk. Nominal, not structural: two unrelated empty classes stay
      // unrelated, which is the point of the classes being nominal at all.
      Base: base ?? undefined,
      // The WRITE type of each setter, which a derived class needs to check
      // its own setters against and which the Structure cannot carry: a
      // property has one type there, and a getter already claims it. Carried
      // for the same reason as Base - a relation the record does not hold
      // cannot be decided.
      SetterTypes: setterTypes.size > 0 ? new Map(setterTypes) : undefined,
    } as unknown as Known;
    if (construct) {
      constructSignatures.set(n, construct);
    }
    // PLAN-nominal-records.md phase 2. The RUNTIME builds its own nominal
    // record for this class - at ClassDeclaration, ClassExpression and
    // NamedEvaluation - and carries neither [[Base]] nor [[Structure]], so
    // `Reflect.isAssignable(type Derived, type Base)` answered *false* for a
    // relation the checker decides correctly.
    //
    // Published rather than rebuilt there. The structure must include INHERITED
    // members, which this builder resolves lazily and memoizes precisely
    // because a base may be declared later than the class that extends it; a
    // second, eager build at evaluation would have to reproduce that and could
    // silently disagree. One build, read twice, cannot.
    publishedClassTypes.set(n as unknown as object, instance as unknown as TypeRecord);
    publishedAbstractMembers.set(n as unknown as object, abstractMembers);
    return instance;
  };

  /**
   * The signatures of the array methods that take or return the ELEMENT type.
   * Only the ones with a fixed leading parameter are given here: `push` and
   * `unshift` take a rest parameter, and the checker's argument loop would
   * check only their first argument, which is worse than leaving them to the
   * run time that already enforces them correctly (F70).
   */
  /**
   * The narrowing forms of sec-narrowing that speak about a BINDING, read off a
   * test expression. Returns the binding's name, the type the test establishes,
   * and whether the sense is inverted, or undefined where the test says nothing
   * the checker can use (F75).
   */
  /**
   * The binding name a narrowing subject refers to, or null.
   *
   * PLAN-pipeline-operator.md phase 2. The topic is bound under the name `%`,
   * which no program can write, so every row of the narrowing table reaches it
   * with no new machinery: `shape |> (% is Circle ? %.radius : 0)` narrows
   * because `%` is a name like any other here. That is the whole reason the
   * topic is a binding in the checker rather than a parallel frame.
   */
  const narrowableName = (e: ParseNode): string | null => {
    if (e.type === 'IdentifierReference') {
      return (e as unknown as { name: string }).name;
    }
    if (e.type === 'TopicReference') {
      return TOPIC_NAME;
    }
    return null;
  };

  const narrowingFactOf = (expr: ParseNode): { name: string, type: TypeRecord, negated: boolean, sense?: 'true' | 'false' } | undefined => {
    let e = expr;
    let negated = false;
    // `!(...)` inverts the sense; a parenthesized test is the test.
    for (;;) {
      if (e.type === 'ParenthesizedExpression') {
        e = (e as unknown as { Expression: ParseNode }).Expression;
        continue;
      }
      if (e.type === 'UnaryExpression' && (e as unknown as { operator?: string }).operator === '!') {
        negated = !negated;
        e = (e as unknown as { UnaryExpression: ParseNode }).UnaryExpression;
        continue;
      }
      break;
    }
    if (e.type === 'IsExpression') {
      const ie = e as unknown as {
        Expression: ParseNode, Type: ParseNode | null,
        Pattern?: { type?: string, Type?: ParseNode } | null,
      };
      if (narrowableName(ie.Expression) === null) {
        return undefined;
      }
      // proposal-runtime-types `sec-is-pattern`: "a |Type| is one |MatchPattern|
      // form, so every existing `is` keeps its parse AND ITS MEANING" - and its
      // meaning to the CHECKER is the narrowing it drives. Routing every `is`
      // through a pattern node without seeing through a bare TYPE pattern made
      // narrowing stop: the test still answered correctly at run time and
      // narrowed nothing, which is the promise half-kept. A pattern that is NOT
      // a bare type narrows nothing yet - phase five - and that is the pin.
      // A `not` over a bare type NEGATES the narrowing rather than abandoning
      // it: `v is not uint8` leaves `v` everything it was except `uint8` in the
      // true branch, which is what union subtraction can represent. Combinators
      // over non-type patterns still narrow nothing, since "a failed structural
      // pattern narrows nothing" and negation types do not exist here.
      let patternNode = ie.Pattern as { type?: string, Type?: ParseNode, Operand?: { type?: string, Type?: ParseNode } } | null | undefined;
      let patternNegated = negated;
      while (patternNode?.type === 'MatchNotPattern') {
        patternNegated = !patternNegated;
        patternNode = patternNode.Operand as typeof patternNode;
      }
      const asType = ie.Type ?? (patternNode?.type === 'MatchTypePattern' ? patternNode.Type : null);
      if (!asType) {
        return undefined;
      }
      const t = resolveType(asType as ParseNode.Type);
      return t ? { name: (ie.Expression as unknown as { name: string }).name, type: t, negated: patternNegated } : undefined;
    }
    // `a && b` implies its LEFT operand only where the whole is true, and
    // `a || b` implies the left is false only where the whole is false. So a
    // conjunction narrows the branch it guards and a disjunction narrows the
    // other one, and neither says anything about the branch it does not imply
    // (F77).
    if (e.type === 'LogicalANDExpression') {
      const l = narrowingFactOf((e as unknown as { LogicalANDExpression: ParseNode }).LogicalANDExpression);
      return l ? { ...l, negated: l.negated !== negated, sense: negated ? 'false' : 'true' } : undefined;
    }
    if (e.type === 'LogicalORExpression') {
      const l = narrowingFactOf((e as unknown as { LogicalORExpression: ParseNode }).LogicalORExpression);
      return l ? { ...l, negated: l.negated !== negated, sense: negated ? 'true' : 'false' } : undefined;
    }
    if (e.type === 'EqualityExpression') {
      const eq = e as unknown as { operator: string, EqualityExpression: ParseNode, RelationalExpression: ParseNode };
      // `!==` and `!=` are the same fact with the sense inverted, which is why
      // the forms below need writing only once.
      const inverted = eq.operator === '!==' || eq.operator === '!=';
      const loose = eq.operator === '==' || eq.operator === '!=';
      const sides: [ParseNode, ParseNode][] = [
        [eq.EqualityExpression, eq.RelationalExpression],
        [eq.RelationalExpression, eq.EqualityExpression],
      ];
      for (const [subject, against] of sides) {
        // `typeof x === "string"`: the string names the type.
        if (subject.type === 'UnaryExpression' && (subject as unknown as { operator?: string }).operator === 'typeof') {
          const operand = (subject as unknown as { UnaryExpression: ParseNode }).UnaryExpression;
          if (operand.type !== 'IdentifierReference' || against.type !== 'StringLiteral') {
            continue;
          }
          const t = typeofStringToType((against as unknown as { value: string }).value);
          if (t) {
            return { name: (operand as unknown as { name: string }).name, type: t, negated: negated !== inverted };
          }
          continue;
        }
        if (subject.type !== 'IdentifierReference') {
          continue;
        }
        const name = (subject as unknown as { name: string }).name;
        // `x === null` and `x === undefined`, and the LOOSE forms, which test
        // for either: `x == null` is the idiom for "nullish" and narrows to
        // both, which is what nullishType is for.
        if (against.type === 'NullLiteral' || (against.type === 'IdentifierReference' && (against as unknown as { name: string }).name === 'undefined')) {
          const t = loose
            ? nullishType()
            : (against.type === 'NullLiteral'
              ? makePrimitive('null')
              : makePrimitive('undefined'));
          return { name, type: t as TypeRecord, negated: negated !== inverted };
        }
        // `x === 5` and `x === 'a'`: the literal names a literal type.
        if (against.type === 'NumericLiteral' || against.type === 'StringLiteral' || against.type === 'BooleanLiteral') {
          const lit = staticType(against);
          if (lit) {
            return { name, type: lit as TypeRecord, negated: negated !== inverted };
          }
        }
      }
      // A DISCRIMINANT: `x.kind === 'a'` over a union of object types keeps the
      // members whose `kind` admits that literal. The subject is a property
      // access rather than a binding, and what narrows is the OBJECT, which is
      // what makes a tagged union usable (F77).
      for (const [subject, against] of sides) {
        if (subject.type !== 'MemberExpression') {
          continue;
        }
        const me = subject as unknown as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null };
        if (!me.MemberExpression || me.MemberExpression.type !== 'IdentifierReference' || !me.IdentifierName) {
          continue;
        }
        const objName = (me.MemberExpression as unknown as { name: string }).name;
        const key = me.IdentifierName.name;
        const objType = lookup(objName);
        if (!objType || objType.Kind !== 'union') {
          continue;
        }
        const discriminant = staticType(against);
        if (!discriminant) {
          continue;
        }
        const kept = objType.Members.filter((m) => {
          const shape = structureOf(m as Known);
          if (!shape || shape.Kind !== 'object') {
            return false;
          }
          const prop = shape.Properties.find((pp) => pp.key === key);
          return prop ? IsAssignable(discriminant as TypeRecord, prop.type) : false;
        });
        if (kept.length === 0 || kept.length === objType.Members.length) {
          continue;
        }
        return {
          name: objName,
          type: CanonicalizeType({ Kind: 'union', Members: kept }),
          negated: inverted !== false ? inverted : false,
        };
      }
    }
    // PLAN-declarative-checker-facts.md phase 3. #sec-declared-narrowing: a
    // signature may carry [[Narrows]], and "a binding declared of a constructed
    // guard type narrows at every call through it" - the call IS the test, so
    // this is where the fact comes from. The engine built the field, reflected
    // it and checked its variance, and consumed it nowhere; the built-in
    // `v is T` above drove the same machinery, which is what made the gap
    // invisible until an annotated binding in the guarded branch was asked for.
    //
    // The callee's type is reachable only now that a call-form alias resolves
    // at an annotation (phase 2): [[Narrows]] has no source spelling, so a
    // constructed type behind an alias is the ONLY way a program states one.
    if (e.type === 'CallExpression') {
      const call = e as unknown as { CallExpression?: ParseNode, Arguments?: ParseNode[] };
      const callee = call.CallExpression;
      const args = call.Arguments ?? [];
      if (callee) {
        const calleeType = staticType(callee);
        const signatures = calleeType && calleeType.Kind === 'function' ? calleeType.Signatures : undefined;
        // One signature only: with overloads, WHICH signature the call selects
        // decides what it narrows, and resolving that here would duplicate
        // ResolveOverload's contextual filter for a fact the branch can do
        // without. An overloaded guard narrows nothing rather than guessing.
        const narrows = signatures && signatures.length === 1
          ? (signatures[0] as { Narrows?: readonly { Target: string, Type: TypeRecord }[] }).Narrows
          : undefined;
        if (narrows && narrows.length > 0) {
          // The [[Target]] names a PARAMETER, so the argument in that position
          // is what narrows - and only where that argument is a name there is
          // something to narrow. `guard(o.x)` and `guard(1)` narrow nothing.
          const parameters = (signatures![0] as { Parameters?: readonly { Name?: string }[] }).Parameters ?? [];
          for (const rule of narrows) {
            const position = parameters.findIndex((parameter) => parameter.Name === rule.Target);
            if (position < 0 || position >= args.length) {
              continue;
            }
            const argument = args[position]!;
            const name = narrowableName(argument);
            if (name === null) {
              continue;
            }
            return { name, type: rule.Type, negated };
          }
        }
      }
    }
    return undefined;
  };

  /**
   * #sec-metadata-narrowing: a RELATIONAL comparison of a binding against a
   * compile-time constant, where the binding's type is a parameterization some
   * governing meta type defines `narrow` for.
   *
   * Returns the request to record, or undefined where the shape is not one the
   * clause narrows on. Three gates, each of which the clause states: the
   * subject must be a parameterized value, the other operand must be a
   * compile-time constant ("A comparison against a compile-time constant
   * narrows"), and participation is by HOOK DEFINITION rather than by portion -
   * "each meta type _M_ defining `narrow`" is asked and "each other meta type is
   * unchanged", which is the opposite of how `subtype` participates.
   */
  /** The enclosing request's key, maintained as the walk descends (Q1). */
  let enclosingRequestKey: object | null = null;
  const narrowingRequestsHere: NarrowingRequest[] = [];

  const narrowingRequestOf = (test: ParseNode): Omit<NarrowingRequest, 'parent'> | undefined => {
    if (test.type !== 'RelationalExpression') {
      return undefined;
    }
    const rel = test as ParseNode.RelationalExpression;
    if (rel.operator === 'instanceof' || rel.operator === 'in' || !rel.RelationalExpression) {
      return undefined;
    }
    const left = rel.RelationalExpression as ParseNode;
    const right = rel.ShiftExpression as ParseNode;
    // `x >= 0` and `0 <= x` are the same fact about `x`; the operator is
    // mirrored where the binding is on the right, so the hook always receives
    // the comparison as the BINDING makes it.
    const mirrored: Record<string, string> = {
      '<': '>', '>': '<', '<=': '>=', '>=': '<=',
    };
    let subjectNode = left;
    let constantNode = right;
    let operator: string = rel.operator;
    if (left.type !== 'IdentifierReference' && right.type === 'IdentifierReference') {
      subjectNode = right;
      constantNode = left;
      operator = mirrored[rel.operator]!;
    }
    if (subjectNode.type !== 'IdentifierReference') {
      return undefined;
    }
    const constantType = staticType(constantNode);
    if (!constantType || constantType.Kind !== 'literal') {
      return undefined;
    }
    const name = (subjectNode as unknown as { name: string }).name;
    const subject = lookup(name);
    if (!subject || subject.Kind !== 'parameterized') {
      return undefined;
    }
    // NOT gated on a meta type defining `narrow`, though it looks like it
    // should be. Meta hooks register when a MetaDeclaration EVALUATES, and this
    // pass runs before evaluation - so during the walk NO hook is registered and
    // the gate could never pass, for a meta type declared in the same script
    // above its own use, which is legal and is the ordinary case.
    //
    // Recording unconditionally costs nothing: the clause makes the portion of
    // "each other meta type" UNCHANGED, so a request whose meta types define no
    // `narrow` resolves to the type it started with. Deciding participation is
    // the resolution's job, where the hooks exist, rather than the walk's.
    return {
      key: test, name, operator, constant: constantType.Value, subject,
    };
  };

  /**
   * Walk a test and the two branches it guards, with the binding the test
   * speaks about narrowed in each. Shared by `if`, `while`, and the conditional
   * operator, which differ only in what they guard (F76).
   */
  /**
   * The narrowing an ASSERTION statement states, applied to the rest of its
   * block.
   *
   * #sec-declared-narrowing gives [[Narrows]] two forms. The `boolean` one is a
   * test and narrows a branch, which `narrowingFactOf` reads. The ~void~ one is
   * an assertion - `assertU8(box);` - and narrows every position the call
   * dominates, so there is no branch to hang it on and it belongs here, where
   * the statements it dominates are still to be walked.
   */
  const applyAssertionNarrowing = (statement: ParseNode): void => {
    if (statement.type !== 'ExpressionStatement') {
      return;
    }
    const expression = (statement as unknown as { Expression?: ParseNode }).Expression;
    if (!expression || expression.type !== 'CallExpression') {
      return;
    }
    const call = expression as unknown as { CallExpression?: ParseNode, Arguments?: ParseNode[] };
    const callee = call.CallExpression;
    if (!callee) {
      return;
    }
    const calleeType = staticType(callee);
    if (!calleeType || calleeType.Kind !== 'function' || calleeType.Signatures.length !== 1) {
      return;
    }
    const signature = calleeType.Signatures[0] as {
      Return?: TypeRecord,
      Narrows?: readonly { Target: string, Type: TypeRecord }[],
      Parameters?: readonly { Name?: string }[],
    };
    // The ASSERTION form is the one returning ~void~. A `boolean` guard called
    // as a statement asserts nothing - its answer was discarded - so narrowing
    // on it would claim what the program did not test.
    if (signature.Return !== undefined && signature.Return !== null
      && (signature.Return as { Kind?: string }).Kind !== 'void') {
      return;
    }
    const args = call.Arguments ?? [];
    const parameters = signature.Parameters ?? [];
    for (const rule of signature.Narrows ?? []) {
      const position = parameters.findIndex((parameter) => parameter.Name === rule.Target);
      if (position < 0 || position >= args.length) {
        continue;
      }
      const name = narrowableName(args[position]!);
      if (name !== null) {
        declareNarrowed(name, rule.Type as Known);
      }
    }
  };

  const walkGuarded = (test: ParseNode, whenTrueNode: ParseNode | null, whenFalseNode: ParseNode | null) => {
    const fact = narrowingFactOf(test);
    // #sec-metadata-narrowing: record the comparison for the checking pass,
    // which can call `narrow` where this pass cannot. The enclosing request is
    // the parent, so the resolution sweep can compose an inner narrowing onto
    // its outer one in a single pass.
    const request = narrowingRequestOf(test);
    if (request) {
      narrowingRequestsHere.push({ ...request, parent: enclosingRequestKey });
    }
    walk(test);
    // The enclosing key covers BOTH paths. A relational comparison yields no
    // type-level fact, so the guard below returns early - and that is exactly
    // the shape a narrowing request has, so skipping the push here left every
    // nested request without its parent, which is the one thing the parent link
    // exists for.
    const outerKey = enclosingRequestKey;
    if (request) {
      enclosingRequestKey = request.key;
    }
    try {
      // A3.2: #sec-metadata-narrowing, consumed. The checking pass resolved this
      // comparison by calling `narrow`, which this walk cannot; where it did,
      // the branch types are its answer. Recorded through `declareNarrowed` so
      // an assignment invalidates a metadata narrowing exactly as it
      // invalidates a type-level one.
      const resolved = request ? GetNarrowingResolution(root, request.key) : undefined;
      if (resolved) {
        const newFrame = () => ({
          bindings: new Map(), constLiterals: new Set<string>(), constLiteralTypes: new Map<string, TypeRecord>(), letConstants: new Set<string>(), immutableNames: new Set<string>(), declaredNames: new Set<string>(), aliases: new Map(), enums: new Map(), enumBindings: new Map(),
        });
        frames.push(newFrame());
        declareNarrowed(request!.name, resolved.whenTrue);
        walk(whenTrueNode);
        frames.pop();
        frames.push(newFrame());
        declareNarrowed(request!.name, resolved.whenFalse);
        walk(whenFalseNode);
        frames.pop();
        return;
      }
      if (!fact) {
        // PLAN-declarative-checker-facts.md phase 3. A CALL that yields no fact
        // may be a declared guard whose callee this walk cannot type yet - a
        // constructed guard behind an alias resolves only after the pass
        // pre-evaluates it, and this walk may be the parse-time one. Judging
        // the branch now would report what the later walk would narrow away,
        // and that verdict is unappealable, so defer instead: walk for its
        // other effects and collect no assignability errors.
        //
        // Only for a call whose callee has NO static type here. A call that
        // types to something without [[Narrows]] yields no fact for a real
        // reason and is judged normally, which keeps the suppression from
        // swallowing ordinary errors inside an ordinary `if (f(x))`.
        // Peeled the way narrowingFactOf peels: `!guard(x)` and `(guard(x))`
        // are the same test, and the negated form is where the ELSE branch is
        // the narrowed one - so missing it deferred nothing exactly where the
        // narrowing lands.
        let guardTest = test;
        for (;;) {
          if (guardTest.type === 'ParenthesizedExpression') {
            guardTest = (guardTest as unknown as { Expression: ParseNode }).Expression;
            continue;
          }
          if (guardTest.type === 'UnaryExpression' && (guardTest as unknown as { operator?: string }).operator === '!') {
            guardTest = (guardTest as unknown as { UnaryExpression: ParseNode }).UnaryExpression;
            continue;
          }
          break;
        }
        const unresolvedGuard = guardTest.type === 'CallExpression'
          && staticType((guardTest as unknown as { CallExpression?: ParseNode }).CallExpression ?? guardTest) === null;
        if (unresolvedGuard) {
          deferredGuardDepth += 1;
        }
        try {
          walk(whenTrueNode);
          walk(whenFalseNode);
        } finally {
          if (unresolvedGuard) {
            deferredGuardDepth -= 1;
          }
        }
        return;
      }
      walkGuardedBranches(fact, whenTrueNode, whenFalseNode);
    } finally {
      enclosingRequestKey = outerKey;
    }
  };

  /** The narrowed walk of the two branches, split out so the parent link above
   * covers both without duplicating the restore. */
  const walkGuardedBranches = (fact: NonNullable<ReturnType<typeof narrowingFactOf>>, whenTrueNode: ParseNode | null, whenFalseNode: ParseNode | null) => {
    const source = lookup(fact.name) ?? ({ Kind: 'any' } as TypeRecord);
    const whenTrue = fact.negated ? NarrowFrom(source, fact.type) : NarrowTo(source, fact.type);
    const whenFalse = fact.negated ? NarrowTo(source, fact.type) : NarrowFrom(source, fact.type);
    // sec-narrowing: "It is a type error to apply a narrowing form where the
    // test can never succeed or can never fail, since the branch it guards is
    // then dead code the program did not intend." The checker had this rule and
    // reached it only for a test over a TYPE, never for one over a binding,
    // which is the shape a program writes (F76).
    // The dead-branch rule reasons from the STATIC type, so it applies only
    // where membership is a stable fact about the value. It is not, for an
    // object type or a refinement: sec-isoftype says in as many words that the
    // object case "is checked at the boundary but not afterwards", so a binding
    // of an object type can stop satisfying it through mutation, and a `where`
    // predicate is re-evaluated on every test. The suite has the case that
    // proves it - `let p: Pos = ...; p.a = 0; p is Pos` is *false* at run time
    // while the static type still says `Pos` - and reporting that branch as
    // dead would have contradicted a documented behaviour (F76). So the rule
    // fires for the kinds whose membership a value cannot lose.
    const decidable = (t: TypeRecord): boolean => t.Kind === 'primitive' || t.Kind === 'literal'
      || (t.Kind === 'union' && t.Members.every(decidable));
    if (source.Kind !== 'any' && !fact.sense && decidable(source) && decidable(fact.type)) {
      if (whenTrue === empty) {
        const completion = Throw.TypeError('the $1 test can never succeed, so the branch it guards is dead code', Value(displayType(fact.type))) as ThrowCompletion;
        errors.push(completion.Value as ObjectValue);
      } else if (whenFalse === empty) {
        const completion = Throw.TypeError('the $1 test can never fail, so the branch it guards is dead code', Value(displayType(fact.type))) as ThrowCompletion;
        errors.push(completion.Value as ObjectValue);
      }
    }
    if (whenTrueNode) {
      pushBlock(() => {
        if (whenTrue !== empty && fact.sense !== 'false') {
          declareNarrowed(fact.name, whenTrue as Known);
        }
        walk(whenTrueNode);
      });
    }
    if (whenFalseNode) {
      pushBlock(() => {
        if (whenFalse !== empty && fact.sense !== 'true') {
          declareNarrowed(fact.name, whenFalse as Known);
        }
        walk(whenFalseNode);
      });
    }
  };

  /** The type a `typeof` string names, for the narrowing form that tests one. */
  const typeofStringToType = (s: string): TypeRecord | null => {
    switch (s) {
      case 'string': return makePrimitive('string');
      case 'number': return makePrimitive('number');
      case 'boolean': return makePrimitive('boolean');
      case 'bigint': return makePrimitive('bigint');
      case 'symbol': return makePrimitive('symbol');
      case 'undefined': return makePrimitive('undefined');
      case 'object': return makePrimitive('object');
      default: return null;
    }
  };

  /**
   * A method of a typed COLLECTION takes its key and value positions at the
   * declared types, which sec-array-defaults-and-stores states beside the
   * array's element positions and which the run time enforces. The checker
   * knowing them is what turns `s.add(300)` on a `Set.<uint8>` from a run-time
   * RangeError into the Early Error a statically determinable mistake
   * deserves - the same step the array methods took in F70, and the reason a
   * collection's methods were the array methods' one remaining asymmetry.
   *
   * The signatures are the DESIGN's own, written out in the weak-reference
   * section of the README rather than invented here: `add(value: T): Set.<T>`,
   * `has(value: T): boolean`, `delete(value: T): boolean`, and for the keyed
   * form `get(key: K): V | undefined`, `set(key: K, value: V): Map.<K, V>`.
   * The `undefined` in `get`'s return is the design's and is load-bearing: a
   * lookup that finds nothing answers *undefined*, so `let x: uint8 = m.get(k)`
   * is a mistake the types can see.
   */
  /**
   * Whether a function body's straight-line exit is a `return` with a value.
   *
   * This is the second half of the return-boundary condition and the half that
   * is easy to forget: a function whose every explicit return is proven can
   * STILL fall off the end, and falling off the end hands back *undefined*,
   * which no numeric or object annotation admits. Requiring the body to end in
   * a `return` makes that path impossible without a control-flow graph.
   *
   * It is deliberately syntactic and therefore conservative. A body ending in
   * `if (c) return a; else return b;` is not elided even though both arms
   * return, and a CONCISE arrow body is not elided at all - it has no
   * ReturnStatement node to prove. Both are misses rather than errors: the
   * boundary runs and the program is correct, which is the right direction to
   * be wrong in when the alternative is skipping a check that was needed.
   */
  const endsWithReturn = (body: ParseNode | readonly ParseNode[] | null | undefined): boolean => {
    if (!body) {
      return false;
    }
    const list = Array.isArray(body)
      ? body as readonly ParseNode[]
      : (body as { FunctionStatementList?: readonly ParseNode[], StatementList?: readonly ParseNode[] }).FunctionStatementList
        ?? (body as { StatementList?: readonly ParseNode[] }).StatementList;
    if (!list || list.length === 0) {
      return false;
    }
    const last = list[list.length - 1]!;
    return last.type === 'ReturnStatement' && !!(last as { Expression?: ParseNode | null }).Expression;
  };

  /**
   * The RETURN TYPE of a function literal written at a call, inferred from its
   * body with the parameters bound to the types the position supplies.
   *
   * F80 could read a CONCISE arrow body, whose body IS the returned
   * expression, and left a BLOCK body at ~any~ - so `a.map(x => x)` flowed and
   * `a.map(x => { return x; })` did not, which is the same function written
   * two ways. This is the machinery that closes it, and it is the join of the
   * body's `return` expressions:
   *
   *  - Every `return` inside the literal contributes the Static Type of its
   *    expression. A `return` with NO expression contributes *undefined*.
   *  - A body that can complete without returning also contributes
   *    *undefined*, since falling off the end answers it. `endsWithReturn` is
   *    the same conservative test the return-boundary elision uses (F82): a
   *    body ending in `if (c) return a; else return b;` is treated as able to
   *    complete, which loses precision and cannot lose soundness.
   *  - If any contribution is UNKNOWN the whole inference is unknown, because
   *    a union containing an unknown arm is unknown. Answering the other arms
   *    would state more than the body supports.
   *  - Returns inside a NESTED function belong to that function and are not
   *    collected; the walk stops at every function form.
   */
  /**
   * proposal-runtime-types #sec-inferred-return-types: the functions of a scope
   * whose return type is to be inferred, queued while their signatures are
   * built and resolved once all of them are in scope.
   */
  /**
   * Non-zero while an inference is running. #sec-anchored-contributions: a
   * function that does not participate still ANSWERS a participating function's
   * inference, and the answer types the asker without being published for the
   * answerer. So its provisional type must be readable from inside an inference
   * and invisible outside one, which is what this depth distinguishes: with it
   * at zero a call of an unpublished function has the ~any~ Static Type, as a
   * legacy program requires.
   */
  let inferenceDepth = 0;

  /**
   * #sec-inference-fixpoint: the signatures whose inference is running right
   * now. A contribution that reaches one of them is a recursive reference, and
   * it contributes `never` - which vanishes from a join that has any other
   * member, because `never` is the identity of union. So a function with a base
   * case publishes what the base case gives, and one that only calls itself
   * publishes `never`, which is what a function that never returns a value has.
   *
   * Without this a recursive call typed as unknown and poisoned the join, so
   * every recursive function published nothing at all.
   */
  const inferencesInProgress = new Set<object>();

  /**
   * #sec-inference-fixpoint: the queued inference for a signature, so that a
   * contribution which CALLS a not-yet-published function can drive that
   * function's inference on demand.
   *
   * This is what settles a mutual cycle. Computing `a`, the call to `b` runs
   * `b`'s inference with `a` already marked; `b`'s own call to `a` then reaches
   * the mark and contributes `never`, which vanishes from the join, so `b`
   * settles on what its other paths give and `a` settles on that. Marking the
   * whole queue instead - the first attempt - made every call to an unpublished
   * function answer `never` during any inference, which is wrong for the
   * ordinary wrapper and broke 115 tests.
   */
  const pendingBySignature = new Map<object, {
    signature: { Return: Known, InferredReturn?: Known, ProvisionalReturn?: Known },
    fn: ParseNode,
    parameterTypes: readonly Known[],
    signatureTyped: boolean,
  }>();

  /** Compute and cache a queued function's provisional type, on demand. */
  const driveInference = (only: object): Known => {
    const item = pendingBySignature.get(only);
    if (!item || inferencesInProgress.has(only)) {
      return null;
    }
    inferencesInProgress.add(only);
    inferenceDepth += 1;
    let inferred: Known;
    try {
      inferred = inferredReturnType(item.fn, item.parameterTypes, null, { anchored: false });
    } finally {
      inferenceDepth -= 1;
      inferencesInProgress.delete(only);
    }
    if (inferred) {
      item.signature.ProvisionalReturn = inferred;
    }
    return inferred;
  };

  const pendingInferences: {
    signature: { Return: Known, InferredReturn?: Known, ProvisionalReturn?: Known },
    fn: ParseNode,
    parameterTypes: readonly Known[],
    signatureTyped: boolean,
    /**
     * The type parameters the declaration binds, which must be in scope while
     * its body is read: the inference runs after the collection loop that
     * pushed them, so it pushes them again or `T` resolves to nothing and the
     * body types as ~any~.
     */
    typeParameterNames?: readonly string[],
    /** A generator, whose inference computes _Y_ and rebuilds its Generator type. */
    generator?: { asyncGenerator: boolean },
    /** An async function, whose inference is of the type its result RESOLVES with. */
    asyncFunction?: boolean,
  }[] = [];

  /**
   * #sec-anchored-contributions: whether a contribution is ANCHORED, meaning its
   * Static Type derives from a declared type rather than from a literal alone.
   *
   * A literal type is the mark of an unanchored contribution: `return 'foo'`
   * knows its type perfectly well and still says nothing a program annotated,
   * while `return f()` where `f` declares `: uint32` reports `uint32` because a
   * declaration said so, and a read of a typed binding reports its annotation
   * for the same reason. So a known, non-literal contribution is one that
   * derives from an annotation somewhere, and an unknown one derives from
   * nothing at all.
   */

  /** Array literals every element of which is a literal; they anchor nothing. */
  const literalDerivedArrays = new WeakSet<object>();



  /**
   * #sec-inference-fixpoint: publish an inferred return type for each queued
   * function, repeating until nothing changes.
   *
   * Repetition is what lets one inference feed another: `g` returning `f()`
   * cannot be typed until `f` is, and the two may be written in either order. A
   * function still unresolved when the passes run out contributed something
   * unknown - a recursive call reaches its own unpublished signature - and
   * publishing nothing for it is the conservative answer, which leaves it
   * exactly as untyped as it was before this operation existed.
   */
  /** The declared name of a function node, for a diagnostic. */
  const nameOfDeclaration = (fn: ParseNode): string | null => {
    const id = (fn as { BindingIdentifier?: { name?: string } | null }).BindingIdentifier;
    return id?.name ?? null;
  };

  const publishInferredReturns = (): void => {
    if (pendingInferences.length === 0) {
      return;
    }
    const queue = pendingInferences.splice(0, pendingInferences.length);
    for (const item of queue) {
      if (!item.generator && !item.asyncFunction) {
        pendingBySignature.set(item.signature as object, item);
      }
    }
    // Two passes settle a chain written in either order; a third changes
    // nothing that a second did not, absent recursion, which this cycle leaves
    // unpublished rather than iterated to a fixpoint.
    // Iterate to convergence. Two passes settle a chain written in either
    // order; a cycle needs one pass per edge before it stops changing, and the
    // bound is what keeps a body whose type grows at every step - a
    // self-reference under a type constructor - from iterating forever. Such a
    // function simply does not publish, which is the conservative answer this
    // increment gives in place of the error #sec-inference-fixpoint specifies.
    for (let pass = 0; pass < 8; pass += 1) {
      let changed = false;
      for (const item of queue) {
        if (item.generator) {
          // _Y_ is computed here rather than while signatures are built, for
          // the reason the return inference is: a `yield` whose operand calls
          // another declaration cannot be typed until that declaration is in
          // scope, and the pass that builds signatures has none of them yet.
          const ya = { anchored: false };
          inferenceDepth += 1;
          let inferredYield: Known;
          try {
            inferredYield = inferredReturnType(item.fn, item.parameterTypes, null, ya, 'yield');
          } finally {
            inferenceDepth -= 1;
          }
          if (inferredYield && (item.signatureTyped || ya.anchored) && inferredYield.Kind !== 'void') {
            const rebuilt = generatorDeclaredType(inferredYield, item.generator.asyncGenerator);
            // Into [[InferredReturn]], not [[Return]]. A generator with no
            // annotation declares no return type, so writing the refined
            // Generator type into the declared field would let an INFERRED type
            // license an elision, which #sec-published-return-types forbids, and
            // would put it in reach of identity and overload ranking besides.
            if (rebuilt && (!item.signature.InferredReturn || !SameType(item.signature.InferredReturn, rebuilt))) {
              item.signature.InferredReturn = rebuilt;
              changed = true;
            }
          }
          continue;
        }
        if (item.asyncFunction) {
          // #sec-inference-and-function-forms: publish `Promise.<T, any>`. The
          // reject type is never inferred - anything may throw, and the
          // convention that `undefined` there means a promise that never
          // rejects is a claim no body supports - so `any` is what an inference
          // can honestly say about it.
          const aa = { anchored: false };
          inferenceDepth += 1;
          let resolves: Known;
          try {
            resolves = inferredReturnType(item.fn, item.parameterTypes, null, aa, 'resolve');
          } finally {
            inferenceDepth -= 1;
          }
          if (resolves && (item.signatureTyped || aa.anchored)) {
            const settled = resolves.Kind === 'primitive' && resolves.Name === 'undefined'
              ? voidTypeRecord
              : resolves;
            const published = libraryTypeRecord('Promise', [settled, anyTypeRecord]);
            if (published && (!item.signature.InferredReturn || !SameType(item.signature.InferredReturn, published))) {
              item.signature.InferredReturn = published;
              publishedReturnTypes.set(item.fn as unknown as object, published);
              changed = true;
            }
          }
          continue;
        }
        const anchorage: { anchored: boolean, from?: string | null, origins?: { type: TypeRecord, from: string }[] } = { anchored: false };
        if (item.typeParameterNames) {
          typeParameterScopes.push(scopeOfNames(item.typeParameterNames));
        }
        inferenceDepth += 1;
        // Only the signature being computed is marked. Marking the whole queue
        // would let a MUTUAL cycle settle, but it also makes every call to a
        // not-yet-published function answer `never` during an inference, which
        // is wrong for the ordinary case and for query inference alike - it
        // broke 115 tests. Mutual recursion therefore does not publish yet.
        inferencesInProgress.add(item.signature as object);
        let inferred: Known;
        try {
          inferred = inferredReturnType(item.fn, item.parameterTypes, null, anchorage);
        } finally {
          inferencesInProgress.delete(item.signature as object);
          inferenceDepth -= 1;
          if (item.typeParameterNames) {
            typeParameterScopes.pop();
          }
        }
        // Every queued function gets a PROVISIONAL type, whether or not it
        // participates, so that a participating function asking about this one
        // gets an answer. Publication is the separate step below.
        // Compared by SameType, not by identity: each pass builds a fresh
        // record, so an identity test reported a change every time. The
        // fixpoint then ran its full pass budget on every program and never
        // detected non-convergence, because it could not tell a type that grows
        // from one that is merely rebuilt.
        if (inferred && (!item.signature.ProvisionalReturn
          || !SameType(item.signature.ProvisionalReturn, inferred))) {
          item.signature.ProvisionalReturn = inferred;
          changed = true;
        }
        // A join of ~any~ publishes nothing: a function whose result is unknown
        // is indistinguishable from one that never participated.
        if (!inferred) {
          continue;
        }
        // Participation: the signature declares a type, or a contribution is
        // anchored. The second is what carries a type one call past the
        // annotation that established it.
        if (!item.signatureTyped && !anchorage.anchored) {
          continue;
        }
        // #sec-inferred-result-type as harmonized: where every contribution is
        // valueless the join is `void`, which is the annotation such a function
        // would have been given. A bare `undefined` join is exactly that case,
        // since a body that MIXES a valueless path with a value-carrying one
        // joins to a union rather than to `undefined` alone.
        const published = inferred.Kind === 'primitive' && inferred.Name === 'undefined'
          ? voidTypeRecord
          : inferred;
        const previous = item.signature.InferredReturn;
        if (!previous || !SameType(previous, published)) {
          item.signature.InferredReturn = published;
          changed = true;
        }
        if (anchorage.from) {
          publishedAnchors.set(item.signature as object, anchorage.from);
        }
        if (anchorage.origins && anchorage.origins.length > 0) {
          publishedOrigins.set(item.signature as object, anchorage.origins);
        }
        // The run time enforces what is published, so the type is recorded
        // against the declaration the boundary will look it up from - EXCEPT
        // where the published type is an expression over the declaration's type
        // parameters. Such a type means something only once a call binds them,
        // and the boundary sees one function for every instantiation, so
        // enforcing it there refused `id(5)` against a bare `T`. The checker
        // still publishes it, and substitutes it per call.
        if (!mentionsTypeParameter(published)) {
          publishedReturnTypes.set(item.fn as unknown as object, published);
        }
      }
      if (!changed) {
        break;
      }
      if (pass === 7) {
        // #sec-inference-fixpoint (r19): the repetition did not reach a
        // fixpoint. That happens when the in-progress type recurs INSIDE a type
        // constructor - `function w(a: uint32) { return [w(a)]; }` yields
        // `[].<never>`, then `[].<[].<never>>`, and so on - so there is no type
        // to publish and inference produces no equirecursive ones. The program
        // says what it meant with an annotation, and the diagnostic says so
        // rather than leaving the function silently untyped.
        for (const item of queue) {
          if (item.signature.InferredReturn || item.signature.ProvisionalReturn) {
            const completion = Throw.TypeError('the return type of $1 grows at every step and cannot be inferred; write it', Value(nameOfDeclaration(item.fn) ?? 'this function')) as ThrowCompletion;
            errors.push(completion.Value as ObjectValue);
            item.signature.InferredReturn = undefined;
            item.signature.ProvisionalReturn = undefined;
          }
        }
      }
    }
  };

  /**
   * #sec-inferred-return-types for a function LITERAL: an arrow or a function
   * expression.
   *
   * A literal publishes for one purpose only, and it is worth saying which.
   * Its CALL SITES are unaffected, because a binding without an annotation has
   * the ~any~ Static Type whatever its initializer - `const k = (a: uint32) =>
   * 's'` leaves `k` untyped, and `:=` or an annotation is what carries the type
   * to a caller. What publication buys here is the RETURN BOUNDARY: without it
   * a literal that derives its result from a declared type hands back whatever
   * its body produced, so a replaced dependency's lie leaves the function
   * unreported, which is the case #sec-published-return-types exists to close.
   */
  /**
   * The object type an OBJECT LITERAL describes, for the transparency rule only.
   *
   * `function f(x: number) { const o = { p: g() }; return o.p; }` published
   * nothing, because an object literal has no Static Type and so a local
   * initialized with one had nothing to read. With the object ANNOTATED the
   * member read carries its type, so the gap is the literal rather than the
   * member read.
   *
   * Computed HERE rather than given to the literal as its Static Type, for the
   * reason the array-literal cycle measured: typing an expression form for every
   * consumer reaches library signatures, where literal propagation builds an
   * argument at the element type and changes what an untyped program means. This
   * type has one consumer - the contribution - and appears in no expression's
   * Static Type.
   *
   * Conservative by construction: a spread, a computed key, a method, an
   * accessor, or a member whose own type is unknown yields nothing at all,
   * rather than an object type that omits what it could not read and thereby
   * describes a value with fewer members than it has.
   */
  const objectLiteralShape = (node: ParseNode | null | undefined): Known => {
    if (!node || node.type !== 'ObjectLiteral') {
      return null;
    }
    const members = (node as unknown as { PropertyDefinitionList?: readonly ParseNode[] }).PropertyDefinitionList ?? [];
    if (members.length === 0) {
      return null;
    }
    const Properties: { key: string, type: TypeRecord, optional: boolean }[] = [];
    for (const member of members) {
      if (!member || member.type !== 'PropertyDefinition') {
        return null;
      }
      const prop = member as unknown as {
        PropertyName?: { name?: string, value?: string, type?: string } | null,
        AssignmentExpression?: ParseNode | null,
        TypeAnnotation?: ParseNode.TypeAnnotation | null,
      };
      const key = prop.PropertyName?.name ?? prop.PropertyName?.value;
      if (!key || prop.PropertyName?.type === 'ComputedPropertyName' || !prop.AssignmentExpression) {
        return null;
      }
      const declaredMember = prop.TypeAnnotation ? resolveType(prop.TypeAnnotation.Type) : null;
      // Recursive: a member that is itself an object literal has no Static Type
      // either, and `{ inner: { p: g() } }` is an ordinary shape.
      const memberType = declaredMember
        ?? staticType(prop.AssignmentExpression)
        ?? objectLiteralShape(prop.AssignmentExpression);
      if (!memberType) {
        return null;
      }
      Properties.push({ key, type: widen(memberType) as TypeRecord, optional: false });
    }
    return { Kind: 'object', Properties, IndexSignatures: [] } as unknown as Known;
  };

  const publishLiteralReturn = (fn: ParseNode, parameterTypes: readonly Known[]): void => {
    if ((fn as { TypeAnnotation?: unknown }).TypeAnnotation) {
      return;
    }
    const anchorage: { anchored: boolean, from?: string | null, origins?: { type: TypeRecord, from: string }[] } = { anchored: false };
    inferenceDepth += 1;
    let inferred: Known;
    try {
      inferred = inferredReturnType(fn, parameterTypes, null, anchorage);
    } finally {
      inferenceDepth -= 1;
    }
    if (!inferred) {
      return;
    }
    const signatureTyped = parameterTypes.some((t) => t !== null);
    if (!signatureTyped && !anchorage.anchored) {
      return;
    }
    const published = inferred.Kind === 'primitive' && inferred.Name === 'undefined'
      ? voidTypeRecord
      : inferred;
    if (published.Kind !== 'void') {
      publishedReturnTypes.set(fn as unknown as object, published);
    }
  };

  const inferredReturnType = (fn: ParseNode, parameterTypes: readonly Known[], wanted: Known = null, anchorage: { anchored: boolean, from?: string | null, origins?: { type: TypeRecord, from: string }[] } = { anchored: false }, mode: 'return' | 'yield' | 'resolve' = 'return'): Known => {
    // A method's parameters are its UniqueFormalParameters, and a getter has
    // none at all.
    const params = (fn as { ArrowParameters?: readonly ParseNode[], FormalParameters?: readonly ParseNode[] }).ArrowParameters
      ?? (fn as { FormalParameters?: readonly ParseNode[] }).FormalParameters
      ?? (fn as { UniqueFormalParameters?: readonly ParseNode[] }).UniqueFormalParameters;
    if (mode === 'resolve') {
      // #sec-inference-and-function-forms: an async function infers the type its
      // result RESOLVES with, so a contribution that is itself a promise
      // contributes what IT resolves with, as `await` would.
      if (fn.type !== 'AsyncFunctionDeclaration' && fn.type !== 'AsyncFunctionExpression'
          && fn.type !== 'AsyncArrowFunction' && fn.type !== 'AsyncMethod') {
        return null;
      }
    } else if (mode === 'yield') {
      // #sec-inference-and-function-forms: a generator's _Y_ is the join of what
      // its `yield` operands contribute. The walk is the same one the return
      // contributions use - it stops at a nested function for the same reason -
      // so the collector below is shared and only the node it reads differs.
      if (fn.type !== 'GeneratorDeclaration' && fn.type !== 'AsyncGeneratorDeclaration'
          && fn.type !== 'GeneratorExpression' && fn.type !== 'AsyncGeneratorExpression'
          && fn.type !== 'GeneratorMethod' && fn.type !== 'AsyncGeneratorMethod') {
        return null;
      }
    } else if (fn.type !== 'ArrowFunction' && fn.type !== 'FunctionExpression'
        && fn.type !== 'FunctionDeclaration' && fn.type !== 'MethodDefinition') {
      // A generator or async literal's result is an iterator or a promise, not
      // the returned value; those judgments are not this operation's business.
      // #sec-inference-and-function-forms states what each of those publishes;
      // this operation is the plain-return case the others are built on.
      return null;
    }
    const declareParameters = () => {
      let i = 0;
      for (const prm of params ?? []) {
        if (prm.type === 'SingleNameBinding' && (prm as ParseNode.SingleNameBinding).BindingIdentifier) {
          const annotated = (prm as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
          // An ANNOTATION wins over the position, since the program said what
          // it wanted; the position fills a parameter that said nothing.
          let t = annotated ? resolveType(annotated.Type) : (parameterTypes[i] ?? null);
          // An OPTIONAL parameter with no default is *undefined* where the call
          // omits it, so its type in the body is `T | undefined`. Reading it as
          // `T` published a type the function's own result fails:
          // `function f(a?: uint8) { return a; }` inferred `uint8`, and `f()`
          // then threw at its own return handing back the *undefined* the
          // parameter is defined to hold. The parameter boundary already agrees
          // - it admits the omitted argument - so this is the body's view
          // catching up with it.
          const optional = (prm as { Optional?: boolean }).Optional === true
            && !(prm as { Initializer?: unknown }).Initializer;
          if (t && optional) {
            t = CanonicalizeType({ Kind: 'union', Members: [t, makePrimitive('undefined')] }) as Known;
          }
          declare((prm as ParseNode.SingleNameBinding).BindingIdentifier!.name, t);
        }
        i += 1;
      }
    };

    // A concise arrow body: the expression IS the return. Two wrapper nodes
    // deep - `ConciseBody` holds an `ExpressionBody` which holds it (F80).
    let body = (fn as { ConciseBody?: ParseNode, FunctionBody?: ParseNode }).ConciseBody
      ?? (fn as { FunctionBody?: ParseNode }).FunctionBody
      ?? (fn as { GeneratorBody?: ParseNode }).GeneratorBody
      ?? (fn as { AsyncGeneratorBody?: ParseNode }).AsyncGeneratorBody
      ?? (fn as { AsyncBody?: ParseNode }).AsyncBody;
    if (body && body.type === 'ConciseBody') {
      body = (body as unknown as { ExpressionBody: ParseNode }).ExpressionBody;
    }
    if (body && body.type === 'ExpressionBody') {
      body = (body as unknown as { AssignmentExpression: ParseNode }).AssignmentExpression;
    }
    if (!body) {
      return null;
    }
    // A generator's body is a GeneratorBody, not a FunctionBody, and it holds
    // its statements in the same field. Without admitting it here the body fell
    // to the concise-expression branch below and no `yield` was ever collected.
    if (body.type !== 'FunctionBody' && body.type !== 'GeneratorBody' && body.type !== 'AsyncGeneratorBody'
        && body.type !== 'AsyncBody') {
      return pushBlock(() => {
        declareParameters();
        // Typed AT the return the position wants, where there is one, so a
        // literal in the body propagates the way it would at any other check
        // site: `() => ({ value: 1, done: false })` at an IteratorResult gives
        // that record, while `() => "wrong"` at a `uint8` gives a literal string
        // type and is refused. Using the WANTED type as the answer instead
        // would make every unannotated literal trivially conform.
        const conciseType = wanted ? staticTypeIn(body!, wanted) : staticType(body!);
        // The concise body IS the return, so it is the contribution, and
        // anchoring is read off it exactly as the block collector reads it off
        // each `return`. Without this a concise arrow never counted as
        // participating, so `() => f()` published nothing while
        // `() => { return f(); }` published - the two spellings of one function
        // disagreeing, which is what #sec-inferred-result-type exists to
        // prevent.
        if (conciseType && conciseType.Kind !== 'literal') {
          anchorage.anchored = true;
          anchorage.from = anchorage.from ?? anchorDescription(body as ParseNode);
        }
        return conciseType;
      });
    }

    const list = (body as unknown as { FunctionStatementList?: readonly ParseNode[] }).FunctionStatementList;
    if (!list) {
      return null;
    }
    return pushBlock(() => {
      declareParameters();
      const contributions: TypeRecord[] = [];
      let unknown = false;
      const collect = (n: ParseNode | null | undefined): void => {
        if (!n || typeof n !== 'object' || unknown) {
          return;
        }
        if (n.type === 'ArrowFunction' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration'
          || n.type === 'GeneratorExpression' || n.type === 'GeneratorDeclaration'
          || n.type === 'AsyncFunctionExpression' || n.type === 'AsyncFunctionDeclaration'
          || n.type === 'AsyncArrowFunction' || n.type === 'MethodDefinition'
          || n.type === 'ClassDeclaration' || n.type === 'ClassExpression') {
          return;
        }
        if (mode === 'yield') {
          if (n.type === 'YieldExpression') {
            const y = n as unknown as { AssignmentExpression?: ParseNode | null, hasStar?: boolean };
            if (y.hasStar) {
              // `yield*` contributes the yield type of its OPERAND, which this
              // increment does not read: an unknown contribution is the honest
              // answer rather than the operand's own type, which would be the
              // iterable rather than what it yields.
              unknown = true;
              return;
            }
            const t = y.AssignmentExpression ? staticType(y.AssignmentExpression) : null;
            if (!t) {
              unknown = true;
              return;
            }
            if (t.Kind !== 'literal') {
              anchorage.anchored = true;
            }
            contributions.push(widen(t));
            // Fall through: a `yield` may contain another in its operand.
          }
        } else if (n.type === 'LexicalDeclaration' || n.type === 'VariableStatement') {
          // #sec-anchored-contributions: "a binding's annotation" anchors a
          // contribution, so a body's own typed bindings must be in scope while
          // its returns are read. The pass declares the PARAMETERS and nothing
          // else, so `function g(a: uint32) { let t: uint8 = 1; return t; }`
          // saw `t` as undeclared, read the contribution as unknown, and
          // published nothing - while the same function returning the parameter
          // or a declared call published correctly. Declared as the walk reaches
          // them, which is source order, so a declaration precedes the returns
          // that read it.
          const list = (n as unknown as { BindingList?: readonly ParseNode[], VariableDeclarationList?: readonly ParseNode[] });
          for (const b of list.BindingList ?? list.VariableDeclarationList ?? []) {
            const bound = b as unknown as {
              BindingIdentifier?: { name?: string } | null,
              TypeAnnotation?: ParseNode.TypeAnnotation | null,
            };
            const bname = bound.BindingIdentifier?.name;
            if (!bname) {
              continue;
            }
            if (bound.TypeAnnotation) {
              const bt = resolveType(bound.TypeAnnotation.Type);
              if (bt) {
                declare(bname, bt);
              }
              continue;
            }
            // An UNANNOTATED local that cannot change is a name for its
            // initializer's value, and a contribution that reads it is the
            // initializer's type widened. Without this, extracting a
            // subexpression into a local - the most ordinary refactor there is -
            // silently dropped the function's inferred return type:
            // `function f(x: number) { const v = "s"; return v; }` published
            // nothing, while `return "s"` published `string`.
            //
            // This gives the BINDING no type. It stays ~any~ for every other
            // purpose - a wrong annotation over it is still the boundary's
            // business, and `Reflect.typeOf` still reads the value - because the
            // frame this declares into belongs to the inference pass alone. The
            // reading generalizes the one #sec-static-type-of-an-expression
            // already describes for a numeric constant, which "decides which
            // VALUE a use produces" rather than giving the binding a type.
            //
            // "Cannot change" is the condition, not "is a `const`": a `let`
            // never assigned is as transparent as a `const`, and a `let` that IS
            // assigned must yield nothing, because a published type is enforced
            // at the return - reading only the initializer would make
            // `let v = g(); v = 5; return v;` throw on a program that runs.
            const kind = (n as unknown as { LetOrConst?: string }).LetOrConst;
            const cannotChange = kind === 'const' || !assignedNames.has(bname);
            const init = (bound as unknown as { Initializer?: ParseNode | null }).Initializer;
            if (cannotChange && init) {
              const initType = staticType(init) ?? objectLiteralShape(init);
              if (initType) {
                declare(bname, widen(initType));
              }
            }
          }
          // A DESTRUCTURING pattern binds names too, and each takes the type of
          // the position it destructures: a property's type for an object
          // pattern, the element type for an array pattern. The same condition
          // applies - a `const`, or a `let` this function never assigns - and
          // the same limit: this gives the bindings no type of their own, it
          // answers what a contribution reads.
          //
          // Defaults and rest elements are left alone in this phase. A default
          // makes the binding the union of the position's type and the
          // default's, and a rest element of an object pattern collects a
          // remainder this proposal may not be able to write; guessing at either
          // would state something the program does not.
          for (const b of list.BindingList ?? list.VariableDeclarationList ?? []) {
            const pattern = (b as unknown as { BindingPattern?: ParseNode | null }).BindingPattern;
            const init = (b as unknown as { Initializer?: ParseNode | null }).Initializer;
            if (!pattern || !init) {
              continue;
            }
            const sourceType = staticType(init);
            if (!sourceType) {
              continue;
            }
            const kind = (n as unknown as { LetOrConst?: string }).LetOrConst;
            const bindElement = (element: ParseNode | null | undefined, positionType: Known): void => {
              if (!element || !positionType) {
                return;
              }
              const el = element as unknown as {
                BindingIdentifier?: { name?: string } | null,
                TypeAnnotation?: ParseNode.TypeAnnotation | null,
                Initializer?: ParseNode | null,
              };
              // An annotated element says its own type, and a defaulted one is
              // this phase's exclusion.
              if (el.TypeAnnotation || el.Initializer) {
                return;
              }
              const name = el.BindingIdentifier?.name;
              if (!name || !(kind === 'const' || !assignedNames.has(name))) {
                return;
              }
              declare(name, widen(positionType));
            };
            if (pattern.type === 'ObjectBindingPattern') {
              const props = (pattern as unknown as { BindingPropertyList?: readonly ParseNode[] }).BindingPropertyList ?? [];
              const shape = structureOf(sourceType);
              if (!shape || shape.Kind !== 'object') {
                continue;
              }
              for (const prop of props) {
                const pr = prop as unknown as {
                  PropertyName?: { name?: string, value?: string } | null,
                  BindingElement?: ParseNode | null,
                  BindingIdentifier?: { name?: string } | null,
                };
                // Shorthand `{ p }` carries the identifier directly; `{ p: q }`
                // names the property and the binding separately.
                const key = pr.PropertyName?.name ?? pr.PropertyName?.value ?? pr.BindingIdentifier?.name;
                const member = key ? shape.Properties.find((q) => q.key === key) : undefined;
                if (member) {
                  bindElement((pr.BindingElement ?? prop) as ParseNode, member.type as Known);
                }
              }
            } else if (pattern.type === 'ArrayBindingPattern') {
              const elements = (pattern as unknown as { BindingElementList?: readonly ParseNode[] }).BindingElementList ?? [];
              const src = sourceType as { Kind: string, Element?: TypeRecord, Elements?: readonly { Type?: TypeRecord, Rest?: boolean }[] };
              elements.forEach((element, i) => {
                if (src.Kind === 'array' && src.Element) {
                  bindElement(element as ParseNode, src.Element as Known);
                } else if (src.Kind === 'tuple' && src.Elements) {
                  const position = src.Elements[i];
                  if (position && !position.Rest && position.Type) {
                    bindElement(element as ParseNode, position.Type as Known);
                  }
                }
              });
            }
          }
          // Fall through to the walk, so an initializer containing a function
          // literal is still skipped and a nested return is still found.
        } else if (n.type === 'ReturnStatement') {
          const expr = (n as { Expression?: ParseNode | null }).Expression;
          if (!expr) {
            contributions.push(makePrimitive('undefined'));
            return;
          }
          const t = staticType(expr);
          if (!t) {
            unknown = true;
            return;
          }
          // #sec-anchored-contributions, recorded HERE rather than off the join,
          // because widening erases what the test reads: `return 's'` has the
          // literal type of a string and widens to `string`, at which point it
          // is indistinguishable from a contribution that a declaration
          // supplied. Anchoring is a property of the contribution, so it is
          // taken from the contribution.
          if (t.Kind !== 'literal' && !literalDerivedArrays.has(expr as unknown as object)) {
            anchorage.anchored = true;
            anchorage.from = anchorage.from ?? anchorDescription(expr);
          }
          {
            // Recorded whether or not it anchors: a literal contribution is
            // still the answer to "which return produced this member".
            const origin = anchorDescription(expr) ?? (expr.type === 'StringLiteral' || expr.type === 'NumericLiteral' ? 'a literal' : null);
            if (origin) {
              (anchorage.origins ??= []).push({ type: widen(t) as TypeRecord, from: origin });
            }
          }
          if (mode === 'resolve' && t.Kind === 'nominal' && t.LibraryName === 'Promise'
              && t.Arguments.length > 0 && typeof t.Arguments[0] !== 'number') {
            // A promise contribution contributes what it RESOLVES with: an
            // async function returning a promise resolves with that promise's
            // value rather than with the promise, which is the flattening
            // `await` performs and which the published type must match.
            contributions.push(t.Arguments[0] as TypeRecord);
            return;
          }
          // #sec-never-type: `never` is the identity of union, so a `never`
          // contribution vanishes from a join that has any other member. That
          // is what makes the recursion rule work - the recursive reference
          // contributes `never` and the base case decides the type - and
          // without dropping it here the published type read
          // `never | uint.<32>`, naming a member no value can inhabit.
          if (t.Kind === 'union' && (t as { Members: readonly TypeRecord[] }).Members.length === 0) {
            return;
          }
          contributions.push(widen(t));
          return;
        }
        for (const key of Object.keys(n)) {
          if (key === 'parent' || key === 'location' || key === 'strict') {
            continue;
          }
          const child = (n as unknown as Record<string, unknown>)[key];
          if (Array.isArray(child)) {
            for (const c of child) {
              collect(c as ParseNode);
            }
          } else if (child && typeof child === 'object' && 'type' in (child as object)) {
            collect(child as ParseNode);
          }
        }
      };
      for (const st of list) {
        collect(st);
      }
      if (unknown) {
        return null;
      }
      if (!endsWithReturn(body)) {
        contributions.push(makePrimitive('undefined'));
      }
      if (contributions.length === 0) {
        // #sec-inferred-result-type as harmonized: an EMPTY contribution set -
        // no path returns a value and none can complete - joins to `never`.
        // A body whose only contribution was a recursive reference reaches
        // here, since that contribution vanishes as the identity of union, and
        // `never` is the honest answer: the function does not produce a value.
        // A literal with no contributions at all is a different case and keeps
        // its previous answer of nothing, since it is not being published.
        return anchorage.anchored || inferenceDepth > 0 ? neverType : null;
      }
      const Members: TypeRecord[] = [];
      for (const c of contributions) {
        if (!Members.some((m) => SameType(m, c))) {
          Members.push(c);
        }
      }
      return Members.length === 1 ? Members[0]! : { Kind: 'union', Members };
    });
  };

  /**
   * The iterator helper methods, on a receiver that iterates.
   *
   * #sec-iteration-types. These live on the `Iterator` class at run time, and
   * are reached here from whatever the receiver's type is - a `Generator`, an
   * `Iterator`, or anything else the declared-implements table says iterates -
   * because the receiver's static type is the protocol rather than the class
   * (a hand-written iterator has to satisfy the annotation too).
   *
   * `map` is the method that CHANGES the element type, so its callback's return
   * is what every downstream step infers from; `toArray` is the one that leaves
   * the family. The rest keep the element and follow those two.
   */
  const iteratorMethodSignature = (name: string, element: TypeRecord): Known => {
    const boolType = makePrimitive('boolean');
    const u32 = builtinTypeRecord('uint', [32])!;
    const anyT = { Kind: 'any' as const } as TypeRecord;
    const fn = (params: TypeRecord[], Return: TypeRecord) => ({
      Kind: 'function',
      Signatures: [{ Parameters: params.map((t, i) => parameter(t, { Name: `a${i}` })), Return, Untyped: false }],
    } as unknown as Known);
    // (value, index) => U, the shape every helper callback takes.
    const cb = (ret: TypeRecord) => fn([element, u32], ret);
    // The carrier, not the interface: a chain's next step needs a receiver
    // carrying its element type, and an interface record carries members rather
    // than arguments. `IteratorHelper` is a library name users do not write, so
    // `Iterator.<T>` stays the interface a hand-written iterator satisfies.
    const iteratorOf = (t: TypeRecord) => libraryTypeRecord('IteratorHelper', [t, voidTypeRecord, voidTypeRecord])!;
    switch (name) {
      case 'map': return fn([cb(anyT) as TypeRecord], iteratorOf(anyT));
      case 'filter': return fn([cb(boolType) as TypeRecord], iteratorOf(element));
      case 'take':
      case 'drop': return fn([u32], iteratorOf(element));
      case 'flatMap': return fn([cb(anyT) as TypeRecord], iteratorOf(anyT));
      case 'toArray': return fn([], { Kind: 'array', Element: element, Extent: 'dynamic' } as unknown as TypeRecord);
      case 'forEach': return fn([cb(voidTypeRecord) as TypeRecord], voidTypeRecord);
      case 'some':
      case 'every': return fn([cb(boolType) as TypeRecord], boolType);
      case 'find': return fn([cb(boolType) as TypeRecord], { Kind: 'union', Members: [element, voidTypeRecord] } as unknown as TypeRecord);
      case 'reduce': return fn([fn([anyT, element, u32], anyT) as TypeRecord, anyT], anyT);
      default: return null;
    }
  };

  const collectionMethodSignature = (library: string, name: string, args: readonly (TypeRecord | number)[], receiver: TypeRecord): Known => {
    const boolType = makePrimitive('boolean');
    const anyType = { Kind: 'any' as const };
    const shapes = (types: readonly TypeRecord[], optionalFrom: number): ParameterRecord[] => types.map((t, i) => parameter(t, { Optional: i >= optionalFrom }));
    const arg = (i: number): TypeRecord => {
      const a = args[i];
      return a === undefined || typeof a === 'number' ? anyType as TypeRecord : a;
    };
    const sig = (Parameters: TypeRecord[], Return: TypeRecord, optionalFrom = Parameters.length) => ({
      Kind: 'function',
      Signatures: [{ Parameters: shapes(Parameters, optionalFrom), Return, Untyped: false }],
    } as unknown as Known);
    if (library === 'Set' || library === 'WeakSet') {
      const element = arg(0);
      switch (name) {
        case 'add': return sig([element], receiver);
        case 'has':
        case 'delete': return sig([element], boolType);
        // The design's set operations. `intersection` and `difference` draw
        // ONLY from `this`, so the result keeps the receiver's element type
        // whatever the other side holds - which is why they can be written
        // here while `union` and `symmetricDifference` cannot.
        //
        // The `other` parameter is left ~any~ rather than typed `Set.<U>`.
        // The design writes a generic parameter, and this checker has no way
        // to say "a Set of any element type" without deciding assignability
        // between two parameterizations of one nominal, which is a rule the
        // specification has not stated. An under-approximation admits what the
        // design admits and declines to invent the rest; the run time refuses
        // a non-Set as it always did.
        case 'intersection':
        case 'difference': return sig([anyType as TypeRecord], receiver);
        case 'isSubsetOf':
        case 'isSupersetOf':
        case 'isDisjointFrom': return sig([anyType as TypeRecord], boolType);
        default: return null;
      }
    }
    const key = arg(0);
    const value = arg(1);
    switch (name) {
      // The design writes the lookup as `V | undefined`, and a union is how the
      // checker says it: a `Map.<K, V>` that does not hold the key answers
      // *undefined*, so a binding of type V is not what a lookup produces.
      case 'get': return sig([key], { Kind: 'union', Members: [value, makePrimitive('undefined')] } as TypeRecord);
      case 'set': return sig([key, value], receiver);
      case 'has':
      case 'delete': return sig([key], boolType);
      // `getOrInsert` postdates the design's listing, so its return is read off
      // its own semantics rather than quoted: it answers the value it found or
      // the one it inserted, and never *undefined*.
      case 'getOrInsert': return sig([key, value], value);
      default: return null;
    }
  };

  /**
   * #index-type: the type of every count an array reports or accepts. Defined
   * as `uint32` and referenced rather than repeated, so that widening it is one
   * edit here and one in the specification rather than a search for `uint32`.
   */
  const indexTypeRecord = () => builtinTypeRecord('uint', [64])!;

  /**
   * #sec-span-type: `Span.<T>` is a library nominal, so a receiver is
   * recognised by its LibraryName. A window has the READ surface of an array
   * and none of the operations that change a length or describe an allocation,
   * because it owns no allocation and its length is fixed.
   */
  const spanElementOfReceiver = (r: TypeRecord | null): TypeRecord | null => {
    if (!r || r.Kind !== 'nominal' || (r as { LibraryName?: string }).LibraryName !== 'Span') {
      return null;
    }
    const args = (r as { Arguments?: readonly TypeRecord[] }).Arguments;
    return args && args.length > 0 ? args[0] : { Kind: 'any' as const };
  };

  /** The stated length of a `Span.<T, N>` receiver, or ~undefined~ if unstated. */
  const spanExtentOfReceiver = (r: TypeRecord | null): number | undefined => {
    if (!r || r.Kind !== 'nominal' || (r as { LibraryName?: string }).LibraryName !== 'Span') {
      return undefined;
    }
    const args = (r as { Arguments?: readonly (TypeRecord | number)[] }).Arguments;
    const second = args && args.length > 1 ? args[1] : undefined;
    return typeof second === 'number' ? second : undefined;
  };

  /** Operations a window does not have: they grow, shrink, or name an allocation. */
  const spanForbiddenMembers = new Set([
    'capacity', 'reserve', 'shrinkToFit',
    'push', 'pop', 'shift', 'unshift', 'splice',
  ]);

  const arrayMethodSignature = (name: string, element: TypeRecord, receiver: TypeRecord): Known => {
    const anyType = { Kind: 'any' as const };
    const numberType = makePrimitive('number');
    const boolType = makePrimitive('boolean');
    const shapes = (types: readonly TypeRecord[], optionalFrom: number): ParameterRecord[] => types.map((t, i) => parameter(t, { Optional: i >= optionalFrom }));
    switch (name) {
      case 'includes':
        return { Kind: 'function', Signatures: [{ Parameters: shapes([element, numberType], 1), Return: boolType, Untyped: false }] } as unknown as Known;
      case 'indexOf':
      case 'lastIndexOf':
        return { Kind: 'function', Signatures: [{ Parameters: shapes([element, numberType], 1), Return: numberType, Untyped: false }] } as unknown as Known;
      case 'fill':
        return { Kind: 'function', Signatures: [{ Parameters: shapes([element, numberType, numberType], 1), Return: anyType, Untyped: false }] } as unknown as Known;
      case 'at':
        return { Kind: 'function', Signatures: [{ Parameters: shapes([numberType], 1), Return: element, Untyped: false }] } as unknown as Known;
      // A result drawn from the receiver's own elements is an array of the same
      // element type: `filter` selects, `slice` copies a range, `reverse` and
      // `sort` reorder, `concat` joins. `map` is NOT here - its element type is
      // the callback's return, which needs the callback typed first, and
      // claiming the receiver's type would be wrong rather than merely
      // imprecise (F79).
      // The methods that take a CALLBACK: its first parameter is the element,
      // its second the index at `uint32`, its third the array itself. Writing
      // that as a function type is what lets the call site push those types
      // into the literal's parameters (F80).
      case 'forEach':
      case 'map':
      case 'find':
      case 'findIndex':
      case 'findLast':
      case 'findLastIndex':
      case 'some':
      case 'every': {
        const callback = {
          Kind: 'function',
          Signatures: [{
            Parameters: shapes([element, builtinTypeRecord('uint', [32]) ?? numberType, receiver], 1),
            Return: anyType,
            Untyped: false,
          }],
        } as unknown as TypeRecord;
        const result = name === 'map' ? anyType : (name === 'find' || name === 'findLast' ? element : anyType);
        return { Kind: 'function', Signatures: [{ Parameters: shapes([callback, anyType], 1), Return: result, Untyped: false }] } as unknown as Known;
      }
      case 'filter': {
        // Selects from the receiver's own elements, so the result keeps the
        // element type AND the callback sees it.
        const callback = {
          Kind: 'function',
          Signatures: [{
            Parameters: shapes([element, builtinTypeRecord('uint', [32]) ?? numberType, receiver], 1),
            Return: anyType,
            Untyped: false,
          }],
        } as unknown as TypeRecord;
        return { Kind: 'function', Signatures: [{ Parameters: shapes([callback, anyType], 1), Return: receiver, Untyped: false }] } as unknown as Known;
      }
      case 'shrinkToFit':
        // #sec-array.prototype.shrinktofit: takes nothing and answers nothing.
        // It had no entry, so it resolved to ~any~ and `a.shrinkToFit(1, 2, 3)`
        // was accepted - the same hole Phase C closed for `capacity`, reopened
        // by adding an operation without adding its signature alongside.
        return { Kind: 'function', Signatures: [{ Parameters: [], Return: makePrimitive('undefined'), Untyped: false }] } as unknown as Known;
      case 'reserve':
        // #sec-array.prototype.reserve: takes a count and answers nothing. The
        // parameter is the index type and not `number`, so that a reserve
        // argument is checked exactly as a length or a capacity would be.
        return { Kind: 'function', Signatures: [{ Parameters: shapes([indexTypeRecord()], 0), Return: makePrimitive('undefined'), Untyped: false }] } as unknown as Known;
      case 'slice':
      case 'reverse':
      case 'sort':
      case 'toReversed':
      case 'toSorted':
      case 'concat':
        return { Kind: 'function', Signatures: [{ Parameters: shapes([anyType, anyType], 0), Return: receiver, Untyped: false }] } as unknown as Known;
      default:
        return null;
    }
  };

  const declareFunctionSignatures = (outerList: readonly ParseNode[]) => {
    // An `export`ed declaration is wrapped, and the collection below reads the
    // list positionally, so `export function f(): uint32 {}` was never
    // collected: its signature existed nowhere, and a call of it was ~any~ in
    // its own module as much as in an importing one. Unwrapping here rather
    // than in each of the loops keeps the three collection passes reading one
    // list.
    const list: ParseNode[] = [];
    for (const item of outerList) {
      if (item.type === 'ExportDeclaration') {
        const ed = item as unknown as {
          Declaration?: ParseNode | null,
          HoistableDeclaration?: ParseNode | null,
          ClassDeclaration?: ParseNode | null,
          VariableStatement?: ParseNode | null,
        };
        const inner = ed.HoistableDeclaration ?? ed.Declaration ?? ed.ClassDeclaration ?? ed.VariableStatement;
        if (inner) {
          list.push(inner);
          continue;
        }
      }
      list.push(item);
    }
    // OVERLOADS ACCUMULATE. A name may be declared more than once - that is
    // this proposal's function overloading - so the signatures are collected
    // per name and declared together. Declaring one at a time let the last
    // declaration clobber the earlier ones, which turned every call matching
    // an earlier overload into a spurious Early Error (measured, cycle 50).
    // The argument check at a call site fires only for a SINGLE-signature
    // type, so an overloaded name keeps resolving where it did before, at run
    // time, until the checker learns to rank signatures.
    const collected = new Map<string, { Parameters: ParameterRecord[], Return: Known, Untyped: boolean }[]>();
    const rejected = new Set<string>();
    // A class name must be in `classNodes` BEFORE any signature resolves its
    // parameter annotations, or `resolveType` finds nothing and the parameter
    // falls back to `any` - which is why `function f(p: A)` was not checked at
    // its call site while `function g(q: uint8)` was, and why declaration order
    // made no difference: the collection below runs after every signature in the
    // list, not after every statement.
    //
    // Names only. The instance type is still built lazily and memoised by
    // `instanceTypeOf`, so nothing is resolved earlier than before - only found.
    for (const n of list) {
      if (n.type === 'ClassDeclaration') {
        const className = (n as unknown as { BindingIdentifier?: { name: string } | null }).BindingIdentifier?.name;
        if (className && !classNodes.has(className)) {
          classNodes.set(className, n);
        }
      } else if (n.type === 'InterfaceDeclaration') {
        // Interfaces too, and for a sharper reason than symmetry: resolving a
        // class annotation here BUILDS that class's instance type, which is
        // memoised. A class with `implements I` would be built before `I` was
        // known and would memoise without the members it inherits, so a name
        // pre-pass that collected only classes silently un-checked
        // `class C implements I { }`.
        const interfaceName = (n as unknown as { BindingIdentifier?: { name: string } | null }).BindingIdentifier?.name;
        if (interfaceName && !interfaceNodes.has(interfaceName)) {
          interfaceNodes.set(interfaceName, n);
        }
      } else if (n.type === 'TypeAliasDeclaration') {
        // AND ALIASES, for the reason the interface note above gives. An alias
        // was registered during the WALK, and a function declaration's signature
        // is built before the walk reaches it - so `type U = uint8; function
        // f(p: U) {}` gave the parameter ~any~, while the same annotation
        // written inline, or naming a CLASS or an INTERFACE, resolved.
        //
        // Everything downstream was then innocent and looked broken: `f(300)`
        // fell through to the run time because ~any~ admits it, and
        // #sec-literal-freshness never ran at such a parameter because there was
        // no object type to be fresh against.
        //
        // Names only, as above: the alias's own type is still resolved lazily,
        // so nothing is computed earlier than before - only found.
        const aliasName = (n as unknown as { BindingIdentifier?: { name: string } | null }).BindingIdentifier?.name;
        if (aliasName && !aliasNodes.has(aliasName)) {
          aliasNodes.set(aliasName, n);
        }
      }
    }
    for (const n of list) {
      // PLAN-do-expressions.md phase 1, #sec-generator-types. A generator
      // declaration was skipped entirely, so a call of one had no type at all.
      // It is collected now, and its annotation is read by the shorthand: a
      // bare `T` is the YIELD type of a `Generator.<T, void, void>`.
      const isGenerator = n.type === 'GeneratorDeclaration' || n.type === 'AsyncGeneratorDeclaration';
      const isAsyncGenerator = n.type === 'AsyncGeneratorDeclaration';
      // An ASYNC declaration was admitted by neither test, so it got no
      // signature at all and a call of it was ~any~ even where the program
      // wrote `async function f(): Promise.<uint8, Error>` - the spelling the
      // design uses throughout (#sec-function-declarations). That is a gap in
      // the DECLARED path rather than an inference one, and it is fixed here so
      // that the annotation a program already writes is read.
      const isAsyncFunction = n.type === 'AsyncFunctionDeclaration';
      if (n.type !== 'FunctionDeclaration' && !isGenerator && !isAsyncFunction) {
        continue;
      }
      const fn = n as unknown as {
        BindingIdentifier?: { name: string } | null,
        FormalParameters?: readonly ParseNode[] | null,
        TypeAnnotation?: ParseNode.TypeAnnotation | null,
      };
      const name = fn.BindingIdentifier?.name;
      if (!name) {
        continue;
      }
      const Parameters: ParameterRecord[] = [];
      const annotated: Known[] = [];
      let usable = true;
      // A generic declaration binds its type parameters for its whole
      // signature, so they are in scope while the annotations below resolve.
      // The NAMES are still wanted downstream, for the pending inferences; the
      // push is what carries the constraints.
      const typeParameterScope = typeParameterNamesOf(n as ParseNode);
      const pushedTypeParameters = pushTypeParameterScopeOf(n as ParseNode);
      for (const p of fn.FormalParameters ?? []) {
        if (p.type !== 'SingleNameBinding' && p.type !== 'BindingElement') {
          // A rest or destructuring parameter: no arity to check against, so
          // the whole name is left untyped rather than half-described.
          usable = false;
          break;
        }
        const pp = p as {
          TypeAnnotation?: ParseNode.TypeAnnotation | null,
          Initializer?: ParseNode | null,
          Optional?: boolean,
        };
        const resolved2 = pp.TypeAnnotation ? resolveType(pp.TypeAnnotation.Type) : null;
        annotated.push(resolved2);
        Parameters.push(parameter(resolved2 ?? anyTypeRecord, {
          Name: (p as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name ?? '',
          Optional: pp.Optional === true || !!pp.Initializer,
        }));
      }
      if (!usable) {
        rejected.add(name);
        continue;
      }
      const Return = fn.TypeAnnotation ? resolveType(fn.TypeAnnotation.Type) : null;
      // Whether a return annotation was WRITTEN, which `Return` alone cannot say:
      // it is null both where none was written and where one was written and did
      // not resolve. The duplicate check below needs to tell those apart.
      const returnWasWritten = !!fn.TypeAnnotation;
      const signatures = collected.get(name) ?? [];
      // #sec-overload-resolution's [[Untyped]]: a signature with no annotation
      // anywhere is the catch-all that ranks last. Declaring a return type is
      // what makes a zero-parameter function typed, which the clause spells
      // out.
      let declared = Return;
      let baselineGenerator: Known = null;
      if (isGenerator) {
        declared = Return ? generatorDeclaredType(Return, isAsyncGenerator) : null;
        if (!Return) {
          // An unannotated generator still has a shape - `Generator.<any, ...>` -
          // but it is not a DECLARED one, so it is published rather than
          // declared and the fixpoint may refine it.
          baselineGenerator = generatorDeclaredType(null, isAsyncGenerator);
        }
        if (Return && declared === null) {
          // An AsyncGenerator annotation on a synchronous generator, or the
          // reverse: the annotation names the wrong protocol. Only an
          // ANNOTATION can name the wrong one - an unannotated generator now
          // leaves this field null deliberately, since its shape is published
          // rather than declared.
          const completion = Throw.TypeError('a $1 annotation is not a $2', Value(isAsyncGenerator ? 'Generator' : 'AsyncGenerator'), Value(isAsyncGenerator ? 'AsyncGenerator' : 'Generator')) as ThrowCompletion;
          errors.push(completion.Value as ObjectValue);
          declared = Return;
        }
      }
      const Untyped = !fn.TypeAnnotation && annotated.every((t) => t === null);
      if (pushedTypeParameters) {
        typeParameterScopes.pop();
      }
      const signature: { Parameters: unknown, Return: Known, Untyped: boolean, ReturnWasWritten: boolean, InferredReturn?: Known, TypeParameterNames?: readonly string[] } = { Parameters, Return: declared, Untyped, ReturnWasWritten: returnWasWritten } as never;
      // #sec-generic-functions: the names a call binds with its type arguments.
      // Recorded here because a call site needs them to substitute into the
      // return type, and the declaration node is not reachable from the
      // signature record.
      const tps = (n as unknown as {
        TypeParameters?: { TypeParameterList?: readonly { BindingIdentifier?: { name?: string } }[] },
      }).TypeParameters?.TypeParameterList;
      if (tps && tps.length > 0) {
        signature.TypeParameterNames = tps.map((tp) => tp.BindingIdentifier?.name ?? '');
      }
      if (baselineGenerator) {
        signature.InferredReturn = baselineGenerator;
      }
      // #sec-overload-resolution: "two signatures declared for one name must not
      // be ambiguous for any argument list", and it is a type error "to declare
      // a signature that is viable for the same argument list as an existing one
      // at the same rank". A signature repeating another's parameter types AND
      // return type is that case in its purest form - one signature written
      // twice - and it was accepted here, leaving every call of the name
      // ambiguous with nothing at the declaration to say why.
      //
      // Return-type overloading is untouched: two signatures differing in their
      // return are distinguished by the contextual type of a call
      // (#sec-overloading-on-return-type), so they are not this case.
      //
      // Parameter identity is the same notion the RANKING uses
      // (#table-argument-match-ranks rank 2): a ~nominal~ type is identified by
      // its declaration, so an interface and a structurally identical alias are
      // different parameter types here exactly as they are there. Reading them
      // as the same would refuse the pair the ranking exists to order.
      const sameForOverloading = (a: Known, b: Known): boolean => {
        if (!a || !b) {
          // An unresolved type proves nothing. Reading two unknowns as equal
          // made every pair of signatures whose parameter types this pass
          // cannot resolve look like one signature written twice - it refused
          // `f(c: Reflect.ClassField)` beside `f(c: Reflect.ClassAccessor)`,
          // which are different types the checker simply does not resolve here.
          // Under-reporting a duplicate is the safe direction: the call-site
          // ambiguity still catches it.
          return false;
        }
        const aNominal = a.Kind === 'nominal';
        const bNominal = b.Kind === 'nominal';
        if (aNominal || bNominal) {
          return aNominal && bNominal
            && (a as { Declaration?: unknown }).Declaration === (b as { Declaration?: unknown }).Declaration;
        }
        return SameType(a, b);
      };
      const duplicate = signatures.some((existing) => {
        const e = existing as unknown as {
          Parameters: readonly { Type?: Known }[], Return: Known, ReturnWasWritten?: boolean,
        };
        if (e.Parameters.length !== Parameters.length) {
          return false;
        }
        if (!e.Parameters.every((p, i) => sameForOverloading(p.Type ?? null, Parameters[i]?.Type ?? null))) {
          return false;
        }
        // Neither declaring a return is the SAME declared return, not two
        // unknowns. `sameForOverloading` refuses to equate absent types on
        // purpose - an annotation this pass cannot resolve proves nothing - but
        // "no annotation was written" is not that case: it is a declaration of
        // nothing, and two of them declare the same nothing.
        //
        // Without this, `function f() {} function f() {}` was two signatures the
        // checker could not tell apart, accepted at the declarations and then
        // ambiguous at EVERY call - an error naming neither of them. The
        // annotated pair was already refused here, early; this is the same rule
        // reaching the case that declares nothing. `PLAN-module-scope-overloads`
        // Q6.
        if (Return === null && !returnWasWritten && e.ReturnWasWritten === false) {
          return true;
        }
        return sameForOverloading(e.Return, declared);
      });
      if (duplicate) {
        const completion = Throw.TypeError('$1 is declared twice with the same parameter types and return type', Value(name)) as ThrowCompletion;
        errors.push(completion.Value as ObjectValue);
      }
      signatures.push(signature as never);
      // #sec-inferred-return-types: a function that declares no return type may
      // still publish one. The inference cannot run here, because it reads the
      // types of the other declarations in this scope and none of them is in
      // scope yet, so the work is queued and run once every signature exists.
      // A generator or async function is not queued: what each publishes is a
      // protocol type built from a different join, which this cycle leaves to
      // the clause that defines it.
      if (!fn.TypeAnnotation && isGenerator) {
        pendingInferences.push({
          signature,
          fn: n as ParseNode,
          parameterTypes: annotated.slice(),
          signatureTyped: annotated.some((t) => t !== null),
          typeParameterNames: typeParameterScope ?? undefined,
          generator: { asyncGenerator: isAsyncGenerator },
        });
      }
      if (!fn.TypeAnnotation && isAsyncFunction) {
        pendingInferences.push({
          signature,
          fn: n as ParseNode,
          parameterTypes: annotated.slice(),
          signatureTyped: annotated.some((t) => t !== null),
          typeParameterNames: typeParameterScope ?? undefined,
          asyncFunction: true,
        });
      }
      if (!fn.TypeAnnotation && !isGenerator && n.type === 'FunctionDeclaration') {
        pendingInferences.push({
          signature,
          fn: fn as unknown as ParseNode,
          parameterTypes: annotated.slice(),
          signatureTyped: annotated.some((t) => t !== null),
          typeParameterNames: typeParameterScope ?? undefined,
        });
      }
      collected.set(name, signatures);
    }
    for (const [name, Signatures] of collected) {
      if (rejected.has(name)) {
        continue;
      }
      declare(name, { Kind: 'function', Signatures } as unknown as Known);
    }
    publishInferredReturns();
    // Class instance types are recorded over the same list, so a class may be
    // named as a type anywhere in it.
    for (const n of list) {
      if (n.type === 'FunctionDeclaration') {
        const fnName = (n as unknown as { BindingIdentifier?: { name: string } | null }).BindingIdentifier?.name;
        if (fnName) {
          functionNodes.set(fnName, n);
        }
      }
      if (n.type === 'ClassDeclaration') {
        const name = (n as unknown as { BindingIdentifier?: { name: string } | null }).BindingIdentifier?.name;
        if (name) {
          classNodes.set(name, n);
        }
        // `ClassModifiers` is a list of STRINGS, not of nodes.
        const modifiers = (n as unknown as { ClassModifiers?: readonly string[] | null }).ClassModifiers ?? [];
        if (modifiers.includes('sealed') && !sealedSubclasses.has(n)) {
          sealedSubclasses.set(n, []);
        }
      } else if (n.type === 'InterfaceDeclaration') {
        // #sec-variance-static-semantics-early-errors: a declared variance is a
        // claim about where the parameter appears, and this is where the claim
        // is judged against #table-variance-positions.
        checkVariancePositions(n);
        const name = (n as unknown as { BindingIdentifier?: { name: string } | null }).BindingIdentifier?.name;
        if (name) {
          interfaceNodes.set(name, n);
        }
      }
    }
    // FORCE each class's instance type, once the whole list is recorded so a
    // class may still name one declared later.
    //
    // The member walk is where a class's own declarations are judged, and it
    // had been reached only ON DEMAND - when something asked for the class's
    // type. A class that nothing references was never walked, so a rule checked
    // there fired only if the program happened to mention the class elsewhere,
    // which is no rule at all. `instanceTypeOf` memoizes, so forcing it here
    // runs the walk exactly once per class and every later demand is a cache
    // hit: the errors below are reported once, not once per reference.
    // typeprogramming.md §6.6: "a declared `const s = Symbol()` used in type
    // position IS the unique symbol type, without a keyword". A checker has no
    // VALUES, so that identity is carried by the DECLARATION - two consts are
    // two types, and one const named twice is one type, which is exactly what
    // §6.6's identity rule means where no symbol can be held.
    for (const n of list) {
      if (n.type !== 'LexicalDeclaration' || (n as ParseNode.LexicalDeclaration).LetOrConst !== 'const') {
        continue;
      }
      for (const binding of (n as ParseNode.LexicalDeclaration).BindingList) {
        const b = binding as unknown as {
          BindingIdentifier?: { name?: string } | null,
          Initializer?: { type?: string, CallExpression?: { type?: string, name?: string } } | null,
        };
        const bound = b.BindingIdentifier?.name;
        const callee = b.Initializer?.type === 'CallExpression' ? b.Initializer.CallExpression : undefined;
        if (typeof bound === 'string' && callee?.type === 'IdentifierReference' && callee.name === 'Symbol') {
          symbolConsts.set(bound, binding);
        }
      }
    }
    // Linked in a SECOND pass, after every class is in `classNodes`: a subclass
    // may be declared before its sealed base, and the set is fixed "when the
    // MODULE finishes evaluating" rather than when a declaration is reached.
    for (const n of list) {
      if (n.type !== 'ClassDeclaration') {
        continue;
      }
      const heritage = (n as unknown as {
        ClassTail?: { ClassHeritage?: { name?: string } | null } | null,
      }).ClassTail?.ClassHeritage;
      const baseName = heritage && typeof heritage.name === 'string' ? heritage.name : null;
      const baseNode = baseName ? classNodes.get(baseName) : undefined;
      if (baseNode && sealedSubclasses.has(baseNode)) {
        sealedSubclasses.get(baseNode)!.push(n);
      }
    }
    for (const n of classNodes.values()) {
      instanceTypeOf(n);
    }
    // Class expressions are forced here too, and AFTER the declarations: an
    // expression may extend a declared class, and the declaration's own record
    // has to exist before the heritage lookup asks for it.
    for (const n of classExpressionNodes) {
      instanceTypeOf(n);
    }
    // An interface's member walk is lazy for the same reason the class one was,
    // and a rule checked there needs the same forcing: an interface nothing
    // references would never be walked, so its computed keys would never be
    // judged.
    for (const n of interfaceNodes.values()) {
      interfaceTypeOf((n as unknown as { BindingIdentifier?: { name: string } }).BindingIdentifier?.name ?? '');
    }
  };

  /** Record a NARROWING of a name, which an assignment may later invalidate. */
  const declareNarrowed = (name: string, t: Known) => {
    if (!t) {
      return;
    }
    const frame = frames[frames.length - 1] as Frame & { narrowed?: Set<string> };
    frame.bindings.set(name, t as TypeRecord);
    ((frame as { narrowed?: Set<string> }).narrowed ??= new Set()).add(name);
  };

  /**
   * The type a name was DECLARED with, ignoring any narrowing in force. An
   * assignment is checked against this, because the declared type is what the
   * binding may hold; the narrowing is a fact about the current value and the
   * assignment is what ends it (F78).
   */
  const lookupDeclared = (name: string): Known => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const f = frames[i] as Frame & { narrowed?: Set<string> };
      if (f.narrowed?.has(name)) {
        continue;
      }
      const t = f.bindings.get(name);
      if (t !== undefined) {
        return t;
      }
    }
    return null;
  };

  /** Drop any narrowing of a name, which an assignment to it invalidates. */
  const invalidateNarrowing = (name: string) => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const f = frames[i] as Frame & { narrowed?: Set<string> };
      if (f.narrowed?.has(name)) {
        f.bindings.delete(name);
        f.narrowed.delete(name);
      }
    }
  };

  const declare = (name: string, t: Known) => {
    frames[frames.length - 1].declaredNames.add(name);
    if (t) {
      frames[frames.length - 1].bindings.set(name, t);
    }
  };

  /**
   * Declare what a pattern binds, at the type the pattern established.
   *
   * An ANNOTATED binding types as its annotation - `let x: uint8` makes `x` a
   * `uint8` - which is the narrowing a pattern can always justify. An
   * UNANNOTATED binding is left undeclared rather than declared as `any`, so it
   * resolves outward the way any other free name does; typing it as the
   * SUBJECT's narrowed type is the remaining work, and declaring `any` here
   * would silently look like that work was done.
   */
  const declareMatchPatternBindings = (pattern: ParseNode.MatchPattern | null, positionType?: Known): void => {
    if (!pattern) {
      return;
    }
    switch (pattern.type) {
      case 'MatchBindingPattern':
        if (pattern.TypeAnnotation) {
          // An ANNOTATED binding types as its annotation, which is the
          // narrowing the pattern itself justifies.
          const t = resolveType(pattern.TypeAnnotation);
          if (t) {
            declare(pattern.Name, t);
          }
        } else if (positionType) {
          // An UNANNOTATED binding types as the SUBJECT at that position - "a
          // binding always matches", so it establishes nothing about the value
          // beyond what the position already said. Left undeclared where the
          // position's type is unknown rather than declared as `any`, since
          // `any` would look exactly like this work having been done.
          declare(pattern.Name, positionType);
        }
        break;
      case 'MatchOrPattern':
      case 'MatchAndPattern':
        // A combinator does not change the POSITION, so both sides see the
        // same type. `and` could narrow the right side by the left, which is
        // the refinement still outstanding.
        declareMatchPatternBindings(pattern.Left, positionType);
        declareMatchPatternBindings(pattern.Right, positionType);
        break;
      case 'MatchNotPattern':
        declareMatchPatternBindings(pattern.Operand, positionType);
        break;
      case 'MatchLiteralPattern': {
        // proposal-runtime-types: "a numeric literal takes the CONTEXTUAL TYPE
        // of the pattern's position", so `when 27:` against a `uint8` field is
        // a `uint8` 27 - and a literal that CANNOT take the position type is a
        // compile-time TypeError, the same impossible-test rule the checker
        // enforces for a comparison.
        // A NEGATIVE literal is a unary minus over a NumericLiteral, not a
        // NumericLiteral - so reading only the literal node let `when -1:`
        // against a `uint8` through, which is the very case the rule exists to
        // catch: an unsigned type has no negative values at all.
        const lit = pattern.Literal as {
          type?: string, value?: unknown,
          operator?: string, UnaryExpression?: { type?: string, value?: unknown },
        };
        let numeric: number | null = null;
        if (lit.type === 'NumericLiteral') {
          numeric = Number(lit.value);
        } else if ((lit.operator === '-' || lit.operator === '+') && lit.UnaryExpression?.type === 'NumericLiteral') {
          const magnitude = Number(lit.UnaryExpression.value);
          numeric = lit.operator === '-' ? -magnitude : magnitude;
        }
        if (numeric !== null && positionType) {
          const numericFamilies = ['uint', 'int', 'float16', 'float32', 'float64', 'float128'];
          if (positionType.Kind === 'primitive' && numericFamilies.includes(positionType.Name)
              && !fitsNumericType(numeric, positionType.Name, positionType.Arguments)) {
            const completion = Throw.TypeError('$1 is not a value of $2', Value(String(numeric)), Value(displayType(positionType))) as ThrowCompletion;
            errors.push(completion.Value as ObjectValue);
          } else if (positionType.Kind === 'union') {
            // "A numeric literal against a union of NUMERIC types is a type
            // error, because matching only one would be a silent half-answer."
            // This one needs a RULE rather than inference - there is no
            // principled way to pick a member.
            // NUMERIC means the numeric families, not "a primitive that is not
            // `number`" - `string` is a primitive too, and counting it made
            // `uint8 | string` ambiguous when it has exactly ONE numeric member
            // and is therefore perfectly clear.
            const numericNames = ['uint', 'int', 'float16', 'float32', 'float64', 'float128', 'decimal32', 'decimal64', 'decimal128'];
            const numericMembers = positionType.Members.filter((m) => m.Kind === 'primitive' && numericNames.includes(m.Name));
            if (numericMembers.length > 1) {
              const completion = Throw.TypeError('$1 is ambiguous against $2', Value(String(numeric)), Value(displayType(positionType))) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
          }
        }
        break;
      }
      case 'MatchObjectPattern':
        // The subject's type is WALKED ALONGSIDE the pattern: each member's
        // sub-pattern sees the type of the property it names, so `{ a: let n }`
        // against `{ a: uint8 }` types `n` as `uint8`. Passing the whole
        // subject type down would have typed `n` as the OBJECT, which is worse
        // than leaving it loose - it would be confidently wrong.
        pattern.Properties.forEach((prop) => {
          let memberType: Known = null;
          const shape = positionType && positionType.Kind === 'object'
            ? positionType
            : (positionType as { Structure?: TypeRecord } | undefined)?.Structure;
          if (shape && shape.Kind === 'object') {
            const declared = shape.Properties.find((pr) => pr.key === prop.Key);
            memberType = declared ? (declared.type as Known) : null;
          }
          declareMatchPatternBindings(prop.Pattern, memberType ?? undefined);
        });
        break;
      case 'MatchArrayPattern':
        // A TUPLE subject types each element by POSITION; an array subject
        // types every element the same. An extractor's elements come from a
        // matcher's return and are not typed here - "that narrowing is a claim
        // the matcher's author makes", and this walk has no claim to read.
        pattern.Elements.forEach((el, index) => {
          let elementType: Known = null;
          if (positionType && positionType.Kind === 'tuple') {
            const slot = positionType.Elements[index];
            elementType = slot ? (slot.Type as Known) : null;
          } else if (positionType && positionType.Kind === 'array') {
            elementType = positionType.Element as Known;
          }
          declareMatchPatternBindings(el, elementType ?? undefined);
        });
        break;
      case 'MatchExtractorPattern':
        pattern.Elements.forEach((el) => declareMatchPatternBindings(el));
        break;
      default:
        break;
    }
  };


  // The enum a binding should be tracked as holding, from its initializer or its
  // type annotation. `let e = E.Member` and `let e: E` both make `e` enum-typed;
  // `E.Member` is a MemberExpression on an enum name, and `E` as an annotation is
  // a TypeReference to an enum name.
  const enumOfInitializer = (init: ParseNode | null | undefined): string | null => {
    if (!init) {
      return null;
    }
    let node: ParseNode = init;
    if (node.type === 'ParenthesizedExpression') {
      node = (node as { Expression: ParseNode }).Expression;
    }
    if (node.type === 'MemberExpression') {
      const m = node as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null };
      if (m.MemberExpression && m.MemberExpression.type === 'IdentifierReference' && m.IdentifierName) {
        const enumName = (m.MemberExpression as { name: string }).name;
        const info = lookupEnum(enumName);
        if (info && info.names.includes(m.IdentifierName.name)) {
          return enumName;
        }
      }
    }
    return null;
  };

  const enumOfAnnotation = (ann: ParseNode.TypeAnnotation | null | undefined): string | null => {
    if (!ann) {
      return null;
    }
    const t = ann.Type;
    if (t.type === 'TypeReference') {
      const tr = t as unknown as { TypeName: { IdentifierReference: { name: string }, MemberNames: readonly unknown[] }, TypeArguments?: unknown };
      if (tr.TypeName.MemberNames.length === 0 && !tr.TypeArguments) {
        const name = tr.TypeName.IdentifierReference.name;
        if (lookupEnum(name)) {
          return name;
        }
      }
    }
    return null;
  };

  /**
   * proposal-runtime-types #sec-check-elision: whether an expression's Static
   * Type is STABLE, meaning the value at run time is of that type for the same
   * reason the checker said so.
   *
   * Elision is licensed by "the value is ALREADY of the target type", and that
   * premise fails wherever a Static Type was read from a signature that a
   * program can replace. A function DECLARATION creates a mutable binding, so:
   *
   *   function f(): uint32 { return 5; }
   *   function g(): uint32 { return f(); }
   *   f = function () { return 'now-a-string'; };
   *   const n: uint32 = g();
   *
   * had BOTH checks elided - `g`'s return, because `f()` is a `uint32`, and the
   * binding, because `g()` is - and the string reached `n` unreported. That is
   * the runtime guarantee failing in fully annotated code, and it does not need
   * inference to reach it. The assignment to `f` is admitted by the shallow
   * function check, which #sec-shallow-function-checks says is the one place a
   * type violation is knowingly permitted to go unreported; what this operation
   * prevents is that admission being compounded by an elision that assumes it
   * never happens.
   *
   * A call through an immutable binding is stable: nothing can replace the
   * callee, so its return annotation is the fact the checker read. Everything
   * else that yields a Static Type - a binding read, a parameter, a member of a
   * typed shape, a literal, an operator over stable operands - is checked at
   * its own boundary and stays stable.
   */
  const immutablyBound = (name: string): boolean => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      if (frames[i].immutableNames.has(name)) {
        return true;
      }
      if (frames[i].declaredNames.has(name)) {
        break;
      }
    }
    // A name the source text never assigns to is immutable IN FACT, whatever
    // form declared it: a function declaration creates a mutable binding, but a
    // program that never writes to that binding cannot replace the function the
    // checker read a signature from. This is the same judgment a real engine
    // makes when it guards an assumed callee and deoptimizes on reassignment,
    // and it is what keeps the rule from charging every ordinary call for a
    // replacement that no program performs. A direct `eval` can assign to any
    // name in scope, so its presence withdraws the judgment for the whole
    // source text.
    return !assignedNames.has(name) && !hasDirectEval;
  };

  const derivationIsStable = (node: ParseNode | null | undefined): boolean => {
    if (!node || typeof node !== 'object') {
      return true;
    }
    if (node.type === 'CallExpression') {
      const callee = (node as unknown as { CallExpression?: ParseNode, MemberExpression?: ParseNode });
      const target = callee.CallExpression ?? callee.MemberExpression;
      // #sec-published-return-types: a published inferred return type never
      // licenses an elision. It is a claim read off a body rather than a
      // promise the program wrote, and until the return boundary enforces it
      // (which this increment does not yet do) nothing has checked that the
      // value leaving the function is of it. Eliding on it reopens exactly the
      // hole #sec-elision-stability closed for declared types: publication made
      // `g()` in `function g() { return f(); }` statically a `uint32`, which
      // ENABLED an elision that could not fire while the call was ~any~.
      if (target && target.type === 'IdentifierReference') {
        const calleeType = lookup((target as unknown as { name: string }).name);
        if (calleeType && calleeType.Kind === 'function' && calleeType.Signatures.length === 1) {
          const only = calleeType.Signatures[0] as { Return: Known, InferredReturn?: Known };
          if (!only.Return && only.InferredReturn) {
            return false;
          }
        }
      }
      // Only a call through a PLAIN NAME is judged here. A method call reaches
      // its callee through a property, which a program can also replace, so the
      // same reasoning applies to it - but the demonstrated failure is the
      // reassigned function binding above, and a property is a wider question
      // (a frozen intrinsic, a `readonly` field, and an ordinary property are
      // not alike). Recorded as a gap rather than closed by a rule that would
      // charge every method call for a hazard this one does not demonstrate.
      if (target && target.type === 'IdentifierReference'
          && !immutablyBound((target as unknown as { name: string }).name)) {
        return false;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'location' || key === 'strict' || key === 'sourceText') {
        continue;
      }
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === 'object' && 'type' in (c as object) && !derivationIsStable(c as ParseNode)) {
            return false;
          }
        }
      } else if (child && typeof child === 'object' && 'type' in (child as object)) {
        if (!derivationIsStable(child as ParseNode)) {
          return false;
        }
      }
    }
    return true;
  };

  const walkBindingElement = (b: ParseNode.SingleNameBinding | ParseNode.BindingElement) => {
    if (b.type === 'SingleNameBinding' && b.BindingIdentifier) {
      const declared = b.TypeAnnotation ? resolveType(b.TypeAnnotation.Type) : null;
      if (b.TypeAnnotation && declared && b.Initializer) {
        const source = staticType(b.Initializer);
        // Not `any`, not a literal, and assignable: the value is already of the
        // target type, so the boundary has nothing to do (F81).
        if (source && source.Kind !== 'any' && source.Kind !== 'literal'
            && !conversionHasEffect(declared) && IsAssignable(source, declared)
            && derivationIsStable(b.Initializer)) {
          elidableAnnotations.add(b.TypeAnnotation);
        }
      }
      // proposal-runtime-types (spec sec-enums): a parameter annotated with an enum
      // type holds an enumerator, so a switch over it can be checked.
      const boundEnum = enumOfAnnotation(b.TypeAnnotation) ?? enumOfInitializer(b.Initializer);
      if (boundEnum) {
        frames[frames.length - 1].enumBindings.set(b.BindingIdentifier.name, boundEnum);
      }
      if (b.Initializer) {
        withProvenance(b.Initializer, () => requireAssignable(staticTypeIn(b.Initializer, declared), declared));
        walk(b.Initializer);
      }
      // An OPTIONAL parameter may not be supplied, so its type includes
      // `undefined`. The checker had it as the bare annotation, which made
      // `b === undefined` a test that can never succeed - invisible until the
      // dead-branch diagnostic started reporting such tests, and then reported
      // against a program that was right (F76). A parameter with a DEFAULT is
      // not optional in this sense: it is always bound to something.
      const optional = (b as unknown as { Optional?: boolean }).Optional === true && !b.Initializer;
      declare(b.BindingIdentifier.name, optional && declared
        ? (CanonicalizeType({ Kind: 'union', Members: [declared, makePrimitive('undefined')] }) as Known)
        : declared);
    } else if (b.Initializer) {
      walk(b.Initializer);
    }
  };

  /**
   * The parameter types a function LITERAL takes from the position it is
   * written in: `a.forEach(x => ...)` on a `[].<uint8>` gives `x` the element
   * type. Recorded at the call site, keyed by the literal's node, and consulted
   * when the walk reaches it - the same channel shape the numeric overload
   * resolution uses, because a contextual type has to travel from where it is
   * known to where it is needed (F80).
   */
  const contextualParameterTypes = new Map<ParseNode, readonly Known[]>();
  /** A callback's inferred return type, keyed by the CALL that passed it. */
  const callbackReturnTypes = new Map<ParseNode, TypeRecord>();

  /**
   * #sec-check-elision at the RETURN boundary. The binding boundary could be
   * decided at the annotation, because a binding has one initializer; a return
   * annotation is shared by every `return` in the function, so the decision is
   * a property of the FUNCTION and not of any one statement. This stack
   * records, per function being walked, whether every return seen so far hands
   * back a value already of the declared type.
   *
   * The condition is F81's, unchanged: not ~any~, not a literal, and
   * assignable. A literal is assignable to `uint8` and still must be
   * CONVERTED, so `return 5` from a `(): uint8` needs its boundary; a binding
   * of type `uint8` does not.
   */
  const returnsProven: boolean[] = [];

  /**
   * The enclosing generator's declared type, for `yield` to read its N.
   *
   * PLAN-do-expressions.md phase 1. It cannot live in `returnTypes`: a `return`
   * inside a generator sets the generator's R rather than producing the
   * generator, so checking one against `Generator.<Y, R, N>` would be checking
   * it against the wrong thing. That is why the generator forms enter with a
   * null return annotation, and why the type they DO have needs its own frame.
   */
  const generatorTypes: Known[] = [];

  /**
   * The classes whose bodies the walk is inside, innermost last.
   *
   * README: "A member marked `protected` is accessible within its declaring
   * class AND ITS SUBCLASSES, and nowhere else." Answering that needs to know
   * WHERE an access is, which nothing tracked - a member access knew what it
   * read and not its own surroundings.
   */
  const classContext: string[] = [];

  /** The declared name of a nominal receiver, which is what the context holds. */
  const ownerNameOf = (t: TypeRecord): string | undefined => {
    if (t.Kind !== 'nominal') {
      return undefined;
    }
    const decl = (t as { Declaration?: { BindingIdentifier?: { name?: string } | null } }).Declaration;
    return decl?.BindingIdentifier?.name ?? (t as { LibraryName?: string }).LibraryName;
  };

  /** Whether `name` extends `base`, walking the declared heritage chain. */
  const inheritsFrom = (name: string, base: string): boolean => {
    const seen = new Set<string>();
    let current: string | undefined = name;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      const node = classNodes.get(current) as { ClassTail?: { ClassHeritage?: { name?: string } | null } | null } | undefined;
      const parent = node?.ClassTail?.ClassHeritage?.name;
      if (parent === base) {
        return true;
      }
      current = parent;
    }
    return false;
  };

  /**
   * The `protected` access rule, checked IN THE WALK rather than in
   * `staticType`.
   *
   * `staticType` runs ON DEMAND - and a bare `b.a;` statement's type is never
   * demanded, so a rule written there fires only where something happens to ask.
   * That is the shape the class member walk was fixed for: **a rule checked
   * where nothing asks is no rule at all.**
   */
  const checkProtectedAccess = (node: ParseNode): void => {
    const m = node as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null };
    if (!m.MemberExpression || !m.IdentifierName) {
      return;
    }
    // `this.x` and `super.x` are inside by construction, and asking for the
    // receiver's type there would recurse into the class being defined.
    if (m.MemberExpression.type === 'ThisExpression' || m.MemberExpression.type === 'SuperProperty') {
      return;
    }
    const receiver = staticType(m.MemberExpression);
    if (!receiver) {
      // An `any`-typed reference has no static type here, and the design says
      // it must still reach: "a protected field ... stays reachable through
      // reflection or an `any`-typed reference, the erasure other languages
      // apply to it".
      return;
    }
    const shape = structureOf(receiver);
    if (!shape || shape.Kind !== 'object') {
      return;
    }
    const prop = shape.Properties.find((pr) => pr.key === m.IdentifierName!.name);
    if (prop?.protected !== true) {
      return;
    }
    const owner = ownerNameOf(receiver);
    if (owner === undefined) {
      return;
    }
    if (classContext.some((c) => c === owner || inheritsFrom(c, owner))) {
      return;
    }
    errors.push((Throw.TypeError('$1 is protected', Value(String(prop.key))) as ThrowCompletion).Value as ObjectValue);
  };

  const enterFunction = (params: readonly ParseNode[] | null | undefined, returnAnnotation: ParseNode.TypeAnnotation | null | undefined, body: ParseNode | readonly ParseNode[] | null | undefined, checkReturns: boolean, contextual?: readonly Known[], generatorType?: Known) => {
    frames.push({ bindings: new Map(), constLiterals: new Set<string>(), constLiteralTypes: new Map<string, TypeRecord>(), letConstants: new Set<string>(), immutableNames: new Set<string>(), declaredNames: new Set<string>(), aliases: new Map(), enums: new Map(), enumBindings: new Map() });
    returnTypes.push(checkReturns && returnAnnotation ? resolveType(returnAnnotation.Type) : null);
    generatorTypes.push(generatorType ?? null);
    returnsProven.push(true);
    let index = 0;
    for (const p of params ?? []) {
      if (p.type === 'SingleNameBinding' || p.type === 'BindingElement') {
        const fromContext = contextual?.[index];
        const annotated = (p as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
        walkBindingElement(p);
        // An ANNOTATION wins over the context, since the program said what it
        // wanted; the context fills a parameter that said nothing.
        if (fromContext && !annotated && p.type === 'SingleNameBinding' && (p as ParseNode.SingleNameBinding).BindingIdentifier) {
          declare((p as ParseNode.SingleNameBinding).BindingIdentifier!.name, fromContext);
        }
        // A parameter SHADOWS an outer binding of the same name, whether or not
        // its own type resolves. The name is bound by resolving the annotation,
        // and an annotation naming an unbound type parameter - `[N].<uint8>` -
        // does not resolve, so the name went unbound and a module-scope binding
        // of the same name was read in the body instead. The TYPE is unknown;
        // the binding is not optional.
        const named = p.type === 'SingleNameBinding'
          ? (p as ParseNode.SingleNameBinding).BindingIdentifier?.name
          : undefined;
        if (named && !frames[frames.length - 1].declaredNames.has(named)) {
          declare(named, annotated ? resolveType(annotated.Type) : null);
        }
      }
      index += 1;
    }
    if (body) {
      // proposal-runtime-types #sec-overloading-on-return-type: a CONCISE arrow
      // body is a return position - `(): string => f()` requires a string of
      // the expression exactly as `return f()` does - so the declared return
      // type is recorded on that expression before it is walked.
      //
      // The statement form needs nothing here because its `return` reaches the
      // runtime push; a concise body has no return statement to reach it, and
      // the checker refuses the declaration before any call runs.
      const conciseReturn = returnTypes[returnTypes.length - 1];
      if (conciseReturn) {
        const expr = (body as { ExpressionBody?: { AssignmentExpression?: ParseNode } }).ExpressionBody?.AssignmentExpression
          ?? (body as { AssignmentExpression?: ParseNode }).AssignmentExpression;
        if (expr) {
          (expr as unknown as { ContextualType?: Known }).ContextualType = conciseReturn;
        }
      }
      walk(body);
    }
    const proven = returnsProven.pop();
    const declaredReturn = returnTypes[returnTypes.length - 1];
    if (checkReturns && returnAnnotation && declaredReturn && proven
        && !conversionHasEffect(declaredReturn) && endsWithReturn(body)) {
      elidableAnnotations.add(returnAnnotation);
    }
    returnTypes.pop();
    generatorTypes.pop();
    frames.pop();
  };

  const pushBlock = <T,>(f: () => T): T => {
    // A block or switch introduces a scope; a binding declared inside shadows
    // an outer one without disturbing it. Overwriting in the same frame stays
    // sound because an unknown type is any.
    frames.push({ bindings: new Map(), constLiterals: new Set<string>(), constLiteralTypes: new Map<string, TypeRecord>(), letConstants: new Set<string>(), immutableNames: new Set<string>(), declaredNames: new Set<string>(), aliases: new Map(), enums: new Map(), enumBindings: new Map() });
    // PLAN-declarative-checker-facts.md phase 3, the ~void~ form: a deferral
    // opened by an assertion statement covers the rest of ITS block and no
    // further, so the depth is restored with the frame it belongs to.
    const deferredAtEntry = deferredGuardDepth;
    try {
      return f();
    } finally {
      deferredGuardDepth = deferredAtEntry;
      frames.pop();
    }
  };

  /**
   * The type an expression in a narrowing position DENOTES, when it denotes one.
   * The right operand of `instanceof` is an expression, so it may name a built-in
   * type or a type alias, in which case the narrowing rows apply, or it may be an
   * ordinary constructor, in which case there is no Static Type to narrow against
   * and the form is left alone.
   */
  const typeDenotedBy = (node: ParseNode | null | undefined): Known => {
    if (!node || node.type !== 'IdentifierReference') {
      return null;
    }
    const name = (node as { name: string }).name;
    return lookupAlias(name) ?? builtinTypeRecord(name);
  };

  /**
   * proposal-runtime-types (README, explicit resource management): a `using`
   * declaration's declared type must be one whose values can carry a disposal
   * method, since the declaration promises to dispose what it binds. A value type
   * and `void` never can, so annotating a resource with one is a mistake the
   * checker reports; `never` is the empty union and falls out of the union arm. `null` and `undefined` ARE admitted, because the
   * declaration permits them at runtime and registers nothing.
   *
   * This is the direction of the README's rule rather than its exact form. The
   * precise statement is that the declared type must include `[Symbol.dispose]`,
   * which cannot be checked yet because the type grammar has no symbol-keyed
   * member: `{ [Symbol.dispose](): void }` is rejected with "a computed member name
   * is not supported yet", so no type can declare the method to be looked for.
   * Rejecting every object type instead would make the annotation unusable, so the
   * checker catches what it provably can and the exact membership check waits on
   * that grammar.
   */
  const canCarryDisposal = (t: TypeRecord): boolean => {
    switch (t.Kind) {
      case 'any':
        return true;
      case 'union':
        return (t as { Members: readonly TypeRecord[] }).Members.some(canCarryDisposal);
      case 'literal': {
        const v = (t as { Value: unknown }).Value;
        return v === Value.null || v === Value.undefined;
      }
      case 'primitive':
        // `null` and `undefined` are primitive types named for their one value
        // (#sec-null-and-undefined-types), and a `using` declaration accepts
        // either - the disposal is simply skipped. They were literal types
        // before, and the case above answered for them.
        return (t as { Name?: string }).Name === 'null' || (t as { Name?: string }).Name === 'undefined';
      case 'void':
        return false;
      default:
        return true;
    }
  };

  /**
   * Whether a test sits where it decides a branch: the condition of `if`, `while`,
   * `do`, or `for`, the test of a conditional expression, or inside a parenthesis
   * or a `!` over one of those. The operands of `&&` and `||` guard in a weaker
   * sense and the specification does not name them, so they are left out of this
   * pass along with a test written as an ordinary Boolean value.
   */
  const guardsABranch = (node: ParseNode): boolean => {
    let child: ParseNode = node;
    let parent = (child as { parent?: ParseNode }).parent;
    while (parent) {
      switch (parent.type) {
        case 'IfStatement':
        case 'WhileStatement':
        case 'DoWhileStatement':
        case 'ConditionalExpression':
          return (parent as unknown as Record<string, unknown>).Expression === child
            || (parent as unknown as Record<string, unknown>).ShortCircuitExpression === child;
        case 'ForStatement':
          return (parent as unknown as Record<string, unknown>).Expression_b === child;
        case 'ParenthesizedExpression':
        case 'UnaryExpression':
          child = parent;
          parent = (parent as { parent?: ParseNode }).parent;
          continue;
        default:
          return false;
      }
    }
    return false;
  };

  /**
   * Report a narrowing form whose test cannot succeed, or cannot fail. Both are
   * type errors: the branch guarded is dead code the program did not intend. A
   * type the checker does not know is ~any~, which narrows to itself in both
   * directions and so never reports.
   */
  const reportImpossibleTest = (s: TypeRecord, t: TypeRecord, form: string, isGuard: boolean) => {
    // The specification states this rule about the BRANCHES a narrowing form
    // decides: a test that can never succeed, or can never fail, leaves a branch
    // that can never be taken, and that is dead code the program did not intend.
    // Where the form decides no branch, the same test is merely a question with a
    // constant answer, which a program may legitimately ask, so it is left alone.
    if (!isGuard) {
      return;
    }
    // A DYNAMIC array tested against a TUPLE type is not decidable here, and
    // narrowing answers as though it were: `[].<uint8>` is not assignable to
    // `[uint8, ...string]`, so NarrowTo keeps no member and the test reads as
    // dead - but whether the value has the tuple's shape depends on its LENGTH,
    // which a dynamic array's type does not carry. `[(1 := uint8)] instanceof
    // [uint8, ...string]` is *true* at run time, and became a reported error the
    // moment an array literal acquired a Static Type. The same holds in reverse,
    // since a tuple-typed value is an Array.
    const arrayVersusTuple = (a: TypeRecord, b: TypeRecord): boolean => (a.Kind === 'array' && (a as { Extent?: unknown }).Extent === 'dynamic' && b.Kind === 'tuple')
      || (b.Kind === 'array' && (b as { Extent?: unknown }).Extent === 'dynamic' && a.Kind === 'tuple');
    if (arrayVersusTuple(s, t)) {
      return;
    }
    if (NarrowTo(s, t) === empty) {
      const completion = Throw.TypeError('the $1 test can never succeed, so the branch it guards is dead code', Value(form)) as ThrowCompletion;
      errors.push(completion.Value as ObjectValue);
      return;
    }
    if (NarrowFrom(s, t) === empty) {
      const completion = Throw.TypeError('the $1 test can never fail, so the branch it guards is dead code', Value(form)) as ThrowCompletion;
      errors.push(completion.Value as ObjectValue);
    }
  };

  // The enclosing `for`-over-a-range loops, innermost last: each binding name
  // with the exclusive upper bound its range proves and whether the lower bound
  // is at least zero. A counter drawn from `0..<N` is in [0, N), which is what
  // makes an index into a `[N]` provable without any check.

  /**
   * A compile-time numeric constant expression: a numeric literal, a sign
   * applied to one, a parenthesized one, or an operator over two of them. The
   * boundary is deliberately the SAME shape literal propagation already has, so
   * `2 * 3.14` qualifies and `f()` does not - widening it would put the checker
   * in the business of evaluating arbitrary code.
   */
  const isNumericConstantExpression = (expr: ParseNode | null | undefined): boolean => {
    if (!expr) {
      return false;
    }
    const e = expr as ParseNode & {
      Expression?: ParseNode, UnaryExpression?: ParseNode, operator?: string,
      AdditiveExpression?: ParseNode, MultiplicativeExpression?: ParseNode,
      ExponentiationExpression?: ParseNode, UpdateExpression?: ParseNode, value?: unknown,
    };
    switch (e.type) {
      case 'NumericLiteral':
        return typeof e.value === 'number';
      // D3: a reference to a marked `const` is itself constant, so
      // `const A = 3.14; const B = A * 2` chains. Without this the feature
      // applies exactly one level deep, and `const TAU = 2 * PI` - which is what
      // people write - is refused for a reason no user could state.
      //
      // Resolved through the frames rather than by name, and stopping at the
      // first frame that declares the name, so an inner `let` shadowing an
      // adopting `const` does not make its uses constant.
      case 'IdentifierReference': {
        const refName = (e as unknown as { name?: string }).name;
        if (typeof refName !== 'string') {
          return false;
        }
        for (let i = frames.length - 1; i >= 0; i -= 1) {
          if (frames[i].constLiterals.has(refName)) {
            return true;
          }
          if (frames[i].declaredNames.has(refName)) {
            return false;
          }
        }
        return false;
      }
      case 'ParenthesizedExpression':
        return isNumericConstantExpression(e.Expression);
      case 'UnaryExpression':
        return (e.operator === '-' || e.operator === '+') && isNumericConstantExpression(e.UnaryExpression);
      // The operands are named after the productions rather than left/right.
      case 'AdditiveExpression':
        return isNumericConstantExpression(e.AdditiveExpression)
          && isNumericConstantExpression(e.MultiplicativeExpression);
      case 'MultiplicativeExpression':
        return isNumericConstantExpression(e.MultiplicativeExpression)
          && isNumericConstantExpression(e.ExponentiationExpression);
      case 'ExponentiationExpression':
        return isNumericConstantExpression(e.UpdateExpression)
          && isNumericConstantExpression(e.ExponentiationExpression);
      default:
        return false;
    }
  };
  const rangeCounters: { name: string, exclusiveEnd: number, nonNegative: boolean }[] = [];
  const provenHere = new Set<object>();

  /**
   * The exclusive upper bound a range EXPRESSION proves for its counter, where
   * both endpoints are compile-time constants. `0..<10` proves 10 and `0..=10`
   * proves 11; an open start raises the floor and does not change the ceiling.
   * A non-constant endpoint proves nothing, which is why `0..<a.length` is not
   * here - it bounds the counter when the range was BUILT, not when the index
   * is used.
   */
  const rangeCounterBound = (expr: ParseNode | null | undefined) => {
    if (!expr || (expr as ParseNode).type !== 'RangeExpression') {
      return undefined;
    }
    const r = expr as unknown as {
      RangeStart?: { type?: string, value?: unknown, negated?: boolean } | null,
      RangeEnd?: { type?: string, value?: unknown, negated?: boolean } | null,
      RangeStartBound?: string | null, RangeEndBound?: string | null,
    };
    const constant = (lit: typeof r.RangeStart) => {
      if (!lit || typeof lit.value !== 'number' || lit.negated) {
        return undefined;
      }
      return lit.value;
    };
    const start = constant(r.RangeStart);
    const end = constant(r.RangeEnd);
    if (start === undefined || end === undefined || !Number.isInteger(start) || !Number.isInteger(end)) {
      return undefined;
    }
    const floor = r.RangeStartBound === 'open' ? start + 1 : start;
    const ceiling = r.RangeEndBound === 'open' ? end : end + 1;
    return { exclusiveEnd: ceiling, nonNegative: floor >= 0 };
  };

  const walk = (node: ParseNode | readonly ParseNode[] | null | undefined): void => {
    if (!node) {
      return;
    }
    if (!Array.isArray(node) && (node as ParseNode).type === 'ForOfStatement') {
      const f = node as unknown as {
        AssignmentExpression?: ParseNode, ForDeclaration?: ParseNode,
        ForBinding?: ParseNode, Statement?: ParseNode,
      };
      const bound = rangeCounterBound(f.AssignmentExpression);
      const decl = (f.ForDeclaration ?? f.ForBinding) as unknown as {
        ForBinding?: { BindingIdentifier?: { name?: string } },
        BindingIdentifier?: { name?: string },
      } | undefined;
      const name = decl?.ForBinding?.BindingIdentifier?.name ?? decl?.BindingIdentifier?.name;
      walk(f.AssignmentExpression);
      if (bound && typeof name === 'string') {
        rangeCounters.push({ name, ...bound });
        try {
          walk(f.Statement);
        } finally {
          rangeCounters.pop();
        }
        return;
      }
      walk(f.Statement);
      return;
    }
    if (!Array.isArray(node) && (node as ParseNode).type === 'IdentifierReference') {
      const name = (node as unknown as { name?: string }).name;
      if (typeof name === 'string') {
        // Innermost first, and STOP at the first frame that binds the name -
        // an inner `let K` shadows an outer adopting `const K` and must not
        // inherit its treatment.
        for (let i = frames.length - 1; i >= 0; i -= 1) {
          if (frames[i].constLiterals.has(name)) {
            constLiteralUses.add(node as object);
            break;
          }
          if (frames[i].letConstants.has(name)) {
            letConstantUses.add(node as object);
            break;
          }
          if (frames[i].declaredNames.has(name)) {
            break;
          }
        }
      }
    }
    // #sec-bounds-checks: a computed index into a fixed-length `[N].<T>` whose
    // key is a range counter proven below _N_.
    if (!Array.isArray(node) && (node as ParseNode).type === 'MemberExpression') {
      const m = node as unknown as {
        MemberExpression?: ParseNode, Expression?: ParseNode, IdentifierName?: unknown,
      };
      const key = m.Expression as unknown as { type?: string, name?: string } | undefined;
      if (m.MemberExpression && key && key.type === 'IdentifierReference' && typeof key.name === 'string') {
        const counter = rangeCounters.findLast((c) => c.name === key.name);
        if (counter && counter.nonNegative) {
          const objType = staticTypeIn(m.MemberExpression, null);
          const extent = (objType as unknown as { Kind?: string, Extent?: number | string } | null);
          if (extent && extent.Kind === 'array' && typeof extent.Extent === 'number'
              && counter.exclusiveEnd <= extent.Extent) {
            provenHere.add(node as object);
          }
        }
      }
    }
    if (Array.isArray(node)) {
      // Function declarations are hoisted, so a call may precede the
      // declaration. Their signatures are declared over the whole list before
      // any of it is walked, which is what lets `f(300)` above `function
      // f(v: uint8) {}` be the Early Error it should be (F56).
      declareFunctionSignatures(node as readonly ParseNode[]);
      node.forEach((n) => walk(n));
      return;
    }
    const n = node as ParseNode;
    switch (n.type) {
      // proposal-runtime-types (spec, narrowing): it is a type error to apply a
      // narrowing form whose test can never succeed or can never fail, those being
      // the branches for which NarrowTo or NarrowFrom is ~empty~, since the branch
      // guarded is dead code the program did not intend.
      case 'LexicalDeclaration': {
        // proposal-runtime-types (README, explicit resource management): the type
        // declared for a resource must be one that can be disposed.
        const decl = n as ParseNode.LexicalDeclaration;
        if (decl.LetOrConst === 'using') {
          for (const binding of decl.BindingList) {
            const ann = (binding as { TypeAnnotation?: ParseNode.TypeAnnotation }).TypeAnnotation;
            if (!ann) {
              continue;
            }
            const declared = resolveType(ann.Type);
            if (declared && !canCarryDisposal(declared)) {
              const completion = Throw.TypeError('a using declaration cannot be typed $1, whose values carry no disposal method', Value(displayType(declared))) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
          }
        }
        walk(decl.BindingList);
        return;
      }
      case 'IsExpression': {
        // The type OPERAND is resolved so an expression-position
        // parameterization is collected for the unclaimed-key adjudication:
        // `x is T.<{ ... }>` writes the parameterization as surely as an
        // annotation does. F44 claimed the type-meta pin had flipped; it had
        // not, because this position was never resolved, and F45 closes that
        // by resolving it here and at the bare cast below.
        const ie = n as ParseNode.IsExpression;
        walk(ie.Expression as ParseNode);
        const iePattern = ie.Pattern as { type?: string, Type?: ParseNode } | null | undefined;
        const ieType = ie.Type ?? (iePattern?.type === 'MatchTypePattern' ? iePattern.Type : null);
        if (ieType) {
          resolveType(ieType as ParseNode.Type);
        }
        return;
      }
      case 'TypedConversionExpression': {
        const tc = n as ParseNode.TypedConversionExpression;
        const target = resolveType(tc.Type);
        // A cast is a contextual position FOR A LITERAL, and only for one.
        // #sec-literalvalueintype is about "a literal in a position whose type
        // is known", and a conversion's target is as known as an annotation, so
        // `(9007199254740993 := int64)` must read its digits exactly rather than
        // taking the double the lexer made.
        //
        // Offering the target to an arbitrary operand would be a different and
        // wrong thing: a contextual type also RANKS OVERLOADS, and the numeric
        // library's listing turns on the difference between converting the
        // result and converting the operand - `(Math.sqrt((10 := uint8)) := float64)`
        // keeps the integer row's exact root, where `Math.sqrt((10 := float64))`
        // selects the float row's approximation. Reading the call through the
        // target collapsed the two.
        if ((tc.Expression as ParseNode).type === 'NumericLiteral') {
          staticTypeIn(tc.Expression as ParseNode, target);
        }
        walk(tc.Expression as ParseNode);
        return;
      }
      case 'RelationalExpression': {
        const rel = n as ParseNode.RelationalExpression;
        if (rel.operator === 'instanceof' && rel.RelationalExpression) {
          const s = staticType(rel.RelationalExpression as ParseNode);
          const t = typeDenotedBy(rel.ShiftExpression as ParseNode);
          if (s && t) {
            reportImpossibleTest(s, t, 'instanceof', guardsABranch(rel as ParseNode));
          }
        }
        walk(rel.RelationalExpression as ParseNode);
        walk(rel.ShiftExpression as ParseNode);
        return;
      }
      case 'CoalesceExpression': {
        const co = n as ParseNode.CoalesceExpression;
        const s = staticType(co.CoalesceExpressionHead as ParseNode);
        if (s) {
          reportImpossibleTest(s, nullishType(), '??', true);
        }
        walk(co.CoalesceExpressionHead as ParseNode);
        walk(co.BitwiseORExpression as ParseNode);
        return;
      }
      case 'ExpressionStatement': {
        // PLAN-declarative-checker-facts.md phase 3, the ~void~ form.
        // #sec-declared-narrowing: an assertion narrows "every position the
        // call dominates" rather than a branch, so it is applied AFTER the
        // statement is walked and takes effect for its siblings - which the
        // generic walk visits in order, and whose extent is the enclosing
        // block's frame.
        for (const key of Object.keys(n)) {
          if (key === 'parent' || key === 'location' || key === 'strict' || key === 'sourceText') {
            continue;
          }
          const child = (n as unknown as Record<string, unknown>)[key];
          if (Array.isArray(child) || (child && typeof child === 'object' && 'type' in (child as object))) {
            walk(child as ParseNode);
          }
        }
        applyAssertionNarrowing(n);
        return;
      }
      case 'Block':
      case 'CaseBlock':
        pushBlock(() => {
          for (const key of Object.keys(n)) {
            if (key === 'parent' || key === 'location' || key === 'strict' || key === 'sourceText') {
              continue;
            }
            const child = (n as unknown as Record<string, unknown>)[key];
            if (Array.isArray(child) || (child && typeof child === 'object' && 'type' in (child as object))) {
              walk(child as ParseNode);
            }
          }
        });
        return;
      case 'TypeAliasDeclaration': {
        // #sec-type-alias-declarations: the Type may name the alias itself.
        // The name is registered against an empty record BEFORE the Type is
        // resolved, so a self-reference resolves to it rather than to nothing,
        // and that same record is filled in place once the Type is known. The
        // runtime does the same thing at its own declaration evaluation; if
        // only one of the two did, a recursive alias would resolve on one side
        // and be silently unchecked on the other.
        const placeholder = { Kind: 'object', Properties: [], IndexSignatures: [] } as unknown as TypeRecord;
        const isPlainAlias = !(n as unknown as { TypeParameters?: unknown }).TypeParameters;
        const aliasScope = frames[frames.length - 1].aliases;
        const hadAlias = aliasScope.has(n.BindingIdentifier.name);
        const previousAlias = aliasScope.get(n.BindingIdentifier.name);
        if (isPlainAlias) {
          aliasScope.set(n.BindingIdentifier.name, placeholder);
        }
        const resolved = resolveType(n.Type);
        if (isPlainAlias && !resolved) {
          // The Type did not resolve - an indexed access with a non-literal
          // key, say, which the checker does not model. The placeholder must
          // not be left standing in that case: the alias would resolve to an
          // EMPTY object type and every annotation naming it would be checked
          // against that, turning an unmodelled type into a spurious error.
          // Nothing was registered for such an alias before, so nothing is now.
          if (hadAlias) {
            aliasScope.set(n.BindingIdentifier.name, previousAlias as TypeRecord);
          } else {
            aliasScope.delete(n.BindingIdentifier.name);
          }
        }
        if (isPlainAlias && resolved && resolved !== placeholder) {
          const target = placeholder as unknown as Record<string, unknown>;
          for (const key of Object.keys(target)) {
            delete target[key];
          }
          Object.assign(target, resolved);
        }
        if (resolved) {
          // proposal-runtime-types `sec-dependent-record-types`: an alias
          // carrying `where` clauses keeps its NOMINAL identity, wrapping the
          // structure, because the predicate lives on the DECLARATION and a
          // bare structure cannot reach it.
          //
          // Without this a dependent-record-typed binding resolved to a plain
          // `object` and `sec-match-exhaustiveness`'s "the atoms of the union
          // that chain denotes" had no chain to read - the same shape as an
          // enum annotation resolving to nothing, one declaration form over.
          // It is the record the RUNTIME already builds for such a type:
          // `{ Kind: nominal, Declaration, Arguments, Structure }`.
          const whereClauses = (n as unknown as { WhereClauses?: readonly unknown[] }).WhereClauses;
          const aliasType = whereClauses && whereClauses.length > 0
            ? ({
              Kind: 'nominal', Declaration: n, Arguments: [], Structure: resolved,
            } as unknown as TypeRecord)
            : (isPlainAlias ? placeholder : resolved);
          frames[frames.length - 1].aliases.set(n.BindingIdentifier.name, aliasType);
        } else if ((n as unknown as { TypeParameters?: unknown }).TypeParameters) {
          // proposal-runtime-types: capture the prelude's `Identity` so the
          // global binding can hold a PARSED declaration. Every consumer of a
          // declaration node reads fields the parser sets, and an assembled
          // node crashes at the first enforced annotation.
          if (n.BindingIdentifier.name === 'Identity' && !getParsedIdentityDeclaration()) {
            setParsedIdentityDeclaration(
              { Kind: 'nominal', Declaration: n, Arguments: [] } as unknown as TypeRecord,
            );
          }
          // proposal-runtime-types: a GENERIC alias resolves its body with its
          // parameters unbound, so `type Identity<T> = T` yields nothing and the
          // name was registered nowhere. That is right for a type position -
          // a bare generic alias is not a type - and wrong everywhere the name
          // denotes the DECLARATION, which is what a higher-kinded argument
          // binds. The declaration is recorded under its own name so those
          // positions can reach it, and a type position still refuses it,
          // because a nominal whose declaration is an alias is not a type.
          frames[frames.length - 1].aliases.set(
            n.BindingIdentifier.name,
            { Kind: 'nominal', Declaration: n, Arguments: [] } as unknown as TypeRecord,
          );
        }
        return;
      }
      case 'EnumDeclaration': {
        // proposal-runtime-types (spec sec-enums): record the enum's member names
        // so a switch over one of its enumerators can be checked for exhaustiveness.
        const names = n.EnumMemberList.map((m) => m.IdentifierName.name);
        frames[frames.length - 1].enums.set(n.BindingIdentifier.name, { names });
        // The NODE as well as the names, so the enum can be resolved as a type.
        enumNodes.set(n.BindingIdentifier.name, n);
        // #sec-enums: an enumerator's value "is a value of the underlying type",
        // so its initializer stands in a position of that type and a literal
        // there takes it - the rule #sec-literal-propagation gives an annotated
        // binding. Nothing gave the initializers a contextual type, so the marks
        // the checker leaves for evaluation were never set: a decimal
        // enumeration could not be written at all, since a decimal reads its
        // cohort member from the SOURCE TEXT and by evaluation time the literal
        // is a double, and `1.0` and `1.00` are one double and two decimals.
        //
        // The type is only APPLIED here, not enforced: an enumerator may also be
        // initialized with a two-parameter function, which the clause calls
        // rather than stores, so it is not assignable to the underlying type and
        // requiring that would reject the design's own sequential form. The
        // conversion at declaration time is what checks the value.
        if (n.TypeAnnotation) {
          const underlying = resolveType(n.TypeAnnotation.Type);
          if (underlying) {
            n.EnumMemberList.forEach((m) => {
              if (m.Initializer) {
                staticTypeIn(m.Initializer as ParseNode, underlying);
              }
            });
          }
        }
        return;
      }
      case 'MatchExpression': {
        // proposal-runtime-types `sec-match-exhaustiveness`: "A `match` over an
        // enum-typed or sealed-class-typed subject is exhaustive under the same
        // rules a `switch` is, and this clause adds no new ones - it SHARES
        // them." So this reads the same enum-name table the `SwitchStatement`
        // case does rather than building a second one.
        const me = n as ParseNode.MatchExpression;
        walk(me.Expression as ParseNode);
        const subjectType = staticType(me.Expression as ParseNode);
        me.Clauses.forEach((clause) => {
          // proposal-runtime-types `sec-match-narrowing`: an arm sees what its
          // pattern ESTABLISHED. A clause is its own scope - "a fresh
          // declarative environment per clause" at run time - so the checker
          // gives it a frame and declares the pattern's bindings in it, which is
          // what stops one arm's binding from leaking into the next.
          frames.push({ bindings: new Map(), constLiterals: new Set<string>(), constLiteralTypes: new Map<string, TypeRecord>(), letConstants: new Set<string>(), immutableNames: new Set<string>(), declaredNames: new Set<string>(), aliases: new Map(), enums: new Map(), enumBindings: new Map() });
          // The SUBJECT's static type is what a top-level binding takes.
          // Computed once for the whole `match`, since every clause matches the
          // same subject.
          declareMatchPatternBindings(clause.Pattern, subjectType);
          if (clause.Guard) {
            // The guard sees the bindings, which is what makes it a refinement
            // of this clause rather than a second, independent test.
            walk(clause.Guard as ParseNode);
          }
          walk(clause.Body as ParseNode);
          frames.pop();
        });
        // proposal-runtime-types `sec-match-exhaustiveness`: the atoms of the
        // SUBJECT'S TYPE, through the one operation that knows all of them,
        // rather than a name lookup on the binding.
        //
        // The name lookup required the subject to be an |IdentifierReference|.
        // It was written that way because a bare enum ANNOTATION resolved to
        // nothing - `function f(e: E)` gave `e` no static type - which is fixed
        // where enums are resolved as types.
        //
        // **(measured)** removing that restriction does NOT by itself check
        // `match (g())` over an enum-returning call: the subject's type comes
        // from `staticType`, and a call's RETURN annotation does not resolve to
        // the enum record either. Same class of gap, one resolution site
        // further on, and not fixed here - recorded so the capability is not
        // claimed before it exists.
        const enumAtoms = Atoms(subjectType ?? undefined);
        // proposal-runtime-types `sec-discriminated-where-chains`: a dependent
        // record type's atoms are the atoms of the union its chain denotes.
        // **The coverage rule differs from the enum path's**: an atom here is an
        // OBJECT type, and `sec-match-exhaustiveness` says such an atom is
        // "additionally covered by a structural pattern each of whose named
        // members is declared required by the atom" - which is what makes
        // `when { c: 'US' }` cover a branch.
        const chainAtoms = AtomsOfType(subjectType ?? undefined);
        if (chainAtoms.length > 0 && enumAtoms.length === 0) {
          const coveredAtoms = new Set<string>();
          let chainDefault = false;
          for (const clause of me.Clauses) {
            if (clause.Pattern === null) {
              chainDefault = true;
              continue;
            }
            if (clause.Guard) {
              continue;
            }
            for (const atom of chainAtoms) {
              if (structuralPatternCovers(clause.Pattern, atom.type)) {
                coveredAtoms.add(atom.key);
              }
            }
          }
          if (!chainDefault) {
            const missing = chainAtoms.filter((a) => !coveredAtoms.has(a.key));
            if (missing.length > 0) {
              const completion = Throw.TypeError(
                'match over $1 is missing $2 and has no default',
                Value(displayType(subjectType!)),
                Value(missing.map((a) => a.key).join(', ')),
              ) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
          }
        }
        const matchEnumName = enumAtoms.length > 0 ? enumAtoms[0].owner ?? null : null;
        const matchInfo = matchEnumName ? { names: enumAtoms.map((a) => a.key) } : null;
        if (matchInfo) {
          const covered = new Set<string>();
          let hasDefault = false;
          for (const clause of me.Clauses) {
            if (clause.Pattern === null) {
              hasDefault = true;
              continue;
            }
            // "A GUARDED ARM PROVES NOTHING, since the checker does not evaluate
            // guards" - so a guarded clause does not count towards coverage
            // however exhaustive its pattern looks.
            if (clause.Guard) {
              continue;
            }
            const pattern = clause.Pattern;
            if (pattern.type !== 'MatchTypePattern') {
              continue;
            }
            // `E.A` as a PATTERN is a |TypeReference| whose |TypeName| carries
            // an IdentifierReference and a list of MemberNames - NOT the
            // MemberExpression shape a switch CASE LABEL has, which is an
            // expression. The same enumerator spelled in the two positions
            // reaches the checker as two different node shapes, and reading the
            // label shape here found nothing: every clause looked uncovered and
            // an exhaustive `match` was reported as missing every member.
            const label = pattern.Type as unknown as {
              TypeName?: { IdentifierReference?: { name?: string }, MemberNames?: readonly { name: string }[] },
            };
            const typeName = label.TypeName;
            const labelEnum = typeName?.IdentifierReference?.name;
            const members = typeName?.MemberNames ?? [];
            if (labelEnum === matchEnumName && members.length === 1) {
              const member = members[0]!.name;
              if (matchInfo.names.includes(member)) {
                covered.add(member);
              }
            }
          }
          if (!hasDefault) {
            const missing = matchInfo.names.filter((nm) => !covered.has(nm));
            if (missing.length > 0) {
              const completion = Throw.TypeError('match over enum $1 is missing $2 and has no default', Value(matchEnumName!), Value(missing.join(', '))) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
          }
        }
        // A SEALED-CLASS subject is a closed set too, and `sec-match-exhaustiveness`
        // names it beside enums - so it is checked here rather than in a second
        // pass that could disagree about coverage.
        // Through the same operation the enum path uses. A sealed class's
        // subclasses live in a map the checker owns, so `Atoms` takes them as a
        // hook - the way it takes a dependent record type's denotation - rather
        // than reaching for checker state it cannot see.
        const sealedDecl = (subjectType as { Kind?: string, Declaration?: ParseNode } | null | undefined);
        const sealedAtoms = Atoms(subjectType ?? undefined, undefined, (t) => {
          const d = (t as { Declaration?: ParseNode }).Declaration;
          const subs = d ? sealedSubclasses.get(d) : undefined;
          return subs?.map((c) => ({
            name: (c as unknown as { BindingIdentifier?: { name: string } | null }).BindingIdentifier?.name ?? '?',
            declaration: c,
          }));
        });
        const subclasses = sealedAtoms
          .map((a) => a.declaration)
          .filter((d): d is ParseNode => d !== undefined && d !== sealedDecl?.Declaration);
        if (subclasses.length > 0) {
          const coveredClasses = new Set<ParseNode>();
          let sealedDefault = false;
          for (const clause of me.Clauses) {
            if (clause.Pattern === null) {
              sealedDefault = true;
              continue;
            }
            // A guarded arm proves nothing here for the same reason it proves
            // nothing over an enum: the checker does not evaluate guards.
            if (clause.Guard || clause.Pattern.type !== 'MatchTypePattern') {
              continue;
            }
            const armType = resolveType(clause.Pattern.Type);
            const armDecl = (armType as { Declaration?: ParseNode } | null | undefined)?.Declaration;
            if (armDecl) {
              coveredClasses.add(armDecl);
            }
          }
          if (!sealedDefault) {
            const missingClasses = subclasses.filter((c) => !coveredClasses.has(c));
            if (missingClasses.length > 0) {
              const shown = missingClasses
                .map((c) => (c as unknown as { BindingIdentifier?: { name: string } | null }).BindingIdentifier?.name ?? '?')
                .join(', ');
              const sealedName = (sealedDecl!.Declaration as unknown as { BindingIdentifier?: { name: string } | null }).BindingIdentifier?.name ?? '?';
              const completion = Throw.TypeError('match over sealed class $1 is missing $2 and has no default', Value(sealedName), Value(shown)) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
          }
        }
        return;
      }
      case 'TryStatement': {
        // proposal-runtime-types #sec-typed-catch: "It is a type error if a
        // Catch other than the last of its CatchClauses has no TypeAnnotation."
        // An untyped clause catches everything, so a typed clause after it can
        // never run - the program means something other than what it says, and
        // saying so costs less than the puzzle of a handler that never fires.
        const clauses = (n as unknown as { CatchClauses?: readonly ParseNode[] | null }).CatchClauses;
        if (clauses && clauses.length > 1) {
          for (let i = 0; i < clauses.length - 1; i += 1) {
            if (!(clauses[i] as { TypeAnnotation?: unknown }).TypeAnnotation) {
              const completion = Throw.TypeError('an untyped catch clause must be last') as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
          }
        }
        // Then walk on. Breaking here skipped the default case, which is what
        // descends into a node's children - so every declaration and check
        // inside a `try` stopped being visited, and eight tests in a file this
        // rule does not touch went red.
        for (const key of Object.keys(n)) {
          if (key === 'parent' || key === 'location' || key === 'strict' || key === 'sourceText') {
            continue;
          }
          const child = (n as unknown as Record<string, unknown>)[key];
          if (Array.isArray(child) || (child && typeof child === 'object' && 'type' in (child as object))) {
            walk(child as ParseNode);
          }
        }
        break;
      }
      case 'SwitchStatement': {
        // proposal-runtime-types (spec sec-enums, sec-narrowing): a switch over an
        // enumerator must label its cases with enumerators of that enum, and a
        // switch with no default must cover every enumerator. The discriminant is
        // enum-typed when it is a binding tracked as holding an enumerator.
        const coverage = switchEnumCoverage(n);
        if (coverage) {
          // A valid label is `EnumName.Member`. Any other label in an enum
          // switch is not an enumerator of the enum and is a type error.
          for (const { shown } of coverage.invalid) {
            const completion = Throw.TypeError('$1 is not a case of enum $2', Value(shown), Value(coverage.enumName)) as ThrowCompletion;
            errors.push(completion.Value as ObjectValue);
          }
          const hasDefault = n.CaseBlock.DefaultClause !== undefined && n.CaseBlock.DefaultClause !== null;
          if (!hasDefault) {
            const missing = coverage.names.filter((nm) => !coverage.covered.has(nm));
            if (missing.length > 0) {
              const completion = Throw.TypeError('switch over enum $1 is missing $2 and has no default', Value(coverage.enumName), Value(missing.join(', '))) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
          }
        }
        // Walk the discriminant and case bodies as usual.
        walk(n.Expression);
        walk(n.CaseBlock);
        return;
      }
      case 'LexicalBinding':
      case 'VariableDeclaration': {
        if (n.BindingIdentifier) {
          // proposal-runtime-types (spec sec-enums): track a binding that holds an
          // enumerator, from `let e = E.Member` or `let e: E`, so a switch over it
          // can be checked.
          const boundEnum = enumOfAnnotation(n.TypeAnnotation)
            ?? enumOfInitializer(n.Initializer)
            ?? (n.TypedInitializer ? enumOfInitializer(n.TypedInitializer.AssignmentExpression) : null);
          if (boundEnum) {
            frames[frames.length - 1].enumBindings.set(n.BindingIdentifier.name, boundEnum);
          }
          if (n.TypedInitializer) {
            const inferred = staticType(n.TypedInitializer.AssignmentExpression);
            declare(n.BindingIdentifier.name, inferred ? widen(inferred) : null);
            walk(n.TypedInitializer.AssignmentExpression);
            return;
          }
          const declared = n.TypeAnnotation ? resolveType(n.TypeAnnotation.Type) : null;
          // PLAN-default-timing.md phase 1. A binding with a type and NO
          // initializer holds its type's default, and #sec-defaultvalueof makes
          // it a type error where there is none. Deciding that needs
          // `DefaultValueOf` - an evaluator - and needs this text's `meta`
          // declarations processed, so the walk records the question and the
          // pass answers it (check-pass.mts).
          //
          // A ~parameter~ is exempt: "nothing is known about what an application
          // will bind, so a generic's field is checked at its specialization".
          // The evaluation-time site has that exemption and this matches it.
          if (declared && declared.Kind !== 'parameter' && !n.Initializer && !n.TypedInitializer) {
            const written = (n.TypeAnnotation?.Type as { type?: string, TypeName?: { IdentifierReference?: { name?: string } } } | undefined);
            defaultsNeeded.push({
              node: n as ParseNode,
              type: declared as TypeRecord,
              display: displayType(declared as TypeRecord),
              annotationName: written?.type === 'TypeReference' ? written.TypeName?.IdentifierReference?.name : undefined,
            });
          }
          if (n.TypeAnnotation && declared && n.Initializer) {
            const src = staticType(n.Initializer);
            if (src && src.Kind !== 'any' && src.Kind !== 'literal'
                && !conversionHasEffect(declared) && IsAssignable(src, declared)
                && derivationIsStable(n.Initializer)) {
              elidableAnnotations.add(n.TypeAnnotation);
            }
          }
          if (n.Initializer) {
            withProvenance(n.Initializer, () => requireAssignable(staticTypeIn(n.Initializer, declared), declared));
            walk(n.Initializer);
          }
          // A `const` bound to a compile-time numeric constant behaves as if
          // its initializer were written at each use: `const K = 3.14` used in
          // a `float64` position is a `float64` and in a `float32` position a
          // `float32`, which is what the literal `3.14` already does.
          //
          // Nothing about the BINDING changes - no type is inferred, `typeof K`
          // is `'number'`, and `K === 3.14` holds. What changes is which value
          // a USE produces, which is the same question literal propagation
          // answers one site earlier.
          //
          // `let` is excluded: a mutable binding may be reassigned, so its type
          // must be fixed or the reassignment has nothing to check against.
          const isConstDeclaration = (n as ParseNode).type === 'LexicalBinding'
            && (n as unknown as { parent?: { LetOrConst?: string } }).parent?.LetOrConst === 'const';
          if (!n.TypeAnnotation && n.Initializer && isNumericConstantExpression(n.Initializer)) {
            const frame = frames[frames.length - 1];
            (isConstDeclaration ? frame.constLiterals : frame.letConstants)
              .add(n.BindingIdentifier.name);
            if (isConstDeclaration) {
              const literal = staticType(n.Initializer);
              if (literal && literal.Kind === 'literal') {
                frame.constLiteralTypes.set(n.BindingIdentifier.name, literal);
              }
            }
          }
          // A `const` cannot be reassigned, so a call through it reaches the
          // function the checker read a signature from (#sec-check-elision).
          if (isConstDeclaration) {
            frames[frames.length - 1].immutableNames.add(n.BindingIdentifier.name);
          }
          declare(n.BindingIdentifier.name, declared);
          return;
        }
        walk(n.Initializer);
        return;
      }
      case 'CallExpression': {
        // With no context from the position: the diagnostics of the numeric
        // resolution (mixed families, a family with no row, an unfitting
        // literal beside a typed argument) apply at every call site.
        checkNumericCall(n, null);
        const c = n as { CallExpression: ParseNode, Arguments?: readonly ParseNode[] };
        const callee = staticType(c.CallExpression);
        if (callee && callee.Kind === 'function' && Array.isArray(c.Arguments)) {
          let sig: { Parameters: readonly ParameterRecord[] } | null = callee.Signatures.length === 1 ? callee.Signatures[0] : null;
          if (!sig && callee.Signatures.length > 1) {
            // #sec-overload-resolution, statically: rank the declared
            // signatures against the argument types by the SHARED resolver, so
            // the checker selects the row the run time would (F58). An
            // argument whose static type is unknown is ~any~, and the clause
            // says such a resolution is performed at run time, so the whole
            // call is left to the run time rather than guessed at.
            // A LITERAL type never reaches the run time - `7` is a plain
            // Number there - so the static types are erased to what the
            // resolver would see before ranking, and the literal's own fit
            // against the chosen parameter is then the ordinary assignability
            // check below. Without this every literal argument resolved to
            // ~none~ (F58).
            const argTypes = c.Arguments.map((a) => {
              if (a.type === 'AssignmentRestElement') {
                return null;
              }
              const t = staticType(a);
              return t && t.Kind === 'literal' ? t.Base : t;
            });
            if (argTypes.every((t) => t !== null)) {
              // PLAN-rest-parameters.md phase 0: the parameters ARE the records
              // now, so the zip of a Shapes sidecar with a type list is gone.
              const candidates = callee.Signatures.map((s) => ({
                Parameters: s.Parameters,
                Function: Value.undefined as unknown as Value,
                Untyped: (s as unknown as { Untyped?: boolean }).Untyped === true,
                // Carried so the argument check can bind them; the record is
                // rebuilt from a subset of fields and dropped them.
                TypeParameterNames: (s as unknown as { TypeParameterNames?: readonly string[] }).TypeParameterNames,
                // #sec-overloading-on-return-type: "a signature is identified by
                // its return type as well as its parameter types". The signature
                // already carries a Return and this dropped it, so the resolver
                // could not filter on what it was given.
                ReturnType: (s as unknown as { Return?: TypeRecord }).Return,
              }));
              // The contextual type of the call, where its position gives one.
              // The return type does not participate in ranking - it filters
              // what ranking left tied - so this is passed as a third argument
              // and read only there.
              const resolution = resolveOverloadByTypes(
                candidates as never,
                argTypes as TypeRecord[],
                // The contextual type staticTypeIn recorded on this node, where
                // its position gave one. The return type does not participate
                // in ranking - it filters what ranking left tied - so this is
                // read only by that tie-break.
                (n as unknown as { ContextualType?: TypeRecord }).ContextualType,
              );
              if (resolution.Kind === 'none') {
                // "It is a type error if ResolveOverload returns ~none~."
                const completion = Throw.TypeError('no declared signature accepts an argument of type $1', Value(displayType(argTypes[0] as TypeRecord))) as ThrowCompletion;
                errors.push(completion.Value as ObjectValue);
              } else if (resolution.Kind === 'ambiguous') {
                // "and it is a type error if it returns ~ambiguous~."
                const completion = Throw.TypeError('the call is ambiguous between two declared signatures') as ThrowCompletion;
                errors.push(completion.Value as ObjectValue);
              } else if (resolution.Kind === 'resolved') {
                const index = candidates.indexOf(resolution.Signature as never);
                sig = index >= 0 ? callee.Signatures[index] : null;
              }
            }
          }
          if (sig) {
            const chosen = sig;
            c.Arguments.forEach((arg, i) => {
              if (i >= chosen.Parameters.length || arg.type === 'AssignmentRestElement') {
                return;
              }
              let param = chosen.Parameters[i]?.Type;
              // #sec-generic-functions: a call that supplies type arguments
              // binds them for the whole signature, parameters included. With
              // the return substituted but not the parameters, `first.<uint32>([1])`
              // checked its argument against `[].<T>` - the unbound parameter -
              // and refused a correct program.
              const generic = (chosen as { TypeParameterNames?: readonly string[] }).TypeParameterNames;
              if (param && generic && generic.length > 0) {
                const spec = c.CallExpression as unknown as {
                  type?: string, TypeArguments?: { TypeArgumentList?: readonly ParseNode[] },
                } | undefined;
                const argNodes = spec?.type === 'TypeArgumentsExpression' ? spec.TypeArguments?.TypeArgumentList : undefined;
                if (argNodes && argNodes.length > 0) {
                  const bindings = new Map<string, TypeRecord>();
                  generic.forEach((tpName, k) => {
                    const bound = argNodes[k] ? resolveType(argNodes[k] as ParseNode.Type) : null;
                    if (tpName && bound) {
                      bindings.set(tpName, bound);
                    }
                  });
                  if (bindings.size > 0) {
                    param = substituteTypeParameters(param, bindings) as TypeRecord;
                  }
                }
              }
              // A FUNCTION LITERAL in a position whose type is a function type
              // takes that type's parameters as its own, which is how a
              // callback learns the element type (F80). Recorded here and read
              // when the walk reaches the literal.
              if (param && param.Kind === 'function' && param.Signatures.length === 1
                  && (arg.type === 'ArrowFunction' || arg.type === 'FunctionExpression')) {
                contextualParameterTypes.set(arg, param.Signatures[0].Parameters.map((pr) => pr.Type) as readonly Known[]);
                // `map`'s result element type is the CALLBACK'S RETURN, which
                // is why it could not be claimed before the callback was typed
                // (F79 left it ~any~ deliberately). It is readable for a
                // concise-bodied arrow, whose body IS the returned expression,
                // with the callback's parameters in scope. A block-bodied
                // callback needs return-type inference the checker does not
                // have, and stays ~any~ - imprecise rather than wrong (F80).
                if (arg.type === 'ArrowFunction') {
                  const arrow = arg as unknown as { ConciseBody?: ParseNode, ArrowParameters?: readonly ParseNode[] };
                  const body = arrow.ConciseBody;
                  if (body && body.type !== 'FunctionBody') {
                    pushBlock(() => {
                      param.Signatures[0].Parameters.forEach((pr, pi) => {
                        const pt = pr.Type;
                        const p = arrow.ArrowParameters?.[pi];
                        if (pt && p && p.type === 'SingleNameBinding' && (p as ParseNode.SingleNameBinding).BindingIdentifier) {
                          declare((p as ParseNode.SingleNameBinding).BindingIdentifier!.name, pt);
                        }
                      });
                      const returned = staticType(body);
                      if (returned) {
                        callbackReturnTypes.set(c as unknown as ParseNode, returned);
                      }
                    });
                  }
                }
                // FALL THROUGH to the check rather than returning. The branch
                // above exists to give a callback its parameter types, which is
                // what lets `a.map((x) => x + 1)` type `x` without an
                // annotation - and it returned, so the argument was never
                // checked against the parameter at all. Recording the
                // contextual types is a prerequisite of the check, not a
                // substitute for it: the literal's own type is built FROM them.
              }
              if (mentionsTypeParameter(param)) {
                // Unbound: nothing to check against until a binding exists.
                return;
              }
              requireAssignable(staticTypeIn(arg, param), param);
            });
          }
        }
        walk(c.CallExpression);
        walk(c.Arguments);
        return;
      }
      case 'NewExpression': {
        const ne = n as unknown as { MemberExpression?: ParseNode, Arguments?: readonly ParseNode[] | null };
        const target = ne.MemberExpression;
        if (target && target.type === 'IdentifierReference' && Array.isArray(ne.Arguments)) {
          const instance = classTypeOf((target as { name: string }).name);
          const decl = instance && instance.Kind === 'nominal'
            ? (instance as unknown as { Declaration: ParseNode }).Declaration
            : null;
          const sig = decl ? constructSignatures.get(decl) : undefined;
          if (sig) {
            ne.Arguments.forEach((arg, i) => {
              if (i < sig.Parameters.length && arg.type !== 'AssignmentRestElement') {
                const p = sig.Parameters[i]?.Type;
                if (p) {
                  requireAssignable(staticTypeIn(arg, p), p);
                }
              }
            });
          }
        }
        walk(ne.MemberExpression);
        walk(ne.Arguments);
        return;
      }
      case 'LogicalANDExpression':
      case 'LogicalORExpression': {
        // The RIGHT operand is evaluated only where the left decided a way, so
        // it sees the binding narrowed - `x !== null && x.f` is the idiom this
        // exists for (F77). A disjunction narrows by the complement, since its
        // right operand runs where the left was false.
        const lg = n as unknown as { LogicalANDExpression?: ParseNode, LogicalORExpression?: ParseNode, BitwiseORExpression?: ParseNode, LogicalANDExpression_b?: ParseNode };
        const isAnd = n.type === 'LogicalANDExpression';
        const left = (isAnd ? lg.LogicalANDExpression : lg.LogicalORExpression) as ParseNode;
        const right = (isAnd
          ? lg.BitwiseORExpression
          : (n as unknown as { LogicalANDExpression: ParseNode }).LogicalANDExpression) as ParseNode;
        walkGuarded(left, isAnd ? right : null, isAnd ? null : right);
        return;
      }
      case 'ConditionalExpression': {
        // `t ? a : b` guards its two arms exactly as an `if` guards two
        // statements, so the same fact applies (F76).
        const c = n as unknown as { ShortCircuitExpression: ParseNode, AssignmentExpression_a: ParseNode, AssignmentExpression_b: ParseNode };
        walkGuarded(c.ShortCircuitExpression, c.AssignmentExpression_a, c.AssignmentExpression_b);
        return;
      }
      case 'WhileStatement': {
        // A `while` test guards its body on every iteration.
        const w = n as unknown as { Expression: ParseNode, Statement: ParseNode };
        walkGuarded(w.Expression, w.Statement, null);
        return;
      }
      case 'IfStatement': {
        // PHASE 4 of the checker plan: a test refines a binding's type in the
        // branch it guards. Without this the checker rejected the very idiom
        // the `is` operator exists for - `if (x is uint8) { let y: uint8 = x; }`
        // was a type error, because `x` kept its union type inside the branch
        // (F75). The narrowing operations themselves already existed; nothing
        // consulted them for a BINDING.
        const s = n as unknown as { Expression: ParseNode, Statement_a: ParseNode, Statement_b?: ParseNode | null };
        walkGuarded(s.Expression, s.Statement_a, s.Statement_b ?? null);
        return;
      }
      case 'UpdateExpression': {
        // proposal-runtime-types #sec-location-consuming-contexts: `++`/`--`
        // over a call consumes a LOCATION, so the callee must return one. The
        // parser admits the form and marks the call; the type is what decides
        // whether it means anything, and a callee whose return type is known
        // and is not a `ref` type is refused before the source runs. Where the
        // return type is not known the check is the runtime one, per the
        // deferral rule of #sec-type-errors - imprecise rather than wrong.
        const u = n as unknown as { LeftHandSideExpression?: ParseNode | null, UnaryExpression?: ParseNode | null };
        const operand = u.LeftHandSideExpression ?? u.UnaryExpression;
        // `v.x++` and `++v.x` read and then write, so a readonly member refuses
        // them for the same reason it refuses an assignment.
        requireWritableMember(operand);
        if (operand && operand.type === 'CallExpression'
            && (operand as { LocationConsuming?: boolean }).LocationConsuming === true) {
          const produced = staticType(operand);
          if (produced && produced.Kind !== 'reference') {
            const completion = Throw.TypeError(
              'a call in a ++ or -- operand must return a ref, and $1 does not',
              Value(displayType(produced)),
            ) as ThrowCompletion;
            errors.push(completion.Value as ObjectValue);
          }
        }
        walk(operand);
        return;
      }
      case 'AssignmentExpression': {
        const a = n as unknown as { LeftHandSideExpression: ParseNode, AssignmentExpression: ParseNode, AssignmentOperator: string };
        // Every assignment operator writes, so this sits outside the `=` guards
        // below: `v.x += 1` and `v.x ??= 1` are writes as much as `v.x = 1`.
        requireWritableMember(a.LeftHandSideExpression);
        // proposal-runtime-types #sec-location-consuming-contexts: an
        // assignment whose target is a call stores through the location the
        // call returned, so the callee must return one. This is the `++`/`--`
        // rule below applied to the target: known and not a `ref` type is
        // refused before the source runs, unknown defers to the store.
        if (a.LeftHandSideExpression.type === 'CallExpression'
            && (a.LeftHandSideExpression as { LocationConsuming?: boolean }).LocationConsuming === true) {
          const produced = staticType(a.LeftHandSideExpression);
          if (produced && produced.Kind !== 'reference') {
            const completion = Throw.TypeError(
              'a call assigned to must return a ref, and $1 does not',
              Value(displayType(produced)),
            ) as ThrowCompletion;
            errors.push(completion.Value as ObjectValue);
          }
        }
        if (a.AssignmentOperator === '=' && a.LeftHandSideExpression.type === 'IdentifierReference') {
          // Checked against the DECLARED type, not the narrowed one: a binding
          // of `uint8 | string` may be assigned a string inside a branch that
          // narrowed it to `uint8`, and doing so ENDS the narrowing rather than
          // being an error (F78).
          const name = (a.LeftHandSideExpression as { name: string }).name;
          const target = lookupDeclared(name);
          requireAssignable(staticTypeIn(a.AssignmentExpression, target), target);
          invalidateNarrowing(name);
        } else if (a.AssignmentOperator === '=' && a.LeftHandSideExpression.type === 'MemberExpression') {
          // #table-check-sites rows 4 and 5, statically: a store whose target
          // has a known typed property or element type is the same shape as a
          // store to an annotated binding, so it is an Early Error where the
          // static types settle it and the run-time check remains the backstop
          // for the ~any~ path (F56). A class instance has no structural type
          // here, so `c.x = 300` for a class-typed `c` still waits on the
          // checker learning class field types.
          const m = a.LeftHandSideExpression as unknown as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null, Expression?: ParseNode | null };
          const objType = m.MemberExpression ? structureOf(staticType(m.MemberExpression)) : null;
          let target: Known = null;
          if (objType && objType.Kind === 'object' && m.IdentifierName) {
            const prop = objType.Properties.find((p) => p.key === (m.IdentifierName as { name: string }).name);
            // A store satisfies the property's WRITE type where one is declared
            // separately, which is what a setter's parameter gives (F61).
            target = prop ? ((prop as { writeType?: TypeRecord }).writeType ?? prop.type) : null;
          } else if (objType && objType.Kind === 'object' && m.Expression) {
            // A SYMBOL-keyed store, `m[k] = v`. The computed expression names a
            // symbol `const`, so it resolves to the same minted key the
            // declaration was recorded under - which is the whole point of
            // minting per declaration rather than per mention.
            const computed = m.Expression as { type?: string, name?: string };
            const declaration = computed.type === 'IdentifierReference' && typeof computed.name === 'string'
              ? symbolConsts.get(computed.name)
              : undefined;
            if (declaration) {
              const symbolKey = symbolKeyFor(declaration) as unknown as string;
              const prop = objType.Properties.find((p) => p.key === symbolKey);
              target = prop ? ((prop as { writeType?: TypeRecord }).writeType ?? prop.type) : null;
            }
          } else if (objType && objType.Kind === 'array' && m.Expression) {
            target = objType.Element;
          }
          if (target) {
            requireAssignable(staticTypeIn(a.AssignmentExpression, target), target);
          }
        }
        walk(a.LeftHandSideExpression);
        walk(a.AssignmentExpression);
        return;
      }
      case 'ReturnStatement': {
        const expr = (n as { Expression?: ParseNode | null }).Expression;
        const context = returnTypes[returnTypes.length - 1] ?? null;
        if (expr) {
          requireAssignable(staticTypeIn(expr, context), context);
          // The elision condition, per return. A `return` with NO expression
          // hands back *undefined*, which is the same unproven case as falling
          // off the end and is handled below.
          if (returnsProven.length > 0 && context) {
            const source = staticTypeIn(expr, context);
            if (!(source && source.Kind !== 'any' && source.Kind !== 'literal' && IsAssignable(source, context)
                  && derivationIsStable(expr))) {
              returnsProven[returnsProven.length - 1] = false;
            }
          }
          walk(expr);
        } else if (returnsProven.length > 0 && context) {
          returnsProven[returnsProven.length - 1] = false;
        }
        return;
      }
      case 'FieldDefinition': {
        if (n.Initializer && n.TypeAnnotation) {
          const declared = resolveType(n.TypeAnnotation.Type);
          requireAssignable(staticTypeIn(n.Initializer, declared), declared);
        }
        walk(n.Initializer);
        return;
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression': {
        // PLAN-declarative-checker-facts.md phase 1: the adopted `this` is in
        // scope for exactly this literal's body. Pushed here rather than inside
        // `enterFunction` because only a literal that MET a contextual type has
        // one, and a declaration never does.
        // PLAN-declarative-checker-facts.md phase 1b: where the adopted type is
        // the SELF MARKER and the owner of the signature is known, `this` is
        // the owner - which is what the marker stands for. Where no owner was
        // recorded the marker is pushed unchanged, which types `this` without
        // members, as before.
        const adopted = contextualThisTypes.get(n);
        const owner = contextualThisOwners.get(n);
        const resolved = adopted
          && owner
          && (adopted as { Declaration?: { type?: string } }).Declaration?.type === 'SelfThisMarker'
          ? owner
          : adopted;
        if (resolved) {
          thisTypeFrames.push(resolved);
        }
        // #sec-generic-functions: "a name a generic declaration BINDS denotes
        // that type parameter for the whole of the declaration - its parameter
        // annotations, its return annotation, AND ITS BODY". The signature's
        // scope is pushed and popped where the signature is built, so without
        // this the body was walked with no type parameter in scope: `T` there
        // resolved to nothing, and `let v: T = 5` inside `function f<T>` was
        // accepted because there was no constraint to violate.
        //
        // `FINDING-generic-body-unchecked.md`. What the parameter record then
        // gives is the relation `relations.mts` already states - a parameter is
        // opaque, a subtype of itself and of its constraint, and NOTHING ELSE
        // relates to it - so assigning any concrete value into a `T` is refused,
        // which is right: `T` may be instantiated with a literal type, so not
        // even a String is known to be a `T: string`.
        let bodyTypeParams = false;
        try {
          // PUBLISHED FIRST, and deliberately outside the scope below. A
          // published signature is what the CALL BOUNDARY reads, and a parameter
          // annotation resolved to an opaque `T` there would refuse `id(5)`
          // against a bare `T` - which `#sec-inference-and-function-forms` says
          // must not happen, since the boundary sees one function for every
          // instantiation. The scope is for the BODY only.
          publishLiteralReturn(n as ParseNode, (n.FormalParameters ?? []).map((prm) => {
            const ann = (prm as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
            return ann ? resolveType(ann.Type) : null;
          }));
          bodyTypeParams = pushTypeParameterScopeOf(n as ParseNode);
          try {
            enterFunction(n.FormalParameters, n.TypeAnnotation ?? null, n.FunctionBody, true);
          } finally {
            if (bodyTypeParams) {
              typeParameterScopes.pop();
            }
          }
        } finally {
          if (adopted) {
            thisTypeFrames.pop();
          }
        }
        return;
      }
      case 'ArrowFunction':
        publishLiteralReturn(n as ParseNode, (n.ArrowParameters ?? []).map((prm) => {
          const ann = (prm as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
          return ann ? resolveType(ann.Type) : null;
        }));
        enterFunction(n.ArrowParameters, n.TypeAnnotation ?? null, n.ConciseBody as never, true, contextualParameterTypes.get(n));
        return;
      case 'MethodDefinition':
        enterFunction(n.UniqueFormalParameters, n.TypeAnnotation ?? null, n.FunctionBody, true);
        return;
      case 'ClassDeclaration':
      case 'ClassExpression': {
        // PLAN-nominal-records.md v2 task A. A class DECLARATION is registered
        // by name in `classNodes` and forced with the others, which is what
        // publishes its instance type for the runtime record to read. A class
        // EXPRESSION is registered nowhere, so `classInstanceType` never ran for
        // one, `publishedClassTypes` never gained an entry, and the runtime
        // record built at ClassExpression and NamedEvaluation carried neither
        // [[Base]] nor [[Structure]] - `Reflect.isAssignable(type CE, type
        // Base)` was *false* for a class expression extending Base.
        //
        // Collected by NODE rather than by name: an anonymous class expression
        // has no name to key on, and the memo and the published map are both
        // node-keyed already, so the node is the key that exists everywhere it
        // is needed.
        if (n.type === 'ClassExpression') {
          classExpressionNodes.add(n);
        }
        // The class's own name is in context for its whole body, so a method
        // reading a protected member is INSIDE and a program outside is not.
        const named = (n as { BindingIdentifier?: { name?: string } | null }).BindingIdentifier?.name;
        classContext.push(named ?? '');
        for (const el of (n as { ClassTail?: { ClassBody?: readonly ParseNode[] | null } | null }).ClassTail?.ClassBody ?? []) {
          walk(el);
        }
        classContext.pop();
        // PLAN-abstract-implementation.md, the checking-pass migration.
        // #sec-abstract-classes: "a type error if a class not declared
        // `abstract` leaves an inherited abstract method unimplemented".
        //
        // Reported HERE rather than only at class definition evaluation, because
        // #sec-type-errors makes a determinable type error an Early Error - "a
        // source text that contains one is rejected rather than evaluated". The
        // evaluation-time check stays as the backstop for what the pass does not
        // cover, which is the same division the neighbouring rule uses: `new C()`
        // on an abstract class is BOTH a static type error and a [[Construct]]
        // refusal.
        //
        // The chain is walked through the base's DECLARATION, since that is what
        // the abstract members are published by, and it stops at the first
        // implementation: a class that declares the member concretely satisfies
        // it for everything below.
        // The modifiers live on the CLASS node, which the evaluator reaches as
        // `ClassTail.parent.ClassModifiers`; here the node IS the class.
        const classModifiers = (n as { ClassModifiers?: readonly string[] | null }).ClassModifiers ?? [];
        // PLAN-abstract-implementation.md, the checking-pass migration, rule 1.
        // #sec-abstract-classes: an abstract method's "annotation types the
        // implementations: it is a type error if a subclass implements an
        // inherited abstract method with a signature the abstract declaration
        // does not accept". Reported HERE for the same reason as rule 2 -
        // #sec-type-errors makes a determinable type error an Early Error - with
        // the evaluation-time check kept as the backstop.
        //
        // The SUBTYPE relation, which is what interface satisfaction already
        // uses for the same question. It runs whether or not the class is
        // `abstract`: an abstract subclass that overrides a member wrongly is
        // wrong at its own declaration, not at the first concrete class below it.
        {
          const ownTypes = new Map<string, TypeRecord | null>();
          for (const el of (n as { ClassTail?: { ClassBody?: readonly ParseNode[] | null } | null }).ClassTail?.ClassBody ?? []) {
            if (el.type !== 'MethodDefinition') {
              continue;
            }
            const md = el as unknown as {
              ClassElementName?: { name?: string, value?: string } | null,
              TypeAnnotation?: ParseNode.TypeAnnotation | null,
              static?: boolean,
            };
            const k = md.ClassElementName?.name ?? md.ClassElementName?.value;
            if (typeof k === 'string' && !md.static) {
              ownTypes.set(k, md.TypeAnnotation ? resolveType(md.TypeAnnotation.Type) : null);
            }
          }
          // The NEAREST declaration for a key governs, which is why the chain is
          // collected before anything is compared rather than compared as it is
          // walked. A class may RE-DECLARE an inherited abstract member -
          // `abstract class B extends A { m(): uint8; }` over an `A` declaring
          // `m(): number` - and an implementation below B keeps B's contract,
          // not A's. Comparing against every ancestor blamed the implementation
          // for a mismatch its base introduced: `C` was named for a narrowing
          // `B` wrote.
          //
          // Whether B's own re-declaration is legal against A is a separate
          // question this does not answer - abstract-against-abstract is not
          // compared. Recorded rather than guessed at, since the clause speaks
          // of a subclass that IMPLEMENTS.
          const governing = new Map<string, TypeRecord | null>();
          let ancestor = (PublishedClassTypeOf(n as unknown as object) as unknown as { Base?: { Declaration?: object } } | undefined)?.Base;
          const walked = new Set<object>();
          while (ancestor?.Declaration && !walked.has(ancestor.Declaration)) {
            walked.add(ancestor.Declaration);
            for (const [key, declaredType] of PublishedAbstractMembersOf(ancestor.Declaration) ?? []) {
              if (!governing.has(key)) {
                governing.set(key, declaredType);
              }
            }
            ancestor = (ancestor as { Base?: { Declaration?: object } }).Base;
          }
          {
            for (const [key, declaredType] of governing) {
              const mine = ownTypes.get(key);
              if (mine === undefined || mine === null || declaredType === null || declaredType === undefined) {
                continue;
              }
              if (!IsSubtype(mine, declaredType, [])) {
                errors.push(Throw.TypeError(
                  '$1 implements an inherited $2 with a signature the declaration does not accept',
                  Value(named ?? 'the class'),
                  Value(key),
                ).Value as ObjectValue);
                return;
              }
            }
          }
        }
        if (!classModifiers.includes('abstract')) {
          const own = new Set<string>();
          for (const el of (n as { ClassTail?: { ClassBody?: readonly ParseNode[] | null } | null }).ClassTail?.ClassBody ?? []) {
            const nm = (el as { ClassElementName?: { name?: string, value?: string } | null }).ClassElementName;
            const k = nm?.name ?? nm?.value;
            if (typeof k === 'string' && el.type !== 'AbstractMethodDefinition') {
              own.add(k);
            }
          }
          let base = (PublishedClassTypeOf(n as unknown as object) as unknown as { Base?: { Declaration?: object } } | undefined)?.Base;
          const seen = new Set<object>();
          while (base?.Declaration && !seen.has(base.Declaration)) {
            seen.add(base.Declaration);
            // A class BETWEEN this one and the declaration may implement it -
            // `abstract class K extends G { m() { … } }` satisfies `G`'s member
            // for everything below K - so each level's concrete members join the
            // set before that level's abstract ones are asked about.
            for (const el of (base.Declaration as { ClassTail?: { ClassBody?: readonly ParseNode[] | null } | null }).ClassTail?.ClassBody ?? []) {
              const bn = (el as { ClassElementName?: { name?: string, value?: string } | null }).ClassElementName;
              const bk = bn?.name ?? bn?.value;
              if (typeof bk === 'string' && el.type !== 'AbstractMethodDefinition') {
                own.add(bk);
              }
            }
            for (const [key] of PublishedAbstractMembersOf(base.Declaration) ?? []) {
              if (!own.has(key)) {
                errors.push(Throw.TypeError(
                  '$1 inherits $2 with no body and does not implement it; declare it, or declare the class abstract',
                  Value(named ?? 'the class'),
                  Value(key),
                ).Value as ObjectValue);
                return;
              }
            }
            base = (base as { Base?: { Declaration?: object } }).Base;
          }
        }
        return;
      }
      case 'MemberExpression': {
        checkProtectedAccess(n);
        // AND WALK THE BASE. `break` leaves the switch, and the generic child
        // recursion lives in `default:` - so a member expression's own subtree
        // was never descended into, and anything a walk RECORDS about it was
        // never recorded.
        //
        // That is what made `(9223372036854775807 := int64).toString()` answer
        // -9223372036854775808 while `String((9223372036854775807 := int64))`
        // answered the value exactly: a wide literal's exact digits are stored
        // by the walk of its enclosing conversion (#sec-literalvalueintype
        // takes the value "before any rounding", and the source text is where
        // it still exists), and evaluation reads them back. A conversion under
        // a member base was never walked, so the literal evaluated from the
        // double the lexer scanned - and for a 60-digit literal that produced
        // '0', which no rounding of the true value gives.
        for (const key of Object.keys(n)) {
          if (key === 'parent' || key === 'location' || key === 'strict' || key === 'sourceText') {
            continue;
          }
          const child = (n as unknown as Record<string, unknown>)[key];
          if (Array.isArray(child) || (child && typeof child === 'object' && 'type' in (child as object))) {
            walk(child as ParseNode);
          }
        }
        break;
      }
      case 'GeneratorDeclaration':
      case 'GeneratorExpression':
      case 'AsyncFunctionDeclaration':
      case 'AsyncFunctionExpression':
      case 'AsyncGeneratorDeclaration':
      case 'AsyncGeneratorExpression':
      case 'AsyncArrowFunction':
      case 'GeneratorMethod':
      case 'AsyncMethod':
      case 'AsyncGeneratorMethod':
        // Return annotations of the ASYNC forms describe the promise a call
        // produces, and that judgment still arrives later. A GENERATOR's
        // annotation is read now (#sec-generator-types): it does not become the
        // frame's return type, since a `return` inside sets the generator's R,
        // but it is carried so that a `yield` can read the N it declares.
        {
          const gen = n.type === 'GeneratorDeclaration' || n.type === 'GeneratorExpression' || n.type === 'GeneratorMethod'
            || n.type === 'AsyncGeneratorDeclaration' || n.type === 'AsyncGeneratorExpression' || n.type === 'AsyncGeneratorMethod';
          const isAsyncGen = n.type === 'AsyncGeneratorDeclaration' || n.type === 'AsyncGeneratorExpression' || n.type === 'AsyncGeneratorMethod';
          const ann = (n as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
          const declared = gen ? generatorDeclaredType(ann ? resolveType(ann.Type) : null, isAsyncGen) : null;
          enterFunction((n as { FormalParameters?: readonly ParseNode[] }).FormalParameters ?? (n as { UniqueFormalParameters?: readonly ParseNode[] }).UniqueFormalParameters ?? (n as { ArrowParameters?: readonly ParseNode[] }).ArrowParameters, null, (n as { FunctionBody?: ParseNode }).FunctionBody ?? (n as { GeneratorBody?: ParseNode }).GeneratorBody ?? (n as { AsyncFunctionBody?: ParseNode }).AsyncFunctionBody ?? (n as { AsyncGeneratorBody?: ParseNode }).AsyncGeneratorBody ?? (n as { AsyncConciseBody?: ParseNode }).AsyncConciseBody, false, undefined, declared);
        }
        return;
      default: {
        for (const key of Object.keys(n)) {
          if (key === 'parent' || key === 'location' || key === 'strict' || key === 'sourceText') {
            continue;
          }
          const child = (n as unknown as Record<string, unknown>)[key];
          if (Array.isArray(child) || (child && typeof child === 'object' && 'type' in (child as object))) {
            walk(child as ParseNode);
          }
        }
      }
    }
  };

  collectMutations(statementList);
  walk(statementList);
  deferredMetadataChecks.set(root, deferred);
  // A3.1: the SECOND walk re-derives the same requests, and its resolutions
  // already exist keyed by node - so it must not replace the list the sweep was
  // built from, which is also what keeps a third walk from ever looking needed.
  if (!narrowingResolutions.has(root)) {
    boundsProvenAccesses.set(root, provenHere);
  lastBoundsProvenCount = provenHere.size;
  narrowingRequests.set(root, narrowingRequestsHere);
  }
  unclaimedKeyChecks.set(root, unclaimed);
  defaultRequirements.set(root, defaultsNeeded);
  blockScopedMetaNames.set(root, nestedMetaNames);
  return errors;
}
