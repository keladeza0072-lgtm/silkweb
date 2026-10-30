'use strict';
const state={data:null,results:null};
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numeric=n=>typeof n==='number'&&Number.isFinite(n);
const fmt=n=>numeric(n)?n.toLocaleString('en-US'):'Unavailable';
const dec=(n,d=1)=>numeric(n)?n.toFixed(d):'—';
const badge=(label,kind='neutral')=>'<span class="status '+kind+'"><span class="status-mark"></span>'+esc(label)+'</span>';
const empty=(name,description)=>'<div class="empty-state"><div class="empty-glyph">∅</div><strong>'+esc(name)+'</strong><p>'+esc(description)+'</p></div>';
const stat=(name,value,desc)=>'<div class="stat"><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong><small>'+esc(desc)+'</small></div>';

function activate(name){
  document.querySelectorAll('.nav-item').forEach(n=>{n.classList.toggle('active',n.dataset.tab===name);});
  document.querySelectorAll('.tab-panel').forEach(n=>n.classList.toggle('visible',n.id==='panel-'+name));
  window.location.hash=name;
}
function renderRegistry(){
  const registry=state.data.registry;
  $('stat-trusted').textContent=fmt(registry.totalTrusted);
  $('stat-rejected').textContent=fmt(registry.rejected.length);
  const entries=state.results??registry.components;
  $('catalog-summary').textContent=entries.length+' shown · '+registry.totalTrusted+' currently trusted · no model inference';
  $('catalog-results').innerHTML=entries.length?entries.map(c=>{
    const caps=c.capabilities.slice(0,4).map(x=>'<span class="cap">'+esc(x)+'</span>').join('');
    const match=c.match;
    const matched=match?'<div class="signal-note">Rank '+esc(match.score)+' · '+esc(match.signals.join(' · '))+'</div>':'';
    return '<article class="component-card">'+
      '<div class="component-top"><div class="component-icon">✳</div>'+badge('VERIFIED','positive')+'</div>'+
      '<div class="component-id">'+esc(c.id)+'<span>@'+esc(c.version)+'</span></div>'+
      '<p class="component-summary">'+esc(c.summary)+'</p>'+
      '<div class="capabilities">'+caps+'</div><div class="component-foot"><span class="runtime">◎ '+esc(c.stack)+'</span><span class="score">CERTIFIED</span></div>'+
      matched+'<a class="card-action" href="/legacy">Inspect certified contract <span aria-hidden="true">↗</span></a></article>';
  }).join(''):empty('No certified matches','Try another task description. No unverified components are substituted.');
}
function dateText(raw){
  if(!raw||Number.isNaN(Date.parse(raw)))return 'Time not recorded';
  return new Date(raw).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function renderActivity(){
  const a=state.data.activity;
  $('activity-stats').innerHTML=stat('RECORDED SESSIONS',fmt(a.sessions.filter(x=>x.available).length),'Evidence present on this machine')+
    stat('MCP AUDIT EVENTS',fmt(a.totalEventsShown),'Whitelisted event metadata')+
    stat('CODING AGENT','Muse Spark 1.3','Meta model · recorded sessions');
  $('sessions').innerHTML=a.sessions.map(s=>'<article class="session-card"><div class="session-head"><span class="session-id">'+esc(s.id)+'</span>'+
    badge(s.status,s.status==='offline-reconciled'||s.status==='both-evaluated'?'positive':'neutral')+'</div>'+
    '<h3>'+esc(s.title)+'</h3><div class="session-number">'+(numeric(s.codingSeconds)?dec(s.codingSeconds)+'s':'—')+
    ' <small>coding time</small></div><div class="session-footer"><span>'+
    (numeric(s.checksPassed)?esc(s.checksPassed)+'/'+esc(s.checksTotal)+' checks':'No verified check count')+
    '</span><span>'+esc(s.model??'No model record')+'</span></div><p class="session-note">'+esc(s.note)+'</p></article>').join('');
  $('activity-timeline').innerHTML=a.events.length?a.events.slice(0,45).map(e=>
    '<div class="timeline-event"><div class="timeline-marker '+(e.status==='success'?'ok':'fail')+'"></div>'+
    '<div class="timeline-main"><div class="timeline-title">'+esc(e.tool)+'</div><span>'+esc(e.origin)+(e.component?' · '+esc(e.component):'')+'</span></div>'+
    '<div class="timeline-right">'+badge(e.status,e.status==='success'?'positive':'negative')+'<small>'+esc(dateText(e.timestamp))+'</small></div></div>'
  ).join(''):empty('No local MCP audit events','Studio will not invent agent activity. Connect the earlier trial operator artifacts to this computer.');
}
function barRow(label,value,max,suffix,accent){
  const width=numeric(value)&&max>0?Math.max(2,Math.min(100,value*100/max)):0;
  return '<div class="chart-row"><div class="chart-meta"><span>'+esc(label)+'</span><strong>'+esc(numeric(value)?fmt(value)+(suffix||''):'Unavailable')+
    '</strong></div><div class="bar-track"><div class="bar '+(accent?'bar-accent':'')+'" style="width:'+width.toFixed(2)+'%"></div></div></div>';
}
function comparison(title,a,b,suffix){
  const max=Math.max(numeric(a)?a:0,numeric(b)?b:0,1);
  return '<div class="compare-card"><div class="compare-title">'+esc(title)+'</div>'+
    barRow('Without Silk Web',a,max,suffix,false)+barRow('With Silk Web',b,max,suffix,true)+
    '<div class="compare-key"><span class="key-old"></span> Control <span class="key-new"></span> Treatment</div></div>';
}
function renderPerformance(){
  const p=state.data.performance;
  if(!p.available){
    $('perf-stats').innerHTML=stat('BENCHMARK','Unavailable','RES-002 local run records absent')+
      stat('QUALITY','Unavailable','No inferred scores')+stat('COST','Not measured','No inferred billing');
    $('performance-comparison').innerHTML=empty('Performance evidence not connected',p.reason);
  }else{
    const d=p.deltas;
    $('perf-stats').innerHTML=
      stat('CODING TIME REDUCTION',numeric(d.codingTimeReductionPercent)?dec(d.codingTimeReductionPercent)+'%':'Unavailable','One matched coding pair')+
      stat('QUALITY DIFFERENCE',numeric(d.qualityPoints)?(d.qualityPoints>0?'+':'')+dec(d.qualityPoints,2)+' pts':'Unavailable','Weighted score / 100')+
      stat('UNCACHED INPUT REDUCTION',numeric(d.uncachedInputReductionPercent)?dec(d.uncachedInputReductionPercent)+'%':'Unavailable','Only where final usage is available');
    $('performance-comparison').innerHTML=
      comparison('Coding time',p.control.codingSeconds,p.treatment.codingSeconds,'s')+
      comparison('Quality score',p.control.quality,p.treatment.quality,'/100')+
      comparison('Uncached input tokens',p.control.usage.uncachedTokens,p.treatment.usage.uncachedTokens,'')+
      comparison('Output tokens',p.control.usage.outputTokens,p.treatment.usage.outputTokens,'')+
      '<div class="comparison-disclaimer"><strong>Limitations / RES-002</strong><p>'+esc(p.design)+'</p><ul>'+
      p.caveats.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>';
  }
  const v=state.data.installation;
  $('integration-proof').innerHTML=v?
    '<div class="integration-top"><div><span class="section-overline">'+esc(v.component)+'</span><h3>'+esc(v.status)+'</h3><p>'+esc(v.assurance)+'</p></div>'+
    badge(v.passed?'CHECKS PASSED':'VERIFICATION FAILED',v.passed?'positive':'negative')+'</div>'+
    '<div class="integration-checks">'+v.checks.map(c=>'<div><span>'+(c.passed?'✓':'×')+'</span>'+esc(c.id)+'</div>').join('')+
    '</div><div class="verification-date">Evidence recorded '+esc(dateText(v.verifiedAt))+'</div>':
    empty('No installation verification connected','Run the Phase 3 verifier against the previously installed demo to add target-build evidence.');
}
async function load(){
  $('refresh-btn').disabled=true;
  try{
    const response=await fetch('/api/dashboard',{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json();
    if(data.schemaVersion!==1)throw new Error('Unexpected evidence schema');
    state.data=data;state.results=null;
    renderRegistry();renderActivity();renderPerformance();
  }catch(error){
    for(const id of ['catalog-results','sessions','activity-timeline','performance-comparison','integration-proof']){
      $(id).innerHTML=empty('Live evidence unavailable','Unable to load Studio data ('+error.message+'). Check registry and MCP builds.');
    }
  }finally{$('refresh-btn').disabled=false;}
}
async function search(){
  if(!state.data)return;
  const query=$('catalog-query').value.trim();
  if(!query){state.results=null;renderRegistry();return;}
  $('catalog-results').innerHTML='<div class="skeleton">Checking certified registry…</div>';
  try{
    const response=await fetch('/api/search?'+new URLSearchParams({query,limit:'25'}).toString());
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json();
    state.results=data.components??[];
    renderRegistry();
  }catch(error){$('catalog-results').innerHTML=empty('Search unavailable',error.message);}
}
document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',()=>activate(n.dataset.tab)));
$('refresh-btn').addEventListener('click',load);
$('catalog-search').addEventListener('click',search);
$('catalog-query').addEventListener('keydown',e=>{if(e.key==='Enter')search();});
const initial=window.location.hash.replace('#','');
activate(['registry','activity','performance'].includes(initial)?initial:'registry');
load();
