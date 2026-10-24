import type { ParseNode } from '../parser/ParseNode.mts';
import { anyType, type TypeRecord } from './records.mts';
import { PrepareNamedArguments } from './named-arguments.mts';
import { TupleStorageShapeOf, TupleStorageTypeAt } from './tuple-storage.mts';

/** A finite fresh source supplies potential indices without running iteration. */
export function FreshArraySpreadSource(argument: ParseNode): ParseNode.ArrayLiteral | undefined {
  if (argument.type !== 'AssignmentRestElement') return undefined;
  let source: ParseNode = argument.AssignmentExpression;
  while (source.type === 'ParenthesizedExpression') source = source.Expression;
  return source.type === 'ArrayLiteral' && !source.ElementList.some((element) => element.type === 'SpreadElement') ? source : undefined;
}

/** Offer only destinations known before evaluating values. Name pinning and a
 * sole trailing positional rest need no value inspection. Other distributions
 * do not borrow a neighbouring parameter's context. */
export function ArgumentContexts(args: readonly ParseNode[], parameters: readonly {
  Name: string, Rest: boolean, Ref?: boolean, Optional?: boolean, Type?: TypeRecord | null,
}[]): ReadonlyMap<object, TypeRecord> {
  const contexts = new Map<object, TypeRecord>();
  let namedSpreadContext: TypeRecord | undefined;
  // Even an overwritten named expression is evaluated in its fixed contract.
  for (const arg of args) {
    if (arg.type === 'AssignmentRestElement') {
      let source: ParseNode = arg.AssignmentExpression;
      while (source.type === 'ParenthesizedExpression') source = source.Expression;
      if (source.type === 'ObjectLiteral') {
        // This is a construction context for named contributions, not proof
        // that the value will choose named spreading. Protocol dispatch below
        // remains observable and only the actual data-property read transports
        // a child choice. Stored values are never contextualized by this map.
        namedSpreadContext ??= { Kind: 'object', IndexSignatures: [],
          Properties: parameters.flatMap((p) => {
            const type = !p.Rest ? p.Type : p.Type?.Kind === 'array' ? p.Type.Element : undefined;
            return p.Name && type && !p.Ref ? [{ key: p.Name, type, optional: true, readonly: false }] : [];
          }) };
        contexts.set(arg.AssignmentExpression, namedSpreadContext);
      }
      continue;
    }
    if (arg.type !== 'NamedArgument') continue;
    const parameter = parameters.find((p) => p.Name === arg.Name && !p.Rest && !p.Ref);
    if (parameter?.Type) contexts.set(arg.AssignmentExpression, parameter.Type);
  }
  // Positional source indices are construction sites under the potential
  // ordinary array traversal, not a proof of the actual iterator's output.
  const arrays = new Map<ParseNode, ParseNode.ArrayLiteral>();
  const expanded = args.flatMap((arg): ParseNode[] => {
    if (arg.type !== 'AssignmentRestElement') return [arg];
    const source = FreshArraySpreadSource(arg);
    if (!source) return [arg];
    arrays.set(arg.AssignmentExpression, source);
    return [...source.ElementList];
  });
  if (expanded.some((arg) => arg.type === 'AssignmentRestElement')) return contexts;
  const plan = PrepareNamedArguments(parameters.map((p) => ({ ...p, Optional: p.Optional ?? false })),
    expanded.map((arg) => arg.type === 'NamedArgument'
      ? { name: arg.Name, value: arg.AssignmentExpression } : { value: arg }));
  if (plan.error) return contexts;
  const restIndex = plan.remaining.findIndex(({ p }) => p.Rest);
  const named = args.some((arg) => arg.type === 'NamedArgument');
  const determined = (restIndex < 0 || restIndex === plan.remaining.length - 1)
    && (!named || restIndex < 0 || !plan.remaining.slice(0, restIndex).some(({ p }) => p.Optional));
  if (determined) {
    let cursor = 0;
    for (const { p, i } of plan.remaining) {
      const count = p.Rest ? plan.positional.length - cursor : Math.min(1, plan.positional.length - cursor);
      plan.groups[i].push(...plan.positional.slice(cursor, cursor + count));
      cursor += count;
    }
  }
  for (let i = 0; i < parameters.length; i += 1) {
    const parameter = parameters[i];
    if (!parameter.Type || parameter.Ref) continue;
    const group = plan.groups[i];
    const shape = parameter.Rest ? TupleStorageShapeOf(parameter.Type) : undefined;
    group.forEach((arg, offset) => {
      const type = !parameter.Rest ? parameter.Type : parameter.Type?.Kind === 'array' ? parameter.Type.Element
        : shape ? TupleStorageTypeAt(shape, offset, group.length) : undefined;
      if (type) contexts.set(arg, type);
    });
  }
  for (const [operand, source] of arrays) {
    contexts.set(operand, { Kind: 'tuple', Elements: source.ElementList.map((element) => ({
      Type: contexts.get(element) ?? anyType, Rest: false, Initial: 'none',
    })) });
  }
  return contexts;
}
