import { ArgumentResultOf, CopyArgumentResults, RetainArgumentResult, TransferResultDependency } from '../type-system/result-dependencies.mts';
import { Value, type Arguments } from '../value.mts';
import type { ParameterRecord } from '../type-system/records.mts';
import type { ArgumentItem } from '../type-system/named-arguments.mts';

// Invocation-owned metadata: neither user-visible function properties nor a
// global pending selection that argument effects or recursive calls can steal.
const argumentItems = new WeakMap<Arguments, readonly ArgumentItem<Value>[]>();
const parameterCounts = new WeakMap<Arguments, { target: Value, counts: readonly number[] }>();

export type BuiltinNamedParameter = { readonly Name: string, readonly Optional?: boolean };
// Declaration metadata belongs to the actual native function, never to the
// caller's property spelling, mutable .name/.length, or a receiver's shape.
const builtinParameters = new WeakMap<Value, readonly BuiltinNamedParameter[]>();

export function SetBuiltinNamedParameters(func: Value, parameters: readonly BuiltinNamedParameter[]): void {
  builtinParameters.set(func, parameters);
}

export function BuiltinNamedParametersOf(func: Value): readonly BuiltinNamedParameter[] | undefined {
  return builtinParameters.get(func);
}

export function NamedCallArguments(items: readonly ArgumentItem<Value>[]): Arguments {
  const args = items.map((item) => item.value);
  items.forEach((item, index) => RetainArgumentResult(args, index, item));
  argumentItems.set(args, items);
  return args as Arguments;
}

export function NamedCallItemsOf(args: Arguments) {
  return argumentItems.get(args);
}

export function CallArgumentItems(args: Arguments): readonly ArgumentItem<Value>[] {
  return NamedCallItemsOf(args) ?? args.map((value, index) => {
    const item = { value };
    const source = ArgumentResultOf(args, index);
    return source ? TransferResultDependency(source, item) : item;
  });
}

export function SetNamedParameterCounts(args: Arguments, target: Value, counts: readonly number[]): void {
  parameterCounts.set(args, { target, counts });
}

export function NamedParameterCountsOf(args: Arguments, target: Value): readonly number[] | undefined {
  const bound = parameterCounts.get(args);
  return bound?.target === target ? bound.counts : undefined;
}

/** Materialize only the selected candidate's groups, preserving original values. */
export function SelectedNamedArguments(target: Value, parameters: readonly ParameterRecord[], args: Arguments, groups: readonly number[][]): Value[] {
  const positionalForwarding = argumentItems.has(args) && !argumentItems.get(args)!.some((item) => item.name !== undefined);
  // The selected distribution contains only indices of supplied arguments.
  const values = groups.map((group, i) => group.length === 0 && !parameters[i].Rest && !positionalForwarding
    ? [Value.undefined] : group.map((index) => args[index]!));
  const indices = groups.flatMap((group, i) => group.length === 0 && values[i].length ? [-1] : group);
  const result = CopyArgumentResults(args, values.flat(), indices);
  SetNamedParameterCounts(result, target, values.map((group) => group.length));
  return result;
}
