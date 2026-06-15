(() => {
  "use strict";

  // ---------- state ----------
  const S = { PLAY: 1, OVER: 2 };
  let state = S.PLAY;

  // Get active mode
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode') || 'easy'; // easy, hard, nightmare

  let score = 0;
  let mute = localStorage.getItem('ls_mute') === 'true';
  const loadBest = () => parseInt(localStorage.getItem(`ls_best_${mode}`) || localStorage.getItem('ls_best') || '0', 10);
  const saveBest = v => {
    localStorage.setItem(`ls_best_${mode}`, v);
    // Keep overall ls_best updated
    const currentMax = Math.max(
      parseInt(localStorage.getItem('ls_best_easy') || '0', 10),
      parseInt(localStorage.getItem('ls_best_hard') || '0', 10),
      parseInt(localStorage.getItem('ls_best_nightmare') || '0', 10),
      v
    );
    localStorage.setItem('ls_best', currentMax);
  };
  let best = loadBest();

  let angle = -Math.PI / 2;      // ball angle
  let dir = 1;                 // orbit direction
  let speed = 2.1;             // rad/s
  let zoneCenter = Math.PI / 3;  // target arc center
  let zoneHalf = 0.46;         // target arc half-width (rad)
  let perfectStreak = 0;
  let lastMissNear = false;
  let shake = 0;
  let inputLock = 0;           // tiny debounce after state changes
  const trailHistory = [];     // dynamic trail history for smooth motion trail
  let trailTimer = 0;

  // difficulty curves
  const speedFor = s => {
    if (mode === 'easy') {
      return Math.min(1.6 + s * 0.02, 3.5);
    } else if (mode === 'hard') {
      return Math.min(2.4 + s * 0.08, 5.5);
    } else {
      // nightmare mode: speed doubles every tap
      return Math.min(1.2 * Math.pow(2, s), 25.0);
    }
  };

  const zoneFor = s => {
    if (mode === 'easy') {
      return Math.max(0.5 - s * 0.003, 0.2);
    } else if (mode === 'hard') {
      return Math.max(0.42 - s * 0.008, 0.12);
    } else {
      // nightmare mode: correct bar decreases by 1/8th every tap
      return Math.max(0.45 * Math.pow(0.875, s), 0.06);
    }
  };

  // level colors
  const HUES = [8, 268, 196, 327, 152, 222, 36, 290, 178, 348];
  const hueFor = s => HUES[Math.floor(s / 5) % HUES.length];
  const setWorldColor = s => {
    document.body.style.background = `hsl(${hueFor(s)} 72% 54%)`;
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

  // ---------- particles ----------
  const parts = [];
  function burst(x, y, color, n = 14, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (60 + Math.random() * 180) * power;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, r: 2 + Math.random() * 3.5, color });
    }
  }

  // ---------- audio (no assets, generated) ----------
  let AC = null;
  function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } return AC; }
  function tone(freq, dur = 0.08, type = 'square', vol = 0.12, when = 0) {
    const isMuted = localStorage.getItem('ls_mute') === 'true';
    if (isMuted) return;
    const volSetting = parseInt(localStorage.getItem('ls_volume') || '50', 10);
    const scale = volSetting / 100;
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
  const sfx = {
    hit(n) { tone(320 + Math.min(n, 20) * 22, .07, 'square', .1); },
    perfect(n) { tone(540 + n * 30, .06, 'square', .1); tone(810 + n * 30, .09, 'square', .09, .05); },
    miss() { tone(160, .18, 'sawtooth', .14); tone(90, .25, 'sawtooth', .12, .06); },
    start() { tone(440, .06, 'square', .08); tone(660, .08, 'square', .08, .06); },
    level() { tone(523, .06, 'square', .09); tone(659, .06, 'square', .09, .05); tone(784, .1, 'square', .09, .1); }
  };
  const buzz = ms => { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { } };

  // ---------- DOM refs ----------
  const $ = id => document.getElementById(id);
  const elScore = $('score'), elCombo = $('combo'), elPop = $('pop'),
    elOver = $('over'), elFinal = $('finalScore'),
    elBest = $('bestChip'), elClose = $('closeCall'), elFlash = $('flash');

  function popText(t) {
    elPop.textContent = t;
    elPop.classList.remove('go'); void elPop.offsetWidth;
    elPop.classList.add('go');
  }
  function bumpScore() {
    elScore.textContent = score;
    elScore.classList.remove('bump'); void elScore.offsetWidth;
    elScore.classList.add('bump');
  }

  // ---------- game flow ----------
  function placeZone() {
    const lead = (Math.PI / 2) + Math.random() * Math.PI;
    zoneCenter = norm(angle + dir * lead);
  }
  function startGame() {
    score = 0; perfectStreak = 0; lastMissNear = false;
    speed = speedFor(0); zoneHalf = zoneFor(0);
    angle = -Math.PI / 2; dir = Math.random() < .5 ? 1 : -1;
    placeZone();
    setWorldColor(0);
    elOver.classList.add('hidden');
    setTimeout(() => { elOver.style.display = 'none'; }, 250);
    elScore.style.display = 'block';
    elScore.textContent = '0';
    elCombo.classList.remove('on');
    state = S.PLAY;
    inputLock = performance.now() + 120;
    // reload settings in case they changed in main menu
    mute = localStorage.getItem('ls_mute') === 'true';
    sfx.start();
    trailHistory.length = 0;

    // Update game mode HUD badge style and text
    const elModeBadge = document.getElementById('game-mode-badge');
    if (elModeBadge) {
      elModeBadge.textContent = mode + ' MODE';
      elModeBadge.className = 'mode-badge-game ' + mode;
    }
  }
  function endGame(nearMiss) {
    state = S.OVER;
    shake = 14;
    sfx.miss(); buzz(60);
    elFlash.classList.remove('go'); void elFlash.offsetWidth; elFlash.classList.add('go');
    burst(CX + Math.cos(angle) * R, CY + Math.sin(angle) * R, '#16121f', 26, 1.4);
    trailHistory.length = 0;

    const isNewBest = score > best;
    if (isNewBest) { best = score; saveBest(best); }

    elFinal.textContent = score;
    elBest.textContent = (isNewBest ? 'NEW BEST ' : 'BEST ') + best;
    elBest.classList.toggle('new', isNewBest);
    elClose.style.display = (nearMiss && !isNewBest) ? 'block' : 'none';

    elScore.style.display = 'none';
    elCombo.classList.remove('on');
    elOver.style.display = 'flex';
    requestAnimationFrame(() => elOver.classList.remove('hidden'));
    inputLock = performance.now() + 450;
  }

  function norm(a) { a %= Math.PI * 2; return a < 0 ? a + Math.PI * 2 : a; }
  function angDist(a, b) {
    let d = Math.abs(norm(a) - norm(b));
    return d > Math.PI ? Math.PI * 2 - d : d;
  }

  function tap() {
    const now = performance.now();
    if (now < inputLock) return;

    if (state === S.OVER) { startGame(); return; }

    // playing: judge the tap
    const d = angDist(angle, zoneCenter);
    const grace = 0.045; // ball radius forgiveness
    if (d <= zoneHalf + grace) {
      const perfect = d <= zoneHalf * 0.34;
      const px = CX + Math.cos(angle) * R, py = CY + Math.sin(angle) * R;

      if (perfect) {
        perfectStreak++;
        score += 2;
        popText('PERFECT +2');
        sfx.perfect(perfectStreak); buzz(20);
        burst(px, py, '#ffffff', 18, 1.2);
        if (perfectStreak >= 2) {
          elCombo.textContent = 'PERFECT ×' + perfectStreak;
          elCombo.classList.add('on');
        }
      } else {
        perfectStreak = 0;
        score += 1;
        sfx.hit(score); buzz(10);
        burst(px, py, '#ffffff', 10, 0.9);
        elCombo.classList.remove('on');
      }

      bumpScore();

      const prevLevel = Math.floor((perfect ? score - 2 : score - 1) / 5);
      const newLevel = Math.floor(score / 5);
      if (newLevel > prevLevel) { setWorldColor(score); sfx.level(); popText('LEVEL ' + (newLevel + 1)); }

      dir *= -1;
      speed = speedFor(score);
      zoneHalf = zoneFor(score);
      placeZone();
    } else {
      lastMissNear = d <= zoneHalf * 1.9;
      endGame(lastMissNear);
    }
  }

  window.addEventListener('pointerdown', e => {
    // Avoid triggering tap events if clicking navigation elements
    if (e.target.closest('.btn-back-menu')) return;
    ac() && AC.state === 'suspended' && AC.resume();
    tap();
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      tap();
    }
  });

  // ---------- render ----------
  let last = null;
  let smoothedDt = null;
  function frame(now) {
    if (last === null) {
      last = now;
      requestAnimationFrame(frame);
      return;
    }
    const rawDt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (smoothedDt === null) {
      smoothedDt = rawDt;
    } else if (rawDt > 0) {
      smoothedDt = smoothedDt * 0.85 + rawDt * 0.15;
    }
    const dt = Math.min(smoothedDt, 0.033);

    if (state === S.PLAY) { angle = norm(angle + dir * speed * dt); }

    // shake decay
    const sx = shake > 0 ? (Math.random() - .5) * shake : 0;
    const sy = shake > 0 ? (Math.random() - .5) * shake : 0;
    shake = Math.max(0, shake - 60 * dt);

    cx.clearRect(0, 0, W, H);
    cx.save();
    cx.translate(sx, sy);

    const trackR = R, lw = Math.max(10, R * 0.085);

    // track
    cx.beginPath();
    cx.arc(CX, CY, trackR, 0, Math.PI * 2);
    cx.strokeStyle = 'rgba(255,255,255,.30)';
    cx.lineWidth = lw; cx.lineCap = 'round';
    cx.stroke();

    // target zone (ink)
    cx.beginPath();
    cx.arc(CX, CY, trackR, zoneCenter - zoneHalf, zoneCenter + zoneHalf);
    cx.strokeStyle = '#16121f';
    cx.lineWidth = lw + 4;
    cx.stroke();

    // zone center tick (the "perfect" mark)
    const tx = CX + Math.cos(zoneCenter) * trackR, ty = CY + Math.sin(zoneCenter) * trackR;
    cx.beginPath();
    cx.arc(tx, ty, lw * 0.28, 0, Math.PI * 2);
    cx.fillStyle = 'rgba(255,255,255,.85)';
    cx.fill();

    // ball + motion trail
    const bx = CX + Math.cos(angle) * trackR, by = CY + Math.sin(angle) * trackR;
    
    // Update trail history
    if (state === S.PLAY) {
      trailTimer += dt;
      if (trailTimer >= 0.016) {
        trailTimer = 0;
        trailHistory.push({
          angle: angle,
          size: lw * 0.62,
          alpha: 0.35
        });
      }
    }

    // Update and draw trail elements
    for (let i = trailHistory.length - 1; i >= 0; i--) {
      const t = trailHistory[i];
      t.alpha -= dt * 3.5;
      t.size *= 0.96;
      if (t.alpha <= 0) {
        trailHistory.splice(i, 1);
        continue;
      }
      cx.beginPath();
      cx.arc(CX + Math.cos(t.angle) * trackR, CY + Math.sin(t.angle) * trackR, t.size, 0, Math.PI * 2);
      cx.fillStyle = `rgba(255,255,255,${t.alpha})`;
      cx.fill();
    }

    cx.beginPath();
    cx.arc(bx, by, lw * 0.62, 0, Math.PI * 2);
    cx.fillStyle = '#ffffff';
    cx.shadowColor = 'rgba(22,18,31,.35)'; cx.shadowBlur = 8; cx.shadowOffsetY = 3;
    cx.fill();
    cx.shadowBlur = 0; cx.shadowOffsetY = 0;

    // particles
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt * 1.8;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 300 * dt;
      cx.globalAlpha = Math.max(p.life, 0);
      cx.beginPath(); cx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      cx.fillStyle = p.color; cx.fill();
    }
    cx.globalAlpha = 1;

    cx.restore();
    requestAnimationFrame(frame);
  }

  // Start the game loop automatically when loaded
  startGame();
  requestAnimationFrame(frame);
})();
