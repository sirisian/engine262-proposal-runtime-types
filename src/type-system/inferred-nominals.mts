import type { ParseNode } from '../parser/ParseNode.mts';
import { DeclarativeEnvironmentRecord, GlobalEnvironmentRecord, type EnvironmentRecord } from '../execution-context/Environment.mts';
import { ObjectValue, Value } from '../value.mts';
import { ResolveBindingDeclaration } from './compile-time-evaluability.mts';
import type { TypeRecord } from './records.mts';
import { LookupClassType, isTypeObject } from '#self';

// Read only ordinary, initialized value bindings. In particular, this operation
// never dereferences a reference, follows an import, or asks an object environment
// to run HasProperty/Get. Absence of evidence leaves the contract symbolic.
function bindingValue(environment: EnvironmentRecord | undefined, name: string, immutable = false): Value | undefined {
  for (let env = environment; env; env = env.OuterEnv ?? undefined) {
    const holder = env instanceof GlobalEnvironmentRecord ? env.DeclarativeRecord : env;
    if (!(holder instanceof DeclarativeEnvironmentRecord)) return undefined;
    const binding = holder.bindings.get(Value(name));
    if (!binding) continue;
    if (!binding.initialized || binding.indirect || binding.refLocation || (immutable && binding.mutable !== false)) return undefined;
    return binding.value;
  }
  return undefined;
}

const forwardingCallees = new WeakMap<object, ParseNode.IdentifierReference | null>();

/** A single direct return from an immutable callee supplies one dependency. */
function forwardingCallee(body: ParseNode): ParseNode.IdentifierReference | undefined {
  if (forwardingCallees.has(body)) return forwardingCallees.get(body) ?? undefined;
  const expressions: (ParseNode | null)[] = [];
  const pending: ParseNode[] = [body];
  while (pending.length) {
    const node = pending.pop()!;
    if (node !== body && /(?:Function|Generator|Method|Class)/.test(node.type)) continue;
    if (node.type === 'ReturnStatement') {
      expressions.push(node.Expression);
      continue;
    }
    if (node.type === 'ExpressionBody') {
      expressions.push(node.AssignmentExpression);
      continue;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && typeof child.type === 'string') pending.push(child);
      }
    }
  }
  let expression = expressions.length === 1 ? expressions[0] : undefined;
  while (expression?.type === 'ParenthesizedExpression') expression = expression.Expression;
  let callee: ParseNode | undefined = expression?.type === 'CallExpression' ? expression.CallExpression : undefined;
  while (callee?.type === 'ParenthesizedExpression') callee = callee.Expression;
  const binding = callee?.type === 'IdentifierReference' ? ResolveBindingDeclaration(callee, callee.name) : undefined;
  let local = false;
  for (let node: ParseNode | undefined = binding?.node; node; node = node.parent) {
    if (node === body) {
      local = true;
      break;
    }
  }
  const reference = callee?.type === 'IdentifierReference' && binding?.kind === 'const' && !local ? callee : undefined;
  forwardingCallees.set(body, reference ?? null);
  return reference;
}

/** Close a non-generic source class from its declaring context, never a result. */
export function CloseInferredNominal(type: TypeRecord, value: unknown,
  publication: (fn: unknown) => TypeRecord | undefined): TypeRecord {
  if (type.Kind !== 'nominal' || type.Constructor || type.DeclarationIdentity || type.Arguments.length
    || type.Declaration.type !== 'ClassDeclaration') return type;
  const seen = new Set<unknown>();
  let current = value;
  while (!seen.has(current)) {
    seen.add(current);
    const fn = current as { Environment?: EnvironmentRecord, ECMAScriptCode?: ParseNode | null };
    if (!fn.Environment) break;
    const name: string | undefined = (type.Declaration as ParseNode.ClassDeclaration).BindingIdentifier?.name;
    const ctor: Value | undefined = name ? bindingValue(fn.Environment, name) : undefined;
    const bound: Value | undefined = ctor instanceof ObjectValue ? LookupClassType(ctor) : undefined;
    if (bound && isTypeObject(bound) && bound.TypeRecord.Kind === 'nominal'
      && bound.TypeRecord.Declaration === type.Declaration && !bound.TypeRecord.Arguments.length) {
      return { ...type, Constructor: ctor };
    }
    const callee = fn.ECMAScriptCode && forwardingCallee(fn.ECMAScriptCode);
    const dependency = callee && bindingValue(fn.Environment, callee.name, true);
    const result = dependency instanceof ObjectValue ? publication(dependency) : undefined;
    if (result?.Kind !== 'nominal' || result.Declaration !== type.Declaration
      || result.Arguments.length || result.DeclarationIdentity) break;
    if (result.Constructor) return { ...type, Constructor: result.Constructor };
    current = dependency;
  }
  return type;
}
