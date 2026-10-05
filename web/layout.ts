// The shell every page shares: one stylesheet, one small script, no framework.
// The look follows the StrideAI website: near-black on cool white, hairlines,
// Stride Blue only where you act.

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The StrideAI mark on the brand book's 24px grid (StrideMark.tsx). Never redrawn.
const MARK = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.43 1 L9.75 1 L1.37 12.19 L10.99 12.19 Z"/><path d="M22.63 11.41 L14.03 11.41 L5.33 23 L13.97 23 Z"/></svg>`;
const FAVICON = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%232E30F8'><path d='M19.43 1 L9.75 1 L1.37 12.19 L10.99 12.19 Z'/><path d='M22.63 11.41 L14.03 11.41 L5.33 23 L13.97 23 Z'/></svg>`;

const CSS = `
:root{--blue:#2E30F8;--blue-hover:#1a1cc4;--accent:var(--blue);--ink:#0A0C14;--bg:#F6F7FA;--soft:#F6F7FA;--card:#fff;--line:#E5E8F0;--mute:#676D7D;
--ok:#0F7B4D;--warn:#9A5B00;--amber:#E08A00;--bad:#C4312A;
--sans:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
--focus:0 0 0 3px rgba(46,48,248,.24)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:500 15px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:3px}
.top{position:sticky;top:0;z-index:10;background:rgba(246,247,250,.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.top .in{max-width:1120px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.brand{display:inline-flex;align-items:center;gap:10px;color:var(--ink);font-weight:800;letter-spacing:-.01em}.brand:hover{text-decoration:none}.brand svg{color:var(--blue)}
.brand span{color:var(--mute);font-weight:500;padding-left:10px;border-left:1px solid var(--line)}
.top nav{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}.top nav a{color:var(--ink);padding:6px 12px;border-radius:8px;font-weight:600;font-size:14px}.top nav a:hover{background:var(--card);text-decoration:none}
main{max-width:1120px;margin:0 auto;padding:40px 24px 96px}
h1{font-size:32px;line-height:1.15;margin:0 0 8px;letter-spacing:-.025em;font-weight:800}
h2{font-size:19px;line-height:1.3;margin:0 0 8px;letter-spacing:-.01em;font-weight:700}
h3{font:500 11px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--mute);margin:0 0 12px}
p{margin:0 0 10px}.mute{color:var(--mute)}.small{font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px 24px;margin:0 0 16px;box-shadow:0 4px 20px rgba(10,12,20,.04)}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.person{display:flex;flex-direction:column;gap:14px}.person .who{display:flex;align-items:flex-start;gap:12px}.headline{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:2px}
.avatar{width:40px;height:40px;border-radius:10px;background:var(--ink);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex:none}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.stat{background:var(--card);padding:12px 14px}
.stat b{display:block;font-size:24px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
.stat span{display:block;margin-top:4px;font-size:12px;line-height:1.3;color:var(--mute)}
.next{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-weight:600}
.next::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--blue);flex:none}.next:hover{border-color:var(--blue);text-decoration:none}
.steps{display:flex;border-bottom:1px solid var(--line);margin:24px 0 28px;overflow-x:auto}
.steps a{display:flex;align-items:center;gap:8px;padding:12px 16px;color:var(--mute);font-weight:600;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.steps a:hover{color:var(--ink);text-decoration:none}.steps a.on{color:var(--ink);border-bottom-color:var(--blue)}
.steps .n{font:500 11px var(--mono);color:var(--mute)}.steps a.done .n{color:var(--ok)}.steps a.on .n{color:var(--blue)}
.lead{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px}
.lead p{max-width:640px}
button,.btn{font:inherit;font-weight:700;font-size:14px;padding:9px 18px;min-height:40px;border-radius:8px;border:1px solid var(--blue);background:var(--blue);color:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;line-height:1.2;white-space:nowrap;transition:background .18s,border-color .18s,color .18s}
button:hover,.btn:hover{background:var(--blue-hover);border-color:var(--blue-hover);text-decoration:none}button:active,.btn:active{transform:scale(.98)}
button.ghost,.btn.ghost{background:var(--card);color:var(--ink);border-color:var(--line)}button.ghost:hover,.btn.ghost:hover{background:var(--card);border-color:var(--ink)}
button.quiet{background:transparent;border-color:transparent;color:var(--mute)}button.quiet:hover{background:var(--card);border-color:var(--line);color:var(--ink)}
button:disabled,button:disabled:hover{opacity:.4;cursor:not-allowed;transform:none;background:var(--blue);border-color:var(--blue)}button.ghost:disabled,button.quiet:disabled{background:transparent;border-color:var(--line)}
button:focus-visible,.btn:focus-visible,input:focus,select:focus,textarea:focus{outline:none;box-shadow:var(--focus)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}form.inline{display:inline}
label{display:block;margin:14px 0 6px;font-size:13px;font-weight:600}
input,select,textarea{width:100%;font:inherit;font-weight:500;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;transition:border-color .18s}
input:focus,select:focus,textarea:focus{border-color:var(--blue)}
input[type=file]{padding:8px}textarea{min-height:110px;resize:vertical}input[type=checkbox]{width:auto;accent-color:var(--blue)}
.hint{font-size:13px;color:var(--mute);margin-top:6px}
.tag{display:inline-flex;align-items:center;gap:6px;font:500 11px/1.6 var(--mono);padding:2px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--mute);white-space:nowrap}
.tag.ok,.tag.warn,.tag.bad,.tag.accent{color:var(--ink)}
.tag.ok::before,.tag.warn::before,.tag.bad::before,.tag.accent::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ok)}
.tag.warn::before{background:var(--amber)}.tag.bad::before{background:var(--bad)}.tag.accent::before{background:var(--blue)}
.notice{padding:12px 16px;border:1px solid var(--line);border-left:3px solid var(--blue);border-radius:8px;margin-bottom:16px;background:var(--card);color:var(--ink)}
.notice.warn{border-left-color:var(--amber)}.notice.bad{border-left-color:var(--bad)}.notice.ok{border-left-color:var(--ok)}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--mute);white-space:nowrap;user-select:none}
th[data-sort]{cursor:pointer}th[data-sort]:hover{color:var(--ink)}tr:last-child td{border-bottom:0}
.score{display:inline-flex;width:36px;height:36px;border-radius:8px;align-items:center;justify-content:center;font-weight:800;font-variant-numeric:tabular-nums;border:1px solid var(--line);background:var(--card);color:var(--mute)}
.score.hi{background:var(--blue);border-color:var(--blue);color:#fff}.score.mid{color:var(--ink);border-color:var(--ink)}
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}.filters input,.filters select{width:auto;min-width:120px;padding:8px 10px}
.facts td:first-child{width:28px}.facts .k{font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.04em;color:var(--mute);white-space:nowrap}
.cols{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.col h3{margin-bottom:8px}.col .card{padding:12px 14px;margin-bottom:8px;box-shadow:none}
.two{display:grid;gap:18px;grid-template-columns:1fr 1fr}
@media(max-width:760px){.two{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}h1{font-size:26px}main{padding:28px 16px 80px}.top .in{padding:12px 16px}}
pre{white-space:pre-wrap;font:inherit;margin:0}details summary{cursor:pointer;color:var(--mute);font-weight:600}
.mono{font-family:var(--mono);font-size:12.5px}
.empty{padding:32px;text-align:center;color:var(--mute);border:1px dashed var(--line);border-radius:12px}
`;

const JS = `
(function(){
  var t=document.querySelector('table[data-jobs]');if(!t)return;
  var rows=[].slice.call(t.tBodies[0].rows), f=document.querySelector('.filters');
  function num(r,k){var v=r.dataset[k];return v===''||v==null?NaN:Number(v)}
  function apply(){
    var q=(f.querySelector('[name=q]').value||'').toLowerCase(), st=f.querySelector('[name=status]').value, src=f.querySelector('[name=source]').value,
        min=Number(f.querySelector('[name=min]').value||0), sp=f.querySelector('[name=sponsor]');
    var n=0;rows.forEach(function(r){
      var d=r.dataset, show=true;
      if(q&&(d.title+' '+d.company+' '+d.location).toLowerCase().indexOf(q)<0)show=false;
      if(st&&d.status!==st)show=false; if(src&&d.source!==src)show=false;
      if(min&&!(Number(d.score)>=min))show=false; if(sp&&sp.checked&&d.sponsor!=='1')show=false;
      r.hidden=!show; if(show)n++;});
    var c=document.getElementById('count');if(c)c.textContent=n+' of '+rows.length;
  }
  f.addEventListener('input',apply);f.addEventListener('change',apply);
  var dir={};
  t.tHead.addEventListener('click',function(e){
    var th=e.target.closest('th[data-sort]');if(!th)return;var k=th.dataset.sort;dir[k]=dir[k]==='asc'?'desc':'asc';var asc=dir[k]==='asc';
    rows.sort(function(a,b){var x=num(a,k),y=num(b,k);
      if(isNaN(x)&&isNaN(y)){x=a.dataset[k]||'';y=b.dataset[k]||'';return asc?x.localeCompare(y):y.localeCompare(x)}
      if(isNaN(x))return 1;if(isNaN(y))return -1;return asc?x-y:y-x});
    rows.forEach(function(r){t.tBodies[0].appendChild(r)});
  });
  apply();
})();
(function(){
  var boxes=[].slice.call(document.querySelectorAll('input[name=tick]')), btn=document.getElementById('reviewed');if(!btn||!boxes.length)return;
  function up(){var all=boxes.every(function(b){return b.checked});btn.disabled=!all;document.getElementById('tickcount').textContent=boxes.filter(function(b){return b.checked}).length+'/'+boxes.length}
  boxes.forEach(function(b){b.addEventListener('change',up)});var a=document.getElementById('tickall');if(a)a.addEventListener('click',function(){boxes.forEach(function(b){b.checked=true});up()});up();
})();
`;

export interface PageOpts {
  /** Auto-reload while background work runs. */
  refresh?: boolean;
  /** Links shown top-right. */
  nav?: { href: string; label: string }[];
}

export function page(title: string, body: string, o: PageOpts = {}): string {
  const nav = (o.nav ?? [{ href: "/", label: "People" }]).map((n) => `<a href="${esc(n.href)}">${esc(n.label)}</a>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Stride Job Agent</title>${o.refresh ? '<meta http-equiv="refresh" content="5">' : ""}
<link rel="icon" href="${FAVICON}"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap"><style>${CSS}</style></head>
<body><header class="top"><div class="in"><a class="brand" href="/">${MARK}StrideAI <span>Job Agent</span></a><nav>${nav}</nav></div></header>
<main>${body}</main><script>${JS}</script></body></html>`;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
