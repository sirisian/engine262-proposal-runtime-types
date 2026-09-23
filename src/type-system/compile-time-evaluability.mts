import type { ParseNode } from '../parser/ParseNode.mts';
import { FreeReferences } from '../static-semantics/PreprocessorEvaluability.mts';
import { FirstNonEvaluableForm } from './evaluable-fragment.mts';

/**
 * proposal-runtime-types #sec-iscompiletimeevaluable, the BINDING half.
 *
 * `FirstNonEvaluableForm` is the syntactic floor: it rejects forms the fragment
 * excludes outright (`await`, `yield`, classes, `eval`, ...) and never looks at
 * what a name refers to. The operation the specification states is stricter:
 *
 *   If _expr_ is a reference to a binding, then
 *     If the binding is a parameter of the function under evaluation, or a
 *       local binding of that function, return *true*.
 *     If the binding is immutable and its initializer is compile-time
 *       evaluable, return *true*.
 *     If the binding is a value generic parameter or a type generic parameter,
 *       return *true*.
 *     If the binding is an enumerator of the enum under evaluation that is
 *       declared before the enumerator whose initializer is being evaluated,
 *       return *true*.
 *     Return *false*.
 *
 * and a call is evaluable only where its callee "denotes a compile-time-
 * evaluable function": one "whose body reads only its parameters, its own local
 * bindings, immutable bindings whose initializers are compile-time evaluable,
 * and other compile-time-evaluable functions".
 *
 * Without this, `let k = 5; type T = [uint8 = k];` was accepted and snapshotted
 * whatever `k` held when the declaration ran, and a default calling a function
 * that assigned module state ran that assignment once, at declaration.
 *
 * The judgment is LEXICAL and independent of when the checker's walk reaches
 * the declaration: a type default is resolved during the pre-scan, before the
 * walk has declared the bindings around it, so the frames cannot answer. Each
 * reference is resolved by climbing the Parse Node's parents to the scope that
 * declares it.
 *
 * What it leaves alone, deliberately:
 *   - a name no enclosing scope declares is a global, and whether a global
 *     built-in is in the fragment is the LIBRARY half of the annex, decided at
 *     the call by `fragment-library.mts` (`Math.max` is in, `Math.random` out);
 *   - a parameter of an enclosing function, a `catch` parameter and an import
 *     are not refused here. The first is the case the specification's
 *     "function under evaluation" is about, and refusing it needs the checker
 *     to know which function a type position is evaluated under; the last is
 *     immutable and its initializer lives in another source text.
 */

export type BindingDeclaration =
  | { readonly kind: 'const', readonly node: ParseNode, readonly initializer: ParseNode | null }
  | { readonly kind: 'function', readonly node: ParseNode }
  | { readonly kind: 'let' | 'var' | 'parameter' | 'catch' | 'import' | 'class' | 'type' | 'type-parameter', readonly node: ParseNode };

const FUNCTION_DECLARATIONS = new Set([
  'FunctionDeclaration', 'GeneratorDeclaration', 'AsyncFunctionDeclaration', 'AsyncGeneratorDeclaration',
]);
const TYPE_DECLARATIONS = new Set([
  'EnumDeclaration', 'TypeAliasDeclaration', 'InterfaceDeclaration', 'MetaDeclaration',
]);
const FOR_STATEMENTS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'ForAwaitStatement']);
const PARAMETER_KEYS = ['FormalParameters', 'ArrowParameters', 'UniqueFormalParameters', 'PropertySetParameterList'] as const;

const skipKey = (key: string) => key === 'parent' || key === 'location' || key === 'sourceText' || key === 'strict';

type AnyNode = ParseNode & Record<string, unknown> & { type: string, name?: string };

const isNode = (value: unknown): value is AnyNode => !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';

const isFunctionLike = (node: AnyNode): boolean => PARAMETER_KEYS.some((key) => key in node);

/** The names a binding target binds, without entering initializers or nested functions. */
function boundNamesOf(target: unknown, into: string[] = []): string[] {
  if (Array.isArray(target)) {
    target.forEach((t) => boundNamesOf(t, into));
    return into;
  }
  if (!isNode(target)) return into;
  if (target.type === 'BindingIdentifier' && typeof target.name === 'string') {
    into.push(target.name);
    return into;
  }
  if (isFunctionLike(target)) return into;
  for (const key of Object.keys(target)) {
    if (skipKey(key) || key === 'Initializer' || key === 'TypeAnnotation' || key === 'Decorators') continue;
    boundNamesOf(target[key], into);
  }
  return into;
}

function unwrapExport(item: AnyNode): AnyNode {
  if (item.type !== 'ExportDeclaration') return item;
  for (const key of ['Declaration', 'HoistableDeclaration', 'ClassDeclaration', 'VariableStatement']) {
    if (isNode(item[key])) return item[key] as AnyNode;
  }
  return item;
}

/** A declaration of _name_ among the items of one statement list. */
function declarationInList(items: readonly unknown[], name: string): BindingDeclaration | undefined {
  for (const raw of items) {
    if (!isNode(raw)) continue;
    const item = unwrapExport(raw);
    switch (item.type) {
      case 'LexicalDeclaration': {
        for (const binding of (item.BindingList as readonly AnyNode[] | undefined) ?? []) {
          if (!boundNamesOf(binding.BindingIdentifier ?? binding.BindingPattern).includes(name)) continue;
          if (item.LetOrConst === 'const') {
            return {
              kind: 'const',
              node: binding,
              initializer: binding.BindingIdentifier ? (binding.Initializer as ParseNode | null | undefined) ?? null : null,
            };
          }
          return { kind: 'let', node: binding };
        }
        break;
      }
      case 'VariableStatement':
        if (boundNamesOf(item.VariableDeclarationList).includes(name)) return { kind: 'var', node: item };
        break;
      case 'ClassDeclaration':
        if ((item.BindingIdentifier as { name?: string } | null)?.name === name) return { kind: 'class', node: item };
        break;
      case 'ImportDeclaration':
        if (boundNamesOf(item).includes(name)) return { kind: 'import', node: item };
        break;
      default:
        if (FUNCTION_DECLARATIONS.has(item.type) && (item.BindingIdentifier as { name?: string } | null)?.name === name) {
          return { kind: 'function', node: item };
        }
        if (TYPE_DECLARATIONS.has(item.type) && (item.BindingIdentifier as { name?: string } | null)?.name === name) {
          return { kind: 'type', node: item };
        }
    }
  }
  return undefined;
}

/** A `var` of _name_ anywhere in _root_ outside nested functions: the hoisted binding. */
function hoistedVarIn(root: unknown, name: string): AnyNode | undefined {
  if (Array.isArray(root)) {
    for (const r of root) {
      const found = hoistedVarIn(r, name);
      if (found) return found;
    }
    return undefined;
  }
  if (!isNode(root)) return undefined;
  if (isFunctionLike(root)) return undefined;
  if (root.type === 'VariableStatement' || root.type === 'VariableDeclaration') {
    if (boundNamesOf(root).includes(name)) return root;
  }
  if (FOR_STATEMENTS.has(root.type)) {
    if (isNode(root.VariableDeclarationList) || Array.isArray(root.VariableDeclarationList)) {
      if (boundNamesOf(root.VariableDeclarationList).includes(name)) return root;
    }
    if (isNode(root.ForBinding) && boundNamesOf(root.ForBinding).includes(name)) return root;
  }
  for (const key of Object.keys(root)) {
    if (skipKey(key)) continue;
    const found = hoistedVarIn(root[key], name);
    if (found) return found;
  }
  return undefined;
}

/**
 * The declaration a reference to _name_ at _reference_ resolves to, or
 * *undefined* where no enclosing scope declares it.
 */
export function ResolveBindingDeclaration(reference: ParseNode, name: string): BindingDeclaration | undefined {
  for (let at = (reference as { parent?: ParseNode }).parent as AnyNode | undefined; at; at = at.parent as AnyNode | undefined) {
    for (const key of Object.keys(at)) {
      if (skipKey(key)) continue;
      const value = at[key];
      if (Array.isArray(value) && value.some(isNode)) {
        const found = declarationInList(value, name);
        if (found) return found;
      }
    }
    const typeParameters = (at.TypeParameters as { TypeParameterList?: readonly AnyNode[] } | null | undefined)?.TypeParameterList;
    if (typeParameters?.some((tp) => (tp.BindingIdentifier as { name?: string } | undefined)?.name === name)) {
      return { kind: 'type-parameter', node: at };
    }
    if (isFunctionLike(at)) {
      for (const key of PARAMETER_KEYS) {
        if (key in at && boundNamesOf(at[key]).includes(name)) return { kind: 'parameter', node: at };
      }
      if ((at.type === 'FunctionExpression' || at.type === 'GeneratorExpression' || at.type === 'AsyncFunctionExpression'
        || at.type === 'AsyncGeneratorExpression') && (at.BindingIdentifier as { name?: string } | null)?.name === name) {
        return { kind: 'function', node: at };
      }
      const body = at.FunctionBody ?? at.ConciseBody ?? at.GeneratorBody ?? at.AsyncFunctionBody ?? at.AsyncGeneratorBody;
      const hoisted = hoistedVarIn(body, name);
      if (hoisted) return { kind: 'var', node: hoisted };
    }
    if (at.type === 'Catch' && isNode(at.CatchParameter) && boundNamesOf(at.CatchParameter).includes(name)) {
      return { kind: 'catch', node: at };
    }
    if (FOR_STATEMENTS.has(at.type)) {
      const head = at.LexicalDeclaration ?? at.ForDeclaration;
      if (isNode(head) && boundNamesOf(head).includes(name)) {
        return (head as AnyNode).LetOrConst === 'const' ? { kind: 'const', node: head, initializer: null } : { kind: 'let', node: head };
      }
    }
    if ((at.type === 'ClassExpression') && (at.BindingIdentifier as { name?: string } | null)?.name === name) {
      return { kind: 'class', node: at };
    }
    if (at.type === 'Script' || at.type === 'Module') {
      const hoisted = hoistedVarIn(at, name);
      if (hoisted) return { kind: 'var', node: hoisted };
    }
  }
  return undefined;
}

export interface EvaluabilityContext {
  /** Whether the source text assigns to _name_ anywhere; a reassigned function is not the one read. */
  readonly assigned: (name: string) => boolean;
}

const IN_PROGRESS = Symbol('in progress');

/**
 * The first reason _expr_ is not compile-time evaluable, phrased to complete
 * "... must be compile-time evaluable, and $1 is not", or *undefined*.
 *
 * _bound_ names bindings the caller supplies - the earlier enumerators of the
 * enum under evaluation. Judgments of a `const` initializer and of a function
 * body are memoized per declaration; a function being judged is assumed
 * evaluable while its own body is judged, so recursion terminates and a
 * recursive builder is judged by what it reads.
 */
export function CompileTimeEvaluabilityChecker(context: EvaluabilityContext) {
  const memo = new Map<object, string | undefined | typeof IN_PROGRESS>();
  const judged = (key: object, compute: () => string | undefined): string | undefined => {
    const prior = memo.get(key);
    if (prior === IN_PROGRESS) return undefined;
    if (memo.has(key)) return prior as string | undefined;
    memo.set(key, IN_PROGRESS);
    const result = compute();
    memo.set(key, result);
    return result;
  };
  const violation = (expr: ParseNode, bound: ReadonlySet<string> = new Set()): string | undefined => {
    const floor = FirstNonEvaluableForm(expr);
    if (floor !== undefined) return floor;
    for (const reference of FreeReferences(expr)) {
      const name = reference.name;
      if (bound.has(name)) continue;
      const declaration = ResolveBindingDeclaration(reference, name);
      if (!declaration) continue;
      switch (declaration.kind) {
        case 'let':
        case 'var':
          return `a read of the mutable binding ${name}`;
        case 'const': {
          let initializer = declaration.initializer;
          while (initializer?.type === 'ParenthesizedExpression') {
            initializer = (initializer as unknown as { Expression: ParseNode }).Expression;
          }
          if (!initializer) continue;
          // `const C = class {}` names a class exactly as a class declaration
          // does. The floor excludes a class EXPRESSION because a builder that
          // evaluated one would mint a new nominal type per evaluation; reading
          // a binding that already holds one mints nothing.
          if (initializer.type === 'ClassExpression') continue;
          const inner = judged(declaration.node, () => violation(initializer));
          if (inner !== undefined) return `a read of ${name}, whose initializer holds ${inner}`;
          continue;
        }
        case 'function': {
          if (context.assigned(name)) return `a use of ${name}, which the program reassigns`;
          const inner = judged(declaration.node, () => violation(declaration.node));
          if (inner !== undefined) return `a use of ${name}, whose body holds ${inner}`;
          continue;
        }
        default:
          continue;
      }
    }
    return undefined;
  };
  return violation;
}
