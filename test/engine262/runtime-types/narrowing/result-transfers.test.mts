import { expect, test } from 'vitest';
import { expectStaticTypeError, evaluated } from '../harness.mts';

// #sec-narrowing-flow, #sec-pattern-static-semantics, #sec-pipeline-static-semantics.

test("boolean-results: or-false", () => {
  expectStaticTypeError("function f(x:uint8|string){if((x is uint8)||false){if(x is string){}}}");
});

test("boolean-results: and-true", () => {
  expectStaticTypeError("function f(x:uint8|string){if((x is uint8)&&true){}else{if(x is uint8){}}}");
});

test("boolean-results: conditional", () => {
  expectStaticTypeError("function f(x:uint8|string){if((x is uint8)?true:false){if(x is string){}}}");
});

test("boolean-results: direct", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x is uint8){if(x is string){}}}");
});

test("boolean-results: or-true", () => {
  evaluated("function f(x:uint8|string){if((x is uint8)||true){if(x is string){}}}");
});

test("boolean-results: other-test", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if((x is uint8)||(y is uint8)){if(x is string){}}}");
});

test("boolean-results: write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if((x is uint8)?(x=y,true):false){if(x is string){}}}");
});

test("boolean-comparison: equals-true", () => {
  expectStaticTypeError("function f(x:uint8|string){if((x is uint8)===true){if(x is string){}}}");
});

test("boolean-comparison: not-false", () => {
  expectStaticTypeError("function f(x:uint8|string){if((x is uint8)!==false){if(x is string){}}}");
});

test("boolean-comparison: equals-false", () => {
  expectStaticTypeError("function f(x:uint8|string){if(false===(x is uint8)){if(x is uint8){}}}");
});

test("boolean-comparison: direct-not", () => {
  expectStaticTypeError("function f(x:uint8|string){if(!(x is uint8)){if(x is uint8){}}}");
});

test("boolean-comparison: unknown-boolean", () => {
  evaluated("function f(x:uint8|string,b:boolean){if((x is uint8)===b){if(x is string){}}}");
});

test("boolean-comparison: write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if((x is uint8)===(x=y,true)){if(x is string){}}}");
});

test("assignment-result: assignment", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(b=(x is uint8)){if(x is string){}}}");
});

test("assignment-result: and-assignment", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(b&&=(x is uint8)){if(x is string){}}}");
});

test("assignment-result: or-assignment", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(b||=(x is uint8)){}else{if(x is uint8){}}}");
});

test("assignment-result: rhs-control", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(x is uint8){b=true;if(x is string){}}}");
});

test("assignment-result: or-true", () => {
  evaluated("function f(x:uint8|string,b:boolean){if(b||=(x is uint8)){if(x is string){}}}");
});

test("assignment-result: rhs-write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string,b:boolean){if(b=((x is uint8),(x=y),true)){if(x is string){}}}");
});

test("optional-result: optional-member", () => {
  expectStaticTypeError("function f(o:{b:boolean}|null){if(o?.b){if(o is null){}}}");
});

test("optional-result: optional-predicate", () => {
  expectStaticTypeError("function g(v:any):v is uint8{return v is uint8;}function f(x:uint8|string,b:boolean){let guard:=b?g:null;if(guard?.(x)){if(x is string){}}}");
});

test("optional-result: base-control", () => {
  expectStaticTypeError("function f(o:{b:boolean}|null){if(o!==null){if(o is null){}}}");
});

test("optional-result: false-result", () => {
  evaluated("function f(o:{b:boolean}|null){if(o?.b){}else{if(o is null){}}}");
});

test("optional-result: key-write", () => {
  evaluated("function f(o:{b:boolean}|null,y:{b:boolean}|null){if(o?.[(o=y,\"b\")]){if(o is null){}}}");
});

test("optional-result: predicate-write", () => {
  evaluated("function g(v:any,z:any):v is uint8{return v is uint8;}function f(x:uint8|string,y:uint8|string,b:boolean){let guard:=b?g:null;if(guard?.(x,x=y)){if(x is string){}}}");
});

test("match-result: one-arm", () => {
  expectStaticTypeError("function f(x:uint8|string){if(match(0){when let v:x is uint8;}){if(x is string){}}}");
});

test("match-result: two-arms", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(match(b){when true:x is uint8;when false:x is uint8;}){if(x is string){}}}");
});

test("match-result: block-arm", () => {
  expectStaticTypeError("function f(x:uint8|string){if(match(0){when let v:{x is uint8;}}){if(x is string){}}}");
});

test("match-result: do-control", () => {
  expectStaticTypeError("function f(x:uint8|string){if(do{x is uint8;}){if(x is string){}}}");
});

test("match-result: other-result", () => {
  evaluated("function f(x:uint8|string,b:boolean){if(match(b){when true:x is uint8;when false:true;}){if(x is string){}}}");
});

test("match-result: write-result", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(match(0){when let v:(x=y,true);}){if(x is string){}}}");
});

test("pipeline-result: body-result", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x |> (%,x is uint8)){if(x is string){}}}");
});

test("pipeline-result: topic-origin", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x |> % is uint8){if(x is string){}}}");
});

test("pipeline-result: topic-control", () => {
  expectStaticTypeError("function f(x:uint8|string){return x |> (% is uint8 ? (% is string ? 1 : 2) : 3);}");
});

test("pipeline-result: source-write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(x |> (x=y,% is uint8)){if(x is string){}}}");
});

test("pipeline-result: different-source", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(y |> % is uint8){if(x is string){}}}");
});

test("boolean-switch: const-true", () => {
  expectStaticTypeError("function f(x:uint8|string){const yes=true;switch(yes){case x is uint8:if(x is string){}break;default:break;}}");
});

test("boolean-switch: const-false", () => {
  expectStaticTypeError("function f(x:uint8|string){const no=false;switch(no){case x is uint8:if(x is uint8){}break;default:break;}}");
});

test("boolean-switch: narrowed-boolean", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(b===true){switch(b){case x is uint8:if(x is string){}break;default:break;}}}");
});

test("boolean-switch: literal-control", () => {
  expectStaticTypeError("function f(x:uint8|string){switch(true){case x is uint8:if(x is string){}break;default:break;}}");
});

test("boolean-switch: unknown-boolean", () => {
  evaluated("function f(x:uint8|string,b:boolean){switch(b){case x is uint8:if(x is string){}break;default:break;}}");
});

test("boolean-switch: fallthrough", () => {
  evaluated("function f(x:uint8|string,b:boolean){const yes=true;switch(yes){case b:;case x is uint8:if(x is string){}break;default:break;}}");
});

test("range-members: is-range", () => {
  expectStaticTypeError("function f(x:uint8|uint16){if(x is 300..=400){if(x is uint8){}}}");
});

test("range-members: match-range", () => {
  expectStaticTypeError("function f(x:uint8|uint16){return match(x){when 300..=400:x is uint8?1:2;default:3;};}");
});

test("range-members: switch-range", () => {
  expectStaticTypeError("function f(x:uint8|uint16){switch(x){case 300..=400:if(x is uint8){}break;default:break;}}");
});

test("range-members: disjoint-control", () => {
  expectStaticTypeError("function f(x:uint8){if(x is 300..=400){}}");
});

test("range-members: overlap", () => {
  evaluated("function f(x:uint8|uint16){if(x is 100..=200){if(x is uint8){}}}");
});

test("range-members: float-overlap", () => {
  evaluated("function f(x:uint8|float64){if(x is 0..=255){if(x is float64){}}}");
});

test("range-members: integer-miss", () => {
  expectStaticTypeError("function f(x:uint8|uint16){if(x is 0..=255){}else{if(x is uint8){}}}");
});

test("range-selection: contained-range", () => {
  expectStaticTypeError("function f(x:uint8){switch(x){case 0..=255:break;case 1..=2:break;default:break;}}");
});

test("range-selection: duplicate-range", () => {
  expectStaticTypeError("function f(x:uint8){switch(x){case 1..<3:break;case 1..<3:break;default:break;}}");
});

test("range-selection: combined-coverage", () => {
  expectStaticTypeError("function f(x:uint8){switch(x){case 0..=100:break;case 101..=255:break;case 50..=150:break;default:break;}}");
});

test("range-selection: disjoint-control", () => {
  expectStaticTypeError("function f(x:uint8){switch(x){case 300..=400:break;default:break;}}");
});

test("range-selection: partial-overlap", () => {
  evaluated("function f(x:uint8){switch(x){case 1..=3:break;case 3..=5:break;default:break;}}");
});

test("range-selection: exclusive-adjacency", () => {
  evaluated("function f(x:uint8){switch(x){case 1..<3:break;case 3..<5:break;default:break;}}");
});

test("enumeration-entry: null-source", () => {
  expectStaticTypeError("function f(o:{x:uint8}|null){for(const key in o){if(o is null){}}}");
});

test("enumeration-entry: undefined-source", () => {
  expectStaticTypeError("function f(o:{x:uint8}|undefined){for(const key in o){if(o is undefined){}}}");
});

test("enumeration-entry: presence-control", () => {
  expectStaticTypeError("function f(o:{x:uint8}|null){if(o!==null){if(o is null){}}}");
});

test("enumeration-entry: zero-iterations", () => {
  evaluated("function f(o:{x:uint8}|null){for(const key in o){}if(o is null){}}");
});

test("enumeration-entry: body-write", () => {
  evaluated("function f(o:{x:uint8}|null,y:{x:uint8}|null){for(const key in o){o=y;if(o is null){}}}");
});

test("enumeration-entry: shadow", () => {
  evaluated("function f(o:{x:uint8}|null,y:{x:uint8}|null){for(const key in o){let o=y;if(o is null){}}}");
});

test("boolean-results: while", () => {
  expectStaticTypeError("function f(x:uint8|string){while((x is uint8)||false){if(x is string){}break;}}");
});

test("boolean-comparison: for", () => {
  expectStaticTypeError("function f(x:uint8|string){for(;(x is uint8)===true;){if(x is string){}break;}}");
});

test("assignment-result: do-while", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){do{}while((b=(x is uint8))&&(x is string));}");
});

test("optional-result: conditional", () => {
  expectStaticTypeError("function f(o:{b:boolean}|null){return o?.b?(o is null?1:2):3;}");
});

test("match-result: logical", () => {
  expectStaticTypeError("function f(x:uint8|string){if((match(0){when let v:x is uint8;})&&(x is string)){}}");
});

test("pipeline-result: while", () => {
  expectStaticTypeError("function f(x:uint8|string){while(x |> % is uint8){if(x is string){}break;}}");
});

test("boolean-switch: default", () => {
  expectStaticTypeError("function f(x:uint8|string){const yes=true;switch(yes){case x is uint8:break;default:if(x is uint8){}break;}}");
});

test("range-members: match-guard", () => {
  expectStaticTypeError("function f(x:uint8|uint16){return match(x){when 300..=400 if(x is uint8):1;default:2;};}");
});

test("range-selection: default-middle", () => {
  expectStaticTypeError("function f(x:uint8){switch(x){case 0..=255:break;default:break;case 1..=2:break;}}");
});

test("enumeration-entry: labelled", () => {
  expectStaticTypeError("function f(o:{x:uint8}|null){outer:for(const key in o){if(o is null)continue outer;}}");
});

test("boolean-comparison: value-query", () => {
  evaluated("function f(x:uint8){return (x is string)===true;}");
});

test("assignment-result: value-query", () => {
  evaluated("function f(x:uint8,b:boolean){return b=(x is string);}");
});

test("match-result: value-query", () => {
  evaluated("function f(x:uint8){return match(0){when let v:x is string;};}");
});

test("pipeline-result: value-query", () => {
  evaluated("function f(x:uint8){return x |> % is string;}");
});

test("range-members: unknown-endpoint", () => {
  evaluated("function f(x:uint8|uint16,hi:uint16){if(x is 0..=hi){if(x is uint8){}}}");
});

test("range-selection: unknown-range", () => {
  evaluated("function f(x:uint8,lo:uint8,hi:uint8){switch(x){case lo..=hi:break;case 1..=2:break;default:break;}}");
});

test("enumeration-entry: captured-write", () => {
  evaluated("function f(o:{x:uint8}|null,y:{x:uint8}|null){function change(){o=y;}for(const key in o){change();if(o is null){}}}");
});

test("optional-result: untyped-predicate", () => {
  evaluated("function g(v:any):v is uint8{return v is uint8;}function f(x:uint8|string,b:boolean){let guard=b?g:null;if(guard?.(x)){if(x is string){}}}");
});

test("boolean-results: nested-result", () => {
  expectStaticTypeError("function f(x:uint8|string){if(((x is uint8)?true:false)||false){if(x is string){}}}");
});

test("boolean-results: dead-alternative-write", () => {
  expectStaticTypeError("function f(x:uint8|string,y:uint8|string){if((x is uint8)||(false?(x=y,true):false)){if(x is string){}}}");
});

test("boolean-comparison: left-effect", () => {
  expectStaticTypeError("function f(x:uint8|string,y:uint8|string){if((x=y,true)===(x is uint8)){if(x is string){}}}");
});

test("boolean-comparison: false-branch", () => {
  expectStaticTypeError("function f(x:uint8|string){if((x is uint8)===true){}else{if(x is uint8){}}}");
});

test("boolean-comparison: non-boolean", () => {
  evaluated("function f(x:uint8|string,b:any){if(b===true){if(x is string){}}}");
});

test("assignment-result: property-store", () => {
  expectStaticTypeError("function f(x:uint8|string,o:{b:boolean}){if(o.b=(x is uint8)){if(x is string){}}}");
});

test("assignment-result: coalesce-store", () => {
  evaluated("function f(x:uint8|string,b:boolean|null){if(b??=(x is uint8)){if(x is string){}}}");
});

test("assignment-result: setter-write", () => {
  evaluated("function f(x:uint8|string){let o={set b(v:boolean){x=\"s\";}};if(o.b=(x is uint8)){if(x is string){}}}");
});

test("assignment-result: invalid-store", () => {
  expectStaticTypeError("function f(x:uint8|string,b:uint8){if(b=(x is uint8)){}}");
});

test("assignment-result: left key precedes the result producer", () => {
  expectStaticTypeError("function f(x:uint8|string,y:uint8|string,o:{b:boolean}){if(o[(x=y,\"b\")]=(x is uint8)){if(x is string){}}}");
});

test("optional-result: nested-base", () => {
  expectStaticTypeError("function f(o:{p:{b:boolean}|null}|null){if(o?.p?.b){if(o is null){}}}");
});

test("optional-result: nested-member", () => {
  expectStaticTypeError("function f(o:{p:{b:boolean}|null}|null){if(o?.p?.b){if(o.p is null){}}}");
});

test("optional-result: nullable-false", () => {
  evaluated("function f(o:{b:boolean}|undefined){if(!o?.b){if(o is undefined){}}}");
});

test("optional-result: getter-write", () => {
  evaluated("function f(o:{readonly b:boolean}|null){function make():{readonly b:boolean}|null{return {get b():boolean{o=null;return true;}};}o=make();if(o?.b){if(o is null){}}}");
});

test("optional-result: predicate-false", () => {
  evaluated("function g(v:any):v is uint8{return v is uint8;}function f(x:uint8|string,b:boolean){let guard:=b?g:null;if(!guard?.(x)){if(x is uint8){}}}");
});

test("optional-result: predicate-other-value", () => {
  evaluated("function g(v:any):v is uint8{return v is uint8;}function f(x:uint8|string,y:uint8|string,b:boolean){let guard:=b?g:null;if(guard?.(y)){if(x is string){}}}");
});

test("optional-result: call-key-prefix-write", () => {
  evaluated("function f(o:{p:{b:boolean}|null}|null,y:{p:{b:boolean}|null}|null){if(o?.[(o=y,\"p\")]?.b){if(o is null){}}}");
});

test("match-result: finally-write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(match(0){when let v:{try{x is uint8;}finally{x=y;}}}){if(x is string){}}}");
});

test("match-result: block-shadow", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(match(0){when let v:{let x=y;x is uint8;}}){if(x is string){}}}");
});

test("match-result: empty-result", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(match(b){when true:{x is uint8;}when false:{;}}){if(x is string){}}}");
});

test("match-result: abrupt-arm", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(match(b){when true:x is uint8;when false:throw 0;}){if(x is string){}}}");
});

test("match-result: guarded-result", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(match(b){when true if(x is uint8):true;default:false;}){if(x is string){}}}");
});

test("pipeline-result: nested-topics", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x |> (% |> % is uint8)){if(x is string){}}}");
});

test("pipeline-result: write-only-false", () => {
  expectStaticTypeError("function f(x:uint8|string,y:uint8|string){if(x |> (% is uint8?true:(x=y,false))){if(x is string){}}}");
});

test("pipeline-result: captured-call-write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){function change(){x=y;}if(x |> (change(),% is uint8)){if(x is string){}}}");
});

test("pipeline-result: prefix-write", () => {
  evaluated("function f(o:{x:uint8|string},y:{x:uint8|string}){if(o.x |> (o=y,% is uint8)){if(o.x is string){}}}");
});

test("pipeline-result: topic-shadow", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(x |> (%,y |> % is uint8)){if(x is string){}}}");
});

test("pipeline-result: getter-write", () => {
  evaluated("function f(x:uint8|string){const o={get b(){x=\"s\";return true;}};if(x |> (o.b,% is uint8)){if(x is string){}}}");
});

test("boolean-switch: captured-boolean-write", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(b===true){switch(b){case (b=false,x is uint8):if(x is string){}break;default:break;}}}");
});

test("boolean-switch: label-subject-write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){const yes=true;switch(yes){case ((x is uint8),(x=y),true):if(x is string){}break;default:break;}}");
});

test("boolean-switch: discriminant-shadow", () => {
  evaluated("function f(x:uint8|string,b:boolean){const yes=true;{let yes=b;switch(yes){case x is uint8:if(x is string){}break;default:break;}}}");
});

test("range-members: false-member-arm", () => {
  expectStaticTypeError("function f(x:uint8|uint16){return match(x){when 0..=255:1;default:x is uint8?2:3;};}");
});

test("range-members: switch-failed-selection", () => {
  expectStaticTypeError("function f(x:uint8|uint16){switch(x){case 0..=255:break;default:if(x is uint8){}break;}}");
});

test("range-members: range-fallthrough", () => {
  evaluated("function f(x:uint8|uint16){switch(x){case 0..=255:;case 300..=400:if(x is uint8){}break;default:break;}}");
});

test("range-members: replaced-subject", () => {
  evaluated("function f(x:uint8|uint16,y:uint8|uint16){if(x is 300..=400){x=y;if(x is uint8){}}}");
});

test("range-selection: integer-open-gap", () => {
  expectStaticTypeError("function f(x:uint8){switch(x){case 0..=100:break;case 101..=255:break;case 50..=150:break;}}");
});

test("range-selection: float-open-gap", () => {
  evaluated("function f(x:float64){switch(x){case 0..=100:break;case 101..=255:break;case 50..=150:break;default:break;}}");
});

test("range-selection: range-covered-outside-domain", () => {
  expectStaticTypeError("function f(x:uint8){switch(x){case 0..=255:break;case 1..=300:break;}}");
});

test("range-selection: open-endpoint-live", () => {
  evaluated("function f(x:uint8){switch(x){case 0..<100:break;case 100..=150:break;}}");
});

test("range-selection: fallthrough-label-error", () => {
  expectStaticTypeError("function f(x:uint8){switch(x){case 0..=255:;case 1..=2:break;}}");
});

test("range-selection: default-stays-valid", () => {
  evaluated("function f(x:uint8){switch(x){case 0..=255:break;default:break;}}");
});

test("enumeration-entry: nullable-property", () => {
  evaluated("function f(box:{o:{x:uint8}|null}){for(const key in box.o){if(box.o is null){}}}");
});

test("enumeration-entry: loop-target-writes-source", () => {
  evaluated("function f(o:{x:uint8}|string|null){for(o in o){if(o is null){}}}");
});

test("enumeration-entry: loop-write-after-test", () => {
  evaluated("function f(o:{x:uint8}|null,y:{x:uint8}|null){for(const key in o){if(o is null){}o=y;}}");
});

test("enumeration-entry: enumeration-callback", () => {
  evaluated("function f(o:{x:uint8}|null,y:{x:uint8}|null){const callback=()=>{o=y;};for(const key in o){if(o is null){}}}");
});

test("enumeration-entry: body-exits", () => {
  evaluated("function f(o:{x:uint8}|null){for(const key in o){break;}if(o is null){}}");
});

test("optional-result: void-result", () => {
  expectStaticTypeError("function g(v:any):void{}function f(x:uint8|string,b:boolean){let guard:=b?g:null;if(guard?.(x)){}}");
});

test("assignment-result: reference-alias", () => {
  evaluated("function f(ref x:boolean|string,ref b:boolean|string){if(b=(x is string)){if(x is boolean){}}}");
});

test("pipeline-result: reference-alias", () => {
  evaluated("function f(ref x:boolean|string,ref b:boolean|string){if(x |> (b=true,% is string)){if(x is boolean){}}}");
});

test("pipeline-result: property-alias", () => {
  evaluated("function f(o:{x:boolean|string},other:{x:boolean|string}){if(o.x |> (other.x=true,% is string)){if(o.x is boolean){}}}");
});

test("boolean-switch: constant-label-miss", () => {
  expectStaticTypeError("function f(p:number){const yes=true;switch(yes){case false:break;default:break;}}");
});

test("boolean-switch: constant-label-miss outside checked code", () => {
  evaluated("function f(){const yes=true;switch(yes){case false:break;default:break;}}");
});

test("boolean-results: constant-false", () => {
  expectStaticTypeError("function f(x:uint8|string){const no=false;if((x is uint8)||no){if(x is string){}}}");
});

test("boolean-comparison: constant-true", () => {
  expectStaticTypeError("function f(x:uint8|string){const yes=true;if((x is uint8)===yes){if(x is string){}}}");
});

test("boolean-comparison: changed-comparison-value", () => {
  evaluated("function f(x:uint8|string|boolean,b:boolean){if(b===true){if((b=false,x is uint8)===b){if(x is string){}}}}");
});

test("assignment-result: coalesce-captured-skip", () => {
  evaluated("function f(x:uint8|string,b:boolean|null){if(b??=do{b=true;x is uint8;}){}else{if(x is uint8){}}}");
});

test("enumeration-entry: ref-source", () => {
  evaluated("function f(ref o:{x:uint8}|null){for(const key in o){if(o is null){}}}");
});

test("enumeration-entry: borrowed-source", () => {
  evaluated("function f(o:{x:uint8}|null){let ref p=o;const callback=()=>{p=null;};for(const key in o){if(o is null){}}}");
});

test("enumeration-entry: global-source", () => {
  evaluated("let o:{x:uint8}|null;for(const key in o){if(o is null){}}");
});

test("enumeration-entry: shadowed-borrow", () => {
  expectStaticTypeError("function f(o:{x:uint8}|null){function g(o:{x:uint8}|null){let ref p=o;}for(const key in o){if(o is null){}}}");
});

test("enumeration-entry: local-source", () => {
  expectStaticTypeError("function f(v:{x:uint8}|null){let o:{x:uint8}|null=v;for(const key in o){if(o is null){}}}");
});

test("enumeration-entry: borrowed-argument", () => {
  evaluated("function f(o:{x:uint8}|null,sink:any){sink(ref o);for(const key in o){if(o is null){}}}");
});

test("runtime: range-domains", () => {
  expect(evaluated("function f(x:uint8|uint16){return x is 300..=400;}String(f(uint16(350)))+','+String(f(uint8(100)));")).toBe("true,false");
});

test("runtime: range-miss", () => {
  expect(evaluated("function f(x:uint8|uint16){return x is 0..=255;}String(f(uint16(350)))+','+String(f(uint8(100)));")).toBe("false,true");
});

test("runtime: pipeline-source-write", () => {
  expect(evaluated("function f(x:uint8|string,y:uint8|string){if(x |> (x=y,% is uint8)){return typeof x;}return 'other';}String(f(uint8(1),'s'));")).toBe("string");
});

test("runtime: pipeline-source-stable", () => {
  expect(evaluated("function f(x:uint8|string){if(x |> % is uint8){return typeof x;}return 'other';}f(uint8(1))+','+f('s');")).toBe("number,other");
});

test("runtime: optional-key-write", () => {
  expect(evaluated("function f(o:{b:boolean}|null,y:{b:boolean}|null){if(o?.[(o=y,'b')]){return o is null;}return false;}String(f({b:true},null));")).toBe("true");
});

test("runtime: optional-predicate-argument-write", () => {
  expect(evaluated("function g(v:any,z:any):v is uint8{return v is uint8;}function f(x:uint8|string,y:uint8|string,b:boolean){let guard:=b?g:null;if(guard?.(x,x=y)){return typeof x;}return 'other';}f(uint8(1),'s',true);")).toBe("string");
});

test("runtime: for-in-nullish", () => {
  expect(evaluated("function f(o:{x:uint8}|null|undefined){let n=0;for(const key in o){n++;}return n;}String(f(null))+','+String(f(undefined))+','+String(f({x:uint8(1)}));")).toBe("0,0,1");
});

test("runtime: match-results", () => {
  expect(evaluated("function f(x:uint8|string,b:boolean){return match(b){when true:x is uint8;when false:x is uint8;};}String(f(uint8(1),true))+','+String(f('s',false));")).toBe("true,false");
});

test("runtime: optional-getter-write", () => {
  expect(evaluated("function f(o:{readonly b:boolean}|null){function make():{readonly b:boolean}|null{return {get b():boolean{o=null;return true;}};}o=make();if(o?.b){return o is null;}return false;}String(f(null));")).toBe("true");
});

test("runtime: assignment-reference-alias", () => {
  expect(evaluated("function f(ref x:boolean|string,ref b:boolean|string){if(b=(x is string)){return x is boolean;}return false;}let v:boolean|string=\"s\";String(f(ref v,ref v));")).toBe("true");
});

test("runtime: pipeline-reference-alias", () => {
  expect(evaluated("function f(ref x:boolean|string,ref b:boolean|string){if(x |> (b=true,% is string)){return x is boolean;}return false;}let v:boolean|string=\"s\";String(f(ref v,ref v));")).toBe("true");
});

test("runtime: pipeline-property-alias", () => {
  expect(evaluated("function f(o:{x:boolean|string},other:{x:boolean|string}){if(o.x |> (other.x=true,% is string)){return o.x is boolean;}return false;}let o:{x:boolean|string}={x:\"s\"};String(f(o,o));")).toBe("true");
});

test("runtime: for-in-property-alias", () => {
  expect(evaluated("function f(box:{o:{x:uint8}|null}){for(const key in box.o){return box.o is null;}return false;}let box={o:null};box.o=new Proxy({x:uint8(1)},{ownKeys(target){box.o=null;return [\"x\"];}});String(f(box));")).toBe("true");
});

test("runtime: for-in-reference-alias", () => {
  expect(evaluated("function f(ref o:{x:uint8}|null){for(const key in o){return o is null;}return false;}let o:{x:uint8}|null=null;o=new Proxy({x:uint8(1)},{ownKeys(target){o=null;return [\"x\"];}});String(f(ref o));")).toBe("true");
});
