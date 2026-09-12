import { type ParameterRecord, type TypeRecord, type Known } from './records.mts';
import { SameType } from './relations.mts';
import { resolveOverloadByTypes } from './overloads.mts';

/**
 * Reading a CALLABLE out of a type: the signature a value carries, whether a
 * type is callable at all, and which construct signature a `new` selects.
 *
 * A function type, a class's construct signatures and an interface's call
 * signatures are three spellings of the same question, so a caller asks these
 * rather than testing [[Kind]] itself.
 */

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
export const effectiveFunctionType = (t: Known): Known => {
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

/**
 * The type a value is CALLED at. A ~nominal~ interface whose [[Structure]] is a
 * ~function~ record - an interface of call signatures - is called as that
 * function: #sec-object-types says such an interface "denotes the ~function~
 * Type Record", and #sec-interfaces that an interface "may also type ... a
 * function structurally". Both call-checking sites tested `Kind === 'function'`
 * on the raw type and so saw an interface-typed callee as uncallable-unknown.
 */
export const callableForm = (t: Known): Known => {
  if (t && t.Kind === 'nominal') {
    const structure = (t as { Structure?: Known }).Structure;
    if (structure && structure.Kind === 'function') {
      return structure;
    }
  }
  return t;
};

/** The declared name of a nominal receiver, which is what the context holds. */
export const ownerNameOf = (t: TypeRecord): string | undefined => {
  if (t.Kind !== 'nominal') {
    return undefined;
  }
  const decl = (t as { Declaration?: { BindingIdentifier?: { name?: string } | null } }).Declaration;
  return decl?.BindingIdentifier?.name ?? (t as { LibraryName?: string }).LibraryName;
};

/**
 * Whether two constructor parameters are the same for signature identity.
 *
 * Deliberately narrow: two types are the same when `SameType` says so, and an
 * ABSENT type equals only an absent one. Treating an unannotated parameter as
 * `any` would make `constructor(a)` and `constructor(a: uint8)` one signature
 * and refuse a legal overload set, and treating it as unknown-so-different
 * would let `constructor(a)` be declared twice.
 */
export const sameConstructParameter = (a: Known | null, b: Known | null): boolean => {
  if (!a || !b) {
    return !a && !b;
  }
  return SameType(a, b);
};

/**
 * The construct signature a call selects, from a class that may declare more
 * than one.
 *
 * Routed through `resolveOverloadByTypes` rather than matched by arity here,
 * because the checker and the runtime must not answer this differently. Four
 * defects in this area have been two sides disagreeing about a type, and a
 * second matching rule written for constructors would be a fifth waiting to
 * happen.
 *
 * Answers the sole signature where a class declares one, so the common case
 * pays nothing and behaves exactly as it did.
 */
export const selectConstructSignature = (
  sigs: readonly { Parameters: ParameterRecord[] }[] | undefined,
  argTypes: readonly TypeRecord[],
): { Parameters: ParameterRecord[] } | undefined => {
  if (!sigs || sigs.length === 0) {
    return undefined;
  }
  if (sigs.length === 1) {
    return sigs[0];
  }
  const resolution = resolveOverloadByTypes(sigs as never, argTypes as TypeRecord[]);
  return resolution.Kind === 'resolved'
    ? (resolution.Signature as unknown as { Parameters: ParameterRecord[] })
    : undefined;
};
