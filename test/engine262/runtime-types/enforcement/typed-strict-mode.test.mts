import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

// Check phase and effects as well as the outcome, including unused bodies.
test.each([
  [
    "parameter annotation with",
    "function f(n:uint8){with({}){}}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "identifier deletion",
    "function f(n:uint8){delete n;}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "duplicate parameters",
    "function f(n:uint8,n:uint8){}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "legacy octal",
    "function f(n:uint8){return 010;}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "octal escape",
    "function f(n:uint8){return \"\\1\";}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "restricted binding",
    "function f(n:uint8){var eval=1;}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "body annotation",
    "function f(){let n:uint8=1;with({}){}}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "annotation after with",
    "function f(){with({}){}let n:uint8=1;}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "nested function inherits",
    "function f(n:uint8){function inner(){with({}){}}}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "script annotation",
    "let n:uint8=1;with({}){}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "script annotation applies earlier",
    "function f(x){with({}){}}let n:uint8=1;",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "return annotation",
    "function f():void{with({}){}}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "strict this mode",
    "function f(n:uint8){globalThis.settled=String(this===undefined);}f(1);",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "unmapped arguments",
    "function f(n:uint8){arguments[0]=2;globalThis.settled=String(n);}f(1);",
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
    "strict eval scope",
    "function f(n:uint8){eval(\"var z=1\");globalThis.settled=typeof z;}f(1);",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "undefined",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "explicit strict already rejects",
    "function f(n:uint8){\"use strict\";with({}){}}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "plain sloppy function preserved",
    "function f(n){with({}){}}",
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
    "typed sibling does not infect script",
    "function f(x){with({}){}}function g(n:uint8){}",
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
    "nested typed function does not infect parent",
    "function f(){with({}){}function g(n:uint8){}}",
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
    "annotated non-simple parameters valid",
    "function f({x}:{x:uint8}={x:1}):void{}",
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
    "function f(n:uint8){function inner(){return this;}globalThis.settled=String(inner()===undefined);}f(1);",
    "function f(n:uint8){function inner(){return this;}globalThis.settled=String(inner()===undefined);}f(1);",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function f(){with({}){}const inner=(n:any)=>n;}f();",
    "function f(){with({}){}const inner=(n:any)=>n;}f();",
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
    "const f=(n:uint8)=>(delete n);",
    "const f=(n:uint8)=>(delete n);",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "const f=async(n:uint8)=>{with({}){}};",
    "const f=async(n:uint8)=>{with({}){}};",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function* f(n:uint8){with({}){}}",
    "function* f(n:uint8){with({}){}}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "const o={set x(n:uint8){with({}){}}};",
    "const o={set x(n:uint8){with({}){}}};",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "const o={[010]():void{}};",
    "const o={[010]():void{}};",
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
    "function f(n=010):void{}",
    "function f(n=010):void{}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function f(n:uint8=1){globalThis.settled=String(this===undefined);}f();",
    "function f(n:uint8=1){globalThis.settled=String(this===undefined);}f();",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "globalThis.settled=String(Function(\"n:uint8\",\"return this===undefined;\")(1));",
    "globalThis.settled=String(Function(\"n:uint8\",\"return this===undefined;\")(1));",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "Function(\"n:uint8\",\"with({}){}\");",
    "Function(\"n:uint8\",\"with({}){}\");",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "globalThis.settled=String(Function(\"n\",\"let x:uint8=1;return this===undefined;\")(1));",
    "globalThis.settled=String(Function(\"n\",\"let x:uint8=1;return this===undefined;\")(1));",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function f(n:uint8){globalThis.settled=String(eval(\"this===undefined\"));}f(1);",
    "function f(n:uint8){globalThis.settled=String(eval(\"this===undefined\"));}f(1);",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function f(n:uint8){eval(\"with({}){}\");}f(1);",
    "function f(n:uint8){eval(\"with({}){}\");}f(1);",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function f(n:uint8){globalThis.settled=String(eval(\"new.target===undefined\"));}f(1);",
    "function f(n:uint8){globalThis.settled=String(eval(\"new.target===undefined\"));}f(1);",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function f(){with({}){}class C{x:uint8=1;}}f();",
    "function f(){with({}){}class C{x:uint8=1;}}f();",
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
    "function f(){uint8(1);with({}){}}f();",
    "function f(){uint8(1);with({}){}}f();",
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
    "function f(n:any){globalThis.settled=String(this===undefined);}f();",
    "function f(n:any){globalThis.settled=String(this===undefined);}f();",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function f(n:uint8){if(true)function g(){}}",
    "function f(n:uint8){if(true)function g(){}}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function f(){with({}){}const o={m(n:uint8){return this;}};}f();",
    "function f(){with({}){}const o={m(n:uint8){return this;}};}f();",
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
    "function f(){const o={[do{let n:uint8=1;n;}](){}};with({}){}}",
    "function f(){const o={[do{let n:uint8=1;n;}](){}};with({}){}}",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "const o={f(n:uint8){with({}){}}};",
    "const o={f(n:uint8){with({}){}}};",
    {
      "completion": "throw",
      "kind": "SyntaxError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function f(n:uint8){globalThis.settled=String(Function(\"return this===undefined;\")());}f(1);",
    "function f(n:uint8){globalThis.settled=String(Function(\"return this===undefined;\")());}f(1);",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "false",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function f(n:uint8){globalThis.settled=String((0,eval)(\"this===undefined\"));}f(1);",
    "function f(n:uint8){globalThis.settled=String((0,eval)(\"this===undefined\"));}f(1);",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "false",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "function f(n:uint8){let g=function(x){return this===undefined;};globalThis.settled=String(g());}f(1);",
    "function f(n:uint8){let g=function(x){return this===undefined;};globalThis.settled=String(g());}f(1);",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});

test('feature-off ordinary JavaScript retains sloppy parsing and execution', async () => {
  const { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion } = await import('#self');
  setSurroundingAgent(new Agent());
  const realm = new ManagedRealm();
  const source = 'function f(a,a){with({}){}return this===undefined ? "strict" : String(010);}f(1,2);';
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue(): string }).stringValue()).toBe('8');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('function f(n:uint8){}')).Type).toBe('throw');
});
