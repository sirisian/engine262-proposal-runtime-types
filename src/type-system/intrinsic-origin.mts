import { ObjectValue, Value, type JSStringValue, type SymbolValue } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { Realm } from '../execution-context/Realm.mts';

/** Read engine-owned data without invoking an accessor or exotic operation. */
export function intrinsicData(object: Value, key: JSStringValue | SymbolValue): Value | undefined {
  if (!(object instanceof ObjectValue) || object.Get !== ObjectValue.prototype.Get) return undefined;
  return object.properties.get(key)?.Value;
}

/**
 * A deliberately bounded effect screen for intrinsic-origin proofs. Inspect
 * local function/class bodies, but never execute them. Unknown calls, property
 * reads, reflective writes, eval, imports, and dynamic lookup can replace a
 * dependency and therefore defeat this proof. This is not an IC guard: a
 * run-time guard could not justify an irrevocable Early Error.
 */
export function intrinsicSourceIsStable(root: ParseNode, realm: Realm): boolean {
  const nodes: ParseNode[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as ParseNode;
    if (typeof node.type !== 'string') return;
    nodes.push(node);
    for (const key of Object.keys(node)) {
      if (!['parent', 'location', 'sourceText'].includes(key)) visit((node as unknown as Record<string, unknown>)[key]);
    }
  };
  visit(root);
  const unwrap = (node: ParseNode): ParseNode => {
    while (node.type === 'ParenthesizedExpression' || node.type === 'TypeArgumentsExpression') node = node.Expression;
    return node;
  };
  const definitions = new Map<string, ParseNode>();
  const ambiguous = new Set<string>();
  const mutated = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'BindingIdentifier') {
      if (definitions.has(node.name)) ambiguous.add(node.name);
      if (node.parent) definitions.set(node.name, node.parent);
    }
    if (node.type === 'AssignmentExpression' && node.LeftHandSideExpression.type === 'IdentifierReference') {
      mutated.add(node.LeftHandSideExpression.name);
    }
    if (node.type === 'UpdateExpression') {
      const target = unwrap(node.LeftHandSideExpression ?? node.UnaryExpression!);
      if (target.type === 'IdentifierReference') mutated.add(target.name);
    }
  }
  const localFunction = (name: string): boolean => {
    const declaration = definitions.get(name);
    return !ambiguous.has(name) && !mutated.has(name) && !!declaration
      && ['FunctionDeclaration', 'GeneratorDeclaration', 'AsyncFunctionDeclaration', 'AsyncGeneratorDeclaration', 'ClassDeclaration'].includes(declaration.type);
  };
  const intrinsicName = (name: string): boolean => {
    if (definitions.has(name) || mutated.has(name) || realm.GlobalEnv.DeclarativeRecord.bindings.has(Value(name))) return false;
    const intrinsic = (realm.Intrinsics as unknown as Record<string, ObjectValue | undefined>)[`%${name}%`];
    return !!intrinsic && intrinsicData(realm.GlobalObject, Value(name)) === intrinsic;
  };
  const callTarget = (expression: ParseNode): boolean => {
    const node = unwrap(expression);
    if (node.type === 'IdentifierReference') {
      if (localFunction(node.name)) return true;
      if (node.name === 'Symbol' && expression.parent?.type === 'CallExpression'
          && expression.parent.Arguments.length === 0) return intrinsicName('Symbol');
      // These operations cannot invoke a user conversion in the literal-only
      // subset below. Other builtins are deliberately outside the effect model.
      if (['Proxy', 'Map', 'Set', 'Uint8Array'].includes(node.name)) return intrinsicName(node.name);
      // A const alias is safe only when its initializer also has a known origin.
      const declaration = definitions.get(node.name);
      if (!ambiguous.has(node.name) && !mutated.has(node.name) && declaration?.type === 'LexicalBinding'
          && declaration.parent?.type === 'LexicalDeclaration' && declaration.parent.LetOrConst === 'const'
          && declaration.Initializer) {
        const value = unwrap(declaration.Initializer);
        return value.type === 'IdentifierReference' && ['Proxy', 'Map', 'Set'].includes(value.name) && intrinsicName(value.name);
      }
      return false;
    }
    return node.type === 'MemberExpression' && node.IdentifierName?.name === 'revocable'
      && unwrap(node.MemberExpression).type === 'IdentifierReference'
      && (unwrap(node.MemberExpression) as ParseNode.IdentifierReference).name === 'Proxy' && intrinsicName('Proxy');
  };
  for (const node of nodes) {
    // A bare free name can itself select a global getter. Type-name syntax
    // follows its separate resolution rules; value reads need a data origin.
    if (node.type === 'IdentifierReference' && node.parent?.type !== 'TypeName'
        && !definitions.has(node.name) && intrinsicData(realm.GlobalObject, Value(node.name)) === undefined) return false;
    if (['WithStatement', 'ImportDeclaration', 'ImportCall', 'TaggedTemplateExpression', 'OptionalExpression', 'SuperCall'].includes(node.type)
        || (node as { Decorators?: unknown[] }).Decorators?.length) return false;
    if (node.type === 'CallExpression' && !callTarget(node.CallExpression)) return false;
    if (node.type === 'NewExpression' && !callTarget(node.MemberExpression)) return false;
    if (node.type === 'MemberExpression') {
      const base = unwrap(node.MemberExpression);
      const key = node.IdentifierName?.name ?? (node.Expression?.type === 'StringLiteral' ? node.Expression.value : undefined);
      const parent = node.parent;
      const write = parent?.type === 'AssignmentExpression' && parent.LeftHandSideExpression === node;
      // Existing ordinary global data slots (including test effect markers)
      // may be assigned without running a setter. Any relevant global change,
      // unknown computed property, or prototype access stands the proof down.
      if (write && base.type === 'IdentifierReference' && base.name === 'globalThis' && key !== undefined
          && !definitions.has('globalThis') && !mutated.has('globalThis')
          && intrinsicData(realm.GlobalObject, Value('globalThis')) === realm.GlobalObject
          && !['Proxy', 'Map', 'Set', 'Array', 'globalThis'].includes(key)
          && intrinsicData(realm.GlobalObject, Value(key)) !== undefined) continue;
      if (!write && key === 'revocable' && base.type === 'IdentifierReference' && base.name === 'Proxy'
          && parent?.type === 'CallExpression' && parent.CallExpression === node) continue;
      return false;
    }
    // Coercions and accessors are not evaluated by this bounded effect model.
    // Even an unused overloaded/coercive expression could invoke a hook that
    // replaces an intrinsic when its enclosing function runs.
    if (['AdditiveExpression', 'MultiplicativeExpression', 'ExponentiationExpression',
      'RelationalExpression', 'EqualityExpression', 'ShiftExpression', 'UpdateExpression',
      'ForOfStatement', 'ForAwaitStatement', 'ObjectBindingPattern', 'ArrayBindingPattern'].includes(node.type)) return false;
    if (node.type === 'UnaryExpression' && !(node.UnaryExpression?.type === 'NumericLiteral'
        && ['+', '-'].includes(node.operator))) return false;
    if (node.type === 'PropertyName' && node.ComputedPropertyName
        && !['StringLiteral', 'NumericLiteral'].includes(node.ComputedPropertyName.type)) return false;
    if (node.type === 'SpreadElement' || node.type === 'AssignmentRestElement'
        || node.type === 'AwaitExpression' || node.type === 'YieldExpression') return false;
  }
  return true;
}
