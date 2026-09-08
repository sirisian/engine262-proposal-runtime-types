import { test, expect } from 'vitest';
import { kit, evaluateBuilder } from '../corpus/type-challenges/harness.mts';

/**
 * The three StringPattern builders of the standard kit, shipped.
 *
 * They were withheld on the ground that a shipped export cements a name taken
 * from a flat, first-come meta namespace. That ground is gone: `StringPattern`
 * is a hardcoded intrinsic that already claims `pattern` in every realm, and a
 * user `meta` block claiming it is refused - so withholding preserved nothing,
 * and the name cannot be returned either way. What stays reversible is the other
 * half: validation is live, so these do real work now, while the subtype judgment
 * is the floor of reflexivity and can be strengthened later by R18 without
 * breaking anyone.
 *
 * Being unexported also hid a defect. All three build their type through
 * `makeType` with a RegExp, which was flattened to its own properties until the
 * metadata round trip was fixed - so none of them worked, and nothing ran them.
 */

function run(program: string): string {
  const c = evaluateBuilder(kit(program));
  return c.completion === 'normal' ? String(c.value) : 'refused';
}

test('suffixed admits a string with the suffix and refuses one without', () => {
  expect(run('type T = suffixed("Id"); let v: T = "userId"; String(v);')).toBe('userId');
  expect(run('type T = suffixed("Id"); let v: T = "user"; String(v);')).toBe('refused');
});

test('prefixed is its mirror', () => {
  expect(run('type T = prefixed("get"); let v: T = "getName"; String(v);')).toBe('getName');
  expect(run('type T = prefixed("get"); let v: T = "setName"; String(v);')).toBe('refused');
});

test('the affix is escaped, not read as a pattern', () => {
  // `.` in the suffix is a literal dot, so "aXjs" does not satisfy `suffixed(".js")`.
  expect(run('type T = suffixed(".js"); let v: T = "a.js"; String(v);')).toBe('a.js');
  expect(run('type T = suffixed(".js"); let v: T = "aXjs"; String(v);')).toBe('refused');
});

test('stringPattern takes a RegExp and validates the whole string', () => {
  expect(run('type T = stringPattern(/^a+$/); let v: T = "aaa"; String(v);')).toBe('aaa');
  expect(run('type T = stringPattern(/^a+$/); let v: T = "b"; String(v);')).toBe('refused');
});

test('one pattern written twice is one type, which is why source and flags are carried', () => {
  expect(run('type A = suffixed("Id"); type B = suffixed("Id"); String(A === B);')).toBe('true');
});
