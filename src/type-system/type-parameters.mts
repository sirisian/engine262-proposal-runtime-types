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
/**
 * Re-exported from `records.mts`, where they live so that `relations.mts` can
 * use the substitution without importing this module: `type-parameters.mts`
 * imports `unify.mts`, which imports `relations.mts`, so an import the other way
 * would close a cycle. Both are pure walks over Type Records and depend on
 * nothing here.
 */
import { mentionsTypeParameter, substituteTypeParameters } from './records.mts';

export { mentionsTypeParameter, substituteTypeParameters };

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
