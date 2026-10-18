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

type ForwardingSource = { reference: ParseNode.IdentifierReference, binding: ParseNode };
const forwardingSources = new WeakMap<object, readonly ForwardingSource[] | null>();

function insideBody(node: ParseNode, body: ParseNode): boolean {
  for (let at: ParseNode | undefined = node; at; at = at.parent) {
    if (at === body) return true;
  }
  return false;
}

function unparenthesized(node: ParseNode | null | undefined): ParseNode | undefined {
  while (node?.type === 'ParenthesizedExpression') node = node.Expression;
  return node ?? undefined;
}

/** Follow ordinary local const aliases by declaration, without reading them. */
function capturedSource(node: ParseNode | undefined, body: ParseNode): ForwardingSource | undefined {
  const seen = new Set<ParseNode>();
  let reference = unparenthesized(node);
  while (reference?.type === 'IdentifierReference') {
    const binding = ResolveBindingDeclaration(reference, reference.name);
    if (binding?.kind !== 'const' || seen.has(binding.node)) return undefined;
    seen.add(binding.node);
    if (!insideBody(binding.node, body)) return { reference, binding: binding.node };
    // A written conversion, reference or destructuring is not a value alias.
    const declaration = binding.node;
    if (declaration.type !== 'LexicalBinding' || !declaration.BindingIdentifier
      || declaration.Ref || declaration.TypeAnnotation || declaration.TypedInitializer) return undefined;
    reference = unparenthesized(binding.initializer);
  }
  return undefined;
}

/** Every written return must forward a proven captured immutable source. */
function sourcesOf(body: ParseNode): readonly ForwardingSource[] | undefined {
  if (forwardingSources.has(body)) return forwardingSources.get(body) ?? undefined;
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
  const sources: ForwardingSource[] = [];
  for (const expression of expressions) {
    const call = unparenthesized(expression);
    const source = call?.type === 'CallExpression' ? capturedSource(call.CallExpression, body) : undefined;
    if (!source) {
      forwardingSources.set(body, null);
      return undefined;
    }
    if (!sources.some((other) => other.binding === source.binding)) sources.push(source);
  }
  forwardingSources.set(body, sources.length ? sources : null);
  return sources.length ? sources : undefined;
}

/** Close a non-generic source class from its declaring context, never a result. */
export function CloseInferredNominal(type: TypeRecord, value: unknown,
  publication: (fn: unknown) => TypeRecord | undefined): TypeRecord {
  if (type.Kind !== 'nominal' || type.Constructor || type.DeclarationIdentity || type.Arguments.length
    || type.Declaration.type !== 'ClassDeclaration') return type;
  const seen = new Set<unknown>();
  const pending: unknown[] = [value];
  let constructor: ObjectValue | undefined;
  const admitConstructor = (candidate: ObjectValue): boolean => {
    if (constructor && constructor !== candidate) return false;
    constructor = candidate;
    return true;
  };
  while (pending.length) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const fn = current as { Environment?: EnvironmentRecord, ECMAScriptCode?: ParseNode | null };
    if (!fn.Environment) return type;
    const sources = fn.ECMAScriptCode && sourcesOf(fn.ECMAScriptCode);
    if (sources) {
      // The result's dependency wins over an ambient same-spelled class.
      // Distinct aliases/paths must agree on the actual evaluated constructor.
      for (const source of sources) {
        const dependency = bindingValue(fn.Environment, source.reference.name, true);
        const result = dependency instanceof ObjectValue ? publication(dependency) : undefined;
        if (result?.Kind !== 'nominal' || result.Declaration !== type.Declaration
          || result.Arguments.length || result.DeclarationIdentity) return type;
        if (result.Constructor instanceof ObjectValue) {
          if (!admitConstructor(result.Constructor)) return type;
        } else pending.push(dependency);
      }
      continue;
    }
    const name: string | undefined = (type.Declaration as ParseNode.ClassDeclaration).BindingIdentifier?.name;
    const ctor: Value | undefined = name ? bindingValue(fn.Environment, name) : undefined;
    const bound: Value | undefined = ctor instanceof ObjectValue ? LookupClassType(ctor) : undefined;
    if (!(ctor instanceof ObjectValue) || !bound || !isTypeObject(bound) || bound.TypeRecord.Kind !== 'nominal'
      || bound.TypeRecord.Declaration !== type.Declaration || bound.TypeRecord.Arguments.length
      || !admitConstructor(ctor)) return type;
  }
  return constructor ? { ...type, Constructor: constructor } : type;
}
