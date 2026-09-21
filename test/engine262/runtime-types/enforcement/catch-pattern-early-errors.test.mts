import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

// Check phase and effects as well as the outcome, including unused bodies.
test.each([
  [
    "R61-01: filtered object member unused",
    "function f(){try{}catch({x}:{x:uint8}){x();}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-02: filtered object member executed",
    "function f(){try{throw {x:uint8(1)};}catch({x}:{x:uint8}){x();}}f();",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-03: noniterable filter unused",
    "function f(){try{}catch([x]:uint8){}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-04: noniterable filter executed",
    "function f(){try{throw uint8(1);}catch([x]:uint8){}}f();",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-05: null object filter unused",
    "function f(){try{}catch({}:null){}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-06: null object filter executed",
    "function f(){try{throw null;}catch({}:null){}}f();",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-07: object member default unused",
    "function f(){try{}catch({x:n:uint8=\"bad\"}){}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-08: object member default executed",
    "function f(){try{throw {};}catch({x:n:uint8=\"bad\"}){}}f();",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-09: array member default unused",
    "function f(){try{}catch([x:uint8=\"bad\"]){}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-10: array member default executed",
    "function f(){try{throw [];}catch([x:uint8=\"bad\"]){}}f();",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-11: array rest annotation unused",
    "function f(){try{}catch([...x:uint8]){}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-12: array rest annotation executed",
    "function f(){try{throw [];}catch([...x:uint8]){}}f();",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-13: filtered contribution boundary",
    "function f(){try{}catch({x}:{x:uint8}){let n:boolean=x;}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-14: member annotation already checked",
    "function f(){try{}catch({x:n:uint8}){n();}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-15: valid typed filter",
    "function f(){try{throw {x:uint8(1)};}catch({x}:{x:uint8}){globalThis.settled=String(x);}}f();",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "1",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-16: valid default",
    "function f(){try{throw {};}catch({x:n:uint8=1}){globalThis.settled=String(n);}}f();",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "1",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-17: dynamic callable",
    "function f(){try{throw {x:()=>{}};}catch({x}){x();}}f();",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-18: dynamic failure stays runtime",
    "function f(){try{throw {x:1};}catch({x}){x();}}f();",
    {
      "completion": "throw",
      "kind": "TypeError",
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-19: filter misses then fallback",
    "function f(){try{throw \"s\";}catch({x}:{x:uint8}){globalThis.settled=\"wrong\";}catch(e){globalThis.settled=\"fallback\";}}f();",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "fallback",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R61-20: untyped catch shadows typed outer name",
    "let x:uint8=1;try{throw {x:()=>{}};}catch({x}){x();}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});

// Adjacent controls and regressions found while implementing the recommendation.
test.each([
  [
    "R13-extra-48: function f(){try{throw {a:{x:uint8(1)}};}catch({a:{x}}:{a:{x:uint8}}){x();}}",
    "function f(){try{throw {a:{x:uint8(1)}};}catch({a:{x}}:{a:{x:uint8}}){x();}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-49: function f(){try{}catch({[do{let x:uint8=\"bad\";\"x\";}]:n}){}}",
    "function f(){try{}catch({[do{let x:uint8=\"bad\";\"x\";}]:n}){}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-50: async function f(){try{await Promise.reject({x:uint8(1)});}catch({x}:{x:uint8}){globalThis.settled=String(x);}}f();",
    "async function f(){try{await Promise.reject({x:uint8(1)});}catch({x}:{x:uint8}){globalThis.settled=String(x);}}f();",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "1",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-61: function f(){try{throw {x:uint8(1)};}catch({(ref x:uint8)}){x=2;}}f();",
    "function f(){try{throw {x:uint8(1)};}catch({(ref x:uint8)}){x=2;}}f();",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-62: function f(){try{}catch({(ref x:uint8)=1}){}}",
    "function f(){try{}catch({(ref x:uint8)=1}){}}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});
