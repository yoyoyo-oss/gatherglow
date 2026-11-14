(function(){
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const V3=THREE.Vector3;
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow=()=>innerWidth<980;
const DATA=window.VENUE_DATA, VENUES=DATA.venues, BY_ID=Object.fromEntries(VENUES.map(v=>[v.id,v]));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'$'+Number(n).toFixed(2);
const uid=(n=6)=>Math.random().toString(36).slice(2,2+n).toUpperCase();
const short=v=>v.name.split(' · ')[0];

const FOODS=[['pizza','Pizza'],['tacos','Tacos'],['noodles','Noodles'],['dumplings','Dumplings'],['deli','Deli'],['burgers','Burgers'],['bagels','Bagels'],['italian','Italian'],['anything','Anything']];
const VIBES=[['music','Live music'],['shows','Shows'],['holiday','Holiday & skating'],['views','Skyline views'],['art','Art & museums'],['games','Games'],['comedy','Comedy'],['outdoors','Outdoors'],['free','Free'],['nightlife','Nightlife'],['anything','Anything']];
const cap=s=>String(s).charAt(0).toUpperCase()+String(s).slice(1);
const fName=id=>(FOODS.find(f=>f[0]===id)||[])[1]||cap(id), vName=id=>(VIBES.find(f=>f[0]===id)||[])[1]||cap(id);
const KNOWN_F=new Set(FOODS.map(f=>f[0])), KNOWN_V=new Set(VIBES.map(f=>f[0]));
const COLORS=['#3f5873','#8aa596','#c2a46e','#b4735a','#7a6b93','#5f8fa3','#8b8e6a','#a87f86'];
const DEMO_IDS=['aru','mira','jun','sam'];

const BLOCKS={work:{l:'Work',c:'#3f5873',def:16},study:{l:'Study',c:'#7a6b93',def:6},busy:{l:'Busy',c:'#b4614b',def:2},relax:{l:'Relax',c:'#8aa596',def:4},sleep:{l:'Sleep',c:'#2d2f3a',def:16}};
const BUSY=new Set(['work','study','busy','sleep']);
function makeDay(blocks){ const d=Array(48).fill(''); blocks.forEach(([t,a,b])=>{ for(let i=Math.round(a*2);i<Math.round(b*2);i++) d[i]=t; }); return d; }
const hhmm=m=>{ m=Math.max(0,Math.min(1440,m)); const h=Math.floor(m/60)%24,mm=m%60; return `${((h+11)%12)+1}:${String(mm).padStart(2,'0')} ${h>=12?'PM':'AM'}`; };
const hs=m=>{ if(m>=1440) return 'midnight'; const h=Math.floor(m/60),mm=m%60; return `${((h+11)%12)+1}${mm?':'+String(mm).padStart(2,'0'):''}${h>=12?'pm':'am'}`; };

const state={
  step:1,maxStep:1,planName:'Saturday together',date:null,
  people:[], meId:null, planId:null, isOrganizer:false, version:-1, groupCap:null, sample:false,
  options:null, votes:{}, comments:{}, suggested:[], aiRaw:null, ai:null, selected:-1,
  lockedOpt:null, booked:null, plus:false, organizerPlus:false, health:{}
};
const me=()=>state.people.find(p=>p.id===state.meId);
let intro=false; /* welcome screen on step 1, dismissed by scrolling or the button */
function nextSaturday(){ const d=new Date(); d.setDate(d.getDate()+((6-d.getDay()+7)%7||7)); return d.toISOString().slice(0,10); }
const prettyDate=s=>new Date(s+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
const longDate=s=>new Date(s+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
state.date=nextSaturday();

/* ================= engine ================= */
const TAX=.08875,TIP=.20,TRAVEL=30,DAY_START=7*60;
const round2=x=>Math.round(x*100)/100;
const dow=d=>new Date(d+'T12:00:00').getDay();
const monthOf=d=>Number(d.slice(5,7));
const toMin=s=>{ const [h,m]=s.split(':').map(Number); return h*60+m; };
function ctxFor(){ const ms=state.people,mine=me(); const cap=state.groupCap!=null?state.groupCap:(mine&&mine.budget?Number(mine.budget):Infinity); return {date:state.date,size:Math.max(ms.length,1),u21:ms.some(m=>m.u21),veg:ms.some(m=>m.veg),cap}; }
function isAvailable(v,c){
  if(v.seasonal_months&&!v.seasonal_months.includes(monthOf(c.date))) return false;
  if(v.dates&&!v.dates.includes(c.date)) return false;
  if(v.date_range&&(c.date<v.date_range[0]||c.date>v.date_range[1])) return false;
  if(v.closed_days&&v.closed_days.includes(dow(c.date))) return false;
  if(v.age21&&c.u21) return false;
  if(v.type==='food'&&c.veg&&v.vegetarian===false) return false;
  return true;
}
const openOnDate=v=>isAvailable(v,{date:state.date,u21:false,veg:false});
function priceVenue(v,c,start){
  const n=c.size,d=dow(c.date); let base,note=v.price_note;
  if(v.unit_pricing){ const u=v.unit_pricing,units=Math.ceil(n/u.capacity),up=(d>=1&&d<=4)?u.weekday_price:u.weekend_price; base=units*up; note=`${units} ${u.unit}${units>1?'s':''} × $${up}/${u.per}`; }
  else { let pp=v.price_pp; if(v.special&&v.special.days.includes(d)&&start!=null&&start>=v.special.from){ pp=v.special.price_pp; note=v.special.label; } base=pp*n; }
  const tax=v.type==='food'?base*TAX:0,tip=v.type==='food'&&v.service==='table'?base*TIP:0;
  return {id:v.id,name:v.name,base:round2(base),tax:round2(tax),tip:round2(tip),total:round2(base+tax+tip),note};
}
function quoteStops(stops,c){ const lines=stops.map(s=>priceVenue(BY_ID[s.id],c,s.start)),sum=k=>round2(lines.reduce((a,l)=>a+l[k],0)); const subtotal=sum('base'),tax=sum('tax'),tip=sum('tip'),total=round2(subtotal+tax+tip); return {lines,subtotal,tax,tip,total,perPerson:round2(total/c.size),size:c.size}; }
function budgetStatus(pp,cap){ if(!isFinite(cap)) return {level:'none',ratio:0}; const r=pp/cap; return {level:r>1?'over':r>=.9?'warn':'ok',ratio:round2(r)}; }
/* typed extras (anything not in the preset lists) match a place when its name, category, tags or area contain the word */
const venueText=v=>(v.name+' '+v.category+' '+v.tags.join(' ')+' '+v.neighborhood).toLowerCase();
function memberMatches(v,m){ const wants=v.type==='food'?m.foods||[]:m.vibes||[]; const hits=v.tags.filter(t=>wants.includes(t)); const known=v.type==='food'?KNOWN_F:KNOWN_V, txt=venueText(v); wants.forEach(w=>{ if(known.has(w)||w.length<2||hits.includes(w)) return; if(txt.includes(w)||(w.length>3&&w.endsWith('s')&&txt.includes(w.slice(0,-1)))) hits.push(w); }); if((m.wishes||[]).includes(v.id)) hits.unshift('wished for '+short(v)); if(wants.includes('anything')) hits.push('open to anything'); return hits; }
const venueScore=(v,ms)=>ms.reduce((s,m)=>s+memberMatches(v,m).length+((m.wishes||[]).includes(v.id)?2:0),0);
function groupFreeSlots(){ const f=Array(48).fill(true); state.people.forEach(p=>(p.schedule||[]).forEach((t,i)=>{ if(BUSY.has(t)) f[i]=false; })); for(let i=0;i<DAY_START/30;i++) f[i]=false; return f; }
function freeWindows(slots){ const f=slots||groupFreeSlots(),w=[]; let s=-1; for(let i=0;i<=48;i++){ if(i<48&&f[i]){ if(s<0) s=i; } else if(s>=0){ w.push([s*30,i*30]); s=-1; } } return w; }
function personWindows(p){ return freeWindows(Array.from({length:48},(_,i)=>i>=DAY_START/30&&!BUSY.has((p.schedule||[])[i]))); }
const inWindows=(a,b,wins)=>wins.some(([x,y])=>a>=x&&b<=y);
const startsOf=v=>v.starts?v.starts.map(toMin):null;
/* travel between two venues: walk under ~1.3 km, otherwise subway (estimate) */
function distKm(a,b){ const R=6371,toR=Math.PI/180,dLa=(b.lat-a.lat)*toR,dLo=(b.lng-a.lng)*toR,x=Math.sin(dLa/2)**2+Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(x)); }
function travel(a,b){ if(!a||!b||a.lat==null||b.lat==null) return {min:TRAVEL,mode:'transit',km:0}; const km=distKm(a,b); return km<=1.3?{min:Math.max(10,Math.ceil(km/4.8*60)+5),mode:'walk',km}:{min:Math.ceil(12+km*3.2),mode:'subway',km}; }
function place(items,wins){
  let cur=0,prev=null; const out=[];
  for(const v of items){
    const dur=v.duration_min,fixed=startsOf(v); let s=null;
    if(prev) cur+=travel(prev,v).min; prev=v;
    if(fixed){ s=fixed.find(x=>x>=cur&&inWindows(x,x+dur,wins)); if(s==null) return null; }
    else { const [o,c]=v.hours||[0,1440]; const tries=v.type==='food'?[690,1080,0]:[0];
      for(const pref of tries){ for(const [a,b] of wins){ let t=Math.ceil(Math.max(cur,o,a,pref)/15)*15; if(t+dur<=Math.min(b,c)){ s=t; break; } } if(s!=null) break; }
      if(s==null) return null; }
    out.push({id:v.id,start:s}); cur=s+dur;
  }
  return out;
}
const PERMS={1:[[0]],2:[[0,1],[1,0]],3:[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]};
function bestPlacement(items,wins){ let best=null,bs=-Infinity; for(const p of PERMS[items.length]){ const st=place(p.map(i=>items[i]),wins); if(!st) continue; const last=st[st.length-1],end=last.start+BY_ID[last.id].duration_min,span=end-st[0].start; const f=st.find(x=>BY_ID[x.id].type==='food'); const meal=f&&((f.start>=660&&f.start<=840)||(f.start>=1050&&f.start<=1230))?60:0; const sc=meal-span/10-st[0].start/200; if(sc>bs){ bs=sc; best=st; } } return best; }
function evaluateStops(stops,ms,c){ const items=stops.map(s=>BY_ID[s.id]),q=quoteStops(stops,c); let coverage=0,score=0,wish=0; ms.forEach(m=>{ const h=items.reduce((a,v)=>a+memberMatches(v,m).length,0); const w=items.filter(v=>(m.wishes||[]).includes(v.id)).length; if(h>0) coverage++; score+=h; wish+=w; }); return {stops,perPerson:q.perPerson,total:q.total,coverage,score,wish,fits:q.perPerson<=c.cap}; }
const candidatePool=()=>{ const c=ctxFor(); return VENUES.filter(v=>isAvailable(v,c)); };
function recommend(){
  const c=ctxFor(),ms=state.people,wins=freeWindows(),pool=candidatePool(); if(!wins.length) return [];
  const foods=pool.filter(v=>v.type==='food'),acts=pool.filter(v=>v.type==='activity'); const combos=[],seen=new Set();
  const tryItems=items=>{ const st=bestPlacement(items,wins); if(!st) return; const key=st.map(s=>s.id).sort().join('|'); if(seen.has(key)) return; seen.add(key); combos.push(evaluateStops(st,ms,c)); };
  foods.forEach(f=>acts.forEach((a,i)=>{ tryItems([f,a]); acts.slice(i+1).forEach(b=>tryItems([f,a,b])); }));
  const val=x=>x.coverage*10+x.wish*4+x.score, rank=(a,b)=>val(b)-val(a)||a.perPerson-b.perPerson;
  const fitting=combos.filter(x=>x.fits).sort(rank);
  if(!fitting.length){ const cheap=combos.sort((a,b)=>a.perPerson-b.perPerson)[0]; return cheap?[{...cheap,label:'Cheapest option (over budget)'}]:[]; }
  const actOf=x=>x.stops.filter(s=>BY_ID[s.id].type==='activity').map(s=>s.id), foodOf=x=>x.stops.find(s=>BY_ID[s.id].type==='food').id;
  const picked=[],usedA=new Set(),usedF=new Set(); const take=(x,label)=>{ if(!x) return; picked.push({...x,label}); actOf(x).forEach(a=>usedA.add(a)); usedF.add(foodOf(x)); };
  take(fitting[0],'Best for everyone');
  take(fitting.filter(x=>x.coverage>=fitting[0].coverage-1&&!actOf(x).some(a=>usedA.has(a))).sort((a,b)=>val(b)/(b.perPerson+15)-val(a)/(a.perPerson+15))[0],'Most money-efficient');
  take(fitting.filter(x=>!actOf(x).some(a=>usedA.has(a))&&!usedF.has(foodOf(x))).sort(rank)[0],'Something different');
  fitting.filter(x=>!actOf(x).some(a=>usedA.has(a))).forEach(x=>{ if(picked.length<3) take(x,'Another idea'); });
  const live=fitting.filter(x=>x.stops.some(s=>BY_ID[s.id].dates)).sort(rank)[0];
  if(live&&!picked.some(p=>p.stops.some(s=>BY_ID[s.id].dates))){ const slot=picked.length<3?picked.length:picked.length-1; picked[slot]={...live,label:'Live music that night'}; }
  return picked;
}
function swap(o,role){
  const c=ctxFor(),ms=state.people,wins=freeWindows(),pool=candidatePool(),type=role==='food'?'food':'activity';
  const idx=o.stops.findIndex(s=>BY_ID[s.id].type===type); if(idx<0) return null;
  const cur=o.stops[idx].id,others=o.stops.filter((_,i)=>i!==idx).map(s=>BY_ID[s.id]);
  const cands=pool.filter(v=>v.type===type&&!o.stops.some(s=>s.id===v.id)).sort((a,b)=>venueScore(b,ms)-venueScore(a,ms)||a.name.localeCompare(b.name));
  const startAt=Math.max(0,cands.findIndex(v=>v.id===o.lastSwap?.[role]));
  for(let i=0;i<cands.length;i++){ const cand=cands[(startAt+1+i)%cands.length]; if(cand.id===cur) continue; const st=bestPlacement([cand,...others],wins); if(!st) continue; const res=evaluateStops(st,ms,c); if(res.fits) return {...o,...res,lastSwap:{...(o.lastSwap||{}),[role]:cand.id}}; }
  return null;
}
const itemsFor=o=>o.stops.map(s=>BY_ID[s.id]);
const explain=o=>{ const items=itemsFor(o); return state.people.map(m=>({m,hits:[...new Set(items.flatMap(v=>memberMatches(v,m)))]})); };
const schedule=o=>o.stops.map(s=>({time:hhmm(s.start),v:BY_ID[s.id],s:s.start,end:s.start+BY_ID[s.id].duration_min}));
const optKey=o=>o.stops.map(s=>s.id).join('|');
const votesFor=i=>state.options&&state.options[i]?(state.votes[optKey(state.options[i])]||{}):{};
const tally=i=>{ const vals=Object.values(votesFor(i)); return {up:vals.filter(x=>x===1).length,down:vals.filter(x=>x===-1).length}; };
function winnerIdx(){ let best=-1,bn=-Infinity; (state.options||[]).forEach((o,i)=>{ const t=tally(i),n=t.up-t.down; if(n>bn){bn=n;best=i;} }); return best; }
function validateStops(raw){
  const c=ctxFor(),wins=freeWindows(),out=[],problems=[]; let cur=0,prev=null;
  for(const r of raw||[]){
    const v=BY_ID[String(r.id||'')]; if(!v){ problems.push(`unknown place “${r.id}”`); return {ok:false,problems}; }
    if(!isAvailable(v,c)){ problems.push(`${short(v)} isn’t available that day`); return {ok:false,problems}; }
    const m=/^(\d{1,2}):(\d{2})$/.exec(String(r.start||'')); if(!m){ problems.push(`bad time for ${short(v)}`); return {ok:false,problems}; }
    const s=+m[1]*60+ +m[2],e=s+v.duration_min,fixed=startsOf(v);
    if(fixed&&!fixed.includes(s)){ problems.push(`${short(v)} doesn’t start at ${hhmm(s)}`); return {ok:false,problems}; }
    if(!fixed&&v.hours&&(s<v.hours[0]||e>v.hours[1])){ problems.push(`${short(v)} is closed at ${hhmm(s)}`); return {ok:false,problems}; }
    if(!inWindows(s,e,wins)){ problems.push(`${short(v)} at ${hhmm(s)} clashes with someone’s day`); return {ok:false,problems}; }
    if(prev&&s<cur+travel(prev,v).min){ problems.push(`not enough travel time before ${short(v)}`); return {ok:false,problems}; }
    if(out.some(x=>x.id===v.id)){ problems.push(`${short(v)} appears twice`); return {ok:false,problems}; }
    out.push({id:v.id,start:s}); cur=e; prev=v;
  }
  if(!out.length) return {ok:false,problems:['no stops']};
  return {ok:true,stops:out};
}

/* ================= server sync ================= */
function newTok(){ const a=new Uint8Array(18); crypto.getRandomValues(a); return Array.from(a,b=>'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b%62]).join(''); }
const TOKEN=(function(){
  /* No sign-up: each browser gets a random token. "?fresh=1" gives this tab its own identity,
     so a judge can play a second person in another tab without an incognito window. */
  const fresh=new URLSearchParams(location.search).has('fresh');
  try{
    let t=sessionStorage.getItem('pt:token');
    if(!t&&fresh){ t=newTok(); sessionStorage.setItem('pt:token',t); }
    if(t) return t;
    t=localStorage.getItem('pt:token'); if(!t){ t=newTok(); localStorage.setItem('pt:token',t); }
    return t;
  }catch(e){ return newTok(); }
})();
async function api(method,path,body){
  let r; try{ r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}); }
  catch(e){ const err=new Error('Can’t reach the server. Check your connection.'); err.code='offline'; throw err; }
  let j={}; try{ j=await r.json(); }catch(e){}
  if(!r.ok){ const err=new Error(j.message||('Request failed ('+r.status+')')); err.code=j.error; err.status=r.status; throw err; }
  return j;
}
function save(){}
const memberSig=()=>JSON.stringify(state.people.map(m=>[m.id,m.schedule,m.wishes,m.foods,m.vibes,m.veg,m.u21]))+'|'+state.groupCap;
let lastSig='', lastAiAt=0;
function applyPlan(p){
  state.planId=p.id; state.planName=p.name; state.date=p.date; state.isOrganizer=p.isOrganizer; state.meId=p.meId;
  state.groupCap=p.groupCap; state.sample=p.sample; state.votes=p.votes||{}; state.comments=p.comments||{};
  state.suggested=p.suggested||[]; state.organizerPlus=p.organizerPlus; state.pass=!!p.pass; state.version=p.version; state.booked=p.booked; state.aiRaw=p.ai;
  state.people=p.members.map(m=>({...m}));
  ents.slice().forEach(e=>{ if(!state.people.find(x=>x.id===e.p.id)) removeEnt(e); });
  state.people.forEach(m=>{ const e=ents.find(x=>x.p.id===m.id);
    if(!e){ const ne=addEnt(m,null); if(state.step>=4){ ne.mode='absorbed'; ne.obj.visible=false; } if(state.step===3) updateAbsorb(); }
    else { const changed=JSON.stringify([e.p.color,e.p.foods,e.p.vibes,e.p.name])!==JSON.stringify([m.color,m.foods,m.vibes,m.name]); e.p=m; if(changed) rebuildEnt(e); } });
  refreshLabels();
  $('#planKicker').textContent=planMeta();
  $('#inviteLink').value=location.origin+'/p/'+p.id;
  $('#secondLink').href='/p/'+p.id+'?fresh=1';
  if(state.step===2){ renderCrew(); if(!editingId&&state.meId) editPerson(state.meId); }
  const sig=memberSig(), aiAt=p.ai?p.ai.at:0;
  if(state.step===4&&(sig!==lastSig||aiAt!==lastAiAt||suggestSig()!==lastSuggest)){ refreshOptions(); }
  lastSig=sig; lastAiAt=aiAt;
  if(p.locked){ const o=optionFromServer(p.locked); if(!state.lockedOpt||optKey(state.lockedOpt)!==optKey(o)||!!state.booked!==!!state.lockedBooked){ state.lockedOpt=o; state.lockedBooked=!!state.booked; state.maxStep=5; renderTicket(); if(state.step!==5) goStep(5); } else if(state.step===5) renderTicket(); }
  else if(state.lockedOpt){ state.lockedOpt=null; if(state.step===5){ state.maxStep=4; goStep(4); } }
  if(state.step===4){ renderPlanList(); if(state.selected>=0) renderDetail(); }
  renderPlusBadge();
}
let pollBusy=false;
async function poll(){
  if(!state.planId||pollBusy||document.visibilityState!=='visible') return;
  if(document.activeElement&&document.activeElement.id==='cmtIn') return;
  pollBusy=true;
  try{ const r=await api('GET','/plans/'+state.planId+'?token='+TOKEN); if(r.plan.version!==state.version) applyPlan(r.plan); }
  catch(e){} finally{ pollBusy=false; }
}
setInterval(poll,3500);
async function refreshMe(){ try{ const r=await api('GET','/me?token='+TOKEN); state.plus=r.plus; state.tier=r.tier||null; state.coveredBy=r.coveredBy||null; state.myPlans=r.plans||[]; state.stats=r.stats||null; state.profile=r.profile||null; renderPlusBadge(); renderMine(); }catch(e){} }

/* ================= three ================= */
const canvas=$('#gl');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene(), cam=new THREE.PerspectiveCamera(40,1,.1,300);
let W=1,H=1; function resize(){ W=innerWidth; H=innerHeight; renderer.setSize(W,H,false); cam.aspect=W/H; cam.updateProjectionMatrix(); } addEventListener('resize',resize); resize();
const hemi=new THREE.HemisphereLight(0xffffff,0xd9d4cc,.9); scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffffff,.8); sun.position.set(-5,9,6); scene.add(sun);
const fill=new THREE.DirectionalLight(0xdfe4ee,.35); fill.position.set(-8,-2,-4); scene.add(fill);
const SUN_DAY=[-5,9,6], SUN_GOLD=[-10,4,-1];
const LIGHTS={1:{sky:0xffe9d2,gr:0xd6ac93,hi:1.02,si:1.4,sc:0xffb673,sp:SUN_GOLD},2:{sky:0xffecd8,gr:0xd2ab95,hi:1.05,si:1.3,sc:0xffbb7d,sp:SUN_GOLD},3:{sky:0xffdcc6,gr:0xc99a8c,hi:.98,si:1.45,sc:0xffa264,sp:SUN_GOLD},4:{sky:0xffffff,gr:0xc7cbd3,hi:.64,si:.8,sc:0xffffff,sp:SUN_DAY},5:{sky:0xaeb6d6,gr:0x1b1d27,hi:.65,si:.8,sc:0xffffff,sp:SUN_DAY}};
function tex(draw,w=512,h=256){ const c=document.createElement('canvas'); c.width=w; c.height=h; draw(c.getContext('2d'),w,h); const t=new THREE.CanvasTexture(c); t.anisotropy=4; return t; }
const rand=(a,b)=>a+Math.random()*(b-a);
const bandTex=hex=>tex((g,w,h)=>{ g.fillStyle=hex; g.fillRect(0,0,w,h); let y=0; while(y<h){ const bh=rand(6,28); g.fillStyle=`rgba(${Math.random()<.5?'255,255,255':'0,0,0'},${rand(.02,.07)})`; g.fillRect(0,y,w,bh); y+=bh+rand(2,16); } for(let i=0;i<120;i++){ g.fillStyle=`rgba(255,255,255,${rand(.02,.06)})`; g.beginPath(); g.ellipse(rand(0,w),rand(0,h),rand(4,30),rand(1,4),0,0,7); g.fill(); } });
const std=(c,o={})=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:.6,metalness:.02},o));
const mesh=(g,m)=>new THREE.Mesh(g,m);
function onSurface(obj,dir,r){ dir=dir.clone().normalize(); obj.position.copy(dir).multiplyScalar(r); obj.quaternion.setFromUnitVectors(new V3(0,1,0),dir); return obj; }
function randDir(minY=-1){ let v; do{ v=new V3(rand(-1,1),rand(-1,1),rand(-1,1)); }while(v.length()>1||v.length()<.2||v.clone().normalize().y<minY); return v.normalize(); }
function orbitLine(r,tilt,opacity){ const pts=[]; for(let i=0;i<=96;i++){ const a=i/96*Math.PI*2; pts.push(new V3(Math.cos(a)*r,Math.sin(a)*r*tilt,Math.sin(a)*r)); } return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0x17171c,transparent:true,opacity})); }
/* a tiny rider who sits on top of each planet: beanie in the planet's tone, orange scarf, one arm waving */
function buildRider(color){
  const g=new THREE.Group(), ink=std(0x24242c,{roughness:.6}), pale=std(0xf3e9dc,{roughness:.7}), acc=std(0xe2552d,{roughness:.5}), tone=std(color,{roughness:.55});
  const add=(geo,mat,x,y,z,rx=0,rz=0,to=g)=>{ const m=mesh(geo,mat); m.position.set(x,y,z); m.rotation.x=rx; m.rotation.z=rz; to.add(m); return m; };
  add(new THREE.CylinderGeometry(.075,.1,.24,14),ink,0,.2,0);
  add(new THREE.SphereGeometry(.085,18,14),pale,0,.415,0);
  add(new THREE.SphereGeometry(.092,18,10,0,Math.PI*2,0,Math.PI/2),tone,0,.425,0);
  add(new THREE.TorusGeometry(.075,.026,8,18),acc,0,.325,0,Math.PI/2);
  [-.045,.045].forEach(x=>{ add(new THREE.CylinderGeometry(.036,.036,.17,10),ink,x,.075,.085,Math.PI/2); add(new THREE.CylinderGeometry(.032,.03,.15,10),ink,x,.03,.19,.5); add(new THREE.SphereGeometry(.04,10,8),pale,x,-.03,.24); });
  add(new THREE.CylinderGeometry(.026,.024,.2,8),ink,-.115,.2,.01,0,-.25);
  const arm=new THREE.Group(); arm.position.set(.095,.295,0); add(new THREE.CylinderGeometry(.026,.024,.2,8),ink,0,.1,0,0,0,arm); add(new THREE.SphereGeometry(.032,10,8),pale,0,.215,0,0,0,arm); g.add(arm);
  g.scale.setScalar(1.55); g.userData={arm,ph:Math.random()*6.28}; return g;
}
/* person planet: a toned sphere, a thin ring, one small moon per interest, a dark "private budget" moon and a rider */
function buildPlanet(p){
  const root=new THREE.Group(), spin=new THREE.Group(); root.add(spin);
  spin.add(mesh(new THREE.SphereGeometry(1,64,48),std(0xffffff,{map:bandTex(p.color),roughness:.55})));
  const ring=mesh(new THREE.TorusGeometry(1.5,.012,8,160),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.85})); ring.rotation.x=Math.PI/2-.35; root.add(ring);
  const moons=[];
  p.vibes.slice(0,3).forEach((a,i)=>{ const r=1.95+i*.36,tilt=.3-i*.22; root.add(orbitLine(r,tilt,.12)); const m=mesh(new THREE.SphereGeometry(.12,24,16),std(0xf6f4f0,{roughness:.4})); root.add(m); moons.push({o:m,r,sp:(.7-i*.15)*(i%2?-1:1),ph:i*2.1,tilt}); });
  const lock=mesh(new THREE.OctahedronGeometry(.09),std(0x17171c,{roughness:.3,metalness:.3})); root.add(lock); moons.push({o:lock,r:1.62,sp:-1.2,ph:.6,tilt:-.5});
  const rider=buildRider(p.color); onSurface(rider,new V3(.16,1,.2),.985); root.add(rider);
  root.userData={spin,moons,person:p,rider}; root.traverse(o=>{ if(o.isMesh) o.userData.owner=root; }); return root;
}
function disposeObj(o){ o.traverse(c=>{ if(c.isMesh||c.isLine){ c.geometry.dispose(); [].concat(c.material).forEach(m=>{ if(m.map) m.map.dispose(); m.dispose(); }); } }); }
/* ===== Manhattan: real shoreline, parks and building footprints (NYC Open Data) ===== */
const MD=window.MAP_DATA, S=0.00057, HEX=2.4, ROT=61*Math.PI/180, LAND=.04;
const cosR=Math.cos(ROT), sinR=Math.sin(ROT);
const KX=Math.cos(MD.origin[0]*Math.PI/180)*111320, KY=110574;
let CX=0, CZ=0;
const m2w=(x,y)=>{ const xr=x*cosR+y*sinR, yr=-x*sinR+y*cosR; return [xr*S-CX,-yr*S-CZ]; };
const ll2w=(lat,lng)=>m2w((lng-MD.origin[1])*KX,(lat-MD.origin[0])*KY);
(function(){ let a=1e9,b=-1e9,c=1e9,d=-1e9; MD.land.forEach(r=>{ for(let i=0;i<r.length;i+=2){ const [x,z]=m2w(r[i],r[i+1]); a=Math.min(a,x); b=Math.max(b,x); c=Math.min(c,z); d=Math.max(d,z); } }); CX=(a+b)/2; CZ=(c+d)/2; })();
const core=new THREE.Group(); scene.add(core); core.userData.pulse=0;
const city=new THREE.Group(); scene.add(city);
/* city planet: calm white by day; on the last step it turns into a lit night planet with an atmosphere, glowing rings and one small moon per person */
const cityFx=new THREE.Group(); scene.add(cityFx);
let nightMix=0; const cityNight={towers:[],moons:[]};
const ADD={blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneFactor,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor};
const addMat=(color,opacity=0)=>Object.assign(new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false}),ADD);
function glowMat(hex,back){ return new THREE.ShaderMaterial({uniforms:{c:{value:new THREE.Color(hex)},k:{value:0}},side:back?THREE.BackSide:THREE.FrontSide,transparent:true,depthWrite:false,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor,
  vertexShader:'varying vec3 vN;varying vec3 vV;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
  fragmentShader:'uniform vec3 c;uniform float k;varying vec3 vN;varying vec3 vV;void main(){float d=dot(normalize(vN),normalize(vV));float i='+(back?'pow(clamp(-d/0.58,0.0,1.0),2.6)':'pow(1.0-clamp(d,0.0,1.0),3.2)')+';gl_FragColor=vec4(c*i*k,1.0);}'}); }
const lightsTex=tex((g,w,h)=>{ g.fillStyle='#000'; g.fillRect(0,0,w,h); const cs=[]; for(let i=0;i<34;i++) cs.push([rand(0,w),rand(h*.16,h*.84),rand(16,56)]);
  g.strokeStyle='rgba(255,196,128,.2)'; g.lineWidth=.8; cs.forEach((p,i)=>{ const q=cs[(i+1+Math.floor(rand(0,3)))%cs.length]; if(Math.abs(p[0]-q[0])>w*.35) return; g.beginPath(); g.moveTo(p[0],p[1]); g.quadraticCurveTo((p[0]+q[0])/2+rand(-30,30),(p[1]+q[1])/2+rand(-30,30),q[0],q[1]); g.stroke(); });
  cs.forEach(([x,y,r])=>{ for(let k=0;k<r*10;k++){ const an=rand(0,6.283),d=Math.pow(Math.random(),1.8)*r,sz=rand(.5,1.5); g.fillStyle=Math.random()<.12?'rgba(170,210,255,.9)':`rgba(255,${Math.floor(rand(190,235))},${Math.floor(rand(120,180))},${rand(.5,1).toFixed(2)})`; g.fillRect(x+Math.cos(an)*d*1.6,y+Math.sin(an)*d,sz,sz); } });
},1024,512);
const winTex=tex((g,w,h)=>{ g.fillStyle='#000'; g.fillRect(0,0,w,h); for(let y=5;y<h-6;y+=9) for(let x=5;x<w-6;x+=9){ if(Math.random()<.58){ g.globalAlpha=rand(.45,1); g.fillStyle=Math.random()<.14?'#cfe4ff':'#ffd9a3'; g.fillRect(x,y,4,5); } } g.globalAlpha=1; },64,128);
const globeMat=std(0xebe8e2,{roughness:.75,emissive:0xffffff,emissiveMap:lightsTex,emissiveIntensity:0});
const ringMat=new THREE.MeshBasicMaterial({color:0xe2552d});
const halo=mesh(new THREE.SphereGeometry(1.7*1.24,64,48),glowMat(0x6f9dff,true)), rim=mesh(new THREE.SphereGeometry(1.7*1.012,64,48),glowMat(0x9cc0ff,false));
const ringGlow=mesh(new THREE.TorusGeometry(2.3,.07,10,180),addMat(0xe2552d));
const crewRing=new THREE.Group(); crewRing.rotation.x=Math.PI/2-.2; crewRing.rotation.y=.22;
const outerRing=mesh(new THREE.TorusGeometry(2.95,.006,6,200),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0}));
(function(){
  city.add(mesh(new THREE.SphereGeometry(1.7,64,48),globeMat));
  for(let i=0;i<110;i++){ const tall=Math.random()<.14, h=rand(.1,.5)*(tall?1.9:1), col=Math.random()<.3?0x2a2b33:(Math.random()<.5?0xd6d2ca:0xf4f2ee);
    const m=std(col,{roughness:.5,emissive:0xffffff,emissiveMap:winTex,emissiveIntensity:0}); const bx=mesh(new THREE.BoxGeometry(rand(.1,.2),1,rand(.1,.2)),m); bx.geometry.translate(0,.5,0); bx.scale.y=h; city.add(onSurface(bx,randDir(i<80?0:-.55),1.66)); cityNight.towers.push({m,base:new THREE.Color(col)}); }
  const ring=mesh(new THREE.TorusGeometry(2.3,.015,8,180),ringMat); ring.rotation.x=Math.PI/2+.25; ring.add(ringGlow); city.add(ring);
  crewRing.add(outerRing); cityFx.add(halo,rim,crewRing);
})();
/* low golden sun behind the skyline (steps 1 to 3) */
const sunTex=tex((g,w,h)=>{ const gr=g.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2); gr.addColorStop(0,'rgba(255,244,214,.95)'); gr.addColorStop(.05,'rgba(255,220,160,.7)'); gr.addColorStop(.18,'rgba(255,180,110,.28)'); gr.addColorStop(.5,'rgba(255,150,90,.07)'); gr.addColorStop(1,'rgba(255,140,80,0)'); g.fillStyle=gr; g.fillRect(0,0,w,h); },256,256);
const sunGlow=new THREE.Sprite(Object.assign(new THREE.SpriteMaterial({map:sunTex,transparent:true,opacity:0,depthWrite:false}),ADD)); sunGlow.position.set(-20,1.6,-50); sunGlow.scale.setScalar(40); scene.add(sunGlow);
let sphereMix=0, goldMix=1;
function buildCrewMoons(){ cityNight.moons.forEach(m=>{ crewRing.remove(m); disposeObj(m); }); cityNight.moons.length=0;
  state.people.forEach((p,i)=>{ const g=new THREE.Group(), a=i/state.people.length*Math.PI*2; g.add(mesh(new THREE.SphereGeometry(.085,20,14),new THREE.MeshBasicMaterial({color:p.color}))); g.add(mesh(new THREE.SphereGeometry(.2,20,14),addMat(p.color,.28))); g.position.set(Math.cos(a)*2.95,Math.sin(a)*2.95,0); crewRing.add(g); cityNight.moons.push(g); }); }
let mapMix=0;
const MAPCOL={gold:{land:0xf4dcbc,bk:0xe9cda8,park:0xb5b684,water:0xf7c891,lo:0xcdc9c1,hi:0x2b2e38},day:{land:0xf7f5f1,bk:0xe9e8e4,park:0xc7d5c4,water:0xdce2e7,lo:0xcdc9c1,hi:0x2b2e38},night:{land:0x2a2d3a,bk:0x23262f,park:0x2c3a35,water:0x141722,lo:0x4a4d5c,hi:0x7b7f92}};
function shapeFrom(r){ const s=new THREE.Shape(); for(let i=0;i<r.length;i+=2){ const [x,z]=m2w(r[i],r[i+1]); i?s.lineTo(x,-z):s.moveTo(x,-z); } return s; }
const landMat=new THREE.MeshLambertMaterial({color:MAPCOL.day.land}), bkMat=new THREE.MeshLambertMaterial({color:MAPCOL.day.bk}), parkMat=new THREE.MeshLambertMaterial({color:MAPCOL.day.park});
(function(){
  const ext={depth:LAND,bevelEnabled:false};
  MD.land.forEach(r=>{ const g=new THREE.ExtrudeGeometry(shapeFrom(r),ext); g.rotateX(-Math.PI/2); core.add(mesh(g,landMat)); });
  MD.parks.forEach(p=>{ const g=new THREE.ShapeGeometry(shapeFrom(p.p)); g.rotateX(-Math.PI/2); g.translate(0,LAND+.002,0); core.add(mesh(g,parkMat)); });
})();
/* water: soft disc that fades into the page */
const waterTex=tex((g,w,h)=>{ const gr=g.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2); gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(.55,'rgba(255,255,255,.9)'); gr.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle=gr; g.fillRect(0,0,w,h); },256,256);
const waterMat=new THREE.MeshBasicMaterial({color:MAPCOL.day.water,map:waterTex,transparent:true,depthWrite:false});
const water=mesh(new THREE.PlaneGeometry(26,26),waterMat); water.rotation.x=-Math.PI/2; water.position.y=-.005; core.add(water);
/* buildings: one merged mesh, extruded from real footprints and roof heights */
const bldMat=new THREE.MeshLambertMaterial({vertexColors:true});
(function(){
  const B=MD.b; let nv=0; const cnt=[];
  for(const b of B){ const n=(b.length-1)/2; cnt.push(n); nv+=n*6+(n-2)*3; }
  const pos=new Float32Array(nv*3), nor=new Float32Array(nv*3), col=new Float32Array(nv*3);
  const lo=new THREE.Color(MAPCOL.day.lo), hi=new THREE.Color(MAPCOL.day.hi), c=new THREE.Color(); let o=0;
  const put=(x,y,z,nx,ny,nz)=>{ pos[o*3]=x; pos[o*3+1]=y; pos[o*3+2]=z; nor[o*3]=nx; nor[o*3+1]=ny; nor[o*3+2]=nz; col[o*3]=c.r; col[o*3+1]=c.g; col[o*3+2]=c.b; o++; };
  B.forEach((b,bi)=>{
    const n=cnt[bi], H=LAND+b[0]*S*HEX, pts=[]; let cx=0,cz=0;
    for(let i=0;i<n;i++){ const [x,z]=m2w(b[1+i*2],b[2+i*2]); pts.push([x,z]); cx+=x; cz+=z; } cx/=n; cz/=n;
    const t=Math.min(1,Math.max(0,(b[0]-25)/200)); c.copy(lo).lerp(hi,Math.pow(t,.8)); const jitter=1+(((bi*9301+49297)%233280)/233280-.5)*.06; c.multiplyScalar(jitter);
    for(let i=0;i<n;i++){ const a=pts[i],e=pts[(i+1)%n]; const dx=e[0]-a[0],dz=e[1]-a[1]; let nx=-dz,nz=dx; const L=Math.hypot(nx,nz)||1; nx/=L; nz/=L;
      const mx=(a[0]+e[0])/2-cx, mz=(a[1]+e[1])/2-cz; const out=nx*mx+nz*mz>=0;
      if(!out){ nx=-nx; nz=-nz; }
      if(out){ put(a[0],LAND,a[1],nx,0,nz); put(e[0],LAND,e[1],nx,0,nz); put(e[0],H,e[1],nx,0,nz); put(a[0],LAND,a[1],nx,0,nz); put(e[0],H,e[1],nx,0,nz); put(a[0],H,a[1],nx,0,nz); }
      else { put(a[0],LAND,a[1],nx,0,nz); put(e[0],H,e[1],nx,0,nz); put(e[0],LAND,e[1],nx,0,nz); put(a[0],LAND,a[1],nx,0,nz); put(a[0],H,a[1],nx,0,nz); put(e[0],H,e[1],nx,0,nz); }
    }
    const tri=THREE.ShapeUtils.triangulateShape(pts.map(p=>new THREE.Vector2(p[0],p[1])),[]);
    const roofC=c.clone(); c.offsetHSL(0,0,.05);
    for(const [i0,i1,i2] of tri){ const p=pts[i0],q=pts[i1],r=pts[i2]; const up=(q[1]-p[1])*(r[0]-p[0])-(q[0]-p[0])*(r[1]-p[1])>0;
      if(up){ put(p[0],H,p[1],0,1,0); put(q[0],H,q[1],0,1,0); put(r[0],H,r[1],0,1,0); } else { put(p[0],H,p[1],0,1,0); put(r[0],H,r[1],0,1,0); put(q[0],H,q[1],0,1,0); } }
    c.copy(roofC);
    while(o<0) o++;
  });
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos.subarray(0,o*3),3)); g.setAttribute('normal',new THREE.BufferAttribute(nor.subarray(0,o*3),3)); g.setAttribute('color',new THREE.BufferAttribute(col.subarray(0,o*3),3));
  const m=mesh(g,bldMat); m.frustumCulled=false; core.add(m);
})();
/* Brooklyn Bridge, thin and quiet */
(function(){ const a=ll2w(40.7114,-74.0026), b=ll2w(40.7008,-73.9899); const A=new V3(a[0],LAND,a[1]), Bv=new V3(b[0],LAND,b[1]), M=A.clone().add(Bv).multiplyScalar(.5); M.y=.06; core.add(mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(A,M,Bv),30,.006,4),new THREE.MeshBasicMaterial({color:0x9a9aa3}))); })();
/* map labels */
const GEO=[['Central Park',40.7812,-73.9665],['Midtown',40.7549,-73.9840],['Lower Manhattan',40.7075,-74.0100],['Harlem',40.8116,-73.9465],['Upper West Side',40.7870,-73.9754],['Upper East Side',40.7736,-73.9566],['Greenwich Village',40.7336,-74.0027],['Chelsea',40.7465,-74.0014],['Downtown Brooklyn',40.6928,-73.9840],['Hudson River',40.7600,-74.0150,1],['East River',40.7380,-73.9680,1]];
let geoLabels=[];
const starGeo=new THREE.BufferGeometry(); { const n=1200,p=new Float32Array(n*3); for(let i=0;i<n;i++){ const d=randDir(-.2).multiplyScalar(rand(40,80)); p.set([d.x,d.y,d.z],i*3); } starGeo.setAttribute('position',new THREE.BufferAttribute(p,3)); }
const stars=new THREE.Points(starGeo,new THREE.PointsMaterial({size:.18,color:0xffffff,transparent:true,opacity:0,depthWrite:false})); scene.add(stars);
const dustGeo=new THREE.BufferGeometry(); { const n=500,p=new Float32Array(n*3); for(let i=0;i<n;i++){ const d=randDir().multiplyScalar(rand(9,30)); p.set([d.x,d.y*.5,d.z],i*3); } dustGeo.setAttribute('position',new THREE.BufferAttribute(p,3)); }
const dust=new THREE.Points(dustGeo,new THREE.PointsMaterial({size:.06,color:0x17171c,transparent:true,opacity:.25,depthWrite:false})); scene.add(dust);
class Particles{
  constructor(n,additive,size){ this.n=n; this.i=0; this.pos=new Float32Array(n*3).fill(-999); this.col=new Float32Array(n*3); this.base=new Float32Array(n*3); this.vel=new Float32Array(n*3); this.life=new Float32Array(n); this.additive=additive; const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(this.pos,3)); g.setAttribute('color',new THREE.BufferAttribute(this.col,3)); const mat=new THREE.PointsMaterial({size,vertexColors:true,transparent:true,depthWrite:false}); if(additive) Object.assign(mat,{blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor}); this.pts=new THREE.Points(g,mat); this.pts.frustumCulled=false; scene.add(this.pts); }
  emit(o,colors,count,speed){ const c=new THREE.Color(); for(let k=0;k<count;k++){ const i=this.i++%this.n,d=randDir().multiplyScalar(speed*rand(.35,1)); this.pos.set([o.x,o.y,o.z],i*3); this.vel.set([d.x,d.y,d.z],i*3); c.set(colors[Math.floor(Math.random()*colors.length)]); this.base.set([c.r,c.g,c.b],i*3); this.col.set([c.r,c.g,c.b],i*3); this.life[i]=1; } }
  update(dt,grav){ for(let i=0;i<this.n;i++){ if(this.life[i]<=0) continue; this.life[i]-=dt*.6; const j=i*3; this.vel[j+1]-=grav*dt; for(let a=0;a<3;a++){ this.vel[j+a]*=.985; this.pos[j+a]+=this.vel[j+a]*dt; } const l=Math.max(0,this.life[i]); if(this.additive){ for(let a=0;a<3;a++) this.col[j+a]=this.base[j+a]*l; } if(this.life[i]<=0) this.pos[j+1]=-999; } this.pts.geometry.attributes.position.needsUpdate=true; this.pts.geometry.attributes.color.needsUpdate=true; }
}
const sparks=new Particles(700,false,.12), glow=new Particles(1600,true,.2);

/* planets */
const ents=[], labelsEl=$('#labels');
function makeLabel(cls,html){ const d=document.createElement('div'); d.className='lbl '+cls; d.innerHTML=html; d.style.opacity=0; labelsEl.appendChild(d); return d; }
const labelHtml=p=>`<i style="background:${p.color}"></i>${esc(p.name)}${p.id===state.meId?' · you':''}`;
const ORBIT_Y=2; /* planets circle above the skyline */
function orbitFor(i){ return {r:4.6+(i%6)*1.05,sp:(.22-(i%6)*.022)*(reduce?.3:1),tilt:(i%2?1:-1)*(.08+(i%3)*.06),ang:i*1.25}; }
const orbitPos=o=>new V3(Math.cos(o.ang)*o.r,ORBIT_Y+Math.sin(o.ang)*o.r*o.tilt,Math.sin(o.ang)*o.r);
function orbitLineP(r,tilt,opacity){ const pts=[]; for(let i=0;i<=120;i++){ const a=i/120*Math.PI*2; pts.push(new V3(Math.cos(a)*r,ORBIT_Y+Math.sin(a)*r*tilt,Math.sin(a)*r)); } return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0x6b4426,transparent:true,opacity:opacity*2.1})); }
const personOrbits=new THREE.Group(); scene.add(personOrbits);
GEO.forEach(([n,la,lo,w])=>{ const [x,z]=ll2w(la,lo); geoLabels.push({p:new V3(x,LAND+.05,z),el:makeLabel('geo'+(w?' water':''),esc(n))}); });
function refreshPersonOrbits(){ while(personOrbits.children.length){ const c=personOrbits.children.pop(); c.geometry.dispose(); c.material.dispose(); } ents.forEach(e=>personOrbits.add(orbitLineP(e.orb.r,e.orb.tilt,.08))); }
function addEnt(p,fromPos){ const obj=buildPlanet(p); obj.scale.setScalar(PS); scene.add(obj); const e={p,obj,orb:orbitFor(ents.length),mode:fromPos?'fly':'orbit',t:0,from:fromPos?fromPos.clone():null,hover:0,label:makeLabel('',labelHtml(p))}; obj.position.copy(fromPos||orbitPos(e.orb)); ents.push(e); refreshPersonOrbits(); return e; }
function rebuildEnt(e){ const pos=e.obj.position.clone(),sc=e.obj.scale.x,vis=e.obj.visible; scene.remove(e.obj); disposeObj(e.obj); e.obj=buildPlanet(e.p); e.obj.position.copy(pos); e.obj.scale.setScalar(sc); e.obj.visible=vis; scene.add(e.obj); }
function refreshLabels(){ ents.forEach(e=>e.label.innerHTML=labelHtml(e.p)); }
function removeEnt(e){ scene.remove(e.obj); disposeObj(e.obj); e.label.remove(); ents.splice(ents.indexOf(e),1); ents.forEach((x,i)=>{ const a=x.orb.ang; x.orb=orbitFor(i); x.orb.ang=a; }); refreshPersonOrbits(); }
const PS=.72, PREVIEW_POS=new V3(0,5,0); let preview=null;
function setPreview(p){ if(preview){ scene.remove(preview); disposeObj(preview); preview=null; } if(!p) return; preview=buildPlanet(p); preview.position.copy(PREVIEW_POS); preview.scale.setScalar(.01); preview.userData.grow=0; scene.add(preview); }

/* plan routes drawn on the Manhattan map */
const THEMES=[{base:'#e2552d'},{base:'#3f5873'},{base:'#5f8a6a'}];
const worlds=[];
const venuePos=v=>{ const [x,z]=ll2w(v.lat,v.lng); return new V3(x,LAND,z); };
function buildWorld(i){
  const o=state.options[i], col=new THREE.Color(THEMES[i%3].base);
  const g=new THREE.Group(), pins=[], mats=[], tubes=[];
  const sch=schedule(o), pts=sch.map(x=>venuePos(x.v));
  sch.forEach(({v,time},k)=>{
    const pin=new THREE.Group(); pin.position.copy(pts[k]);
    const bm=new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.9}); mats.push(bm);
    const beam=mesh(new THREE.CylinderGeometry(.006,.006,.9,6),bm); beam.position.y=.45;
    const head=mesh(new THREE.SphereGeometry(.05,20,14),new THREE.MeshBasicMaterial({color:k===0?0x17171c:col})); head.position.y=.9; mats.push(head.material);
    const ringM=new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.55,side:THREE.DoubleSide}); mats.push(ringM);
    const ring=mesh(new THREE.RingGeometry(.035,.075,28),ringM); ring.rotation.x=-Math.PI/2; ring.position.y=.003;
    head.userData.pin={i,k}; beam.userData.pin={i,k};
    pin.add(beam,head,ring); g.add(pin);
    pins.push({obj:pin,head,ring,v,time,k,label:makeLabel('pin',`${k+1} · ${time} · ${esc(short(v))}`)});
  });
  for(let k=0;k<pts.length-1;k++){
    const a=pts[k].clone(), b=pts[k+1].clone(); a.y=b.y=LAND+.01; const d=a.distanceTo(b);
    const mid=a.clone().add(b).multiplyScalar(.5); mid.y=LAND+.12+d*.28;
    const tm=new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.95}); mats.push(tm);
    const tg=new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a,mid,b),64,.012,6); tg.setDrawRange(0,0);
    const t=mesh(tg,tm); g.add(t); tubes.push(t);
  }
  const center=pts.reduce((s,p)=>s.add(p),new V3()).multiplyScalar(1/pts.length);
  const extent=Math.max(.6,...pts.map(p=>p.distanceTo(center)));
  g.userData={i,pins,mats,tubes,center,extent,grow:0};
  return g;
}
function clearWorlds(){ worlds.forEach(w=>{ scene.remove(w.obj); disposeObj(w.obj); w.label.remove(); w.obj.userData.pins.forEach(p=>p.label.remove()); }); worlds.length=0; }
function makeWorlds(){ clearWorlds(); state.options.forEach((o,i)=>{ const obj=buildWorld(i); scene.add(obj); worlds.push({obj,slot:obj.userData.center.clone(),label:makeLabel('world','')}); }); refreshWorldLabels(); }
function rebuildWorld(i){ const w=worlds[i]; w.obj.userData.pins.forEach(p=>p.label.remove()); scene.remove(w.obj); disposeObj(w.obj); w.obj=buildWorld(i); w.slot=w.obj.userData.center.clone(); scene.add(w.obj); }
const upVoters=i=>state.people.filter(p=>votesFor(i)[p.id]===1);
function refreshWorldVotes(){}
function refreshWorldLabels(){ worlds.forEach((w,i)=>{ const o=state.options[i],sch=schedule(o); w.label.innerHTML=`<b><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${THEMES[i%3].base};margin-right:6px"></span>${esc(o.label)}</b><small>${hs(sch[0].s)}–${hs(sch[sch.length-1].end)} · ${money(o.perPerson)} pp</small>`; }); }

/* camera */
const rig={target:new V3(),theta:.35,phi:1.2,r:17,shift:0},want={target:new V3(),theta:.35,phi:1.2,r:17,shift:0},user={theta:0,phi:0,r:0};
function setView(){
  const s=state.step,n=narrow();
  const focus=i=>{ const w=worlds[i]; want.target.copy(w.slot); return Math.max(3.2,w.obj.userData.extent*3.4); };
  if(s===1){ if(intro){ Object.assign(want,{theta:.3,phi:1.47,r:19,shift:n?0:430}); want.target.set(0,1.35,0); } else { Object.assign(want,{theta:.35,phi:1.3,r:21,shift:n?0:200}); want.target.set(0,1.2,0); } }
  if(s===2){ Object.assign(want,{theta:.2,phi:1.2,r:22,shift:n?0:5}); want.target.set(0,1.7,0); }
  if(s===3){ Object.assign(want,{theta:0,phi:1.05,r:19,shift:0}); want.target.set(0,.9,0); }
  if(s===4){ if(state.selected>=0){ Object.assign(want,{theta:.15,phi:.82,shift:n?0:-230}); want.r=focus(state.selected); } else { Object.assign(want,{theta:.12,phi:.78,r:9.5,shift:n?0:210}); want.target.copy(worlds.length?worlds.reduce((s,w)=>s.add(w.slot),new V3()).multiplyScalar(1/worlds.length):new V3()); } }
  if(s===5){ Object.assign(want,{theta:.25,phi:1.22,r:9.5,shift:n?0:210}); want.target.set(0,0,0); }
  if(n) want.r+=4; else want.shift*=innerWidth>=2200?1.3:innerWidth>=1700?1.14:1;
  user.theta=0; user.phi=0; user.r=0;
}
function updateCam(dt){ const k=1-Math.exp(-dt*3); rig.target.lerp(want.target,k); rig.theta+=(want.theta+user.theta-rig.theta)*k; rig.phi+=(Math.min(1.5,Math.max(.35,want.phi+user.phi))-rig.phi)*k; rig.r+=(Math.max(4,want.r+user.r)-rig.r)*k; rig.shift+=(want.shift-rig.shift)*k; const sp=Math.sin(rig.phi); cam.position.set(rig.target.x+rig.r*sp*Math.sin(rig.theta),rig.target.y+rig.r*Math.cos(rig.phi),rig.target.z+rig.r*sp*Math.cos(rig.theta)); cam.lookAt(rig.target); cam.setViewOffset(W,H,-rig.shift,0,W,H); }

/* pointer */
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(-9,-9),ptr={down:false,x:0,y:0,moved:0,drag:null},tip=$('#tip');
function pick(){ ray.setFromCamera(ndc,cam); let objs=[]; if(state.step<=3) objs=ents.filter(e=>e.mode==='orbit'||e.mode==='fly').map(e=>e.obj); if(state.step===4) objs=worlds.filter(w=>w.obj.visible).flatMap(w=>w.obj.userData.pins.map(p=>p.head)); const hit=ray.intersectObjects(objs,true)[0]; if(!hit) return null; return hit.object.userData.pin?{pin:hit.object.userData.pin,obj:hit.object}:hit.object.userData.owner; }
let hovered=null;
canvas.addEventListener('pointermove',e=>{
  ndc.set(e.clientX/W*2-1,-(e.clientY/H)*2+1);
  if(ptr.drag){ ray.setFromCamera(ndc,cam); const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(cam.getWorldDirection(new V3()),ptr.drag.obj.position); const hp=new V3(); if(ray.ray.intersectPlane(plane,hp)) ptr.drag.dragTo=hp; ptr.drag.rayDist=ray.ray.distanceToPoint(new V3()); core.userData.pulse=Math.max(core.userData.pulse,ptr.drag.rayDist<2.6?.5:0); ptr.moved+=Math.abs(e.clientX-ptr.x)+Math.abs(e.clientY-ptr.y); ptr.x=e.clientX; ptr.y=e.clientY; return; }
  if(ptr.down){ const dx=e.clientX-ptr.x,dy=e.clientY-ptr.y; ptr.moved+=Math.abs(dx)+Math.abs(dy); ptr.x=e.clientX; ptr.y=e.clientY; user.theta-=dx*.005; user.phi=Math.max(-.8,Math.min(.6,user.phi-dy*.004)); return; }
  const o=pick(); hovered=o&&o.pin?o.obj:o; canvas.className=o?'point':'grab';
  if(o&&o.pin){ const w=worlds[o.pin.i], p=w&&w.obj.userData.pins[o.pin.k]; if(p){ tip.innerHTML=`<b>${esc(short(p.v))}</b>${p.time} · ${esc(p.v.neighborhood)}<br>${esc(state.options[o.pin.i].label)} · stop ${p.k+1}`; tip.style.left=e.clientX+'px'; tip.style.top=e.clientY+'px'; tip.classList.add('show'); } return; }
  if(o&&o.userData&&o.userData.person&&state.step<=3){ const p=o.userData.person; const fw=personWindows(p).map(([a,b])=>hs(a)+'–'+hs(b)).join(', ')||'no free time'; tip.innerHTML=`<b>${esc(p.name)}${p.id===state.meId?' · you':''}</b>Free ${fw}<br>${(p.wishes||[]).length} wishes · budget private${state.step===3?'<br>Drag into the city':state.step===2?'<br>Click to edit':''}`; tip.style.left=e.clientX+'px'; tip.style.top=e.clientY+'px'; tip.classList.add('show'); }
  else tip.classList.remove('show');
});
canvas.addEventListener('pointerdown',e=>{ ptr.down=true; ptr.x=e.clientX; ptr.y=e.clientY; ptr.moved=0; canvas.setPointerCapture(e.pointerId); ndc.set(e.clientX/W*2-1,-(e.clientY/H)*2+1); const o=pick(); if(state.step===3&&o&&o.userData&&o.userData.person){ const en=ents.find(x=>x.obj===o); if(en&&en.mode==='orbit'){ en.mode='drag'; en.dragTo=en.obj.position.clone(); en.rayDist=99; ptr.drag=en; tip.classList.remove('show'); } } else canvas.className='grabbing'; });
canvas.addEventListener('pointerup',()=>{ ptr.down=false; canvas.className='grab'; if(ptr.drag){ const en=ptr.drag; ptr.drag=null; if((en.rayDist??99)<2.6) absorb(en); else { en.mode='fly'; en.t=0; en.from=en.obj.position.clone(); if(ptr.moved>8) toast('Closer. Drop it right on the city.'); } return; } if(ptr.moved<6) onClick(pick()); });
canvas.addEventListener('pointerleave',()=>{ tip.classList.remove('show'); ndc.set(-9,-9); });
canvas.addEventListener('wheel',e=>{ e.preventDefault(); if(intro){ if(e.deltaY>4) dismissIntro(); return; } user.r=Math.max(-8,Math.min(12,user.r+e.deltaY*.012)); },{passive:false});
function onClick(o){ if(!o) return; if(o.pin){ if(state.step===4){ tab='plan'; if(state.selected!==o.pin.i) selectPlan(o.pin.i); else renderDetail(); } return; } if(state.step===2&&o.userData&&o.userData.person) editPerson(o.userData.person.id); }

/* helpers */
let toastT; function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2800); }
function copyText(text,btn){ const done=()=>{ btn.textContent='Copied'; setTimeout(()=>btn.textContent='Copy',1400); }; const fb=()=>{ const r=document.createRange(); r.selectNodeContents($('#inviteCode')); const s=getSelection(); s.removeAllRanges(); s.addRange(r); toast('Press ⌘C / Ctrl+C to copy the code'); }; try{ navigator.clipboard.writeText(text).then(done,fb); }catch(e){ fb(); } }
const planMeta=()=>`${state.planName} · ${prettyDate(state.date)}`;
function dayBar(stops){ const a=DAY_START,b=1440,pct=m=>((Math.max(a,Math.min(b,m))-a)/(b-a)*100).toFixed(2); const fr=freeWindows().map(([x,y])=>`<span class="fr" style="left:${pct(x)}%;width:${pct(y)-pct(x)}%"></span>`).join(''); const st=(stops||[]).map((s,k)=>{ const v=BY_ID[s.id]; return `<span class="st" title="${esc(v.name)}" style="left:${pct(s.start)}%;width:${pct(s.start+v.duration_min)-pct(s.start)}%">${k+1}</span>`; }).join(''); return `<div class="daybar">${fr}${st}</div><div class="dayticks"><span>7am</span><span>11am</span><span>3pm</span><span>7pm</span><span>11pm</span></div>`; }


/* ===== welcome: What's on today (draggable strip) ===== */
function todayISO(){ const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); }
const shortTime=t=>t?String(t).replace(':00','').replace(' PM','pm').replace(' AM','am'):'';
const shortPrice=p=>{ if(!p||/not posted/i.test(p)||/^varies$/i.test(p)) return ''; const m=String(p).match(/\$\s?\d+/); return m?m[0].replace(' ','')+(/from/i.test(p)?'+':''):p; };
function renderToday(){
  const el=$('#today'); if(!el) return;
  const d=todayISO(), used=new Set(), items=[];
  DATA.calendar.filter(e=>e.end?d>=e.date&&d<=e.end:e.date===d).sort((a,b)=>(a.end?1:0)-(b.end?1:0)).forEach(e=>{ const v=e.bookable&&BY_ID[e.bookable]; if(v) used.add(v.id); items.push({e,v}); });
  const open=VENUES.filter(v=>!used.has(v.id)&&isAvailable(v,{date:d,u21:false,veg:false})&&!v.dates);
  open.filter(v=>v.type==='activity').forEach(v=>items.push({v}));
  open.filter(v=>v.type==='food').slice(0,5).forEach(v=>items.push({v}));
  const card=(it,i)=>{
    const {e,v}=it, title=e?e.title:short(v), sub=e?e.venue:v.neighborhood;
    const time=e?(e.end?'Daily':shortTime(e.time)):v.starts?hs(toMin(v.starts[0])):v.hours?'Until '+hs(v.hours[1]):'';
    const price=v?wishPrice(v):shortPrice(e.price);
    const on=v&&draft&&draft.wishes.includes(v.id);
    const pills=[price&&`<span class="${price==='Free'?'':'hot'}">${esc(price)}</span>`,time&&`<span>${esc(time)}</span>`].filter(Boolean).join('');
    const inner=`${coverHtml(v||null,v?v.id:'venue:'+e.venue)}<div class="pills">${pills}</div>${v?`<button type="button" class="wpick" aria-pressed="${!!on}" aria-label="Add ${esc(title)} to my picks">${on?CHECK:PLUS}</button>`:''}<div class="cap"><b>${esc(title)}</b><small>${esc(sub)}</small></div>`;
    return v?`<div class="tcard ${on?'on':''}" data-w="${v.id}" role="button" tabindex="0" aria-label="${esc(title)}, details">${inner}</div>`
            :`<a class="tcard" href="${esc(e.src||'#')}" target="_blank" rel="noopener" aria-label="${esc(title)} at ${esc(e.venue)} (opens listing)">${inner}</a>`;
  };
  el.innerHTML=`<div class="th"><div><p class="kicker acc">What’s on today</p><h3>${esc(longDate(d))}</h3><small>${items.length} things in the city · drag to explore, tap + to add · prices checked ${esc(prettyDate(DATA.checked_on))}, photos from Wikipedia</small></div>
    <div class="arrows"><button type="button" id="tPrev" aria-label="Previous">${'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>'}</button><button type="button" id="tNext" aria-label="Next">${'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>'}</button></div></div>
    <div class="ttrack" id="ttrack">${items.map(card).join('')}</div>
`;
  const tr=$('#ttrack'), step=()=>{ const c=tr.querySelector('.tcard'); return c?c.getBoundingClientRect().width+14:220; };
  let touched=false; const stopAuto=()=>{ touched=true; };
  $('#tPrev').onclick=()=>{ stopAuto(); tr.scrollBy({left:-step()*2}); };
  $('#tNext').onclick=()=>{ stopAuto(); tr.scrollBy({left:step()*2}); };
  /* drag with the mouse; touch scrolls natively */
  let sx=0,sl=0,down=false,moved=false;
  tr.addEventListener('pointerdown',ev=>{ if(ev.pointerType!=='mouse'||ev.button!==0||ev.target.closest('.wpick')) return; down=true; moved=false; sx=ev.clientX; sl=tr.scrollLeft; stopAuto(); });
  addEventListener('pointermove',ev=>{ if(!down) return; const dx=ev.clientX-sx; if(!moved&&Math.abs(dx)>5){ moved=true; tr.classList.add('dragging'); } if(moved) tr.scrollLeft=sl-dx; });
  addEventListener('pointerup',()=>{ if(!down) return; down=false; if(moved){ tr.classList.remove('dragging'); const w=step(); tr.scrollTo({left:Math.round(tr.scrollLeft/w)*w}); setTimeout(()=>{ moved=false; },0); } });
  tr.addEventListener('click',ev=>{ if(moved){ ev.preventDefault(); ev.stopPropagation(); } },true);
  tr.addEventListener('touchstart',stopAuto,{passive:true});
  tr.addEventListener('wheel',ev=>{ if(Math.abs(ev.deltaX)>Math.abs(ev.deltaY)) { stopAuto(); ev.stopPropagation(); } },{passive:true});
  tr.querySelectorAll('.tcard[data-w]').forEach(c=>{ const id=c.dataset.w;
    c.onclick=ev=>{ if(ev.target.closest('.wpick')) return; openWish(id); };
    c.onkeydown=ev=>{ if((ev.key==='Enter'||ev.key===' ')&&ev.target===c){ ev.preventDefault(); openWish(id); } };
    c.querySelector('.wpick').onclick=ev=>{ ev.stopPropagation(); toggleWish(id); const added=draft.wishes.includes(id), v=BY_ID[id];
      if(added&&v.dates&&state.step===1&&state.date!==d){ state.date=d; $('#planDate').value=d; showWeekday(); renderTease(); toast(`Added. Your plan is now set for today, ${longDate(d)}.`); }
      else if(state.step===1) toast(added?'Added to your picks. They’ll be on your planet.':'Removed from your picks'); };
  });
  /* gentle drift until someone touches it */
  let hover=false; el.onmouseenter=()=>{ hover=true; }; el.onmouseleave=()=>{ hover=false; };
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){ const t=setInterval(()=>{ if(touched){ clearInterval(t); return; } if(hover||!intro||document.hidden) return; const end=tr.scrollLeft+tr.clientWidth>=tr.scrollWidth-8; tr.scrollTo({left:end?0:tr.scrollLeft+step()}); },3600); }
  loadPhotos(el);
  fitIntro(); setTimeout(fitIntro,950);
}
/* make sure the welcome text never sits under the header or on top of the strip: shrink step by step */
function fitIntro(){
  const b=document.body, a=$('#intro'), t=$('#today'), hd=document.querySelector('header'); if(!a||!t||!intro) return;
  const L=['fit1','fit2','fit3','fit4','fit5'];
  b.classList.add('measuring'); b.classList.remove(...L); a.style.top='';
  const stacked=innerWidth<=1180;
  for(let k=0;k<=L.length;k++){
    if(k) b.classList.add(L[k-1]);
    const hb=hd.getBoundingClientRect().bottom;
    if(stacked) a.style.top=Math.round(hb+16)+'px';
    const r1=a.getBoundingClientRect(), r2=t.getBoundingClientRect();
    const clash=r1.top<hb+6||(r1.bottom+16>r2.top&&r1.right>r2.left&&r1.left<r2.right);
    if(!clash) break;
  }
  void b.offsetWidth; b.classList.remove('measuring');
}
addEventListener('resize',()=>{ clearTimeout(fitIntro.t); fitIntro.t=setTimeout(fitIntro,120); });

/* ===== golden-hour Manhattan skyline (drawn, not a photo) ===== */
function buildSkyline(){
  const el=$('#cityline'); if(!el) return;
  const W=1600,G=300; let seed=11; const rnd=()=>(seed=seed*16807%2147483647)/2147483647;
  const lit=[];
  const row=(x0,x1,hMin,hMax,wMin,wMax,win)=>{ let x=x0,out=''; while(x<x1){ const w=wMin+rnd()*(wMax-wMin), h=hMin+rnd()*(hMax-hMin); out+=`<rect x="${x.toFixed(1)}" y="${(G-h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/>`; if(win){ for(let k=0;k<h/14;k++) if(rnd()<.16) lit.push([x+3+rnd()*(w-6),G-h+6+k*12]); } x+=w+rnd()*5; } return out; };
  const far=row(-10,W+10,40,130,16,44,false), mid=row(470,W+10,60,170,20,52,false), near=row(500,W+10,40,110,26,60,true);
  const esb=c=>{ const p=[[-34,300],[-34,170],[-26,170],[-26,140],[-18,140],[-18,110],[-10,110],[-10,88],[-4,88],[-4,62],[-1.5,62],[-1.5,22],[1.5,22],[1.5,62],[4,62],[4,88],[10,88],[10,110],[18,110],[18,140],[26,140],[26,170],[34,170],[34,300]]; for(let k=0;k<26;k++) if(rnd()<.5) lit.push([c-28+rnd()*56,175+rnd()*118]); return `<polygon points="${p.map(([a,b])=>(c+a)+','+b).join(' ')}"/>`; };
  const chrysler=c=>{ for(let k=0;k<14;k++) if(rnd()<.5) lit.push([c-18+rnd()*36,155+rnd()*140]); return `<path d="M${c-22} 300V150H${c-15}V120H${c-11}Q${c-11} 95 ${c} 72Q${c+11} 95 ${c+11} 120H${c+15}V150H${c+22}V300Z"/><path d="M${c-1.3} 74L${c} 26L${c+1.3} 74Z"/>`; };
  const wtc=c=>`<polygon points="${c-30},300 ${c-30},252 ${c-26},252 ${c-13},64 ${c+13},64 ${c+26},252 ${c+30},252 ${c+30},300"/><rect x="${c-1.2}" y="8" width="2.4" height="58"/>`;
  const thin=c=>`<rect x="${c-9}" y="54" width="18" height="246"/>`;
  const tower=x=>`<path fill-rule="evenodd" d="M${x} 300V150H${x+30}V300ZM${x+5} 266V212Q${x+9.5} 196 ${x+14} 212V266ZM${x+16} 266V212Q${x+20.5} 196 ${x+25} 212V266Z"/>`;
  let hangers=''; for(let x=178;x<=362;x+=9){ const t=(x-165)/210, y=(1-t)*(1-t)*152+2*(1-t)*t*300+t*t*152; hangers+=`<line x1="${x}" y1="${y.toFixed(1)}" x2="${x}" y2="266"/>`; }
  let shimmer=''; for(let k=0;k<46;k++){ const x=rnd()*W, y=G+8+rnd()*50, w=8+rnd()*40; shimmer+=`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="1.4" rx=".7"/>`; }
  const birds=[[0,40],[26,52],[48,36]].map(([dx,dy])=>`<path d="M${dx} ${dy}q6-6 12 0q6-6 12 0" fill="none" stroke="#6b4a52" stroke-width="1.6" stroke-linecap="round"/>`).join('');
  el.innerHTML=`<svg viewBox="0 0 ${W} 360" preserveAspectRatio="xMidYMax slice">
    <defs><linearGradient id="cwater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eaa77c" stop-opacity=".55"/><stop offset="1" stop-color="#d4855f" stop-opacity=".75"/></linearGradient>
    <linearGradient id="chaze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2d8" stop-opacity="0"/><stop offset="1" stop-color="#fff2d8" stop-opacity=".45"/></linearGradient></defs>
    <g class="birds">${birds}</g>
    <g fill="#e8b49a" opacity=".55">${far}</g>
    <g fill="#d1937d" opacity=".5">${mid}</g>
    <rect x="0" y="200" width="${W}" height="100" fill="url(#chaze)"/>
    <g fill="#a9706f" opacity=".6">${near}${wtc(560)}${esb(980)}${chrysler(1130)}${thin(1250)}</g>
    <g fill="#ffe2a6" opacity=".8">${lit.map(([x,y])=>`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="2.2" height="3.2"/>`).join('')}</g>
    <g fill="#9a6668" opacity=".78">${tower(150)}${tower(360)}<rect x="0" y="264" width="540" height="5"/></g>
    <g fill="none" stroke="#9a6668" stroke-width="1.7" opacity=".78"><path d="M0 236Q90 250 165 152"/><path d="M165 152Q270 300 375 152"/><path d="M375 152Q450 250 540 238"/></g>
    <g stroke="#9a6668" stroke-width=".7" opacity=".5">${hangers}</g>
    <path d="M1130 74Q1130 96 1121 118M1130 74Q1130 96 1139 118M1124 104Q1130 88 1136 104" fill="none" stroke="#ffe2a6" stroke-width="1.1" opacity=".55"/>
    <rect x="0" y="${G}" width="${W}" height="60" fill="url(#cwater)"/>
    <g fill="#fff3d6" opacity=".55">${shimmer}</g>
  </svg>`;
}
buildSkyline();

/* ================= navigation ================= */
function goStep(n){
  if(n>state.maxStep) return;
  if(state.lockedOpt&&n<5) return toast('This plan is locked. Use New plan to plan another day.');
  if(n>=2&&!state.planId) return;
  if(n<=2&&state.options) discardPlans();
  if(n===3){ ents.forEach(e=>{ if(e.mode!=='orbit'){ e.mode='fly'; e.t=0; e.from=e.obj.position.clone(); } e.obj.visible=true; e.obj.scale.setScalar(PS); }); core.visible=true; core.scale.setScalar(1); coreShrink=0; updateAbsorb(); }
  state.step=n; state.maxStep=Math.max(state.maxStep,n); document.body.dataset.step=n;
  document.body.classList.toggle('night',n===5);
  $$('.sky').forEach(s=>s.classList.toggle('on',+s.dataset.s===n));
  if(n!==1) intro=false;
  $$('[data-panel]').forEach(p=>p.classList.toggle('show',+p.dataset.panel===n&&!(n===4&&state.selected>=0)&&!(n===1&&intro)));
  $('#intro').classList.toggle('show',intro); document.body.classList.toggle('introing',intro);
  if(n!==4) $('#detail').classList.remove('show');
  $$('#steps button').forEach(b=>{ const k=+b.dataset.go; b.classList.toggle('cur',k===n); b.classList.toggle('done',k<n||(k<state.maxStep&&k!==n)); b.disabled=k>state.maxStep||(!!state.booked&&k<5); });
  setPreview(n===2&&!editingId?draft:null);
  if(n===1) renderTease();
  if(n===2){ renderGroupTT(); renderWishes(); renderCrew(); }
  if(n===5) buildCrewMoons();
  $('#hintbar').textContent=n===3?'Drag planets into the city':n===4?'Click a plan or a pin to open it · drag to look around':'Drag to look around · scroll to zoom';
  tip.classList.remove('show'); setView(); save();
}
function discardPlans(){ state.options=null; state.selected=-1; state.ai=null; clearWorlds(); $('#detail').classList.remove('show'); ents.forEach(e=>{ e.mode='orbit'; e.obj.visible=true; e.obj.scale.setScalar(PS); }); core.visible=true; core.scale.setScalar(1); coreShrink=0; state.maxStep=Math.min(state.maxStep,3); }
$$('#steps button').forEach(b=>b.onclick=()=>goStep(+b.dataset.go));
function dismissIntro(){ if(!intro) return; intro=false; goStep(1); }
$('#introGo').onclick=$('#introCue').onclick=dismissIntro;
addEventListener('wheel',e=>{ if(intro&&e.target!==canvas&&e.deltaY>4) dismissIntro(); },{passive:true});
{ let ty=null; addEventListener('touchstart',e=>{ ty=intro?e.touches[0].clientY:null; },{passive:true}); addEventListener('touchmove',e=>{ if(intro&&ty!=null&&ty-e.touches[0].clientY>36) dismissIntro(); },{passive:true}); }
addEventListener('keydown',e=>{ if(!intro||(e.target.closest&&e.target.closest('button,a,input'))) return; if(['ArrowDown','PageDown',' ','Enter'].includes(e.key)){ e.preventDefault(); dismissIntro(); } });
$('#restart').onclick=()=>{ location.href='/?start=1'; };

/* ---- How it works modal ---- */
let slide=0;
function showSlide(i){ slide=i; $$('.slide').forEach(s=>s.classList.toggle('on',+s.dataset.sl===i)); $$('#mdots i').forEach((d,k)=>d.classList.toggle('on',k===i)); $('#mNext').textContent=i===3?(state.step===1?'Start planning':'Got it'):'Next'; $('#mBack').textContent=i===0?'Close':'Back'; }
function openHow(){ showSlide(0); $('#howModal').classList.add('show'); $('#mNext').focus(); }
function closeHow(){ $('#howModal').classList.remove('show'); }
$('#howBtn').onclick=openHow; $('#howLink').onclick=openHow;
$('#mNext').onclick=()=>{ if(slide<3) showSlide(slide+1); else { closeHow(); if(state.step===1) $('#planName').focus(); } };
$('#mBack').onclick=()=>{ if(slide>0) showSlide(slide-1); else closeHow(); };
$('#howModal').addEventListener('click',e=>{ if(e.target.id==='howModal') closeHow(); });
addEventListener('keydown',e=>{ if(!$('#howModal').classList.contains('show')) return; if(e.key==='Escape') closeHow(); if(e.key==='ArrowRight'&&slide<3) showSlide(slide+1); if(e.key==='ArrowLeft'&&slide>0) showSlide(slide-1); });

/* ---- step 1 ---- */
function showWeekday(){ const d=$('#planDate').value; $('#weekday').textContent=d?longDate(d):''; }
$('#planDate').value=state.date; showWeekday();
$('#planDate').oninput=()=>{ showWeekday(); if($('#planDate').value){ state.date=$('#planDate').value; renderTease(); } };
function renderTease(){
  const d=state.date, evs=DATA.calendar.filter(e=>e.end?d>=e.date&&d<=e.end:e.date===d).sort((a,b)=>(a.end?1:0)-(b.end?1:0)).slice(0,3);
  const open=VENUES.filter(openOnDate).length;
  $('#tease').innerHTML=`<p class="kicker">${esc(longDate(d))}</p><h3>${open} things open in NYC that day</h3>
    <div class="tlist">${evs.map(e=>`<div class="titem"><div class="tm">${e.end?'Daily':esc(e.time.replace(':00','').replace(' PM','pm').replace(' AM','am'))}</div><div><b>${esc(e.title)}</b><small>${esc(e.venue)} · ${esc(e.price)}</small></div></div>`).join('')||'<p class="hint">No major concerts listed that day. Museums, views and food are still open.</p>'}</div>
    <div style="margin-top:14px"><button class="textlink" type="button" id="teaseMore">See what’s on →</button></div>`;
  $('#teaseMore').onclick=()=>toggleWhatsOn(true);
}
async function createPlan(sample){
  const btn=sample?$('#demoBtn'):$('#startForm button[type=submit]'); btn.disabled=true;
  try{
    const r=await api('POST','/plans',{token:TOKEN,name:$('#planName').value.trim()||'Our day out',date:$('#planDate').value||nextSaturday(),sample});
    history.pushState({},'','/p/'+r.plan.id);
    ents.slice().forEach(removeEnt);
    applyPlan(r.plan); state.maxStep=2; newDraft(); goStep(2);
    refreshMe();
    toast(sample?'Sample group loaded: Aru, Mira and Jun (test data). Add yourself to join them.':state.profile?'Plan created. Your saved planet is filled in: check your times and launch it.':'Plan created. Make your planet, then invite your group.');
  }catch(e){ if(e.code==='upgrade_required') openPay('plans',e.message); else toast(e.message); }
  finally{ btn.disabled=false; }
}
$('#startForm').onsubmit=e=>{ e.preventDefault(); createPlan(false); };
$('#demoBtn').onclick=()=>createPlan(true);

/* ---- step 2: wizard ---- */
let draft=null,editingId=null,editBackup=null,brush='work',wstep=1;
const WTITLES=['About you','Your day','What you’d love to do','Your private budget'];
function nextColor(){ const used=state.people.map(p=>p.color); return COLORS.find(c=>!used.includes(c))||COLORS[Math.floor(Math.random()*COLORS.length)]; }
function newDraft(){ if(state.meId&&me()){ editPerson(state.meId); return; } draft={id:'p'+uid(5).toLowerCase(),name:'',color:nextColor(),foods:[],vibes:[],budget:120,veg:false,u21:false,schedule:makeDay([['sleep',0,8]]),wishes:(state.step===1&&draft&&!editingId?draft.wishes.slice():[])}; applyProfile(draft); editingId=null; editBackup=null; wstep=1; fillForm(); if(state.step===2) setPreview(draft); }
function editPerson(id){ const p=state.people.find(x=>x.id===id); if(!p) return; editBackup=JSON.parse(JSON.stringify(p)); draft=JSON.parse(JSON.stringify(p)); editingId=id; wstep=1; fillForm(); setPreview(null); }
function fillForm(){
  const isMe=editingId?editingId===state.meId:!state.meId;
  $('#pName').value=draft.name; $('#pName').placeholder=isMe?'Your first name':'Their first name';
  $('#pVeg').checked=draft.veg; $('#pU21').checked=draft.u21;
  $('#pBudget').value=Math.min(300,draft.budget||0); $('#budgetBig').textContent='$'+draft.budget;
  $('#removeBtn').hidden=true; $('#cancelBtn').hidden=!editingId;
  $('#dayName2').textContent=longDate(state.date);
  renderSwatches(); renderChips(); renderTT(); renderWishes(); showW();
}
function wizardWho(){ return editingId?'Your planet':(state.people.length?'Join this plan':'Your planet'); }
function showW(){
  $$('.wstep').forEach(s=>s.classList.toggle('on',+s.dataset.w===wstep));
  $$('#wizProg i').forEach((d,k)=>d.classList.toggle('on',k<wstep));
  $('#wizKicker').textContent=`${wizardWho()} · ${wstep} of 4`;
  $('#wizTitle').textContent=WTITLES[wstep-1];
  $('#wBack').disabled=wstep===1; $('#wNext').hidden=wstep===4; $('#saveBtn').hidden=wstep!==4;
  $('#saveBtn').textContent=editingId?'Save changes':'Launch my planet';
  if(wstep===2) setTimeout(()=>{ const tt=$('#tt'); if(tt&&tt.scrollTop===0) tt.scrollTop=7*2*13; },0);
  if(wstep===3) loadPhotos($('#wishes'));
  if(wstep===4) renderSummary();
  validate();
}
function stepOk(){ if(wstep===1) return draft.name.trim()&&draft.foods.length&&draft.vibes.length; return true; }
function validate(){ $('#wNext').disabled=!stepOk(); $('#saveBtn').disabled=!(draft.name.trim()&&draft.foods.length&&draft.vibes.length); }
$('#wNext').onclick=()=>{ if(!stepOk()) return toast('Add a name, a food and one interest'); wstep=Math.min(4,wstep+1); showW(); };
$('#wBack').onclick=()=>{ wstep=Math.max(1,wstep-1); showW(); };
function renderSummary(){ const fw=personWindows(draft).map(([a,b])=>hs(a)+'–'+hs(b)).join(', ')||'none'; $('#summary').innerHTML=`<div><span>Name</span><b>${esc(draft.name||'—')}</b></div><div><span>Free</span><b>${fw}</b></div><div><span>Wishes</span><b>${draft.wishes.length?draft.wishes.map(id=>esc(short(BY_ID[id]))).slice(0,3).join(', ')+(draft.wishes.length>3?` +${draft.wishes.length-3}`:''):'none yet'}</b></div><div><span>Into</span><b>${draft.vibes.map(vName).join(', ')||'—'}</b></div>`; }
function renderSwatches(){ $('#swatches').innerHTML=COLORS.map(c=>`<button type="button" class="sw ${c===draft.color?'on':''}" style="background:${c}" data-c="${c}" aria-label="Tone ${c}"></button>`).join(''); $$('#swatches .sw').forEach(b=>b.onclick=()=>{ draft.color=b.dataset.c; renderSwatches(); livePreview(); }); }
function chipHtml(list,known,picked){ return list.map(([id,t])=>`<button type="button" class="chip ${picked.includes(id)?'on':''}" data-id="${id}">${t}</button>`).join('')+picked.filter(id=>!known.has(id)).map(id=>`<button type="button" class="chip on custom" data-id="${esc(id)}" title="Remove ${esc(cap(id))}">${esc(cap(id))}<b aria-hidden="true">×</b></button>`).join(''); }
function renderChips(){
  $('#foodChips').innerHTML=chipHtml(FOODS,KNOWN_F,draft.foods);
  $('#actChips').innerHTML=chipHtml(VIBES,KNOWN_V,draft.vibes);
  $$('#foodChips .chip').forEach(c=>c.onclick=()=>{ toggle(draft.foods,c.dataset.id); renderChips(); livePreview(); });
  $$('#actChips .chip').forEach(c=>c.onclick=()=>{ toggle(draft.vibes,c.dataset.id); renderChips(); livePreview(); });
}
/* typed extras: saved in lower case next to the preset ids */
function addCustom(input,arr,list){
  const raw=input.value.trim().toLowerCase().replace(/[^\p{L}\p{N} &'\-]/gu,'').replace(/\s+/g,' ').slice(0,20);
  if(raw.length<2){ toast('Type at least two letters'); return; }
  const hit=list.find(([id,t])=>id===raw||t.toLowerCase()===raw), id=hit?hit[0]:raw;
  if(arr.length>=14&&!arr.includes(id)){ toast('That’s plenty. Remove one to add another.'); return; }
  if(!arr.includes(id)) arr.push(id);
  input.value=''; renderChips(); livePreview(); input.focus();
}
[['#foodOther','#foodAdd',()=>draft.foods,FOODS],['#actOther','#actAdd',()=>draft.vibes,VIBES]].forEach(([i,b,get,list])=>{
  $(b).onclick=()=>addCustom($(i),get(),list);
  $(i).addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); addCustom($(i),get(),list); } });
});
const toggle=(arr,id)=>{ const i=arr.indexOf(id); i>=0?arr.splice(i,1):arr.push(id); };
/* timetable */
/* timetable: typed time blocks, edited in a popup */
function runs(day){ const r=[]; let i=0; while(i<48){ const t=day[i]; if(!t){ i++; continue; } let j=i; while(j<48&&day[j]===t) j++; r.push({t,a:i,b:j}); i=j; } return r; }
const hhmm24=slot=>`${String(Math.floor(slot/2)%24).padStart(2,'0')}:${slot%2?'30':'00'}`;
const slotOf=v=>{ const m=/^(\d{1,2}):(\d{2})/.exec(v||''); if(!m) return null; return Math.min(48,Math.round((+m[1]*60+ +m[2])/30)); };
const DEF_TIMES={work:['09:00','17:00'],study:['10:00','14:00'],busy:['18:00','19:00'],relax:['12:00','13:00'],sleep:['00:00','08:00']};
function renderTT(){
  const Q=[['Work 9–5',[['work',9,17]]],['Classes 10–2',[['study',10,14]]],['Sleep till 8',[['sleep',0,8]]],['Gym 6–7pm',[['busy',18,19]]],['Clear all',null]];
  $('#quick').innerHTML=Q.map(([l],i)=>`<button type="button" data-q="${i}">${l}</button>`).join('');
  $$('#quick button').forEach(b=>b.onclick=()=>{ const q=Q[+b.dataset.q][1]; if(!q) draft.schedule=Array(48).fill(''); else q.forEach(([t,a,z])=>{ for(let i=a*2;i<z*2;i++) draft.schedule[i]=t; }); renderTTGrid(); });
  renderTTGrid();
}
function renderTTGrid(){
  const rs=runs(draft.schedule), pct=s=>(s/48*100).toFixed(2);
  $('#myDay').innerHTML=`<div class="mybar">${rs.map(r=>`<i style="left:${pct(r.a)}%;width:${pct(r.b-r.a)}%;background:${BLOCKS[r.t].c}"></i>`).join('')}</div><div class="dayticks"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>`;
  $('#blockList').innerHTML=rs.map((r,k)=>`<button type="button" class="blk" data-k="${k}"><i style="background:${BLOCKS[r.t].c}"></i><b>${BLOCKS[r.t].l}</b><span>${hhmm(r.a*30)} – ${hhmm(r.b*30)}</span><em>Edit</em></button>`).join('')||'<p class="hint">No blocks yet. You’re free all day.</p>';
  $$('#blockList .blk').forEach(b=>b.onclick=()=>openBlock(rs[+b.dataset.k]));
  const wins=personWindows(draft);
  $('#ttSide').innerHTML=`<span>Free</span>${wins.map(([a,b])=>`<span class="f">${hs(a)}–${hs(b)}</span>`).join('')||'<span>no free time after 7am</span>'}`;
}
let bmEdit=null,bmType='work';
function bmTypes(){ $('#bmType').innerHTML=Object.entries(BLOCKS).map(([k,b])=>`<button type="button" class="chip ${bmType===k?'on':''}" data-t="${k}"><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${b.c};margin-right:6px"></span>${b.l}</button>`).join(''); $$('#bmType .chip').forEach(c=>c.onclick=()=>{ bmType=c.dataset.t; if(!bmEdit){ $('#bmFrom').value=DEF_TIMES[bmType][0]; $('#bmTo').value=DEF_TIMES[bmType][1]; } bmTypes(); bmCheck(); }); }
function bmCheck(){ const a=slotOf($('#bmFrom').value),b=slotOf($('#bmTo').value); let msg=''; if(a==null||b==null) msg='Enter both times.'; else if(a===b) msg='Start and end can’t be the same.'; else if(b<a) msg='Ends after midnight, so it continues into the early morning.'; else msg=`${(b-a)/2} hours`; $('#bmHint').textContent=msg; $('#bmSave').disabled=a==null||b==null||a===b; }
function openBlock(r){
  bmEdit=r||null; bmType=r?r.t:'work';
  $('#bmTitle').textContent=r?`Edit ${BLOCKS[r.t].l.toLowerCase()} time`:'Add a time block';
  $('#bmFrom').value=r?hhmm24(r.a):DEF_TIMES[bmType][0]; $('#bmTo').value=r?hhmm24(r.b%48):DEF_TIMES[bmType][1];
  $('#bmDelete').hidden=!r; $('#bmSave').textContent=r?'Save':'Add block'; $('#bmDay').textContent=longDate(state.date);
  bmTypes(); bmCheck(); $('#blockModal').classList.add('show'); setTimeout(()=>$('#bmFrom').focus(),50);
}
function closeBlock(){ $('#blockModal').classList.remove('show'); }
function clearRun(r){ for(let i=r.a;i<r.b;i++) draft.schedule[i]=''; }
$('#addBlock').onclick=()=>openBlock(null);
$('#bmFrom').oninput=bmCheck; $('#bmTo').oninput=bmCheck;
$('#bmCancel').onclick=closeBlock;
$('#bmDelete').onclick=()=>{ if(bmEdit) clearRun(bmEdit); closeBlock(); renderTTGrid(); toast('Block removed'); };
$('#bmSave').onclick=()=>{
  const a=slotOf($('#bmFrom').value), b=slotOf($('#bmTo').value); if(a==null||b==null||a===b) return;
  if(bmEdit) clearRun(bmEdit);
  if(b>a){ for(let i=a;i<b;i++) draft.schedule[i]=bmType; } else { for(let i=a;i<48;i++) draft.schedule[i]=bmType; for(let i=0;i<b;i++) draft.schedule[i]=bmType; }
  const was=!!bmEdit; closeBlock(); renderTTGrid(); toast(`${BLOCKS[bmType].l} ${hhmm(a*30)} – ${hhmm(b*30)} ${was?'updated':'added'}`);
};
$('#blockModal').addEventListener('click',e=>{ if(e.target.id==='blockModal') closeBlock(); });
addEventListener('keydown',e=>{ if(!$('#blockModal').classList.contains('show')) return; if(e.key==='Escape') closeBlock(); if(e.key==='Enter'&&!$('#bmSave').disabled){ e.preventDefault(); $('#bmSave').click(); } });
/* wishes */
const SV=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const WICON={
  shows:SV('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  winter:SV('<path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17"/><path d="M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2"/>'),
  views:SV('<path d="M4 21V9l5-3v15"/><path d="M9 21V4l6 3v14"/><path d="M15 21V11l5 2v8"/><path d="M2 21h20"/>'),
  museums:SV('<path d="M3 21h18M4 10h16M12 3l9 7H3z"/><path d="M6.5 10v8M10.5 10v8M14.5 10v8M18.5 10v8M4 18h16"/>'),
  games:SV('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.1"/><circle cx="15" cy="15" r="1.1"/><circle cx="15" cy="9" r="1.1"/><circle cx="9" cy="15" r="1.1"/>'),
  outdoors:SV('<path d="M12 3l6 9h-4l4 6H6l4-6H6z"/><path d="M12 18v3"/>'),
  food:SV('<path d="M7 3v8a2 2 0 0 0 2 2v8"/><path d="M11 3v8a2 2 0 0 1-2 2"/><path d="M17 21V3c-2 1-3 4-3 7h3"/>')
};
/* [title, filter, icon, cover colour 1, cover colour 2] */
const WISH_GROUPS=[
  ['Concerts & shows',v=>['Concert','Holiday show','Broadway','Stand-up comedy'].includes(v.category),'shows','#3b3550','#8a6a8e'],
  ['Winter',v=>v.category==='Ice skating','winter','#7fa3b8','#c9dbe4'],
  ['Views',v=>v.category==='Observation deck','views','#3f5873','#8fa7bd'],
  ['Museums',v=>v.category==='Museum','museums','#a8946c','#dccfb2'],
  ['Games',v=>['Bowling','Escape room'].includes(v.category),'games','#a8644c','#dcae96'],
  ['Outdoors',v=>['Park walk','Walk','Boating'].includes(v.category),'outdoors','#6f8c6c','#c3d3ba'],
  ['Food',v=>v.type==='food','food','#bd7c50','#ecc9a4']];
/* one-line descriptions, written for this app */
const BLURB={
  'neighbourhood-21':'Arena concert at Barclays Center in Brooklyn. Doors usually open about an hour before the start time.',
  'neighbourhood-22':'Arena concert at Barclays Center in Brooklyn. Doors usually open about an hour before the start time.',
  'sting-15':'Concert at the Brooklyn Paramount, a restored 1920s theater in Downtown Brooklyn.',
  'sting-18':'Concert at the Brooklyn Paramount, a restored 1920s theater in Downtown Brooklyn.',
  'stevie-19':'Arena concert at Madison Square Garden, directly above Penn Station.',
  'tyla-28':'Concert at the Brooklyn Paramount, a restored 1920s theater in Downtown Brooklyn.',
  'tyla-29':'Concert at the Brooklyn Paramount, a restored 1920s theater in Downtown Brooklyn.',
  'rockettes':'The Rockettes’ 90-minute holiday show at Radio City Music Hall, with several performances a day.',
  'tkts':'Same-day discounted Broadway tickets from the booth under the red steps in Times Square. You choose from what is on sale that day.',
  'comedy-cellar':'Small basement stand-up club in Greenwich Village where well-known comics often drop in. 21 and over.',
  'bryant-park':'Outdoor rink in the middle of Midtown, ringed by holiday market stalls. Skating is free if you bring your own skates.',
  'rock-rink':'The sunken rink at Rockefeller Plaza. Sessions last 60 minutes and peak times sell out.',
  'top-of-the-rock':'Open-air decks at the top of 30 Rockefeller Plaza, with a straight view of the Empire State Building and Central Park.',
  'summit':'Mirrored rooms and glass ledges high up in One Vanderbilt, next to Grand Central.',
  'edge':'Outdoor sky deck on the 100th floor at Hudson Yards, with a glass floor section and angled glass walls.',
  'esb':'The classic 86th-floor open-air deck in the middle of Midtown. Open until midnight.',
  'moma':'Modern and contemporary art in Midtown, including Van Gogh’s The Starry Night.',
  'met':'One of the world’s largest art museums, on the east edge of Central Park. Allow at least two hours.',
  'amnh':'Dinosaur halls, the blue whale and the planetarium, across the street from Central Park.',
  'whitney':'American art in a building at the south end of the High Line, with outdoor terraces.',
  'frick':'Old Master paintings in a Gilded Age mansion on Fifth Avenue.',
  'bowlero':'Bowling lanes and an arcade just off Times Square. Up to six people share a lane.',
  'escape-room':'A 60-minute team puzzle room in Midtown. Works best with four to eight people.',
  'central-park-rowboats':'Rent a rowboat on the Lake in Central Park. Each boat holds up to four people.',
  'high-line':'A park built on an old elevated rail line, running from the Meatpacking District to Hudson Yards.',
  'brooklyn-bridge':'A walk of about 1.1 miles across the bridge’s raised boardwalk, with skyline views the whole way.',
  'katzs':'Lower East Side deli, open since 1888 and known for hand-carved pastrami. You order at the counter with a ticket.',
  'second-ave-deli':'Kosher deli with table service, known for pastrami and matzo ball soup.',
  'joes-pizza':'Classic New York slice shop in Greenwich Village, open since 1975. Mostly standing room.',
  'los-tacos':'Counter-service taqueria inside Chelsea Market. Expect a line and standing tables.',
  'xian':'Hand-pulled noodles and cumin lamb in the style of Xi’an, served fast at the counter.',
  'joes-shanghai':'Chinatown restaurant known for soup dumplings. Large groups share round tables.',
  'russ-daughters':'Appetizing shop on Houston Street since 1914, for bagels with smoked salmon. Takeout counter.',
  'shake-shack':'The original Shake Shack stand in Madison Square Park, with outdoor seating.',
  'carbone':'Italian-American restaurant in Greenwich Village. Reservations are hard to get.'
};
/* real photos: looked up by Wikipedia article title when the page can reach the internet (first title with a photo wins) */
const WIKI={
  'neighbourhood-21':['Barclays Center'],'neighbourhood-22':['Barclays Center'],
  'sting-15':['Brooklyn Paramount','Paramount Theatre (Brooklyn)','Downtown Brooklyn'],'sting-18':['Brooklyn Paramount','Paramount Theatre (Brooklyn)','Downtown Brooklyn'],
  'tyla-28':['Brooklyn Paramount','Paramount Theatre (Brooklyn)','Downtown Brooklyn'],'tyla-29':['Brooklyn Paramount','Paramount Theatre (Brooklyn)','Downtown Brooklyn'],
  'stevie-19':['Madison Square Garden'],'rockettes':['Radio City Music Hall'],'tkts':['TKTS','Times Square'],'comedy-cellar':['Comedy Cellar','MacDougal Street'],
  'bryant-park':['Bryant Park'],'rock-rink':['The Rink at Rockefeller Center','Rockefeller Center'],
  'top-of-the-rock':['30 Rockefeller Plaza'],'summit':['Summit One Vanderbilt','One Vanderbilt'],'edge':['Edge (observation deck)','30 Hudson Yards','Hudson Yards (development)'],'esb':['Empire State Building'],
  'moma':['Museum of Modern Art'],'met':['Metropolitan Museum of Art'],'amnh':['American Museum of Natural History'],'whitney':['Whitney Museum'],'frick':['Frick Collection'],
  'bowlero':['Ten-pin bowling'],'escape-room':['Escape room'],
  'central-park-rowboats':['Loeb Boathouse','The Lake (Central Park)','Central Park'],'high-line':['High Line'],'brooklyn-bridge':['Brooklyn Bridge'],
  'katzs':["Katz's Delicatessen"],'second-ave-deli':['2nd Avenue Deli','Second Avenue Deli'],'joes-pizza':["Joe's Pizza"],'los-tacos':['Chelsea Market'],'xian':["Xi'an Famous Foods"],
  'venue:Barclays Center':['Barclays Center'],'venue:Brooklyn Paramount':['Brooklyn Paramount','Paramount Theatre (Brooklyn)'],'venue:Madison Square Garden':['Madison Square Garden'],
  'venue:Kings Theatre, Brooklyn':['Kings Theatre (Brooklyn)'],'venue:Citi Field, Queens':['Citi Field'],'venue:Venues citywide':['New York Comedy Festival','Greenwich Village'],
  'venue:Radio City Music Hall':['Radio City Music Hall'],'venue:Bryant Park':['Bryant Park'],'venue:Rockefeller Plaza':['Rockefeller Center'],'venue:Warsaw, Brooklyn':['Greenpoint, Brooklyn'],
  'joes-shanghai':["Joe's Shanghai"],'russ-daughters':['Russ & Daughters'],'shake-shack':['Madison Square and Madison Square Park','Shake Shack'],'carbone':['Carbone (restaurant)','Greenwich Village']
};
const PHOTO_KEY='plantogether:photos:v1', photoWait={}; let PHOTOS={}, photoNet=true;
try{ PHOTOS=JSON.parse(localStorage.getItem(PHOTO_KEY))||{}; }catch(e){ PHOTOS={}; }
const okPhoto=u=>typeof u==='string'&&/^https:\/\/upload\.wikimedia\.org\//.test(u);
function photoFor(id){
  if(window.PHOTO_EMBED&&PHOTO_EMBED[id]) return Promise.resolve(PHOTO_EMBED[id]);
  const titles=WIKI[id]; if(!titles) return Promise.resolve(null);
  const key=titles[0]; if(PHOTOS[key]&&okPhoto(PHOTOS[key].src)) return Promise.resolve(PHOTOS[key]);
  if(photoWait[key]) return photoWait[key];
  return photoWait[key]=(async()=>{
    for(const t of titles){
      if(!photoNet) return null;
      try{
        const ctl=new AbortController(), tm=setTimeout(()=>ctl.abort(),7000);
        const r=await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(t.replace(/ /g,'_')),{signal:ctl.signal}); clearTimeout(tm);
        if(!r.ok) continue; const j=await r.json();
        if(j&&j.thumbnail&&okPhoto(j.thumbnail.source)){ const page=j.content_urls&&j.content_urls.desktop&&j.content_urls.desktop.page; const out={src:j.thumbnail.source,title:String(j.title||t).slice(0,80),page:/^https:\/\/en\.wikipedia\.org\//.test(page||'')?page:''}; PHOTOS[key]=out; try{ localStorage.setItem(PHOTO_KEY,JSON.stringify(PHOTOS)); }catch(e){} return out; }
      }catch(e){ photoNet=false; return null; } /* offline or blocked: keep the drawn covers and stop asking */
    }
    return null;
  })();
}
function loadPhotos(root){ if(!root) return; root.querySelectorAll('.cover[data-ph]').forEach(c=>{ const img=c.querySelector('img'); if(!img||img.dataset.done) return; img.dataset.done='1';
  photoFor(c.dataset.ph).then(p=>{ if(!p||!c.isConnected) return; img.onload=()=>img.classList.add('ok'); img.onerror=()=>img.classList.remove('ok'); img.src=p.src;
    if(c.closest('.wm')){ const hi=new Image(); hi.onload=()=>{ if(c.isConnected) img.src=hi.src; }; hi.src=p.src.replace(/\/\d+px-/,'/960px-'); } }); }); }
const wishPrice=v=>v.unit_pricing?`$${v.unit_pricing.weekend_price}/boat`:v.price_pp?'$'+v.price_pp:'Free';
const groupOf=v=>WISH_GROUPS.find(g=>g[1](v))||WISH_GROUPS[0];
const SC=p=>`<svg class="scene" viewBox="0 0 160 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${p}</svg>`;
const SCENE={
  shows:SC('<path d="M30 0L0 200h70zM130 0L95 200h65z" fill="#fff" opacity=".10"/><path d="M0 0h160v26c-10 10-20 10-27 0-7 10-20 10-27 0-7 10-20 10-26 0-7 10-20 10-27 0-7 10-20 10-27 0-7 10-17 10-26 0z" fill="#000" opacity=".18"/><circle cx="40" cy="58" r="2" fill="#fff" opacity=".5"/><circle cx="120" cy="44" r="1.6" fill="#fff" opacity=".5"/><circle cx="96" cy="76" r="1.2" fill="#fff" opacity=".5"/>'),
  winter:SC('<ellipse cx="80" cy="178" rx="110" ry="34" fill="#fff" opacity=".22"/><g fill="#fff" opacity=".6"><circle cx="22" cy="30" r="2"/><circle cx="60" cy="18" r="1.5"/><circle cx="112" cy="40" r="2.2"/><circle cx="140" cy="16" r="1.4"/><circle cx="34" cy="80" r="1.6"/><circle cx="130" cy="92" r="1.8"/><circle cx="90" cy="110" r="1.3"/></g>'),
  views:SC('<g fill="#000" opacity=".2"><path d="M0 200V130h14v-20h10v20h12V96h16v104zM48 200V70h8V52h4V30h2v22h4v18h8v130zM78 200v-90h18v-14h12v104zM108 200V84l12-10 12 10v116zM132 200v-60h28v60z"/></g><circle cx="122" cy="46" r="16" fill="#fff" opacity=".22"/>'),
  museums:SC('<g fill="#fff" opacity=".2"><path d="M14 92L80 50l66 42z"/><rect x="18" y="96" width="124" height="8"/><rect x="26" y="108" width="10" height="64"/><rect x="50" y="108" width="10" height="64"/><rect x="74" y="108" width="10" height="64"/><rect x="98" y="108" width="10" height="64"/><rect x="122" y="108" width="10" height="64"/><rect x="12" y="174" width="136" height="10"/></g>'),
  games:SC('<g fill="#fff" opacity=".22"><path d="M40 190c-8 0-10-30-6-46 3-12 2-20 0-26-2-8 2-14 6-14s8 6 6 14c-2 6-3 14 0 26 4 16 2 46-6 46z"/><path d="M80 190c-8 0-10-30-6-46 3-12 2-20 0-26-2-8 2-14 6-14s8 6 6 14c-2 6-3 14 0 26 4 16 2 46-6 46z"/><path d="M120 190c-8 0-10-30-6-46 3-12 2-20 0-26-2-8 2-14 6-14s8 6 6 14c-2 6-3 14 0 26 4 16 2 46-6 46z"/></g><circle cx="60" cy="60" r="18" fill="#000" opacity=".18"/>'),
  outdoors:SC('<path d="M-10 150Q80 70 170 150" fill="none" stroke="#fff" stroke-width="3" opacity=".25"/><g fill="#000" opacity=".16"><path d="M20 200l18-60 18 60zM100 200l22-74 22 74zM56 200l14-44 14 44z"/></g><rect x="0" y="186" width="160" height="14" fill="#fff" opacity=".15"/>'),
  food:SC('<circle cx="80" cy="120" r="56" fill="#fff" opacity=".18"/><circle cx="80" cy="120" r="40" fill="#fff" opacity=".14"/><path d="M62 40c-6 8 6 14 0 22M80 34c-6 8 6 14 0 22M98 40c-6 8 6 14 0 22" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".4"/>')
};
const coverHtml=(v,phId)=>{ const g=v?groupOf(v):WISH_GROUPS[0]; return `<div class="cover" data-ph="${esc(phId||v.id)}" style="--c1:${g[3]};--c2:${g[4]}">${SCENE[g[2]]||''}${WICON[g[2]]}<img alt="" decoding="async" draggable="false"></div>`; };
const PLUS='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>', CHECK='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
const wishCountText=()=>`${draft.wishes.length} selected`;
function renderWishes(){
  if(!draft) return; const avail=VENUES.filter(openOnDate);
  $('#wishes').innerHTML=WISH_GROUPS.map(g=>{ const vs=avail.filter(g[1]); if(!vs.length) return ''; return `<div class="wishgroup"><span>${g[0]}</span><div class="wgrid">${vs.map(v=>{ const on=draft.wishes.includes(v.id), t=v.starts&&v.starts.length===1?' · '+hs(toMin(v.starts[0])):''; return `<div class="wcard ${on?'on':''}" data-w="${v.id}" role="button" tabindex="0" aria-label="${esc(short(v))}: open details">${coverHtml(v)}<span class="wprice">${wishPrice(v)}${t}</span><button type="button" class="wpick" data-pick="${v.id}" aria-pressed="${on}" aria-label="${on?'Remove':'Add'} ${esc(short(v))}">${on?CHECK:PLUS}</button><div class="meta"><b>${esc(short(v))}</b><small>${esc(v.category)} · ${esc(v.neighborhood)}</small></div></div>`; }).join('')}</div></div>`; }).join('')+`<p class="hint" id="wishCount">${wishCountText()}</p>`;
  $$('#wishes .wcard').forEach(c=>{ c.onclick=()=>openWish(c.dataset.w); c.onkeydown=e=>{ if((e.key==='Enter'||e.key===' ')&&e.target===c){ e.preventDefault(); openWish(c.dataset.w); } }; });
  $$('#wishes .wpick').forEach(b=>b.onclick=e=>{ e.stopPropagation(); toggleWish(b.dataset.pick); });
  if(wstep===3) loadPhotos($('#wishes'));
}
function toggleWish(id){ toggle(draft.wishes,id); const on=draft.wishes.includes(id);
  $$('#wishes .wcard').filter(c=>c.dataset.w===id).forEach(c=>{ c.classList.toggle('on',on); const b=c.querySelector('.wpick'); b.setAttribute('aria-pressed',on); b.setAttribute('aria-label',`${on?'Remove':'Add'} ${short(BY_ID[id])}`); b.innerHTML=on?CHECK:PLUS; });
  const n=$('#wishCount'); if(n) n.textContent=wishCountText();
  $$('#today .tcard').filter(c=>c.dataset.w===id).forEach(c=>{ c.classList.toggle('on',on); const b=c.querySelector('.wpick'); if(b){ b.setAttribute('aria-pressed',on); b.innerHTML=on?CHECK:PLUS; } });
  if(wishOpen===id){ const b=$('#wmPick'); if(b){ b.className='btn '+(on?'dark':'primary'); b.textContent=on?'Added · tap to remove':'Add to my wishes'; } }
}
/* detail sheet */
let wishOpen=null, wishFrom=null;
const durText=m=>m>=60?`About ${Math.floor(m/60)} h${m%60?' '+m%60+' min':''}`:`About ${m} min`;
function openWish(id){
  const v=BY_ID[id]; if(!v) return; wishOpen=id; wishFrom=document.activeElement;
  const on=draft.wishes.includes(id), basis={listed:'listed price',estimate:'our estimate',resale:'lowest resale seen'}[v.price_basis]||'';
  const price=v.unit_pricing?`$${v.unit_pricing.weekday_price}–${v.unit_pricing.weekend_price} per ${v.unit_pricing.unit} per ${v.unit_pricing.per} (up to ${v.unit_pricing.capacity})`:v.price_pp?`$${v.price_pp} per person`:'Free';
  const when=v.starts?'Starts '+v.starts.map(x=>hs(toMin(x))).join(', '):v.hours?`Open ${hs(v.hours[0])}–${hs(v.hours[1])}`:'';
  const maps='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(short(v)+' '+v.address);
  $('#wishCard').innerHTML=`${coverHtml(v)}<button type="button" class="wm-x" id="wmClose" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <div class="wm-body"><p class="kicker">${esc(v.category)} · ${esc(v.neighborhood)}</p><h2>${esc(v.name)}</h2>
    <p class="wm-blurb">${esc(BLURB[id]||'')}</p>
    <div class="facts"><span>Price</span><b>${price}${basis&&price!=='Free'?` <span style="font-weight:400">(${basis})</span>`:''}</b>
      ${when?`<span>When</span><b>${when}${v.dates?' · '+v.dates.map(prettyDate).join(', '):''}</b>`:''}
      <span>Time needed</span><b>${durText(v.duration_min)}</b>
      <span>Where</span><b>${esc(v.address)}</b>
      <span>Booking</span><b>${esc(v.booking)}</b>
      ${v.age21?'<span>Age</span><b>21 and over</b>':''}${v.type==='food'?`<span>Vegetarian</span><b>${v.vegetarian?'Options available':'Limited'}</b>`:''}</div>
    <p class="note">${esc(v.price_note)}</p>
    <div class="applinks"><a href="${maps}" target="_blank" rel="noopener">Open in Google Maps</a>${v.source_url?`<a href="${esc(v.source_url)}" target="_blank" rel="noopener">Price source</a>`:''}</div>
    <p class="credit" id="wmCredit" hidden></p></div>
    <div class="wm-foot"><button type="button" class="btn line" id="wmBack">Close</button><button type="button" class="btn ${on?'dark':'primary'}" id="wmPick">${on?'Added · tap to remove':'Add to my wishes'}</button></div>`;
  $('#wmClose').onclick=$('#wmBack').onclick=closeWish; $('#wmPick').onclick=()=>toggleWish(id);
  $('#wishModal').classList.add('show'); loadPhotos($('#wishCard'));
  photoFor(id).then(p=>{ const c=$('#wmCredit'); if(p&&c&&wishOpen===id){ c.hidden=false; c.innerHTML=p.credit?`Photo: ${esc(p.credit)}`:`Photo: Wikipedia, ${p.page?`<a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.title)}</a>`:esc(p.title)}`; } });
  setTimeout(()=>{ const b=$('#wmPick'); if(b) b.focus(); },30);
}
function closeWish(){ wishOpen=null; $('#wishModal').classList.remove('show'); if(wishFrom&&wishFrom.isConnected) wishFrom.focus(); }
$('#wishModal').addEventListener('click',e=>{ if(e.target.id==='wishModal') closeWish(); });
addEventListener('keydown',e=>{ if(e.key==='Escape'&&wishOpen) closeWish(); });
/* crew panel */
function renderGroupTT(){
  const ps=state.people,f=groupFreeSlots(),from=8;
  const col=sch=>`<div class="col">${Array.from({length:32},(_,k)=>{ const t=sch[from*2+k]; return `<i style="background:${BLOCKS[t]?BLOCKS[t].c:'transparent'}"></i>`; }).join('')}</div>`;
  const freeCol=`<div class="col">${Array.from({length:32},(_,k)=>`<i style="background:${f[from*2+k]?'var(--free)':'transparent'}"></i>`).join('')}</div>`;
  const hours=`<div class="hours">${Array.from({length:32},(_,k)=>`<span>${k%4===0?hs((from*2+k)*30):''}</span>`).join('')}</div>`;
  const wins=freeWindows();
  $('#groupTT').innerHTML=`<div class="gtt" style="grid-template-columns:32px repeat(${ps.length},1fr) 1.2fr"><div></div>${ps.map(p=>`<div class="nm">${esc(p.name)}</div>`).join('')}<div class="nm" style="color:var(--ok)">All</div>${hours}${ps.map(p=>col(p.schedule||[])).join('')}${freeCol}</div>
    <div class="freelist">${wins.length?wins.map(([a,b])=>`<span>${hs(a)}–${hs(b)}</span>`).join(''):'<span style="background:var(--over-bg);color:var(--over)">No shared time yet</span>'}</div>
    <div class="legend">${Object.values(BLOCKS).map(b=>`<span><i style="background:${b.c}"></i>${b.l}</span>`).join('')}</div>`;
}
function renderCrew(){
  $('#crewList').innerHTML=state.people.map(p=>`<div class="mate"><i style="background:${p.color}"></i><div ${p.id===state.meId?`data-edit="${p.id}" title="Edit your planet"`:''}>${esc(p.name)}${p.sample?' <span class="badge warn">sample</span>':''}<small>Free ${personWindows(p).map(([a,b])=>hs(a)+'–'+hs(b)).join(', ')||'—'} · ${(p.wishes||[]).length} wishes · budget private</small></div>${p.id===state.meId?'<span class="you">You</span>':(state.isOrganizer?`<button type="button" class="linkbtn" data-remove="${p.id}">Remove</button>`:'')}</div>`).join('')||'<p class="hint">Nobody has joined yet. Make your planet, then share the link.</p>';
  $$('#crewList [data-edit]').forEach(m=>m.onclick=()=>editPerson(m.dataset.edit));
  $$('#crewList [data-remove]').forEach(b=>b.onclick=async()=>{ try{ const r=await api('POST','/plans/'+state.planId+'/remove',{token:TOKEN,memberId:b.dataset.remove}); applyPlan(r.plan); toast('Removed from the plan'); }catch(e){ toast(e.message); } });
  $('#toPull').disabled=!(state.meId&&state.people.length>=2);
  $('#nextHint').textContent=!state.meId?'Launch your own planet to continue.':state.people.length<2?'Waiting for at least one more person. Share the link above.':`${state.people.length} people in this plan · updates live`;
  $('#orgNote').textContent=state.isOrganizer?'You created this plan.':'You were invited to this plan.';
  renderGroupTT();
}
let previewDirty=false;
function livePreview(){ validate(); if(editingId){ const en=ents.find(x=>x.p.id===editingId); if(en){ Object.assign(en.p,JSON.parse(JSON.stringify(draft))); rebuildEnt(en); } return; } previewDirty=true; }
$('#pName').oninput=()=>{ draft.name=$('#pName').value; validate(); };
$('#pVeg').onchange=()=>{ draft.veg=$('#pVeg').checked; };
$('#pU21').onchange=()=>{ draft.u21=$('#pU21').checked; };
$('#pBudget').oninput=()=>{ draft.budget=+$('#pBudget').value; $('#budgetBig').textContent='$'+draft.budget; };
$('#planetForm').onsubmit=async e=>{
  e.preventDefault(); if(wstep!==4){ $('#wNext').click(); return; } if($('#saveBtn').disabled) return toast('Add a name, a food and one interest');
  draft.name=draft.name.trim(); const first=!state.meId; $('#saveBtn').disabled=true;
  try{
    const r=await api('PUT','/plans/'+state.planId+'/me',{token:TOKEN,member:draft});
    const start=preview?preview.position.clone():PREVIEW_POS.clone();
    applyPlan(r.plan); editPerson(state.meId); refreshMe();
    if(first){ sparks.emit(start,[draft.color,'#ffffff'],60,3.5); toast(`Welcome, ${me().name}. Your planet is in orbit.`); } else toast('Your planet is updated');
  }catch(err){ toast(err.message); } finally{ validate(); }
};
$('#cancelBtn').onclick=()=>{ if(state.meId) editPerson(state.meId); };
$('#copyBtn').onclick=()=>{ const v=$('#inviteLink').value; const done=()=>{ $('#copyBtn').textContent='Copied'; setTimeout(()=>$('#copyBtn').textContent='Copy',1400); }; try{ navigator.clipboard.writeText(v).then(done,()=>{ $('#inviteLink').select(); }); }catch(e){ $('#inviteLink').select(); } };
$('#toPull').onclick=()=>{ if(!freeWindows().length) return toast('No shared free time yet. Someone needs to free up some time.'); state.maxStep=Math.max(state.maxStep,3); goStep(3); };

/* ---- step 3 ---- */
function updateAbsorb(){ const n=ents.length,k=ents.filter(e=>e.mode==='absorbed'||e.mode==='absorbing').length; $('#absorbCount').textContent=`${k} / ${n}`; $('#absorbDots').innerHTML=ents.map(e=>`<i class="${e.mode==='absorbed'||e.mode==='absorbing'?'in':''}" style="background:${e.p.color}"></i>`).join(''); $('#pullAll').disabled=k===n; }
function absorb(en){ if(en.mode==='absorbing'||en.mode==='absorbed') return; en.mode='absorbing'; en.t=0; en.from=en.obj.position.clone(); updateAbsorb(); }
function onAbsorbed(en){ en.mode='absorbed'; en.obj.visible=false; core.userData.pulse=1; sparks.emit(new V3(0,.7,0),[en.p.color,'#ffffff'],50,4); updateAbsorb(); if(ents.every(e=>e.mode==='absorbed')) setTimeout(revealPlans,700); }
$('#pullAll').onclick=()=>{ ents.filter(e=>e.mode==='orbit'||e.mode==='fly').forEach((e,i)=>setTimeout(()=>absorb(e),i*260)); };

/* ---- step 4 ---- */
let coreShrink=0;
const suggestSig=()=>JSON.stringify(state.suggested||[]);
let lastSuggest='';
function optionFromServer(o){ const ev=evaluateStops(o.stops.filter(s=>BY_ID[s.id]),state.people,ctxFor()); return {...ev,label:o.label||'Plan',why:o.why||''}; }
function computeOptions(){
  let base=[]; state.ai=state.ai&&state.ai.status==='thinking'?state.ai:null;
  const raw=state.aiRaw;
  if(raw&&Array.isArray(raw.plans)){
    const c=ctxFor(),rejected=[];
    raw.plans.forEach(p=>{ const v=validateStops(p.stops); if(v.ok) base.push({...evaluateStops(v.stops,state.people,c),label:String(p.label||'AI plan').slice(0,40),why:String(p.why||'').slice(0,240),ai:true}); else rejected.push(`${p.label||'A plan'}: ${v.problems[0]}`); });
    if(!(state.ai&&state.ai.status==='thinking')) state.ai=base.length?{status:'done',tips:raw.tips||[],rejected}:{status:'error',msg:'The AI’s plans didn’t fit everyone’s current timetables'+(rejected[0]?` (${rejected[0]})`:'')+'. Showing the built-in plans.'};
  }
  if(!base.length) base=recommend();
  const keys=new Set(base.map(optKey));
  (state.suggested||[]).forEach(sg=>{ if(keys.has(sg.key)) return; const by=state.people.find(x=>x.id===sg.by); const o=optionFromServer(sg); o.label=sg.label.replace(/^Suggested: /,''); o.suggestedBy=by?by.name:'Someone'; base.push(o); keys.add(sg.key); });
  return base;
}
function refreshOptions(){
  const prevKey=state.selected>=0&&state.options&&state.options[state.selected]?optKey(state.options[state.selected]):null;
  state.options=computeOptions(); lastSuggest=suggestSig();
  if(!state.options.length) return;
  const idx=prevKey?state.options.findIndex(o=>optKey(o)===prevKey):-1;
  state.selected=idx; makeWorlds(); if(idx<0) $('#detail').classList.remove('show');
  setView();
}
function revealPlans(){ if(state.step!==3) return; state.options=computeOptions(); lastSig=memberSig(); lastSuggest=suggestSig(); if(!state.options.length){ toast('Nothing fits everyone’s free time that day. Try another day.'); goStep(2); return; } sparks.emit(new V3(0,.8,0),ents.map(e=>e.p.color).concat(['#ffffff']),200,6); makeWorlds(); state.maxStep=4; goStep(4); renderPlanList(); }
let aiBusy=false;
function aiContext(){
  const c=ctxFor(),pool=candidatePool(),fm=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  return { windows:freeWindows().map(([a,b])=>fm(a)+'–'+fm(b)),
    venues:pool.map(v=>{ const q=priceVenue(v,{...c,size:1},v.starts?toMin(v.starts[0]):null); return `${v.id} | ${v.name} | ${v.type} | ${v.category} | ~$${q.total} per person incl. tax/tip | ${v.duration_min} min | ${v.starts?'fixed starts '+v.starts.join(', '):'open '+fm(v.hours[0])+'–'+fm(v.hours[1])} | tags: ${v.tags.join(',')} | ${v.neighborhood} | ${v.lat},${v.lng}`; }) };
}
async function askAI(){
  if(aiBusy) return;
  if(!state.organizerPlus){ if(state.isOrganizer) openPay('ai'); else toast('The AI organizer is part of Plus. Ask the person who created the plan to upgrade.'); return; }
  aiBusy=true; state.ai={status:'thinking'}; renderPlanList();
  try{ const r=await api('POST','/plans/'+state.planId+'/ai',{token:TOKEN,context:aiContext()}); state.ai=null; applyPlan(r.plan); refreshOptions(); renderPlanList();
    const n=(state.options||[]).filter(o=>o.ai).length; toast(n?`AI built ${n} plan${n>1?'s':''} that fit everyone’s day`:'The AI’s plans didn’t fit. Showing the built-in plans.'); }
  catch(e){ state.ai={status:'error',msg:e.message}; if(e.code==='upgrade_required') openPay('ai'); renderPlanList(); }
  finally{ aiBusy=false; }
}
function renderPlanList(){
  if(!state.options) return;
  const c=ctxFor(),w=winnerIdx(),ai=state.ai;
  const aiBox=(ai&&ai.status==='thinking'
    ?`<div class="aibox"><h3>Organizing your day…</h3><p>Claude is fitting everyone’s wishes into the shared hours under the group budget. This usually takes 20 to 60 seconds.</p></div>`
    :`<div class="aibox"><h3>Let AI organize it</h3><p>Uses everyone’s timetable, wishes and the group’s lowest budget. Never individual budgets. Every suggestion is checked before it appears.</p>${ai&&ai.status==='done'&&ai.tips&&ai.tips.length?`<ul>${ai.tips.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:''}${ai&&ai.status==='error'?`<p style="color:var(--over)">${esc(ai.msg)}</p>`:''}<div class="btnrow" style="margin-top:10px"><button class="btn primary sm" id="aiBtn" type="button">${ai&&ai.status==='done'?'Ask AI again':'Ask AI to organize'}${state.organizerPlus||state.plus?'':' · Plus'}</button></div></div>`);
  $('#plansPanel').innerHTML=`
    <p class="kicker">${esc(planMeta())}</p>
    <h2>${state.options.length} ways to spend the day</h2>
    <h4>Everyone free</h4>${dayBar(null)}
    ${voteBanner()}
    ${aiBox}
    <div class="plan-list">${state.options.map((o,i)=>{ const st=budgetStatus(o.perPerson,c.cap),t=tally(i),sch=schedule(o),my=votesFor(i)[state.meId],n=Math.max(state.people.length,1); return `<div class="pcard ${i===w&&t.up?'top':''} ${my===1?'mine':''}"><button type="button" class="plan-row ${state.selected===i?'sel':''}" data-i="${i}"><i style="background:${THEMES[i%3].base}"></i><div><b>${esc(o.label)}${o.ai?' <span class="badge aib">AI</span>':''}${o.suggestedBy?` <span class="badge ok">by ${esc(o.suggestedBy)}</span>`:''}${i===w&&t.up?' <span class="badge live">Top voted</span>':''}</b><small>${hs(sch[0].s)}–${hs(sch[sch.length-1].end)} · ${sch.map(x=>esc(short(x.v))).join(' → ')}</small><br><span class="badge ${st.level==='none'?'ok':st.level}">${st.level==='over'?'Over budget':st.level==='warn'?'Near limit':'Fits budget'}</span> <small>${o.wish} wish${o.wish===1?'':'es'}</small></div><span class="pp">${money(o.perPerson)}<small>per person</small></span></button>
      <div class="vrow"><button type="button" class="vq ${my===1?'on':''}" data-qv="${i}" data-v="1" aria-pressed="${my===1}">${my===1?'✓ Voted':'Vote for this'}</button><button type="button" class="vq no ${my===-1?'on':''}" data-qv="${i}" data-v="-1" aria-pressed="${my===-1}" aria-label="Not for me">✕</button>
        <span class="vmeter" aria-hidden="true"><i style="width:${Math.round(t.up/n*100)}%"></i></span><span class="vcount">${t.up} of ${n} yes</span><span class="vfaces">${upVoters(i).map(p=>`<i style="background:${p.color}" title="${esc(p.name)}">${esc(p.name.charAt(0).toUpperCase())}</i>`).join('')}</span></div></div>`; }).join('')}</div>
    <p class="hint" style="margin-top:12px">${state.people.length} people · votes and comments update live for everyone.</p>
    <div class="btnrow"><button class="btn line sm" id="refreshBtn" type="button">Rebuild plans</button>${state.isOrganizer?'<button class="btn dark sm" id="lockTop" type="button">Lock in top plan</button>':''}</div>${state.isOrganizer?'':'<p class="hint">The person who created the plan locks in the winner.</p>'}
    <p class="note">Ticket prices as listed online; booking fees may apply. Food prices are estimates; hours approximate. Checked ${prettyDate(DATA.checked_on)}.</p>`;
  $$('#plansPanel .plan-row').forEach(b=>b.onclick=()=>selectPlan(+b.dataset.i));
  $$('#plansPanel [data-qv]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); castVote(+b.dataset.qv,+b.dataset.v); });
  $('#refreshBtn').onclick=()=>{ state.selected=-1; $('#detail').classList.remove('show'); refreshOptions(); renderPlanList(); toast('Plans rebuilt from everyone’s latest answers'); };
  const lt=$('#lockTop'); if(lt) lt.onclick=()=>lockPlan(winnerIdx());
  const ab=$('#aiBtn'); if(ab) ab.onclick=askAI;
}
/* voting: one helper for the list and the detail; a banner shows who still has to vote */
async function castVote(i,v){
  if(!state.meId) return toast('Make your planet first, then you can vote');
  const o=state.options[i], my=votesFor(i)[state.meId], nv=my===v?0:v;
  try{ const r=await api('POST','/plans/'+state.planId+'/vote',{token:TOKEN,key:optKey(o),value:nv}); applyPlan(r.plan);
    if(nv===1){ if(worlds[i]) sparks.emit(worlds[i].slot.clone().add(new V3(0,1,0)),[me().color,'#ffffff'],40,3); toast(`You voted for “${o.label}”`); }
    else if(nv===-1) toast('Noted. You’re not keen on this one'); else toast('Vote removed'); }
  catch(e){ toast(e.message); }
}
function votedIds(){ const s=new Set(); (state.options||[]).forEach((o,i)=>Object.entries(votesFor(i)).forEach(([id,v])=>{ if(v) s.add(id); })); return s; }
function voteBanner(){
  const done=votedIds(), n=state.people.length, k=state.people.filter(p=>done.has(p.id)).length, mine=state.meId&&done.has(state.meId);
  const faces=state.people.map(p=>`<i class="${done.has(p.id)?'':'wait'}" style="background:${p.color}" title="${esc(p.name)}${done.has(p.id)?' voted':' hasn’t voted yet'}">${esc(p.name.charAt(0).toUpperCase())}</i>`).join('');
  const waiting=state.people.filter(p=>!done.has(p.id)&&p.id!==state.meId).map(p=>p.name);
  const title=!state.meId?'Join to vote':!mine?'Your turn: vote for the plan you want':k===n?'Everyone has voted':'You voted';
  const sub=!mine&&state.meId?`Tap “Vote for this” on a plan below. ${k} of ${n} have voted.`:k===n?(state.isOrganizer?'Lock in the top plan when you’re ready.':'The organizer locks in the top plan.'):`${k} of ${n} have voted · waiting for ${esc(waiting.slice(0,3).join(', '))}${waiting.length>3?' and others':''}`;
  return `<div class="vstat ${mine?'done':''}"><div><b>${title}</b><small>${sub}</small></div><span class="who">${faces}</span></div>`;
}
let tab='plan';
function selectPlan(i){ state.selected=i; tab='plan'; setView(); renderPlanList(); renderDetail(); $('#detail').classList.add('show'); $('#plansPanel').classList.remove('show'); }
function deselect(){ state.selected=-1; setView(); renderPlanList(); $('#detail').classList.remove('show'); if(state.step===4) $('#plansPanel').classList.add('show'); }
function pricePanel(o){
  const c=ctxFor(),q=quoteStops(o.stops,c),m=me(),g=budgetStatus(q.perPerson,c.cap),mine=m&&m.budget?budgetStatus(q.perPerson,Number(m.budget)):null;
  const msg={ok:'Fits everyone’s budget',warn:'Close to someone’s budget limit',over:'Over someone’s budget. Try swapping a stop',none:'No budgets set yet'}[g.level];
  const col={ok:'var(--ok)',warn:'#b07a14',over:'var(--over)'};
  return `<div class="pricebox"><div class="pline" style="color:var(--muted)">For ${q.size} ${q.size>1?'people':'person'}</div>${q.lines.map(l=>`<div class="pline"><span>${esc(l.name)}</span><span>${money(l.base)}</span></div>`).join('')}
    <div class="pline muted"><span>NYC sales tax (8.875%, food)</span><span>${money(q.tax)}</span></div><div class="pline muted"><span>Tip (20%, table service)</span><span>${money(q.tip)}</span></div>
    <div class="pline tot"><span>Total</span><span>${money(q.total)}</span></div><div class="pline pp"><span>Per person</span><span>${money(q.perPerson)}</span></div>
    <div class="alert ${g.level==='none'?'ok':g.level}">${msg}</div>
    ${mine?`<p class="hint" style="margin-top:12px">Your private budget is ${money(m.budget)}. This plan uses ${Math.round(mine.ratio*100)}%.</p><div class="bar"><i style="width:${Math.min(100,mine.ratio*100)}%;background:${col[mine.level]}"></i></div>`:''}</div>`;
}
function renderDetail(){
  const i=state.selected; if(i<0) return;
  const o=state.options[i],t=tally(i),my=votesFor(i)[state.meId],w=winnerIdx(),viewer=me(),key=optKey(o);
  const firstAct=o.stops.findIndex(s=>BY_ID[s.id].type==='activity');
  const SCH=schedule(o); const stops=SCH.map(({time,v,end},k)=>(k?legHtml(SCH[k-1].v,v):'')+`<li><span class="t">${time}<br><span style="color:var(--faint)">${hhmm(end)}</span></span><span class="n">${k+1}</span><div><b>${esc(v.name)}</b><small>${esc(v.category)} · ${esc(v.neighborhood)}</small><small>${esc(v.price_note)}</small><div class="applinks"><a href="${L.gmaps(v)}" target="_blank" rel="noopener">Google Maps</a><a href="${L.apple(v)}" target="_blank" rel="noopener">Apple Maps</a>${v.source_url?`<a href="${esc(v.source_url)}" target="_blank" rel="noopener">Tickets &amp; price</a>`:''}</div><small class="src">${esc(v.booking)}${v.source_url?` · <a href="${esc(v.source_url)}" target="_blank" rel="noopener">${v.price_basis==='listed'?'listed price':v.price_basis==='resale'?'resale listing':'estimate'}</a>`:''}</small>${v.type==='food'?'<button type="button" class="swap" data-swap="food">Swap restaurant</button>':k===firstAct?'<button type="button" class="swap" data-swap="act">Swap activity</button>':''}</div></li>`).join('');
  const why=explain(o).map(x=>`<div><b>${esc(x.m.name)}</b> · ${x.hits.length?esc(x.hits.join(', ')):'fits their free time and budget'}</div>`).join('');
  const cm=(state.comments[key]||[]).map(cc=>{ const p=state.people.find(x=>x.id===cc.by); return `<div class="cmt"><b>${esc(p?p.name:'Someone')}</b>${esc(cc.text)}</div>`; }).join('')||'<p class="hint">No comments yet.</p>';
  $('#detail').innerHTML=`
    <button class="back" id="backBtn" type="button">← All plans</button>
    <p class="kicker">${esc(o.label)}${o.ai?' · AI':''}</p>
    <h2>${money(o.perPerson)} per person</h2>
    <p class="lede" style="margin-top:6px">${o.why?esc(o.why):`${o.stops.length} stops · ${hs(o.stops[0].start)} to ${hs(schedule(o).slice(-1)[0].end)} · ${o.wish} wishes covered`}</p>
    <div class="vbig"><button type="button" class="${my===1?'on':''}" data-vote="1" aria-pressed="${my===1}"><span>${my===1?'✓ You’re in':'I’m in'}</span><small>${t.up} yes</small></button><button type="button" class="no ${my===-1?'on':''}" data-vote="-1" aria-pressed="${my===-1}"><span>Not for me</span><small>${t.down} no</small></button></div>
    <div class="voters">${upVoters(i).map(p=>`<i style="background:${p.color}"></i>`).join('')}${upVoters(i).length?upVoters(i).map(p=>esc(p.name)).join(', ')+' voted yes':'No yes votes yet. Be the first.'}</div>
    <div class="tabs" role="tablist">${[['plan','Itinerary'],['cost','Cost'],['vote',`Comments · ${(state.comments[key]||[]).length}`]].map(([k,l])=>`<button type="button" role="tab" class="${tab===k?'on':''}" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="tabpane ${tab==='plan'?'on':''}">${dayBar(o.stops)}<ul class="stops">${stops}</ul><h4>Why it works</h4><div class="why">${why}</div>${appsHtml(o)}</div>
    <div class="tabpane ${tab==='cost'?'on':''}">${pricePanel(o)}</div>
    <div class="tabpane ${tab==='vote'?'on':''}">
      <div class="comments">${cm}</div>
      <div class="cmt-in"><input type="text" id="cmtIn" maxlength="200" placeholder="Comment as ${esc(viewer?viewer.name:'guest')}"><button class="btn dark sm" id="postBtn" type="button">Post</button></div>
    </div>
    <div class="detail-foot">${state.isOrganizer?`<button class="btn primary full" id="lockBtn" type="button" ${i===w?'':'disabled'}>Lock in this plan</button><p class="hint" style="text-align:center">${i===w?'This is the group’s top-voted plan.':'Only the top-voted plan can be locked in.'}</p>`:`<p class="hint" style="text-align:center">${i===w?'This is the group’s top-voted plan. The organizer locks it in.':'Vote for the plan you want. The organizer locks in the winner.'}</p>`}</div>`;
  $('#backBtn').onclick=deselect;
  $$('#detail [data-tab]').forEach(b=>b.onclick=()=>{ tab=b.dataset.tab; renderDetail(); });
  $$('#detail [data-swap]').forEach(b=>b.onclick=async()=>{ if(!state.meId) return toast('Join the plan first'); const s=swap(o,b.dataset.swap); if(!s) return toast('Nothing else fits everyone’s time and budget');
    try{ const r=await api('POST','/plans/'+state.planId+'/suggest',{token:TOKEN,option:{stops:s.stops,label:o.label,perPerson:s.perPerson}}); state.selected=-1; applyPlan(r.plan); refreshOptions(); const ni=state.options.findIndex(x=>optKey(x)===optKey(s)); renderPlanList(); if(ni>=0) selectPlan(ni); toast(`Shared with the group as a new option: ${money(s.perPerson)} per person`); }catch(e){ toast(e.message); } });
  $$('#detail [data-vote]').forEach(b=>b.onclick=()=>castVote(i,+b.dataset.vote));
  const post=async()=>{ if(!state.meId) return toast('Join the plan first'); const tx=$('#cmtIn').value.trim(); if(!tx) return; try{ const r=await api('POST','/plans/'+state.planId+'/comment',{token:TOKEN,key,text:tx}); $('#cmtIn').blur(); applyPlan(r.plan); }catch(e){ toast(e.message); } };
  $('#postBtn').onclick=post; $('#cmtIn').onkeydown=e=>{ if(e.key==='Enter') post(); };
  const lb=$('#lockBtn'); if(lb) lb.onclick=()=>lockPlan(i);
}

/* ---- links into other apps ---- */
const enc=encodeURIComponent;
const L={
  gmaps:v=>`https://www.google.com/maps/search/?api=1&query=${enc(short(v)+', '+v.address)}`,
  apple:v=>`https://maps.apple.com/?q=${enc(short(v))}&ll=${v.lat},${v.lng}`,
  transit:(a,b)=>`https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=${travel(a,b).mode==='walk'?'walking':'transit'}`,
  citymapper:(a,b)=>`https://citymapper.com/directions?startcoord=${a.lat},${a.lng}&endcoord=${b.lat},${b.lng}&endname=${enc(short(b))}`,
  route:o=>'https://www.google.com/maps/dir/'+itemsFor(o).map(v=>`${v.lat},${v.lng}`).join('/'),
};
function calInfo(o){
  const sch=schedule(o), off=state.date>='2027-03-14'?4:5;
  const at=m=>{ const d=new Date(state.date+'T00:00:00Z'); d.setUTCMinutes(m+off*60); return d; };
  const st=at(sch[0].s), en=at(sch[sch.length-1].end);
  const g=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const body=sch.map(x=>`${x.time} · ${x.v.name} (${x.v.address})`).join('\n')+'\n\nPlanned with GatherGlow';
  return {title:state.planName, gStart:g(st), gEnd:g(en), iStart:st.toISOString(), iEnd:en.toISOString(), body, loc:sch[0].v.address};
}
L.gcal=o=>{ const c=calInfo(o); return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(c.title)}&dates=${c.gStart}/${c.gEnd}&details=${enc(c.body)}&location=${enc(c.loc)}`; };
L.outlook=o=>{ const c=calInfo(o); return `https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=${enc(c.title)}&startdt=${enc(c.iStart)}&enddt=${enc(c.iEnd)}&body=${enc(c.body)}&location=${enc(c.loc)}`; };
function legHtml(a,b){ const t=travel(a,b); return `<li class="leg"><span>${t.mode==='walk'?'Walk':'Subway'} ~${t.min} min · ${t.km.toFixed(1)} km</span><a href="${L.transit(a,b)}" target="_blank" rel="noopener">Directions</a><a href="${L.citymapper(a,b)}" target="_blank" rel="noopener">Citymapper</a></li>`; }
function appsHtml(o){ return `<h4>Open in other apps</h4><div class="apps">
  <a href="${L.route(o)}" target="_blank" rel="noopener"><span>Google Maps<small>Whole route, all stops</small></span></a>
  <a href="${L.apple(itemsFor(o)[0])}" target="_blank" rel="noopener"><span>Apple Maps<small>First stop</small></span></a>
  <a href="${L.gcal(o)}" target="_blank" rel="noopener"><span>Google Calendar<small>Add the day</small></span></a>
  <a href="${L.outlook(o)}" target="_blank" rel="noopener"><span>Outlook<small>Add the day</small></span></a></div>
  <p class="hint">Opens in a new tab. Travel times are estimates; check live transit before you go.</p>`; }

/* ---- step 5 ---- */
async function lockPlan(i){
  if(i<0||!state.options) return;
  const o=state.options[i];
  try{ const r=await api('POST','/plans/'+state.planId+'/lock',{token:TOKEN,option:{stops:o.stops,label:o.label,perPerson:o.perPerson}}); state.selected=-1; $('#detail').classList.remove('show'); applyPlan(r.plan); toast('Plan locked in. Everyone in the group now sees it.'); }
  catch(e){ toast(e.message); }
}
function renderTicket(){
  const o=state.lockedOpt; if(!o) return;
  const c=ctxFor(),sch=schedule(o),b=state.booked,key=optKey(o),vt=Object.values(state.votes[key]||{}).filter(x=>x===1).length;
  $('#ticket').innerHTML=`<div class="ticket-top"><div><p class="kicker">${esc(state.planName)} · ${prettyDate(state.date)}</p><h2>${b?'You’re all set':'Ready to book'}</h2></div><span class="stamp ${b?'':'pending'}">${b?'Booked':'Locked in'}</span></div>
    <p class="lede">${esc(o.label)} for ${c.size} people. ${vt} of ${c.size} voted yes.</p>
    <div style="margin-top:14px">${dayBar(o.stops)}</div>
    <ul class="stops">${sch.map(({time,v},k)=>{ const code=b&&b.codes.find(x=>x.id===v.id); return (k?legHtml(sch[k-1].v,v):'')+`<li><span class="t">${time}</span><span class="n">${k+1}</span><div><b>${esc(v.name)}</b><small>${esc(v.booking)} · ${esc(v.address)}</small>${code?`<span class="codepill">${esc(code.code)}</span>`:''}</div></li>`; }).join('')}</ul>
    ${appsHtml(o)}<div class="perforation"></div>${pricePanel(o)}
    ${b?`<p class="hint">Test booking: these codes are simulated. No reservation was made and nothing was charged.</p><div class="btnrow"><button class="btn line" id="remindBtn" type="button">Remind me in 4 weeks</button><button class="btn dark" id="againBtn" type="button">Plan the next one</button></div>`
       :(state.isOrganizer?`<div class="btnrow"><button class="btn line" id="backPlans" type="button">Unlock</button><button class="btn primary" id="bookBtn" type="button">Book all for ${c.size}</button></div><p class="hint">Booking is simulated (test data). Use the links above to book for real.</p>`:`<p class="hint">Waiting for the organizer to book. This page updates by itself.</p>`)}`;
  if(b){ $('#againBtn').onclick=()=>{ location.href='/?start=1'; }; $('#remindBtn').onclick=remindIcs; refreshMe(); return; }
  const bb=$('#bookBtn'); if(bb) bb.onclick=async()=>{ try{ const r=await api('POST','/plans/'+state.planId+'/book',{token:TOKEN,freeIds:itemsFor(o).filter(v=>v.price_pp===0).map(v=>v.id)}); applyPlan(r.plan); for(let k=0;k<3;k++) setTimeout(()=>glow.emit(new V3(rand(-4,4),rand(2,4),-3),['#ffffff','#f3d7a6'],120,4.5),k*260); toast('Booked. Everyone in the group sees the itinerary.'); }catch(e){ toast(e.message); } };
  const bp=$('#backPlans'); if(bp) bp.onclick=async()=>{ try{ const r=await api('POST','/plans/'+state.planId+'/lock',{token:TOKEN,option:null}); applyPlan(r.plan); }catch(e){ toast(e.message); } };
}

/* ---- Plus paywall (Stripe Checkout, test mode) ---- */
const TIER_NAME={plus:'Plus',family:'Family',crew:'Crew'};
function renderPlusBadge(){ const b=$('#plusBadge'); if(b){ b.hidden=!state.plus; b.textContent=TIER_NAME[state.tier]||'Plus'; } }
let payCycle='y';
const TIERS=[
  {key:'pass',name:'Event Pass',who:'One big occasion: a birthday, a reunion, a visit',once:799,per:null,feat:['This plan only, no subscription','AI organizer for this plan','Up to 12 people']},
  {key:'plus',name:'Plus',who:'For the one friend who always organizes',m:999,y:7900,seats:1,feat:['Unlimited group plans','AI organizer on every plan','Up to 12 people per plan']},
  {key:'family',name:'Family',who:'One household, up to 6 people',m:1999,y:15900,seats:6,feat:['Everything in Plus','Plus for up to 6 people','Anyone in the family can plan']},
  {key:'crew',name:'Crew',who:'Your friend group, up to 8 people',m:2499,y:19900,seats:8,best:true,feat:['Everything in Plus','Plus for up to 8 friends','Anyone in the crew starts plans and uses AI']},
];
const usd=c=>'$'+(c/100).toFixed(c%100?2:0);
function renderTiers(){
  const h=state.health||{}, ok=!!h.stripe;
  $$('#payCycle button').forEach(b=>b.classList.toggle('on',b.dataset.c===payCycle));
  $('#payTiers').innerHTML=TIERS.map(t=>{
    const yearly=payCycle==='y', cents=t.once||(yearly?t.y:t.m), unit=t.once?'one-time':yearly?'/year':'/month';
    const perMonth=t.once?null:(yearly?t.y/12:t.m), pp=t.seats>1?`${usd(Math.round(perMonth/t.seats))} per person a month`:(yearly&&!t.once?`${usd(Math.round(perMonth))} a month, billed yearly`:'');
    const mine=!t.once&&state.tier===t.key, passOn=t.once&&state.pass;
    const dis=!ok||mine||passOn||(t.once&&!state.planId);
    const label=mine?'Your plan':passOn?'Added to this plan':t.once&&!state.planId?'Open a plan first':t.once?'Buy for this plan':`Choose ${t.name}`;
    return `<div class="tier ${t.best?'best':''}">${t.best?'<span class="flag">Best for groups</span>':''}<h3>${t.name}</h3><div class="who">${t.who}</div>
      <div class="amt">${usd(cents)}<small> ${unit}</small></div><div class="pp">${pp}</div>
      <ul>${t.feat.map(f=>`<li>${f}</li>`).join('')}</ul>
      <button type="button" class="btn ${t.best?'primary':'dark'} sm" data-buy="${t.once?'pass':t.key+'_'+payCycle}" ${dis?'disabled':''}>${label}</button></div>`;
  }).join('');
  $$('#payTiers [data-buy]').forEach(b=>b.onclick=async()=>{ b.disabled=true; b.textContent='Opening checkout…';
    try{ const r=await api('POST','/checkout',{token:TOKEN,planId:state.planId,plan:b.dataset.buy}); location.href=r.url; }
    catch(e){ toast(e.message); renderTiers(); } });
  $('#payNow').textContent=state.tier?(state.coveredBy?`You have ${TIER_NAME[state.tier]} through ${state.coveredBy}.`:`You have ${TIER_NAME[state.tier]}.`):'';
}
$$('#payCycle button').forEach(b=>b.onclick=()=>{ payCycle=b.dataset.c; renderTiers(); });
function openPay(reason,msg){
  const h=state.health||{};
  $('#payReason').textContent=msg||(reason==='ai'?'The AI organizer comes with an Event Pass, Plus, Family or Crew.':reason==='plans'?'The free plan includes 1 group plan a month.':'Organizers and their groups pay; businesses never do. Prices in US dollars.');
  $('#payTest').hidden=h.stripeMode!=='test'; $('#payOff').hidden=!!h.stripe;
  renderTiers(); $('#payModal').classList.add('show');
}
$('#payClose').onclick=()=>$('#payModal').classList.remove('show');
$('#payModal').addEventListener('click',e=>{ if(e.target.id==='payModal') $('#payModal').classList.remove('show'); });
$('#pricingBtn').onclick=()=>openPay('pricing');

/* ---- retention: my plans, saved planet, reminder ---- */
state.myPlans=[]; state.stats=null; state.profile=null;
const STATUS={booked:'Booked',locked:'Locked in',planning:'Planning'};
function applyProfile(d){ const p=state.profile; if(!p||state.meId) return;
  ['name','foods','vibes','veg','u21','budget','schedule'].forEach(k=>{ if(p[k]!=null) d[k]=JSON.parse(JSON.stringify(p[k])); });
  if(p.color&&!state.people.some(x=>x.color===p.color)) d.color=p.color; }
function renderMine(){
  const ps=state.myPlans||[], st=state.stats||{}, fr=st.friends||[];
  $('#myPlansBtn').hidden=!ps.length;
  const last=ps.find(x=>!x.sample)||ps[0], wb=$('#wback');
  if(last){ wb.hidden=false; wb.innerHTML=`<span>Welcome back${state.profile&&state.profile.name?', '+esc(state.profile.name):''}. Last plan: <b>${esc(last.name)}</b> · ${esc(prettyDate(last.date))} · ${STATUS[last.status]}</span><button class="textlink" type="button" id="wbOpen">Your plans →</button>`; $('#wbOpen').onclick=openMine; }
  else wb.hidden=true;
  $('#myStats').innerHTML=`<div><span>Plans</span><b>${ps.length}</b></div><div><span>Outings booked</span><b>${st.booked||0}</b></div>
    <div><span>Friends you plan with</span><b>${fr.length?esc(fr.slice(0,5).join(', '))+(fr.length>5?' +'+(fr.length-5):''):'None yet'}</b></div>
    <div><span>Kept under your budget</span><b>${money(st.underBudget||0)}</b></div>
    <div><span>Your planet</span><b>${state.profile?'Saved. Pre-filled next time':'Saved after your first plan'}</b></div>`;
  $('#myList').innerHTML=ps.map(x=>`<a href="/p/${esc(x.id)}"><div><b>${esc(x.name)}</b><small>${esc(longDate(x.date))} · ${x.people.length} ${x.people.length===1?'person':'people'}${x.people.length?': '+esc(x.people.slice(0,4).join(', '))+(x.people.length>4?'…':''):''}${x.sample?' · sample group':''}${x.isOrganizer?'':' · invited'}</small></div><span class="st ${x.status}">${STATUS[x.status]}</span></a>`).join('')||'<p class="hint">No plans yet.</p>';
}
function openMine(){ renderMine(); $('#myModal').classList.add('show'); refreshMe(); }
function closeMine(){ $('#myModal').classList.remove('show'); }
$('#myPlansBtn').onclick=openMine; $('#myClose').onclick=closeMine;
$('#myModal').addEventListener('click',e=>{ if(e.target.id==='myModal') closeMine(); });
$('#myNew').onclick=()=>{ closeMine(); if(!state.planId&&state.step===1){ dismissIntro(); $('#planName').focus(); } else location.href='/?start=1'; };
$('#myRemind').onclick=remindIcs;
/* a real calendar reminder (.ics with an alert), 4 weeks after the last plan */
function remindIcs(){
  const last=(state.myPlans||[]).find(x=>!x.sample), now=new Date();
  let at=last?new Date(last.date+'T10:00:00'):new Date(now); at.setDate(at.getDate()+28);
  if(at<now){ at=new Date(now); at.setDate(at.getDate()+28); } at.setHours(10,0,0,0);
  const f=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''), x=t=>String(t).replace(/[\\;,]/g,m=>'\\'+m).replace(/\n/g,'\\n');
  const who=((state.stats&&state.stats.friends)||[]).slice(0,4).join(', '), url=location.origin+'/?start=1';
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//GatherGlow//Reminder//EN','BEGIN:VEVENT','UID:'+uid(12)+'@gatherglow','DTSTAMP:'+f(now),'DTSTART:'+f(at),'DTEND:'+f(new Date(at.getTime()+15*6e4)),
    'SUMMARY:'+x('Plan the next outing'+(who?' with '+who:'')),'DESCRIPTION:'+x('Your saved planet is ready. Start a plan and send the link to your group: '+url),'URL:'+url,
    'BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+x('Plan the next outing'),'TRIGGER:PT0M','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([ics],{type:'text/calendar'})); a.download='gatherglow-reminder.ics'; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },800);
  toast(`Reminder for ${at.toLocaleDateString('en-US',{month:'short',day:'numeric'})} saved. Open the file to add it to your calendar.`);
}
$('#judgeLink').onclick=()=>$('#judgeModal').classList.add('show');

/* ---- judge guide ---- */
$('#judgeBtn').onclick=()=>$('#judgeModal').classList.add('show');
$('#judgeClose').onclick=()=>$('#judgeModal').classList.remove('show');
$('#judgeModal').addEventListener('click',e=>{ if(e.target.id==='judgeModal') $('#judgeModal').classList.remove('show'); });

/* ---- What's on ---- */
let woFilter='date';
function renderWhatsOn(){
  const today=DATA.checked_on,d=s=>new Date(s+'T12:00:00');
  const items=DATA.calendar.filter(e=>(e.end||e.date)>=today).sort((a,b)=>(a.end?'0':'1').localeCompare(b.end?'0':'1')||a.date.localeCompare(b.date)).filter(e=>woFilter==='all'||(woFilter==='date'?(e.end?state.date>=e.date&&state.date<=e.end:e.date===state.date):!!e.bookable));
  $('#whatson').innerHTML=`<button class="back" id="woClose" type="button">Close</button><p class="kicker">Checked ${prettyDate(today)}</p><h2>What’s on in NYC</h2>
    <div class="filter">${[['date','On '+prettyDate(state.date)],['all','All dates'],['bookable','Plannable']].map(([k,l])=>`<button type="button" class="chip ${woFilter===k?'on':''}" data-f="${k}">${l}</button>`).join('')}</div>
    <div style="margin-top:8px">${items.map(e=>`<div class="ev"><div class="d"><small>${e.end?'Season':d(e.date).toLocaleDateString('en-US',{month:'short'})}</small><b>${e.end?'—':d(e.date).getDate()}</b></div><div><div class="nm">${esc(e.title)}</div><small>${esc(e.venue)} · ${esc(e.end?prettyDate(e.date)+' – '+prettyDate(e.end):e.time)}</small><small><a href="${esc(e.src)}" target="_blank" rel="noopener">source</a>${e.bookable?' · plannable':''}</small></div><div class="p">${esc(e.price)}</div></div>`).join('')||'<p class="hint">Nothing listed for this filter.</p>'}</div>
    <p class="note">Resale prices change daily; face values were not always posted.</p>`;
  $('#woClose').onclick=()=>toggleWhatsOn(false);
  $$('#whatson [data-f]').forEach(b=>b.onclick=()=>{ woFilter=b.dataset.f; renderWhatsOn(); });
}
function toggleWhatsOn(on){ const el=$('#whatson'); on=on??!el.classList.contains('show'); if(on) renderWhatsOn(); el.classList.toggle('show',on); $('#whatsonBtn').classList.toggle('hot',on); }
$('#whatsonBtn').onclick=()=>toggleWhatsOn();

/* ================= loop ================= */
const clock=new THREE.Clock(),tmp=new V3(),tmp2=new V3(),ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2,colA=new THREE.Color(),colB=new THREE.Color(); let fwTimer=0;
function project(v,el,mode){ tmp.copy(v).project(cam); const vis=tmp.z<1&&tmp.x>-1.2&&tmp.x<1.2&&tmp.y>-1.2&&tmp.y<1.2; el.style.transform=`translate(${(tmp.x*.5+.5)*W}px,${(-tmp.y*.5+.5)*H}px) translate(-50%,${mode==='below'?'0':mode==='center'?'-50%':'-100%'})`; return vis; }
function tick(){
  const dt=Math.min(clock.getDelta(),.05),t=clock.elapsedTime,sp=reduce?.3:1;
  updateCam(dt);
  const L=LIGHTS[state.step],k=1-Math.exp(-dt*1.5);
  hemi.color.lerp(colA.set(L.sky),k); hemi.groundColor.lerp(colB.set(L.gr),k); hemi.intensity+=(L.hi-hemi.intensity)*k; sun.intensity+=(L.si-sun.intensity)*k; sun.color.lerp(colB.set(L.sc),k); sun.position.lerp(tmp.set(L.sp[0],L.sp[1],L.sp[2]),k);
  stars.material.opacity+=((state.step===5?.8:0)-stars.material.opacity)*k; dust.material.opacity+=((state.step===5?0:state.step<=3?.5:.22)-dust.material.opacity)*k; dust.rotation.y+=dt*.01*sp;
  personOrbits.visible=state.step<=3; core.userData.pulse*=.92;
  const km=1-Math.exp(-dt*3);
  mapMix+=((state.step===4?1:0)-mapMix)*km; sphereMix+=((state.step===5?1:0)-sphereMix)*km; goldMix+=((state.step<=3?1:0)-goldMix)*(1-Math.exp(-dt*1.6));
  core.visible=sphereMix<.98; { const cs=Math.max(.001,(1-sphereMix)*(1+core.userData.pulse*.04)); core.scale.set(cs,cs*(1+.6*goldMix),cs); } core.position.y=-1.5*sphereMix;
  water.scale.set(1-(1-mapMix)*.25,1-(1-mapMix)*.5,1);
  city.visible=sphereMix>.02; city.scale.setScalar(Math.max(.001,sphereMix*(1+Math.sin(t*1.5)*.006))); city.rotation.y+=dt*.08*sp;
  $('.mapsrc').style.opacity=1-sphereMix; sunGlow.material.opacity=goldMix; dust.material.color.lerp(colA.set(state.step<=3?0xb9783c:0x17171c),k);
  const showLabels=state.step<=3;
  ents.forEach(e=>{
    const o=e.obj,ud=o.userData;
    if(e.mode==='orbit'){ e.orb.ang+=dt*e.orb.sp; o.position.copy(orbitPos(e.orb)); }
    else if(e.mode==='fly'){ e.orb.ang+=dt*e.orb.sp; e.t=Math.min(1,e.t+dt*1.2); o.position.copy(e.from).lerp(orbitPos(e.orb),ease(e.t)); if(e.t>=1) e.mode='orbit'; }
    else if(e.mode==='drag'){ o.position.lerp(e.dragTo,.35); }
    else if(e.mode==='absorbing'){ e.t=Math.min(1,e.t+dt*1.5); const q=ease(e.t); o.position.copy(e.from).multiplyScalar(1-q); o.position.y+=Math.sin(q*Math.PI)*1.0; o.scale.setScalar(PS*(1-q*.92)); ud.spin.rotation.y+=dt*6; if(e.t>=1) onAbsorbed(e); }
    if(e.mode!=='absorbing'&&e.mode!=='absorbed'){ const h=(hovered===o?1:0)+(e.mode==='drag'?1:0); e.hover+=(h-e.hover)*.15; o.scale.setScalar(PS*(1+e.hover*.12)); }
    ud.spin.rotation.y+=dt*.25*sp; if(ud.rider) ud.rider.userData.arm.rotation.z=-.55+Math.sin(t*3.2+ud.rider.userData.ph)*.38;
    ud.moons.forEach(m=>{ const a=t*m.sp*sp+m.ph; m.o.position.set(Math.cos(a)*m.r,Math.sin(a)*m.r*m.tilt,Math.sin(a)*m.r); });
    if(showLabels&&o.visible&&e.mode!=='absorbing'){ tmp2.copy(o.position); tmp2.y+=1.98*o.scale.x; e.label.style.opacity=project(tmp2,e.label)?1:0; } else e.label.style.opacity=0;
  });
  if(preview){
    if(previewDirty&&state.step===2&&!editingId){ previewDirty=false; const g=preview.userData.grow; setPreview(draft); preview.userData.grow=Math.max(.6,g); }
    preview.userData.grow=Math.min(1,preview.userData.grow+dt*2); preview.scale.setScalar(.85*(1-Math.pow(1-preview.userData.grow,3))); preview.position.y=PREVIEW_POS.y+Math.sin(t*1.2)*.1; preview.userData.spin.rotation.y+=dt*.4*sp; if(preview.userData.rider) preview.userData.rider.userData.arm.rotation.z=-.55+Math.sin(t*3.2)*.38;
    preview.userData.moons.forEach(m=>{ const a=t*m.sp*sp+m.ph; m.o.position.set(Math.cos(a)*m.r,Math.sin(a)*m.r*m.tilt,Math.sin(a)*m.r); });
  }
  const night=state.step===5, nk=1-Math.exp(-dt*1.2), M=night?MAPCOL.night:state.step<=3?MAPCOL.gold:MAPCOL.day;
  landMat.color.lerp(colA.set(M.land),nk); bkMat.color.lerp(colA.set(M.bk),nk); parkMat.color.lerp(colA.set(M.park),nk); waterMat.color.lerp(colA.set(M.water),nk);
  bldMat.color.lerp(colA.set(night?0x5d6178:state.step<=3?0xffe4c4:0xffffff),nk); bldMat.emissive.lerp(colA.set(night?0x2b2416:state.step<=3?0x2c1909:0x000000),nk);
  nightMix+=((night?1:0)-nightMix)*nk; cityFx.visible=city.visible&&nightMix>.01; cityFx.scale.copy(city.scale);
  globeMat.color.lerp(colA.set(night?0x111728:0xebe8e2),nk); globeMat.emissiveIntensity=nightMix*2.1; globeMat.roughness=.75+.17*nightMix;
  cityNight.towers.forEach(b=>{ b.m.color.copy(b.base).lerp(colB.set(0x1a2036),nightMix*.86); b.m.emissiveIntensity=nightMix*1.25; });
  halo.material.uniforms.k.value=nightMix*.95; rim.material.uniforms.k.value=nightMix*.75; ringGlow.material.opacity=nightMix*(.3+.08*Math.sin(t*1.4)); outerRing.material.opacity=nightMix*.32;
  crewRing.rotation.z+=dt*.14*sp; cityNight.moons.forEach(m=>m.scale.setScalar(Math.max(.001,nightMix)));
  geoLabels.forEach(g=>{ const v=project(g.p,g.el,'center'); g.el.style.opacity=(v&&state.step===4&&mapMix>.9&&state.selected<0)?1:0; });
  worlds.forEach((w,i)=>{
    const o=w.obj,ud=o.userData;
    const show=state.step===4&&mapMix>.5; o.visible=show;
    if(!show){ w.label.style.opacity=0; ud.pins.forEach(p=>p.label.style.opacity=0); return; }
    const sel=state.selected===i, any=state.step===4&&state.selected>=0, op=sel?1:(any?.12:.85);
    ud.grow=Math.min(1,ud.grow+dt*(sel?.9:.6));
    ud.tubes.forEach((tb,k)=>{ const seg=Math.min(1,Math.max(0,ud.grow*ud.tubes.length-k)); tb.geometry.setDrawRange(0,Math.floor(tb.geometry.index.count*seg/6)*6); });
    ud.mats.forEach(m=>{ m.transparent=true; m.opacity+=(op-m.opacity)*.15; });
    ud.pins.forEach((p,k)=>{ const s=(sel?1.25:1)*(hovered===p.head?1.5:1); p.head.scale.setScalar(p.head.scale.x+(s-p.head.scale.x)*.2); p.ring.scale.setScalar(1+.3*Math.sin(t*2+k));
      tmp2.copy(p.obj.position); tmp2.y=1.0; const v=project(tmp2,p.label); p.label.style.opacity=(sel&&v)?1:0; });
    tmp2.copy(ud.center); tmp2.y=1.25+i*.38; const vis=project(tmp2,w.label); w.label.style.opacity=(state.step===4&&state.selected<0&&vis)?1:0;
  });
  sparks.update(dt,5); glow.update(dt,1.8);
  if(state.step===5&&state.booked&&!reduce){ fwTimer-=dt; if(fwTimer<=0){ fwTimer=rand(.9,1.6); glow.emit(new V3(rand(-9,9),rand(1,6),rand(-12,-5)),['#ffffff','#f3d7a6','#e2552d'],120,rand(3.5,5.5)); } }
  renderer.render(scene,cam); requestAnimationFrame(tick);
}

/* ================= boot ================= */
(async function boot(){
  newDraft();
  { const q0=new URLSearchParams(location.search); intro=!/^\/p\//.test(location.pathname)&&!q0.has('start')&&!q0.has('checkout'); }
  goStep(1);
  renderToday();
  try{ state.health=await api('GET','/health'); }catch(e){ state.health={}; }
  if(state.health.store==='none') toast('Storage isn’t configured on this deployment yet. See the README.');
  const q=new URLSearchParams(location.search);
  if(q.get('checkout')==='success'&&q.get('session_id')){
    try{ const r=await api('GET','/checkout/verify?token='+TOKEN+'&session_id='+encodeURIComponent(q.get('session_id'))); if(r.pass) toast('Event Pass added: this plan now has the AI organizer and room for 12 (Stripe test mode).'); else if(r.plus) toast(`${TIER_NAME[r.tier]||'Plus'} is unlocked (Stripe test mode). Thank you!`); }catch(e){ toast(e.message); }
  } else if(q.get('checkout')==='cancelled') toast('Checkout cancelled. Nothing was charged.');
  await refreshMe();
  const m=location.pathname.match(/^\/p\/([a-z0-9]+)/);
  if(m){
    try{
      const r=await api('GET','/plans/'+m[1]+'?token='+TOKEN);
      history.replaceState({},'','/p/'+m[1]);
      applyPlan(r.plan); state.maxStep=Math.max(state.maxStep,2); newDraft();
      if(!state.lockedOpt) goStep(2);
      if(!r.plan.meId) toast(`You’re invited to “${r.plan.name}”. Make your planet to join.`);
    }catch(e){ toast(e.message); history.replaceState({},'','/'); }
  }
})();
(function(){
  setView(); Object.assign(rig,{theta:want.theta,phi:want.phi,r:want.r+6,shift:want.shift}); rig.target.copy(want.target);
  tick();
})();
})();
