import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

// Preserve the error phase as well as the outcome and observable effects.
test.each([
  [
    "R57-01: import-options-unused",
    "function f(o:uint8){return import(\"m\",o);}",
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
    "R57-02: import-options-run",
    "function f(o:uint8){return import(\"m\",o);}f(1).catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
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
    "R57-03: import-with-unused",
    "function f(o:{with:uint8}){return import(\"m\",o);}",
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
    "R57-04: import-with-run",
    "function f(o:{with:uint8}){return import(\"m\",o);}f({with:1}).catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
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
    "R57-05: import-inherited-with",
    "function f(o:{with:uint8}){return import(\"m\",o);}f(Object.create({with:1})).catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
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
    "R57-06: import-undefined",
    "function f(o:undefined){return import(\"m\",o);}f(undefined).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "hookRan": "false",
      "imports": [
        "m"
      ]
    }
  ],
  [
    "R57-07: import-optional-with",
    "function f(o:{with?:uint8}){return import(\"m\",o);}f({}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "hookRan": "false",
      "imports": [
        "m"
      ]
    }
  ],
  [
    "R57-08: import-nonenumerable-attribute2",
    "function f(o:{with:{type:uint8}}){return import(\"m\",o);}const attrs=Object.defineProperty({},\"type\",{value:1,enumerable:false,writable:true});f({with:attrs}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "hookRan": "false",
      "imports": [
        "m"
      ]
    }
  ],
  [
    "R57-09: null options unused",
    "function f(o:null){return import(\"m\",o);}",
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
    "R57-10: all primitive options union",
    "function f(o:uint8|boolean){return import(\"m\",o);}",
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
    "R57-11: null with unused",
    "function f(o:{with:null}){return import(\"m\",o);}",
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
    "R57-12: bad with getter never executed",
    "class O{get with():uint8{globalThis.hookRan=true;return 1;}}function f(o:O){return import(\"m\",o);}",
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
    "R57-13: undefined options union is viable",
    "function f(o:uint8|undefined){return import(\"m\",o);}f(undefined).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "imports": [
        "m"
      ]
    }
  ],
  [
    "R57-14: undefined with value valid",
    "function f(o:{with:undefined}){return import(\"m\",o);}f({with:undefined}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "imports": [
        "m"
      ]
    }
  ],
  [
    "R57-15: with union has viable Object",
    "function f(o:{with:uint8|object}){return import(\"m\",o);}f({with:{}}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "imports": [
        "m"
      ]
    }
  ],
  [
    "R57-16: open options valid",
    "function f(o:object){return import(\"m\",o);}f({}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "imports": [
        "m"
      ]
    }
  ],
  [
    "R57-17: any options retain promise rejection",
    "function f(o:any){return import(\"m\",o);}f(1).catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "TypeError",
      "imports": []
    }
  ],
  [
    "R57-18: ordinary JavaScript retains rejection",
    "import(\"m\",1).catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "TypeError",
      "imports": []
    }
  ],
  [
    "R57-19: String attributes reach separate host support check",
    "function f(o:{with:{type:string}}){return import(\"m\",o);}f({with:{type:\"json\"}}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "TypeError",
      "settledMessage": "Unsupported import attribute \"type\"",
      "imports": []
    }
  ],
  [
    "R57-20: typed enumerable attribute remains deferred in this recommendation",
    "function f(o:{with:{type:uint8}}){return import(\"m\",o);}f({with:{type:1}}).catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "TypeError",
      "imports": []
    }
  ],
  [
    "R57-E01: mixed options and with failures",
    "function f(o:uint8|{with:boolean}){import(\"m\",o);}",
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
    "R57-E02: inherited specialized with",
    "class B<T>{get with():T{throw 0;}}class C extends B.<uint8>{}function f(o:C){import(\"m\",o);}",
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
    "R57-E03: unknown generic with",
    "function f<T>(o:{with:T}){import(\"m\",o);}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R57-E04: function options are Objects",
    "function f(o:()=>void){return import(\"m\",o);}f(()=>{}).then(()=>globalThis.settled=\"ok\");",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "imports": [
        "m"
      ]
    }
  ],
  [
    "R57-E05: getter selected once at runtime",
    "let reads=0;class O{get with():object{reads++;return {};}}function f(o:O){return import(\"m\",o);}f(new O()).then(()=>globalThis.settled=String(reads));",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1",
      "imports": [
        "m"
      ]
    }
  ],
  [
    "R57-E06: valid with union",
    "function f(o:{with:null|undefined}){return import(\"m\",o);}f({with:undefined}).then(()=>globalThis.settled=\"ok\");",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "imports": [
        "m"
      ]
    }
  ],
  [
    "R57-E07: generic getter with outer alias",
    "type T=object;class O<T>{get with():T{throw 0;}}function f(o:O.<uint8>){import(\"m\",o);}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});
