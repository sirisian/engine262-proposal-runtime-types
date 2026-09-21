import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

// Preserve the error phase as well as the outcome and observable effects.
test.each([
  [
    "B12-E01: specialized getter read",
    "class C<T>{get x():T{throw 0;}}function f(c:C.<uint8>){let s:string=c.x;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "B12-E02: specialized setter rejects incompatible store",
    "class C<T>{set x(v:T){}}function f(c:C.<uint8>){c.x=\"bad\";}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "B12-E03: specialized setter accepts compatible store",
    "class C<T>{set x(v:T){globalThis.settled=String(v);}}function f(c:C.<uint8>){c.x=1;}f(new C.<uint8>());",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1"
    }
  ],
  [
    "B12-E04: write-only parameter is found and substituted",
    "class C<T>{get x():string{return \"read\";}set x(v:T|string){globalThis.settled=String(v);}}function f(c:C.<uint8>){c.x=1;}f(new C.<uint8>());",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1"
    }
  ],
  [
    "B12-E05: outer alias cannot replace setter parameter",
    "type T=string;class C<T>{set x(v:T){globalThis.settled=String(v);}}function f(c:C.<uint8>){c.x=1;}f(new C.<uint8>());",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1"
    }
  ],
  [
    "B12-E06: inherited getter specialization",
    "class B<T>{get x():T{throw 0;}}class C extends B.<uint8>{}function f(c:C){let s:string=c.x;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "B12-E07: inherited setter specialization",
    "class B<T>{set x(v:T){globalThis.settled=String(v);}}class C extends B.<uint8>{}function f(c:C){c.x=1;}f(new C());",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1"
    }
  ],
  [
    "B12-E08: private method survives typed boundary",
    "class C{#v:uint8=1;#m():uint8{return this.#v;}f(o:C):uint8{return o.#m();}}const c=new C();globalThis.settled=String(c.f(c));",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1"
    }
  ],
  [
    "B12-E09: private method identity survives copy",
    "class C{#v:uint8=1;#m():uint8{return this.#v;}same(o:C):boolean{return o.#m===this.#m;}}const c=new C();globalThis.settled=String(c.same(c));",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "true"
    }
  ],
  [
    "B12-E10: private accessors preserve value copy isolation",
    "class C{#v:uint8=1;get #x():uint8{return this.#v;}set #x(v:uint8){this.#v=v;}read():uint8{return this.#x;}change(o:C):uint8{o.#x=2;return o.#x;}}const c=new C();globalThis.settled=String(c.change(c))+\":\"+String(c.read());",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "2:1"
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});
