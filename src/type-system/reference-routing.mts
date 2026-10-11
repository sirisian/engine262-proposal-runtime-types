import type { NamedSlot } from './named-arguments.mts';

type RoutingSlot = NamedSlot & { Ref?: boolean };
export type PositionalContribution = 'value' | 'spread' | 'reference-run';
export type RoutingContribution = { kind: PositionalContribution | 'unknown' } | { kind: 'named', name: string };

/**
 * A necessary routing condition, not type admission or a chosen partition.
 * Contract every forwarded run to a zero-width occurrence. Any successful
 * concrete assignment still has a route after this contraction: its entries
 * occupied only reference rests, which this abstraction permits to be empty.
 * Keep the occurrence even for a populated run, so it cannot cross a required
 * value prefix. Ignore collected extents, value types and reference liveness.
 * Ordinary positional spreads range over every finite length, without a cap.
 */
export function PositionalReferenceRoutePossible(
  parameters: readonly RoutingSlot[], contributions: readonly PositionalContribution[],
): boolean {
  const width = contributions.length + 1;
  const seen = new Set<number>();
  const pending: [number, number][] = [];
  const visit = (slot: number, source: number): void => {
    const key = slot * width + source;
    if (!seen.has(key)) {
      seen.add(key);
      pending.push([slot, source]);
    }
  };
  visit(0, 0);
  while (pending.length) {
    const [slot, source] = pending.pop()!;
    if (slot === parameters.length && source === contributions.length) return true;
    const p = parameters[slot];
    const item = contributions[source];
    if (p?.Rest || p?.Optional) visit(slot + 1, source);
    if (item === 'spread') visit(slot, source + 1);
    if (item === 'reference-run') {
      if (p?.Rest && p.Ref) visit(slot, source + 1);
    } else if (p && item !== undefined) {
      visit(p.Rest ? slot : slot + 1, item === 'spread' ? source : source + 1);
    }
  }
  return false;
}

/** Named scope is exact where known; suffix giveback is conservatively relaxed. */
export function ReferenceRoutePossible(
  parameters: readonly RoutingSlot[], contributions: readonly RoutingContribution[],
): boolean {
  if (!contributions.some((item) => item.kind === 'reference-run')) return true;
  if (!parameters.some((p) => p.Rest && p.Ref)) return false;
  const pinned = new Set<number>();
  const positional: PositionalContribution[] = [];
  let sawName: boolean | undefined = false;
  let openRest = -1;
  let unknown = false;
  for (const item of contributions) {
    if (item.kind === 'named') {
      const slot = parameters.findIndex((p) => p.Name === item.name);
      // Preserve the existing unknown-name diagnostic rather than treating
      // another binding error as proof about forwarding permission.
      if (slot < 0) return true;
      pinned.add(slot);
      sawName = true;
      openRest = parameters[slot].Rest ? slot : -1;
    } else if (item.kind === 'unknown') {
      // A spread might supply names, pin slots or change the open named rest.
      // A later explicit name reestablishes the scope for following runs.
      unknown = true;
      sawName = undefined;
    } else if (sawName === false) {
      positional.push(item.kind);
    } else if (item.kind === 'reference-run' && sawName === true
      && (openRest < 0 || !parameters[openRest].Ref)) {
      return false;
    }
  }
  if (unknown) return true;
  let mayReceiveNamedSuffix = false;
  const remaining = parameters.flatMap((p, slot) => {
    if (pinned.has(slot)) {
      if (p.Rest) mayReceiveNamedSuffix = true;
      return [];
    }
    // A pinned rest can give back values to later required parameters. Permit
    // all such omissions here, even when a concrete group cannot fill them.
    // This enlarges the possible routes and can never create a false refusal.
    return [{ ...p, Optional: p.Optional || mayReceiveNamedSuffix }];
  });
  return PositionalReferenceRoutePossible(remaining, positional);
}
