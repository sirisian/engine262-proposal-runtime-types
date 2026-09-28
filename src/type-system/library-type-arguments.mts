import type { TypeRecord } from './records.mts';
import { orderTypeArguments } from './type-argument-binding.mts';

interface LibraryTypeParameter {
  readonly Name: string;
  readonly Default?: TypeRecord;
}

/** #sec-library-type-parameters: these declarations do not change bare construction. */
export function libraryTypeParameters(name: string): readonly LibraryTypeParameter[] | undefined {
  const any: TypeRecord = { Kind: 'any' };
  const voidType: TypeRecord = { Kind: 'void' };
  switch (name) {
    case 'Map': case 'WeakMap': return [{ Name: 'K' }, { Name: 'V' }];
    case 'Set': case 'WeakSet': case 'WeakRef': case 'FinalizationRegistry': case 'Proxy': return [{ Name: 'T' }];
    case 'Promise': return [{ Name: 'R', Default: any }, { Name: 'E', Default: any }];
    case 'Generator': case 'AsyncGenerator': return [
      { Name: 'Y' }, { Name: 'R', Default: voidType }, { Name: 'N', Default: voidType },
    ];
    default: return undefined;
  }
}

/** Bind explicit library applications before their records are interned or consumed. */
export function bindLibraryTypeArguments(name: string, args: readonly TypeRecord[], names: readonly (string | undefined)[] = []):
  { readonly Arguments: readonly TypeRecord[] } | { readonly Error: string } | undefined {
  const parameters = libraryTypeParameters(name);
  if (!parameters) return undefined;
  const ordered = orderTypeArguments(parameters.map((p) => p.Name), args, names);
  if (!ordered.ok) {
    const detail = ordered.kind === 'unknown-name' ? `${ordered.name} does not name a type parameter of ${name}`
      : ordered.kind === 'supplied-twice' ? `${ordered.name} is supplied twice to ${name}`
      : ordered.kind === 'positional-after-named' ? 'a positional type argument follows a named argument'
      : `${name} takes ${parameters.length} type arguments`;
    return { Error: detail };
  }
  if (ordered.ordered.length > parameters.length) return { Error: `${name} takes ${parameters.length} type arguments` };
  const Arguments: TypeRecord[] = [];
  for (const [index, parameter] of parameters.entries()) {
    const argument = ordered.ordered[index] ?? parameter.Default;
    if (!argument) return { Error: `the type parameter ${parameter.Name} of ${name} has no argument and no default` };
    Arguments.push(argument);
  }
  return { Arguments };
}

const applications = new WeakMap<object, { name: string, arguments_: readonly TypeRecord[] }>();

/** Keep the evaluated list until its immediately enclosing construction consumes it. */
export function RememberLibraryApplication(node: object, name: string, arguments_: readonly TypeRecord[]): void {
  applications.set(node, { name, arguments_ });
}

export function TakeLibraryApplication(node: object, name: string): readonly TypeRecord[] | undefined {
  const arguments_ = applications.get(node);
  applications.delete(node);
  return arguments_?.name === name ? arguments_.arguments_ : undefined;
}
