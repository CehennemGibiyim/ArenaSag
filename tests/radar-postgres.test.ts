import test from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";

// Must run against a fresh, dedicated throwaway database. No actual upstream traffic, secrets or sockets.
const dbName = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : "";
test("real PostgreSQL: two scans, two workers, source cache, lifecycle and fail-closed quota",{skip:!/^arena_radar_qa_[0-9]+$/.test(dbName)},async t=>{
  const {db,pool}=await import("../src/db"); const {listenerJobs,liveRooms,providerGates,discoveryCache,chests}=await import("../src/db/schema");
  const {runScan}=await import("../src/server/scanner"); const {enqueue,claimRoom,markOffline}=await import("../src/server/listener-queue");
  const {networkSnapshot}=await import("../src/server/network"); const {tickerSample}=await import("../src/server/free-discovery");
  const {upsertLiveRoom}=await import("../src/server/rooms");
  const original=globalThis.fetch; const oldKey=process.env.EULER_API_KEY, oldEnabled=process.env.ARENA_ENABLE_EULER_FEED;
  process.env.EULER_API_KEY="not-a-real-test-key"; delete process.env.ARENA_ENABLE_EULER_FEED;
  const hits=new Map<string,number>(); let deny=false;
  const ids:Record<string,string>={alpha:"1234567890001",beta:"1234567890002",gamma:"1234567890003",ambiguous:"1234567890004"};
  globalThis.fetch=async(input)=>{const url=new URL(String(input)); hits.set(url.hostname+url.pathname,(hits.get(url.hostname+url.pathname)??0)+1);
    const ok=(data:unknown)=>Response.json(data);
    if(url.hostname==="api.tik.tools") return deny ? new Response("limited",{status:429,headers:{"retry-after":"800"}}) : ok({channels:[{uniqueId:"alpha",roomId:ids.alpha,region:"TR"},{uniqueId:"ALPHA",region:"TR"}]});
    if(url.hostname==="www.tikwm.com" && url.pathname==="/api/region") return ok({code:0,data:{TR:"Türkiye",JP:"Japan"}});
    if(url.hostname==="www.tikwm.com") return ok({code:0,data:[{region:"JP",author:{unique_id:"beta"}},{author:{unique_id:"off"}},{author:{unique_id:"ambiguous"}}]});
    if(url.hostname==="raw.githubusercontent.com") return ok({targets:[{username:"beta",country:"TR"},{username:"gamma",country:"TR",roomId:"9876543210000",coins:999},{username:"foreign",country:"JP"}]});
    if(url.pathname==="/api-live/user/room/") {const name=url.searchParams.get("uniqueId")!; return ok({statusCode:0,data:{user:{roomId:ids[name]||"0",nickname:name},liveRoom:{status:name==="off"?4:2}}});}
    if(url.pathname==="/webcast/room/check_alive/") return ok({data:url.searchParams.get("room_ids")!.split(",").map(id=>({room_id_str:id,alive:id===ids.ambiguous?"false":true}))});
    if(url.pathname==="/webcast/room/info/") {const id=url.searchParams.get("room_id")!; return ok({data:{id_str:id,user_count:7,owner:{display_id:Object.keys(ids).find(k=>ids[k]===id)},gift:{diamondCount:500}}});}
    throw new Error(`Unexpected network request: ${url.hostname}${url.pathname}`);
  };
  t.after(async()=>{globalThis.fetch=original;if(oldKey===undefined)delete process.env.EULER_API_KEY;else process.env.EULER_API_KEY=oldKey;
    if(oldEnabled===undefined)delete process.env.ARENA_ENABLE_EULER_FEED;else process.env.ARENA_ENABLE_EULER_FEED=oldEnabled;await pool.end();});
  const scan=()=>runScan({regions:["TR"]});
  const first=await scan();assert.deepEqual(first.report.errors,[]);assert.equal(first.report.verified,3);assert.equal(first.report.newRooms,3);assert.equal(first.report.firstHosts,3);
  assert.equal(first.report.offline,1);assert.equal(first.report.unknown,1);assert.equal(first.report.eulerRequests,0);assert.equal(first.report.markets[0].region,"TR");
  assert.equal((await db.select().from(chests)).length,0);assert.equal((await db.select().from(liveRooms)).length,3);
  assert.equal(hits.get("webcast.tiktok.com/webcast/room/check_alive/"),1); assert.equal((await scan()).source,"busy");
  const future=new Date(Date.now()+3600000);
  await db.update(listenerJobs).set({status:"retry",nextAttemptAt:future,attempts:2}).where(eq(listenerJobs.roomId,ids.beta));
  await db.update(providerGates).set({nextAt:new Date(0)}).where(eq(providerGates.provider,"discovery-run"));
  const second=await scan();assert.equal(second.report.newRooms,0);assert.equal(second.report.firstHosts,0);assert.equal(second.report.repeatedRooms,3);assert.equal(second.publicRequests,0);
  assert.equal(second.report.markets[0].cached,true);assert.equal(hits.get("raw.githubusercontent.com/CehennemGibiyim/TikTok/main/site/firsat/data/targets.json"),1);
  const [b]=await db.select().from(listenerJobs).where(eq(listenerJobs.roomId,ids.beta));assert.equal(b.status,"retry");assert.equal(+b.nextAttemptAt,+future);
  await upsertLiveRoom({username:"alpha",roomId:ids.alpha,source:"scan",liveNow:true});const [room]=await db.select().from(liveRooms).where(eq(liveRooms.username,"alpha"));assert.equal(room.region,"TR");assert.equal(room.regionBasis,"sample");assert.equal(room.source,"public-sample");
  const claims=await Promise.all([claimRoom(2),claimRoom(2)]);const firstLease=claims.find(v=>v!==null)!;assert.equal(claims.filter(Boolean).length,1);
  const snap=await networkSnapshot(new URLSearchParams());assert.equal(snap.states.connecting,1);assert.equal(snap.states.listening??0,0);
  await db.update(listenerJobs).set({status:"listening",connectedAt:new Date()}).where(eq(listenerJobs.id,firstLease.id));
  await db.update(providerGates).set({nextAt:new Date(0)}).where(eq(providerGates.provider,"listener"));assert.equal(await claimRoom(1),null);
  await Promise.all([enqueue({username:firstLease.username,nickname:"",title:"",viewers:0,roomId:firstLease.roomId}),enqueue({username:firstLease.username,nickname:"",title:"",viewers:0,roomId:firstLease.roomId})]);
  assert.equal((await networkSnapshot(new URLSearchParams("state=listening"))).filtered,1);
  const secondLease = await claimRoom(2);
  assert.ok(secondLease && secondLease.roomId !== firstLease.roomId);
  const [stillListening] = await db.select().from(listenerJobs).where(eq(listenerJobs.id,firstLease.id));
  assert.equal(stillListening.status,"listening");assert.equal(stillListening.owner,firstLease.owner);
  await markOffline(firstLease.username,firstLease.roomId);assert.equal((await networkSnapshot(new URLSearchParams())).total,2);
  await db.update(discoveryCache).set({nextAt:new Date(0)}).where(eq(discoveryCache.key,"tiktools:public"));await db.update(providerGates).set({nextAt:new Date(0)}).where(eq(providerGates.provider,"ticker"));deny=true;
  const denied=await tickerSample();assert.equal(denied.state,"limited");const cached=await tickerSample();assert.equal(cached.requests,0);assert.equal(cached.state,"limited");
  const [gate]=await db.select().from(providerGates).where(eq(providerGates.provider,"ticker"));assert.ok(+gate.nextAt-Date.now()>795000);
  const renewed=await enqueue({username:"alpha",roomId:"1234567890099",title:"",viewers:3,nickname:"alpha"});assert.equal(renewed.newRoom,true);assert.equal(renewed.firstHost,false);
  const [unique]=await db.select({n:sql<number>`count(distinct ${listenerJobs.roomId})::int`}).from(listenerJobs);assert.equal(unique.n,4);
});
