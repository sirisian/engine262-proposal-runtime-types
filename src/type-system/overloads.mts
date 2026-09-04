// Function overload resolution.
//
// A name declared by more than one function signature resolves, at each call, to
// the one signature whose parameter list best fits the argument values. This file
// holds the resolution itself: a description of one signature's parameters and
// arity, the viability filter that discards signatures an argument list cannot
// satisfy, and the ranking that chooses among the viable ones. See the spec's
// overload-resolution and literal-overload-ranking clauses.

import type { ParseNode } from '../parser/ParseNode.mts';
import type { Value } from '../value.mts';
import type { ParameterRecord, TypeRecord } from './records.mts';
import { anyType, restElementType } from './records.mts';
import { SequenceAssignment, slotReceiving } from './sequence-assignment.mts';
import { ClassImplements, IsAssignable } from './relations.mts';
import { RuntimeTypeOf } from './runtime.mts';

/**
 * One parameter of a signature, as overload resolution reads it.
 *
 * This was a second parameter model, carrying
 * Type/Optional/Rest/HasDefault where the type system's SignatureRecord carried
 * bare types. It is now the one model. HasDefault is gone: a defaulted parameter
 * IS an optional one by #sec-signature-records, and keeping the two apart is
 * what let a signature be optional in one file and defaulted in another.
 */
export type OverloadParameter = ParameterRecord;

/**
 * A signature as a candidate for resolution: its parameters and the concrete
 * function that implements it. The function is what a winning signature calls.
 */
export interface OverloadSignature {
  readonly Parameters: readonly OverloadParameter[];
  readonly Function: Value;
  /**
   * proposal-runtime-types #sec-overloading-on-return-type: "a signature is
   * identified by its return type as well as its parameter types". The return
   * type does NOT participate in ranking - it participates in filtering, after
   * ranking - so it is carried here and read only by the tie-break below.
   */
  readonly ReturnType?: TypeRecord;
  /**
   * #sec-overload-resolution: a signature with no annotation anywhere is a
   * CATCH-ALL. It ranks last and, being untyped, is viable for any argument
   * list - the clause's own example is that with `function f() {}` beside
   * `function f(a: uint8) {}`, `f(1)` takes the typed row on rank while
   * `f(1, 2)` takes the untyped one, "since the typed signature's arity does
   * not accept two arguments and it is not viable". Neither the run time nor
   * the checker implemented that: both answered "no overload matches" for the
   * two-argument call. Declaring a return type is what makes a
   * zero-parameter function typed.
   */
  readonly Untyped?: boolean;
}

/**
 * The parameters of a concrete function declaration, described for resolution.
 * Reads the same FormalParameters the parameter-enforcement pass reads: a
 * SingleNameBinding contributes its annotation (or `any`), its `Optional` flag,
 * and whether it has an Initializer (a default); a BindingRestElement contributes
 * a rest parameter. The type of a rest parameter is the array element type it
 * declares, but resolution only needs its position and that it absorbs the tail,
 * so the element type is not required here.
 */
/** A parameter's declared name, for the records the type system now carries. */
function parameterName(p: ParseNode): string {
  const seek = (n: unknown): string => {
    const node = n as { type?: string, name?: string, BindingIdentifier?: unknown, BindingElement?: unknown };
    if (!node || typeof node !== 'object') {
      return '';
    }
    if (node.type === 'BindingIdentifier' && typeof node.name === 'string') {
      return node.name;
    }
    return seek(node.BindingIdentifier) || seek(node.BindingElement) || '';
  };
  return seek(p);
}

export function describeParameters(
  formals: readonly ParseNode[],
  typeOf: (annotation: ParseNode.TypeAnnotation) => TypeRecord,
): OverloadParameter[] {
  const params: OverloadParameter[] = [];
  for (const p of formals) {
    const node = p as {
      type?: string,
      TypeAnnotation?: ParseNode.TypeAnnotation | null,
      Optional?: boolean,
      Initializer?: unknown,
      BindingElement?: { Initializer?: unknown },
    };
    const name = parameterName(p);
    if (node.type === 'BindingRestElement') {
      // The rest's own annotation is read elsewhere; resolution needs its
      // position and that it absorbs a run, which is what Rest says.
      params.push({
        Name: name, Type: node.TypeAnnotation ? typeOf(node.TypeAnnotation) : anyType, Optional: false, Rest: true,
      });
      continue;
    }
    const annotation = node.TypeAnnotation;
    const type = annotation ? typeOf(annotation) : anyType;
    const hasDefault = node.Initializer !== undefined && node.Initializer !== null;
    params.push({
      Name: name, Type: type, Optional: node.Optional === true || hasDefault, Rest: false,
    });
  }
  return params;
}

/**
 * The least number of arguments a signature accepts: its parameters up to the
 * first that is optional, defaulted, or rest. This is the signature's contribution
 * to the overloaded function's `length`.
 */
export function minimumArity(params: readonly OverloadParameter[]): number {
  let n = 0;
  for (const p of params) {
    if (p.Optional || p.Rest) {
      break;
    }
    n += 1;
  }
  return n;
}

/**
 * Assign a call's argument types to a signature's parameters, or null where no
 * assignment admits them all.
 *
 * Per #sec-bindarguments. Viability WAS an
 * arity count: at least the minimum, and no more than the parameter count
 * unless the LAST parameter was a rest. That is the single-trailing-rest rule,
 * and it answers wrongly for every list this feature admits - a rest in the
 * middle made the count an upper bound again, and a second rest was invisible.
 *
 * The assignment is the answer to both questions at once: whether the list can
 * be satisfied, and which parameter receives each argument. A list with at most
 * one rest, which is every signature written before this feature, takes the
 * direct path and never reaches the matcher.
 */
/**
 * Exported for the CALL CHECK, which asks the same question this file's
 * overload ranking does: which parameter receives each argument, for a signature
 * whose rests may be non-final or several.
 *
 * One assignment operation, not two. A checker that mapped arguments its own way
 * would be a second thing to disagree with the run time - and the run time's own
 * path calls `SequenceAssignment`, which this wraps.
 */
export function assignArguments(params: readonly OverloadParameter[], argTypes: readonly TypeRecord[]): number[] | null {
  const restCount = params.filter((p) => p.Rest).length;
  if (restCount <= 1) {
    // The familiar rule, stated as an assignment so that both callers read the
    // same shape: fixed parameters take one each, the rest takes what is left
    // after the parameters that follow it are satisfied.
    if (argTypes.length < minimumArity(params)) {
      return null;
    }
    const restIndex = params.findIndex((p) => p.Rest);
    if (restIndex === -1) {
      if (argTypes.length > params.length) {
        return null;
      }
      return params.map((_p, i) => (i < argTypes.length ? 1 : 0));
    }
    const after = params.length - restIndex - 1;
    const taken = argTypes.length - restIndex - after;
    if (taken < 0) {
      return null;
    }
    return params.map((_p, i) => {
      if (i < restIndex) {
        return 1;
      }
      if (i === restIndex) {
        return taken;
      }
      return 1;
    });
  }
  const slots = params.map((p) => ({ Rest: p.Rest, Optional: p.Optional }));
  const counts = SequenceAssignment(slots, argTypes.length, (i, k) => {
    const p = params[k];
    return argumentTier(argTypes[i], p.Rest ? restElementType(p.Type) : p.Type) !== null;
  });
  return counts === 'unmatched' ? null : counts;
}

/** The match tier of one argument against one parameter, or null if it does not fit. */
const enum Tier {
  // Lower is better. The argument's type is exactly the parameter's type.
  Exact = 0,
  // #table-argument-match-ranks rank 2: the argument satisfies a ~nominal~
  // parameter type STRUCTURALLY, being neither that type nor a refinement of
  // it. An interface and a structurally identical alias are mutually assignable,
  // so both scored Exact and every call between them was ambiguous; this is the
  // rank that separates "has the shape exactly" from "has the members an
  // interface asks for".
  StructuralNominal = 1,
  // An untyped literal argument taking the parameter's type (literal-overload-ranking).
  Literal = 2,
  // The argument is assignable to the parameter by an ordinary widening.
  Assignable = 3,
  // #sec-overload-resolution: the parameter is a TYPE PARAMETER of a generic
  // member, which binds from the argument at the call. Viable, and below every
  // concrete match: "a concrete position beats a type parameter". The
  // instantiate-then-rank rule with specificity as the tie-break belongs with
  // the inference plumbing; this tier orders concrete over generic without
  // running inference in the ranking.
  Generic = 4,
  // The parameter is the `any` type: an untyped catch-all that accepts anything.
  CatchAll = 5,
}

/**
 * Whether a type is one of the numeric value types an untyped number can take:
 * the sized integer and float families, and the general `number`. A plain number
 * argument is not a subtype of `uint8` structurally, but a single typed parameter
 * coerces it, so for resolution it is viable for any of these, taking the
 * parameter's type as an untyped literal does.
 */
function isNumericValueType(t: TypeRecord): boolean {
  if (t.Kind !== 'primitive') {
    return false;
  }
  const n = t.Name;
  return n === 'number' || n === 'int' || n === 'uint' || n === 'rational' || n === 'complex'
    || n === 'float16' || n === 'float32' || n === 'float64' || n === 'float128'
    || n === 'decimal32' || n === 'decimal64' || n === 'decimal128';
}

/**
 * Whether a literal argument's VALUE fits a numeric value type: the integer
 * families check their range, and every other numeric family is representable
 * enough for a DISTRIBUTION - the binding's conversion is the exact judgment,
 * and it runs after. A non-numeric literal value answers false.
 */
function literalValueFitsNumeric(argType: TypeRecord, paramType: TypeRecord): boolean {
  if (paramType.Kind !== 'primitive') {
    return false;
  }
  const v = (argType as { Value?: unknown }).Value as { numberValue?(): number, bigintValue?(): bigint } | undefined;
  let n: number | bigint | null = null;
  if (v && typeof v.numberValue === 'function') {
    n = v.numberValue();
  } else if (v && typeof v.bigintValue === 'function') {
    n = v.bigintValue();
  }
  if (n === null) {
    return false;
  }
  const bits = (paramType as { Bits?: number }).Bits;
  if ((paramType.Name === 'uint' || paramType.Name === 'int') && typeof bits === 'number') {
    const asInt = typeof n === 'bigint' ? n : (Number.isInteger(n) ? BigInt(n) : null);
    if (asInt === null) {
      return false;
    }
    if (paramType.Name === 'uint') {
      return asInt >= 0n && asInt < (1n << BigInt(bits));
    }
    const half = 1n << BigInt(bits - 1);
    return asInt >= -half && asInt < half;
  }
  return true;
}

/**
 * The tier at which `argType` (the runtime type of an argument value) matches
 * `paramType`, or null if it is not assignable at all. A parameter typed `any` is
 * the catch-all tier; an exact type identity is the best tier; a literal argument
 * whose base is the parameter type ranks above an ordinary assignable widening,
 * which is the distinction literal-overload-ranking draws.
 */
function argumentTier(argType: TypeRecord, paramType: TypeRecord): Tier | null {

  if (paramType.Kind === 'any') {
    return Tier.CatchAll;
  }
  // A TYPE PARAMETER of a generic member binds from the argument at the call,
  // so it admits every argument - at the Generic tier, below every concrete
  // match.
  if (paramType.Kind === 'parameter') {
    return Tier.Generic;
  }
  if (IsAssignable(argType, paramType)) {
    // Exact identity is mutual assignability: the argument type is the parameter
    // type when each is assignable to the other. This is the best tier - EXCEPT
    // where the parameter is a ~nominal~ type the argument is not and does not
    // refine, which is rank 2 rather than rank 1: `{ a: uint8 }` has the shape
    // of `interface I { a: uint8 }` exactly, and mutual assignability cannot
    // tell that from being the interface, so an interface competing with a
    // structurally identical alias tied and the call was ambiguous.
    if (IsAssignable(paramType, argType)) {
      // Where a ~nominal~ type is on EITHER side, an exact match means identity
      // or refinement, and anything else is the structural rank. SameType is not
      // the test: it compares an interface to its structural form as equal,
      // which is the very equality that made the two signatures tie.
      //
      // Both directions matter, and the asymmetric form of this rule left the
      // mirror case ambiguous - an argument of the interface's own type, or of a
      // class that implements it, tied against a structurally identical alias.
      // The rule is about the RELATION: a match that holds only because the
      // shapes agree ranks below one that holds because a declaration says so.
      const argNominal = argType.Kind === 'nominal';
      const paramNominal = paramType.Kind === 'nominal';
      if (argNominal || paramNominal) {
        const sameDeclaration = argNominal && paramNominal
          && (argType as { Declaration?: unknown }).Declaration === (paramType as { Declaration?: unknown }).Declaration;
        const refines = argNominal && paramNominal
          && ClassImplements(argType, (paramType as { Declaration: ParseNode }).Declaration);
        return sameDeclaration || refines ? Tier.Exact : Tier.StructuralNominal;
      }
      return Tier.Exact;
    }
    // A literal argument assignable to the parameter, where the parameter is the
    // literal's base (or the literal is taking a non-literal type), ranks above a
    // plain widening between two non-literal types.
    if (argType.Kind === 'literal' && paramType.Kind !== 'literal') {
      return Tier.Literal;
    }
    return Tier.Assignable;
  }
  // An untyped number argument reports the general `number` type, which is not a
  // structural subtype of a sized numeric parameter, but a typed parameter coerces
  // it just as a single function would. It is viable, at the literal tier: an
  // untyped numeric literal taking the parameter's numeric type. The same holds
  // for an untyped bigint taking an arbitrary-precision integer parameter.
  if (isNumericValueType(argType) && isNumericValueType(paramType)) {
    return Tier.Literal;
  }
  // The checker half: a LITERAL argument - `{Kind: 'literal'}` over a numeric
  // base, which is what
  // `staticType(0)` reports - fell through both arms above against a sized
  // numeric parameter, so `assignArguments` answered 'unmatched' for the
  // README's own multi-rest example and the per-argument check fell back to
  // positions. The literal rule of #sec-literal-propagation admits it WHERE THE
  // VALUE FITS; the range check is what keeps this distribution agreeing with
  // the run time's, whose probe is the conversion itself and refuses 300
  // against a `uint.<8>` element.
  if (argType.Kind === 'literal' && isNumericValueType(paramType)) {
    return literalValueFitsNumeric(argType, paramType) ? Tier.Literal : null;
  }
  // proposal-runtime-types #sec-interfaces-semantics: an interface is NOMINAL
  // where a class declares it implements one and STRUCTURAL where a value is
  // checked against it - "an object that has the members satisfies an
  // interface-typed position whether or not any class declared it". IsAssignable
  // identifies a nominal target by its declaration, which is the right reading
  // for a class and for a dependent record type, whose `where` predicates a
  // structural comparison cannot judge. For an interface it left an
  // interface-typed parameter viable for NO argument at all, while the same
  // shape written as a structural alias resolved.
  //
  // Judged here rather than in the subtype relation: resolution is the caller
  // that needs the structural reading, and widening the relation would change
  // narrowing and dead-branch analysis with it. This is the same shape as the
  // numeric arm above - a single declaration accepts the argument, so a
  // signature must not be discarded for a reason the single form does not
  // apply. It ranks as an ordinary widening, below an exact match.
  if (paramType.Kind === 'nominal' && paramType.Structure !== undefined
      && (paramType.Declaration as { type?: string } | undefined)?.type === 'InterfaceDeclaration'
      && IsAssignable(argType, paramType.Structure)) {
    return Tier.Assignable;
  }
  if (argType.Kind === 'primitive' && argType.Name === 'bigint'
      && paramType.Kind === 'primitive' && (paramType.Name === 'int' || paramType.Name === 'uint')) {
    return Tier.Literal;
  }
  return null;
}

/**
 * The per-argument tiers of a signature against a list of argument types, or null
 * if the signature is not viable for them: its arity must admit the count, and
 * every argument must be assignable to the parameter that receives it (a rest
 * parameter receives every argument from its position onward, at its element
 * position's tier, which is the catch-all `any` where no element type is read).
 */
function signatureTiers(sig: OverloadSignature, argTypes: readonly TypeRecord[]): Tier[] | null {
  if (sig.Untyped) {
    // A catch-all takes any argument list, at the tier that ranks last.
    return argTypes.map(() => Tier.CatchAll);
  }
  const counts = assignArguments(sig.Parameters, argTypes);
  if (counts === null) {
    return null;
  }
  const tiers: Tier[] = [];
  for (let i = 0; i < argTypes.length; i += 1) {
    const k = slotReceiving(counts, i);
    const param = k === -1 ? undefined : sig.Parameters[k];
    if (!param) {
      return null;
    }
    // A rest parameter's element type is not read here, so an argument it
    // receives matches at the catch-all tier.
    if (param.Rest) {
      tiers.push(Tier.CatchAll);
      continue;
    }
    const tier = argumentTier(argTypes[i], param.Type);
    if (tier === null) {
      return null;
    }
    tiers.push(tier);
  }
  return tiers;
}

/**
 * Compares two viable signatures by their argument tiers, worst tier first: the
 * signature whose worst match is better wins, and ties break on the next-worst,
 * and so on. Returns a negative number if `a` is better, positive if `b` is, and
 * zero if they are indistinguishable by tier.
 */
function compareTiers(a: readonly Tier[], b: readonly Tier[]): number {
  const aSorted = [...a].sort((x, y) => y - x);
  const bSorted = [...b].sort((x, y) => y - x);
  for (let i = 0; i < Math.min(aSorted.length, bSorted.length); i += 1) {
    if (aSorted[i] !== bSorted[i]) {
      return aSorted[i] - bSorted[i];
    }
  }
  return 0;
}

/**
 * Whether a signature has a rest parameter. A signature that matches a call using
 * its fixed parameters alone is more specific than one that matches only by
 * absorbing arguments into a rest parameter, so where two signatures are otherwise
 * equally ranked the fixed one is preferred.
 */
function hasRest(sig: OverloadSignature): boolean {
  // ANY rest, not only a trailing one. The
  // tiebreak is about matching by absorption rather than by fixed parameters,
  // and where a rest sits has nothing to do with that.
  return sig.Parameters.some((p) => p.Rest);
}

/** The outcome of resolving a call against a set of signatures. */
export type OverloadResolution =
  | { readonly Kind: 'resolved', readonly Signature: OverloadSignature }
  | { readonly Kind: 'none' }
  | { readonly Kind: 'ambiguous' };

/**
 * Resolves a call of `argValues` against `signatures`. Collects the viable
 * signatures, ranks them by worst-argument tier, and returns the single best. No
 * viable signature is `none` (an argument list no overload accepts); more than one
 * equally-best is `ambiguous`; exactly one best is `resolved`.
 */
export function resolveOverload(signatures: readonly OverloadSignature[], argValues: readonly Value[], contextualType?: TypeRecord): OverloadResolution {
  return resolveOverloadByTypes(signatures, argValues.map((v) => RuntimeTypeOf(v)), contextualType);
}

/**
 * #sec-overload-resolution over argument TYPES rather than argument values, so
 * the checker can resolve a call the same way the run time does instead of
 * carrying a second copy of #table-argument-match-ranks. The run-time entry
 * above is this one with RuntimeTypeOf applied first; they share rather than
 * mirror because a rule this subtle drifts within a cycle or two of being
 * written twice.
 */
export function resolveOverloadByTypes(signatures: readonly OverloadSignature[], argTypes: readonly TypeRecord[], contextualType?: TypeRecord): OverloadResolution {
  const viable: { sig: OverloadSignature, tiers: Tier[] }[] = [];
  for (const sig of signatures) {
    const tiers = signatureTiers(sig, argTypes);
    if (tiers !== null) {
      viable.push({ sig, tiers });
    }
  }
  if (viable.length === 0) {
    return { Kind: 'none' };
  }
  let best = viable[0];
  let tie = false;
  for (let i = 1; i < viable.length; i += 1) {
    let cmp = compareTiers(viable[i].tiers, best.tiers);
    if (cmp === 0) {
      // Equal by tier: a signature matching on its fixed parameters is more
      // specific than one matching only by absorbing arguments into a rest
      // parameter, so the fixed signature is preferred and the tie is resolved.
      const iRest = hasRest(viable[i].sig);
      const bestRest = hasRest(best.sig);
      if (iRest !== bestRest) {
        cmp = iRest ? 1 : -1;
      }
    }
    if (cmp < 0) {
      best = viable[i];
      tie = false;
    } else if (cmp === 0) {
      tie = true;
    }
  }
  if (tie) {
    // #sec-overloading-on-return-type: the return type filters what ranking
    // left tied. "The return type does not participate in ranking; it
    // participates in filtering" - so this runs HERE, after the ranking above
    // has finished, and never before it. Filtering first would let a return
    // type outrank a better parameter match, which the clause forbids.
    if (contextualType) {
      const surviving = viable.filter(
        (candidate) => compareTiers(candidate.tiers, best.tiers) === 0
          && candidate.sig.ReturnType !== undefined
          && IsAssignable(candidate.sig.ReturnType, contextualType),
      );
        if (surviving.length === 1) {
        return { Kind: 'resolved', Signature: surviving[0]!.sig };
      }
    }
    return { Kind: 'ambiguous' };
  }
  return { Kind: 'resolved', Signature: best.sig };
}
