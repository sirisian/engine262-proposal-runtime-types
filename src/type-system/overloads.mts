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
import type { TypeRecord } from './records.mts';
import { anyType } from './records.mts';
import { IsAssignable } from './relations.mts';
import { RuntimeTypeOf } from './runtime.mts';

/**
 * One parameter of a signature, as overload resolution reads it: its declared
 * type (the `any` type where none is written), and whether it is optional, a rest
 * parameter, or carries a default. An optional parameter, a defaulted parameter,
 * and a rest parameter each let the signature accept an argument list shorter than
 * its written length.
 */
export interface OverloadParameter {
  readonly Type: TypeRecord;
  readonly Optional: boolean;
  readonly Rest: boolean;
  readonly HasDefault: boolean;
}

/**
 * A signature as a candidate for resolution: its parameters and the concrete
 * function that implements it. The function is what a winning signature calls.
 */
export interface OverloadSignature {
  readonly Parameters: readonly OverloadParameter[];
  readonly Function: Value;
  /**
   * #sec-overload-resolution: a signature with no annotation anywhere is a
   * CATCH-ALL. It ranks last and, being untyped, is viable for any argument
   * list - the clause's own example is that with `function f() {}` beside
   * `function f(a: uint8) {}`, `f(1)` takes the typed row on rank while
   * `f(1, 2)` takes the untyped one, "since the typed signature's arity does
   * not accept two arguments and it is not viable". Neither the run time nor
   * the checker implemented that: both answered "no overload matches" for the
   * two-argument call (F58). Declaring a return type is what makes a
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
    if (node.type === 'BindingRestElement') {
      params.push({ Type: anyType, Optional: false, Rest: true, HasDefault: false });
      continue;
    }
    const annotation = node.TypeAnnotation;
    const type = annotation ? typeOf(annotation) : anyType;
    const hasDefault = node.Initializer !== undefined && node.Initializer !== null;
    params.push({ Type: type, Optional: node.Optional === true, Rest: false, HasDefault: hasDefault });
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
    if (p.Optional || p.HasDefault || p.Rest) {
      break;
    }
    n += 1;
  }
  return n;
}

/**
 * Whether a signature's arity admits a call of `count` arguments: at least its
 * minimum arity, and no more than its fixed parameters unless it ends in a rest
 * parameter, which absorbs any number of trailing arguments.
 */
function arityAdmits(params: readonly OverloadParameter[], count: number): boolean {
  if (count < minimumArity(params)) {
    return false;
  }
  const hasRest = params.length > 0 && params[params.length - 1].Rest;
  if (hasRest) {
    return true;
  }
  return count <= params.length;
}

/** The match tier of one argument against one parameter, or null if it does not fit. */
const enum Tier {
  // Lower is better. The argument's type is exactly the parameter's type.
  Exact = 0,
  // An untyped literal argument taking the parameter's type (literal-overload-ranking).
  Literal = 1,
  // The argument is assignable to the parameter by an ordinary widening.
  Assignable = 2,
  // The parameter is the `any` type: an untyped catch-all that accepts anything.
  CatchAll = 3,
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
  if (IsAssignable(argType, paramType)) {
    // Exact identity is mutual assignability: the argument type is the parameter
    // type when each is assignable to the other. This is the best tier.
    if (IsAssignable(paramType, argType)) {
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
  if (!arityAdmits(sig.Parameters, argTypes.length)) {
    return null;
  }
  const tiers: Tier[] = [];
  for (let i = 0; i < argTypes.length; i += 1) {
    const param = sig.Parameters[i] ?? sig.Parameters[sig.Parameters.length - 1];
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
  return sig.Parameters.length > 0 && sig.Parameters[sig.Parameters.length - 1].Rest;
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
export function resolveOverload(signatures: readonly OverloadSignature[], argValues: readonly Value[]): OverloadResolution {
  return resolveOverloadByTypes(signatures, argValues.map((v) => RuntimeTypeOf(v)));
}

/**
 * #sec-overload-resolution over argument TYPES rather than argument values, so
 * the checker can resolve a call the same way the run time does instead of
 * carrying a second copy of #table-argument-match-ranks. The run-time entry
 * above is this one with RuntimeTypeOf applied first; F53 is the reason they
 * share rather than mirror - a rule this subtle drifts within a cycle or two of
 * being written twice (F58).
 */
export function resolveOverloadByTypes(signatures: readonly OverloadSignature[], argTypes: readonly TypeRecord[]): OverloadResolution {
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
    return { Kind: 'ambiguous' };
  }
  return { Kind: 'resolved', Signature: best.sig };
}
