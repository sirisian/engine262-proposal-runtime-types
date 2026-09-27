import type { ParseNode } from '../parser/ParseNode.mts';
import { CanonicalWidthArgument, type TypeRecord } from './records.mts';
import { orderTypeArguments } from './type-argument-order.mts';

/** Declaration data shared by application, constraints, and reflection. */
export interface IntrinsicParameter {
  readonly Name: string;
  readonly Domain: 'type' | 'width' | 'width-or-bigint' | 'component' | 'lane' | 'count' | 'bound';
  readonly Default?: TypeRecord | number;
}

/** The receiving declaration, rather than the spelling of the argument, selects this context. */
export function isHigherKindedArgument(node: ParseNode, lookup: (name: string) => ParseNode | undefined): boolean {
  const list = node.parent;
  if (list?.type !== 'TypeArguments') return false;
  const application = list.parent;
  const name = application?.type === 'TypeReference' ? application.TypeName.IdentifierReference.name
    : application?.type === 'TypeArgumentsExpression' && application.Expression.type === 'IdentifierReference'
      ? application.Expression.name : undefined;
  if (!name) return false;
  const decl = lookup(name) as { TypeParameters?: ParseNode.TypeParameters | null } | undefined;
  const parameters = decl?.TypeParameters?.TypeParameterList ?? [];
  const label = (node as { ArgumentName?: string }).ArgumentName;
  const p = label === undefined ? parameters[list.TypeArgumentList.indexOf(node as ParseNode.Type)]
    : parameters.find((q) => q.BindingIdentifier.name === label);
  return (p?.Arity ?? 0) > 0;
}

const primitive = (Name: string): TypeRecord => ({ Kind: 'primitive', Name, Arguments: [] });
const parameter = (Name: string, Domain: IntrinsicParameter['Domain'], Default?: TypeRecord | number): IntrinsicParameter => ({ Name, Domain, Default });

export function intrinsicParameters(name: string): readonly IntrinsicParameter[] | undefined {
  switch (name) {
    case 'int': case 'uint': return [parameter('N', 'width')];
    case 'rational': return [parameter('N', 'width-or-bigint')];
    case 'complex': return [parameter('T', 'component', primitive('number'))];
    case 'vector': return [parameter('T', 'lane'), parameter('N', 'count')];
    case 'Range': return [parameter('T', 'type'), parameter('S', 'bound', 0), parameter('E', 'bound', 1)];
    case 'RangeFrom': return [parameter('T', 'type'), parameter('S', 'bound', 0)];
    case 'RangeTo': return [parameter('T', 'type'), parameter('E', 'bound', 1)];
    case 'RangeFull': case 'RangeBounds':
    case 'ClosedRange': case 'ClosedOpenRange': case 'OpenClosedRange': case 'OpenRange':
      return [parameter('T', 'type')];
    default: return undefined;
  }
}

export function missingIntrinsicArgument(name: string, parameterName: string): string {
  const hint = name === 'rational' ? '; choose rational64, another explicit width, or rational.<bigint>'
    : name === 'Range' ? '; use Range.<T> for two endpoints or RangeBounds.<T> for any range shape' : '';
  return `${name} requires type argument ${parameterName}${hint}`;
}

/** Open arguments are validated when substitution closes the application. */
function open(argument: TypeRecord | number, seen = new Set<TypeRecord>()): boolean {
  if (typeof argument === 'number' || seen.has(argument)) return false;
  seen.add(argument);
  if (argument.Kind === 'parameter' || argument.Kind === 'deferred') return true;
  if (argument.Kind === 'primitive' || argument.Kind === 'nominal') return argument.Arguments.some((a) => open(a, seen));
  if (argument.Kind === 'parameterized') return open(argument.Base, seen);
  return false;
}

export function intrinsicArgumentProblem(domain: IntrinsicParameter['Domain'], argument: TypeRecord | number): string | undefined {
  if (open(argument)) return undefined;
  if (domain === 'width-or-bigint' && typeof argument !== 'number' && argument.Kind === 'primitive'
      && argument.Name === 'bigint' && argument.Arguments.length === 0) return undefined;
  if (domain === 'width' || domain === 'width-or-bigint') {
    return typeof argument === 'number' && Number.isInteger(argument) && argument >= 1 && argument <= 65536
      ? undefined : `must be an integer width from 1 through 65536${domain === 'width-or-bigint' ? ' or the bigint type' : ''}`;
  }
  if (domain === 'count') return typeof argument === 'number' && Number.isInteger(argument) && argument > 0 ? undefined : 'must be a positive integer lane count';
  if (domain === 'bound') return argument === 0 || argument === 1 ? undefined : 'must be Bound.Closed or Bound.Open';
  if (typeof argument === 'number' || argument.Kind === 'literal') return 'must be a type';
  if (domain === 'type') return undefined;
  const base = argument.Kind === 'parameterized' ? argument.Base : argument;
  const names = domain === 'component' ? ['number', 'float16', 'float32', 'float64', 'float128']
    : ['int', 'uint', 'float16', 'float32', 'float64', 'float128', 'vector'];
  return base.Kind === 'primitive' && names.includes(base.Name) ? undefined
    : `must be a valid ${domain === 'component' ? 'complex component' : 'vector lane'} type`;
}

/** Order, fill, and validate before constructing a concrete application. */
export function bindIntrinsicArguments(name: string, args: readonly (TypeRecord | number)[], names: readonly (string | undefined)[] = []):
  { readonly Arguments: readonly (TypeRecord | number)[] } | { readonly Error: string } | undefined {
  const parameters = intrinsicParameters(name);
  if (!parameters) return undefined;
  const ordered = orderTypeArguments(parameters.map((p) => p.Name), args.map(CanonicalWidthArgument), names);
  if (!ordered.ok) {
    const detail = ordered.kind === 'unknown-name' ? `${ordered.name} does not name a type parameter of ${name}`
      : ordered.kind === 'supplied-twice' ? `${ordered.name} is supplied twice to ${name}`
      : ordered.kind === 'positional-after-named' ? 'a positional type argument follows a named argument'
      : `${name} takes ${parameters.length} type arguments`;
    return { Error: detail };
  }
  if (ordered.ordered.length > parameters.length) return { Error: `${name} takes ${parameters.length} type arguments` };
  const Arguments: (TypeRecord | number)[] = [];
  for (let i = 0; i < parameters.length; i += 1) {
    const p = parameters[i];
    const a = ordered.ordered[i] ?? p.Default;
    if (a === undefined) return { Error: missingIntrinsicArgument(name, p.Name) };
    const problem = intrinsicArgumentProblem(p.Domain, a);
    if (problem) return { Error: `${name}'s argument ${p.Name} ${problem}` };
    Arguments.push(a);
  }
  return { Arguments };
}


// The Range namespace is a mutable global, unlike the numeric type-name table.
// Retain its original identity so replacing the global shadows the declaration.
const intrinsicNamespaces = new WeakMap<object, Map<string, unknown>>();
export function registerIntrinsicNamespace(realm: object, name: string, value: unknown): void {
  let names = intrinsicNamespaces.get(realm);
  if (!names) {
    names = new Map();
    intrinsicNamespaces.set(realm, names);
  }
  names.set(name, value);
}
export function isIntrinsicNamespace(realm: object, name: string, value: unknown): boolean {
  return intrinsicNamespaces.get(realm)?.get(name) === value;
}
