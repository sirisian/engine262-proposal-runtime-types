import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-get-array.prototype.capacity

test.each([
  [
    "known capacity descriptor has no setter",
    "let a:[].<uint8>=[1]; a.capacity=4;"
  ],
  [
    "known size descriptor has no setter",
    "const m=new Map();m.size=4;"
  ],
  [
    "compound capacity store",
    "let a:[].<uint8>=[1];a.capacity+=1;"
  ],
  [
    "capacity update",
    "let a:[].<uint8>=[1];a.capacity++;"
  ],
  [
    "executing logical capacity store",
    "let a:[].<uint8>=[1];a.capacity&&=4;"
  ],
  [
    "empty capacity logical store",
    "let a:[].<uint8>=[];a.capacity||=4;"
  ],
  [
    // #sec-narrowing: `??=` on a capacity that can never be nullish can never store.
    "nullish capacity store is dead code",
    "let a:[].<uint8>=[1];a.capacity??=4;"
  ]
])('%s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "capacity write good",
    "let a:[].<uint8>=[1]; a.reserve(4);"
  ],
  [
    "capacity shadow",
    "let a:[].<uint8>=[1]; Object.defineProperty(a,\"capacity\",{value:1,writable:true}); a.capacity=4;"
  ],
  [
    "capacity prototype replaced",
    "const a:[].<uint8>=[1]; Object.defineProperty(Object.getPrototypeOf(a),\"capacity\",{set(v){globalThis.__observation=String(v);}});a.capacity=4;"
  ],
  [
    "array capacity store",
    "function unused(a: [].<uint8>) { a.capacity = 4; }"
  ],
  [
    "truthy capacity skips logical or",
    "let a:[].<uint8>=[1];a.capacity||=4;"
  ],
  [
    "empty capacity skips logical and",
    "let a:[].<uint8>=[];a.capacity&&=4;"
  ]
])('%s', (_name, source) => {
  expect(ok(source)).toBe(true);
});
