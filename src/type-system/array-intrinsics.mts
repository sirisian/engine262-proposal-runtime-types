import { ObjectValue, Value, wellKnownSymbols, type Descriptor } from '../value.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { AddWrittenNames, EffectFreeConstruction, IsDirectEvalCall, intrinsicData, intrinsicSourceIsStable } from './intrinsic-origin.mts';

const methods = new Set(['with', 'toSpliced', 'sort', 'toSorted', 'reduce', 'reduceRight', 'slice', 'filter', 'toReversed', 'splice', 'concat', 'push', 'pop', 'shift', 'unshift', 'reverse', 'copyWithin', 'fill']);
const originals = new WeakMap<Realm, Map<string, Value>>();
const species = new WeakMap<Realm, Descriptor>();

/** Record identities before user code can replace any Array method. */
export function RememberArrayIntrinsics(realm: Realm, prototype: ObjectValue): void {
  originals.set(realm, new Map([...methods].map((name) => [name, intrinsicData(prototype, Value(name))!])));
  const constructor = realm.Intrinsics['%Array%'];
  const descriptor = constructor?.properties.get(wellKnownSymbols.species);
  if (descriptor) species.set(realm, descriptor);
}

/**
 * #sec-intrinsic-array-contracts: only transparent fresh-array origins justify
 * intrinsic contracts. The source screen includes nested bodies and argument
 * effects; an unknown call, getter, escape or reflective write defeats it.
 * Calls in functions stand down because a later script can invoke them after
 * replacing a dependency.
 */
export function ProvenArrayMembers(root: ParseNode, realm: Realm): ReadonlySet<ParseNode> {
  const result = new Set<ParseNode>();
  const definitions = new Map<string, ParseNode>();
  const ambiguous = new Set<string>();
  const written = new Set<string>();
  let directEval = false;
  const nodes: ParseNode[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const node = value as ParseNode;
    nodes.push(node);
    AddWrittenNames(node, written);
    if (IsDirectEvalCall(node)) directEval = true;
    if (node.type === 'BindingIdentifier' && node.parent) {
      if (definitions.has(node.name)) ambiguous.add(node.name);
      definitions.set(node.name, node.parent);
    }
    for (const [key, child] of Object.entries(node)) {
      if (!['parent', 'location', 'sourceText'].includes(key)) visit(child);
    }
  };
  visit(root);
  const stringIsStable = !realm.GlobalEnv.DeclarativeRecord.bindings.has(Value('String'))
    && !nodes.some((node) => {
      if (node.type !== 'AssignmentExpression') return false;
      const target = node.LeftHandSideExpression;
      return (target.type === 'IdentifierReference' && target.name === 'String')
        || (target.type === 'MemberExpression' && (target.IdentifierName?.name === 'String'
          || (target.Expression?.type === 'StringLiteral' && target.Expression.value === 'String')));
    });
  const unwrap = (node: ParseNode): ParseNode => {
    while (node.type === 'ParenthesizedExpression') node = node.Expression;
    return node;
  };
  // #sec-function-types: a `let` is an origin while nothing replaces it - no
  // assignment, pattern, captured write or direct eval.
  const stableBinding = (declaration: ParseNode.LexicalDeclaration, name: string): boolean => declaration.LetOrConst === 'const'
    || (!written.has(name) && !directEval);
  const literalInput = (expression: ParseNode, seen = new Set<ParseNode>()): boolean => {
    const node = unwrap(expression);
    if (seen.has(node)) return false;
    seen.add(node);
    if (['NumericLiteral', 'StringLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral'].includes(node.type)) return true;
    if (node.type === 'UnaryExpression' && ['+', '-'].includes(node.operator)) return node.UnaryExpression.type === 'NumericLiteral';
    if (node.type === 'ArrayLiteral') return node.ElementList.every((entry) => literalInput(entry, new Set(seen)));
    if (node.type !== 'IdentifierReference' || ambiguous.has(node.name)) return false;
    const declaration = definitions.get(node.name);
    if (!declaration) return node.name === 'undefined' && intrinsicData(realm.GlobalObject, Value('undefined')) === Value.undefined;
    return declaration.type === 'LexicalBinding' && declaration.parent?.type === 'LexicalDeclaration'
      && stableBinding(declaration.parent, node.name) && !!declaration.Initializer && literalInput(declaration.Initializer, seen);
  };
  const fresh = (expression: ParseNode, seen = new Set<ParseNode>()): boolean => {
    if (seen.has(expression)) return false;
    seen.add(expression);
    const node = unwrap(expression);
    if (node.type === 'ArrayLiteral') return literalInput(node);
    if (node.type === 'CallExpression' && node.CallExpression.type === 'MemberExpression'
        && ['slice', 'filter', 'toSorted', 'toReversed', 'with'].includes(node.CallExpression.IdentifierName?.name ?? '')) {
      const name = node.CallExpression.IdentifierName!.name;
      return intrinsicData(realm.Intrinsics['%Array.prototype%'], Value(name)) === originals.get(realm)?.get(name)
        && !realm.Intrinsics['%TypedArrayLike.prototype%'].properties.has(Value(name))
        && fresh(node.CallExpression.MemberExpression, seen);
    }
    if (node.type !== 'IdentifierReference' || ambiguous.has(node.name)) return false;
    const declaration = definitions.get(node.name);
    if (declaration?.type !== 'LexicalBinding' || declaration.parent?.type !== 'LexicalDeclaration'
        || !stableBinding(declaration.parent, node.name)) return false;
    // A declaration without an initializer holds its type's default, and the
    // default of a stated-extent array is a new array (#sec-defaultvalueof).
    if (!declaration.Initializer) {
      const annotated = declaration.TypeAnnotation?.Type;
      return annotated?.type === 'ArrayType' && !!annotated.ArrayExtent;
    }
    return fresh(declaration.Initializer, seen);
  };
  const prototype = realm.Intrinsics['%Array.prototype%'];
  const typedPrototype = realm.Intrinsics['%TypedArrayLike.prototype%'];
  const constructor = realm.Intrinsics['%Array%'];
  const currentSpecies = constructor.properties.get(wellKnownSymbols.species);
  const originalSpecies = species.get(realm);
  if (!originals.has(realm) || !originalSpecies || !currentSpecies
      || currentSpecies.Getter !== originalSpecies.Getter || currentSpecies.Value !== originalSpecies.Value
      || intrinsicData(prototype, Value('constructor')) !== constructor
      || (typedPrototype as ObjectValue & { Prototype: Value }).Prototype !== prototype || typedPrototype.properties.has(Value('constructor'))) return result;
  const safe = (node: ParseNode): boolean => {
    if (node.type === 'MemberExpression' && fresh(node.MemberExpression)) {
      const name = node.IdentifierName?.name;
      if (name === 'length') return node.parent?.type !== 'AssignmentExpression';
      if (!name || !methods.has(name) || node.parent?.type !== 'CallExpression' || node.parent.CallExpression !== node) return false;
      if (typedPrototype.properties.has(Value(name)) || intrinsicData(prototype, Value(name)) !== originals.get(realm)!.get(name)) return false;
      // A callback with an unavailable body can mutate a dependency before a
      // later call in this source. Keep such sources at the dynamic boundary.
      if (['sort', 'toSorted', 'reduce', 'reduceRight', 'filter'].includes(name)) {
        const callback = node.parent.Arguments[0];
        if (callback?.type === 'IdentifierReference' && callback.name !== 'undefined'
            && definitions.get(callback.name)?.type !== 'FunctionDeclaration') return false;
      }
      return true;
    }
    if (node.type === 'CallExpression' && node.CallExpression.type === 'IdentifierReference'
        && node.CallExpression.name === 'String' && stringIsStable && !definitions.has('String')
        && intrinsicData(realm.GlobalObject, Value('String')) === realm.Intrinsics['%String%']) {
      return node.Arguments.every((arg) => ['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(arg.type)
        || (arg.type === 'MemberExpression' && arg.IdentifierName?.name === 'length' && fresh(arg.MemberExpression)));
    }
    return false;
  };
  // Constructors and other calls can invoke iterators or conversions whose
  // effects are absent from this syntax. Admit only this method subset and
  // primitive String conversions; callback bodies are screened separately.
  const declarationOf = (name: string): ParseNode | null | undefined => {
    if (!definitions.has(name)) return undefined;
    return ambiguous.has(name) || written.has(name) ? null : definitions.get(name);
  };
  const isGlobalIntrinsic = (name: string): boolean => !definitions.has(name) && !written.has(name)
    && !realm.GlobalEnv.DeclarativeRecord.bindings.has(Value(name))
    && intrinsicData(realm.GlobalObject, Value(name)) === (realm.Intrinsics as unknown as Record<string, Value>)[`%${name}%`];
  const scalarInput = (argument: ParseNode): boolean => literalInput(argument) && unwrap(argument).type !== 'ArrayLiteral';
  for (const node of nodes) {
    if (node.type === 'NewExpression' && !EffectFreeConstruction(node, declarationOf, isGlobalIntrinsic, scalarInput)) return result;
    if (node.type !== 'CallExpression' || safe(node)) continue;
    if (node.CallExpression.type !== 'MemberExpression' || !safe(node.CallExpression)) return result;
    if (!node.Arguments.every((argument) => literalInput(argument)
      || argument.type === 'ArrowFunction' || argument.type === 'FunctionExpression'
      || (argument.type === 'IdentifierReference' && definitions.get(argument.name)?.type === 'FunctionDeclaration'))) return result;
  }
  if (!intrinsicSourceIsStable(root, realm, safe)) return result;
  for (const node of nodes) {
    if (node.type !== 'MemberExpression' || !safe(node)) continue;
    let enclosed = false;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (/Function|Arrow|Method|Class/.test(parent.type)) {
        enclosed = true;
        break;
      }
    }
    if (enclosed) continue;
    const receiver = unwrap(node.MemberExpression);
    if (receiver.type !== 'IdentifierReference') continue;
    const declaration = definitions.get(receiver.name);
    // Untyped JavaScript arrays do not acquire a homogeneous element contract
    // merely because their initial elements happen to share a type.
    if (declaration?.type === 'LexicalBinding' && declaration.TypeAnnotation) result.add(node);
  }
  return result;
}
