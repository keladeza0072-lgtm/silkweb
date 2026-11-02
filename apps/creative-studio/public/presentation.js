'use strict';
/* SilkWeb shell: mobile nav + Products dropdown + reveal enhancement.
   Content is visible without JS; nothing here can hide it. */
document.documentElement.classList.add('js');
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.site-nav');
  function closeNav(){ if(nav) nav.classList.remove('open'); if(toggle) toggle.setAttribute('aria-expanded','false'); closeMenu(); }
  if (toggle && nav) {
    toggle.addEventListener('click', function(){ var open=nav.classList.toggle('open'); toggle.setAttribute('aria-expanded',String(open)); if(!open) closeMenu(); });
    nav.addEventListener('click', function(e){ if(e.target.closest('a')) closeNav(); });
  }
  var btn=document.querySelector('.nav-dropdown-btn'), menu=document.getElementById('products-menu');
  function closeMenu(){ if(btn&&menu){ menu.hidden=true; btn.setAttribute('aria-expanded','false'); } }
  function openMenu(){ if(btn&&menu){ menu.hidden=false; btn.setAttribute('aria-expanded','true'); } }
  if(btn&&menu){
    var items=[].slice.call(menu.querySelectorAll('a'));
    btn.addEventListener('click',function(e){ e.stopPropagation(); menu.hidden?openMenu():closeMenu(); });
    btn.addEventListener('keydown',function(e){
      if(e.key==='ArrowDown'||e.key==='Enter'||e.key===' '){ e.preventDefault(); openMenu(); if(items[0]) items[0].focus(); }
      if(e.key==='Escape'){ closeMenu(); btn.focus(); }
    });
    menu.addEventListener('keydown',function(e){
      var i=items.indexOf(document.activeElement);
      if(e.key==='Escape'){ closeMenu(); btn.focus(); }
      if(e.key==='ArrowDown'){ e.preventDefault(); items[(i+1)%items.length].focus(); }
      if(e.key==='ArrowUp'){ e.preventDefault(); items[(i-1+items.length)%items.length].focus(); }
      if(e.key==='Home'){ e.preventDefault(); items[0].focus(); }
      if(e.key==='End'){ e.preventDefault(); items[items.length-1].focus(); }
      if(e.key==='Tab'){ closeMenu(); }
    });
    document.addEventListener('click',function(e){ if(!e.target.closest('.nav-dropdown')) closeMenu(); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ closeMenu(); closeNav(); } });
  }
  // Hero "Explore Use Cases" dropdown — independent of Products, mutually exclusive.
  var uBtn=document.querySelector('.hero-dropdown-btn'), uMenu=document.getElementById('usecases-menu');
  function closeUseCases(){ if(uBtn&&uMenu){ uMenu.hidden=true; uBtn.setAttribute('aria-expanded','false'); } }
  function openUseCases(){ if(uBtn&&uMenu){ closeMenu(); uMenu.hidden=false; uBtn.setAttribute('aria-expanded','true'); } }
  if(uBtn&&uMenu){
    var uItems=[].slice.call(uMenu.querySelectorAll('a'));
    var origOpen=openMenu; openMenu=function(){ closeUseCases(); origOpen(); };
    uBtn.addEventListener('click',function(e){ e.stopPropagation(); uMenu.hidden?openUseCases():closeUseCases(); });
    uBtn.addEventListener('keydown',function(e){
      if(e.key==='ArrowDown'||e.key==='Enter'||e.key===' '){ e.preventDefault(); openUseCases(); if(uItems[0]) uItems[0].focus(); }
      if(e.key==='Escape'){ closeUseCases(); uBtn.focus(); }
    });
    uMenu.addEventListener('keydown',function(e){
      var i=uItems.indexOf(document.activeElement);
      if(e.key==='Escape'){ closeUseCases(); uBtn.focus(); }
      if(e.key==='ArrowDown'){ e.preventDefault(); uItems[(i+1)%uItems.length].focus(); }
      if(e.key==='ArrowUp'){ e.preventDefault(); uItems[(i-1+uItems.length)%uItems.length].focus(); }
      if(e.key==='Home'){ e.preventDefault(); uItems[0].focus(); }
      if(e.key==='End'){ e.preventDefault(); uItems[uItems.length-1].focus(); }
      if(e.key==='Tab'){ closeUseCases(); }
    });
    uMenu.addEventListener('click',function(e){ if(e.target.closest('a')) closeUseCases(); });
    document.addEventListener('click',function(e){ if(!e.target.closest('.hero-dropdown')) closeUseCases(); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeUseCases(); });
  }
  // Reveal: only adds a subtle animation class; elements stay visible regardless.
  var reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els=document.querySelectorAll('.reveal');
  if(reduced||!('IntersectionObserver' in window)){ els.forEach(function(el){el.classList.add('in');}); return; }
  if('requestIdleCallback' in window===false){}
  var io=new IntersectionObserver(function(entries){ entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } }); },{threshold:0.05});
  els.forEach(function(el){ io.observe(el); });
  // Safety: mark everything in after 1.2s so screenshots/short pages never wait.
  setTimeout(function(){ els.forEach(function(el){ el.classList.add('in'); }); },1200);
})();
/* Homepage V4 impact scenario calculator (homepage only; no-op elsewhere).
   Scenario assumptions only — computes illustrative gross avoidance. */
(function () {
  var tasks = document.getElementById('calc-tasks');
  if (!tasks) return;
  var tokens = document.getElementById('calc-tokens');
  var share = document.getElementById('calc-share');
  var cost = document.getElementById('calc-cost');
  var outT = document.getElementById('calc-tokens-out');
  var outC = document.getElementById('calc-cost-out');
  var outY = document.getElementById('calc-year-out');
  var form = document.getElementById('calc-form');
  function num(el) { var v = parseFloat(el && el.value); return isFinite(v) && v > 0 ? v : 0; }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function money(n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function update() {
    var avoided = num(tasks) * num(tokens) * (Math.min(num(share), 100) / 100);
    var gross = avoided / 1000000 * num(cost);
    if (outT) outT.textContent = fmt(avoided);
    if (outC) outC.textContent = money(gross);
    if (outY) outY.textContent = money(gross * 12);
  }
  [tasks, tokens, share, cost].forEach(function (el) { if (el) el.addEventListener('input', update); });
  if (form) form.addEventListener('submit', function (e) { e.preventDefault(); update(); });
  update();
})();
