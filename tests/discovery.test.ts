import test from "node:test";
import assert from "node:assert/strict";
import { parseDirectory, directoryBatch, parseTrendAuthors, parseTicker, chooseMarkets, battlePeers, retryDelay, parseQuota } from "../src/lib/discovery-model";
import { nextStart, failurePolicy, localCapacity } from "../src/server/listener-policy";

test("archive is a candidate source, never a source of live rooms or coins", () => {
  const rows = parseDirectory({ targets: [{ username: "@Ada", country:"UK", isLive:true, roomId:"123456789012", coins:999, boxEvents:4 },{username:"ada",country:"US"},{username:"not a handle"},{username:"unknown",country:null}] });
  assert.equal(rows.length,2); assert.equal(rows[0].roomId,""); assert.equal(rows[0].region,"GB"); assert.equal(rows[0].regionBasis,"directory");
  assert.ok(!("coins" in rows[0])); assert.ok(!("isLive" in rows[0])); assert.equal(rows[1].region,"");
});
test("country-balanced directory batches rotate without requiring manual input",()=>{
  const rows = parseDirectory({ targets: Array.from({length:12},(_,i)=>({username:`host${i}`,country:["TR","US","JP"][i%3]})) });
  const first=directoryBatch(rows,[],1,3), second=directoryBatch(rows,[],2,3);
  assert.equal(new Set(first.map(c=>c.region)).size,3); assert.equal(new Set([...first,...second].map(c=>c.username)).size,6);
  assert.ok(directoryBatch(rows,["JP"],1).every(c=>c.region==="JP")); assert.deepEqual(directoryBatch([],[],3),[]);
});
test("trend market differs from the creator's country and video ID is not room ID",()=>{
  const r=parseTrendAuthors({code:0,data:[{region:"PK",video_id:"9876543210123",author:{unique_id:"one"}},{author:{unique_id:"ONE"}}]},"JP");
  assert.deepEqual(r.map(x=>[x.username,x.region,x.regionBasis,x.roomId]),[["one","JP","market",""]]);
  assert.throws(()=>parseTrendAuthors({code:-1,data:[]},"JP")); assert.deepEqual(parseTrendAuthors({code:0,data:[]},"JP"),[]);
});
test("ticker respects maximum size and does not default missing country to TR",()=>{
  const r=parseTicker({channels:Array.from({length:15},(_,i)=>({uniqueId:`user_${i}`}))}); assert.equal(r.length,10); assert.equal(r[0].region,""); assert.throws(()=>parseTicker({}));
});
test("country rotation favors unvisited and only provider-supported selected markets",()=>{
  const codes=["TR","DE","JP","US","BR"], last=new Map([["TR",55],["DE",89]]);
  assert.deepEqual(chooseMarkets(codes,[],last,3),["JP","US","BR"]); assert.deepEqual(chooseMarkets(codes,["TR","XX"],last),["TR"]);
});
test("cohost discovery admits only schema-defined other anchors, never gift senders",()=>{
  const me="123456789000",peer="123456789001";
  const r=battlePeers({anchorsInfo:[{value:{user:{displayId:"myself",roomId:me}}},{value:{user:{displayId:"peer",roomId:peer}}}],gifters:[{displayId:"donor",roomId:peer}]},me);
  assert.deepEqual(r.map(x=>x.username),["peer"]); assert.equal(r[0].regionBasis,"unknown");
});
test("start budgets are rolling request windows, not socket caps",()=>{
  const now=100_000_000;assert.ok(nextStart([now-30000,now-20000,now-10000],now).next>now);
  const q=parseQuota({code:200,minute:{max:5,remaining:0,reset_at:null}},now);assert.ok(nextStart([],now,q).next>=now+60000);
  assert.equal(localCapacity({listenToAll:false,scanConcurrency:2}),2);assert.throws(()=>parseQuota({code:200,day:{max:3,remaining:9}}));
});
test("published Retry-After/reset is not shortened to the normal retry ceiling",()=>{
  const now=Date.now();assert.equal(retryDelay("800"),800000); assert.equal(retryDelay(new Date(now+2*3600000).toUTCString(),now)>7100000,true);
  const policy=failurePolicy({reason:"Rate Limited",retryAfter:3_600_000},0);assert.equal(policy.shared,true);assert.ok(policy.wait>=3_600_000);
  assert.equal(failurePolicy(new Error("offline"),4).offline,true);
});
