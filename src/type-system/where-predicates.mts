import { ObjectValue, Value } from '../value.mts';
import { Q, EnsureCompletion } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ResolveInitializedBinding } from '../execution-context/Environment.mts';
import type { Realm } from '../execution-context/Realm.mts';
import { isECMAScriptFunctionObject, type ECMAScriptFunctionObject } from '../abstract-ops/function-operations.mts';
import { IsMetadataAtom } from '../abstract-ops/runtime-types.mts';
import type { EnvironmentRecord } from '../execution-context/Environment.mts';
import { isTypeObject, GetTypeObject } from './intern.mts';
import { builtinTypeRecord } from './records.mts';
import { LexicalTypeParameterArgument } from './runtime.mts';
import { LexicalFreeReferences, ResolveBindingDeclaration } from './compile-time-evaluability.mts';
import { TypeExpressionEvaluabilityViolation } from './builder-evaluability.mts';
import { FirstNonEvaluableForm } from './evaluable-fragment.mts';
import { BeginTypeEvaluation, EndTypeEvaluation, ConsumeEvaluationSteps, IsBudgetExhausted, EvaluateWithTypeBudget } from './budget.mts';
import { BeginFragmentEvaluation, EndFragmentEvaluation } from './fragment-library.mts';
import { Call, ToBoolean, Throw, surroundingAgent } from '#self';

/** Function values, never their source text, identify a refinement. Admission
 * inspects syntax and internal cells only: no candidate, getter or callback runs. */
interface Admission {
  steps: number;
  readonly calls: Map<ParseNode, Value>;
  readonly localCalls: Map<ParseNode, ParseNode>;
  readonly initializers: Set<ParseNode>;
  readonly stable: (() => boolean)[];
}
const predicates = new WeakMap<ObjectValue, Admission>();
const sourcePredicates = new WeakSet<ObjectValue>();
const active = new WeakMap<object, Admission[]>();
const libraries = new WeakMap<Realm, Set<Value>>();
const namespaces = new WeakMap<Realm, Set<Value>>();
const receiverMethods = new WeakMap<Realm, Map<string, Value>>();

/** Capture the closed library enumeration before program code can replace it. */
export function RememberWhereLibrary(realm: Realm): void {
  const allowed = new Set<Value>();
  const namespaceObjects = new Set<Value>();
  const groups: Record<string, readonly string[]> = {
    '%Math%': ['abs', 'ceil', 'floor', 'round', 'trunc', 'sign', 'sqrt', 'cbrt', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'atan2', 'pow', 'max', 'min', 'hypot', 'fround', 'imul', 'clz32'],
    '%Number%': ['isNaN', 'isFinite', 'isInteger', 'isSafeInteger'],
    '%Object%': ['is'],
    '%Array%': ['isArray'],
    '%Reflect%': ['isAssignable', 'sameType', 'getReflection', 'makeType'],
    '%Temporal.Instant%': ['from', 'fromEpochMilliseconds', 'fromEpochNanoseconds', 'compare'],
  };
  for (const [group, names] of Object.entries(groups)) {
    const object = (realm.Intrinsics as unknown as Record<string, ObjectValue>)[group];
    if (object) namespaceObjects.add(object);
    for (const name of names) {
      const fn = object?.properties.get(Value(name))?.Value;
      if (fn instanceof ObjectValue) allowed.add(fn);
    }
  }
  for (const name of ['%String%', '%Number%', '%Boolean%', '%BigInt%', '%Error%', '%TypeError%', '%RangeError%', '%SyntaxError%', '%ReferenceError%', '%EvalError%', '%URIError%']) {
    const fn = (realm.Intrinsics as unknown as Record<string, ObjectValue>)[name];
    if (fn) allowed.add(fn);
  }
  const methods = new Map<string, Value>();
  for (const name of ['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'charAt', 'charCodeAt', 'codePointAt', 'slice', 'substring', 'toLowerCase', 'toUpperCase', 'trim']) {
    const value = realm.Intrinsics['%String.prototype%'].properties.get(Value(name))?.Value;
    if (value) methods.set(name, value);
  }
  const test = realm.Intrinsics['%RegExp.prototype%'].properties.get(Value('test'))?.Value;
  if (test) methods.set('test', test);
  receiverMethods.set(realm, methods);
  libraries.set(realm, allowed);
  const temporal = (realm.Intrinsics as unknown as Record<string, ObjectValue>)['%Temporal%'];
  if (temporal) namespaceObjects.add(temporal);
  namespaces.set(realm, namespaceObjects);
}

function descendants(root: ParseNode): ParseNode[] {
  const out: ParseNode[] = [];
  const seen = new Set<object>();
  const pending: unknown[] = [root];
  while (pending.length > 0 && !IsBudgetExhausted()) {
    const v = pending.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const child of v) pending.push(child);
      continue;
    }
    if (!('type' in v) || typeof v.type !== 'string') continue;
    ConsumeEvaluationSteps(1);
    out.push(v as ParseNode);
    for (const [key, child] of Object.entries(v)) {
      if (!['parent', 'location', 'sourceText'].includes(key)) pending.push(child);
    }
  }
  return out;
}
function inside(node: ParseNode | undefined, root: ParseNode): boolean {
  for (let at = node; at; at = at.parent) if (at === root) return true;
  return false;
}
function unwrap(node: ParseNode): ParseNode {
  return node.type === 'ParenthesizedExpression' ? unwrap(node.Expression) : node;
}

function inspectFunction(fn: ECMAScriptFunctionObject, admission: Admission, seen: Set<ObjectValue>): string | undefined {
  if (seen.has(fn)) return undefined;
  seen.add(fn);
  const root = fn.ECMAScriptCode?.parent;
  if (!root || fn.Async || /Async|Generator/.test(root.type) || fn.IsClassConstructor === Value.true) return 'an ordinary synchronous function is required';
  return inspectBody(root, fn, admission, seen, false, fn);
}

function inspectBody(root: ParseNode, fn: { Environment: EnvironmentRecord, Realm: Realm }, admission: Admission,
  seen: Set<ObjectValue>, allowThis: boolean, sourceFunction: Value = Value.undefined): string | undefined {
  BeginTypeEvaluation();
  try {
    const nodes = descendants(root);
    admission.steps += nodes.length;
    if (IsBudgetExhausted()) return 'the type evaluation budget was exhausted during predicate admission';
    return inspectBodyNodes(root, nodes, fn, admission, seen, allowThis, sourceFunction);
  } finally {
    EndTypeEvaluation();
  }
}

function inspectBodyNodes(root: ParseNode, nodes: ParseNode[], fn: { Environment: EnvironmentRecord, Realm: Realm }, admission: Admission,
  seen: Set<ObjectValue>, allowThis: boolean, sourceFunction: Value): string | undefined {
  const floor = FirstNonEvaluableForm(root) ?? TypeExpressionEvaluabilityViolation(root, sourceFunction);
  if (floor) return floor;
  const stableRead = (node: ParseNode): Value | undefined => {
    node = unwrap(node);
    if (node.type === 'IdentifierReference') {
      const declaration = ResolveBindingDeclaration(node, node.name);
      if (declaration?.node === root && isECMAScriptFunctionObject(sourceFunction)) return sourceFunction;
      if (inside(declaration?.node, root)) return undefined;
      const argument = LexicalTypeParameterArgument(fn.Environment, node.name);
      if (argument) return argument.Kind === 'literal' ? argument.Value : GetTypeObject(argument);
      const binding = ResolveInitializedBinding(fn.Environment, node.name);
      if (binding?.value !== undefined) {
        const captured = binding.value;
        admission.stable.push(() => binding.initialized && !binding.refLocation && binding.value === captured);
        return captured;
      }
      if (ResolveBindingDeclaration(node, node.name)) return undefined;
      const intrinsicType = builtinTypeRecord(node.name);
      if (intrinsicType) return GetTypeObject(intrinsicType);
      const object = fn.Realm.GlobalObject;
      const descriptor = object.properties.get(Value(node.name));
      const value = descriptor?.Value;
      if (value !== undefined && descriptor?.Writable !== Value.false
          && !libraries.get(fn.Realm)?.has(value) && !namespaces.get(fn.Realm)?.has(value)) return undefined;
      if (value !== undefined) admission.stable.push(() => object.properties.get(Value(node.name))?.Value === value);
      return value;
    }
    if (node.type === 'MemberExpression') {
      const object = stableRead(node.MemberExpression);
      const key = node.IdentifierName?.name ?? (node.Expression?.type === 'StringLiteral' ? node.Expression.value : undefined);
      if (!(object instanceof ObjectValue) || key === undefined || object.Get !== ObjectValue.prototype.Get) return undefined;
      const value = object.properties.get(Value(key))?.Value;
      if (value !== undefined) admission.stable.push(() => object.properties.get(Value(key))?.Value === value);
      return value;
    }
    return undefined;
  };
  for (const reference of LexicalFreeReferences(root)) {
    const name = reference.name;
    const declaration = ResolveBindingDeclaration(reference, name);
    if (declaration?.kind === 'let' || declaration?.kind === 'var') return `a mutable capture ${name}`;
    if (declaration?.kind === 'const' && declaration.initializer && !admission.initializers.has(declaration.node)) {
      admission.initializers.add(declaration.node);
      const violation = inspectBody(declaration.initializer, fn, admission, seen, false);
      if (violation) return violation;
    }
    const value = stableRead(reference);
    if (value === undefined) return `an unavailable capture ${name}`;
    if (declaration?.kind === 'import' && ResolveInitializedBinding(fn.Environment, name)?.mutable
        && !isECMAScriptFunctionObject(value)) return `a mutable imported capture ${name}`;
    if (IsMetadataAtom(value) || isTypeObject(value) || value === Value.undefined) continue;
    if (isECMAScriptFunctionObject(value)) {
      const violation = inspectFunction(value, admission, seen);
      if (violation) return violation;
      continue;
    }
    // An intrinsic namespace is usable only as the receiver of a statically
    // resolved library call, never as a mutable captured record.
    if (value instanceof ObjectValue && libraries.get(fn.Realm)?.has(value)) continue;
    const parent = reference.parent;
    if (parent?.type === 'MemberExpression' && parent.MemberExpression === reference) {
      let reach: ParseNode = parent;
      while (reach.parent?.type === 'MemberExpression' && reach.parent.MemberExpression === reach) reach = reach.parent;
      if (reach.parent?.type === 'CallExpression' && reach.parent.CallExpression === reach
          && libraries.get(fn.Realm)?.has(stableRead(reach)!)) continue;
      const constant = stableRead(reach);
      if (constant !== undefined && IsMetadataAtom(constant)) continue;
    }
    return `a mutable or opaque captured value ${name}`;
  }
  for (const node of nodes) {
    if ((!allowThis && node.type === 'ThisExpression') || node.type === 'SuperProperty' || node.type === 'SuperCall'
        || node.type === 'NewTarget' || node.type === 'WithStatement') return 'an ambient receiver or dynamic environment';
    if (node.type === 'IdentifierReference' && node.name === 'arguments') return 'the arguments object';
    if (node.type === 'RefExpression' || node.type === 'RefRebindingStatement' || ('Ref' in node && node.Ref)) {
      return 'a reference alias in a predicate';
    }
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression'
        || ((node.type === 'ForInStatement' || node.type === 'ForOfStatement') && node.LeftHandSideExpression)) {
      const target = unwrap((node.type === 'AssignmentExpression' ? node.LeftHandSideExpression
        : node.LeftHandSideExpression ?? (node.type === 'UpdateExpression' ? node.UnaryExpression : undefined))!);
      if (target.type !== 'IdentifierReference' || !inside(ResolveBindingDeclaration(target, target.name)?.node, root)) {
        return 'a write outside a local binding';
      }
    }
    if (node.type === 'ForAwaitStatement' || node.type === 'TaggedTemplateExpression') return 'an unproved asynchronous or tagged call';
    if (node.type === 'MemberExpression') {
      const receiver = unwrap(node.MemberExpression);
      const object = receiver.type === 'IdentifierReference'
        && !inside(ResolveBindingDeclaration(receiver, receiver.name)?.node, root) ? stableRead(receiver) : undefined;
      if (object instanceof ObjectValue) {
        const property = stableRead(node);
        if (property === undefined || (!IsMetadataAtom(property) && !isTypeObject(property)
          && !isECMAScriptFunctionObject(property) && !libraries.get(fn.Realm)?.has(property)
          && !namespaces.get(fn.Realm)?.has(property))) return 'an opaque property of a captured object';
        const key = node.IdentifierName?.name ?? (node.Expression?.type === 'StringLiteral' ? node.Expression.value : undefined);
        const isCallTarget = node.parent?.type === 'CallExpression' && node.parent.CallExpression === node;
        if (!isCallTarget && !namespaces.get(fn.Realm)?.has(property) && key !== undefined
            && object.properties.get(Value(key))?.Writable !== Value.false) {
          return 'a mutable property of a captured object';
        }
      }
    }
    if (node.type === 'UnaryExpression' && node.operator === 'delete') return 'a delete';
    if (node.type === 'NewExpression') {
      const constructor = stableRead(node.MemberExpression);
      const allowed = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError']
        .some((name) => constructor === (fn.Realm.Intrinsics as unknown as Record<string, Value>)[`%${name}%`]);
      if (!allowed) return 'an unproved constructor call';
      admission.calls.set(node, constructor!);
    }
    if (node.type === 'CallExpression') {
      let callee = stableRead(node.CallExpression);
      const target = unwrap(node.CallExpression);
      let receiverMethod = false;
      if (callee === undefined && target.type === 'MemberExpression') {
        const name = target.IdentifierName?.name ?? (target.Expression?.type === 'StringLiteral' ? target.Expression.value : undefined);
        if (name && (name !== 'test' || target.MemberExpression.type === 'RegularExpressionLiteral')) {
          callee = receiverMethods.get(fn.Realm)?.get(name);
          receiverMethod = callee !== undefined;
        }
      }
      if (callee === undefined && target.type === 'IdentifierReference') {
        const declaration = ResolveBindingDeclaration(target, target.name);
        const local = declaration?.kind === 'function' ? declaration.node
          : declaration?.kind === 'const' ? declaration.initializer : undefined;
        if (local && inside(local, root) && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction'].includes(local.type)) {
          admission.localCalls.set(node, local);
          continue;
        }
      }
      if (callee === undefined) return 'a call whose target is not statically known';
      if (isECMAScriptFunctionObject(callee)) {
        const violation = inspectFunction(callee, admission, seen);
        if (violation) return violation;
      } else if (!receiverMethod && !libraries.get(fn.Realm)?.has(callee)
          && !(isTypeObject(callee) && callee.TypeRecord.Kind === 'primitive')) {
        return 'a call outside the deterministic library';
      }
      admission.calls.set(node, callee);
    }
    if (node.type === 'OptionalChain' && node.Arguments) return 'an unproved optional call';
  }
  return undefined;
}

export function* AdmitWherePredicate(value: Value): PlainEvaluator<ObjectValue> {
  if (!(value instanceof ObjectValue)) return Throw.TypeError('metadata where requires a unary ordinary synchronous predicate');
  const prior = predicates.get(value);
  if (prior) {
    ConsumeEvaluationSteps(prior.steps);
    if (IsBudgetExhausted()) return Throw.TypeError('the type evaluation budget was exhausted at $1', Value('where predicate admission'));
    if (prior.stable.some((test) => !test())) return Throw.TypeError('a where predicate dependency changed after admission');
    return value;
  }
  if (sourcePredicates.has(value)) return value;
  if (!isECMAScriptFunctionObject(value) || value.FormalParameters.length !== 1
      || value.FormalParameters[0]?.type === 'BindingRestElement'
      || value.FormalParameters[0]?.Ref) {
    return Throw.TypeError('metadata where requires a unary ordinary synchronous predicate');
  }
  const admission: Admission = { steps: 0, calls: new Map(), localCalls: new Map(), initializers: new Set(), stable: [] };
  const violation = inspectFunction(value, admission, new Set());
  if (violation) return Throw.TypeError('a where predicate is not compile-time evaluable: $1', Value(violation));
  predicates.set(value, admission);
  return value;
}

/** A computed metadata record carries an already admitted opaque function
 * through its temporary literal record; it does not widen nested metadata. */
export function IsAdmittedWherePredicate(value: unknown): value is ObjectValue {
  return value instanceof ObjectValue && predicates.has(value);
}

/** Source lowering supplies a declaration-bound bridge, rather than reparsing
 * source or serializing a closure. Its ordinary refinement evaluator owns this. */
export function RegisterSourceWherePredicate(fn: ObjectValue, clause: ParseNode.WhereClause, environment: EnvironmentRecord, realm: Realm): ReturnType<typeof Throw.TypeError> | undefined {
  const admission: Admission = { steps: 0, calls: new Map(), localCalls: new Map(), initializers: new Set(), stable: [] };
  const violation = inspectBody(clause, { Environment: environment, Realm: realm }, admission, new Set(), true);
  if (violation) return Throw.TypeError('a where predicate is not compile-time evaluable: $1', Value(violation));
  sourcePredicates.add(fn);
  predicates.set(fn, admission);
  return undefined;
}

/** Checked at the call site AFTER argument effects. An input getter may replace
 * Math.abs; that cannot silently change the predicate's admitted call graph. */
export function CheckWhereCall(node: ParseNode | undefined, fn: Value): ReturnType<typeof Throw.TypeError> | undefined {
  if (!node) return undefined;
  for (const admission of active.get(surroundingAgent) ?? []) {
    const expected = admission.calls.get(node);
    const local = admission.localCalls.get(node);
    if ((expected !== undefined || local !== undefined) && (expected !== undefined ? expected !== fn
      : !isECMAScriptFunctionObject(fn) || fn.ECMAScriptCode?.parent !== local)) {
      return Throw.TypeError('a where predicate dependency changed after admission');
    }
    if ((expected !== undefined || local !== undefined) && admission.stable.some((test) => !test())) {
      return Throw.TypeError('a where predicate dependency changed after admission');
    }
  }
  return undefined;
}

export function CheckWhereDependencies(): ReturnType<typeof Throw.TypeError> | undefined {
  for (const admission of active.get(surroundingAgent) ?? []) {
    if (admission.stable.some((test) => !test())) return Throw.TypeError('a where predicate dependency changed after admission');
  }
  return undefined;
}

const defaultObservers = new WeakMap<object, { abrupt: Set<Value> }[]>();
export function BeginWhereDefaultObservation(outcome: { abrupt: Set<Value> }): void {
  const stack = defaultObservers.get(surroundingAgent) ?? [];
  stack.push(outcome);
  defaultObservers.set(surroundingAgent, stack);
}
export function EndWhereDefaultObservation(): void {
  defaultObservers.get(surroundingAgent)?.pop();
}

export function* EvaluateWherePredicate(fn: ObjectValue, value: Value): PlainEvaluator<boolean> {
  const result = EnsureCompletion(yield* evaluateWherePredicateBody(fn, value));
  if (result.Type !== 'normal') {
    for (const outcome of defaultObservers.get(surroundingAgent) ?? []) outcome.abrupt.add(result.Value);
    return result;
  }
  return result.Value;
}

function* evaluateWherePredicateBody(fn: ObjectValue, value: Value): PlainEvaluator<boolean> {
  const admission = predicates.get(fn);
  if (!admission && !sourcePredicates.has(fn)) return Throw.TypeError('a where predicate was not admitted');
  if (admission?.stable.some((test) => !test())) return Throw.TypeError('a where predicate dependency changed after admission');
  const stack = active.get(surroundingAgent) ?? [];
  active.set(surroundingAgent, stack);
  if (admission) stack.push(admission);
  BeginFragmentEvaluation();
  try {
    const result = Q(yield* EvaluateWithTypeBudget('a where predicate', Call(fn, Value.undefined, [value])));
    const changed = CheckWhereDependencies();
    if (changed) return changed;
    return ToBoolean(result) === Value.true;
  } finally {
    EndFragmentEvaluation();
    if (admission) stack.pop();
  }
}
