// LoopShot progression: XP + player level, unlockable ball skins,
// daily missions, daily play streak, run stats and haptics.
// Everything is stored on the device (localStorage) so it works offline
// and for guests. Loaded before menu.js and game.js as window.LS.
(function () {
  'use strict';

  var KEY = 'ls_progress_v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { }
  }

  var P = load();
  P.xp = P.xp || 0;
  P.runs = P.runs || 0;
  P.perfects = P.perfects || 0;
  P.bestStreak = P.bestStreak || 0;
  P.skin = P.skin || 'classic';
  P.streak = P.streak || 0;
  P.lastDay = P.lastDay || '';
  P.seenLevel = P.seenLevel || 1;

  // ---------- levels ----------
  // XP needed to go from level n to n+1
  function need(n) { return 40 + n * 20; }
  function levelInfo(xp) {
    var lvl = 1, left = xp;
    while (left >= need(lvl)) { left -= need(lvl); lvl++; }
    return { level: lvl, into: left, need: need(lvl), pct: left / need(lvl) };
  }

  // ---------- skins ----------
  // ball: ball fill, trail: trail colour (or 'rainbow'), glow: glow colour, len: trail length factor
  var SKINS = [
    { id: 'classic', name: 'Classic', level: 1, ball: '#ffffff', trail: '#ffffff', glow: null, len: 1 },
    { id: 'ember', name: 'Ember', level: 2, ball: '#ffd166', trail: '#ff8a3d', glow: '#ff8a3d', len: 1.2 },
    { id: 'mint', name: 'Mint', level: 3, ball: '#b8ffd9', trail: '#5ef2a6', glow: '#5ef2a6', len: 1.2 },
    { id: 'neon', name: 'Neon', level: 5, ball: '#e6fdff', trail: '#00f0ff', glow: '#00f0ff', len: 1.5 },
    { id: 'gold', name: 'Gold', level: 7, ball: '#ffd700', trail: '#fff2a8', glow: '#ffd700', len: 1.4 },
    { id: 'void', name: 'Void', level: 10, ball: '#16121f', trail: '#16121f', glow: '#ffffff', len: 1.3, ring: true },
    { id: 'prism', name: 'Prism', level: 13, ball: '#ffffff', trail: 'rainbow', glow: '#ffffff', len: 1.8 },
    { id: 'comet', name: 'Comet', level: 16, ball: '#ffffff', trail: '#9ad7ff', glow: '#9ad7ff', len: 3 },
    { id: 'nova', name: 'Supernova', level: 20, ball: '#fff6e0', trail: 'rainbow', glow: '#ffb3f5', len: 2.6, pulse: true }
  ];
  function skinById(id) {
    for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i];
    return SKINS[0];
  }
  function unlocked(s) { return levelInfo(P.xp).level >= s.level; }
  function currentSkin() {
    var s = skinById(P.skin);
    return unlocked(s) ? s : SKINS[0];
  }

  // ---------- days / streak ----------
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function yesterdayKey() { var d = new Date(); d.setDate(d.getDate() - 1); return dayKey(d); }
  // Streak still alive if played today or yesterday
  function liveStreak() {
    if (P.lastDay === dayKey() || P.lastDay === yesterdayKey()) return P.streak;
    return 0;
  }

  // ---------- daily missions ----------
  // kind: runs | score (single run) | perfects (total today) | combo (one run) | total (score today) | mode
  var POOL = [
    { id: 'runs3', kind: 'runs', goal: 3, text: 'Play 3 runs' },
    { id: 'runs6', kind: 'runs', goal: 6, text: 'Play 6 runs' },
    { id: 'score10', kind: 'score', goal: 10, text: 'Score 10 in one run' },
    { id: 'score20', kind: 'score', goal: 20, text: 'Score 20 in one run' },
    { id: 'score30', kind: 'score', goal: 30, text: 'Score 30 in one run' },
    { id: 'perf8', kind: 'perfects', goal: 8, text: 'Land 8 perfects' },
    { id: 'perf15', kind: 'perfects', goal: 15, text: 'Land 15 perfects' },
    { id: 'combo3', kind: 'combo', goal: 3, text: 'Hit a ×3 perfect streak' },
    { id: 'combo5', kind: 'combo', goal: 5, text: 'Hit a ×5 perfect streak' },
    { id: 'total60', kind: 'total', goal: 60, text: 'Score 60 points today' },
    { id: 'total120', kind: 'total', goal: 120, text: 'Score 120 points today' },
    { id: 'hard5', kind: 'mode', mode: 'hard', goal: 5, text: 'Score 5 in Hard mode' },
    { id: 'night3', kind: 'mode', mode: 'nightmare', goal: 3, text: 'Score 3 in Nightmare' }
  ];
  var MISSION_XP = 30, ALL_DONE_XP = 50;

  function seeded(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  }
  function missions() {
    var today = dayKey();
    if (!P.missions || P.missions.day !== today) {
      var rnd = seeded('loopshot' + today), picked = [], kinds = {};
      var pool = POOL.slice();
      while (picked.length < 3 && pool.length) {
        var m = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
        if (kinds[m.kind]) continue; // one of each kind per day
        kinds[m.kind] = 1;
        picked.push({ id: m.id, progress: 0, done: false });
      }
      P.missions = { day: today, list: picked, bonus: false };
      save();
    }
    return P.missions.list.map(function (m) {
      var def = POOL.filter(function (d) { return d.id === m.id; })[0] || POOL[0];
      return { id: m.id, text: def.text, goal: def.goal, progress: Math.min(m.progress, def.goal), done: m.done };
    });
  }

  // ---------- run recording ----------
  // run = { mode, score, perfects, bestCombo, isNewBest }
  // Returns what happened so the game-over screen can celebrate it.
  function recordRun(run) {
    var before = levelInfo(P.xp);
    var today = dayKey();
    var events = { xp: 0, completed: [], allDone: false, streakBonus: 0, streak: 0 };

    // daily streak (first run of the day)
    if (P.lastDay !== today) {
      P.streak = (P.lastDay === yesterdayKey()) ? P.streak + 1 : 1;
      P.lastDay = today;
      events.streakBonus = 10 * Math.min(P.streak, 7);
    }
    events.streak = P.streak;

    P.runs++;
    P.perfects += run.perfects;
    if (run.bestCombo > P.bestStreak) P.bestStreak = run.bestCombo;

    // base XP: points scored + a little for showing up
    var xp = run.score + 2 + events.streakBonus + (run.isNewBest ? 10 : 0);

    // missions
    missions();
    P.missions.list.forEach(function (m) {
      if (m.done) return;
      var def = POOL.filter(function (d) { return d.id === m.id; })[0];
      if (!def) return;
      if (def.kind === 'runs') m.progress += 1;
      else if (def.kind === 'score') m.progress = Math.max(m.progress, run.score);
      else if (def.kind === 'perfects') m.progress += run.perfects;
      else if (def.kind === 'combo') m.progress = Math.max(m.progress, run.bestCombo);
      else if (def.kind === 'total') m.progress += run.score;
      else if (def.kind === 'mode' && run.mode === def.mode) m.progress = Math.max(m.progress, run.score);
      if (m.progress >= def.goal) {
        m.done = true;
        xp += MISSION_XP;
        events.completed.push(def.text);
      }
    });
    if (!P.missions.bonus && P.missions.list.every(function (m) { return m.done; })) {
      P.missions.bonus = true;
      xp += ALL_DONE_XP;
      events.allDone = true;
    }

    P.xp += xp;
    events.xp = xp;
    var after = levelInfo(P.xp);
    events.before = before;
    events.after = after;
    events.levelUp = after.level > before.level;
    events.newSkins = SKINS.filter(function (s) { return s.level > before.level && s.level <= after.level; });
    save();
    return events;
  }

  // ---------- haptics ----------
  // Uses the native Haptics plugin inside the app, the Vibration API on the web.
  function hapticsOn() { return localStorage.getItem('ls_haptics') !== 'false'; }
  function haptic(kind) {
    if (!hapticsOn()) return;
    try {
      var H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      if (H && window.LOOPSHOT_IS_APP) {
        if (kind === 'light') H.impact({ style: 'LIGHT' });
        else if (kind === 'medium') H.impact({ style: 'MEDIUM' });
        else if (kind === 'heavy') H.impact({ style: 'HEAVY' });
        else if (kind === 'success') H.notification({ type: 'SUCCESS' });
        else if (kind === 'error') H.notification({ type: 'ERROR' });
        else H.selectionChanged();
        return;
      }
    } catch (e) { }
    if (navigator.vibrate) {
      var ms = { light: 8, medium: 18, heavy: 40, success: [15, 40, 25], error: [50, 30, 60] }[kind] || 6;
      try { navigator.vibrate(ms); } catch (e) { }
    }
  }

  // ---------- last mode ----------
  function lastMode() {
    var m = localStorage.getItem('ls_last_mode');
    return (m === 'hard' || m === 'nightmare') ? m : 'easy';
  }

  window.LS = {
    get: function () { return P; },
    levelInfo: function () { return levelInfo(P.xp); },
    SKINS: SKINS,
    skin: currentSkin,
    isUnlocked: unlocked,
    setSkin: function (id) { var s = skinById(id); if (unlocked(s)) { P.skin = id; save(); } },
    missions: missions,
    streak: liveStreak,
    playedToday: function () { return P.lastDay === dayKey(); },
    recordRun: recordRun,
    haptic: haptic,
    hapticsOn: hapticsOn,
    setHaptics: function (on) { localStorage.setItem('ls_haptics', on ? 'true' : 'false'); },
    lastMode: lastMode,
    setLastMode: function (m) { localStorage.setItem('ls_last_mode', m); },
    markLevelSeen: function () { P.seenLevel = levelInfo(P.xp).level; save(); }
  };
})();
