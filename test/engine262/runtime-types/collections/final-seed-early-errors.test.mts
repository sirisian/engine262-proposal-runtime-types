import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

test.each([
  {
    "name": "Map value seed unused",
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
    "name": "Map value seed executed",
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
    "name": "Map key seed unused",
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
    "name": "Map key seed executed",
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
    "name": "Map annotation adoption unused",
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
    "name": "Set annotation adoption unused",
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
    "name": "Set annotation adoption executed",
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
    "name": "invalid final overwrite",
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
    "name": "valid final overwrite",
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
    "name": "Map literal conversions valid",
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
    "name": "Set explicit already rejects",
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
    "name": "empty Map valid",
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
    "name": "nullish seed means empty",
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
    "name": "untyped collections remain valid",
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
    "name": "unknown adoption remains runtime",
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
    "name": "overridden iterator on ordinary seed remains dynamic",
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
    "name": "custom Map constructor remains dynamic",
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
    "name": "different key leaves bad final entry",
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
    "name": "unknown final key can overwrite",
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
    "name": "nested value seed preserves literal structure",
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
    "name": "explicitly replaced constructor",
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
    "name": "local generic Map is not intrinsic",
    "source": "class Map<K: type,V: type>{constructor(x:any){}}new Map.<string,uint8>([[\"x\",\"bad\"]]);",
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
    "name": "declared conversion remains allowed",
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
    "name": "nested value seed executed",
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
    "name": "constant primitive overwrite",
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
    "name": "negative zero overwrites positive zero",
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
    "name": "numeric key and string key distinct",
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
    "name": "good nested record converts",
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
    "name": "parenthesized adoption",
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
    "name": "assignment adoption",
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
    "name": "constructor alias adoption",
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
    "name": "replace Map adder",
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
    "name": "replace Set adder",
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
    "name": "replace literal iterator",
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
    "name": "overwritten expression still evaluated",
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
    "name": "conversion runs once at adoption",
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
    "name": "function parameter adoption",
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
    "name": "function return adoption",
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
    "name": "extra record properties are not freshness errors",
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
    "name": "empty initializer remains dynamic",
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
