import { test, expect } from 'vitest';
import { run, evaluated } from '../harness.mts';

/**
 * How a type renders in a diagnostic.
 *
 * `displayType` is a switch ending `default: return t.Kind`, and four kinds had
 * no case - `object`, `function`, `reference`, `parameter` - so they printed
 * their KIND NAME. `let a: { x: int32 } = { y: 1 }` reported "is not assignable
 * to \"object\"", naming neither the type nor what was wrong with the value.
 *
 * Every other case renders SOURCE SYNTAX, so the convention was already set;
 * these four now follow it.
 *
 * The strings are DIAGNOSTICS, not an API - `Reflect.getReflection` is the
 * inspection surface. They are asserted here by containment rather than
 * equality so that surrounding wording can change without these failing.
 */

const message = (src: string): string => {
  const c = run(src) as { Type: string, Value?: { HostDefinedMessageString?: string } };
  return c.Type === 'throw' ? String(c.Value?.HostDefinedMessageString) : `NO THROW: ${src}`;
};

test('an object type renders its structure', () => {
  expect(message('type A = { x: int32 }; let a: A = { y: 1 };')).toContain('{ x: int.<32> }');
  expect(message('type A = { x: int32, y: float64 }; let a: A = 5;')).toContain('{ x: int.<32>, y: float64 }');
  // An optional property keeps its mark.
  expect(message('type A = { x?: int32 }; let a: A = 5;')).toContain('x?: int.<32>');
  // An index signature is held apart from the properties; a type with one and
  // no properties must not render as an empty object.
  expect(message('type O = { [k: string]: uint8 }; let o: O = 5;')).toContain('{ [string]: uint.<8> }');
  // A genuinely empty object type.
  expect(message('type O = { }; let o: O = 5;')).toContain('{}');
});

test('a symbol-keyed property renders its description', () => {
  // Interpolating a SymbolValue gives "[object Symbol]", which is the same class
  // of bug one layer down from the one being fixed.
  expect(message('const s = Symbol("tag"); type O = { [s]: uint8 }; let o: O = 5;')).toContain('{ [tag]: uint.<8> }');
});

test('a reference type renders its target', () => {
  expect(message('let r: ref uint8 = 5;')).toContain('ref uint.<8>');
});

test('a generic parameter renders its name and constraint', () => {
  // An unconstrained parameter is used where its own type is the target, so it
  // reaches the display through a constrained specialization being refused.
  expect(message('function f<T: uint8>(x: T): T { return x; } f.<string>("s");')).toContain('uint.<8>');
});

test('a function type renders its signature', () => {
  expect(message('let f: (x: uint8) => uint8 = 5;')).toContain('(x: uint.<8>) => uint.<8>');
  // A `void` return, which must not print as `null`.
  expect(message('let f: (x: uint8) => void = 5;')).toContain('=> void');
  // Overloads join with `&`, as an overloaded function type is written.
  // In CANONICAL member order (#sec-canonical-total-order), not written order:
  // the arms of an intersection sort, so the display does not depend on which
  // spelling reached the type first.
  expect(message('type F = ((x: uint8) => uint8) & ((x: float64) => float64); let f: F = 5;')).toContain('(x: float64) => float64 & (x: uint.<8>) => uint.<8>');
});

test('the display nests through other kinds', () => {
  // Each of these had the inner type swallowed even when the outer one rendered.
  expect(message('type A = { p: { x: int32 } }; let a: A = 5;')).toContain('{ p: { x: int.<32> } }');
  expect(message('let a: [].<{ x: int32 }> = 5;')).toContain('[].<{ x: int.<32> }>');
  // An ALL-OBJECT intersection displays as what it is. #sec-canonicalizetype
  // merges one - a shared member takes the intersection of the arms' types - so
  // `A & B` here IS `{ x: int.<32>, y: float64 }`, and naming the arms would name
  // a type record this specification does not keep. The message below at "is
  // required by" already named the merged form.
  expect(message('type A = { x: int32 }; type B = { y: float64 }; type C = A & B; let c: C = 5;')).toContain('{ x: int.<32>, y: float64 }');
  expect(message('type A = { x: int32 }; type B = { y: float64 }; type C = A | B; let c: C = 5;')).toContain('{ x: int.<32> } | { y: float64 }');
});

test('the two kinds the exhaustiveness check found', () => {
  // `pattern` and `range` also had no case, and were found by making the
  // default a `never` assignment rather than by reading the switch - reading it
  // counted four falling-through kinds and there were six.
  expect(message('let p: /ab+c/ = 5;')).toContain('/ab+c/');
  expect(message('let r: 0..<10 = "s";')).toContain('0..10');
  expect(message('let r: 0..=10 = "s";')).toContain('0..=10');
});

test('a shared type renders its target', () => {
  // `shared` had a case already, but reaching it takes care: a DIRECT binding of
  // a wrong value goes down the conversion-source path -
  // "a string is not a conversion source for ..." - which never consults the
  // display. It renders when the shared type is nested inside another, which is
  // where a reader most needs it.
  expect(message('let a: [].<shared uint32> = "s";')).toContain('[].<shared uint.<32>>');
  expect(message('type O = { s: shared uint32 }; let o: O = 5;')).toContain('{ s: shared uint.<32> }');
  expect(message('type U = shared uint32 | null; let u: U = "s";')).toContain('shared uint.<32>');
  // The intersection member is an OBJECT type rather than a bare `shared uint32`:
  // #sec-intersection-type-early-errors now rejects the written `A & shared uint32`,
  // no value being both an object and a `uint32`, so the display it was reached
  // through is unreachable from that spelling. An inhabited intersection carrying a
  // `shared` member exercises the same case.
  expect(message('type A = { a: uint8 }; type C = A & { s: shared uint32 }; let c: C = 5;')).toContain('{ a: uint.<8>, s: shared uint.<32> }');
});

test('the kinds that already rendered are unchanged', () => {
  // Asserted through the same mechanism so this change cannot quietly alter
  // them. `displayType` feeds every diagnostic in the engine.
  expect(message('let x: uint8 = "s";')).toContain('uint.<8>');
  expect(message('let x: [uint8, uint8] = 5;')).toContain('[uint.<8>, uint.<8>]');
  expect(message('let x: [3].<uint8> = 5;')).toContain('[3].<uint.<8>>');
  expect(message('let x: never = 5;')).toContain('never');
  // An INTERSECTION that stands. Two unrelated classes no longer do - no value
  // is an instance of both, so #sec-intersection-type-early-errors reports the
  // annotation - and an intersection with a non-~object~ arm is what survives
  // canonicalization's distribution as an intersection at all.
  expect(message('type C = [].<uint8> & { length: uint32 }; let c: C = 5;')).toContain('[].<uint.<8>> & { length: uint.<32> }');
  // `literal` and `any`. The literal form appears on the SOURCE side of almost
  // every message, and `any` renders where it is nested inside another type.
  //
  // A literal renders as its VALUE. It read "a literal type of number", which
  // named neither the value offered nor the one admitted - and when both sides
  // were literal types of one base they printed alike, so the message compared a
  // type with itself. A literal type IS one value, and naming it is what the
  // reader needs.
  expect(message('type L = 5; let x: L = 6;')).toContain('"6" is not assignable to "5"');
  expect(message('type O = { a: any }; let o: O = 5;')).toContain('{ a: any }');
  expect(message('let a: [].<any> = 5;')).toContain('[].<any>');
});

test('the display is not an identity', () => {
  // Two distinct types may render alike; rendering is for reading, and the
  // records remain distinct. `getReflection` is the inspection surface.
  //
  // The pair this once used, `{ x: int32 } & { x: float64 }`, is now reported at
  // the `&` (#sec-intersection-type-early-errors) because no value is both, so
  // the display point is made with an INHABITED intersection instead. The two
  // arms are not distributed away, an array not being an ~object~ arm.
  expect(message('type A = { x: int32 }; type B = { y: int32 }; type C = A & B; let c: C = { x: 1 };')).toContain('is required by');
  const c = run('type A = [].<uint8>; type B = { length: uint32 }; type C = A & B; const r = Reflect.getReflection(C); String(r.kind);') as { Value?: { stringValue?: () => string } };
  expect(c.Value?.stringValue?.()).toBe('intersection');
});

test('an intersection refusal names the member, and a conflict is reported at the `&`', () => {
  // Two refusals that once shared a message are now separated, because
  // #sec-canonicalizetype distributes an all-object intersection and there is no
  // longer an "arm that rejected" to name.
  //
  // A CONFLICTING member pair empties the type, so it is reported where both
  // types are written rather than at a use of the annotation.
  const conflict = message('type A = { x: int32 }; type B = { x: float64 }; type C = A & B;');
  expect(conflict).toContain('no value is of both');
  expect(conflict).toContain('at member "x"');

  // A MISSING member is a member of the distributed shape that was not supplied,
  // and the message names the key and that shape - which is strictly more than
  // naming the arm, the arm being one the reader must still locate.
  expect(message('type A = { x: int32 }; type B = { y: int32 }; type C = A & B; let c: C = { x: 1 };')).toContain('"y" is required by "{ x: int.<32>, y: int.<32> }"');
  expect(message('type A = { x: int32 }; type B = { y: int32 }; type C = A & B; let c: C = { y: 1 };')).toContain('"x" is required by "{ x: int.<32>, y: int.<32> }"');
});

test('an inhabitable intersection is unaffected', () => {
  // The improvement is about DISPLAY, not about detecting conflicts: a value
  // satisfying every member still passes, and a wrong value against an
  // inhabitable intersection gets the same improved message.
  const c = run('type A = { x: int32 }; type B = { y: int32 }; type C = A & B; let c: C = { x: 1, y: 2 }; String(Number(c.x));') as { Value?: { stringValue?: () => string } };
  expect(c.Value?.stringValue?.()).toBe('1');
});

test('StaticTypeError sits directly under Error', () => {
  // #sec-type-errors makes a DECIDABLE violation an Early Error and
  // "reserves a thrown *TypeError* for the ~any~ boundary". One constructor
  // cannot mean both "catchable here" and "the source was rejected" - a program
  // could not tell which it had - so the rejection gets its own class.
  //
  // It sits flat under `Error`, as every native error does and as
  // `WebAssembly.CompileError` does for the same reason: a source that parses
  // and then fails VALIDATION is not a parse failure.
  expect(evaluated('String(typeof StaticTypeError);')).toBe('function');
  expect(evaluated('String(StaticTypeError.name);')).toBe('StaticTypeError');
  // Both links: the constructor's and the prototype's.
  expect(evaluated('String(Object.getPrototypeOf(StaticTypeError) === Error);')).toBe('true');
  expect(evaluated('String(Object.getPrototypeOf(StaticTypeError.prototype) === Error.prototype);')).toBe('true');
  expect(evaluated('const e = new StaticTypeError("x"); String((e instanceof StaticTypeError) && (e instanceof Error));')).toBe('true');
  // ...and it is NOT either of the things it must be distinguishable from.
  // `SyntaxError` would make a loader catching parse failures catch these; the
  // syntax of a program this rejects is well formed.
  expect(evaluated('const e = new StaticTypeError("x"); String(e instanceof TypeError);')).toBe('false');
  expect(evaluated('const e = new StaticTypeError("x"); String(e instanceof SyntaxError);')).toBe('false');
  expect(evaluated('String(new StaticTypeError("boom"));')).toBe('StaticTypeError: boom');
});

test('a literal type renders as its value, in every kind', () => {
  // The point of the change: the two sides of a message about literals are
  // distinguishable. Each case below printed identically before, as "a literal
  // type of <base>".
  expect(message('type L = 5; let x: L = 6;')).toContain('"6" is not assignable to "5"');
  expect(message(`type L = 'a'; let x: L = 'b';`)).toContain(`"'b'" is not assignable to "'a'"`);
  expect(message('type L = true; let x: L = false;')).toContain('"false" is not assignable to "true"');
  // A union of literals names every arm, which is what makes a constraint
  // failure readable.
  expect(message(`type L = 'a' | 'b'; let x: L = 'c';`)).toContain(`"'a' | 'b'"`);
  // The base still describes a literal whose value is not a printable leaf.
  expect(message('let u: uint8 = 300;')).toContain('"300" is not assignable to "uint.<8>"');
});

test('the four refusals an intersection target gives are distinct', () => {
  // Pinned side by side because they were once ONE message, and because the two
  // that matter most are now raised in different places.
  //
  // A CONFLICT is a property of the TYPE - no value has both member types - so
  // #sec-intersection-type-early-errors reports it at the `&`, where both types
  // are written and before any use of the annotation. The other three are
  // properties of a VALUE, so they are reported where the value is.
  //
  // The conflict message once read "does not satisfy" and named an ARM. It
  // cannot now: #sec-canonicalizetype distributes an all-object intersection,
  // so there is no arm left to name, and the walk that re-derived one was the
  // defect that refused `{ a: number } & { a: 5 }` - a type its own direct
  // spelling accepts. Naming the MEMBER is what replaced it.
  const AB = 'type A = { x: int32 }; type B = { y: int32 }; type C = A & B;';

  // 1. Conflict: at the `&`, naming both types and the member.
  expect(message('type A = { x: int32 }; type B = { x: float64 }; type C = A & B;'))
    .toContain('no value is of both "int.<32>" and "float64" at member "x"');

  // 2. Missing: at the value, naming the key and the DISTRIBUTED shape. The
  //    shape is what the program's type is, and naming an arm would send the
  //    reader looking for a declaration the type no longer has.
  expect(message(`${AB} let c: C = { x: 1 };`))
    .toContain('"y" is required by "{ x: int.<32>, y: int.<32> }" and is not supplied');
  expect(message(`${AB} let c: C = { y: 1 };`))
    .toContain('"x" is required by "{ x: int.<32>, y: int.<32> }" and is not supplied');

  // 3. Wrong type: the member's own assignability failure, naming the two types
  //    and neither the shape nor the arm - the mismatch is at the member.
  // The String literal renders in SINGLE quotes, matching the Type Object
  // display (`keyof { a: uint8 }` reads `'a'`) and nesting cleanly inside the
  // formatter's own double quotes.
  expect(message(`${AB} let c: C = { x: 1, y: "s" };`))
    .toContain(`"'s'" is not assignable to "int.<32>"`);

  // 4. Excess: freshness, against the distributed shape. An intersection
  //    DECLARES the union of its arms' keys, so the shape here is the same one
  //    the missing-member rule reads, and the two must agree on it.
  expect(message(`${AB} let c: C = { x: 1, y: 2, z: 3 };`))
    .toContain('"z" is not declared by "{ x: int.<32>, y: int.<32> }"');

  // None of the four is any of the others.
  const conflict = message('type A = { x: int32 }; type B = { x: float64 }; type C = A & B;');
  expect(conflict).not.toContain('is required by');
  expect(conflict).not.toContain('is not declared by');
  expect(message(`${AB} let c: C = { x: 1 };`)).not.toContain('no value is of both');
  expect(message(`${AB} let c: C = { x: 1, y: 2, z: 3 };`)).not.toContain('is required by');
});
