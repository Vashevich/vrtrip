// Чтение чертежей DXF, SVG и DWG для VRtrip (Сергей, 28.11.2026: «чтобы открывалось прямо внутри VRtrip»).
// Разбор взят из проекта FDWG (Vashevich/FDWG) без изменений по сути: на выходе слои и полилинии в единицах чертежа.
// DWG читает libredwg-web (LibreDWG в WebAssembly, GPL-3.0), папка vendor/libredwg, лицензия — vendor/libredwg/COPYING.
const UNITS = {1:["дюйм",25.4],2:["фут",304.8],4:["мм",1],5:["см",10],6:["м",1000]};
function aciToRgb(n){
  const base = {1:[255,0,0],2:[255,255,0],3:[0,255,0],4:[0,255,255],5:[0,0,255],6:[255,0,255],7:[255,255,255],8:[128,128,128],9:[192,192,192]};
  if (base[n]) return base[n];
  if (n >= 250 && n <= 255) { const v = [51,91,132,173,214,255][n-250]; return [v,v,v]; }
  if (n >= 10 && n <= 249) {
    const h = Math.floor((n-10)/10)*15, k = (n-10)%10, vv = [1,.65,.5,.3,.15][k>>1], ss = (k&1) ? .5 : 1;
    const c = vv*ss, x = c*(1-Math.abs((h/60)%2-1)), m = vv-c; let r,g,b;
    if (h<60){r=c;g=x;b=0}else if(h<120){r=x;g=c;b=0}else if(h<180){r=0;g=c;b=x}else if(h<240){r=0;g=x;b=c}else if(h<300){r=x;g=0;b=c}else{r=c;g=0;b=x}
    return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
  }
  return [255,255,255];
}
function fixDark(rgb){            // тёмные цвета осветляем: фон чертежа тёмный
  const l = (0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2])/255;
  if (l < .35) { const t = .55; rgb = rgb.map(v => Math.round(v+(255-v)*t)); }
  return "rgb("+rgb.join(",")+")";
}
function fmtNum(v){
  const a = Math.abs(v);
  return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:a<10?2:a<1000?1:0}).format(v);
}
/* ============ сцена ============ */
function newScene(name, fmt){
  return {name, fmt, layers:new Map(), items:[], units:null, skipped:{}, bounds:null};
}
function layerOf(sc, name, color, visible){
  let L = sc.layers.get(name);
  if (!L) { L = {name, color: color||"rgb(200,205,215)", visible: visible!==false, count:0}; sc.layers.set(name, L); }
  return L;
}
function addPoly(sc, layer, color, pts, closed){
  if (pts.length < 2) return;
  const L = layerOf(sc, layer); L.count++;
  sc.items.push({t:"p", layer, color, pts, closed});
}
function addText(sc, layer, color, x, y, h, rot, text){
  if (!text) return;
  const L = layerOf(sc, layer); L.count++;
  sc.items.push({t:"t", layer, color, x, y, h: h||1, rot: rot||0, text});
}

/* ============ DXF ============ */
function readGroups(text){
  const L = text.split(/\r\n|\r|\n/), g = [];
  for (let i=0;i+1<L.length;i+=2){ const c = parseInt(L[i],10); if (Number.isNaN(c)) continue; g.push([c, L[i+1]]); }
  return g;
}
const M_ID = [1,0,0,1,0,0];
function mMul(a,b){ // a * b  (сначала b, потом a)
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
function mApply(m,x,y,z){ return [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5], z||0]; }
function bsplinePoints(deg, knots, ctrl, n){
  const k = ctrl.length, out = [], t0 = knots[deg], t1 = knots[k];
  if (!(t1 > t0) || knots.length < k+deg+1) return ctrl;
  for (let s=0;s<=n;s++){
    const t = t0 + (t1-t0)*s/n - (s===n?1e-9*(t1-t0):0);
    let i = deg; while (i < k-1 && t >= knots[i+1]) i++;
    const d = []; for (let j=0;j<=deg;j++) d.push(ctrl[j+i-deg].slice());
    for (let r=1;r<=deg;r++) for (let j=deg;j>=r;j--){
      const den = knots[j+1+i-r]-knots[j+i-deg]; const a = den ? (t-knots[j+i-deg])/den : 0;
      for (let q=0;q<3;q++) d[j][q] = (1-a)*d[j-1][q] + a*d[j][q];
    }
    out.push(d[deg]);
  }
  return out;
}
function arcPts(cx,cy,r,a0,a1,z,steps){
  const out=[], n = steps || Math.max(4, Math.ceil(Math.abs(a1-a0)/(Math.PI/32)));
  for (let i=0;i<=n;i++){ const a = a0+(a1-a0)*i/n; out.push([cx+r*Math.cos(a), cy+r*Math.sin(a), z||0]); }
  return out;
}
function bulgePts(p,q,b,z){
  const dx=q[0]-p[0], dy=q[1]-p[1], d=Math.hypot(dx,dy);
  if (!b || !d) return [[q[0],q[1],z||0]];
  const th = 4*Math.atan(b), off = (d/2)*((1-b*b)/(2*b));
  const cx = (p[0]+q[0])/2 - dy/d*off, cy = (p[1]+q[1])/2 + dx/d*off;
  const r = Math.hypot(p[0]-cx, p[1]-cy), a0 = Math.atan2(p[1]-cy, p[0]-cx);
  const n = Math.max(2, Math.ceil(Math.abs(th)/(Math.PI/24))), out=[];
  for (let i=1;i<=n;i++){ const a=a0+th*i/n; out.push([cx+r*Math.cos(a), cy+r*Math.sin(a), z||0]); }
  return out;
}
function cleanText(s){
  return s.replace(/\\U\+([0-9A-Fa-f]{4})/g,(_,h)=>String.fromCharCode(parseInt(h,16)))
          .replace(/\\P/g," ").replace(/\\~/g," ").replace(/\{?\\[A-Za-z][^;{}]*;/g,"").replace(/[{}]/g,"").replace(/%%[cC]/g,"⌀").replace(/%%[dD]/g,"°").replace(/%%[pP]/g,"±").trim();
}
function parseDXF(text, name){
  const g = readGroups(text);
  if (!g.length || !g.some(x=>x[0]===0 && /^(SECTION|EOF)$/.test(x[1].trim()))) throw new Error("Это не текстовый DXF. Бинарный DXF и другие форматы сначала сохраните как обычный DXF.");
  const sc = newScene(name, "DXF");
  const sections = {};
  for (let i=0;i<g.length;i++){
    if (g[i][0]===0 && g[i][1].trim()==="SECTION" && g[i+1] && g[i+1][0]===2){
      const nm = g[i+1][1].trim(); let j=i+2; while (j<g.length && !(g[j][0]===0 && g[j][1].trim()==="ENDSEC")) j++;
      sections[nm] = g.slice(i+2, j); i=j;
    }
  }
  // единицы
  const H = sections.HEADER || [];
  for (let i=0;i<H.length;i++) if (H[i][0]===9 && H[i][1].trim()==="$INSUNITS" && H[i+1]) sc.units = parseInt(H[i+1][1],10)||null;
  // слои
  const layerCol = new Map();
  const T = sections.TABLES || [];
  for (let i=0;i<T.length;i++){
    if (T[i][0]===0 && T[i][1].trim()==="LAYER"){
      let j=i+1, nm="", col=7, flags=0; while (j<T.length && T[j][0]!==0){ if(T[j][0]===2) nm=T[j][1].trim(); else if(T[j][0]===62) col=parseInt(T[j][1],10); else if(T[j][0]===70) flags=parseInt(T[j][1],10); j++; }
      if (nm){ const off = col<0 || (flags&1); layerCol.set(nm, fixDark(aciToRgb(Math.abs(col)||7))); layerOf(sc, nm, layerCol.get(nm), !off); }
      i=j-1;
    }
  }
  // блоки
  const blocks = new Map();
  const B = sections.BLOCKS || [];
  for (let i=0;i<B.length;i++){
    if (B[i][0]===0 && B[i][1].trim()==="BLOCK"){
      let j=i+1, nm="", bx=0, by=0; while (j<B.length && B[j][0]!==0){ if(B[j][0]===2&&!nm) nm=B[j][1].trim(); else if(B[j][0]===10) bx=parseFloat(B[j][1]); else if(B[j][0]===20) by=parseFloat(B[j][1]); j++; }
      let k=j; while (k<B.length && !(B[k][0]===0 && B[k][1].trim()==="ENDBLK")) k++;
      blocks.set(nm, {bx,by, ents: splitEntities(B.slice(j,k))}); i=k;
    }
  }
  function colorFor(e, ctx){
    const c = e.g.find(x=>x[0]===62), tc = e.g.find(x=>x[0]===420);
    if (tc){ const n=parseInt(tc[1],10); return fixDark([(n>>16)&255,(n>>8)&255,n&255]); }
    if (c){ const n=parseInt(c[1],10); if (n>0 && n<256) return fixDark(aciToRgb(n)); if (n===0 && ctx.color) return ctx.color; }
    return null;
  }
  function emit(e, ctx, depth){
    const gg = e.g, f = (c, d)=>{ const x = gg.find(y=>y[0]===c); return x ? parseFloat(x[1]) : d; };
    let layer = (gg.find(x=>x[0]===8)||[0,"0"])[1].trim();
    if (layer==="0" && ctx.layer) layer = ctx.layer;
    if (!sc.layers.has(layer)) layerOf(sc, layer, layerCol.get(layer));
    const lcol = sc.layers.get(layer).color;
    const col = colorFor(e, ctx) || ctx.color || lcol;
    const m = ctx.m, P = (x,y,z)=>mApply(m,x,y,z);
    switch (e.type){
      case "LINE": addPoly(sc, layer, col, [P(f(10,0),f(20,0),f(30,0)), P(f(11,0),f(21,0),f(31,0))], false); break;
      case "LWPOLYLINE": {
        const flags = f(70,0), z = f(38,0), v = []; let cur=null;
        for (const [c,val] of gg){ if (c===10){ cur={x:parseFloat(val),y:0,b:0}; v.push(cur);} else if (c===20 && cur) cur.y=parseFloat(val); else if (c===42 && cur) cur.b=parseFloat(val); }
        const pts=[]; for (let i=0;i<v.length;i++){ const a=v[i], b=v[(i+1)%v.length]; if (i===0) pts.push([a.x,a.y,z]); if (i<v.length-1 || (flags&1)) pts.push(...bulgePts([a.x,a.y],[b.x,b.y],a.b,z)); }
        const closed = !!(flags&1); if (closed && pts.length>1) pts.pop();
        addPoly(sc, layer, col, pts.map(p=>P(p[0],p[1],p[2])), closed); break;
      }
      case "POLYLINE": {
        const flags = f(70,0); if (flags & (16|64)) { sc.skipped.POLYLINE_MESH=(sc.skipped.POLYLINE_MESH||0)+1; break; }
        const v = e.verts||[]; const pts=[];
        for (let i=0;i<v.length;i++){ const a=v[i], b=v[(i+1)%v.length]; if (i===0) pts.push([a.x,a.y,a.z]); if (i<v.length-1 || (flags&1)) pts.push(...bulgePts([a.x,a.y],[b.x,b.y],a.b,a.z)); }
        const closed = !!(flags&1); if (closed && pts.length>1) pts.pop();
        addPoly(sc, layer, col, pts.map(p=>P(p[0],p[1],p[2])), closed); break;
      }
      case "CIRCLE": addPoly(sc, layer, col, arcPts(f(10,0),f(20,0),f(40,0),0,Math.PI*2,f(30,0),96).map(p=>P(p[0],p[1],p[2])), true); break;
      case "ARC": { let a0=f(50,0)*Math.PI/180, a1=f(51,0)*Math.PI/180; if (a1<=a0) a1+=Math.PI*2; addPoly(sc, layer, col, arcPts(f(10,0),f(20,0),f(40,0),a0,a1,f(30,0)).map(p=>P(p[0],p[1],p[2])), false); break; }
      case "ELLIPSE": {
        const cx=f(10,0), cy=f(20,0), mx=f(11,0), my=f(21,0), ra=f(40,1); let t0=f(41,0), t1=f(42,Math.PI*2); if (t1<=t0) t1+=Math.PI*2;
        const pts=[], n=Math.max(16, Math.ceil((t1-t0)/(Math.PI/32)));
        for (let i=0;i<=n;i++){ const t=t0+(t1-t0)*i/n; pts.push(P(cx+mx*Math.cos(t)-my*ra*Math.sin(t), cy+my*Math.cos(t)+mx*ra*Math.sin(t), 0)); }
        addPoly(sc, layer, col, pts, false); break;
      }
      case "SPLINE": {
        const ctrl=[], fit=[]; let cur=null;
        for (const [c,val] of gg){ if (c===10){ cur=[parseFloat(val),0,0]; ctrl.push(cur);} else if (c===20&&cur&&ctrl.includes(cur)) cur[1]=parseFloat(val); else if (c===30&&cur&&ctrl.includes(cur)) cur[2]=parseFloat(val); }
        let fc=null; for (const [c,val] of gg){ if (c===11){ fc=[parseFloat(val),0,0]; fit.push(fc);} else if (c===21&&fc) fc[1]=parseFloat(val); else if (c===31&&fc) fc[2]=parseFloat(val); }
        const knots = gg.filter(x=>x[0]===40).map(x=>parseFloat(x[1])), deg = f(71,3);
        let pts = ctrl.length>deg && knots.length>=ctrl.length+deg+1 ? bsplinePoints(deg, knots, ctrl, Math.max(24, ctrl.length*8)) : (fit.length?fit:ctrl);
        if (f(70,0)&1 && pts.length) pts = pts.concat([pts[0]]);
        addPoly(sc, layer, col, pts.map(p=>P(p[0],p[1],p[2])), false); break;
      }
      case "TEXT": case "MTEXT": {
        let s = gg.filter(x=>x[0]===3).map(x=>x[1]).join("") + ((gg.find(x=>x[0]===1)||[0,""])[1]);
        s = cleanText(s); const p = P(f(10,0), f(20,0), 0), sx = Math.hypot(m[0],m[1]);
        let rot = f(50,0); if (e.type==="MTEXT" && !gg.find(x=>x[0]===50)){ const dx=f(11,1), dy=f(21,0); if (gg.find(x=>x[0]===11)) rot = Math.atan2(dy,dx)*180/Math.PI; }
        addText(sc, layer, col, p[0], p[1], f(40,1)*sx, rot + Math.atan2(m[1],m[0])*180/Math.PI, s); break;
      }
      case "LEADER": { const pts=[]; let cur=null; for (const [c,val] of gg){ if(c===10){cur=[parseFloat(val),0,0];pts.push(cur);} else if(c===20&&cur) cur[1]=parseFloat(val); } addPoly(sc, layer, col, pts.map(p=>P(p[0],p[1],0)), false); break; }
      case "3DFACE": case "SOLID": case "TRACE": {
        const q=[0,1,2,3].map(i=>P(f(10+i,0),f(20+i,0),f(30+i,0))); const pts = e.type==="3DFACE" ? q : [q[0],q[1],q[3],q[2]];
        const uniq = pts.filter((p,i)=>i===0 || p.some((v,k)=>v!==pts[i-1][k])); addPoly(sc, layer, col, uniq, true); break;
      }
      case "INSERT": case "DIMENSION": {
        if (depth > 8) break;
        const bname = (gg.find(x=>x[0]===2)||[0,""])[1].trim(), blk = blocks.get(bname); if (!blk) break;
        let mm;
        if (e.type==="DIMENSION") mm = m;
        else {
          const sx=f(41,1), sy=f(42,1), rot=f(50,0)*Math.PI/180, c=Math.cos(rot), s=Math.sin(rot);
          mm = mMul(m, mMul([1,0,0,1,f(10,0),f(20,0)], mMul([c*sx, s*sx, -s*sy, c*sy, 0,0], [1,0,0,1,-blk.bx,-blk.by])));
        }
        const sub = {m:mm, layer, color: (colorFor(e,ctx) || ctx.color) };
        for (const be of blk.ents) emit(be, sub, depth+1);
        break;
      }
      default: sc.skipped[e.type]=(sc.skipped[e.type]||0)+1;
    }
  }
  const ents = splitEntities(sections.ENTITIES || []);
  for (const e of ents) emit(e, {m:M_ID, layer:null, color:null}, 0);
  return sc;
}
function splitEntities(groups){
  const out=[]; let cur=null, poly=null, vtx=null;
  for (const gr of groups){
    if (gr[0]===0){
      const t = gr[1].trim(); vtx=null;
      if (t==="VERTEX" && poly){ vtx={x:0,y:0,z:0,b:0}; poly.verts.push(vtx); cur=null; continue; }
      if (t==="SEQEND"){ poly=null; cur=null; continue; }
      cur={type:t, g:[]};
      if (t==="POLYLINE"){ cur.verts=[]; poly=cur; } else poly=null;
      out.push(cur);
    } else if (vtx){
      if (gr[0]===10) vtx.x=parseFloat(gr[1]); else if (gr[0]===20) vtx.y=parseFloat(gr[1]); else if (gr[0]===30) vtx.z=parseFloat(gr[1]); else if (gr[0]===42) vtx.b=parseFloat(gr[1]);
    } else if (cur) cur.g.push(gr);
  }
  return out;
}

/* ============ SVG ============ */
function parseSVG(text, name){
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase()!=="svg" || doc.querySelector("parsererror")) throw new Error("SVG не читается: файл повреждён или это другой формат.");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:0;width:2000px;height:2000px;opacity:0;pointer-events:none";
  const svg = document.importNode(root, true);
  if (!svg.getAttribute("viewBox") && !(svg.getAttribute("width") && svg.getAttribute("height"))) { svg.setAttribute("width","2000"); svg.setAttribute("height","2000"); }
  else if (!svg.getAttribute("width")) { svg.setAttribute("width","2000"); svg.removeAttribute("height"); }
  host.appendChild(svg); document.body.appendChild(host);
  const sc = newScene(name, "SVG"); sc.units = null;
  try {
    const inv = svg.getScreenCTM().inverse();
    const els = svg.querySelectorAll("path,line,polyline,polygon,rect,circle,ellipse");
    for (const el of els){
      if (el.closest("defs,clipPath,mask,symbol,marker,pattern")) continue;
      const cs = getComputedStyle(el); if (cs.display==="none") continue;
      const col = svgColor(cs);
      let lname = "SVG"; for (let p=el.parentElement; p && p!==svg; p=p.parentElement){ const lab = p.getAttribute("inkscape:label") || p.getAttribute("id"); if (p.tagName.toLowerCase()==="g" && lab){ lname = lab; break; } }
      const M = inv.multiply(el.getScreenCTM());
      const T = (x,y)=>{ const q = new DOMPoint(x,y).matrixTransform(M); return [q.x, -q.y, 0]; };
      const tag = el.tagName.toLowerCase(); let polys=[], closed=false;
      if (tag==="line") polys=[[T(+el.getAttribute("x1")||0,+el.getAttribute("y1")||0), T(+el.getAttribute("x2")||0,+el.getAttribute("y2")||0)]];
      else if (tag==="polyline" || tag==="polygon"){ const n=(el.getAttribute("points")||"").trim().split(/[\s,]+/).map(Number); const pts=[]; for (let i=0;i+1<n.length;i+=2) pts.push(T(n[i],n[i+1])); polys=[pts]; closed = tag==="polygon"; }
      else if (tag==="rect" && !+el.getAttribute("rx") && !+el.getAttribute("ry")){ const x=+el.getAttribute("x")||0,y=+el.getAttribute("y")||0,w=+el.getAttribute("width")||0,h=+el.getAttribute("height")||0; polys=[[T(x,y),T(x+w,y),T(x+w,y+h),T(x,y+h)]]; closed=true; }
      else polys = samplePath(el, T);
      for (const pts of polys) addPoly(sc, lname, col, pts, closed || (tag!=="path" && (tag==="circle"||tag==="ellipse"||tag==="rect")));
    }
    // цвет слоя — по первому элементу
    const first = {}; for (const it of sc.items) if (!first[it.layer]) first[it.layer]=it.color;
    for (const [k,L] of sc.layers) if (first[k]) L.color = first[k];
  } finally { host.remove(); }
  return sc;
}
function svgColor(cs){
  let c = cs.stroke; if (!c || c==="none" || c==="transparent") c = cs.fill;
  const m = /rgba?\(([^)]+)\)/.exec(c||""); if (!m) return "rgb(230,233,238)";
  const p = m[1].split(",").map(s=>parseFloat(s)); return fixDark([p[0]|0,p[1]|0,p[2]|0]);
}
function samplePath(el, T){
  let len = 0; try { len = el.getTotalLength(); } catch(e){ return []; }
  if (!(len>0)) return [];
  const N = Math.min(2500, Math.max(8, Math.ceil(len/Math.max(len/2500, 0.5)))), step = len/N, polys=[]; let cur=[], last=null;
  for (let i=0;i<=N;i++){
    const p = el.getPointAtLength(i*step), q = T(p.x,p.y);
    if (last && Math.hypot(p.x-last.x,p.y-last.y) > step*1.6+1e-6){ if (cur.length>1) polys.push(cur); cur=[]; }
    cur.push(q); last = p;
  }
  if (cur.length>1) polys.push(cur);
  return polys;
}

/* ============ DWG (libredwg-web лежит в папке vendor/libredwg) ============ */
async function parseDWG(buf, name){
  let mod;
  try { mod = await import("./vendor/libredwg/lib/index.js"); }
  catch(e){
    console.error(e);
    throw new Error(location.protocol==="file:"
      ? "DWG читается только со страницы на сайте (адрес на GitHub Pages): при открытии файла двойным щелчком браузер блокирует модуль. Откройте адрес страницы или сохраните чертёж как DXF."
      : "Модуль чтения DWG не загрузился: папка vendor/libredwg должна лежать рядом с index.html. Запасной путь: сохраните чертёж как DXF.");
  }
  const { LibreDwg, Dwg_File_Type } = mod;
  let db;
  try {
    const lib = await LibreDwg.create();
    const dwg = lib.dwg_read_data(buf, Dwg_File_Type.DWG);
    if (!dwg) throw new Error("пустой результат");
    try { db = lib.convert(dwg); } finally { try { lib.dwg_free(dwg); } catch(e){} }
  } catch(e){
    console.error(e);
    throw new Error("DWG не прочитан (" + (e && e.message || e) + "). Возможно, версия файла не поддерживается. Сохраните чертёж как DXF.");
  }
  const sc = newScene(name, "DWG");
  const lays = (db.tables && db.tables.LAYER && db.tables.LAYER.entries) || [];
  const layerCol = new Map();
  for (const l of lays){
    const ci = Math.abs(l.colorIndex || 7); const col = fixDark(aciToRgb(ci>0 && ci<256 ? ci : 7));
    layerCol.set(l.name, col); layerOf(sc, l.name, col, !(l.frozen || l.off));
  }
  const blocks = new Map();
  for (const br of ((db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [])){
    if (br && br.name && !/^\*(Model|Paper)_Space/i.test(br.name)) blocks.set(br.name, br);
  }
  const ang = (a)=> Math.abs(a||0) > Math.PI*2+0.01 ? (a*Math.PI/180) : (a||0);
  const pt = (p, z)=> [p&&p.x||0, p&&p.y||0, (p&&p.z)||z||0];
  function emitDwg(e, ctx, depth){
    let layer = e.layer || "0"; if (layer==="0" && ctx.layer) layer = ctx.layer;
    if (!sc.layers.has(layer)) layerOf(sc, layer, layerCol.get(layer));
    const ci = e.colorIndex;
    let col = ctx.color || sc.layers.get(layer).color;
    if (ci > 0 && ci < 256) col = fixDark(aciToRgb(ci));
    else if (ci === 0 && ctx.color) col = ctx.color;
    else if (ci === 256 || ci === undefined) col = sc.layers.get(layer).color;
    const m = ctx.m, P = (p)=>{ const q=pt(p); return mApply(m,q[0],q[1],q[2]); };
    const PP = (x,y,z)=>mApply(m,x,y,z);
    switch (e.type){
      case "LINE": addPoly(sc, layer, col, [P(e.startPoint), P(e.endPoint)], false); break;
      case "LWPOLYLINE": {
        const v=e.vertices||[], z=e.elevation||0, closed=!!((e.flag||0)&512), pts=[];
        for (let i=0;i<v.length;i++){ const a=v[i], b=v[(i+1)%v.length];
          if (i===0) pts.push([a.x,a.y,z]);
          if (i<v.length-1) pts.push(...bulgePts([a.x,a.y],[b.x,b.y],a.bulge||0,z));
          else if (closed && a.bulge) pts.push(...bulgePts([a.x,a.y],[b.x,b.y],a.bulge,z).slice(0,-1)); }
        addPoly(sc, layer, col, pts.map(p=>PP(p[0],p[1],p[2])), closed); break;
      }
      case "POLYLINE2D": case "POLYLINE3D": {
        const fl=e.flag||0; if (fl & (16|64)) { sc.skipped.POLYLINE_MESH=(sc.skipped.POLYLINE_MESH||0)+1; break; }
        const v=e.vertices||[], closed=!!(fl&1), z0=e.elevation||0, pts=[];
        for (let i=0;i<v.length;i++){ const a=v[i], b=v[(i+1)%v.length];
          if (i===0) pts.push([a.x,a.y,a.z||z0]);
          if (i<v.length-1) pts.push(...bulgePts([a.x,a.y],[b.x,b.y],a.bulge||0,a.z||z0));
          else if (closed && a.bulge) pts.push(...bulgePts([a.x,a.y],[b.x,b.y],a.bulge,a.z||z0).slice(0,-1)); }
        addPoly(sc, layer, col, pts.map(p=>PP(p[0],p[1],p[2])), closed); break;
      }
      case "CIRCLE": { const c=pt(e.center); addPoly(sc, layer, col, arcPts(c[0],c[1],e.radius,0,Math.PI*2,c[2],96).map(p=>PP(p[0],p[1],p[2])), true); break; }
      case "ARC": { const c=pt(e.center); let a0=ang(e.startAngle), a1=ang(e.endAngle); if (a1<=a0) a1+=Math.PI*2; addPoly(sc, layer, col, arcPts(c[0],c[1],e.radius,a0,a1,c[2]).map(p=>PP(p[0],p[1],p[2])), false); break; }
      case "ELLIPSE": {
        const c=pt(e.center), mj=pt(e.majorAxisEndPoint), ra=e.axisRatio||1; let t0=e.startAngle||0, t1=e.endAngle==null?Math.PI*2:e.endAngle; if (t1<=t0) t1+=Math.PI*2;
        const n=Math.max(16, Math.ceil((t1-t0)/(Math.PI/32))), pts=[];
        for (let i=0;i<=n;i++){ const t=t0+(t1-t0)*i/n; pts.push(PP(c[0]+mj[0]*Math.cos(t)-mj[1]*ra*Math.sin(t), c[1]+mj[1]*Math.cos(t)+mj[0]*ra*Math.sin(t), c[2])); }
        addPoly(sc, layer, col, pts, false); break;
      }
      case "SPLINE": {
        const ctrl=(e.controlPoints||[]).map(p=>pt(p)), fit=(e.fitPoints||[]).map(p=>pt(p)), deg=e.degree||3, knots=e.knots||[];
        let pts = ctrl.length>deg && knots.length>=ctrl.length+deg+1 ? bsplinePoints(deg, knots, ctrl, Math.max(24, ctrl.length*8)) : (fit.length?fit:ctrl);
        addPoly(sc, layer, col, pts.map(p=>PP(p[0],p[1],p[2])), false); break;
      }
      case "3DFACE": { const q=[e.corner1,e.corner2,e.corner3,e.corner4||e.corner3].map(P); const u=q.filter((p,i)=>i===0||p.some((v,k)=>v!==q[i-1][k])); addPoly(sc, layer, col, u, true); break; }
      case "TEXT": case "MTEXT": {
        const p = P(e.startPoint || e.insertionPoint), sx=Math.hypot(m[0],m[1]);
        let rot = ang(e.rotation||0)*180/Math.PI; if (e.type==="MTEXT" && !e.rotation && e.direction) rot = Math.atan2(e.direction.y||0, e.direction.x||1)*180/Math.PI;
        addText(sc, layer, col, p[0], p[1], (e.textHeight||1)*sx, rot + Math.atan2(m[1],m[0])*180/Math.PI, cleanText(String(e.text||""))); break;
      }
      case "INSERT": case "DIMENSION": {
        if (depth > 8) break; const blk = blocks.get(e.name); if (!blk) break;
        let mm = m;
        if (e.type==="INSERT"){
          const sx=e.xScale||1, sy=e.yScale||1, rot=ang(e.rotation), c=Math.cos(rot), s=Math.sin(rot), ip=pt(e.insertionPoint), bp=pt(blk.basePoint);
          mm = mMul(m, mMul([1,0,0,1,ip[0],ip[1]], mMul([c*sx, s*sx, -s*sy, c*sy, 0,0], [1,0,0,1,-bp[0],-bp[1]])));
        }
        const sub = {m:mm, layer, color: (ci>0&&ci<256) ? col : ctx.color};
        for (const be of (blk.entities||[])) emitDwg(be, sub, depth+1);
        break;
      }
      default: sc.skipped[e.type]=(sc.skipped[e.type]||0)+1;
    }
  }
  for (const e of (db.entities||[])) emitDwg(e, {m:M_ID, layer:null, color:null}, 0);
  return sc;
}

function finalize(sc){
  let n=0, minx=1e300,miny=1e300,maxx=-1e300,maxy=-1e300;
  for (const it of sc.items){
    const pts = it.t==="p" ? it.pts : [[it.x,it.y,0]];
    let a=1e300,b=1e300,c=-1e300,d=-1e300;
    for (const p of pts){ if (p[0]<a)a=p[0]; if(p[0]>c)c=p[0]; if(p[1]<b)b=p[1]; if(p[1]>d)d=p[1]; }
    it.bb=[a,b,c,d]; n++;
    if(a<minx)minx=a; if(b<miny)miny=b; if(c>maxx)maxx=c; if(d>maxy)maxy=d;
  }
  if (!n) throw new Error("В файле не найдено линий, которые можно показать. Поддерживаются LINE, полилинии, окружности, дуги, эллипсы, сплайны, текст, блоки.");
  sc.bounds={minx,miny,maxx,maxy,w:maxx-minx,h:maxy-miny,diag:Math.hypot(maxx-minx,maxy-miny)||1};
  // устойчивые границы для «Вписать»: одиночные выбросы далеко от основной части чертежа не учитываем
  let r={minx,miny,maxx,maxy};
  if (sc.items.length>20){
    const cxs=sc.items.map(i=>(i.bb[0]+i.bb[2])/2).sort((a,b)=>a-b), cys=sc.items.map(i=>(i.bb[1]+i.bb[3])/2).sort((a,b)=>a-b);
    const q=(arr,p)=>arr[Math.min(arr.length-1,Math.max(0,Math.floor(arr.length*p)))];
    const ex=Math.max(q(cxs,.9)-q(cxs,.1),1e-9)*3, ey=Math.max(q(cys,.9)-q(cys,.1),1e-9)*3;
    const x0=q(cxs,.1)-ex, x1=q(cxs,.9)+ex, y0=q(cys,.1)-ey, y1=q(cys,.9)+ey;
    r={minx:1e300,miny:1e300,maxx:-1e300,maxy:-1e300};
    for (const it of sc.items){ const cx=(it.bb[0]+it.bb[2])/2, cy=(it.bb[1]+it.bb[3])/2; if (cx<x0||cx>x1||cy<y0||cy>y1) continue; r.minx=Math.min(r.minx,it.bb[0]); r.miny=Math.min(r.miny,it.bb[1]); r.maxx=Math.max(r.maxx,it.bb[2]); r.maxy=Math.max(r.maxy,it.bb[3]); }
    if (r.minx>r.maxx) r={minx,miny,maxx,maxy};
  }
  sc.fitB=r;
  // сетка для привязки
  const cell = sc.bounds.diag/150; sc.cell=cell; sc.grid=new Map();
  for (const it of sc.items) if (it.t==="p"){
    const step = it.pts.length>400 ? Math.ceil(it.pts.length/400) : 1;
    for (let i=0;i<it.pts.length;i+=step){ const p=it.pts[i], k=Math.floor(p[0]/cell)+","+Math.floor(p[1]/cell); (sc.grid.get(k)||sc.grid.set(k,[]).get(k)).push([p[0],p[1],it.layer]); }
    const e = it.pts[it.pts.length-1], k2=Math.floor(e[0]/cell)+","+Math.floor(e[1]/cell); (sc.grid.get(k2)||sc.grid.set(k2,[]).get(k2)).push([e[0],e[1],it.layer]);
  }
  return sc;
}

export const DRAWING_UNITS = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
/* разобрать файл чертежа: { layers: Map(имя → {name, color}), items: [{t:'p', layer, color, pts:[[x,y,z]…], closed}], units, bounds } */
export async function parseDrawing(ext, blob, name) {
  let sc;
  if (ext === 'dxf') sc = parseDXF(await blob.text(), name);
  else if (ext === 'svg') sc = parseSVG(await blob.text(), name);
  else if (ext === 'dwg') sc = await parseDWG(await blob.arrayBuffer(), name);
  else throw new Error('Чертёж: поддерживаются DXF, SVG и DWG.');
  return finalize(sc);
}
