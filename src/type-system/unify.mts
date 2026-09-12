import { CanonicalizeType } from './intern.mts';
import { iterationInterfaceRecord } from './iteration-types.mts';
import { makePrimitive, type TypeRecord } from './records.mts';
import { IsAssignable, SameType } from './relations.mts';

/**
 * proposal-runtime-types #sec-computed-constraints, #sec-variadic-parameters
 * (PLAN-v3 Q6, "the reach of the shared core"): the STRUCTURAL rung of
 * inference, shared.
 *
 * A parameter binds from the argument a formal annotated with exactly it
 * receives; that is the positional rule and it is the first rung. A formal
 * annotated `items: [].<T>`, `m: Map.<K, V>`, `cb: (x: T) => void`, or `i:
 * Iterable.<T>` reaches the parameter THROUGH a shape, and binding through the
 * shape is this walk: the formal's type, with the parameters still unbound
 * left as ~parameter~ records, is matched against the argument's type, and
 * each ~parameter~ record met binds to what stands opposite it.
 *
 * The checker ran this over Static Types and the run time did not run it at
 * all, binding `any` where the positional rule saw nothing - so the two sides
 * disagreed about every such call, silently, until the `any` fallback was
 * removed and the disagreement became a refusal. One walk, over Type Records,
 * which both sides have: the checker passes Static Types and the run time
 * passes RuntimeTypeOf of the values. The two helpers a caller supplies are
 * the ones whose implementation each side already owns.
 */
export interface UnifyHelpers {
  /** Whether _t_ mentions any ~parameter~ record, however deeply. */
  mentionsTypeParameter(t: TypeRecord | null): boolean;
  /** _t_ with each ~parameter~ record named in _bindings_ replaced by its binding. */
  substituteTypeParameters(t: TypeRecord | null, bindings: ReadonlyMap<string, TypeRecord>): TypeRecord | null;
}

export const ITERATION_INTERFACES_FOR_INFERENCE = ['Iterable', 'Iterator', 'IterableIterator'] as const;

/** A literal widened to its base, as a binding from an argument reads it. */
export function widenForBinding(t: TypeRecord): TypeRecord {
  if (t.Kind === 'literal') {
    return ((t as { Base?: TypeRecord }).Base ?? t) as TypeRecord;
  }
  return t;
}

/**
 * The element type an iterable-typed value yields, or *null* where it yields
 * none: an array's [[Element]], the join of a tuple's positions, a `string`'s
 * characters, or a nominal's first type argument. Shared by the inference here
 * and by the checker; the `for`-`of` walk derives a Map's pair separately,
 * that being a binding question rather than an element one.
 */
export function elementTypeOfIterable(t: TypeRecord | null): TypeRecord | null {
  if (!t) {
    return null;
  }
  if (t.Kind === 'array') {
    return (t as { Element?: TypeRecord }).Element ?? null;
  }
  if (t.Kind === 'tuple') {
    const elements = (t as { Elements?: readonly { Type: TypeRecord }[] }).Elements ?? [];
    if (elements.length === 0) {
      return null;
    }
    return elements.length === 1
      ? elements[0]!.Type
      : CanonicalizeType({ Kind: 'union', Members: elements.map((e) => e.Type) } as TypeRecord);
  }
  const base = t.Kind === 'literal' ? (t as { Base?: TypeRecord }).Base : t;
  if (base && base.Kind === 'primitive' && (base as { Name?: string }).Name === 'string') {
    return makePrimitive('string') as TypeRecord;
  }
  if (t.Kind === 'nominal' && t.Arguments.length > 0) {
    const first = t.Arguments[0];
    return typeof first === 'number' ? null : first as TypeRecord;
  }
  return null;
}

/** The generic `mentions` a caller without its own can use. */
export function mentionsParameterNamed(t: TypeRecord | null, names: ReadonlySet<string>, seen: Set<object> = new Set()): boolean {
  if (!t || seen.has(t)) {
    return false;
  }
  seen.add(t);
  if (t.Kind === 'parameter') {
    return names.has((t as { Name: string }).Name);
  }
  const r = t as {
    Members?: readonly TypeRecord[],
    Arguments?: readonly (TypeRecord | number)[],
    Element?: TypeRecord,
    Elements?: readonly { Type?: TypeRecord }[],
    Signatures?: readonly { Parameters?: readonly { Type?: TypeRecord }[], Return?: TypeRecord | null }[],
    Properties?: readonly { type?: TypeRecord }[],
  };
  if (r.Members?.some((m) => mentionsParameterNamed(m, names, seen))) {
    return true;
  }
  if (r.Arguments?.some((a) => typeof a !== 'number' && mentionsParameterNamed(a, names, seen))) {
    return true;
  }
  if (r.Element && mentionsParameterNamed(r.Element, names, seen)) {
    return true;
  }
  if (r.Elements?.some((e) => mentionsParameterNamed(e.Type ?? null, names, seen))) {
    return true;
  }
  if (r.Signatures?.some((s) => (s.Parameters ?? []).some((p) => mentionsParameterNamed(p.Type ?? null, names, seen)) || mentionsParameterNamed(s.Return ?? null, names, seen))) {
    return true;
  }
  if (r.Properties?.some((p) => mentionsParameterNamed(p.type ?? null, names, seen))) {
    return true;
  }
  return false;
}

/** The generic `substitute` a caller without its own can use: by parameter name. */
export function substituteParametersNamed(t: TypeRecord | null, bindings: ReadonlyMap<string, TypeRecord>): TypeRecord | null {
  if (!t) {
    return t;
  }
  if (t.Kind === 'parameter') {
    return bindings.get((t as { Name: string }).Name) ?? t;
  }
  const r = t as {
    Members?: readonly TypeRecord[],
    Arguments?: readonly (TypeRecord | number)[],
    Element?: TypeRecord,
    Elements?: readonly { Type?: TypeRecord }[],
    Signatures?: readonly { Parameters?: readonly { Type?: TypeRecord }[], Return?: TypeRecord | null }[],
    Properties?: readonly { type?: TypeRecord }[],
  };
  const sub = (x: TypeRecord | null | undefined): TypeRecord | null => substituteParametersNamed(x ?? null, bindings);
  if (r.Members) {
    return { ...t, Members: r.Members.map((m) => sub(m) as TypeRecord) } as TypeRecord;
  }
  if (r.Arguments && r.Arguments.length > 0) {
    return { ...t, Arguments: r.Arguments.map((a) => (typeof a === 'number' ? a : sub(a) as TypeRecord)) } as TypeRecord;
  }
  if (r.Elements) {
    return { ...t, Elements: r.Elements.map((e) => (e.Type ? { ...e, Type: sub(e.Type) as TypeRecord } : e)) } as unknown as TypeRecord;
  }
  if (r.Element) {
    return { ...t, Element: sub(r.Element) as TypeRecord } as TypeRecord;
  }
  if (r.Signatures) {
    return {
      ...t,
      Signatures: r.Signatures.map((s) => ({
        ...s,
        Parameters: (s.Parameters ?? []).map((p) => ({ ...p, Type: sub(p.Type) ?? p.Type })),
        Return: sub(s.Return ?? null) ?? s.Return,
      })),
    } as unknown as TypeRecord;
  }
  if (r.Properties) {
    return { ...t, Properties: r.Properties.map((p) => ({ ...p, type: sub(p.type) ?? p.type })) } as unknown as TypeRecord;
  }
  return t;
}

/**
 * Bind the type parameters in _names_ from _argumentTypes_ through _parameters_
 * into _into_. A binding already in _into_ keeps; the walk never overrules one.
 * A null argument type binds nothing (it is unknown, not absent).
 */
export function unifyTypeParameters(
  parameters: readonly { Type?: TypeRecord | null, Rest?: boolean }[],
  argumentTypes: readonly (TypeRecord | null)[],
  names: ReadonlySet<string>,
  into: Map<string, TypeRecord>,
  helpers: UnifyHelpers,
): void {
  const match = (param: TypeRecord | null, arg: TypeRecord | null): void => {
    if (!param || !arg) {
      return;
    }
    if (param.Kind === 'parameter') {
      const name = (param as { Name: string }).Name;
      if (names.has(name) && !into.has(name)) {
        // A LITERAL-TYPED CONSTRAINT keeps the literal. #sec-type-parameters:
        // "Where a parameter's evaluated constraint is a literal type or a union
        // of literal types, the binding inferred for that parameter from a call
        // argument is the literal type of the argument's value, NOT the widened
        // base. The binding is then checked against the constraint as any
        // binding is."
        //
        // Widening unconditionally made the rule unreachable: a
        // `<T: "a" | "b">` bound `T` to `string`, so `let r: "a" = pick("a")`
        // was refused although the argument is exactly what the constraint
        // admits, and no argument could ever satisfy the constraint by
        // inference. An unconstrained parameter still widens, which is what
        // makes `id("a")` a `string` rather than a one-value type.
        const constraint = (param as { Constraint?: TypeRecord }).Constraint;
        const literalConstrained = !!constraint && (constraint.Kind === 'literal'
          || (constraint.Kind === 'union'
            && (constraint as { Members: readonly TypeRecord[] }).Members.every((m) => m.Kind === 'literal')));
        into.set(name, literalConstrained ? arg : widenForBinding(arg));
      }
      return;
    }
    // An INTERFACE-typed parameter. `Iterable.<T>` resolves to a STRUCTURAL
    // record with T buried inside `[Symbol.iterator]`'s return's `next`'s
    // return, so neither the [[Arguments]] walk below nor the [[Element]] one
    // can see it. Recovered by RECONSTRUCTION: for each variable still unbound,
    // rebuild the interface at that variable and ask whether it is the
    // parameter's own type - one `SameType` per candidate, and exact.
    if (param.Kind === 'object') {
      for (const candidate of names) {
        if (into.has(candidate)) {
          continue;
        }
        const variable = { Kind: 'parameter', Name: candidate } as unknown as TypeRecord;
        for (const interfaceName of ITERATION_INTERFACES_FOR_INFERENCE) {
          const rebuilt = iterationInterfaceRecord(interfaceName, [variable]);
          if (rebuilt && SameType(rebuilt, param)) {
            const element = elementTypeOfIterable(arg);
            if (element) {
              into.set(candidate, widenForBinding(element));
            }
            return;
          }
        }
      }
    }
    // An OBJECT parameter against an object argument, or a nominal whose
    // structure is one: each declared property binds against the argument's
    // property of that key, so `f<T>(o: { a: T })` binds T from `{ a: (1 :=
    // uint8) }`. (An iteration interface was tried first, above.)
    if (param.Kind === 'object') {
      const pProps = (param as { Properties?: readonly { key: string, type?: TypeRecord }[] }).Properties ?? [];
      const aShape = arg.Kind === 'object' ? arg : (arg.Kind === 'nominal' ? (arg as { Structure?: TypeRecord }).Structure : undefined);
      const aProps = aShape && aShape.Kind === 'object'
        ? (aShape as { Properties?: readonly { key: string, type?: TypeRecord }[] }).Properties
        : undefined;
      if (aProps) {
        for (const pp of pProps) {
          const ap = aProps.find((q) => q.key === pp.key);
          if (pp.type && ap?.type) {
            match(pp.type, ap.type);
          }
        }
        return;
      }
    }
    // A UNION parameter: the arm whose KIND the argument has binds, tried
    // before assignability (an arm still mentioning an unbound variable admits
    // almost anything); then the arm the argument is assignable to; then, as
    // the ordinary first-binding case, an arm that mentions a variable at all.
    // Where two arms admit the argument the FIRST is taken.
    if (param.Kind === 'union') {
      const members = (param as { Members?: readonly TypeRecord[] }).Members ?? [];
      const argLibrary = (arg as { LibraryName?: string }).LibraryName;
      for (const arm of members) {
        if (helpers.mentionsTypeParameter(arm) && arm.Kind === arg.Kind
            && (arm.Kind !== 'nominal' || (arm as { LibraryName?: string }).LibraryName === argLibrary)) {
          match(arm, arg);
          return;
        }
      }
      for (const arm of members) {
        const substituted = helpers.substituteTypeParameters(arm, into);
        if (helpers.mentionsTypeParameter(arm) && substituted && IsAssignable(arg, substituted)) {
          match(arm, arg);
          return;
        }
      }
      for (const arm of members) {
        if (helpers.mentionsTypeParameter(arm)) {
          match(arm, arg);
          return;
        }
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
      return;
    }
    // A TUPLE pattern, `p: [T, ...Rest]`, against a tuple argument: fixed
    // positions pairwise, and a rest element to the tuple of what remains.
    const pEls = (param as { Elements?: readonly { Type: TypeRecord, Rest?: boolean }[] }).Elements;
    const aEls = (arg as { Elements?: readonly { Type: TypeRecord, Rest?: boolean }[] }).Elements;
    if (pEls && aEls) {
      pEls.forEach((pe, i) => {
        if (pe.Rest) {
          match(pe.Type, { Kind: 'tuple', Elements: aEls.slice(i).map((e) => ({ Type: e.Type, Rest: false, Initial: 'none' })) } as unknown as TypeRecord);
        } else if (aEls[i]) {
          match(pe.Type, aEls[i]!.Type);
        }
      });
      return;
    }
    if (pEls && aEl) {
      // A tuple pattern against an array binds each fixed position to the
      // element type and a rest to the array itself.
      pEls.forEach((pe) => {
        match(pe.Type, pe.Rest ? arg : aEl);
      });
      return;
    }
    // A FUNCTION parameter: a callback's shape says what a variable is as
    // plainly as a direct position does; `K` in `f<K>(cb: () => K)` is known
    // from nowhere else. Only the FIRST signature of each, and only pairwise.
    type SigShape = {
      Parameters?: readonly { Type?: TypeRecord }[],
      Return?: TypeRecord | null,
      InferredReturn?: TypeRecord | null,
      ReturnType?: TypeRecord | null,
    };
    const pSigs = (param as { Signatures?: readonly SigShape[] }).Signatures;
    const aSigs = (arg as { Signatures?: readonly SigShape[] }).Signatures;
    if (pSigs?.length === 1 && aSigs?.length === 1) {
      const pSig = pSigs[0]!;
      const aSig = aSigs[0]!;
      (pSig.Parameters ?? []).forEach((pp, i) => {
        const ap = (aSig.Parameters ?? [])[i];
        if (pp?.Type && ap?.Type) {
          match(pp.Type, ap.Type);
        }
      });
      const pReturn = pSig.Return ?? pSig.InferredReturn ?? pSig.ReturnType;
      const aReturn = aSig.Return ?? aSig.InferredReturn ?? aSig.ReturnType;
      if (pReturn && aReturn) {
        match(pReturn, aReturn);
      }
    }
  };
  for (let i = 0; i < parameters.length; i += 1) {
    const p = parameters[i]!;
    const pt = p.Type ?? null;
    if (p.Rest === true && pt) {
      // #sec-variadic-parameters rung one: a REST parameter annotated with a
      // type parameter, `...xs: Ts`, binds it to the TUPLE of the trailing
      // arguments' types; one annotated with an array binds through its
      // element against each trailing argument.
      const trailing = argumentTypes.slice(i);
      if (pt.Kind === 'parameter') {
        const name = (pt as { Name: string }).Name;
        if (names.has(name) && !into.has(name) && trailing.every((a) => a !== null)) {
          into.set(name, {
            Kind: 'tuple',
            Elements: trailing.map((a) => ({ Type: widenForBinding(a!), Rest: false, Initial: 'none' })),
          } as unknown as TypeRecord);
        }
      } else if (pt.Kind === 'array') {
        for (const a of trailing) {
          match((pt as { Element: TypeRecord }).Element, a);
        }
      } else {
        match(pt, argumentTypes[i] ?? null);
      }
      break;
    }
    match(pt, argumentTypes[i] ?? null);
  }
}
