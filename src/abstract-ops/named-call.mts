import { Value, type Arguments } from '../value.mts';
import type { ParameterRecord } from '../type-system/records.mts';
import type { ArgumentItem } from '../type-system/named-arguments.mts';

// Invocation-owned metadata: neither user-visible function properties nor a
// global pending selection that argument effects or recursive calls can steal.
const argumentItems = new WeakMap<Arguments, readonly ArgumentItem<Value>[]>();
const parameterCounts = new WeakMap<Arguments, { target: Value, counts: readonly number[] }>();

export function NamedCallArguments(items: readonly ArgumentItem<Value>[]): Arguments {
  const args = items.map((item) => item.value);
  argumentItems.set(args, items);
  return args as Arguments;
}

export function NamedCallItemsOf(args: Arguments) {
  return argumentItems.get(args);
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
  const result = values.flat();
  SetNamedParameterCounts(result, target, values.map((group) => group.length));
  return result;
}
