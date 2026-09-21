import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

test.each([
  {
    "name": "R67-01: invalid Unicode cooked part unused",
    "source": "function tag(s:[].<string>):void{}function f(){tag`\\unicode`;}",
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
    "name": "R67-02: invalid Unicode cooked part executed",
    "source": "function tag(s:[].<string>):void{}tag`\\unicode`;",
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
    "name": "R67-03: invalid hex cooked part unused",
    "source": "function tag(s:[].<string>):void{}function f(){tag`\\xG1`;}",
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
    "name": "R67-04: invalid tail cooked part unused",
    "source": "function tag(s:[].<string>,n:uint8):void{}function f(){tag`ok${1}\\unicode`;}",
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
    "name": "R67-05: valid cooked newline tuple wrongly rejected",
    "source": "function tag(s:[\"\\n\"]):void{}function f(){tag`\\n`;}",
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
    "name": "R67-06: valid cooked hex tuple wrongly rejected",
    "source": "function tag(s:[\"a\"]):void{}function f(){tag`\\x61`;}",
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
    "name": "R67-07: valid undefined tuple wrongly rejected",
    "source": "function tag(s:[undefined]):void{}function f(){tag`\\unicode`;}",
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
    "name": "R67-08: raw text mistaken for cooked literal",
    "source": "function tag(s:[\"\\\\n\"]):void{}function f(){tag`\\n`;}",
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
    "name": "R67-09: raw mistaken literal executed",
    "source": "function tag(s:[\"\\\\n\"]):void{}tag`\\n`;",
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
    "name": "R67-10: string or undefined accepts malformed escape",
    "source": "function tag(s:[].<string|undefined>):void{}tag`\\unicode`;",
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
    "name": "R67-11: untyped tag sees cooked and raw",
    "source": "function tag(s){globalThis.settled=String(s[0]===undefined)+\":\"+String(s.raw[0]===\"\\\\unicode\");}tag`\\unicode`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "true:true",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R67-12: ordinary typed string tag valid",
    "source": "function tag(s:[].<string>):void{}tag`plain`;",
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
    "name": "R67-13: substitution still checks",
    "source": "function tag(s:any,n:uint8):void{}function f(){tag`x${\"bad\"}`;}",
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
    "name": "R67-14: invalid escape remains untagged syntax error",
    "source": "function f(){return `\\unicode`;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "SyntaxError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R67-15: any tag remains unknown",
    "source": "function f(tag:any){tag`\\unicode`;}f(s=>{globalThis.settled=String(s[0]===undefined);});",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R67-16: undefined tuple executes successfully after cooking fix",
    "source": "function tag(s:[undefined]):void{globalThis.settled=String(s[0]===undefined);}tag`\\unicode`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R67-extra-01: null escape keeps prefix suffix",
    "source": "function tag(s:[\"a\\0b\"]):void{}tag`a\\0b`;",
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
    "name": "R67-extra-02: identity escape",
    "source": "function tag(s:[\"aqb\"]):void{}tag`a\\qb`;",
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
    "name": "R67-extra-03: line continuation",
    "source": "function tag(s:[\"ab\"]):void{}tag`a\\\nb`;",
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
    "name": "R67-extra-04: CRLF continuation",
    "source": "function tag(s:[\"ab\"]):void{}tag`a\\\r\nb`;",
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
    "name": "R67-extra-05: literal CRLF normalization",
    "source": "function tag(s:[\"a\\nb\"]):void{}tag`a\r\nb`;",
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
    "name": "R67-extra-06: empty Unicode malformed",
    "source": "function tag(s:[undefined]):void{}tag`\\u{}`;",
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
    "name": "R67-extra-07: decimal escape malformed",
    "source": "function tag(s:[undefined]):void{}tag`\\1`;",
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
    "name": "R67-extra-08: cooked undefined ignores lexical shadow",
    "source": "function tag(s:[].<string>):void{}function f(undefined:any){tag`\\unicode`;}",
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
    "name": "R67-extra-09: cooked literal participates in overload",
    "source": "function tag(s:[\"a\"]):string{return \"a\";}function tag(s:[\"b\"]):string{return \"b\";}globalThis.settled=tag`\\x61`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "a",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R67-extra-10: raw and frozen identity unchanged",
    "source": "let last;function tag(s){if(!Object.isFrozen(s)||!Object.isFrozen(s.raw))throw 0;if(last&&s!==last)throw 0;last=s;return s[0]+\"/\"+s.raw[0];}function f(){return tag`\\x61`;}f();globalThis.settled=f();",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "a/\\x61",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R67-extra-11: ordinary string array overloaded with catchall",
    "source": "function tag(s:[].<string>):string{return \"typed\";}function tag(s:any):string{return \"any\";}globalThis.settled=tag`plain`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "typed",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R67-extra-12: malformed selects admitted overload",
    "source": "function tag(s:[\"a\"]):string{return \"a\";}function tag(s:[undefined]):string{return \"absent\";}globalThis.settled=tag`\\unicode`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "absent",
      "hookRan": "false",
      "imports": []
    }
  }
])('$name', ({ source, expected }) => {
  expect(observeProtocol(source)).toMatchObject(expected);
});
