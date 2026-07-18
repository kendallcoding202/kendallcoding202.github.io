import type { Action, BreachResult, MapNode } from "./types.ts";
import { createInitialState, applyAction } from "./engine.ts";
import { chooseAction } from "./ai.ts";
import { getModifier } from "./modifiers.ts";
import { combineLoadouts, aggregateImplants } from "./implants.ts";
import { getHacker, HACKER_ORDER } from "./hackers.ts";
import { threatEffects } from "./threat.ts";
import { createRun, currentOptions, resolveBreach, resolveEvent, resolveSafehouse, huntPressure } from "./run.ts";
function playBreach(run:any,node:MapNode,seed:number):BreachResult{
  const h=getHacker(run.hackerId);const hunt=huntPressure(run.heat,run.heatMax,threatEffects(run.threat).huntOffset);
  const mod=getModifier(run.mods[node.id]);const lo=combineLoadouts(h.passive,aggregateImplants(run.implants));
  let s=createInitialState(seed,node.systemKey||"homeServer",run.deck.slice(),mod,hunt,lo,threatEffects(run.threat));
  let g=0;while(s.outcome==="playing"&&g++<600){const a:Action=chooseAction(s,true);const b=s;s=applyAction(s,a);if(s===b&&a.type!=="endTurn")s=applyAction(s,{type:"endTurn"});}
  return {won:s.outcome==="won",detection:s.detection,detectionMax:s.detectionMax};
}
function pickNode(run:any,opts:MapNode[]):MapNode{const hot=run.heat/run.heatMax>0.6;if(hot){const s=opts.find(o=>o.type==="safehouse");if(s)return s;}const br=opts.filter(o=>o.type==="breach");if(br.length)return br.reduce((a,b)=>((a.reward||20)<=(b.reward||20)?a:b));return opts[0];}
function playRun(cid:string,hid:string,seed:number,threat:number):boolean{let run=createRun(cid,seed,threat,hid);let g=0;
  while(run.outcome==="running"&&g++<40){const opts=currentOptions(run);if(!opts.length)break;const n=pickNode(run,opts);
    if(n.type==="breach")run=resolveBreach(run,n,playBreach(run,n,seed*131+g));
    else if(n.type==="event"){const ev=run.events[n.id];const ch=(ev?.choices||[]).filter(c=>!c.requiresCredits||run.credits>=c.requiresCredits).sort((a,b)=>(a.heat||0)-(b.heat||0))[0]||(ev?.choices||[])[0];run=ch?resolveEvent(run,n,ch):resolveSafehouse(run,n);}
    else run=resolveSafehouse(run,n);}
  return run.outcome==="won";}
const N=400;const pad=(x:string,w:number)=>x.padEnd(w);const threats=[0,2,4,6,8,10];const cid=process.argv[2]||"oracle";
console.log(`\n=== THREAT RAMP: ${cid} win% per operator × threat (${N} each, smart AI) ===`);
console.log(pad("operator",10)+threats.map(t=>pad("T"+t,8)).join(""));
for(const hid of HACKER_ORDER){const h=getHacker(hid);const row=threats.map(t=>{let w=0;for(let i=0;i<N;i++)if(playRun(cid,hid,i+1,t))w++;return pad((100*w/N).toFixed(0)+"%",8);});console.log(pad(h.name,10)+row.join(""));}
