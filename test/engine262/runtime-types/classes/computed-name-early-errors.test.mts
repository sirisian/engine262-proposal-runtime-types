import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

test.each([
  {
    "name": "class method key unused",
    "source": "function f(n:uint8){class C{[n()](){}}}",
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
    "name": "class method key executed",
    "source": "function f(n:uint8){class C{[n()](){}}}f(1);",
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
    "name": "instance field key unused",
    "source": "function f(n:uint8){class C{[n()]=1;}}",
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
    "name": "static field key executed",
    "source": "function f(n:uint8){class C{static [n()]=1;}}f(1);",
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
    "name": "object method key unused",
    "source": "function f(n:uint8){const o={[n()](){}};}",
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
    "name": "object getter key executed",
    "source": "function f(n:uint8){const o={get [n()](){return 1;}};}f(1);",
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
    "name": "generator method key unused",
    "source": "function f(n:uint8){const o={*[n()](){yield 1;}};}",
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
    "name": "async method key unused",
    "source": "function f(n:uint8){class C{async [n()](){}}}",
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
    "name": "method parameter must not shadow key",
    "source": "function f(n:uint8){const o={[n()](n:any){}};}",
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
    "name": "class key primitive conversion",
    "source": "type K={[Symbol.toPrimitive]:(hint:string)=>object};function f(k:K){class C{[k](){}}}",
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
    "name": "object data property already checks",
    "source": "function f(n:uint8){const o={[n()]:1};}",
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
    "name": "class static body already checks",
    "source": "function f(n:uint8){class C{static{n();}}}",
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
    "name": "valid outer function despite parameter shadow",
    "source": "function f(k:()=>string){const o={[k()](k:uint8){}};globalThis.settled=String(typeof o.x);}f(()=>\"x\");",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "function",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "valid Symbol name",
    "source": "function f(k:symbol){class C{[k](){return 1;}}globalThis.settled=String(new C()[k]());}f(Symbol());",
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
    "name": "unknown callable stays dynamic",
    "source": "function f(k:any){class C{[k()](){}}}f(()=>\"x\");",
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
    "name": "unknown noncallable still runtime",
    "source": "function f(k:any){class C{[k()](){}}}f(1);",
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
    "name": "valid enclosing this used by computed name",
    "source": "class Outer{key:()=>string=()=>\"x\";make(){class Inner{[this.key()](){}}globalThis.settled=String(typeof new Inner().x);}}new Outer().make();",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "function",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "setter key unused",
    "source": "function f(n:uint8){const o={set [n()](v){}};}",
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
    "name": "computed name effects are not needed for proof",
    "source": "function f(n:uint8){class C{[(globalThis.hookRan=true,n())](){}}}f(1);",
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
    "name": "class expression",
    "source": "function f(n:uint8){return class {[n()](){}};}",
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
    "name": "setter key",
    "source": "function f(n:uint8){const o={set [n()](value){}};}",
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
    "name": "async generator key",
    "source": "function f(n:uint8){class C{async *[n()](){}}}",
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
    "name": "static async key",
    "source": "function f(n:uint8){class C{static async [n()](){}}}",
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
    "name": "key assignment retains ref type",
    "source": "function f(ref n:uint8){class C{[(n=300)](){}}}",
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
    "name": "class generic shadows outer value",
    "source": "function f(T:uint8){class C<T: type>{[T(1)](){}}}",
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
    "name": "class self name shadows outer value",
    "source": "function f(C:uint8){const K=class C{[C()](){}};}",
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
    "name": "computed name executes once",
    "source": "let count=0;function key(){count++;return \"x\";}class C{[key()](){}}new C();globalThis.settled=String(count);",
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
    "name": "field initializer still checked",
    "source": "class C{[\"x\"]:uint8=\"bad\";}",
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
    "name": "key uses outer this",
    "source": "class Outer{key:()=>string=()=>\"x\";f(){return class{[this.key()](){}};}}new Outer().f();",
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
    "name": "name rebind affects later store",
    "source": "class C{readonly x:uint8=1;}let c:C=new C();let a:[1].<uint8>=[1];let ref r=a[0];const o={[do {ref r=c.x;\"m\";}](){}};r=2;",
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
    "name": "name rebind leaves readonly location",
    "source": "class C{readonly x:uint8=1;}let c:C=new C();let a:[1].<uint8>=[1];let ref r=c.x;const o={[do {ref r=a[0];\"m\";}](){}};r=2;globalThis.settled=String(a[0]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "2",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "name reference write rejected",
    "source": "class C{readonly x:uint8=1;}let c:C=new C();let ref r=c.x;const o={[(r=2)](){}};",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  }
])('$name', ({ source, expected }) => {
  expect(observeProtocol(source)).toMatchObject(expected);
});
