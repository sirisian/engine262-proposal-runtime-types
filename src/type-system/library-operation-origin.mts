import { ObjectValue, Value, type Descriptor } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { Realm } from '../execution-context/Realm.mts';
import { AddWrittenNames, EffectFreeConstruction, IsDirectEvalCall, intrinsicData, intrinsicSourceIsStable } from './intrinsic-origin.mts';

const groups = {
  '%Function.prototype%': ['call', 'apply', 'bind', 'callThread'],
  '%Atomics%': ['load', 'store', 'exchange', 'compareExchange', 'add', 'sub', 'and', 'or', 'xor', 'wait', 'waitAsync', 'notify'],
  '%Object%': ['create', 'setPrototypeOf', 'is', 'assign', 'defineProperty', 'defineProperties', 'keys', 'values', 'entries', 'groupBy'],
  '%Array%': ['from', 'fromAsync', 'of'],
  '%Map%': ['groupBy'],
  '%Promise%': ['all', 'race', 'any', 'allSettled', 'resolve'],
  '%Reflect%': ['set', 'defineProperty', 'apply', 'construct'],
  '%TypedArrayLike.prototype%': ['capacity', 'set', 'window'],
  '%Span.prototype%': ['set'],
  '%String.prototype%': ['replace', 'replaceAll', 'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'localeCompare', 'concat', 'padStart', 'padEnd'],
  '%Array.prototype%': ['join', 'toString'],
  '%Map.prototype%': ['size'],
  '%Set.prototype%': ['size'],
};
const originals = new WeakMap<Realm, Map<string, Descriptor>>();

/** Capture identities at realm creation; property descriptors stay mutable. */
export function RememberLibraryOperations(realm: Realm): void {
  const saved = new Map<string, Descriptor>();
  for (const [group, keys] of Object.entries(groups)) {
    const object = (realm.Intrinsics as unknown as Record<string, ObjectValue>)[group];
    for (const key of keys) {
      const descriptor = object?.properties.get(Value(key));
      if (descriptor) saved.set(`${group}.${key}`, { ...descriptor } as Descriptor);
    }
  }
  originals.set(realm, saved);
}

/** Compare an actual data function with the identity captured at realm creation. */
export function OriginalLibraryFunction(realm: Realm, group: string, key: string): boolean {
  const object = (realm.Intrinsics as unknown as Record<string, ObjectValue>)[group];
  const before = originals.get(realm)?.get(`${group}.${key}`);
  return !!before?.Value && intrinsicData(object, Value(key)) === before.Value;
}

export interface LibraryOperation {
  readonly kind: 'descriptor' | 'adapter' | 'atomic' | 'write' | 'reflectApply' | 'reflectConstruct';
  readonly name: string;
  readonly target: ParseNode;
  readonly count?: number;
}

/**
 * #sec-proved-library-operations: prove selection and the relevant data effects,
 * never execute source or rely on a future identity guard. This intentionally
 * small source subset has fresh data, stable local functions and scalar inputs.
 */
export function ProvenLibraryOperations(root: ParseNode, realm: Realm, inertAnnotation: (node: ParseNode.TypeAnnotation) => boolean,
  typeObjectTarget: (node: ParseNode) => boolean = () => false): {
  members: ReadonlyMap<ParseNode, LibraryOperation>,
  data: (node: ParseNode) => ParseNode.ObjectLiteral | null,
  list: (node: ParseNode) => readonly ParseNode[] | null,
} {
  const nodes: ParseNode[] = [];
  const definitions = new Map<string, ParseNode[]>();
  const mutated = new Set<string>();
  let directEval = false;
  const unwrap = (node: ParseNode): ParseNode => node.type === 'ParenthesizedExpression' ? unwrap(node.Expression) : node;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const node = value as ParseNode;
    nodes.push(node);
    if (node.type === 'BindingIdentifier' && node.parent) {
      definitions.set(node.name, [...(definitions.get(node.name) ?? []), node.parent]);
    }
    AddWrittenNames(node, mutated);
    if (IsDirectEvalCall(node)) directEval = true;
    for (const [key, child] of Object.entries(node)) {
      if (!['parent', 'location', 'sourceText'].includes(key)) visit(child);
    }
  };
  visit(root);
  const topLevel = (node: ParseNode): boolean => {
    for (let p = node.parent; p; p = p.parent) {
      if (/Function|Arrow|Method|Class/.test(p.type)) return false;
    }
    return true;
  };
  const global = (name: string): boolean => !definitions.has(name) && !mutated.has(name)
    && !realm.GlobalEnv.DeclarativeRecord.bindings.has(Value(name))
    && intrinsicData(realm.GlobalObject, Value(name)) === (realm.Intrinsics as unknown as Record<string, Value>)[`%${name}%`];
  const original = (group: string, key: string): boolean => {
    const object = (realm.Intrinsics as unknown as Record<string, ObjectValue>)[group];
    const before = originals.get(realm)?.get(`${group}.${key}`);
    const now = object?.properties.get(Value(key));
    return !!before && !!now && object.Get === ObjectValue.prototype.Get
      && now.Value === before.Value && now.Getter === before.Getter && now.Setter === before.Setter;
  };
  const initializer = (node: ParseNode, seen: Set<ParseNode>): ParseNode => {
    node = unwrap(node);
    if (node.type !== 'IdentifierReference' || mutated.has(node.name) || seen.has(node)) return node;
    seen.add(node);
    const declarations = definitions.get(node.name);
    const declaration = declarations?.length === 1 ? declarations[0] : undefined;
    if (declaration?.type !== 'LexicalBinding' || !declaration.Initializer || !topLevel(declaration)) return node;
    // A direct eval may replace a `let` (#sec-function-types); a `const` it cannot.
    if (directEval && declaration.parent?.type === 'LexicalDeclaration' && declaration.parent.LetOrConst !== 'const') return node;
    return initializer(declaration.Initializer, seen);
  };
  const scalar = (expression: ParseNode, seen = new Set<ParseNode>()): boolean => {
    const node = initializer(expression, seen);
    if (['NumericLiteral', 'StringLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral'].includes(node.type)) return true;
    if (node.type === 'UnaryExpression' && ['+', '-'].includes(node.operator)) return node.UnaryExpression.type === 'NumericLiteral';
    return node.type === 'IdentifierReference' && node.name === 'undefined' && !definitions.has('undefined')
      && intrinsicData(realm.GlobalObject, Value('undefined')) === Value.undefined;
  };
  const propertyKey = (node: ParseNode.PropertyDefinition): string | null => {
    const key = node.PropertyName;
    if (key?.type === 'IdentifierName') return key.name;
    if (key?.type === 'StringLiteral' || key?.type === 'NumericLiteral') return String(key.value);
    return null;
  };
  const data = (expression: ParseNode): ParseNode.ObjectLiteral | null => {
    const node = initializer(expression, new Set());
    return node.type === 'ObjectLiteral' && node.PropertyDefinitionList.every((p) => p.type === 'PropertyDefinition'
      && propertyKey(p) !== null && propertyKey(p) !== '__proto__' && !!p.AssignmentExpression && scalar(p.AssignmentExpression)) ? node : null;
  };
  const list = (expression: ParseNode): readonly ParseNode[] | null => {
    const node = initializer(expression, new Set());
    if (unwrap(expression).type !== 'ArrayLiteral' && unwrap(expression).type !== 'ObjectLiteral') return null;
    if (node.type === 'ArrayLiteral') return node.ElementList.every((p) => !!p && scalar(p)) ? node.ElementList : null;
    if (unwrap(expression).type !== 'ObjectLiteral') return null;
    const object = data(node);
    if (!object || object.PropertyDefinitionList.some((p) => (p as ParseNode.PropertyDefinition).TypeAnnotation)) return null;
    const properties = new Map(object.PropertyDefinitionList.map((p) => [propertyKey(p as ParseNode.PropertyDefinition), (p as ParseNode.PropertyDefinition).AssignmentExpression!]));
    const length = properties.get('length');
    if (length?.type !== 'NumericLiteral' || typeof length.value !== 'number' || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > 256) return null;
    const entries: ParseNode[] = [];
    for (let i = 0; i < length.value; i += 1) {
      const entry = properties.get(String(i));
      if (!entry) return null;
      entries.push(entry);
    }
    return entries;
  };
  const localFunction = (expression: ParseNode): boolean => {
    const node = unwrap(expression);
    const declarations = node.type === 'IdentifierReference' && !mutated.has(node.name) ? definitions.get(node.name) : undefined;
    return !!declarations?.length && declarations.every((d) => d.type === 'FunctionDeclaration' && topLevel(d));
  };
  const localTarget = (expression: ParseNode): boolean => {
    const node = initializer(expression, new Set());
    if (['ArrowFunction', 'FunctionExpression', 'ClassExpression'].includes(node.type) || typeObjectTarget(node)) return true;
    const declarations = node.type === 'IdentifierReference' && !mutated.has(node.name) ? definitions.get(node.name) : undefined;
    return !!declarations?.length && declarations.every((d) => ['FunctionDeclaration', 'ClassDeclaration'].includes(d.type) && topLevel(d));
  };
  const scalarOrReference = (expression: ParseNode): boolean => scalar(expression)
    || (expression.type === 'RefExpression' && scalar(expression.Expression));
  const freshArray = (expression: ParseNode): ParseNode.ArrayLiteral | null => {
    const node = initializer(expression, new Set());
    return node.type === 'ArrayLiteral' && node.ElementList.every((entry) => !!entry && scalar(entry)) ? node : null;
  };
  const safeExtraWrite = (key: string): boolean => {
    // A fresh ordinary object inherits no unexamined setter. Inspect ordinary
    // descriptors directly, including prior-script prototype changes.
    let object: Value = realm.Intrinsics['%Object.prototype%'];
    const seen = new Set<Value>();
    while (object instanceof ObjectValue && !seen.has(object)) {
      seen.add(object);
      if (object.Get !== ObjectValue.prototype.Get || object.Set !== ObjectValue.prototype.Set) return false;
      const desc = object.properties.get(Value(key));
      if (desc) return desc.Value !== undefined;
      object = (object as ObjectValue & { Prototype: Value }).Prototype;
    }
    return object === Value.null;
  };
  const candidates = new Map<ParseNode, LibraryOperation>();
  for (const node of nodes) {
    if (node.type !== 'MemberExpression' || !topLevel(node)) continue;
    const name = node.IdentifierName?.name ?? (node.Expression?.type === 'StringLiteral' ? node.Expression.value : null);
    if (!name) continue;
    const target = unwrap(node.MemberExpression);
    const call = node.parent?.type === 'CallExpression' && node.parent.CallExpression === node ? node.parent : null;
    if (['call', 'apply', 'bind', 'callThread'].includes(name) && call && localFunction(target)
        && original('%Function.prototype%', name)) {
      const args = call.Arguments;
      const suitable = name === 'apply' ? args.length === 2 && scalar(args[0]) && list(args[1]) !== null
        : args.every((arg, i) => scalarOrReference(arg) || (name === 'callThread' && i === 0 && data(arg)?.PropertyDefinitionList.length === 0));
      if (suitable) candidates.set(node, { kind: 'adapter', name, target });
    }
    if (call && target.type === 'IdentifierReference' && target.name === 'Reflect' && global('Reflect')
        && ['apply', 'construct'].includes(name) && original('%Reflect%', name)) {
      const args = call.Arguments;
      const suitable = name === 'apply' ? args.length === 3 && scalar(args[1]) && list(args[2]) !== null
        : args.length >= 2 && args.length <= 3 && list(args[1]) !== null
          && (!args[2] || localTarget(args[2]) || scalar(args[2]));
      if (suitable && (localTarget(args[0]) || scalar(args[0]))) {
        candidates.set(node, { kind: name === 'apply' ? 'reflectApply' : 'reflectConstruct', name, target: args[0] });
      }
    }
    if (call && target.type === 'IdentifierReference' && target.name === 'Atomics' && global('Atomics')
        && original('%Atomics%', name) && call.Arguments.every((arg, i) => scalarOrReference(arg) || (i === 0 && data(arg) !== null))) {
      candidates.set(node, { kind: 'atomic', name, target });
    }
    if (call && target.type === 'IdentifierReference' && global(target.name)
        && ((target.name === 'Object' && ['assign', 'defineProperty', 'defineProperties'].includes(name))
          || (target.name === 'Reflect' && ['set', 'defineProperty'].includes(name)))
        && original(`%${target.name}%`, name)) {
      const args = call.Arguments;
      const destination = args[0] && data(args[0]);
      if (!destination) continue;
      const own = new Set(destination.PropertyDefinitionList.map((p) => propertyKey(p as ParseNode.PropertyDefinition)));
      let suitable = false;
      if (name === 'assign') suitable = args.slice(1).every((arg) => {
        const source = unwrap(arg).type === 'ObjectLiteral' ? data(arg) : null;
        return !!source && source.PropertyDefinitionList.every((p) => {
          const key = propertyKey(p as ParseNode.PropertyDefinition)!;
          return own.has(key) || safeExtraWrite(key);
        });
      });
      if (name === 'set') suitable = args.length === 3 && args[1]?.type === 'StringLiteral' && own.has(args[1].value) && scalar(args[2]);
      const pureDescriptor = (expression: ParseNode): boolean => {
        const descriptor = data(expression);
        return !!descriptor && descriptor.PropertyDefinitionList.every((p) =>
          ['value', 'writable', 'configurable', 'enumerable'].includes(propertyKey(p as ParseNode.PropertyDefinition)!))
          && ['get', 'set', 'value', 'writable', 'configurable', 'enumerable'].every((key) => !realm.Intrinsics['%Object.prototype%'].properties.has(Value(key)));
      };
      if (name === 'defineProperty') {
        const descriptor = args[2] && data(args[2]);
        suitable = args.length === 3 && args[1]?.type === 'StringLiteral' && own.has(args[1].value)
          && !!descriptor && pureDescriptor(args[2]);
      }
      if (name === 'defineProperties') {
        const descriptors = args[1] && unwrap(args[1]);
        // ObjectDefineProperties converts the complete descriptor list before
        // attempting a write. A malformed or effectful descriptor defeats this
        // proof even if a different entry would have an incompatible value.
        suitable = args.length === 2 && descriptors?.type === 'ObjectLiteral'
          && descriptors.PropertyDefinitionList.every((p) => p.type === 'PropertyDefinition'
            && own.has(propertyKey(p)) && !!p.AssignmentExpression && pureDescriptor(p.AssignmentExpression));
      }
      if (suitable) candidates.set(node, { kind: 'write', name, target: args[0] });
    }
    if (name === 'capacity' && original('%TypedArrayLike.prototype%', name)) {
      const array = freshArray(target);
      const declaration = target.type === 'IdentifierReference' ? definitions.get(target.name) : undefined;
      if (array && declaration?.length === 1 && declaration[0].type === 'LexicalBinding' && declaration[0].TypeAnnotation) {
        candidates.set(node, { kind: 'descriptor', name, target, count: array.ElementList.length });
      }
    }
    if (name === 'size') {
      const created = initializer(target, new Set());
      let ctor = created.type === 'NewExpression' ? created.MemberExpression : null;
      if (ctor?.type === 'TypeArgumentsExpression') ctor = ctor.Expression;
      if (ctor?.type === 'IdentifierReference' && ['Map', 'Set'].includes(ctor.name) && global(ctor.name)
          && created.type === 'NewExpression' && !created.Arguments?.length && original(`%${ctor.name}.prototype%`, name)) {
        candidates.set(node, { kind: 'descriptor', name, target, count: 0 });
      }
    }
  }
  const boundCall = (node: ParseNode): boolean => {
    if (node.type !== 'CallExpression' || !node.Arguments.every(scalarOrReference)) return false;
    const bound = initializer(node.CallExpression, new Set());
    return bound.type === 'CallExpression' && candidates.get(bound.CallExpression)?.name === 'bind';
  };
  const safe = (node: ParseNode): boolean => candidates.has(node) || boundCall(node)
    || ((node.type === 'IdentifierReference' || node.type === 'TypeArgumentsExpression') && typeObjectTarget(node))
    || (node.type === 'CallExpression' && candidates.has(node.CallExpression))
    // A proven count getter and a scalar RHS cannot replace the descriptor
    // before this compound store. Unknown RHS effects still defeat the proof.
    || (node.type === 'AssignmentExpression' && scalar(node.AssignmentExpression)
      && candidates.get(unwrap(node.LeftHandSideExpression))?.kind === 'descriptor')
    || (node.type === 'UpdateExpression' && candidates.get(unwrap(node.LeftHandSideExpression ?? node.UnaryExpression!))?.kind === 'descriptor');
  const declarationOf = (name: string): ParseNode | null | undefined => {
    const declarations = definitions.get(name);
    if (!declarations) return undefined;
    return declarations.length === 1 && !mutated.has(name) ? declarations[0] : null;
  };
  const effectFreeNew = (node: ParseNode): boolean => EffectFreeConstruction(node, declarationOf, global, (argument) => scalar(argument));
  // Unknown calls, even into local code, may construct/convert values whose
  // effects are not modeled here. Only established adapters may enter bodies.
  let stable = !nodes.some((node) => {
    if (node.type === 'TypeAnnotation') return !inertAnnotation(node);
    if (node.type === 'LexicalBinding' && node.TypeAnnotation && node.Initializer) {
      const source = initializer(node.Initializer, new Set());
      if (!scalar(source) && !freshArray(source) && !data(source) && !localTarget(source) && !safe(source)
        && !effectFreeNew(source)) return true;
    }
    if (node.type === 'AssignmentExpression' && unwrap(node.LeftHandSideExpression).type === 'IdentifierReference'
        && !scalar(node.AssignmentExpression)) return true;
    if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && node.ClassTail.ClassHeritage) return true;
    if (node.type === 'AssignmentExpression' && node.LeftHandSideExpression.type === 'MemberExpression') {
      const member = node.LeftHandSideExpression;
      const key = member.IdentifierName?.name ?? (member.Expression?.type === 'StringLiteral' ? member.Expression.value : null);
      if (member.MemberExpression.type === 'IdentifierReference' && member.MemberExpression.name === 'globalThis'
          && ['Function', 'Object', 'Reflect', 'Atomics'].includes(key ?? '')) return true;
      if (candidates.get(member)?.kind === 'descriptor' && !scalar(node.AssignmentExpression)) return true;
    }
    if (node.type === 'CallExpression') return !safe(node);
    return node.type === 'NewExpression' && !effectFreeNew(node);
  });
  stable &&= intrinsicSourceIsStable(root, realm, safe);
  return { members: stable ? candidates : new Map(), data, list };
}
