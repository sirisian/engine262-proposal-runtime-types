import { test, expect } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowing: the facts holding where control joins are the join of the facts on
// every path reaching it; a path through a statement that cannot complete normally
// (#sec-divergence) contributes none. A test those facts settle is judged by
// #sec-narrowfrom.

test.each([
  "function f(x: string | null, y: string | null) { if (x === null || y === null) return; if (x === null) {} }",
  "function f(x: string | null, y: string | null) { if (!x || !y) return; if (x === null) {} }",
  "function f(x: string | null, y: string | null) { if (x !== null && y !== null) {} else { return; } if (x === null) {} }",
  "function f(x: string | null, y: string | null) { if (!(x !== null && y !== null)) return; if (y === null) {} }",
  "function mk2() { return Reflect.makeType({ kind: \"function\", signatures: [{ parameters: [{ name: \"a\", type: type any },{ name: \"b\", type: type any }], return: { type: type boolean }, narrows: [{ target: \"a\", type: type uint8 },{ target: \"b\", type: type uint8 }] }] }); } type G2 = mk2(); const both: G2 = (a, b) => true; function f(a: uint8 | string, b: uint8 | string) { if (!both(a, b)) return; if (b is string) {} }",
  "function next(): string | null { return null; } function f(x: string | null) { while (x !== null) { x = next(); } if (x === null) {} }",
  "function f(x: string | null) { for (; x !== null;) { return; } if (x !== null) {} }",
  "function f(x: uint8 | string) { while (x is string) { return; } if (x is string) {} }",
  "function f(x: 'a' | 'b' | 'c') { switch (x) { case 'a': return 1; case 'b': return 2; } if (x === 'a') {} return 3; }",
])("a test the surviving path settles is refused: %s", expectStaticTypeError);

test.each([
  "function f(x: string | null, y: string | null) { if (x === null || y === null) return; let s: string = x; let t: string = y; } 'ok';",
  "function next(): string | null { return null; } function f(x: string | null) { while (x !== null) { if (x === 'q') break; x = next(); } if (x === null) {} } 'ok';",
  "function f(x: 'a' | 'b' | 'c') { switch (x) { case 'a': return 1; case 'b': break; } if (x === 'b') {} return 3; } 'ok';",
  "function f(x: string | null, y: string | null) { if (x === null && y === null) return; if (x === null) {} } 'ok';",
  "function f(x: uint8 | string) { for (let i = 0; i < 2; i++) {} if (x is string) {} } f('a'); 'ok';",
])("a test the joined paths leave open is accepted: %s", (source) => expect(ok(source)).toBe(true));
