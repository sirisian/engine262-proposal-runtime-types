import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowto reads `boolean` as `true | false` inside narrowing, leaving the
// subtype rule of #sec-literal-types untouched, so a failed `b === true` leaves
// `false`, and a `default` past labels for every value of `boolean`, `null` and
// `undefined` can never be taken (#sec-narrowfrom). A written literal union stays outside.

test.each([
  "function f(b: boolean) { switch (b) { case true: return 1; case false: return 2; default: return 3; } }",
  "function f(b: boolean | null) { switch (b) { case true: return 1; case false: return 2; case null: return 4; default: return 3; } }",
  "function f(b: boolean) { if (b === true) {} else if (b === false) {} else {} }",
])("a test the closed set settles is refused: %s", expectStaticTypeError);

test.each([
  "function f(b: boolean) { switch (b) { case true: return 1; } return 0; } 'ok';",
  "function f(b: true | false) { switch (b) { case true: return 1; case false: return 2; default: return 3; } } 'ok';",
  "function f(b: boolean) { switch (b) { case true: return 1; default: return 3; } } 'ok';",
  "function f(b: boolean) { if (b === true) { let t: true = b; } else { let u: false = b; } } 'ok';",
])("a test the closed set leaves open is accepted: %s", (source) => expect(ok(source)).toBe(true));
