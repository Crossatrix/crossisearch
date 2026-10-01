// Crossinet developer console.
// A small bridge script is injected into every site iframe (unless the publisher disabled the
// console). It reports everything that runs to the browser chrome and runs console commands.
// Sites render in a sandboxed iframe with an opaque origin, so all talk goes through postMessage.

export type DevKind =
  | "log" | "info" | "warn" | "error" | "debug" // console.* + uncaught errors
  | "input" | "result"                           // console REPL
  | "net" | "event" | "timer" | "script" | "lifecycle" | "system";

export type DevEntry = { id: number; ts: number; kind: DevKind; text: string };

// Everything below is plain ES5 as a string (no backticks / template placeholders inside!).
export const DEV_BRIDGE = `<script>(function(){
var P=parent;
function send(t,d){try{P.postMessage({cnetDev:t,d:d,ts:Date.now()},'*');}catch(e){}}
function ser(v,top){
  var seen=[];
  function s(x,depth){
    if(x===null)return 'null';
    var t=typeof x;
    if(t==='undefined')return 'undefined';
    if(t==='string')return depth||!top?JSON.stringify(x):x;
    if(t==='number'||t==='boolean'||t==='bigint')return String(x);
    if(t==='symbol')return String(x);
    if(t==='function')return 'f '+(x.name||'anonymous')+'()';
    if(x instanceof Error)return x.name+': '+x.message;
    if(typeof Node!=='undefined'&&x instanceof Node){
      if(x.nodeType===1){var el=x;return '<'+el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/).join('.'):'')+'>';}
      return '#'+x.nodeName;
    }
    if(seen.indexOf(x)>-1)return '[Circular]';
    if(depth>2)return Array.isArray(x)?'[...]':'{...}';
    seen.push(x);
    var out;
    try{
      if(Array.isArray(x)){out='['+x.slice(0,50).map(function(i){return s(i,depth+1);}).join(', ')+(x.length>50?', ...':'')+']';}
      else{var k=Object.keys(x).slice(0,30);out='{'+k.map(function(key){return key+': '+s(x[key],depth+1);}).join(', ')+'}';}
    }catch(e){out=String(x);}
    seen.pop();
    return out;
  }
  var r=s(v,0);
  return r.length>2000?r.slice(0,2000)+'...':r;
}
function args(a){return Array.prototype.map.call(a,function(x){return ser(x,true);}).join(' ');}

// console.*
['log','info','warn','error','debug'].forEach(function(k){
  var o=console[k];
  console[k]=function(){send(k,args(arguments));try{return o.apply(console,arguments);}catch(e){}};
});
var oc=console.clear;
console.clear=function(){send('clear','');try{oc.call(console);}catch(e){}};

// Errors
window.addEventListener('error',function(e){
  if(e.target&&e.target!==window&&(e.target.src||e.target.href)){
    send('error','Failed to load <'+e.target.tagName.toLowerCase()+'> '+(e.target.src||e.target.href));return;
  }
  send('error','Uncaught '+(e.error&&e.error.name?e.error.name+': ':'')+e.message+(e.lineno?'  (line '+e.lineno+':'+e.colno+')':''));
},true);
window.addEventListener('unhandledrejection',function(e){send('error','Unhandled promise rejection: '+ser(e.reason,true));});

// Network
if(window.fetch){
  var of=window.fetch;
  window.fetch=function(i,init){
    var url=typeof i==='string'?i:(i&&i.url)||String(i);
    var m=((init&&init.method)||(i&&i.method)||'GET').toUpperCase();
    var t0=Date.now();
    send('net','fetch '+m+' '+url+'  ...');
    return of.apply(this,arguments).then(function(r){send('net','fetch '+m+' '+url+'  -> '+r.status+' ('+(Date.now()-t0)+' ms)');return r;},function(err){send('net','fetch '+m+' '+url+'  FAILED: '+ser(err,true));throw err;});
  };
}
if(window.XMLHttpRequest){
  var xo=XMLHttpRequest.prototype.open,xs=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){this.__c=[m,u];return xo.apply(this,arguments);};
  XMLHttpRequest.prototype.send=function(){
    var self=this,c=this.__c||['?','?'],t0=Date.now();
    send('net','xhr '+c[0]+' '+c[1]+'  ...');
    this.addEventListener('loadend',function(){send('net','xhr '+c[0]+' '+c[1]+'  -> '+self.status+' ('+(Date.now()-t0)+' ms)');});
    return xs.apply(this,arguments);
  };
}

// Timers
var tid=0;
var st=window.setTimeout,si=window.setInterval;
window.setTimeout=function(fn,ms){
  var id=++tid,rest=Array.prototype.slice.call(arguments,2);
  if(typeof fn!=='function')return st.apply(window,arguments);
  send('timer','setTimeout #'+id+' scheduled in '+(ms||0)+' ms');
  return st.call(window,function(){send('timer','setTimeout #'+id+' fired');return fn.apply(this,rest);},ms);
};
window.setInterval=function(fn,ms){
  var id=++tid,n=0,rest=Array.prototype.slice.call(arguments,2);
  if(typeof fn!=='function')return si.apply(window,arguments);
  send('timer','setInterval #'+id+' every '+(ms||0)+' ms');
  return si.call(window,function(){n++;if(n<=5)send('timer','setInterval #'+id+' tick '+n+(n===5?' (further ticks not logged)':''));return fn.apply(this,rest);},ms);
};

// User events + lifecycle
['click','submit','change'].forEach(function(k){
  document.addEventListener(k,function(e){
    var el=e.target;
    send('event',k+' on '+ser(el&&el.nodeType?el:String(el),true));
  },true);
});
document.addEventListener('DOMContentLoaded',function(){
  send('lifecycle','DOMContentLoaded');
  var sc=document.scripts,i,n;
  for(i=0;i<sc.length;i++){
    var tx=sc[i].textContent||'';
    if(tx.indexOf('cnetNav')>-1||tx.indexOf('var P=parent;')>-1)continue;
    n=sc[i].src?'external '+sc[i].src:'inline script ('+sc[i].textContent.length+' chars)';
    send('script','ran '+n);
  }
  send('lifecycle',document.querySelectorAll('*').length+' elements, '+document.styleSheets.length+' stylesheets');
});
window.addEventListener('load',function(){send('lifecycle','load');});
window.addEventListener('hashchange',function(){send('event','hashchange -> '+location.hash);});

// Console commands from the browser chrome
window.addEventListener('message',function(e){
  if(e.source!==P)return;
  var m=e.data;
  if(!m||typeof m.cnetEval!=='string')return;
  if(!window.$)window.$=function(s){return document.querySelector(s);};
  if(!window.$$)window.$$=function(s){return Array.prototype.slice.call(document.querySelectorAll(s));};
  if(!window.css)window.css=function(t){var s=document.createElement('style');s.textContent=t;document.head.appendChild(s);return s;};
  var code=m.cnetEval.replace(/^(\\s*)(const|let)\\s/gm,'$1var ');
  function done(ok,v){send('result',{ok:ok,v:ser(v,false)});}
  try{
    var r=(0,eval)(code);
    if(r&&typeof r.then==='function')r.then(function(v){done(true,v);},function(err){done(false,err);});
    else done(true,r);
  }catch(err){done(false,err);}
});
send('lifecycle','Console ready');
})();<\/script>`;

export const DEV_HELP =
  "Changes made here are temporary: they only affect your view and vanish on reload.\n" +
  "Helpers: $('sel'), $$('sel'), css('p{color:red}')";
