export interface NamedSlot {
  Name: string;
  Rest: boolean;
  Optional: boolean;
}

export interface ArgumentItem<T> {
  name?: string;
  value: T;
  /** A forwarded second-class run must reach another reference-rest position. */
  referenceRun?: boolean;
}

export interface NamedBindingPlan<T, P extends NamedSlot> {
  groups: T[][];
  error?: 'unknown-name' | 'position-after-name' | 'unmatched';
  name?: string;
  remaining: { p: P, i: number }[];
  positional: T[];
}

/** Pin names without reading values; runtime admission can then suspend. */
export function PrepareNamedArguments<T, P extends NamedSlot>(
  parameters: readonly P[],
  args: readonly ArgumentItem<T>[],
): NamedBindingPlan<T, P> {
  const groups = parameters.map(() => [] as T[]);
  const pinned = new Set<number>();
  const positional: T[] = [];
  let sawName = false;
  let openRest = -1;
  for (const arg of args) {
    if (arg.name !== undefined) {
      sawName = true;
      const slot = parameters.findIndex((p) => p.Name === arg.name);
      if (slot < 0) {
        return { groups, error: 'unknown-name', name: arg.name, remaining: [], positional };
      }
      pinned.add(slot);
      if (parameters[slot].Rest) {
        groups[slot].push(arg.value);
        openRest = slot;
      } else {
        groups[slot] = [arg.value];
        openRest = -1;
      }
    } else if (openRest >= 0) {
      groups[openRest].push(arg.value);
    } else if (!sawName) {
      positional.push(arg.value);
    } else {
      return { groups, error: 'position-after-name', remaining: [], positional };
    }
  }
  // A named rest gives back a suffix needed by required parameters after it.
  // Names already pinned elsewhere and earlier positionals count as supplied.
  for (let slot = 0; slot < parameters.length; slot += 1) {
    if (!pinned.has(slot) || !parameters[slot].Rest) {
      continue;
    }
    const required = parameters.map((p, i) => ({ p, i }))
      .filter(({ p, i }) => !pinned.has(i) && !p.Optional && !p.Rest);
    const shortfall = Math.max(0, required.length - positional.length);
    // A later named rest supplies its own segment. Giving this group's values
    // to parameters beyond that rest would make reordering names change calls.
    let end = slot + 1;
    while (end < parameters.length && !(pinned.has(end) && parameters[end].Rest)) end += 1;
    const trailing = required.filter(({ i }) => i > slot && i < end);
    const count = Math.min(shortfall, trailing.length, groups[slot].length);
    if (count > 0) {
      const values = groups[slot].splice(groups[slot].length - count, count);
      trailing.slice(-count).forEach(({ i }, j) => {
        groups[i] = [values[j]];
        pinned.add(i);
      });
    }
  }
  const remaining = parameters.map((p, i) => ({ p, i })).filter(({ i }) => !pinned.has(i));
  return { groups, remaining, positional };
}

/** Complete the same placement after static or runtime positional admission. */
export function CompleteNamedArguments<T, P extends NamedSlot>(
  plan: NamedBindingPlan<T, P>, counts: readonly number[] | null,
): { groups: T[][], error?: 'unknown-name' | 'position-after-name' | 'unmatched', name?: string } {
  if (plan.error) return plan;
  const { groups, remaining, positional } = plan;
  if (!counts) {
    // Retain destinations for static diagnostics even where the match failed.
    let cursor = 0;
    remaining.forEach(({ p, i }, at) => {
      const tail = remaining.slice(at + 1).filter(({ p: q }) => !q.Optional && !q.Rest).length;
      const count = p.Rest ? Math.max(0, positional.length - cursor - tail) : 1;
      groups[i].push(...positional.slice(cursor, cursor + count));
      cursor += count;
    });
    return { groups, error: 'unmatched' };
  }
  let cursor = 0;
  remaining.forEach(({ i }, at) => {
    groups[i].push(...positional.slice(cursor, cursor + counts[at]));
    cursor += counts[at];
  });
  return { groups };
}

/** BindArguments: the synchronous checker uses the same preparation and finish. */
export function BindNamedArguments<T, P extends NamedSlot>(
  parameters: readonly P[], args: readonly ArgumentItem<T>[],
  assign: (parameters: readonly P[], values: readonly T[]) => readonly number[] | null,
): { groups: T[][], error?: 'unknown-name' | 'position-after-name' | 'unmatched', name?: string } {
  const plan = PrepareNamedArguments(parameters, args);
  if (plan.error) return plan;
  return CompleteNamedArguments(plan, assign(plan.remaining.map(({ p }) => p), plan.positional));
}

// Argument-list metadata is owned by one evaluation, not by a user value or
// function. A zero-length expansion still records a forwarding occurrence.
const emptyReferenceRuns = new WeakMap<object, readonly number[]>();

export function SetEmptyReferenceRuns(items: object, offsets: readonly number[]): void {
  if (offsets.length) emptyReferenceRuns.set(items, offsets);
}

export function EmptyReferenceRunsOf(items: object): readonly number[] {
  return emptyReferenceRuns.get(items) ?? [];
}

/** Judge forwarding against the selected binding, without inventing arguments. */
export function ReferenceRunsAdmitted(
  parameters: readonly (NamedSlot & { Ref?: boolean })[],
  items: readonly Pick<ArgumentItem<unknown>, 'name' | 'referenceRun'>[],
  groups: readonly (readonly number[])[],
): boolean {
  const accepts = (k: number) => parameters[k].Rest && parameters[k].Ref === true;
  for (let k = 0; k < groups.length; k += 1) {
    if (!accepts(k) && groups[k].some((i) => items[i].referenceRun)) return false;
  }
  for (const offset of EmptyReferenceRunsOf(items)) {
    let sawName = false;
    let openRest = -1;
    for (let i = 0; i < offset; i += 1) {
      if (items[i].name !== undefined) {
        sawName = true;
        const k = parameters.findIndex((p) => p.Name === items[i].name);
        openRest = k >= 0 && parameters[k].Rest ? k : -1;
      }
    }
    if (sawName) {
      if (openRest < 0 || !accepts(openRest)) return false;
      continue;
    }
    // Before any name, the marker lies in the positional subsequence. Named
    // groups (including their given-back suffix) do not consume this cursor.
    const firstName = items.findIndex((item) => item.name !== undefined);
    const end = firstName < 0 ? items.length : firstName;
    let cursor = 0;
    let admitted = false;
    for (let k = 0; k < groups.length; k += 1) {
      if (groups[k].some((i) => i >= end)) continue;
      const next = cursor + groups[k].length;
      if (accepts(k) && cursor <= offset && offset <= next) admitted = true;
      cursor = next;
    }
    if (!admitted) return false;
  }
  return true;
}

/** Positional occurrences are distributed among the unpinned parameters. */
export function PositionalReferenceRuns(items: readonly Pick<ArgumentItem<unknown>, 'name' | 'referenceRun'>[]) {
  const firstName = items.findIndex((item) => item.name !== undefined);
  const end = firstName < 0 ? items.length : firstName;
  return { entries: new Set(items.slice(0, end).flatMap((item, i) => item.referenceRun ? [i] : [])),
    empty: EmptyReferenceRunsOf(items).filter((offset) => offset <= end) };
}
