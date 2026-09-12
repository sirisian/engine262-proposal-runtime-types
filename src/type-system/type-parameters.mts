import type { ParseNode } from '../parser/ParseNode.mts';
import { NumberValue } from '../value.mts';
import type {
  PropertyTypeRecord, SignatureRecord, TypeRecord, Known,
} from './records.mts';
import { unifyTypeParameters } from './unify.mts';
import { R } from '#self';

/**
 * proposal-runtime-types #sec-generics and #sec-parameterized-types:
 * a type parameter is a name standing in a type, replaced by an argument when
 * the declaration is applied.
 *
 * The three operations a generic needs, over Type Records and Parse Nodes
 * alone: whether a record MENTIONS a parameter, the record with its parameters
 * SUBSTITUTED, and the bindings a call's arguments imply. The last is the
 * structural walk in unify.mts, which the run time calls over RuntimeTypeOf of
 * its values - the same walk on both sides, which is what makes `f<T>(items:
 * [].<T>)` and `new L(items)` bind the same `T`.
 */

/** A scope of names with no constraints, for a site that has only names. */
export const scopeOfNames = (names: Iterable<string>): Map<string, Known | null> => {
  const scope = new Map<string, Known | null>();
  for (const n of names) {
    scope.set(n, null);
  }
  return scope;
};

/** Read _declaration_'s type parameter names, or ~none~ where it binds none. */
export const typeParameterNamesOf = (declaration: ParseNode | null | undefined): readonly string[] | null => {
  const list = (declaration as unknown as {
    TypeParameters?: { TypeParameterList?: readonly { BindingIdentifier?: { name?: string } }[] },
  } | null | undefined)?.TypeParameters?.TypeParameterList;
  if (!list || list.length === 0) {
    return null;
  }
  const names = list.map((tp) => tp.BindingIdentifier?.name ?? '').filter((n) => n !== '');
  return names.length > 0 ? names : null;
};

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
export const mentionsTypeName = (node: ParseNode | null | undefined, name: string): boolean => {
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

/**
 * Whether _t_ still mentions a type parameter.
 *
 * A call that supplies no type arguments binds nothing, and this proposal
 * does not yet infer a binding from the arguments, so a parameter or return
 * that names one is UNCONSTRAINED at such a call: comparing an argument
 * against a bare `T` would refuse `id(5)` for `function id<T>(v: T): T`,
 * which is the ordinary way a generic is called.
 */
export const mentionsTypeParameter = (t: Known, seen: Set<Known> = new Set()): boolean => {
  if (!t) {
    return false;
  }
  // A record already being asked about contributes no NEW parameter mention
  //, so `false` is the honest answer on a revisit rather than a guess.
  //
  // This is the THIRD walk of this shape: the recursion guard reached `eraseMetadata` and
  // `literalFitsNumericType` after a self-referential union overflowed the
  // host stack. Here the cyclic record is a recursive ALIAS reached through a
  // function PARAMETER inside a BLOCK - at top level the same program is
  // merely unchecked, and the block takes a path that walks the type
  // instead of decaying it to `any`.
  if (seen.has(t)) {
    return false;
  }
  seen.add(t);
  if (t.Kind === 'parameter') {
    return true;
  }
  const withMembers = t as { Members?: readonly TypeRecord[] };
  if (withMembers.Members?.some((m) => mentionsTypeParameter(m, seen))) {
    return true;
  }
  const withArgs = t as { Arguments?: readonly (TypeRecord | number)[] };
  if (withArgs.Arguments?.some((a) => typeof a !== 'number' && mentionsTypeParameter(a, seen))) {
    return true;
  }
  const withElement = t as { Element?: TypeRecord };
  if (withElement.Element && mentionsTypeParameter(withElement.Element, seen)) {
    return true;
  }
  // A TUPLE's elements, beside the array's singular [[Element]] one line above.
  // The plural was missing where the singular was handled - one letter
  // apart - so `type P<T> = [T, string]` read as mentioning no parameter, and
  // the substitution arm keyed on this predicate never ran for it.
  const withElements = t as { Elements?: readonly { Type?: TypeRecord }[] };
  if (withElements.Elements?.some((el) => !!el?.Type && mentionsTypeParameter(el.Type, seen))) {
    return true;
  }
  // An array's EXTENT may be a VALUE PARAMETER - the same omission the
  // next comment records for a function type's signature.
  const withExtentM = t as { Extent?: number | 'dynamic' | TypeRecord };
  if (withExtentM.Extent && typeof withExtentM.Extent === 'object'
      && mentionsTypeParameter(withExtentM.Extent as TypeRecord, seen)) {
    return true;
  }
  // A FUNCTION type mentions a parameter through its signature. Without this
  // `() => K` did not count as mentioning `K`, so the guard at the argument
  // check did not fire and the argument was compared against the UNBOUND
  // parameter - `"() => uint8" is not assignable to "() => K"`, which reads
  // like a type error and is really the absence of one.
  //
  // The same omission sat in the binding walk beside this, which likewise had
  // no [[Signatures]] case and so bound nothing from a callback. The two are
  // one gap seen from both ends: a callback's shape neither constrained a
  // variable nor was recognised as mentioning one.
  const withSignatures = t as {
    Signatures?: readonly { Parameters?: readonly { Type?: TypeRecord }[], Return?: TypeRecord | null }[],
  };
  if (withSignatures.Signatures?.some((sig) => (sig.Parameters ?? []).some((prm) => !!prm?.Type && mentionsTypeParameter(prm.Type, seen))
    || (!!sig.Return && mentionsTypeParameter(sig.Return, seen)))) {
    return true;
  }
  // An OBJECT type mentions a parameter through its members. An interface
  // parameterized on a variable - `Iterable.<T>` - is a structural record with
  // T inside `[Symbol.iterator]`'s return, so without this it did not count as
  // mentioning T: the guard at the argument check did not fire, and the
  // argument was compared against the interface with T still unbound.
  //
  // Every field a record can carry a parameter in is walked - Members,
  // Arguments, Element, Extent, Signatures, Properties and IndexSignatures -
  // because this predicate GATES the substitution arms: a field the
  // predicate skips is a field the substitution never reaches, and neither
  // half fails visibly on its own. An INDEX SIGNATURE mentions a parameter
  // through either half, since `{ [k: K]: V }` may parameterise either.
  const withIndexSignatures = t as {
    IndexSignatures?: readonly { Key?: TypeRecord, Value?: TypeRecord }[],
  };
  if (withIndexSignatures.IndexSignatures?.some((ix) => (!!ix?.Key && mentionsTypeParameter(ix.Key, seen))
    || (!!ix?.Value && mentionsTypeParameter(ix.Value, seen)))) {
    return true;
  }
  const withProperties = t as { Properties?: readonly { type?: TypeRecord }[] };
  return !!withProperties.Properties?.some((prop) => !!prop?.type && mentionsTypeParameter(prop.type, seen));
};

/**
 * #sec-generics: _t_ with each type parameter replaced by what the
 * call bound it to.
 *
 * This is what gives a generic call its Static Type on the DECLARED path:
 * `function first<T>(a: [].<T>): T {}` called as `first.<uint32>([1])` is a
 * `uint32`, and an assignment of it is checked.
 */
export const substituteTypeParameters = (t: Known, bindings: ReadonlyMap<string, TypeRecord>): Known => {
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
  // A TUPLE's elements, beside the array's singular [[Element]] arm below.
  // `substituteTypeParameters` handled `Element` and not `Elements`,
  // exactly as `mentionsTypeParameter` did, so `type P<T> = [T, string]` kept
  // its `T` and `P.<uint8>` was satisfied by nothing - an exact
  // `[uint8, string]` source included.
  //
  // Each element is spread, so a REST or an initial marker rides along
  // untouched and only [[Type]] is replaced.
  const withElements = t as { Elements?: readonly { Type?: TypeRecord }[] };
  if (withElements.Elements) {
    return {
      ...t,
      Elements: withElements.Elements.map((el) => (el?.Type
        ? { ...el, Type: substituteTypeParameters(el.Type, bindings) }
        : el)),
    } as unknown as Known;
  }
  const withElement = t as { Element?: TypeRecord };
  if (withElement.Element) {
    {
      // A parameterized EXTENT is substituted alongside the element.
      // A literal record's [[Value]] is an ENGINE Value, not a JS number, and
      // a value generic binds the value its constraint admits - `f.<4>` binds
      // a TYPED uint32 4 - so it is unwrapped rather than read with `typeof`.
      const withExtentS = t as { Extent?: number | 'dynamic' | TypeRecord };
      let nextExtent = withExtentS.Extent;
      if (nextExtent && typeof nextExtent === 'object') {
        const done = substituteTypeParameters(nextExtent as Known, bindings);
        const lit = done as { Kind?: string, Value?: unknown } | null;
        const raw = lit && lit.Kind === 'literal' ? lit.Value : undefined;
        const asNumber = raw instanceof NumberValue ? R(raw) : undefined;
        nextExtent = typeof asNumber === 'number' ? asNumber : (done as TypeRecord | undefined) ?? nextExtent;
      }
      return {
        ...t,
        Element: substituteTypeParameters(withElement.Element, bindings) as TypeRecord,
        ...(withExtentS.Extent !== undefined ? { Extent: nextExtent } : {}),
      } as Known;
    }
  }
  // A FUNCTION and an OBJECT type carry variables in their signatures and
  // members, and neither was substituted. So a bound `T` reached a callback
  // parameter still spelled `T`: the contextual type recorded for the literal
  // was the UNBOUND one, and a body reading its parameter saw `"T" is not
  // assignable to "uint8"`.
  //
  // The fourth place the same two shapes were missing. `mentionsTypeParameter`
  // lacked both, the binding walk lacked both, and so did this - one omission
  // repeated across every operation that walks a type, which is why each half
  // looked like a separate defect until the pattern was named.
  const withSignatures = t as {
    // The local shape names only what this function READS. It must keep the
    // record's own field types for the rest: the spreads below preserve every
    // other field at run time, and a looser annotation makes the `as Known` a
    // widening TypeScript rejects - `Parameters` would lose `Name`,
    // `Optional` and `Rest`.
    Signatures?: readonly SignatureRecord[],
  };
  // Guarded on the type actually MENTIONING a variable, so a record with
  // nothing to substitute is returned as it came: an object type is reached
  // here constantly, and a fresh record is not always interchangeable with
  // the one it copies (SoA and window programs depend on the identity).
  if (withSignatures.Signatures && mentionsTypeParameter(t)) {
    return {
      ...t,
      Signatures: withSignatures.Signatures.map((sig) => ({
        ...sig,
        Parameters: (sig.Parameters ?? []).map((prm) => (prm?.Type
          ? { ...prm, Type: substituteTypeParameters(prm.Type, bindings) }
          : prm)),
        Return: sig.Return ? substituteTypeParameters(sig.Return, bindings) : sig.Return,
      })),
    } as Known;
  }
  // An INDEX SIGNATURE's halves are substituted beside the properties.
  // This walk had a `Properties` arm and NO `IndexSignatures` arm at all, so
  // `interface Box<T> { [k: string]: T }` kept its `T` and `Box.<uint8>` was
  // satisfied by nothing - not even by a source declaring the very signature
  // it wanted.
  //
  // `SubstituteTypeArguments` in `runtime.mts` copies [[IndexSignatures]]
  // verbatim and has the same gap, but is NOT the site this reaches: traced,
  // it is not called for these programs at all.
  const withProperties = t as {
    Properties?: readonly PropertyTypeRecord[],
    IndexSignatures?: readonly { Key?: TypeRecord, Value?: TypeRecord }[],
  };
  if ((withProperties.Properties || withProperties.IndexSignatures) && mentionsTypeParameter(t)) {
    return {
      ...t,
      ...(withProperties.Properties ? {
        Properties: withProperties.Properties.map((prop) => (prop?.type
          ? { ...prop, type: substituteTypeParameters(prop.type, bindings) }
          : prop)),
      } : {}),
      ...(withProperties.IndexSignatures ? {
        IndexSignatures: withProperties.IndexSignatures.map((ix) => ({
          ...ix,
          ...(ix?.Key ? { Key: substituteTypeParameters(ix.Key, bindings) } : {}),
          ...(ix?.Value ? { Value: substituteTypeParameters(ix.Value, bindings) } : {}),
        })),
      } : {}),
    } as Known;
  }
  return t;
};

/**
 * #sec-inference-and-function-forms: bind a signature's type parameters from the
 * ARGUMENTS of a call that supplies none explicitly.
 *
 * `id(5)` says what `T` is as plainly as `id.<uint8>(5)` does, and without
 * reading it the argument check has nothing to compare against and the call
 * has no Static Type. Matching walks the parameter type and the argument type
 * together and binds a parameter position to whatever stands opposite it; the
 * first binding for a name wins, since a later disagreement is the caller's
 * error rather than a reason to rebind.
 *
 * The matching is the shared walk in unify.mts, over Static Types here, with
 * this checker's own `mentionsTypeParameter` and `substituteTypeParameters`
 * supplied where the walk needs them. The run time calls the same walk over
 * RuntimeTypeOf of its values, which is what makes `f<T>(items: [].<T>)` and
 * `new L(items)` bind the same `T` on both sides.
 */
export const bindTypeParametersFromArguments = (
  parameters: readonly { Type?: Known }[],
  argumentTypes: readonly Known[],
  names: ReadonlySet<string>,
  into: Map<string, TypeRecord>,
): void => {
  unifyTypeParameters(
    parameters as readonly { Type?: TypeRecord | null, Rest?: boolean }[],
    argumentTypes as readonly (TypeRecord | null)[],
    names,
    into,
    {
      mentionsTypeParameter: (t) => mentionsTypeParameter(t as Known),
      substituteTypeParameters: (t, bindings) => substituteTypeParameters(t as Known, bindings) as TypeRecord | null,
    },
  );
};
