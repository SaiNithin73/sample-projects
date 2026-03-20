// ─── CANVAS SETUP ───────────────────────────────────────────
var C = document.getElementById('c');
var X = C.getContext('2d', { alpha: false }); // opaque = faster compositing
var cur = document.getElementById('cur');
var tc = document.getElementById('tc');
var rib = document.getElementById('ribbon');
var ctrEl = document.getElementById('ctr');
var cntEl = document.getElementById('cnt');
var wbar = document.getElementById('wbar');

var W, H, t = 0;
var started = false, night = false;
var windOn = false, windStr = 0, windTarget = 0;
var petals = [], flies = [], trees = [];
var total = 0, noteShown = false, gustInt = null;
var mx = 0, my = 0;

// ─── PRE-BAKED PETAL SPRITES ────────────────────────────────
// Draw each petal size/color once to an offscreen canvas
// so per-frame draw is just drawImage (GPU blit) — no paths/gradients
var SPRITE_SIZES = [5, 7, 9, 11]; // 4 sizes
var PC = [
  ['#ffd4e0','#ff9db8','#e8607e'],
  ['#ffe8f0','#ffbed0','#ff96b2'],
  ['#fff0f5','#ffd8e8','#ffb8d0'],
  ['#fce4ec','#f8bbd0','#f48fb1'],
  ['#ffecf0','#ffc8d8','#ff9ab5']
];
var petalSprites = []; // [colIdx][sizeIdx] = {canvas,cx,cy}

function buildPetalSprites() {
  petalSprites = [];
  for (var ci = 0; ci < PC.length; ci++) {
    var colGroup = [];
    for (var si = 0; si < SPRITE_SIZES.length; si++) {
      var s = SPRITE_SIZES[si];
      var pad = 4;
      var dim = (s * 2 + pad) * 2;
      var oc = document.createElement('canvas');
      oc.width = oc.height = dim;
      var ox = oc.getContext('2d');
      var cx = dim / 2, cy = dim / 2;
      // 5 petals
      for (var p = 0; p < 5; p++) {
        ox.save();
        ox.translate(cx, cy);
        ox.rotate(p / 5 * Math.PI * 2);
        var g = ox.createRadialGradient(0, -s * .38, 0, 0, -s * .38, s * .9);
        g.addColorStop(0, PC[ci][0]);
        g.addColorStop(.55, PC[ci][1]);
        g.addColorStop(1, PC[ci][2] + '55');
        ox.fillStyle = g;
        ox.beginPath();
        ox.ellipse(0, -s * .55, s * .38, s * .7, 0, 0, Math.PI * 2);
        ox.fill();
        ox.restore();
      }
      // stamen centre
      ox.save();
      ox.translate(cx, cy);
      var cg = ox.createRadialGradient(0, 0, 0, 0, 0, s * .2);
      cg.addColorStop(0, '#fff8e0');
      cg.addColorStop(1, '#ffd4b0');
      ox.beginPath();
      ox.arc(0, 0, s * .2, 0, Math.PI * 2);
      ox.fillStyle = cg;
      ox.fill();
      ox.restore();
      colGroup.push({ canvas: oc, cx: cx, cy: cy, dim: dim });
    }
    petalSprites.push(colGroup);
  }
}

// ─── PRE-BAKED FIREFLY SPRITE ───────────────────────────────
var ffSprites = [null, null]; // [0]=warm [1]=cool
function buildFireflySprites() {
  var cols = [[255,230,160],[200,255,180]];
  ffSprites = cols.map(function(c) {
    var oc = document.createElement('canvas');
    oc.width = oc.height = 40;
    var ox = oc.getContext('2d');
    var g = ox.createRadialGradient(20,20,0, 20,20,18);
    g.addColorStop(0, 'rgba('+c[0]+','+c[1]+','+c[2]+',1)');
    g.addColorStop(.35,'rgba('+c[0]+','+c[1]+','+c[2]+',.5)');
    g.addColorStop(1, 'transparent');
    ox.fillStyle = g;
    ox.fillRect(0, 0, 40, 40);
    // bright core
    ox.fillStyle = 'rgba(255,255,240,.9)';
    ox.beginPath();
    ox.arc(20, 20, 2.5, 0, Math.PI * 2);
    ox.fill();
    return oc;
  });
}

// ─── OFFSCREEN TREE CACHE ────────────────────────────────────
// Each tree is rendered to its own offscreen canvas once (or on shake/resize)
// Per frame: just drawImage the cached canvas
function cacheTree(tree) {
  var pad = 24;
  // Canvas must cover the full tree: from root (tree.y) to highest branch tip
  // Find min Y among all branches
  var minY = tree.y;
  tree.br.forEach(function(b){ if(b.y1<minY)minY=b.y1; if(b.y2<minY)minY=b.y2; });
  var W2 = tree.r * 2.6 + pad * 2;
  var H2 = (tree.y - minY) + tree.r * 0.4 + pad * 2; // full height
  H2 = Math.max(H2, tree.r * 2.4);

  if (!tree.oc || tree.oc.width !== (W2|0) || tree.oc.height !== (H2|0)) {
    tree.oc = document.createElement('canvas');
    tree.oc.width  = W2 | 0;
    tree.oc.height = H2 | 0;
  }
  var ox = tree.oc.getContext('2d');
  ox.clearRect(0, 0, tree.oc.width, tree.oc.height);

  // lx,ly = where tree.x,tree.y maps inside this offscreen canvas
  var lx = tree.r + pad;
  var ly = H2 - pad;

  // ── Trunk bark gradient ──
  tree.br.forEach(function(b) {
    var d = b.d / 7;
    var r = 48+d*40|0, g2 = 22+d*18|0, bl = 14+d*12|0;
    if(b.d === 0) {
      // Main trunk — thicker, bark-coloured
      var tg = ox.createLinearGradient(
        b.x1-tree.x+lx-b.w, 0,
        b.x1-tree.x+lx+b.w, 0
      );
      tg.addColorStop(0,'rgb(38,18,10)');
      tg.addColorStop(.4,'rgb(72,36,20)');
      tg.addColorStop(.7,'rgb(55,26,14)');
      tg.addColorStop(1,'rgb(30,14,8)');
      ox.strokeStyle = tg;
    } else {
      ox.strokeStyle = 'rgb('+r+','+g2+','+bl+')';
    }
    ox.lineWidth = b.w;
    ox.lineCap = 'round';
    ox.beginPath();
    ox.moveTo(b.x1 - tree.x + lx, b.y1 - tree.y + ly);
    ox.lineTo(b.x2 - tree.x + lx, b.y2 - tree.y + ly);
    ox.stroke();
  });

  // ── Blossom clusters on branch tips — soft pink puffs ──
  tree.br.forEach(function(b) {
    if (b.d < 4) return;
    var r  = tree.r * (b.d>=6 ? .13 : .09);
    var bx = b.x2 - tree.x + lx;
    var by = b.y2 - tree.y + ly;
    var g  = ox.createRadialGradient(bx, by, 0, bx, by, r);
    g.addColorStop(0,  'rgba(255,175,205,.70)');
    g.addColorStop(.45,'rgba(255,155,185,.28)');
    g.addColorStop(1,  'transparent');
    ox.fillStyle = g;
    ox.beginPath();
    ox.arc(bx, by, r, 0, Math.PI * 2);
    ox.fill();
  });

  // ── Overall canopy glow ──
  var trunkTopLY = tree.trunkTop - tree.y + ly;
  var cgx = lx, cgy = trunkTopLY - tree.r * .45, cgr = tree.r * 1.05;
  var cg = ox.createRadialGradient(cgx, cgy, 0, cgx, cgy, cgr);
  cg.addColorStop(0,   'rgba(255,190,215,.12)');
  cg.addColorStop(.6,  'rgba(255,175,200,.04)');
  cg.addColorStop(1,   'transparent');
  ox.fillStyle = cg;
  ox.beginPath();
  ox.arc(cgx, cgy, cgr, 0, Math.PI * 2);
  ox.fill();

  tree.ocLX = lx;
  tree.ocLY = ly;
  tree.ocW  = W2 | 0;
  tree.ocH  = H2 | 0;
  tree.dirty = false;
}

// ─── STATIC BG CACHE ─────────────────────────────────────────
var bgCache = null, bgDirty = true;
function buildBgCache() {
  if (!bgCache) bgCache = document.createElement('canvas');
  bgCache.width = W; bgCache.height = H;
  var ox = bgCache.getContext('2d');

  var sky = ox.createLinearGradient(0, 0, 0, H);
  if (night) {
    sky.addColorStop(0, '#170816'); sky.addColorStop(.4, '#2b0e26');
    sky.addColorStop(.7, '#381330'); sky.addColorStop(1, '#281020');
  } else {
    sky.addColorStop(0, '#fce0ee'); sky.addColorStop(.28, '#f8cfe4');
    sky.addColorStop(.6, '#f5dcf0'); sky.addColorStop(1, '#f0d8ec');
  }
  ox.fillStyle = sky; ox.fillRect(0, 0, W, H);

  if (night) {
    // Moon
    var mg = ox.createRadialGradient(W*.76,H*.09,0, W*.76,H*.09,H*.16);
    mg.addColorStop(0,'rgba(255,242,212,.64)'); mg.addColorStop(.15,'rgba(255,235,200,.2)');
    mg.addColorStop(.5,'rgba(195,175,238,.05)'); mg.addColorStop(1,'transparent');
    ox.fillStyle=mg; ox.beginPath(); ox.arc(W*.76,H*.09,H*.16,0,Math.PI*2); ox.fill();
    ox.fillStyle='rgba(255,248,220,.86)'; ox.beginPath(); ox.arc(W*.76,H*.09,H*.04,0,Math.PI*2); ox.fill();
    // Stars (static - fixed positions)
    ox.fillStyle='rgba(255,244,255,.68)';
    [[.10,.055],[.22,.038],[.40,.085],[.56,.048],[.63,.115],[.28,.14],
     [.16,.175],[.86,.075],[.80,.155],[.93,.038],[.04,.095],[.48,.028],
     [.35,.06],[.72,.09],[.88,.14]
    ].forEach(function(s){ ox.beginPath(); ox.arc(s[0]*W,s[1]*H,1,0,Math.PI*2); ox.fill(); });
    mtnOx(ox,'rgba(55,16,55,.48)',[.75,.60,.52,.65,.58,.50,.63,.68,.75],H*.86);
    mtnOx(ox,'rgba(40,8,45,.64)',[.82,.70,.74,.68,.72,.66,.70,.76,.82],H*.91);
  } else {
    var sg = ox.createRadialGradient(W*.72,H*.068,0, W*.72,H*.068,H*.2);
    sg.addColorStop(0,'rgba(255,212,185,.48)'); sg.addColorStop(.38,'rgba(255,198,208,.13)'); sg.addColorStop(1,'transparent');
    ox.fillStyle=sg; ox.beginPath(); ox.arc(W*.72,H*.068,H*.2,0,Math.PI*2); ox.fill();
    mtnOx(ox,'rgba(212,165,200,.25)',[.75,.60,.52,.65,.58,.50,.63,.68,.75],H*.86);
    mtnOx(ox,'rgba(228,192,218,.17)',[.82,.70,.74,.68,.72,.66,.70,.76,.82],H*.91);
  }
  // Ground blush
  var gg = ox.createLinearGradient(0,H*.84,0,H);
  gg.addColorStop(0,'transparent'); gg.addColorStop(.28,'rgba(255,198,218,.16)'); gg.addColorStop(1,'rgba(255,182,208,.30)');
  ox.fillStyle=gg; ox.fillRect(0,H*.84,W,H*.16);

  bgDirty = false;
}
function mtnOx(ox, color, heights, base) {
  var pts=[0,.15,.28,.42,.55,.68,.80,.92,1];
  ox.fillStyle=color; ox.beginPath(); ox.moveTo(0,base);
  pts.forEach(function(px,i){ ox.lineTo(px*W, H*heights[i]); });
  ox.lineTo(W,H); ox.lineTo(0,H); ox.closePath(); ox.fill();
}

// ─── TREE BUILD ──────────────────────────────────────────────
function buildTrees() {
  trees = [];
  [{f:.18,s:.80,tk:.20},{f:.50,s:1,tk:.22},{f:.82,s:.84,tk:.20}].forEach(function(p) {
    var tx = W * p.f;
    var ty = H;
    var trunkH = H * p.tk;
    var tr = Math.min(W,H) * 0.22 * p.s;
    var br = [], tips = [];
    // Branch from top of trunk upward — tree fills top half of screen
    gBranch(br, tips, tx, ty - trunkH, -Math.PI/2, tr * 0.84, 0, 7);
    // Explicit trunk segment
    br.unshift({x1:tx, y1:ty+10, x2:tx, y2:ty-trunkH, d:0, w:Math.min(20, tr*0.075)});
    var tree = {
      x:tx, y:ty,
      trunkTop: ty - trunkH,  // Y where canopy starts
      r:tr, br:br, tips:tips,
      sh:0, sd:.87,
      oc:null, dirty:true, ocLX:0, ocLY:0, ocW:0, ocH:0
    };
    cacheTree(tree);
    trees.push(tree);
  });
}
function gBranch(br, tips, x, y, a, len, d, mx2){
  if(d >= mx2 || len < 5) return;
  var ex = x + Math.cos(a)*len, ey = y + Math.sin(a)*len;
  br.push({x1:x, y1:y, x2:ex, y2:ey, d:d, w:Math.max(.5,(mx2-d)*1.6)});
  // Collect deep branch tips as petal spawn points
  if(d >= mx2-2) tips.push({x:ex, y:ey});
  var sp = .34 + d*.04;
  gBranch(br, tips, ex, ey, a-sp+(Math.random()-.5)*.26, len*.67, d+1, mx2);
  gBranch(br, tips, ex, ey, a+sp+(Math.random()-.5)*.26, len*.64, d+1, mx2);
  if(d < 3) gBranch(br, tips, ex, ey, a+(Math.random()-.5)*.2, len*.5, d+2, mx2);
}

function resize() {
  W=C.width=innerWidth; H=C.height=innerHeight;
  bgDirty = true;
  buildTrees();
  buildPetalSprites();
  buildFireflySprites();
}
window.addEventListener('resize', resize);

// ─── PETAL ───────────────────────────────────────────────────
function Petal(tree, burst) {
  // Pick a random branch tip as spawn origin — petals fall FROM the tree
  var tip;
  if(tree.tips && tree.tips.length > 0) {
    tip = tree.tips[Math.random()*tree.tips.length|0];
  } else {
    tip = {x: tree.x, y: tree.trunkTop};
  }
  // Small random offset around that tip
  var jitter = burst ? 18 : 10;
  this.x = tip.x + (Math.random()-.5)*jitter;
  this.y = tip.y + (Math.random()-.5)*jitter;
  // Initial velocity — petals gently drift off tips
  this.vx = (Math.random()-.5)*1.4 + (windOn ? windStr*.5 : 0);
  this.vy = burst ? (-1.8-Math.random()*2.5) : (-0.3+Math.random()*0.8);
  this.rot = Math.random()*Math.PI*2;
  this.rv  = (Math.random()-.5)*.08;
  this.ci  = Math.random()*PC.length|0;
  this.si  = Math.random()*SPRITE_SIZES.length|0;
  this.sz  = SPRITE_SIZES[this.si];
  this.ph  = Math.random()*Math.PI*2;
  this.wb  = .015+Math.random()*.036;
  this.life = 0; this.gnd = false;
  this.gy  = H*(.88+Math.random()*.08);
}
Petal.prototype.upd = function() {
  if (this.gnd) { this.life++; return; }
  this.life++;
  if (windOn) this.vx += windStr * .016;
  this.vx += Math.sin(this.life*this.wb+this.ph)*.032;
  this.vy += .034; this.vx *= .983; this.vy = Math.min(this.vy,3.6);
  this.x += this.vx; this.y += this.vy;
  this.rot += this.rv + Math.sin(this.life*.034)*.011;
  if (this.y >= this.gy) { this.y=this.gy; this.gnd=true; this.vx=0; }
  if (this.x < -50) this.x=W+50;
  if (this.x > W+50) this.x=-50;
};
Petal.prototype.alp = function() {
  if (!this.gnd) return Math.min(this.life/18,1);
  var f=(this.life-45)/260; return f>0?Math.max(1-f,0):1;
};
Petal.prototype.draw = function() {
  var a = this.alp(); if (a < .02) return;
  var sp = petalSprites[this.ci][this.si];
  X.save();
  X.translate(this.x, this.y);
  X.rotate(this.rot);
  X.globalAlpha = a;
  X.drawImage(sp.canvas, -sp.cx, -sp.cy);
  X.restore();
};
Petal.prototype.dead = function() { return this.gnd && this.alp()<.015; };

// ─── FIREFLY ─────────────────────────────────────────────────
function Firefly() {
  var tree = trees[Math.random()*trees.length|0];
  this.tx = tree.x;
  // Orbit around the canopy centre, not the root
  this.ty = tree.trunkTop - tree.r * .3;
  this.tr = tree.r;
  this.oR = tree.r*(.25+Math.random()*.9);
  this.oA = Math.random()*Math.PI*2;
  this.oS = (Math.random()<.5?1:-1)*(.007+Math.random()*.011);
  this.bp = Math.random()*Math.PI*2;
  this.ba = 6+Math.random()*15;
  this.x  = this.tx+Math.cos(this.oA)*this.oR;
  this.y  = this.ty+Math.sin(this.bp)*this.ba;
  this.vx=0; this.vy=0;
  this.life=0; this.max=250+Math.random()*350;
  this.ph=Math.random()*Math.PI*2;
  this.si=Math.random()<.5?0:1;
}
Firefly.prototype.upd = function() {
  this.life++; this.oA+=this.oS;
  var tx2 = this.tx + Math.cos(this.oA)*this.oR;
  var ty2 = this.ty + Math.sin(this.oA*.5+this.bp)*this.ba;
  if (windOn) { this.vx+=windStr*.05; this.vy+=(Math.random()-.5)*.07; }
  else { this.vx+=(tx2-this.x)*.038; this.vy+=(ty2-this.y)*.038; }
  this.vx*=.91; this.vy*=.91;
  this.x+=this.vx; this.y+=this.vy;
  if(this.x>W+60)this.x=-60; if(this.x<-60)this.x=W+60;
  if(this.y<0)this.y=H; if(this.y>H)this.y=0;
};
Firefly.prototype.alp = function() {
  var f=this.life/this.max;
  return Math.sin(f*Math.PI)*(night?.82:.38);
};
Firefly.prototype.draw = function() {
  var a=this.alp(); if(a<.02)return;
  var pulse=.65+.35*Math.sin(this.life*.075+this.ph);
  var sc=pulse*0.8; // scale 0..1
  var spr=ffSprites[this.si];
  X.save();
  X.globalAlpha=a;
  X.translate(this.x,this.y);
  X.scale(sc,sc);
  X.drawImage(spr,-20,-20);
  X.restore();
};
Firefly.prototype.dead = function() { return this.life>=this.max; };

// ─── HELPERS ─────────────────────────────────────────────────
function spawnHeart(x,y){
  var el=document.createElement('div'); el.className='fh';
  el.style.left=x+'px'; el.style.top=y+'px';
  el.textContent=['🌸','💕','✿','♡','🌷'][Math.random()*5|0];
  document.body.appendChild(el);
  setTimeout(function(){el.remove();},2500);
}
function markStarted(){
  if(!started){
    started=true;
    tc.classList.add('gone');
    ctrEl.classList.add('show');
    setTimeout(function(){rib.classList.add('show');},2400);
  }
}
function doPetals(ti,count,burst){
  markStarted();
  var tree=trees[ti!=null?ti:Math.random()*trees.length|0];
  for(var i=0;i<count;i++) petals.push(new Petal(tree,burst));
  total+=count;
  if(petals.length>600) petals.splice(0,petals.length-600); // lower cap
  cntEl.textContent=total.toLocaleString();
}
function doAll(count,burst){
  for(var i=0;i<trees.length;i++) doPetals(i,count,burst);
}

// ─── DRAW TREE (from cache) ───────────────────────────────────
function drawTree(tree){
  if(tree.dirty) cacheTree(tree);
  var dx=0;
  if(tree.sh>.04){
    dx=tree.sh*Math.sin(Date.now()*.044)*5;
    tree.sh*=tree.sd;
    if(tree.sh<.018) tree.sh=0;
  }
  // Anchor: tree.x,tree.y is the root. ocLX,ocLY is where root maps in canvas.
  var destX = tree.x - tree.ocLX + dx;
  var destY = tree.y - tree.ocLY;
  X.drawImage(tree.oc, destX, destY);
}

// ─── WIND STREAMERS (pre-compute positions) ───────────────────
function drawWind(){
  if(!windOn||windStr<.5)return;
  X.save();
  X.globalAlpha=Math.min(windStr/4,1)*(.022+.015*Math.sin(t*.07));
  X.fillStyle=night?'rgba(195,165,252,1)':'rgba(255,175,215,1)';
  for(var i=0;i<4;i++){
    var wx=((t*windStr*1.1+i*(W/4))%W+W)%W;
    var wy=H*.05+Math.sin(t*.022+i*1.3)*H*.36;
    X.beginPath();
    X.ellipse(wx,wy,68+i*10,2+i*.35,0,0,Math.PI*2);
    X.fill();
  }
  X.restore();
}

// ─── MAIN LOOP ────────────────────────────────────────────────
function loop(){
  requestAnimationFrame(loop);
  t++;

  // Wind smooth ramp
  if(windOn) windStr+=(windTarget-windStr)*.04;
  else windStr*=.90;
  if(windStr<.01) windStr=0;

  // Background — only redraw when dirty (mode change or resize)
  if(bgDirty) buildBgCache();
  X.drawImage(bgCache,0,0);

  // Trees (back-to-front)
  drawTree(trees[0]);
  drawTree(trees[2]);
  drawTree(trees[1]);

  // Fireflies — spawn rate limited
  if(t%12===0 && flies.length<(night?32:18)) flies.push(new Firefly());

  // Update & draw in single pass (avoid two forEach)
  var liveFlies=[], livePetals=[];
  for(var i=0;i<flies.length;i++){
    flies[i].upd(); flies[i].draw();
    if(!flies[i].dead()) liveFlies.push(flies[i]);
  }
  flies=liveFlies;

  for(var j=0;j<petals.length;j++){
    petals[j].upd(); petals[j].draw();
    if(!petals[j].dead()) livePetals.push(petals[j]);
  }
  petals=livePetals;

  // Auto-drip petals when wind is on
  if(windOn&&windStr>1&&t%30===0) doAll(2+(windStr|0),false);

  drawWind();

  // Cursor — direct set, zero lag
  cur.style.left=mx+'px';
  cur.style.top=my+'px';
}

// ─── INPUT ────────────────────────────────────────────────────
document.addEventListener('mousemove',function(e){mx=e.clientX;my=e.clientY;},{passive:true});
document.addEventListener('touchmove',function(e){mx=e.touches[0].clientX;my=e.touches[0].clientY;},{passive:true});

function onTree(x, y, tree){
  // Check if click is within the bounding rectangle of the full tree
  var left   = tree.x - tree.r * 1.1;
  var right  = tree.x + tree.r * 1.1;
  var top    = tree.trunkTop - tree.r;   // canopy top
  var bottom = tree.y;                   // root
  // Also allow a slim trunk click zone
  var onTrunk = x > tree.x-18 && x < tree.x+18 && y > tree.trunkTop && y < tree.y;
  return onTrunk || (x>left && x<right && y>top && y<bottom);
}

window.addEventListener('pointerdown',function(e){
  if(e.target.closest('#controls')||e.target.closest('#ln'))return;
  var hit=-1;
  trees.forEach(function(tree,i){if(onTree(e.clientX,e.clientY,tree))hit=i;});
  if(hit>=0){
    trees[hit].sh=1.3;
    doPetals(hit, 28+(Math.random()*16|0), false);  // more petals on touch
  } else {
    var nd=Infinity,ni=0;
    trees.forEach(function(tree,i){var d=Math.hypot(e.clientX-tree.x,e.clientY-tree.y);if(d<nd){nd=d;ni=i;}});
    doPetals(ni,6+(Math.random()*5|0),false);
  }
  if(Math.random()<.13) spawnHeart(e.clientX-7,e.clientY-7);
});

// ─── CONTROLS ─────────────────────────────────────────────────
document.getElementById('bcl').addEventListener('click',function(){
  petals=[];flies=[];total=0;cntEl.textContent='0';
  windOn=false;windStr=0;windTarget=0;clearInterval(gustInt);
  document.getElementById('bwn').classList.remove('on');
  document.getElementById('bwn').textContent='🌬 Wind';
  wbar.classList.remove('show');started=false;
  tc.classList.remove('gone');ctrEl.classList.remove('show');rib.classList.remove('show');
});

document.getElementById('bwn').addEventListener('click',function(){
  windOn=!windOn;
  if(windOn){
    windTarget=2.6+Math.random()*2.4;windStr=.1;
    this.classList.add('on');this.textContent='🌬 Stop Wind';
    wbar.classList.add('show');markStarted();
    gustInt=setInterval(function(){if(windOn)windTarget=2+Math.random()*3;},4000);
  } else {
    clearInterval(gustInt);windTarget=0;
    this.classList.remove('on');this.textContent='🌬 Wind';
    wbar.classList.remove('show');
  }
});

document.getElementById('bsh').addEventListener('click',function(){
  markStarted();
  trees.forEach(function(tree){tree.sh=1.6;});
  for(var i=0;i<8;i++)(function(ii){setTimeout(function(){doAll(18,ii>5);},ii*60);})(i);
  setTimeout(function(){
    for(var h=0;h<4;h++)(function(hh){setTimeout(function(){
      var tree=trees[Math.random()*trees.length|0];
      spawnHeart(tree.x+(Math.random()-.5)*160,tree.y-tree.r*.5);
    },hh*100);})(h);
  },180);
  if(!noteShown){noteShown=true;setTimeout(function(){document.getElementById('ln').classList.add('show');},3200);}
});

document.getElementById('bng').addEventListener('click',function(){
  night=!night;
  bgDirty=true; // force bg rebuild
  this.textContent=night?'☀️ Day':'🌙 Night';
});
document.getElementById('bnt').addEventListener('click',function(){document.getElementById('ln').classList.add('show');});
document.getElementById('lnc').addEventListener('click',function(){document.getElementById('ln').classList.remove('show');});

var la={x:0,y:0,z:0};
window.addEventListener('devicemotion',function(e){
  var a=e.accelerationIncludingGravity;if(!a)return;
  var d=Math.abs(a.x-la.x)+Math.abs(a.y-la.y)+Math.abs(a.z-la.z);
  if(d>16){trees.forEach(function(tree){tree.sh=1.3;});doAll(25,true);}
  la={x:a.x,y:a.y,z:a.z};
});

// ─── INIT ─────────────────────────────────────────────────────
resize();
loop();