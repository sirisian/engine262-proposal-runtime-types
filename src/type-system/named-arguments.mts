export interface NamedSlot {
  Name: string;
  Rest: boolean;
  Optional: boolean;
}

export interface ArgumentItem<T> {
  name?: string;
  value: T;
}

/** BindArguments: pin names first, then match the remaining positional list. */
export function BindNamedArguments<T, P extends NamedSlot>(
  parameters: readonly P[],
  args: readonly ArgumentItem<T>[],
  assign: (parameters: readonly P[], values: readonly T[]) => readonly number[] | null,
): { groups: T[][], error?: 'unknown-name' | 'position-after-name' | 'unmatched', name?: string } {
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
        return { groups, error: 'unknown-name', name: arg.name };
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
      return { groups, error: 'position-after-name' };
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
  const counts = assign(remaining.map(({ p }) => p), positional);
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
