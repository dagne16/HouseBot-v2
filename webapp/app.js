// ============================================================
// app.js — HouseBot v2 Web App
// ============================================================
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

let users = [], schedule = [], spinType = "cleaning";
let isSpinning = false, selectedResult = null, currentRotation = 0;

const COLORS = ["#2563ff","#7c3aed","#059669","#dc2626","#d97706","#0891b2","#be185d","#4f46e5"];

window.addEventListener("DOMContentLoaded", async () => {
  await loadData();
  if (users.length === 4) { showScreen("screen-main"); renderMain(); }
  else if (users.length > 0) { showScreen("screen-registration"); renderRegistration(); }
  else showScreen("screen-onboarding");
});

async function loadData() {
  try {
    users    = await fetch("/api/users").then(r => r.json());
    schedule = await fetch("/api/schedule").then(r => r.json());
    computeScore();
  } catch (e) { users = []; schedule = []; }
}

function computeScore() {
  const cleans = users.reduce((s,u) => s+(u.cleaningCount||0), 0);
  const shops  = users.reduce((s,u) => s+(u.shoppingCount||0), 0);
  const score  = cleans*100 + shops*70;
  const el = document.getElementById("score-number");
  if (el) animateCounter(el, 0, score, 1000);
  const cc = document.getElementById("clean-count"); if (cc) cc.textContent = cleans;
  const sc = document.getElementById("shop-count");  if (sc) sc.textContent = shops;
}

function animateCounter(el, from, to, dur) {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now-start)/dur, 1);
    el.textContent = Math.round(from+(to-from)*(1-Math.pow(1-t,3))).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ── Navigation ─────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
  window.scrollTo(0,0);
  if (id === "screen-spin") setTimeout(() => drawWheel(currentRotation), 80);
}

function goHome() { showScreen("screen-main"); renderMain(); }
function goToRegistration() { showScreen("screen-registration"); renderRegistration(); }
function gotoSchedule() { showScreen("screen-schedule"); renderSchedule(); }

// ── Tap hero ───────────────────────────────────────────────
document.addEventListener("click", e => {
  const hero = e.target.closest("#hero-tap");
  if (!hero) return;
  const burst = document.createElement("div");
  burst.className = "tap-burst";
  burst.textContent = "+1";
  const rect = hero.getBoundingClientRect();
  burst.style.cssText = `position:absolute;left:${e.clientX-rect.left-15}px;top:${e.clientY-rect.top-20}px`;
  hero.style.position = "relative";
  hero.appendChild(burst);
  setTimeout(() => burst.remove(), 800);
});

// ── Registration ───────────────────────────────────────────
function renderRegistration() {
  const grid    = document.getElementById("roommates-grid");
  const countEl = document.getElementById("reg-count");
  if (countEl) countEl.textContent = `${users.length}/4`;
  if (!grid) return;
  grid.innerHTML = "";

  for (let i = 0; i < 4; i++) {
    const slot = document.createElement("div");
    slot.className = "roommate-slot" + (users[i] ? " filled" : "");
    if (users[i]) {
      const initials = users[i].name.split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2);
      slot.innerHTML = `
        <div class="slot-avatar" style="background:linear-gradient(135deg,${COLORS[i]},${COLORS[(i+2)%8]})">${initials}</div>
        <span class="slot-name">${users[i].name}</span>
        ${users[i].username ? `<span class="slot-sub">@${users[i].username}</span>` : ""}
        <button class="btn-remove" onclick="removeRoommate('${users[i].name}')">✕ Remove</button>
      `;
    } else {
      slot.innerHTML = `<span class="slot-empty">+</span><span class="slot-empty-label">Slot ${i+1}</span>`;
    }
    grid.appendChild(slot);
  }

  const form   = document.getElementById("add-user-form");
  const banner = document.getElementById("all-registered-banner");
  if (users.length >= 4) {
    if (form)   form.style.display = "none";
    if (banner) banner.classList.remove("hidden");
  } else {
    if (form)   form.style.display = "";
    if (banner) banner.classList.add("hidden");
  }
}

async function addRoommate() {
  const name     = document.getElementById("input-name")?.value.trim();
  const username = document.getElementById("input-username")?.value.trim().replace("@","");
  const password = document.getElementById("input-password")?.value.trim();
  if (!name)     { showToast("⚠️ Enter a name"); return; }
  if (!password) { showToast("⚠️ Enter owner password"); return; }
  if (users.length >= 4) { showToast("❌ Already 4 roommates!"); return; }

  const res  = await fetch("/api/register", {
    method: "POST", headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ name, telegramId: username || `webapp_${Date.now()}`, password }),
  });
  const data = await res.json();
  if (data.ok) {
    await loadData();
    document.getElementById("input-name").value     = "";
    document.getElementById("input-username").value = "";
    document.getElementById("input-password").value = "";
    renderRegistration();
    showToast(`✅ ${name} added!`);
  } else {
    showToast(`❌ ${data.error || "Failed"}`);
  }
}

async function removeRoommate(name) {
  const password = prompt(`🔐 Owner password to remove ${name}:`);
  if (!password) return;
  const res  = await fetch("/api/remove", {
    method: "POST", headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ name, password }),
  });
  const data = await res.json();
  if (data.ok) { await loadData(); renderRegistration(); showToast(`🗑️ ${name} removed!`); }
  else showToast(`❌ ${data.error || "Wrong password"}`);
}

// ── Main ───────────────────────────────────────────────────
function renderMain() {
  const nameEl = document.getElementById("profile-name");
  if (nameEl) nameEl.textContent = tg?.initDataUnsafe?.user?.first_name || "HouseBot";
  const xp = document.getElementById("xp-fill");
  if (xp) xp.style.width = `${(users.length/4)*100}%`;
  computeScore();
}

// ── Spin wheel ─────────────────────────────────────────────
function setSpinType(type) {
  spinType = type;
  document.getElementById("btn-type-cleaning").classList.toggle("active", type==="cleaning");
  document.getElementById("btn-type-shopping").classList.toggle("active", type==="shopping");
  drawWheel(currentRotation);
}

function getNames() {
  return users.length ? users.map(u=>u.name) : ["Alice","Bob","Carol","Dan"];
}

function drawWheel(rot) {
  const canvas = document.getElementById("spin-wheel");
  if (!canvas) return;
  const ctx  = canvas.getContext("2d");
  const names = getNames();
  const n    = names.length;
  const cx   = canvas.width/2, cy = canvas.height/2, r = cx-10;
  const arc  = (2*Math.PI)/n;
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Outer glow ring
  ctx.save();
  ctx.beginPath(); ctx.arc(cx,cy,r+6,0,2*Math.PI);
  ctx.strokeStyle = "rgba(37,99,255,0.5)"; ctx.lineWidth = 10; ctx.stroke();
  ctx.restore();

  for (let i=0; i<n; i++) {
    const sa = rot + i*arc, ea = sa+arc;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,sa,ea); ctx.closePath();
    ctx.fillStyle = COLORS[i%COLORS.length]; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.save();
    ctx.translate(cx,cy); ctx.rotate(sa+arc/2);
    ctx.textAlign = "right"; ctx.fillStyle = "#fff";
    ctx.font = `bold ${n>5?13:15}px Rajdhani,sans-serif`;
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 4;
    ctx.fillText(names[i].split(" ")[0], r-12, 5);
    ctx.restore();
  }
  // Center circle
  ctx.beginPath(); ctx.arc(cx,cy,36,0,2*Math.PI);
  ctx.fillStyle = "#090c2a"; ctx.fill();
  ctx.strokeStyle = "rgba(37,99,255,0.7)"; ctx.lineWidth = 3; ctx.stroke();
}

function spinWheel() {
  if (isSpinning) return;
  const names = getNames();
  isSpinning = true;
  document.getElementById("spin-result")?.classList.add("hidden");

  const arc = (2*Math.PI)/names.length;
  let winners, finalRot;

  if (spinType === "cleaning") {
    const idx = Math.floor(Math.random()*names.length);
    winners = [names[idx]];
    const target = -(idx*arc+arc/2)+Math.PI/2;
    finalRot = currentRotation + (5+Math.random()*3)*2*Math.PI + target - (currentRotation%(2*Math.PI));
  } else {
    const shuffled = [...names].sort(()=>Math.random()-0.5);
    winners = shuffled.slice(0,2);
    const idx = names.indexOf(winners[0]);
    const target = -(idx*arc+arc/2)+Math.PI/2;
    finalRot = currentRotation + (5+Math.random()*3)*2*Math.PI + target - (currentRotation%(2*Math.PI));
  }

  selectedResult = { type: spinType, winners };
  const dur = 4000+Math.random()*1500, t0 = performance.now(), r0 = currentRotation;

  (function animate(now) {
    const t = Math.min((now-t0)/dur, 1);
    const ease = 1-Math.pow(1-t,4);
    drawWheel(r0+(finalRot-r0)*ease);
    if (t<1) requestAnimationFrame(animate);
    else { currentRotation = finalRot; isSpinning = false; showResult(winners); }
  })(performance.now());
}

function showResult(winners) {
  const el = document.getElementById("spin-result"); if (!el) return;
  document.getElementById("result-emoji").textContent   = spinType==="cleaning"?"🧹":"🛒";
  document.getElementById("result-heading").textContent = spinType==="cleaning"?"Cleaner Selected!":"Shopping Team!";
  document.getElementById("result-names").textContent   = winners.join(" & ");
  el.classList.remove("hidden");
  spawnConfetti();
  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
}

function spawnConfetti() {
  const c = document.getElementById("result-confetti"); if (!c) return;
  c.innerHTML = "";
  const cols = ["#2563ff","#22c55e","#f59e0b","#7c3aed","#00d4ff","#ec4899"];
  for (let i=0;i<40;i++) {
    const p = document.createElement("div");
    p.className = "confetti-piece";
    p.style.cssText = `left:${Math.random()*100}%;background:${cols[Math.floor(Math.random()*cols.length)]};animation-duration:${0.8+Math.random()*1.2}s;animation-delay:${Math.random()*0.5}s`;
    c.appendChild(p); setTimeout(()=>p.remove(),2000);
  }
}

async function confirmSpin() {
  if (!selectedResult) return;
  try {
    await fetch("/api/spin-result",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({type:selectedResult.type, selected:selectedResult.winners}),
    });
    await loadData();
    showToast("✅ Saved! Group notified 📬");
    resetSpin();
    setTimeout(()=>{ gotoSchedule(); }, 1500);
  } catch(e) { showToast("❌ Failed to save."); }
}

function resetSpin() {
  selectedResult = null;
  document.getElementById("spin-result")?.classList.add("hidden");
}

// ── Schedule ───────────────────────────────────────────────
function renderSchedule() {
  const list = document.getElementById("schedule-list"); if (!list) return;
  list.innerHTML = "";
  if (!schedule || schedule.length===0) {
    list.innerHTML=`<div class="empty-state"><div style="font-size:48px">🎰</div><p>No schedule yet.<br/>Spin the wheel first!</p></div>`;
    return;
  }
  const badges = ["🥇","🥈","🥉","4️⃣"];
  schedule.forEach((item,i)=>{
    const card = document.createElement("div");
    card.className = `schedule-card${i===0?" sched-card-0":""}`;
    card.style.animationDelay = `${i*80}ms`;
    const initials = item.name.split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2);
    card.innerHTML=`
      <div class="sched-rank" style="background:linear-gradient(135deg,${COLORS[i]},${COLORS[(i+2)%8]})">${initials}</div>
      <div class="sched-info">
        <div class="sched-name">${item.name}</div>
        <div class="sched-dates">
          <span>🧹 ${item.cleaningDate} (${item.cleaningDay||""})</span>
          <span>🛒 ${item.shoppingDate} (${item.shoppingDay||""})</span>
        </div>
      </div>
      <div class="sched-badge">${badges[i]||"📋"}</div>
    `;
    list.appendChild(card);
  });
}

// ── Toast ──────────────────────────────────────────────────
function showToast(msg, dur=3000) {
  const t = document.getElementById("toast"); if (!t) return;
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(window._tt);
  window._tt = setTimeout(()=>t.classList.add("hidden"), dur);
}
