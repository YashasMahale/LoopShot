(() => {
  "use strict";

  // ---------- state ----------
  const S = { READY: 0, PLAY: 1, DYING: 2, OVER: 3 };
  let state = S.READY;

  const urlParams = new URLSearchParams(window.location.search);
  const MODES = ['easy', 'hard', 'nightmare'];
  const requestedMode = (urlParams.get('mode') || (window.LS ? LS.lastMode() : 'easy')).toLowerCase();
  const mode = MODES.includes(requestedMode) ? requestedMode : 'easy';
  if (window.LS) LS.setLastMode(mode);

  let score = 0;
  // Each mode has its own best; don't borrow the best from another mode
  const loadBest = () => parseInt(localStorage.getItem(`ls_best_${mode}`) || '0', 10) || 0;
  const saveBest = v => {
    localStorage.setItem(`ls_best_${mode}`, v);
    const currentMax = Math.max(
      parseInt(localStorage.getItem('ls_best_easy') || '0', 10),
      parseInt(localStorage.getItem('ls_best_hard') || '0', 10),
      parseInt(localStorage.getItem('ls_best_nightmare') || '0', 10),
      v
    );
    localStorage.setItem('ls_best', currentMax);
  };
  let best = loadBest();
  let bestAtStart = best;

  let angle = -Math.PI / 2;      // ball angle
  let dir = 1;                   // orbit direction
  let speed = 2.1;               // rad/s
  let zoneCenter = Math.PI / 3;  // target arc center
  let zoneHalf = 0.46;           // target arc half-width (rad)
  let perfectStreak = 0;
  let runPerfects = 0, runBestCombo = 0;
  let passedBest = false;
  let shake = 0;
  let inputLock = 0;             // tiny debounce after state changes
  let freezeUntil = 0;           // hit-stop on perfect hits
  let dyingT = 0;                // slow-motion time after a miss
  let zonePulse = 0;             // zone "breath" after a hit
  let ringPulse = 0;             // ring thickness kick on hit
  const trailHistory = [];
  let hideOverTimer = null;
  let skin = window.LS ? LS.skin() : { ball: '#fff', trail: '#fff', glow: null, len: 1 };

  // difficulty curves
  const speedFor = s => {
    if (mode === 'easy') return Math.min(1.6 + s * 0.02, 3.5);
    if (mode === 'hard') return Math.min(2.4 + s * 0.08, 5.5);
    // nightmare: speed doubles every tap
    return Math.min(1.2 * Math.pow(2, s), 25.0);
  };
  const zoneFor = s => {
    if (mode === 'easy') return Math.max(0.5 - s * 0.003, 0.2);
    if (mode === 'hard') return Math.max(0.42 - s * 0.008, 0.12);
    // nightmare: target shrinks by 1/8th every tap
    return Math.max(0.45 * Math.pow(0.875, s), 0.06);
  };

  // level colors (a new world colour every 5 points)
  const HUES = [8, 268, 196, 327, 152, 222, 36, 290, 178, 348];
  const hueFor = s => HUES[Math.floor(s / 5) % HUES.length];
  const setWorldColor = s => {
    const h = hueFor(s);
    document.body.style.background = `hsl(${h} 72% 54%)`;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', `hsl(${h} 72% 54%)`);
  };

  // ---------- canvas ----------
  const cv = document.getElementById('game');
  const cx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1, R = 0, CX = 0, CY = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    R = Math.min(W, H) * 0.33;
    CX = W / 2; CY = H / 2;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- effects ----------
  const parts = [];
  function burst(x, y, color, n = 14, power = 1, gravity = 300) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (60 + Math.random() * 180) * power;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, r: 2 + Math.random() * 3.5, color, g: gravity, rect: false });
    }
  }
  const CONFETTI = ['#ffd166', '#ffffff', '#00f0ff', '#ff5a8a', '#7be0a0', '#16121f'];
  function confetti(n = 90) {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: Math.random() * W, y: -20 - Math.random() * H * 0.4,
        vx: (Math.random() - 0.5) * 120, vy: 80 + Math.random() * 160,
        life: 1.6 + Math.random(), r: 4 + Math.random() * 4,
        color: CONFETTI[i % CONFETTI.length], g: 60, rect: true, rot: Math.random() * 6, vr: (Math.random() - .5) * 10
      });
    }
  }
  // the hit target breaks into ink shards
  function shatterZone(center, half) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = center - half + (2 * half) * (i / (n - 1));
      const x = CX + Math.cos(a) * R, y = CY + Math.sin(a) * R;
      const out = 80 + Math.random() * 140;
      parts.push({ x, y, vx: Math.cos(a) * out, vy: Math.sin(a) * out, life: 0.9, r: 3 + Math.random() * 3, color: '#16121f', g: 200, rect: true, rot: Math.random() * 6, vr: (Math.random() - .5) * 14 });
    }
  }
  const ripples = [];
  function ripple(color = 'rgba(255,255,255,', strength = 1) { ripples.push({ t: 0, color, strength }); }

  // floating "+1 / +2" text at the ball
  const floats = [];
  function floatText(text, x, y, big) { floats.push({ text, x, y, t: 0, big }); }

  // ---------- audio (generated, no assets) ----------
  let AC = null;
  function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } return AC; }
  const isMuted = () => localStorage.getItem('ls_mute') === 'true';
  function tone(freq, dur = 0.08, type = 'square', vol = 0.12, when = 0) {
    if (isMuted()) return;
    const scale = parseInt(localStorage.getItem('ls_volume') || '50', 10) / 100;
    if (scale <= 0) return;
    const a = ac(); if (!a) return;
    const t = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol * scale, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // Notes climb a pentatonic scale as the run goes on, so a good run "plays a tune"
  const PENTA = [0, 2, 4, 7, 9];
  const note = (i, base = 392) => base * Math.pow(2, (PENTA[i % 5] + 12 * Math.floor(i / 5)) / 12);
  const sfx = {
    hit(n) { tone(note(n % 15), .08, 'square', .09); },
    perfect(n, streak) {
      tone(note((n % 15) + 2), .07, 'square', .09);
      tone(note((n % 15) + 4), .1, 'triangle', .08, .05);
      if (streak >= 3) tone(note((n % 15) + 7), .12, 'triangle', .06, .1);
    },
    miss() { tone(160, .18, 'sawtooth', .14); tone(90, .3, 'sawtooth', .12, .06); },
    start() { tone(440, .06, 'square', .08); tone(660, .08, 'square', .08, .06); },
    level() { tone(523, .06, 'square', .09); tone(659, .06, 'square', .09, .05); tone(784, .1, 'square', .09, .1); },
    best() { [523, 659, 784, 1047].forEach((f, i) => tone(f, .12, 'triangle', .1, i * .08)); },
    tick() { tone(1200, .025, 'square', .03); },
    levelUp() { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, .14, 'triangle', .09, i * .07)); }
  };
  const haptic = k => { if (window.LS) LS.haptic(k); };

  // ---------- DOM refs ----------
  const $ = id => document.getElementById(id);
  const elScore = $('score'), elCombo = $('combo'), elPop = $('pop'),
    elOver = $('over'), elFinal = $('finalScore'), elHudBest = $('hudBest'),
    elBest = $('bestChip'), elClose = $('closeCall'), elFlash = $('flash'),
    elReady = $('ready'), elMiss = $('missLabel'), elToast = $('toast');

  // ---------- server: personal + global bests ----------
  let globalBestScore = 0;

  async function fetchPersonalBest() {
    const token = localStorage.getItem('ls_token');
    if (!token) return;
    try {
      const res = await fetch(API_BASE + '/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        if (data.bestScores) {
          localStorage.setItem('ls_best_easy', data.bestScores.easy || 0);
          localStorage.setItem('ls_best_hard', data.bestScores.hard || 0);
          localStorage.setItem('ls_best_nightmare', data.bestScores.nightmare || 0);
          const maxScore = Math.max(data.bestScores.easy || 0, data.bestScores.hard || 0, data.bestScores.nightmare || 0);
          localStorage.setItem('ls_best', maxScore);
          best = Math.max(best, loadBest());
          if (state !== S.PLAY) { bestAtStart = best; updateHudBest(); }
        }
      }
    } catch (e) { console.warn("Failed to fetch personal best:", e); }
  }

  async function fetchGlobalBest() {
    try {
      const res = await fetch(API_BASE + '/api/scores');
      if (res.ok) {
        const scores = await res.json();
        if (scores[mode]) updateGlobalHUD(scores[mode]);
      }
    } catch (e) { console.warn("Failed to fetch global best:", e); }
  }

  function updateGlobalHUD(bestObj) {
    if (!bestObj) return;
    globalBestScore = bestObj.score;
    const el = $('globalBestChip');
    if (!el) return;
    el.textContent = `GLOBAL ${globalBestScore}`;
    el.classList.toggle('beaten', score > 0 && score >= globalBestScore);
  }

  async function submitScore(mode, score) {
    if (score <= 0) return;
    const token = localStorage.getItem('ls_token');
    if (!token) return; // scores are saved only when logged in
    const username = localStorage.getItem('ls_user') || 'Player';
    try {
      const res = await fetch(API_BASE + '/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ mode, score, username })
      });
      if (res.ok) {
        const data = await res.json();
        updateGlobalHUD(data.globalBest);
      }
    } catch (e) { console.warn("Failed to submit score:", e); }
  }

  // ---------- HUD helpers ----------
  function popText(t, cls) {
    elPop.textContent = t;
    elPop.className = '';
    void elPop.offsetWidth;
    elPop.className = 'go' + (cls ? ' ' + cls : '');
  }
  function bumpScore() {
    elScore.textContent = score;
    elScore.classList.remove('bump'); void elScore.offsetWidth;
    elScore.classList.add('bump');
  }
  function updateHudBest() {
    if (!elHudBest) return;
    if (score > bestAtStart && bestAtStart > 0) {
      elHudBest.textContent = 'NEW BEST';
      elHudBest.classList.add('beaten');
    } else {
      elHudBest.textContent = bestAtStart > 0 ? `BEST ${bestAtStart}` : (score > 0 ? 'FIRST RUN' : 'SET A BEST');
      elHudBest.classList.remove('beaten');
    }
  }
  let toastTimer = null;
  function toast(msg) {
    elToast.textContent = msg;
    elToast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elToast.classList.remove('on'), 2200);
  }

  // sound toggle
  const btnSound = $('btnSound');
  const SOUND_ON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
  const SOUND_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';
  function renderSound() { if (btnSound) btnSound.innerHTML = isMuted() ? SOUND_OFF : SOUND_ON; }
  renderSound();
  if (btnSound) btnSound.addEventListener('click', e => {
    e.stopPropagation();
    localStorage.setItem('ls_mute', isMuted() ? 'false' : 'true');
    renderSound();
    resumeAudio(); sfx.tick();
  });
  $('btnMenu').addEventListener('click', e => { e.stopPropagation(); location.href = '/index.html'; });

  // ---------- game flow ----------
  function norm(a) { a %= Math.PI * 2; return a < 0 ? a + Math.PI * 2 : a; }
  function angDist(a, b) {
    let d = Math.abs(norm(a) - norm(b));
    return d > Math.PI ? Math.PI * 2 - d : d;
  }
  // signed distance from ball to zone along the direction of travel (+ = zone still ahead)
  function signedAhead(a, z) {
    let d = norm(z) - norm(a);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d * dir;
  }

  function placeZone() {
    const lead = (Math.PI / 2) + Math.random() * Math.PI;
    zoneCenter = norm(angle + dir * lead);
  }

  function resetRun() {
    score = 0; perfectStreak = 0; runPerfects = 0; runBestCombo = 0; passedBest = false;
    speed = speedFor(0); zoneHalf = zoneFor(0);
    angle = -Math.PI / 2; dir = Math.random() < .5 ? 1 : -1;
    placeZone();
    setWorldColor(0);
    best = Math.max(best, loadBest());
    bestAtStart = best;
    skin = window.LS ? LS.skin() : skin;
    trailHistory.length = 0;
    elScore.textContent = '0';
    elCombo.classList.remove('on', 'fever');
    document.body.classList.remove('fever');
    updateHudBest();
    const badge = $('game-mode-badge');
    badge.textContent = mode + ' MODE';
    badge.className = 'mode-badge-game ' + mode;
  }

  function showReady() {
    resetRun();
    state = S.READY;
    elReady.classList.add('on');
    const sub = $('readySub');
    if (sub) sub.textContent = best > 0 ? `Your best: ${best} — beat it!` : 'Tap when the ball crosses the dark arc';
    const ms = window.LS ? LS.missions().filter(m => !m.done) : [];
    const elM = $('readyMission');
    if (elM) elM.textContent = ms.length ? `Today: ${ms[0].text} (${ms[0].progress}/${ms[0].goal})` : '';
  }

  function startGame() {
    resetRun();
    elReady.classList.remove('on');
    elOver.classList.add('hidden');
    clearTimeout(hideOverTimer);
    hideOverTimer = setTimeout(() => { elOver.style.display = 'none'; }, 250);
    elScore.style.display = 'block';
    elHudBest.style.display = 'block';
    state = S.PLAY;
    inputLock = performance.now() + 120;
    sfx.start();
    haptic('light');
    fetchPersonalBest();
    fetchGlobalBest();
  }

  function die(ahead) {
    state = S.DYING;
    dyingT = 0;
    shake = 16;
    sfx.miss(); haptic('error');
    elFlash.classList.remove('go'); void elFlash.offsetWidth; elFlash.classList.add('go');
    burst(CX + Math.cos(angle) * R, CY + Math.sin(angle) * R, '#16121f', 26, 1.4);
    elCombo.classList.remove('on', 'fever');
    document.body.classList.remove('fever');
    // Tell the player what went wrong
    elMiss.textContent = ahead > 0 ? 'TOO EARLY' : 'TOO LATE';
    endGame(angDist(angle, zoneCenter) <= zoneHalf * 1.9);
  }

  function endGame(nearMiss) {
    const token = localStorage.getItem('ls_token');
    const isNewBest = score > best;
    if (isNewBest) { best = score; saveBest(best); }

    // progression
    const ev = window.LS ? LS.recordRun({ mode, score, perfects: runPerfects, bestCombo: runBestCombo, isNewBest: isNewBest && score > 0 }) : null;

    // Fill the game-over card
    elFinal.textContent = '0';
    elBest.textContent = (isNewBest && score > 0 ? 'NEW BEST ' : 'BEST ') + best;
    elBest.classList.toggle('new', isNewBest && score > 0);
    let closeMsg = '';
    if (!isNewBest && best > 0 && score > 0 && best - score <= 5) closeMsg = `Only ${best - score + 1} away from a new best!`;
    else if (!isNewBest && nearMiss) closeMsg = 'SO CLOSE — you were a hair off!';
    elClose.textContent = closeMsg;
    elClose.style.display = closeMsg ? 'block' : 'none';
    $('statPerfects').textContent = runPerfects;
    $('statCombo').textContent = runBestCombo;
    $('statLevel').textContent = Math.floor(score / 5) + 1;

    const guestCard = $('guestScoreCard');
    guestCard.style.display = (!token && score > 0) ? 'flex' : 'none';

    elScore.style.display = 'none';
    elHudBest.style.display = 'none';
    clearTimeout(hideOverTimer);

    // Show the card after a short slow-motion beat
    setTimeout(() => {
      state = S.OVER;
      elOver.style.display = 'flex';
      requestAnimationFrame(() => elOver.classList.remove('hidden'));
      inputLock = performance.now() + 380;
      countUp(score, isNewBest && score > 0);
      if (ev) animateXp(ev);
    }, 520);

    if (score > 0 && token) submitScore(mode, score);
    else fetchGlobalBest();
  }

  function countUp(target, celebrate) {
    if (target <= 0) { elFinal.textContent = '0'; return; }
    const t0 = performance.now(), dur = Math.min(700, 200 + target * 25);
    let shown = -1;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      const v = Math.round(target * (1 - Math.pow(1 - k, 3)));
      if (v !== shown) { shown = v; elFinal.textContent = v; if (v % 2 === 0) sfx.tick(); }
      if (k < 1) requestAnimationFrame(step);
      else if (celebrate) { confetti(); sfx.best(); haptic('success'); }
    };
    requestAnimationFrame(step);
  }

  function animateXp(ev) {
    const fill = $('xpFill'), lvl = $('xpLevel'), gain = $('xpGain'), list = $('xpEvents');
    const lines = [];
    if (ev.streakBonus) lines.push(`🔥 ${ev.streak}-day streak · +${ev.streakBonus} XP`);
    ev.completed.forEach(t => lines.push(`✓ Mission done: ${t} · +30 XP`));
    if (ev.allDone) lines.push('★ All daily missions done · +50 XP');
    ev.newSkins.forEach(s => lines.push(`🎨 New ball unlocked: ${s.name}`));
    list.innerHTML = lines.map(l => `<div>${l}</div>`).join('');

    gain.textContent = `+${ev.xp} XP`;
    lvl.textContent = `LV ${ev.before.level}`;
    fill.style.transition = 'none';
    fill.style.width = (ev.before.pct * 100) + '%';
    void fill.offsetWidth;
    fill.style.transition = '';
    setTimeout(() => {
      if (ev.levelUp) {
        fill.style.width = '100%';
        setTimeout(() => {
          fill.style.transition = 'none';
          fill.style.width = '0%';
          void fill.offsetWidth;
          fill.style.transition = '';
          lvl.textContent = `LV ${ev.after.level} · LEVEL UP!`;
          lvl.classList.remove('up'); void lvl.offsetWidth; lvl.classList.add('up');
          fill.style.width = (ev.after.pct * 100) + '%';
          sfx.levelUp(); haptic('success');
        }, 650);
      } else {
        fill.style.width = (ev.after.pct * 100) + '%';
      }
    }, 300);
  }

  function tap() {
    const now = performance.now();
    if (now < inputLock) return;

    if (state === S.READY) { startGame(); return; }
    if (state === S.DYING) return;
    if (state === S.OVER) { startGame(); return; }

    // playing: judge the tap
    const d = angDist(angle, zoneCenter);
    const grace = 0.045; // ball radius forgiveness
    if (d <= zoneHalf + grace) {
      const perfect = d <= zoneHalf * 0.34;
      const px = CX + Math.cos(angle) * R, py = CY + Math.sin(angle) * R;
      const prevScore = score;
      shatterZone(zoneCenter, zoneHalf);

      if (perfect) {
        perfectStreak++; runPerfects++;
        runBestCombo = Math.max(runBestCombo, perfectStreak);
        score += 2;
        sfx.perfect(score, perfectStreak); haptic('medium');
        burst(px, py, '#ffffff', 22, 1.3);
        ripple('rgba(255,255,255,', 1.4);
        floatText('+2', px, py, true);
        freezeUntil = now + 55;
        ringPulse = 1;
        if (perfectStreak >= 2) {
          elCombo.textContent = (perfectStreak >= 3 ? '🔥 ' : '') + 'PERFECT ×' + perfectStreak;
          elCombo.classList.add('on');
          elCombo.classList.remove('bump'); void elCombo.offsetWidth; elCombo.classList.add('bump');
        }
        elCombo.classList.toggle('fever', perfectStreak >= 3);
        document.body.classList.toggle('fever', perfectStreak >= 3);
        if (perfectStreak === 3) popText('ON FIRE!', 'hot');
        else if (perfectStreak === 5) popText('UNSTOPPABLE!', 'hot');
        else if (perfectStreak === 8) popText('GODLIKE!', 'hot');
        else popText('PERFECT');
      } else {
        perfectStreak = 0;
        score += 1;
        sfx.hit(score); haptic('light');
        burst(px, py, '#ffffff', 10, 0.9);
        ripple('rgba(255,255,255,', 0.7);
        floatText('+1', px, py, false);
        ringPulse = 0.5;
        elCombo.classList.remove('on', 'fever');
        document.body.classList.remove('fever');
      }
      zonePulse = 1;
      bumpScore();

      // passed personal best mid-run
      let poppedBest = false;
      if (!passedBest && bestAtStart > 0 && score > bestAtStart) {
        passedBest = true; poppedBest = true;
        popText('NEW BEST!', 'gold');
        sfx.best(); haptic('success');
        confetti(60);
      }
      updateHudBest();

      const prevLevel = Math.floor(prevScore / 5);
      const newLevel = Math.floor(score / 5);
      if (newLevel > prevLevel) {
        setWorldColor(score); sfx.level();
        if (!poppedBest) popText('LEVEL ' + (newLevel + 1));
        ripple('rgba(255,255,255,', 2.2);
      }

      dir *= -1;
      speed = speedFor(score);
      zoneHalf = zoneFor(score);
      placeZone();
    } else {
      die(signedAhead(angle, zoneCenter));
    }
  }

  const resumeAudio = () => { const a = ac(); if (a && a.state === 'suspended') a.resume(); };

  window.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Let buttons handle their own clicks
    if (e.target.closest('button, a, .guest-score-card')) return;
    resumeAudio();
    tap();
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'Enter') {
      if (e.target.closest && e.target.closest('button, a, input')) return;
      e.preventDefault();
      if (e.repeat) return;
      resumeAudio();
      tap();
    } else if (e.code === 'Escape') {
      location.href = '/index.html';
    }
  });
  window.addEventListener('contextmenu', e => e.preventDefault());

  $('btnRetry').addEventListener('click', e => { e.stopPropagation(); resumeAudio(); inputLock = 0; tap(); });

  $('btnShare').addEventListener('click', async e => {
    e.stopPropagation();
    const text = `I scored ${score} in LoopShot (${mode.toUpperCase()} mode) 🎯 Can you beat it?`;
    const url = 'https://project-tgtho.vercel.app';
    try {
      if (navigator.share) { await navigator.share({ title: 'LoopShot', text, url }); return; }
    } catch (err) { if (err && err.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Copied — paste it to your friends!'); }
    catch (err) { toast(text); }
  });

  $('btnGuestLogin').addEventListener('click', e => {
    e.stopPropagation();
    if (score > 0) localStorage.setItem('ls_pending_score', JSON.stringify({ mode, score }));
    location.href = '/index.html?auth=login';
  });

  // ---------- render ----------
  let last = null;
  let smoothedDt = null;
  let clock = 0;

  function trailColor(i, n, alpha) {
    if (skin.trail === 'rainbow') return `hsla(${(clock * 160 + i * 14) % 360} 95% 70% / ${alpha})`;
    const c = skin.trail;
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function frame(now) {
    if (last === null) { last = now; requestAnimationFrame(frame); return; }
    const rawDt = Math.min((now - last) / 1000, 0.1);
    last = now;
    smoothedDt = smoothedDt === null ? rawDt : (rawDt > 0 ? smoothedDt * 0.85 + rawDt * 0.15 : smoothedDt);
    let dt = Math.min(smoothedDt, 0.033);
    clock += dt;

    const frozen = now < freezeUntil;
    let ballDt = frozen ? 0 : dt;
    if (state === S.DYING) { dyingT += dt; ballDt = dt * Math.max(0.05, 0.3 - dyingT * 0.5); }

    if (state === S.PLAY || state === S.DYING) angle = norm(angle + dir * speed * ballDt);
    if (state === S.READY) angle = norm(angle + dir * 0.6 * dt);

    const sx = shake > 0 ? (Math.random() - .5) * shake : 0;
    const sy = shake > 0 ? (Math.random() - .5) * shake : 0;
    shake = Math.max(0, shake - 60 * dt);
    zonePulse = Math.max(0, zonePulse - dt * 4);
    ringPulse = Math.max(0, ringPulse - dt * 5);

    cx.clearRect(0, 0, W, H);
    cx.save();
    cx.translate(sx, sy);

    const trackR = R, lw = Math.max(10, R * 0.085);
    const fever = perfectStreak >= 3 && state === S.PLAY;

    // ripples from hits
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.t += dt * 1.6;
      if (rp.t >= 1) { ripples.splice(i, 1); continue; }
      cx.beginPath();
      cx.arc(CX, CY, trackR + rp.t * R * 0.55 * rp.strength, 0, Math.PI * 2);
      cx.strokeStyle = rp.color + (0.45 * (1 - rp.t)) + ')';
      cx.lineWidth = lw * (1 - rp.t) * 0.8;
      cx.stroke();
    }

    // track
    cx.beginPath();
    cx.arc(CX, CY, trackR, 0, Math.PI * 2);
    cx.strokeStyle = fever ? 'rgba(255,255,255,.42)' : 'rgba(255,255,255,.30)';
    cx.lineWidth = lw + ringPulse * 6; cx.lineCap = 'round';
    cx.stroke();

    // level progress (inner thin ring: 5 points per level)
    if (state !== S.READY) {
      const into = (score % 5) / 5;
      const innerR = trackR - lw * 1.35;
      cx.beginPath();
      cx.arc(CX, CY, innerR, 0, Math.PI * 2);
      cx.strokeStyle = 'rgba(22,18,31,.12)';
      cx.lineWidth = 4;
      cx.stroke();
      if (into > 0) {
        cx.beginPath();
        cx.arc(CX, CY, innerR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * into);
        cx.strokeStyle = 'rgba(255,255,255,.75)';
        cx.lineWidth = 4;
        cx.stroke();
      }
    }

    // target zone (ink), softly breathing in when it appears
    const grow = 1 - zonePulse * 0.6;
    const zh = zoneHalf * grow;
    cx.beginPath();
    cx.arc(CX, CY, trackR, zoneCenter - zh, zoneCenter + zh);
    cx.strokeStyle = '#16121f';
    cx.lineWidth = lw + 4;
    cx.stroke();

    // perfect window highlight inside the zone
    cx.beginPath();
    cx.arc(CX, CY, trackR, zoneCenter - zh * 0.34, zoneCenter + zh * 0.34);
    cx.strokeStyle = 'rgba(255,255,255,.14)';
    cx.lineWidth = lw * 0.35;
    cx.stroke();

    // zone center tick (the "perfect" mark)
    const tx = CX + Math.cos(zoneCenter) * trackR, ty = CY + Math.sin(zoneCenter) * trackR;
    cx.beginPath();
    cx.arc(tx, ty, lw * (0.26 + 0.06 * Math.sin(clock * 8)), 0, Math.PI * 2);
    cx.fillStyle = 'rgba(255,255,255,.9)';
    cx.fill();

    // ball + motion trail
    const bx = CX + Math.cos(angle) * trackR, by = CY + Math.sin(angle) * trackR;
    if (state === S.PLAY || state === S.READY) {
      trailHistory.push({ angle, size: lw * 0.62, alpha: fever ? 0.55 : 0.38 });
      if (trailHistory.length > 80) trailHistory.shift();
    }
    const fade = 3.5 / ((skin.len || 1) * (fever ? 1.6 : 1));
    for (let i = trailHistory.length - 1; i >= 0; i--) {
      const t = trailHistory[i];
      t.alpha -= dt * fade;
      t.size *= 0.975;
      if (t.alpha <= 0) { trailHistory.splice(i, 1); continue; }
      cx.beginPath();
      cx.arc(CX + Math.cos(t.angle) * trackR, CY + Math.sin(t.angle) * trackR, t.size, 0, Math.PI * 2);
      cx.fillStyle = fever && skin.trail !== 'rainbow'
        ? `hsla(${(clock * 200 + i * 10) % 360} 95% 72% / ${t.alpha})`
        : trailColor(i, trailHistory.length, t.alpha);
      cx.fill();
    }

    const pulse = skin.pulse ? 1 + 0.08 * Math.sin(clock * 10) : 1;
    const ballR = lw * 0.62 * pulse * (state === S.READY ? 1 + 0.06 * Math.sin(clock * 5) : 1);
    if (skin.glow || fever) {
      cx.shadowColor = fever ? '#ffffff' : skin.glow;
      cx.shadowBlur = fever ? 26 : 16;
    } else {
      cx.shadowColor = 'rgba(22,18,31,.35)'; cx.shadowBlur = 8; cx.shadowOffsetY = 3;
    }
    cx.beginPath();
    cx.arc(bx, by, ballR, 0, Math.PI * 2);
    cx.fillStyle = skin.ball;
    cx.fill();
    cx.shadowBlur = 0; cx.shadowOffsetY = 0;
    if (skin.ring) {
      cx.lineWidth = 2.5; cx.strokeStyle = '#ffffff'; cx.stroke();
    }

    // particles
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt * (p.rect && p.g < 100 ? 0.6 : 1.8);
      if (p.life <= 0 || p.y > H + 40) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += p.g * dt;
      cx.globalAlpha = Math.min(1, Math.max(p.life, 0));
      cx.fillStyle = p.color;
      if (p.rect) {
        p.rot += p.vr * dt;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot);
        cx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        cx.restore();
      } else {
        cx.beginPath(); cx.arc(p.x, p.y, p.r * Math.min(1, p.life), 0, Math.PI * 2); cx.fill();
      }
    }
    cx.globalAlpha = 1;

    // floating score text
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.t += dt * 1.6;
      if (f.t >= 1) { floats.splice(i, 1); continue; }
      const dx = (f.x - CX), dy = (f.y - CY), len = Math.hypot(dx, dy) || 1;
      const off = 30 + f.t * 40;
      cx.globalAlpha = 1 - f.t * f.t;
      cx.font = `${f.big ? 26 : 20}px Bungee, sans-serif`;
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillStyle = f.big ? '#ffffff' : 'rgba(255,255,255,.9)';
      cx.fillText(f.text, f.x + dx / len * off, f.y + dy / len * off);
    }
    cx.globalAlpha = 1;

    cx.restore();
    requestAnimationFrame(frame);
  }

  // Test hook for automated play-testing (only with ?debug in the URL)
  if (urlParams.has('debug')) window.__loopshot = () => ({ state, angle, zoneCenter, zoneHalf, score, d: angDist(angle, zoneCenter) });

  // A brand-new tab gets the "tap to start" screen; retries skip it
  showReady();
  fetchPersonalBest();
  fetchGlobalBest();
  requestAnimationFrame(frame);
})();
