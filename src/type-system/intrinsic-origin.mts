import { ObjectValue, Value, type JSStringValue, type SymbolValue } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { Realm } from '../execution-context/Realm.mts';
import { ResolveBindingDeclaration } from './compile-time-evaluability.mts';

/** Read engine-owned data without invoking an accessor or exotic operation. */
export function intrinsicData(object: Value, key: JSStringValue | SymbolValue): Value | undefined {
  if (!(object instanceof ObjectValue) || object.Get !== ObjectValue.prototype.Get) return undefined;
  return object.properties.get(key)?.Value;
}

const FUNCTION_DECLARATION_TYPES = new Set(['FunctionDeclaration', 'GeneratorDeclaration', 'AsyncFunctionDeclaration', 'AsyncGeneratorDeclaration']);
const PARAMETER_KEYS = ['FormalParameters', 'ArrowParameters', 'UniqueFormalParameters', 'PropertySetParameterList'] as const;
/**
 * Primitive type names whose built-in operations run no user code: an operand
 * of one of these meeting another of the SAME name is the intrinsic operation
 * and nothing a `primitive` block can replace, #sec-primitive-operator-
 * declarations refusing a block whose operand is "the receiver's own type
 * without metadata".
 */
const PLAIN_PRIMITIVE_NAMES = new Set(['uint8', 'uint16', 'uint32', 'uint64', 'int8', 'int16', 'int32', 'int64', 'uint', 'int',
  'float16', 'float32', 'float64', 'number', 'bigint', 'string', 'boolean', 'undefined']);
const SKIP_KEYS = new Set(['parent', 'location', 'sourceText', 'strict']);

type AnyNode = ParseNode & Record<string, unknown> & { type: string };
const isNode = (value: unknown): value is AnyNode => !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
const isFunctionLike = (node: AnyNode): boolean => PARAMETER_KEYS.some((key) => key in node);

/** The node-valued children of a node, in field order; the operands of a binary form. */
function childNodes(node: ParseNode): ParseNode[] {
  const out: ParseNode[] = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (isNode(value)) out.push(value);
  }
  return out;
}

/**
 * A deliberately bounded effect screen for intrinsic-origin proofs. Inspect
 * local function/class bodies, but never execute them. Unknown calls, property
 * reads, reflective writes, eval, imports, and dynamic lookup can replace a
 * dependency and therefore defeat this proof. This is not an IC guard: a
 * run-time guard could not justify an irrevocable Early Error.
 *
 * The screen is bounded in two further ways (Round 1 of the early-error
 * survey, Q4), each a consequence of what the proof is FOR. #sec-typed-promise-
 * executors: the proof defers "where user code ... may replace the constructor
 * BEFORE THE SELECTED CONSTRUCTION", so with _at_ given, only what can run
 * before it counts: the top-level statements up to and including its own, and
 * a hoisted function's body only where a counted region names the function.
 * And an operation whose every operand is a literal or a binding of one plain
 * primitive type runs no user code - #sec-primitive-operator-declarations
 * refuses a block for a type's own pair - so it does not count either; before
 * this, `q + q` at `uint8` anywhere in a file stood every proof in it down.
 */
export function intrinsicSourceIsStable(root: ParseNode, realm: Realm, safeNode: (node: ParseNode) => boolean = () => false, at?: ParseNode): boolean {
  const nodes: ParseNode[] = [];
  /** The top-level item a node lies in, and the hoisted function declarations it lies inside. */
  const placement = new Map<ParseNode, { item: number, declarations: readonly ParseNode[] }>();
  const visit = (value: unknown, item: number, declarations: readonly ParseNode[]): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, item, declarations));
      return;
    }
    const node = value as ParseNode;
    if (typeof node.type !== 'string') return;
    nodes.push(node);
    placement.set(node, { item, declarations });
    const inner = FUNCTION_DECLARATION_TYPES.has(node.type) ? [...declarations, node] : declarations;
    for (const key of Object.keys(node)) {
      if (!SKIP_KEYS.has(key)) visit((node as unknown as Record<string, unknown>)[key], item, inner);
    }
  };
  const body = (root as { ScriptBody?: { StatementList?: readonly ParseNode[] } | null, ModuleBody?: { ModuleItemList?: readonly ParseNode[] } | null });
  const items: readonly ParseNode[] = body.ScriptBody?.StatementList ?? body.ModuleBody?.ModuleItemList ?? [];
  if (items.length > 0) {
    nodes.push(root);
    placement.set(root, { item: -1, declarations: [] });
    items.forEach((item, index) => visit(item, index, []));
  } else {
    visit(root, 0, []);
  }
  const unwrap = (node: ParseNode): ParseNode => {
    while (node.type === 'ParenthesizedExpression' || node.type === 'TypeArgumentsExpression') node = node.Expression;
    return node;
  };
  const definitions = new Map<string, ParseNode>();
  const functionDeclarations = new Map<string, ParseNode[]>();
  const ambiguous = new Set<string>();
  const mutated = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'BindingIdentifier') {
      if (definitions.has(node.name)) ambiguous.add(node.name);
      if (node.parent) definitions.set(node.name, node.parent);
      if (node.parent && FUNCTION_DECLARATION_TYPES.has(node.parent.type)) {
        functionDeclarations.set(node.name, [...(functionDeclarations.get(node.name) ?? []), node.parent]);
      }
    }
    if (node.type === 'AssignmentExpression' && node.LeftHandSideExpression.type === 'IdentifierReference') {
      mutated.add(node.LeftHandSideExpression.name);
    }
    if (node.type === 'UpdateExpression') {
      const target = unwrap(node.LeftHandSideExpression ?? node.UnaryExpression!);
      if (target.type === 'IdentifierReference') mutated.add(target.name);
    }
  }

  // ---- the evaluation prefix ----------------------------------------------
  // What can run before _at_: with no _at_, everything, as before. Otherwise
  // the top-level items up to _at_'s own (every item, where _at_ is inside a
  // function, since that function may be invoked from anywhere), and a
  // hoisted function declaration's body only once a counted region refers to
  // the function by name - to a fixpoint, since one function may name another.
  const atPlacement = at ? placement.get(at) : undefined;
  let atInsideFunction = false;
  if (at && atPlacement) {
    for (let n = at.parent as AnyNode | undefined; n; n = n.parent as AnyNode | undefined) {
      if (isFunctionLike(n) || n.type === 'ClassStaticBlock' || n.type === 'FieldDefinition' || n.type === 'MethodDefinition') {
        atInsideFunction = true;
        break;
      }
    }
  }
  const reachable = new Set<ParseNode>(atPlacement?.declarations ?? []);
  const counts = (node: ParseNode): boolean => {
    if (!atPlacement) return true;
    const where = placement.get(node);
    if (!where) return true;
    if (!atInsideFunction && where.item > atPlacement.item) return false;
    return where.declarations.every((d) => reachable.has(d));
  };
  if (atPlacement) {
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of nodes) {
        if (node.type !== 'IdentifierReference' || node.parent?.type === 'TypeName' || !counts(node)) continue;
        for (const declaration of functionDeclarations.get(node.name) ?? []) {
          if (!reachable.has(declaration)) {
            reachable.add(declaration);
            grew = true;
          }
        }
      }
    }
  }

  // ---- operands that run no user code ---------------------------------------
  /** The declared type annotation of the binding a reference resolves to, read syntactically. */
  const annotationOf = (reference: ParseNode & { name: string }): ParseNode | null => {
    const declaration = ResolveBindingDeclaration(reference, reference.name);
    if (!declaration) return null;
    const annotation = (n: unknown): ParseNode | null => (isNode(n) ? ((n.TypeAnnotation as { Type?: ParseNode } | null | undefined)?.Type ?? null) : null);
    switch (declaration.kind) {
      case 'let':
      case 'const': {
        // A `for` head resolves to the LexicalDeclaration; a body binding to
        // the LexicalBinding itself.
        const list = (declaration.node as AnyNode).BindingList;
        if (Array.isArray(list)) {
          for (const binding of list) {
            if (isNode(binding) && (binding.BindingIdentifier as { name?: string } | undefined)?.name === reference.name) return annotation(binding);
          }
          return null;
        }
        return annotation(declaration.node);
      }
      case 'var': {
        const list = ((declaration.node as AnyNode).VariableDeclarationList ?? [declaration.node]) as unknown;
        for (const d of Array.isArray(list) ? list : [list]) {
          if (isNode(d) && (d.BindingIdentifier as { name?: string } | undefined)?.name === reference.name) return annotation(d);
        }
        return null;
      }
      case 'parameter': {
        for (const key of PARAMETER_KEYS) {
          const params = (declaration.node as AnyNode)[key];
          for (const param of Array.isArray(params) ? params : []) {
            if (isNode(param) && param.type === 'SingleNameBinding' && (param.BindingIdentifier as { name?: string }).name === reference.name) return annotation(param);
          }
        }
        return null;
      }
      default:
        return null;
    }
  };
  /** The plain primitive name a type annotation denotes, or null. A shadowed type name is not the primitive. */
  const plainPrimitiveName = (type: ParseNode | null): string | null => {
    if (!type) return null;
    if (type.type === 'PredefinedType') return (type as { keyword?: string }).keyword === 'null' ? 'null' : null;
    if (type.type !== 'TypeReference') return null;
    const name = (type as AnyNode).TypeName as { IdentifierReference?: { name?: string }, MemberNames?: readonly unknown[] } | undefined;
    const id = name?.IdentifierReference?.name;
    if (!id || (name?.MemberNames?.length ?? 0) > 0 || !PLAIN_PRIMITIVE_NAMES.has(id) || definitions.has(id)) return null;
    const args = (type as AnyNode).TypeArguments;
    // A width argument names a member of the integer family; any other
    // argument is a parameterization, a type of its own, which a block may
    // define an operation for.
    if (args && id !== 'uint' && id !== 'int') return null;
    return id;
  };
  /**
   * The plain primitive type an expression is known to be, or null: a literal
   * (which adopts its partner's type), a binding annotated with one, an explicit
   * conversion to one, or a built-in operation over such operands.
   */
  const primitiveOf = (expression: ParseNode, depth = 0): string | 'literal' | null => {
    if (depth > 64) return null;
    const e = unwrap(expression) as AnyNode;
    switch (e.type) {
      case 'NumericLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
      case 'NullLiteral':
        return 'literal';
      case 'IdentifierReference':
        return plainPrimitiveName(annotationOf(e as ParseNode & { name: string }));
      case 'TypedConversionExpression':
        return primitiveOf(e.Expression as ParseNode, depth + 1) === null ? null : plainPrimitiveName(e.Type as ParseNode);
      case 'UnaryExpression':
        if (['!', 'typeof', 'void'].includes(e.operator as string)) return primitiveOf(e.UnaryExpression as ParseNode, depth + 1) === null ? null : 'literal';
        if (['+', '-', '~'].includes(e.operator as string)) return primitiveOf(e.UnaryExpression as ParseNode, depth + 1);
        return null;
      case 'AdditiveExpression':
      case 'MultiplicativeExpression':
      case 'ExponentiationExpression':
      case 'ShiftExpression':
      case 'BitwiseANDExpression':
      case 'BitwiseXORExpression':
      case 'BitwiseORExpression':
      case 'RelationalExpression':
      case 'EqualityExpression':
        return operandsOf(e, depth + 1);
      default:
        return null;
    }
  };
  /**
   * The one plain primitive type a built-in operation's operands share, `literal`
   * where every operand is a literal, or null where an operand is unknown or two
   * operands are of different types - a pair a `primitive` block may define.
   */
  const operandsOf = (node: AnyNode, depth = 0): string | 'literal' | null => {
    if (node.type === 'RelationalExpression' && (node.operator === 'in' || node.operator === 'instanceof')) return null;
    let found: string | 'literal' | null = 'literal';
    for (const operand of childNodes(node)) {
      const kind = primitiveOf(operand, depth);
      if (kind === null) return null;
      if (kind === 'literal') continue;
      if (found !== 'literal' && found !== kind) return null;
      found = kind;
    }
    return found;
  };
  const arrayOrStringBinding = (expression: ParseNode): 'array' | 'string' | null => {
    const e = unwrap(expression);
    if (e.type !== 'IdentifierReference') return null;
    const annotation = annotationOf(e);
    if (!annotation) return null;
    if (annotation.type === 'ArrayType' || annotation.type === 'TupleType') return 'array';
    return plainPrimitiveName(annotation) === 'string' ? 'string' : null;
  };

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
    if (safeNode(node)) return true;
    if (node.type === 'IdentifierReference') {
      if (localFunction(node.name)) return true;
      if (node.name === 'Symbol' && expression.parent?.type === 'CallExpression'
          && expression.parent.Arguments.length === 0) return intrinsicName('Symbol');
      // These operations cannot invoke a user conversion in the literal-only
      // subset below. Other builtins are deliberately outside the effect model.
      // The weak collections join Map and Set: seeding one runs the intrinsic
      // adder, whose identity the seed judgment establishes separately, and a
      // weak insertion runs no user code.
      if (['Proxy', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry', 'Uint8Array'].includes(node.name)) return intrinsicName(node.name);
      // The primitive wrappers called on primitive operands convert without
      // consulting user code: `String(q)` at `uint8` is ToString of a number.
      if (['String', 'Number', 'Boolean', 'BigInt'].includes(node.name) && expression.parent?.type === 'CallExpression'
          && expression.parent.CallExpression === expression
          && expression.parent.Arguments.every((argument) => argument.type !== 'AssignmentRestElement' && argument.type !== 'NamedArgument' && primitiveOf(argument) !== null)) {
        return intrinsicName(node.name);
      }
      // A const alias is safe only when its initializer also has a known origin.
      const declaration = definitions.get(node.name);
      if (!ambiguous.has(node.name) && !mutated.has(node.name) && declaration?.type === 'LexicalBinding'
          && declaration.parent?.type === 'LexicalDeclaration' && declaration.parent.LetOrConst === 'const'
          && declaration.Initializer) {
        const value = unwrap(declaration.Initializer);
        return value.type === 'IdentifierReference' && ['Proxy', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry'].includes(value.name) && intrinsicName(value.name);
      }
      return false;
    }
    return node.type === 'MemberExpression' && node.IdentifierName?.name === 'revocable'
      && unwrap(node.MemberExpression).type === 'IdentifierReference'
      && (unwrap(node.MemberExpression) as ParseNode.IdentifierReference).name === 'Proxy' && intrinsicName('Proxy');
  };
  for (const node of nodes) {
    if (safeNode(node)) continue;
    // An import runs before anything in the module, wherever it is written;
    // everything else is an effect at its own position, so it counts only
    // where it can run before the construction.
    if (node.type === 'ImportDeclaration' || node.type === 'WithStatement') return false;
    if (!counts(node)) continue;
    // A bare free name can itself select a global getter. Type-name syntax
    // follows its separate resolution rules; value reads need a data origin.
    if (node.type === 'IdentifierReference' && node.parent?.type !== 'TypeName'
        && !definitions.has(node.name) && intrinsicData(realm.GlobalObject, Value(node.name)) === undefined) return false;
    if (['ImportCall', 'TaggedTemplateExpression', 'OptionalExpression', 'SuperCall'].includes(node.type)
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
          && !['Proxy', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry', 'Array', 'globalThis'].includes(key)
          && intrinsicData(realm.GlobalObject, Value(key)) !== undefined) continue;
      if (!write && key === 'revocable' && base.type === 'IdentifierReference' && base.name === 'Proxy'
          && parent?.type === 'CallExpression' && parent.CallExpression === node) continue;
      // `xs.length` at an array or a string, and `xs[i]` at an array with a
      // primitive index, read own storage: no accessor can sit on either.
      const container = write ? null : arrayOrStringBinding(node.MemberExpression);
      if (container !== null && key === 'length' && parent?.type !== 'UpdateExpression') continue;
      if (container === 'array' && key === undefined && node.Expression && primitiveOf(node.Expression) !== null
          && parent?.type !== 'UpdateExpression') continue;
      return false;
    }
    // Coercions and accessors are not evaluated by this bounded effect model.
    // Even an unused overloaded/coercive expression could invoke a hook that
    // replaces an intrinsic when its enclosing function runs - unless every
    // operand is a literal or a binding of one plain primitive type, whose
    // built-in operation no block can replace and no conversion enters.
    if (['AdditiveExpression', 'MultiplicativeExpression', 'ExponentiationExpression',
      'RelationalExpression', 'EqualityExpression', 'ShiftExpression',
      'BitwiseANDExpression', 'BitwiseXORExpression', 'BitwiseORExpression'].includes(node.type)) {
      if (node.type === 'EqualityExpression' && ((node as AnyNode).operator === '===' || (node as AnyNode).operator === '!==')) continue;
      if (operandsOf(node as AnyNode) === null) return false;
      continue;
    }
    if (node.type === 'AssignmentExpression' && node.AssignmentOperator !== '=' && !['&&=', '||=', '??='].includes(node.AssignmentOperator)) {
      const target = unwrap(node.LeftHandSideExpression);
      if (target.type !== 'IdentifierReference' || primitiveOf(target) === null || primitiveOf(node.AssignmentExpression) === null) return false;
      continue;
    }
    if (node.type === 'UpdateExpression') {
      const target = unwrap(node.LeftHandSideExpression ?? node.UnaryExpression!);
      if (target.type !== 'IdentifierReference' || primitiveOf(target) === null) return false;
      continue;
    }
    if (['ForOfStatement', 'ForAwaitStatement', 'ObjectBindingPattern', 'ArrayBindingPattern'].includes(node.type)) return false;
    if (node.type === 'UnaryExpression' && !(node.UnaryExpression?.type === 'NumericLiteral'
        && ['+', '-'].includes(node.operator)) && primitiveOf(node) === null) return false;
    if (node.type === 'PropertyName' && node.ComputedPropertyName
        && !['StringLiteral', 'NumericLiteral'].includes(node.ComputedPropertyName.type)) return false;
    if (node.type === 'SpreadElement' || node.type === 'AssignmentRestElement'
        || node.type === 'AwaitExpression' || node.type === 'YieldExpression') return false;
  }
  return true;
}

/**
 * #sec-function-types: "a mutable origin is usable only while replacement is
 * excluded; assignments, including assignment patterns and captured writes,
 * and direct eval withdraw an otherwise unproved origin." The names _node_
 * writes, whether plainly, by update, through a destructuring assignment
 * pattern or as a `for`-`in`/`of` target. A pattern contributes every name in
 * it, which over-approximates and so only withdraws origins.
 */
export function AddWrittenNames(node: ParseNode, into: Set<string>): void {
  const unwrap = (n: ParseNode): ParseNode => (n.type === 'ParenthesizedExpression' ? unwrap(n.Expression) : n);
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const n = value as ParseNode;
    if (n.type === 'IdentifierReference') into.add(n.name);
    for (const [key, child] of Object.entries(n)) {
      if (!['parent', 'location', 'sourceText'].includes(key)) collect(child);
    }
  };
  let target: ParseNode | null | undefined = null;
  if (node.type === 'AssignmentExpression') target = unwrap(node.LeftHandSideExpression);
  else if (node.type === 'UpdateExpression') target = unwrap(node.LeftHandSideExpression ?? node.UnaryExpression!);
  else if (node.type === 'ForInStatement' || node.type === 'ForOfStatement' || node.type === 'ForAwaitStatement') {
    target = (node as { LeftHandSideExpression?: ParseNode }).LeftHandSideExpression;
  }
  if (!target) return;
  if (target.type === 'IdentifierReference') into.add(target.name);
  else if (target.type === 'ArrayLiteral' || target.type === 'ObjectLiteral') collect(target);
}

/** A direct `eval` call, which may write any binding in scope. */
export function IsDirectEvalCall(node: ParseNode): boolean {
  return node.type === 'CallExpression' && node.CallExpression.type === 'IdentifierReference'
    && node.CallExpression.name === 'eval';
}

/** Predefined types whose default value is a primitive, created without user code. */
const PRIMITIVE_DEFAULT_TYPES = new Set(['number', 'string', 'boolean', 'bigint',
  'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64',
  'float16', 'float32', 'float64', 'float128', 'decimal32', 'decimal64', 'decimal128']);

/**
 * #sec-proved-library-operations: whether evaluating the `new` expression _node_
 * runs no user code, so a proof may stand after it. Two constructions qualify:
 *
 * - An intrinsic `Map` or `Set` constructed with no arguments, whose binding is
 *   the realm's original (_isGlobalIntrinsic_): with no iterable it looks up
 *   no adder and calls nothing.
 * - A class declared in the source (_declarationOf_ yields its one, unwritten
 *   declaration) that has no type parameters, heritage, decorators or
 *   constructor, and whose instance fields are initialized by a scalar or take
 *   a primitive default, constructed with scalar arguments. Its methods do not
 *   run, and what its static elements or computed keys run is screened where
 *   they are written.
 *
 * Anything else - a function constructor, a class with a body of its own - is
 * treated as able to run user code.
 */
export function EffectFreeConstruction(
  node: ParseNode,
  declarationOf: (name: string) => ParseNode | null | undefined,
  isGlobalIntrinsic: (name: string) => boolean,
  scalar: (argument: ParseNode) => boolean,
): boolean {
  if (node.type !== 'NewExpression') return false;
  const args = (node.Arguments ?? []) as readonly ParseNode[];
  let callee = node.MemberExpression as ParseNode;
  while (callee.type === 'ParenthesizedExpression') callee = callee.Expression;
  if (callee.type === 'TypeArgumentsExpression') callee = callee.Expression;
  if (callee.type !== 'IdentifierReference') return false;
  // *undefined*: nothing in the source declares the name; *null*: it is
  // declared, but more than once or written, so it is neither kind here.
  const declaration = declarationOf(callee.name);
  if (declaration === null) return false;
  if (declaration === undefined) return ['Map', 'Set'].includes(callee.name) && args.length === 0 && isGlobalIntrinsic(callee.name);
  if (declaration.type !== 'ClassDeclaration' || declaration.Decorators?.length || declaration.TypeParameters
      || declaration.ClassTail.ClassHeritage || !args.every(scalar)) return false;
  return (declaration.ClassTail.ClassBody ?? []).every((element) => {
    const named = element as ParseNode & { ClassElementName?: ParseNode, static?: boolean };
    if (element.type !== 'FieldDefinition') {
      // A method, accessor or static block does not run at construction; the
      // constructor does, so a class declaring one is not screened here.
      return !(named.ClassElementName?.type === 'IdentifierName' && named.ClassElementName.name === 'constructor' && !named.static);
    }
    const field = element as ParseNode.FieldDefinition;
    if (field.static) return true;
    if (field.Decorators?.length || field.ClassElementName.type === 'PropertyName') return false;
    if (field.Initializer) return scalar(field.Initializer as unknown as ParseNode);
    const annotated = field.TypeAnnotation?.Type;
    return !annotated || (annotated.type === 'TypeReference' && !annotated.TypeArguments
      && annotated.TypeName.MemberNames.length === 0 && PRIMITIVE_DEFAULT_TYPES.has(annotated.TypeName.IdentifierReference.name)
      && declarationOf(annotated.TypeName.IdentifierReference.name) === undefined);
  });
}
