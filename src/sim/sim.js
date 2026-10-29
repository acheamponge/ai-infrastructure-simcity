import { LAND } from "./land";
import { initSite3D } from "./site3d";
import { REGIONS } from "./regions";

// Ported from the AI Infrastructure SimCity proof of concept. Plain JS by design: the sim is a game loop over DOM ids inside .simroot.
export function startSim(opts = {}) {

// ---------- world data (illustrative, seeded from public-ish figures, then it drifts) ----------
// power $/kWh · carbon gCO2/kWh · labor = hireable trades · wage $/h · land = cost index · sent = baseline sentiment 0-100
// gridLead = months to interconnect · gridRel = reliability · headroom = spare MW before prices climb
const ENERGY={
 grid:{name:'Grid connection',capex:r=>1.5,lead:r=>r.gridLead,opex:r=>r.power,carbon:r=>r.carbon,cap:r=>r.gridRel>0.85?0.95:0.8,note:'Cheapest to build, slowest to connect. Carbon and reliability follow the local grid.'},
 gas:{name:'On-site gas turbines',capex:r=>1.3,lead:r=>10,opex:r=>0.048,carbon:r=>420,cap:r=>0.95,note:'Fast, firm, and fossil. Sentiment takes a hit every month it runs.'},
 solar:{name:'Solar + storage',capex:r=>4.0,lead:r=>9,opex:r=>0.014,carbon:r=>25,cap:r=>0.5+0.25*r.solar,note:'Cheap to run, costly to build, and utilization is capped by the sun.'},
 wind:{name:'Wind + storage',capex:r=>3.4,lead:r=>10,opex:r=>0.018,carbon:r=>12,cap:r=>0.5+0.3*r.wind,note:'Great in windy regions, weak elsewhere. Check the capacity cap.'},
 smr:{name:'Small modular reactor',capex:r=>9,lead:r=>34,opex:r=>0.03,carbon:r=>10,cap:r=>0.97,note:'Near-zero carbon and very firm, but three years before the first electron.'},
 geo:{name:'Geothermal',capex:r=>r.geo?5:12,lead:r=>r.geo?14:26,opex:r=>0.024,carbon:r=>40,cap:r=>0.95,note:'Excellent where the ground is hot. Ruinous where it is not.'},
 flare:{name:'Flared gas capture',capex:r=>1.0,lead:r=>6,opex:r=>0.012,carbon:r=>380,cap:r=>0.88,note:'Burns gas that was being flared anyway. Only works in producing basins.'},
};
// form: hgx = 8-GPU HGX nodes in a standard rack · nvl = rack-scale NVL72 (18 compute trays + 9 NVLink switch trays, liquid only)
const GPUS={
 h100:{name:'H100',w:700,cost:25000,perf:1,rate:2.0,form:'hgx',node:'HGX H100',hbm:'80 GB HBM3',u:6},
 h200:{name:'H200',w:700,cost:30000,perf:1.35,rate:2.4,form:'hgx',node:'HGX H200',hbm:'141 GB HBM3e',u:6},
 b200:{name:'B200',w:1000,cost:38000,perf:2.2,rate:3.2,form:'hgx',node:'HGX B200',hbm:'180 GB HBM3e',u:10},
 gb200:{name:'GB200',w:1200,cost:45000,perf:2.8,rate:3.8,form:'nvl',node:'GB200 NVL72',hbm:'186 GB HBM3e'},
 gb300:{name:'GB300',w:1400,cost:55000,perf:3.5,rate:4.5,form:'nvl',node:'GB300 NVL72',hbm:'288 GB HBM3e'},
 next:{name:'Rubin (unlocks 2028)',w:1800,cost:75000,perf:5.5,rate:6.5,locked:true,form:'nvl',node:'Rubin NVL144',hbm:'288 GB HBM4'},
};
// GPUs per rack: HGX nodes fill the power budget; NVL racks ship as 72 (full), 36 (half) or an air-cooled 16-GPU partial
function perRackFor(k,dens){const G=GPUS[k];if(G.form==='nvl')return dens>=130?72:dens>=80?36:16;return Math.floor(dens*1000*0.7/G.w)}
const DENS={40:{cool:'air',pue:1.45},80:{cool:'liquid',pue:1.18},130:{cool:'liquid',pue:1.12}};
// ---------- incidents: things that go wrong in a live hall, and how they are fixed ----------
// Each kind has a place (row, rack, feeder, roof), a monthly economic effect while open, repair steps the crew works
// through, a real-time repair duration when the site is on screen, and a sim-month duration when it is not.
const INCIDENTS={
 leak:{name:'Coolant leak',where:'row',repairSec:32,months:2,cost:85000,
  desc:'A manifold quick-disconnect is weeping under the row. The row is powered down until the leak is isolated and the floor is dry.',
  steps:['Isolate the row manifold valves','Pump out and dry the floor','Replace the quick-disconnect','Pressure-test and re-energize the row']},
 rack:{name:'Server failure',where:'rack',repairSec:20,months:1,cost:45000,
  desc:'A node dropped off the fabric: a failed power supply or a GPU fault. The rack runs degraded until the part is swapped.',
  steps:['Read the BMC fault log','Pull the failed node','Swap the power supply and GPU module','Re-seat and rejoin the fabric']},
 power:{name:'Utility power loss',where:'site',repairSec:48,months:1,cost:0,
  desc:'The utility feeder tripped. UPS batteries carry the IT load while the generators start; the site burns diesel until the feed is restored.',
  steps:['UPS carrying the load','Generators started and synced','Utility crew on the feeder','Feed restored, generators back to standby']},
 chiller:{name:'Chiller failure',where:'roof',repairSec:36,months:2,cost:120000,
  desc:'A rooftop chiller tripped. Supply water warms and the racks throttle until it is reset.',
  steps:['Confirm the trip and isolate the unit','Swap the failed compressor contactor','Restart and pull supply water back to setpoint','Lift the throttle']},
};
const layoutOf=racks=>{const cols=Math.min(40,Math.ceil(Math.sqrt(racks*2.2)));return {cols,rows:Math.ceil(racks/cols)}};
function spawnIncident(f,kind,auto){
  if(f.status!=='live')return null;
  f.incidents=f.incidents||[];
  if(f.incidents.some(i=>i.kind===kind))return null;
  const I=INCIDENTS[kind],lay=layoutOf(f.cfg.racks);
  const inc={id:++S.incSeq,kind,start:S.month,progress:0,dispatched:false,row:Math.floor(Math.random()*lay.rows),rack:Math.floor(Math.random()*f.cfg.racks),auto:!!auto};
  f.incidents.push(inc);
  log(`${f.name}: ${I.name.toLowerCase()}${auto?'':' (simulated)'}. ${I.desc}`,'bad');
  renderSites();return inc;
}
function dispatchIncident(f,inc){if(inc.dispatched)return;inc.dispatched=true;log(`${f.name}: crew dispatched for the ${INCIDENTS[inc.kind].name.toLowerCase()}. ${INCIDENTS[inc.kind].steps.join(' → ')}.`,'ev')}
function resolveIncident(f,inc){
  const I=INCIDENTS[inc.kind];inc.progress=1;
  f.repairDue=(f.repairDue||0)+I.cost;
  f.incidents=(f.incidents||[]).filter(i=>i!==inc);
  log(`${f.name}: ${I.name.toLowerCase()} fixed after ${Math.max(1,S.month-inc.start)} month(s)${I.cost?` · ${fmtM(I.cost)} in parts and labor`:''}.`,'good');
  renderSites();
}
// monthly effect of open incidents: revenue multiplier, extra operating cost, extra CO₂
function incidentEffects(f){
  let rev=1,opex=0,co2=0;const lay=layoutOf(f.cfg.racks);
  for(const inc of f.incidents||[]){
    if(inc.kind==='leak')rev*=1-Math.min(1,lay.cols/f.cfg.racks);
    else if(inc.kind==='rack')rev*=1-1/f.cfg.racks;
    else if(inc.kind==='power'){const kwh=f.plan.facMW*1000*720;opex+=kwh*0.22;co2+=kwh*0.0007;rev*=0.97}
    else if(inc.kind==='chiller')rev*=0.7;
  }
  return {rev,opex,co2};
}
// site crews respond on their own after a month; repairs then progress by month unless the 3D view is driving them in real time
function stepIncidents(f){
  for(const inc of [...(f.incidents||[])]){
    if(!inc.dispatched&&S.month-inc.start>=1)dispatchIncident(f,inc);
    if(inc.dispatched&&!inc.viewed)inc.progress=Math.min(1,inc.progress+1/INCIDENTS[inc.kind].months);
    if(inc.progress>=1)resolveIncident(f,inc);
  }
}

const PHASES=[['permit','Permitting'],['civil','Civil & grading'],['inter','Power interconnect'],['shell','Building shell'],['mep','Mechanical & electrical'],['racks','Racks & GPUs'],['comm','Commissioning']];
// Portfolio preview: there is no wallet. Capital is counted as it is deployed and cash flow is reported, never gated.

// ---------- state ----------
let S;
function freshState(){
  return {
    month:0, cash:0, capital:0, opexTotal:0, speed:1, running:false, stress:false, overlay:'power', incSeq:0,
    sel:'txp', facilities:[], nextId:1, log:[], priceIndex:1, demand:1, co2:0, computeTotal:0, revenueTotal:0,
    regions:[...REGIONS,...(opts.realSites||[])].map(r=>({...r, base:r.sent, pros:0, laborUsed:0, moratorium:0, heat:0, builtMW:0, basePower:r.power})),
    cfg:{energy:'grid',gpu:'b200',gpuMix:{h100:0,h200:0,b200:100,gb200:0,gb300:0,next:0},dens:80,racks:500,crew:600,robots:0},
    unlockedNext:false, viewFac:null,
  };
}
const R=id=>S.regions.find(r=>r.id===id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmtM=x=>{const a=Math.abs(x),s=x<0?'-':'';if(a>=1e9)return s+'$'+(a/1e9).toFixed(2)+'B';if(a>=1e6)return s+'$'+(a/1e6).toFixed(a>=1e8?0:1)+'M';if(a>=1e3)return s+'$'+(a/1e3).toFixed(0)+'k';return s+'$'+a.toFixed(0)};
const fmtN=x=>x.toLocaleString('en-US',{maximumFractionDigits:0});
const monthName=m=>{const d=new Date(2027,m,1);return d.toLocaleString('en-US',{month:'short'})+' '+d.getFullYear()};

// ---------- the model ----------
function makePlan(cfg,r){
  const E=ENERGY[cfg.energy],D=DENS[cfg.dens];
  // GPU fleet: shares of rack count per type; rows are contiguous blocks in share order
  const shares=gpuShares(cfg);
  const types=Object.keys(shares);
  const rackGpu=[];{let acc=0;const cum=types.map(k=>[k,(acc+=shares[k])]);for(let i=0;i<cfg.racks;i++){const u=(i+0.5)/cfg.racks;rackGpu.push((cum.find(([,c])=>u<=c)||cum[cum.length-1])[0])}}
  const perRack=k=>perRackFor(k,cfg.dens);
  const gpus=rackGpu.reduce((a,k)=>a+perRack(k),0);
  const gpusPerRack=Math.round(gpus/Math.max(1,cfg.racks));
  const G={name:types.map(k=>`${Math.round(shares[k]*100)}% ${GPUS[k].name.replace(/ \(.*\)/,'')}`).join(' · '),
    rate:rackGpu.reduce((a,k)=>a+perRack(k)*GPUS[k].rate,0)/Math.max(1,gpus),
    perf:rackGpu.reduce((a,k)=>a+perRack(k)*GPUS[k].perf,0)/Math.max(1,gpus)};
  const itMW=cfg.racks*cfg.dens/1000;
  let pue=D.pue+(r.climate==='hot'?0.15:r.climate==='cold'?-0.07:0);
  const facMW=itMW*pue;
  const robots=cfg.robots/100;
  const peopleWanted=Math.round(cfg.crew*(1-robots));
  const laborAvail=Math.max(0,r.labor-r.laborUsed);
  const people=Math.min(peopleWanted,laborAvail);
  const laborShort=peopleWanted>laborAvail;
  const effCrew=people+cfg.crew*robots;
  const speed=clamp(Math.sqrt(effCrew/600),0.45,1.9)*(1+0.5*robots);
  const laborPolitics=r.wage>30;
  const dur={
    permit:clamp(3+(75-r.sent)/8,2,14)+(robots>0.6&&laborPolitics?2:0),
    civil:(3*(1+facMW/400))/speed,
    inter:E.lead(r),
    shell:(5+facMW/25)/speed,
    mep:(5+facMW/20)/speed,
    racks:(1.5+cfg.racks/350)/speed,
    comm:1.5,
  };
  for(const k in dur)dur[k]=Math.round(dur[k]*2)/2;
  const cost={
    permit:facMW*0.25e6*r.land+cfg.crew*robots*150000,  // land + robot fleet mobilization
    civil:facMW*1.2e6,
    inter:facMW*E.capex(r)*1e6,
    shell:facMW*3.5e6,
    mep:facMW*5.5e6,
    racks:rackGpu.reduce((a,k)=>a+25000+(D.cool==='liquid'?15000:0)+perRack(k)*GPUS[k].cost,0),
    comm:facMW*0.2e6,
  };
  const capex=Object.values(cost).reduce((a,b)=>a+b,0);
  const laborMo=people*r.wage*170*(laborShort?1.15:1)+cfg.crew*robots*2500;
  const sched=schedule(dur);
  const months=sched.comm.e;
  const buildLabor=laborMo*months;
  // operations
  const util=E.cap(r)*0.92*(cfg.energy==='grid'&&r.gridRel<0.85?0.9:1);
  const mwh=facMW*720*(0.5+0.5*util);
  const revMo=gpus*720*util*G.rate*S.priceIndex;
  const powerMo=mwh*1000*E.opex(r);
  const jobsBuild=people;
  const jobsPerm=Math.round((12+cfg.racks/12)*(1-0.65*robots));
  const staffMo=jobsPerm*r.wage*170*1.4;
  const maintMo=cost.racks*0.012/12+(cfg.crew*robots>0?cfg.crew*robots*800:0);
  const opexMo=powerMo+staffMo+maintMo;
  const co2Mo=mwh*E.carbon(r)/1000;
  const econ=r.labor*r.wage*170*4;
  const prosBuildMo=(jobsBuild*r.wage*170*1.6)/econ*30;
  const prosOpMo=(jobsPerm*r.wage*170*1.6+revMo*0.03)/econ*30;
  const waterPain=r.water==='high'&&D.cool==='air';
  const sentBuildMo=0.5*(1-robots)-0.8*robots*(laborPolitics?1:0.5)-(waterPain?0.4:0)-(cfg.energy==='gas'?0.25:0)+(['solar','wind','geo','smr'].includes(cfg.energy)?0.2:0);
  const sentOpMo=0.15*(1-robots)+0.1-(cfg.energy==='gas'?0.2:0)-(waterPain?0.3:0);
  return {gpusPerRack,gpus,rackGpu,gpuShares:shares,gpuLabel:G.name,itMW,facMW,pue,people,laborShort,dur,cost,capex,laborMo,months,buildLabor,util,revMo,powerMo,staffMo,maintMo,opexMo,co2Mo,jobsBuild,jobsPerm,prosBuildMo,prosOpMo,sentBuildMo,sentOpMo,waterPain,perf:gpus*G.perf/1000,sched};
}
function schedule(d){
  const s={};
  s.permit={s:0,e:d.permit};
  s.civil={s:s.permit.e,e:s.permit.e+d.civil};
  s.inter={s:s.permit.e,e:s.permit.e+d.inter};
  s.shell={s:s.civil.e,e:s.civil.e+d.shell};
  s.mep={s:s.shell.e,e:s.shell.e+d.mep};
  s.racks={s:s.mep.e,e:s.mep.e+d.racks};
  const start=Math.max(s.racks.e,s.inter.e);
  s.comm={s:start,e:start+d.comm};
  s.critical=s.inter.e>s.racks.e?'inter':'racks';
  return s;
}

function breakGround(){
  const r=R(S.sel),cfg={...S.cfg};
  if(r.moratorium>0){log(`${r.name} has a moratorium on new sites for ${r.moratorium} more months.`,'bad');return}
  const p=makePlan(cfg,r);
  const f={id:S.nextId++,name:`${r.name} ${['Alpha','Beta','Gamma','Delta','Epsilon','Zeta'][(S.nextId-2)%6]}`,regionId:r.id,cfg,plan:p,dur:{...p.dur},paid:{},start:S.month,status:'building',liveMonth:null,rev:0,comp:0,heatMonths:0,delayNotes:[]};
  S.facilities.push(f);
  r.laborUsed+=p.people;
  r.builtMW+=p.facMW;
  r.power=r.basePower*(1+0.3*r.builtMW/r.headroom);
  r.land*=1+0.12*p.facMW/100;
  S.viewFac=f.id;
  log(`Broke ground on ${f.name}: ${p.facMW.toFixed(0)} MW, ${fmtN(p.gpus)} GPUs (${p.gpuLabel}). Target go-live ${monthName(S.month+p.months)}.`,'ev');
  render();
  diveTo(f.id);
}

function tick(){
  if(stopped||!$('s-date'))return;
  S.month++;
  let net=0;
  for(const f of S.facilities){
    const r=R(f.regionId);
    if(f.status==='building'){
      const t=S.month-f.start;
      const sch=schedule(f.dur);
      for(const [k] of PHASES){
        const prog=clamp((t-sch[k].s)/f.dur[k],0,1);
        const due=f.plan.cost[k]*prog-(f.paid[k]||0);
        if(due>0){S.capital+=due;net-=due;f.paid[k]=(f.paid[k]||0)+due}
      }
      S.capital+=f.plan.laborMo;net-=f.plan.laborMo;f.spent=(f.spent||0)+f.plan.laborMo;
      r.pros+=f.plan.prosBuildMo;f.pros=(f.pros||0)+f.plan.prosBuildMo;
      r.sent=clamp(r.sent+f.plan.sentBuildMo,0,100);
      if(t>=sch.comm.e){
        f.status='live';f.liveMonth=S.month;
        r.laborUsed=Math.max(0,r.laborUsed-f.plan.people);
        log(`${f.name} is live. ${fmtN(f.plan.gpus)} GPUs energized, ${f.plan.jobsPerm} permanent jobs.`,'good');
      }
    } else {
      const p=f.plan,E=ENERGY[f.cfg.energy];
      let rev=p.revMo*S.priceIndex*S.demand;
      let opex=p.opexMo;
      if(r.heat>0&&r.climate==='hot'){opex+=p.powerMo*0.18}
      if(S.stress){
        if(f.cfg.energy==='grid'&&Math.random()>r.gridRel+0.02&&!spawnIncident(f,'power',true)){rev*=0.5;log(`Grid outage in ${r.name}: ${f.name} ran at half for the month.`,'bad')}
        if(Math.random()<0.03)spawnIncident(f,'rack',true);
        if(f.cfg.dens>=80&&Math.random()<0.012)spawnIncident(f,'leak',true);
        if(r.heat>0&&Math.random()<0.06)spawnIncident(f,'chiller',true);
      }
      stepIncidents(f);
      const fx=incidentEffects(f);rev*=fx.rev;opex+=fx.opex+(f.repairDue||0);f.repairDue=0;
      S.opexTotal+=opex;net+=rev-opex;
      f.rev+=rev;f.comp+=p.perf*fx.rev;S.computeTotal+=p.perf*fx.rev;S.revenueTotal+=rev;S.co2+=p.co2Mo+fx.co2;f.co2=(f.co2||0)+p.co2Mo+fx.co2;f.pros=(f.pros||0)+p.prosOpMo;
      r.pros+=p.prosOpMo;
      r.sent=clamp(r.sent+p.sentOpMo,0,100);
    }
  }
  S.lastNet=net;S.cash+=net;
  for(const r of S.regions){
    r.sent+=(r.base-r.sent)*0.03;
    if(r.moratorium>0)r.moratorium--;
    if(r.heat>0)r.heat--;
    r.pros*=0.995;
  }
  S.priceIndex*=0.991;
  S.demand=1+0.012*S.month;
  if(S.month===12&&!S.unlockedNext){S.unlockedNext=true;GPUS.next.locked=false;GPUS.next.name='Rubin';for(const k in GPUS)if(k!=='next')GPUS[k].cost*=0.8;log('A new GPU generation shipped. Older parts are 20% cheaper; Rubin NVL144 is now orderable.','ev');fillSelects()}
  if(S.stress)events();
  render();
}
function events(){
  if(Math.random()>0.14)return;
  const roll=Math.random();
  const building=S.facilities.filter(f=>f.status==='building');
  const live=S.facilities.filter(f=>f.status==='live');
  const pick=a=>a[Math.floor(Math.random()*a.length)];
  if(roll<0.18){
    const hot=S.regions.filter(r=>r.climate==='hot');const r=pick(hot);r.heat=3;
    log(`Heat wave over ${r.name}. Cooling costs up for three months.`,'bad');
  } else if(roll<0.34&&building.length){
    const f=pick(building.filter(f=>f.cfg.energy==='grid')||[])||pick(building);
    if(f){const k=f.cfg.energy==='grid'?'inter':'shell';f.dur[k]+=3;f.delayNotes.push(k);log(`${f.name}: ${k==='inter'?'interconnect queue slipped':'steel delivery delayed'} by 3 months.`,'bad')}
  } else if(roll<0.48&&building.length){
    {const f=pick(building);f.dur.mep=Math.max(1,f.dur.mep-1);log(`${f.name}: electrical crews ahead of schedule, a month saved.`,'good')}
  } else if(roll<0.6){
    const r=pick(S.regions.filter(r=>r.sent>50));r.sent=clamp(r.sent+10,0,100);r.base+=3;
    log(`${r.name} passes a data center incentive package. Sentiment up.`,'good');
  } else if(roll<0.72){
    const cands=S.regions.filter(r=>r.sent<38&&r.moratorium===0);
    if(cands.length){const r=pick(cands);r.moratorium=12;log(`${r.name} declares a 12-month moratorium on new data centers.`,'bad')}
    else {S.demand*=1.08;log('AI demand surge: GPU-hour prices up 8%.','good')}
  } else if(roll<0.85){
    const r=pick(S.regions.filter(r=>r.power<0.07));r.basePower*=1.1;r.power*=1.1;r.land*=1.15;
    log(`A competitor broke ground in ${r.name}. Power and land there got pricier.`,'ev');
  } else if(live.length){
    const f=pick(live);const r=R(f.regionId);r.pros+=4;r.sent=clamp(r.sent+4,0,100);
    log(`${f.name} funds a trade school and district heating loop in ${r.name}. Prosperity up.`,'good');
  } else {
    S.priceIndex*=0.95;log('Hyperscaler price war: GPU-hour rates fall 5%.','bad');
  }
}

// ---------- portfolio totals ----------
function facilitySpent(f){const t=S.month-f.start,total=schedule(f.dur).comm.e;return Object.values(f.paid).reduce((a,b)=>a+b,0)+f.plan.laborMo*Math.min(Math.max(0,t),total)}

// ---------- rendering ----------
const $=id=>document.getElementById(id);
function log(msg,cls){S.log.unshift({m:S.month,msg,cls});if(S.log.length>60)S.log.length=60;renderLog()}
function renderLog(){$('log').innerHTML=S.log.map(l=>`<div class="${l.cls||''}"><b>${monthName(l.m)}</b><span>${l.msg}</span></div>`).join('')}
function gpuShares(cfg){const m=cfg.gpuMix||{[cfg.gpu||'b200']:100};const out={};let t=0;for(const k of Object.keys(GPUS)){const v=GPUS[k].locked?0:Math.max(0,Number(m[k]||0));if(v>0){out[k]=v;t+=v}}if(t<=0){out.b200=1;t=1}for(const k in out)out[k]/=t;return out}
function fillSelects(){
  const e=$('energy');const ev=e.value||S.cfg.energy;
  e.innerHTML=Object.entries(ENERGY).map(([k,v])=>`<option value="${k}">${v.name}</option>`).join('');
  e.value=ev;
  const nx=$('gm-next');if(nx){nx.disabled=!!GPUS.next.locked;$('gm-next-note').textContent=GPUS.next.locked?'locked until 2028':'available'}
}
function readCfg(){
  const gm={};for(const k in GPUS)gm[k]=+$('gm-'+k).value;
  const sh=gpuShares({gpuMix:gm});const dominant=Object.keys(sh).sort((a,b)=>sh[b]-sh[a])[0];
  S.cfg={energy:$('energy').value,gpu:dominant,gpuMix:gm,dens:+$('dens').value,racks:+$('racks').value,crew:+$('crew').value,robots:0};
  $('gpuOut').value=Object.keys(sh).map(k=>`${Math.round(sh[k]*100)}% ${GPUS[k].name.replace(/ \(.*\)/,'')}`).join(' · ');
  $('racksOut').value=S.cfg.racks;$('crewOut').value=S.cfg.crew;
  $('energyNote').textContent=ENERGY[S.cfg.energy].note;
}
function render(){
  $('s-date').textContent=monthName(S.month);
  $('s-cap').textContent=fmtM(S.capital);
  const n=$('s-net');n.textContent=(S.lastNet>=0?'+':'')+fmtM(S.lastNet||0);n.classList.toggle('neg',(S.lastNet||0)<0);
  $('s-comp').textContent=S.facilities.filter(f=>f.status==='live').reduce((a,f)=>a+f.plan.perf,0).toFixed(1)+' PF';
  $('s-sites').textContent=S.facilities.filter(f=>f.status==='building').length+' / '+S.facilities.filter(f=>f.status==='live').length;
  $('play').textContent=S.running?'❚❚ Pause':'▶ Play';
  renderPlan();renderSites();renderPortfolio();drawMap();
}
function renderPlan(){
  const r=R(S.sel);readCfg();
  const p=makePlan(S.cfg,r);
  const cls=(v,good,bad)=>v<=good?'good':v>=bad?'bad':'warn';
  $('regionCard').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><h3>${r.name}</h3><span class="note">${r.country}${r.real?` · <a href="/sites/${r.siteId}" style="color:var(--accent)">open dossier</a>`:''}</span></div>
    <div class="chips">${r.real?`<span class="pill live">tracked site · ${r.operator||'operator unknown'}${r.phases>1?` · phase 1 of ${r.phases}`:''}</span>`:''}<span class="pill ${r.climate}">${r.climate}</span><span class="pill">water ${r.water}</span>${r.geo?'<span class="pill">geothermal</span>':''}${r.flare?'<span class="pill">gas basin</span>':''}${r.moratorium?`<span class="pill block">moratorium ${r.moratorium} mo</span>`:''}${r.heat?'<span class="pill hot">heat wave</span>':''}</div>
    <div class="kv">
      <span>Power</span><span class="${cls(r.power,0.05,0.12)}">$${r.power.toFixed(3)}/kWh</span>
      <span>Grid carbon</span><span class="${cls(r.carbon,100,400)}">${r.carbon} g/kWh</span>
      <span>Grid interconnect</span><span class="${cls(r.gridLead,12,24)}">${r.gridLead} mo</span>
      <span>Hireable trades</span><span>${fmtN(r.labor-r.laborUsed)} @ $${r.wage}/h</span>
      <span>Land index</span><span class="${cls(r.land,1,2.5)}">${r.land.toFixed(2)}×</span>
      <span>Sentiment</span><span class="${r.sent>=60?'good':r.sent<40?'bad':'warn'}">${r.sent.toFixed(0)} / 100</span>
      <span>Prosperity gained</span><span class="${r.pros>0?'good':''}">${r.pros>0?'+':''}${r.pros.toFixed(1)}</span>
    </div>`;
  const crit=p.sched.critical==='inter'?'power interconnect':'rack delivery';
  const payback=p.revMo-p.opexMo>0?(p.capex/(p.revMo-p.opexMo)/12).toFixed(1)+' yrs':'never';
  const warns=[];
  if(p.laborShort)warns.push(`<div class="warnbox">Only ${fmtN(p.people)} trades available of the ${fmtN(Math.round(S.cfg.crew*(1-S.cfg.robots/100)))} you want. Timeline slips and wages jump 15%. Shrink the crew or pick a region with a deeper labor pool.</div>`);
  if(p.waterPain)warns.push('<div class="warnbox">Air cooling in a water-stressed region. Sentiment will erode every month.</div>');
  if(S.cfg.energy==='geo'&&!r.geo)warns.push('<div class="warnbox">No geothermal resource here. You would be drilling very deep for very little.</div>');
  if(S.cfg.energy==='flare'&&!r.flare)warns.push('<div class="critbox">Nothing to capture: there are no flaring wells near this region.</div>');
  if(r.moratorium)warns.push(`<div class="critbox">Moratorium in force for ${r.moratorium} more months.</div>`);
  $('projection').innerHTML=`
    <h2>Projection</h2>
    <div class="kv">
      <span>Facility</span><span>${p.itMW.toFixed(0)} MW IT · ${p.facMW.toFixed(0)} MW total</span>
      <span>GPUs</span><span>${fmtN(p.gpus)} · ${p.perf.toFixed(1)} PF</span>
      <span>PUE</span><span>${p.pue.toFixed(2)}</span>
      <span>Build cost</span><span>${fmtM(p.capex)}</span>
      <span>Construction labor</span><span>${fmtM(p.buildLabor)}</span>
      <span>Time to live</span><span class="${p.months<=18?'good':p.months>=36?'bad':'warn'}">${p.months} mo · gated by ${crit}</span>
      <span>Revenue / mo</span><span class="good">${fmtM(p.revMo)}</span>
      <span>Opex / mo</span><span>${fmtM(p.opexMo)}</span>
      <span>Payback</span><span>${payback}</span>
      <span>CO₂ / mo</span><span class="${cls(p.co2Mo,2000,15000)}">${fmtN(p.co2Mo)} t</span>
      <span>Jobs: build / permanent</span><span>${fmtN(p.jobsBuild)} / ${p.jobsPerm}</span>
      <span>Prosperity / yr live</span><span class="good">+${(p.prosOpMo*12).toFixed(1)}</span>
      <span>Sentiment / mo build</span><span class="${p.sentBuildMo>=0?'good':'bad'}">${p.sentBuildMo>=0?'+':''}${p.sentBuildMo.toFixed(2)}</span>
    </div>${warns.join('')}`;
  const bg=$('breakGround');
  bg.disabled=r.moratorium>0||(S.cfg.energy==='flare'&&!r.flare);
  bg.textContent=`Start construction · ${fmtM(p.capex)}`;
}
function renderSites(){
  const chips=$('siteChips');
  $('openSite').disabled=!S.facilities.length;
  if(!S.facilities.length){chips.innerHTML='<span class="note">No sites yet. Pick a region on the globe, set a spec, and break ground.</span>';$('siteCard').innerHTML='';$('gantt').innerHTML='';return}
  if(!S.facilities.find(f=>f.id===S.viewFac))S.viewFac=S.facilities[0].id;
  chips.innerHTML=S.facilities.map(f=>`<button data-fac="${f.id}" class="${f.id===S.viewFac?'on':''}">${f.name}</button>`).join('');
  const f=S.facilities.find(f=>f.id===S.viewFac),r=R(f.regionId),p=f.plan,t=S.month-f.start,sch=schedule(f.dur);
  const total=sch.comm.e;
  $('siteCard').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><h3>${f.name}</h3><span class="pill ${f.status}">${f.status==='live'?'live since '+monthName(f.liveMonth):'building · month '+Math.min(t,total)+' of '+total}</span></div>
    <div class="kv">
      <span>Spec</span><span>${p.facMW.toFixed(0)} MW · ${fmtN(p.gpus)} GPUs · ${p.gpuLabel} · ${ENERGY[f.cfg.energy].name}</span>
      <span>Construction crew</span><span>${fmtN(p.people)} trades</span>
      <span>Incidents</span><span class="${(f.incidents||[]).length?'bad':''}">${(f.incidents||[]).length?f.incidents.map(i=>INCIDENTS[i.kind].name+(i.dispatched?' (crew on it)':'')).join(', '):'none'}</span>
      <span>Spent so far</span><span>${fmtM(Object.values(f.paid).reduce((a,b)=>a+b,0)+p.laborMo*Math.min(t,total))}</span>
      <span>Revenue to date</span><span class="good">${fmtM(f.rev)}</span>
      <span>Compute delivered</span><span>${f.comp.toFixed(0)} PF-months</span>
      <span>Prosperity contributed</span><span class="good">+${(f.pros||0).toFixed(1)}</span>
      <span>CO₂ to date</span><span>${fmtN(f.co2||0)} t</span>
    </div>`;
  $('gantt').innerHTML=PHASES.map(([k,name])=>{
    const s=sch[k];const prog=clamp((t-s.s)/f.dur[k],0,1);
    return `<div class="row ${sch.critical===k||k==='comm'?'crit':''}"><span>${name}${f.delayNotes.includes(k)?' ⚠':''}</span><div class="track"><div class="bar" style="left:${s.s/total*100}%;width:${f.dur[k]/total*100}%"></div><div class="fill ${prog>=1?'done':''}" style="left:${s.s/total*100}%;width:${f.dur[k]*prog/total*100}%"></div></div><span>${f.dur[k]} mo</span></div>`;
  }).join('');
  $('openSite').textContent=V.mode==='site'&&T&&T.fid===f.id?'Viewing this site':'Open 3D site view';
}
function renderPortfolio(){
  const live=S.facilities.filter(f=>f.status==='live'),building=S.facilities.filter(f=>f.status==='building');
  const pros=S.regions.reduce((a,r)=>a+r.pros,0);
  $('pfTotals').innerHTML=`<div class="kv">
    <span>Capital deployed</span><span>${fmtM(S.capital)}</span>
    <span>Revenue to date</span><span class="good">${fmtM(S.revenueTotal)}</span>
    <span>Operating cost to date</span><span>${fmtM(S.opexTotal)}</span>
    <span>Net cash flow to date</span><span class="${S.cash>=0?'good':'bad'}">${fmtM(S.cash)}</span>
    <span>Compute delivered</span><span>${fmtN(S.computeTotal)} PF-months</span>
    <span>Sites building / live</span><span>${building.length} / ${live.length}</span>
    <span>Regional prosperity now</span><span class="good">+${pros.toFixed(1)}</span>
    <span>CO₂ to date</span><span class="${S.co2>1e6?'bad':S.co2>2e5?'warn':''}">${fmtN(S.co2)} t</span>
  </div>`;
  $('pfTable').innerHTML=S.facilities.length?`<table class="table"><thead><tr><th>Site</th><th>Status</th><th class="r">Spent</th><th class="r">Revenue</th><th class="r">PF-mo</th><th class="r">Prosp. added</th><th class="r">CO₂ t</th></tr></thead><tbody>`+
    S.facilities.map(f=>`<tr><td>${f.name}</td><td><span class="pill ${f.status}">${f.status==='live'?'live':'building'}</span></td><td class="r">${fmtM(facilitySpent(f))}</td><td class="r">${fmtM(f.rev)}</td><td class="r">${f.comp.toFixed(0)}</td><td class="r">+${(f.pros||0).toFixed(1)}</td><td class="r">${fmtN(f.co2||0)}</td></tr>`).join('')+'</tbody></table>'
    :'<span class="note">No sites yet. Pick a place on the globe and start construction.</span>';
  const touched=S.regions.filter(r=>r.pros>0.05||r.builtMW>0).sort((a,b)=>b.pros-a.pros);
  $('rank').innerHTML='<div class="row head"><span>Region</span><span>Prosp.</span><span>Sent.</span></div>'+(touched.length?touched.map(r=>`<div class="row"><span>${r.name}</span><span>+${r.pros.toFixed(1)}</span><span>${r.sent.toFixed(0)}</span></div>`).join(''):'<span class="note">Nothing yet.</span>');
  $('market').innerHTML=`<span>GPU-hour price index</span><span>${(S.priceIndex*100).toFixed(0)}</span><span>AI demand index</span><span>${(S.demand*100).toFixed(0)}</span><span>Stress events</span><span>${S.stress?'on':'off'}</span>`;
}

// ---------- world map ----------
const map=$('map'),mctx=map.getContext('2d');let nodes=[];
const OV={power:{lo:'cheap',hi:'expensive',v:r=>r.power,min:0.03,max:0.18,inv:false},carbon:{lo:'clean',hi:'dirty',v:r=>r.carbon,min:15,max:650,inv:false},labor:{lo:'scarce',hi:'plentiful',v:r=>r.labor-r.laborUsed,min:0,max:40000,inv:true},sent:{lo:'hostile',hi:'welcoming',v:r=>r.sent,min:20,max:85,inv:true},land:{lo:'cheap',hi:'expensive',v:r=>r.land,min:0.5,max:6,inv:false}};
function ovColor(r){
  const o=OV[S.overlay];let t=clamp((o.v(r)-o.min)/(o.max-o.min),0,1);if(o.inv)t=1-t;
  const h=175-175*t;return `hsl(${h} 70% ${55-10*t}%)`;
}
// orthographic globe, drawn by hand on canvas: lam/phi = the lon/lat facing the viewer
const G={lam:-95,phi:28,target:null,auto:true,zoom:1,hover:null};
const D2R=Math.PI/180;
const REDUCE=matchMedia('(prefers-reduced-motion: reduce)').matches;
function geom(){const w=map.clientWidth,h=map.clientHeight;return {w,h,cx:w/2,cy:h/2+10,R:Math.min(w,h)*0.44*G.zoom}}
function proj(lon,lat,g){const l=(lon-G.lam)*D2R,p=lat*D2R,p0=G.phi*D2R,cp=Math.cos(p),sp=Math.sin(p),cp0=Math.cos(p0),sp0=Math.sin(p0),cl=Math.cos(l);
  return [g.cx+g.R*cp*Math.sin(l), g.cy-g.R*(cp0*sp-sp0*cp*cl), sp0*sp+cp0*cp*cl]}
function limb(x,y,g){const dx=x-g.cx,dy=y-g.cy,d=Math.hypot(dx,dy)||1;return [g.cx+dx/d*g.R,g.cy+dy/d*g.R]}
function drawMap(){
  const dpr=window.devicePixelRatio||1,g=geom();if(!g.w||!g.h)return;
  if(map.width!==g.w*dpr||map.height!==g.h*dpr){map.width=g.w*dpr;map.height=g.h*dpr}
  mctx.setTransform(dpr,0,0,dpr,0,0);mctx.clearRect(0,0,g.w,g.h);
  const o=OV[S.overlay];$('legendLo').textContent=o.inv?o.hi:o.lo;$('legendHi').textContent=o.inv?o.lo:o.hi;
  const {cx,cy,R}=g;
  // atmosphere and sphere
  let gr=mctx.createRadialGradient(cx,cy,R*0.96,cx,cy,R*1.14);gr.addColorStop(0,'rgba(63,216,198,0.16)');gr.addColorStop(1,'rgba(63,216,198,0)');
  mctx.fillStyle=gr;mctx.beginPath();mctx.arc(cx,cy,R*1.14,0,7);mctx.fill();
  gr=mctx.createRadialGradient(cx-R*0.35,cy-R*0.35,R*0.1,cx,cy,R);gr.addColorStop(0,'#17304a');gr.addColorStop(1,'#0a1420');
  mctx.fillStyle=gr;mctx.beginPath();mctx.arc(cx,cy,R,0,7);mctx.fill();
  // graticule, front hemisphere only
  mctx.lineWidth=1;
  const polyline=pts=>{let on=false;mctx.beginPath();for(const [lon,lat] of pts){const [x,y,z]=proj(lon,lat,g);if(z>0){if(on)mctx.lineTo(x,y);else{mctx.moveTo(x,y);on=true}}else on=false}mctx.stroke()};
  mctx.strokeStyle='rgba(63,216,198,0.10)';
  for(let lon=-180;lon<180;lon+=30){const pts=[];for(let lat=-90;lat<=90;lat+=3)pts.push([lon,lat]);polyline(pts)}
  for(let lat=-60;lat<=60;lat+=30){const pts=[];for(let lon=-180;lon<=180;lon+=3)pts.push([lon,lat]);mctx.strokeStyle=lat===0?'rgba(63,216,198,0.28)':'rgba(63,216,198,0.10)';polyline(pts)}
  // land: back-facing vertices are pushed to the limb so coastlines wrap the edge
  mctx.fillStyle='#213244';mctx.strokeStyle='rgba(125,165,195,0.5)';mctx.lineWidth=0.8;
  for(const ring of LAND){
    let front=false,first=true;mctx.beginPath();
    for(const [lon,lat] of ring){let [x,y,z]=proj(lon,lat,g);if(z>0)front=true;else [x,y]=limb(x,y,g);if(first){mctx.moveTo(x,y);first=false}else mctx.lineTo(x,y)}
    mctx.closePath();if(front){mctx.fill();mctx.stroke()}
  }
  mctx.strokeStyle='rgba(63,216,198,0.4)';mctx.lineWidth=1.2;mctx.beginPath();mctx.arc(cx,cy,R,0,7);mctx.stroke();
  // region pins, back to front
  nodes=[];const now=performance.now()/1000;const fontD=getComputedStyle(document.body).getPropertyValue('--font-display');
  const list=S.regions.map(r=>{const [x,y,z]=proj(r.lon,r.lat,g);return {r,x,y,z}}).filter(n=>n.z>0.02).sort((a,b)=>a.z-b.z);
  for(const {r,x,y,z} of list){
    const rad=(3+Math.sqrt(r.labor)/55)*Math.min(1.6,G.zoom),col=ovColor(r),sel=r.id===S.sel;
    const facs=S.facilities.filter(f=>f.regionId===r.id);
    mctx.globalAlpha=0.35+0.65*z;
    const hg=mctx.createRadialGradient(x,y,0,x,y,rad*3);hg.addColorStop(0,col.replace('%)','% / 0.35)'));hg.addColorStop(1,'rgba(0,0,0,0)');
    mctx.fillStyle=hg;mctx.beginPath();mctx.arc(x,y,rad*3,0,7);mctx.fill();
    mctx.fillStyle=r.real?'#f0b443':col;mctx.beginPath();if(r.real){mctx.moveTo(x,y-rad-2);mctx.lineTo(x+rad+2,y);mctx.lineTo(x,y+rad+2);mctx.lineTo(x-rad-2,y);mctx.closePath()}else mctx.arc(x,y,rad,0,7);mctx.fill();
    mctx.strokeStyle='rgba(10,14,20,0.9)';mctx.lineWidth=1.5;mctx.stroke();
    if(facs.length){
      const live=facs.some(f=>f.status==='live'),bld=facs.some(f=>f.status==='building');mctx.lineWidth=2;
      if(bld){mctx.strokeStyle='#f0b443';mctx.beginPath();mctx.arc(x,y,rad+4+(REDUCE?0:Math.sin(now*3)*1.5),0,7);mctx.stroke()}
      if(live){mctx.strokeStyle='#3fd8c6';mctx.beginPath();mctx.arc(x,y,rad+(bld?9:5),0,7);mctx.stroke()}
    }
    if(sel){mctx.strokeStyle='#fff';mctx.lineWidth=1;mctx.setLineDash([3,3]);mctx.beginPath();mctx.arc(x,y,rad+12,0,7);mctx.stroke();mctx.setLineDash([])}
    if(r.moratorium){mctx.fillStyle='#ff5f6e';mctx.font='bold 11px '+fontD;mctx.fillText('✕',x-4,y-rad-8)}
    if(sel||facs.length||G.hover===r.id){mctx.fillStyle=sel?'#fff':'rgba(227,234,243,0.8)';mctx.font=(sel?'600 ':'')+'11px '+fontD;mctx.fillText(r.name,x+rad+4,y+4)}
    mctx.globalAlpha=1;
    nodes.push({r,x,y,rad});
  }
}
function hit(ev){const b=map.getBoundingClientRect(),x=ev.clientX-b.left,y=ev.clientY-b.top;let best=null,bd=1e9;for(const n of nodes){const d=Math.hypot(n.x-x,n.y-y);if(d<Math.max(n.rad+8,16)&&d<bd){bd=d;best=n}}return best}
function selectRegion(id){S.sel=id;const r=R(id);if(r.cfg){S.cfg={...S.cfg,...r.cfg};writeCfg()}G.target={lam:r.lon,phi:clamp(r.lat,-55,70)};G.auto=false;showTab('plan');render()}
let ptr=null;
map.addEventListener('pointerdown',e=>{ptr={x:e.clientX,y:e.clientY,lam:G.lam,phi:G.phi,moved:0};map.setPointerCapture(e.pointerId);G.target=null;G.auto=false});
map.addEventListener('pointermove',e=>{
  const tip=$('tip');
  if(ptr&&e.buttons){const dx=e.clientX-ptr.x,dy=e.clientY-ptr.y;ptr.moved=Math.max(ptr.moved,Math.hypot(dx,dy));const k=0.35/G.zoom;G.lam=ptr.lam-dx*k;G.phi=clamp(ptr.phi+dy*k,-85,85);tip.hidden=true;map.style.cursor='grabbing';return}
  const n=hit(e);G.hover=n?n.r.id:null;
  if(!n){tip.hidden=true;map.style.cursor='grab';return}
  map.style.cursor='pointer';tip.hidden=false;const r=n.r,b=map.getBoundingClientRect();
  tip.style.left=Math.min(n.x+14,b.width-180)+'px';tip.style.top=(n.y+10)+'px';
  tip.innerHTML=`<b>${r.name}</b><div class="r"><span>power</span><span>$${r.power.toFixed(3)}</span></div><div class="r"><span>carbon</span><span>${r.carbon} g</span></div><div class="r"><span>trades</span><span>${fmtN(r.labor-r.laborUsed)}</span></div><div class="r"><span>sentiment</span><span>${r.sent.toFixed(0)}</span></div>`;
});
map.addEventListener('pointerup',e=>{if(!ptr)return;const click=ptr.moved<5;ptr=null;map.style.cursor='grab';if(click){const n=hit(e);if(n)selectRegion(n.r.id)}});
map.addEventListener('pointercancel',()=>{ptr=null});
map.addEventListener('pointerleave',()=>{$('tip').hidden=true;G.hover=null});
map.addEventListener('wheel',e=>{e.preventDefault();G.zoom=clamp(G.zoom*Math.pow(1.0015,-e.deltaY),0.8,2.6)},{passive:false});
new ResizeObserver(()=>drawMap()).observe(map);
// search
const q=$('q'),res=$('results');
function search(){
  const v=q.value.trim().toLowerCase();if(!v){res.hidden=true;return}
  const m=S.regions.filter(r=>r.name.toLowerCase().includes(v)||r.country.toLowerCase().includes(v)).slice(0,8);
  res.hidden=false;
  res.innerHTML=m.length?m.map(r=>`<button type="button" data-id="${r.id}"><b>${r.name}</b><span>${r.country} · $${r.power.toFixed(3)}/kWh · ${r.carbon} g/kWh · sentiment ${r.sent.toFixed(0)}</span></button>`).join('')
    :'<div class="none">No region modeled there yet. Try a country name, or Québec, NEOM, Hyderabad, Finland.</div>';
}
function pickResult(id){selectRegion(id);q.value='';res.hidden=true;q.blur()}
q.addEventListener('input',search);q.addEventListener('focus',search);
q.addEventListener('keydown',e=>{if(e.key==='Enter'){const b=res.querySelector('button');if(b)pickResult(b.dataset.id)}else if(e.key==='Escape'){res.hidden=true;q.blur()}});
res.addEventListener('click',e=>{const b=e.target.closest('button');if(b)pickResult(b.dataset.id)});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.search'))res.hidden=true});

// ---------- 3D site view bridge: the scene itself lives in the module script at the end of the page ----------
const V={mode:'globe',t:0};
let T=null;
let Site3D=null;
function ensureSite(f){if(!Site3D)Site3D=initSite3D({getS:()=>S,schedule,PHASES,GPUS,fmtN,REDUCE,perRack:perRackFor,incidents:{defs:INCIDENTS,spawn:spawnIncident,dispatch:dispatchIncident,resolve:resolveIncident}});Site3D.ensure(f);T=Site3D.T}
function renderSite3D(){if(Site3D)Site3D.frame()}
function diveTo(fid){
  const f=S.facilities.find(x=>x.id===fid);if(!f)return;
  S.viewFac=fid;const r=R(f.regionId);S.sel=r.id;G.target={lam:r.lon,phi:clamp(r.lat,-55,70)};G.auto=false;
  ensureSite(f);const sv=$('siteview');sv.hidden=false;
  if(V.mode==='site'){sv.classList.add('show')}else{sv.classList.remove('show');V.mode='diving';V.t=0}
  showTab('sites');renderSites();
}
function surface(){if(V.mode==='globe'||V.mode==='surfacing')return;V.mode='surfacing';V.t=0;$('siteview').classList.remove('show')}
function stepView(){
  if(V.mode==='diving'){V.t+=1/60;const k=Math.min(1,V.t/1.3),e=k*k*(3-2*k);G.zoom=1+6*e;if(k>0.55)$('siteview').classList.add('show');if(k>=1)V.mode='site'}
  else if(V.mode==='surfacing'){V.t+=1/60;const k=Math.min(1,V.t/1.0),e=k*k*(3-2*k);G.zoom=7-6*e;if(k>=1){V.mode='globe';G.zoom=1;$('siteview').hidden=true}}
}


// ---------- controls ----------
function showTab(name){document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===name));for(const t of ['plan','sites','score'])$('tab-'+t).hidden=t!==name}
document.querySelector('.tabs').addEventListener('click',e=>{const b=e.target.closest('button');if(b)showTab(b.dataset.tab)});
document.querySelector('.overlays').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;S.overlay=b.dataset.ov;document.querySelectorAll('.overlays button').forEach(x=>x.classList.toggle('on',x===b));drawMap()});
$('stress').addEventListener('change',e=>{S.stress=e.target.checked;log(S.stress?'Stress events on: heat waves, grid outages, delivery slips, policy shifts and price swings can now hit the portfolio.':'Stress events off: the preview runs on the deterministic schedule.','ev');renderPortfolio()});
document.querySelector('.speeds').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;S.speed=+b.dataset.sp;document.querySelectorAll('.speeds button').forEach(x=>x.classList.toggle('on',x===b));restartClock()});
$('siteChips').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;S.viewFac=+b.dataset.fac;if(V.mode!=='globe')diveTo(S.viewFac);else renderSites()});
$('openSite').addEventListener('click',()=>{if(S.viewFac)diveTo(S.viewFac)});
$('backGlobe').addEventListener('click',surface);
$('cfg').addEventListener('input',()=>renderPlan());
$('breakGround').addEventListener('click',breakGround);
$('play').addEventListener('click',()=>{S.running=!S.running;$('play').textContent=S.running?'❚❚ Pause':'▶ Play';restartClock()});
let clock=null;
function restartClock(){if(clock)clearInterval(clock);clock=null;if(S.running)clock=setInterval(tick,Math.round(900/S.speed))}
function animate(){
  if(stopped||!$('map'))return;
  if(G.target){const dl=((G.target.lam-G.lam+540)%360)-180,dp=G.target.phi-G.phi;G.lam+=dl*0.12;G.phi+=dp*0.12;if(Math.abs(dl)<0.15&&Math.abs(dp)<0.15)G.target=null}
  else if(G.auto&&!ptr&&!REDUCE&&V.mode==='globe')G.lam+=0.05;
  stepView();
  if(V.mode!=='site')drawMap();
  if(V.mode!=='globe')renderSite3D();
  if(S.facilities.some(f=>f.status==='building')&&!$('tab-sites').hidden)renderSites();
  requestAnimationFrame(animate);
}

function start(data){
  S=(data&&data.regions)?data:freshState();
  S.running=false;
  if(S.unlockedNext){GPUS.next.locked=false;GPUS.next.name='Rubin'}
  fillSelects();writeCfg();
  $('stress').checked=!!S.stress;
  if(!S.log.length)log('Portfolio preview: '+S.regions.length+' places including '+S.regions.filter(r=>r.real).length+' tracked sites (amber diamonds). Pick a place, set a spec, start construction, and watch the build, the economics and the community effects month by month. Stress events are off; switch them on to test resilience.','ev');
  renderLog();render();
  requestAnimationFrame(animate);
}
function writeCfg(){$('energy').value=S.cfg.energy;const gm=S.cfg.gpuMix||{[S.cfg.gpu]:100};for(const k in GPUS)$('gm-'+k).value=gm[k]||0;$('dens').value=S.cfg.dens;$('racks').value=S.cfg.racks;$('crew').value=S.cfg.crew}
function applyFocus(f){const r=S.regions.find(x=>x.id===f.regionId);if(!r)return;if(f.cfg){S.cfg={...S.cfg,...f.cfg};writeCfg()}selectRegion(r.id);if(f.label)log(f.label,'ev');if(f.autoBreakGround)setTimeout(()=>breakGround(),500)}
let stopped=false;
start({});
if(opts.focus)applyFocus(opts.focus);
return {stop(){stopped=true;if(clock)clearInterval(clock);clock=null;if(Site3D&&Site3D.dispose)Site3D.dispose()},getState:()=>S,selectRegion,breakGround,applyFocus};

}
