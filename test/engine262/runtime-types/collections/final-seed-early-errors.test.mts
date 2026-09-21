import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

test.each([
  {
    "name": "R70-01: Map value seed unused",
    "source": "function f(){new Map.<string,uint8>([[\"x\",\"bad\"]]);}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-02: Map value seed executed",
    "source": "new Map.<string,uint8>([[\"x\",\"bad\"]]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-03: Map key seed unused",
    "source": "function f(){new Map.<uint8,string>([[\"bad\",\"x\"]]);}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-04: Map key seed executed",
    "source": "new Map.<uint8,string>([[\"bad\",\"x\"]]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-05: Map annotation adoption unused",
    "source": "function f(){const m:Map.<string,uint8>=new Map([[\"x\",\"bad\"]]);}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-06: Set annotation adoption unused",
    "source": "function f(){const s:Set.<uint8>=new Set([\"bad\"]);}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-07: Set annotation adoption executed",
    "source": "const s:Set.<uint8>=new Set([\"bad\"]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-08: invalid final overwrite",
    "source": "new Map.<string,uint8>([[\"x\",1],[\"x\",\"bad\"]]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-09: valid final overwrite",
    "source": "globalThis.settled=String(new Map.<string,uint8>([[\"x\",\"bad\"],[\"x\",1]]).get(\"x\"));",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-10: Map literal conversions valid",
    "source": "globalThis.settled=String(new Map.<string,uint8>([[\"x\",1]]).get(\"x\"));",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-11: Set explicit already rejects",
    "source": "function f(){new Set.<uint8>([\"bad\"]);}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-12: empty Map valid",
    "source": "new Map.<string,uint8>([]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-13: nullish seed means empty",
    "source": "new Set.<uint8>(null);new Map.<string,uint8>(undefined);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-14: untyped collections remain valid",
    "source": "new Map([[\"x\",\"bad\"]]);new Set([\"bad\"]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-15: unknown adoption remains runtime",
    "source": "function f(xs:any){const s:Set.<uint8>=new Set(xs);}f([\"bad\"]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-16: overridden iterator on ordinary seed remains dynamic",
    "source": "const seed:any=[[\"x\",\"bad\"]];seed[Symbol.iterator]=function*(){yield [\"x\",1];};globalThis.settled=String(new Map.<string,uint8>(seed).get(\"x\"));",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-17: custom Map constructor remains dynamic",
    "source": "function f(Map:any){return new Map([[\"x\",\"bad\"]]);}f(function(){});",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-18: different key leaves bad final entry",
    "source": "new Map.<string,uint8>([[\"x\",\"bad\"],[\"y\",1]]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-19: unknown final key can overwrite",
    "source": "function f(k:any){new Map.<string,uint8>([[\"x\",\"bad\"],[k,1]]);}f(\"x\");",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-20: nested value seed preserves literal structure",
    "source": "function f(){new Map.<string,{n:uint8}>([[\"x\",{n:\"bad\"}]]);}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-21: explicitly replaced constructor",
    "source": "Map=function(){return {};};new Map.<string,uint8>([[\"x\",\"bad\"]]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-22: local generic Map is not intrinsic",
    "source": "class Map<K,V>{constructor(x:any){}}new Map.<string,uint8>([[\"x\",\"bad\"]]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-23: declared conversion remains allowed",
    "source": "class Box{constructor(s:string){this.s=s;}}new Map.<string,Box>([[\"x\",\"value\"]]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-24: nested value seed executed",
    "source": "new Map.<string,{n:uint8}>([[\"x\",{n:\"bad\"}]]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-01: constant primitive overwrite",
    "source": "new Map.<string,uint8>([[\"x\",\"bad\"],[\"x\",1]]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-02: negative zero overwrites positive zero",
    "source": "new Map.<number,uint8>([[0,\"bad\"],[-0,1]]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-03: numeric key and string key distinct",
    "source": "new Map.<number|string,uint8>([[1,\"bad\"],[\"1\",1]]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-04: good nested record converts",
    "source": "new Map.<string,{n:uint8}>([[\"x\",{n:1}]]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-05: parenthesized adoption",
    "source": "const m:Map.<string,uint8>=(new Map([[\"x\",\"bad\"]]));",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-06: assignment adoption",
    "source": "let m:Map.<string,uint8>=new Map();m=new Map([[\"x\",\"bad\"]]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-07: constructor alias adoption",
    "source": "const M=Map;const m:Map.<string,uint8>=new M([[\"x\",\"bad\"]]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-08: replace Map adder",
    "source": "Map.prototype.set=function(k,v){return this;};new Map.<string,uint8>([[\"x\",\"bad\"]]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-09: replace Set adder",
    "source": "Set.prototype.add=function(v){return this;};new Set.<uint8>([\"bad\"]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-10: replace literal iterator",
    "source": "Array.prototype[Symbol.iterator]=function*(){yield [\"x\",1];};new Map.<string,uint8>([[\"x\",\"bad\"]]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-11: overwritten expression still evaluated",
    "source": "function bad(){globalThis.hookRan=true;return \"bad\";}new Map.<string,uint8>([[\"x\",bad()],[\"x\",1]]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "true",
      "imports": []
    }
  },
  {
    "name": "R70-extra-12: conversion runs once at adoption",
    "source": "let count=0;class Box{constructor(s:string){count++;}}new Set.<Box>([\"value\"]);globalThis.settled=String(count);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-13: function parameter adoption",
    "source": "function take(m:Map.<string,uint8>):void{}function f(){take(new Map([[\"x\",\"bad\"]]));}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-14: function return adoption",
    "source": "function f():Map.<string,uint8>{return new Map([[\"x\",\"bad\"]]);}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-15: extra record properties are not freshness errors",
    "source": "new Map.<string,{n:uint8}>([[\"x\",{n:1,other:2}]]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R70-extra-16: empty initializer remains dynamic",
    "source": "new Set.<uint8>();new Map.<string,uint8>();",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  }
])('$name', ({ source, expected }) => {
  expect(observeProtocol(source)).toMatchObject(expected);
});
