(() => {
  "use strict";

  // State
  let volume = parseInt(localStorage.getItem('ls_volume') || '50', 10);
  let mute = volume === 0;
  const getBest = () => parseInt(localStorage.getItem('ls_best') || '0', 10);
  const getBestMode = (m) => parseInt(localStorage.getItem(`ls_best_${m}`) || '0', 10);
  const getUser = () => localStorage.getItem('ls_user') || '';

  // Sound Config (Web Audio API)
  let AC = null;
  const ac = () => {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.error("Web Audio API not supported:", e);
      }
    }
    return AC;
  };

  const playTone = (freq, dur = 0.08, type = 'square', vol = 0.1, when = 0) => {
    if (mute) return;
    const ctx = ac();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    
    // Scale volume by current volume setting
    const scale = volume / 100;
    gain.gain.setValueAtTime(vol * scale, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };

  // DOM elements
  const elBest = document.getElementById('best-score');
  const elUserStatus = document.getElementById('user-status');
  const elUserAvatar = document.getElementById('user-avatar');
  const clerkBtnContainer = document.getElementById('clerk-user-button-container');
  const btnStart = document.getElementById('btn-start');

  // Modals DOM
  const modalLink = document.getElementById('modal-link-account');
  const modalHowToPlay = document.getElementById('modal-how-to-play');
  const modalSettings = document.getElementById('modal-settings');
  const modalCredits = document.getElementById('modal-credits');

  // Modal Triggers
  const btnLink = document.getElementById('btn-link-account');
  const btnHowToPlay = document.getElementById('btn-how-to-play');
  const btnSettings = document.getElementById('btn-settings-toggle');
  const btnCredits = document.getElementById('btn-credits');
  const btnSupport = document.getElementById('btn-support-creator');

  // Settings Modal controls
  const volumeSlider = document.getElementById('volume-slider');
  const volumeValue = document.getElementById('volume-value');
  const btnResetScore = document.getElementById('btn-reset-score');

  // Custom Auth DOM elements
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginUsernameInput = document.getElementById('login-username');
  const loginPasswordInput = document.getElementById('login-password');
  const registerUsernameInput = document.getElementById('register-username');
  const registerPasswordInput = document.getElementById('register-password');
  const registerEmailInput = document.getElementById('register-email');
  const pwRules = document.getElementById('pw-rules');
  const modalAddEmail = document.getElementById('modal-add-email');
  const formAddEmail = document.getElementById('form-add-email');
  const addEmailInput = document.getElementById('add-email-input');
  const addEmailError = document.getElementById('auth-error-add-email');

  // Same rules as the server
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const passwordChecks = (pw) => ({
    len: pw.length >= 8 && pw.length <= 72,
    upper: /[A-Z]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw)
  });
  const updatePwRules = () => {
    if (!pwRules) return;
    const checks = passwordChecks(registerPasswordInput.value);
    pwRules.querySelectorAll('li').forEach(li => li.classList.toggle('ok', Boolean(checks[li.dataset.rule])));
  };
  registerPasswordInput.addEventListener('input', updatePwRules);
  const loginError = document.getElementById('auth-error-login');
  const registerError = document.getElementById('auth-error-register');
  const btnLogout = document.getElementById('btn-logout');
  const btnDeleteAccount = document.getElementById('btn-delete-account');

  // Auth Modal Tab switching
  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabLogin.style.color = 'var(--paper)';
    tabLogin.style.borderBottom = '2px solid var(--paper)';
    tabRegister.classList.remove('active');
    tabRegister.style.color = 'rgba(255,255,255,0.4)';
    tabRegister.style.borderBottom = 'none';
    formLogin.style.display = 'block';
    formRegister.style.display = 'none';
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabRegister.style.color = 'var(--paper)';
    tabRegister.style.borderBottom = '2px solid var(--paper)';
    tabLogin.classList.remove('active');
    tabLogin.style.color = 'rgba(255,255,255,0.4)';
    tabLogin.style.borderBottom = 'none';
    formRegister.style.display = 'block';
    formLogin.style.display = 'none';
  });

  // Update DOM from localStorage & custom auth state
  const updateUI = async () => {
    elBest.textContent = getBest();
    
    const username = getUser();
    const token = localStorage.getItem('ls_token');
    
    if (token && username) {
      // Check for supporter status
      let isSupporter = false;
      try {
        const res = await fetch(API_BASE + '/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          isSupporter = data.isSupporter;
        }
      } catch (e) {
        console.warn("Failed to fetch user status:", e);
      }

      elUserStatus.textContent = (isSupporter ? 'SUPPORTER: ' : 'ACCOUNT: ') + username.toUpperCase();
      elUserAvatar.textContent = username.slice(0, 2).toUpperCase();
      elUserAvatar.style.background = isSupporter ? '#ffd700' : '#ffd166';
      elUserAvatar.style.color = '#16121f';
      btnLink.style.display = 'none';
      btnLogout.style.display = 'block';
      if (btnDeleteAccount) btnDeleteAccount.style.display = 'block';
      if (accountSection) accountSection.style.display = 'block';
      if (accountName) accountName.textContent = 'Signed in as ' + username;
    } else {
      elUserStatus.textContent = 'GUEST ACCOUNT';
      elUserAvatar.textContent = '?';
      elUserAvatar.style.background = '';
      elUserAvatar.style.color = '';
      btnLink.style.display = 'block';
      btnLogout.style.display = 'none';
      if (btnDeleteAccount) btnDeleteAccount.style.display = 'none';
      if (accountSection) accountSection.style.display = 'none';
    }
    
    elUserAvatar.style.display = 'flex';
    if (clerkBtnContainer) {
      clerkBtnContainer.style.display = 'none';
    }

    // Settings
    volumeSlider.value = volume;
    volumeValue.textContent = volume + '%';

    // Mode best scores
    const elBestEasy = document.getElementById('best-easy');
    const elBestHard = document.getElementById('best-hard');
    const elBestNightmare = document.getElementById('best-nightmare');
    if (elBestEasy) elBestEasy.textContent = getBestMode('easy');
    if (elBestHard) elBestHard.textContent = getBestMode('hard');
    if (elBestNightmare) elBestNightmare.textContent = getBestMode('nightmare');

    renderProgress();
  };

  // Modal open/close actions
  const openModal = (modal) => {
    modal.classList.remove('hidden');
    playTone(523, 0.05, 'square', 0.06);
  };

  const closeModal = (modal) => {
    modal.classList.add('hidden');
    playTone(330, 0.05, 'square', 0.06);
  };

  // ---------- Mode picker + one-tap play ----------
  const accountSection = document.getElementById('account-section');
  const accountName = document.getElementById('settings-account-name');
  let selectedMode = window.LS ? LS.lastMode() : 'easy';
  const modeSegs = document.querySelectorAll('.mode-seg');
  const playModeLabel = document.getElementById('play-mode-label');
  const MODE_HUES = { easy: 8, hard: 222, nightmare: 290 };
  const selectMode = (m, withSound) => {
    selectedMode = m;
    if (window.LS) LS.setLastMode(m);
    modeSegs.forEach(b => {
      const on = b.dataset.mode === m;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (playModeLabel) playModeLabel.textContent = m.toUpperCase();
    document.body.style.background = `hsl(${MODE_HUES[m]}, 72%, 54%)`;
    if (withSound) { playTone(m === 'easy' ? 523 : m === 'hard' ? 659 : 784, 0.05, 'square', 0.06); if (window.LS) LS.haptic('select'); }
  };
  modeSegs.forEach(b => b.addEventListener('click', () => selectMode(b.dataset.mode, true)));

  btnStart.addEventListener('click', () => {
    if (window.LS) LS.haptic('medium');
    btnStart.classList.add('launch');
    setTimeout(() => { location.href = '/game.html?mode=' + selectedMode; }, 140);
  });
  // Coming back with the browser's back button restores this page from cache
  window.addEventListener('pageshow', () => { btnStart.classList.remove('launch'); renderProgress(); });

  // ---------- Level / streak / missions ----------
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function renderProgress() {
    if (!window.LS) return;
    const li = LS.levelInfo();
    const elLvl = document.getElementById('hero-level');
    const elStreak = document.getElementById('hero-streak');
    const chipStreak = document.getElementById('chip-streak');
    const fill = document.getElementById('menu-xp-fill');
    const xpText = document.getElementById('menu-xp-text');
    if (elLvl) elLvl.textContent = li.level;
    if (fill) fill.style.width = (li.pct * 100) + '%';
    if (xpText) xpText.textContent = `LV ${li.level} · ${li.into}/${li.need} XP`;
    const streak = LS.streak();
    if (elStreak) elStreak.textContent = streak;
    if (chipStreak) {
      chipStreak.classList.toggle('cold', streak === 0 || !LS.playedToday());
      chipStreak.title = LS.playedToday()
        ? `${streak}-day streak — come back tomorrow to keep it going`
        : (streak > 0 ? `Play today to keep your ${streak}-day streak!` : 'Play every day to build a streak');
    }

    const list = document.getElementById('missions-list');
    if (list) {
      const ms = LS.missions();
      list.innerHTML = ms.map(m => `
        <div class="mission ${m.done ? 'done' : ''}">
          <span class="mission-check">${m.done ? '✓' : ''}</span>
          <span class="mission-text">${esc(m.text)}</span>
          <span class="mission-prog">${m.done ? '+30 XP' : `${m.progress}/${m.goal}`}</span>
          <span class="mission-bar"><i style="width:${Math.round(m.progress / m.goal * 100)}%"></i></span>
        </div>`).join('');
      const doneCount = ms.filter(m => m.done).length;
      const reset = document.getElementById('missions-reset');
      if (reset) reset.textContent = doneCount === ms.length ? 'all done — new ones tomorrow' : `${doneCount}/${ms.length} done · +50 XP bonus for all`;
    }

    const newDot = document.getElementById('skins-new');
    if (newDot) newDot.hidden = !(li.level > (LS.get().seenLevel || 1) && LS.SKINS.some(s => s.level > (LS.get().seenLevel || 1) && s.level <= li.level));
    if (ambient) ambient.skin = LS.skin();
  }

  // ---------- Balls (skins) ----------
  const modalSkins = document.getElementById('modal-skins');
  const skinsGrid = document.getElementById('skins-grid');
  const ballStyle = (s) => {
    const bg = s.trail === 'rainbow'
      ? 'conic-gradient(from 0deg, #ff5a8a, #ffd166, #7be0a0, #00f0ff, #b388ff, #ff5a8a)'
      : s.ball;
    const glow = s.glow ? `0 0 18px ${s.glow}` : '0 4px 10px rgba(0,0,0,.3)';
    const ring = s.ring ? ', inset 0 0 0 3px #fff' : '';
    return `background:${bg};box-shadow:${glow}${ring}`;
  };
  function renderSkins() {
    if (!window.LS || !skinsGrid) return;
    const cur = LS.skin().id;
    skinsGrid.innerHTML = LS.SKINS.map(s => {
      const open = LS.isUnlocked(s);
      return `<button type="button" class="skin ${open ? '' : 'locked'} ${s.id === cur ? 'selected' : ''}" data-skin="${s.id}" ${open ? '' : 'aria-disabled="true"'}>
        <span class="skin-ball" style="${ballStyle(s)}"></span>
        <span class="skin-name">${esc(s.name)}</span>
        <span class="skin-req">${open ? (s.id === cur ? 'EQUIPPED' : 'TAP TO USE') : '🔒 LEVEL ' + s.level}</span>
      </button>`;
    }).join('');
  }
  if (skinsGrid) skinsGrid.addEventListener('click', (e) => {
    const b = e.target.closest('.skin');
    if (!b) return;
    const s = LS.SKINS.find(x => x.id === b.dataset.skin);
    if (!LS.isUnlocked(s)) {
      b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
      playTone(180, 0.08, 'square', 0.06); LS.haptic('error');
      return;
    }
    LS.setSkin(s.id);
    playTone(784, 0.06, 'square', 0.07); LS.haptic('select');
    renderSkins(); renderProgress();
  });
  const btnSkins = document.getElementById('btn-skins');
  if (btnSkins) btnSkins.addEventListener('click', () => { renderSkins(); openModal(modalSkins); if (window.LS) { LS.markLevelSeen(); renderProgress(); } });
  const chipLevel = document.getElementById('chip-level');
  if (chipLevel) chipLevel.addEventListener('click', () => btnSkins && btnSkins.click());

  // ---------- Vibration toggle ----------
  const toggleHaptics = document.getElementById('toggle-haptics');
  const renderHaptics = () => {
    if (!toggleHaptics || !window.LS) return;
    const on = LS.hapticsOn();
    toggleHaptics.classList.toggle('on', on);
    toggleHaptics.setAttribute('aria-checked', on ? 'true' : 'false');
  };
  if (toggleHaptics) toggleHaptics.addEventListener('click', () => {
    LS.setHaptics(!LS.hapticsOn()); renderHaptics(); LS.haptic('medium');
  });
  renderHaptics();

  btnLink.addEventListener('click', () => {
    // Open custom Login/Register Modal
    openModal(modalLink);
  });

  btnHowToPlay.addEventListener('click', () => openModal(modalHowToPlay));
  btnSettings.addEventListener('click', () => openModal(modalSettings));
  btnCredits.addEventListener('click', () => openModal(modalCredits));

  // Leaderboard Modal Setup & Controls
  const btnLeaderboard = document.getElementById('btn-leaderboard');
  const modalLeaderboard = document.getElementById('modal-leaderboard');
  const lbTabs = document.querySelectorAll('.lb-tab');
  const lbList = document.getElementById('leaderboard-list');

  let activeLeaderboardMode = 'easy';
  let cachedLeaderboardData = null;

  async function fetchLeaderboardData() {
    if (!lbList) return;
    lbList.innerHTML = '<div class="leaderboard-loading">Loading top rankings...</div>';

    try {
      const res = await fetch(API_BASE + '/api/leaderboard');
      if (res.ok) {
        cachedLeaderboardData = await res.json();
        renderLeaderboard(activeLeaderboardMode);
      } else {
        lbList.innerHTML = '<div class="leaderboard-empty">Unable to load rankings.</div>';
      }
    } catch (e) {
      lbList.innerHTML = '<div class="leaderboard-empty">Failed to load rankings.</div>';
    }
  }

  const escapeHtml = (v) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderLeaderboard(mode) {
    if (!lbList) return;
    if (!cachedLeaderboardData || !cachedLeaderboardData[mode] || cachedLeaderboardData[mode].length === 0) {
      lbList.innerHTML = `
        <div class="leaderboard-empty">
          <div class="empty-icon">🎮</div>
          <div class="empty-title">No Scores Recorded</div>
          <div class="empty-desc">Be the first logged-in player to set a score in ${mode.toUpperCase()} mode!</div>
        </div>
      `;
      return;
    }

    const items = cachedLeaderboardData[mode];
    let html = '';
    items.forEach(item => {
      let medal = '';
      let rankClass = `rank-${item.rank}`;
      if (item.rank === 1) medal = '🥇';
      else if (item.rank === 2) medal = '🥈';
      else if (item.rank === 3) medal = '🥉';
      else medal = `#${item.rank}`;

      const isSupporter = item.isSupporter;
      const supporterTag = isSupporter ? '<span class="lb-supporter-tag">SUPPORTER</span>' : '';
      const avatarBg = isSupporter ? 'background: #ffd700; color: #16121f;' : 'background: rgba(255,255,255,0.12); color: #fff;';

      html += `
        <div class="lb-row ${rankClass}">
          <div class="lb-rank">${medal}</div>
          <div class="lb-player">
            <div class="lb-avatar" style="${avatarBg}">${escapeHtml(String(item.username).slice(0, 2).toUpperCase())}</div>
            <div class="lb-name-group">
              <span class="lb-username">${escapeHtml(String(item.username).toUpperCase())}</span>
              ${supporterTag}
            </div>
          </div>
          <div class="lb-score">${escapeHtml(item.score)}</div>
        </div>
      `;
    });

    lbList.innerHTML = html;
  }

  if (btnLeaderboard) {
    btnLeaderboard.addEventListener('click', () => {
      openModal(modalLeaderboard);
      fetchLeaderboardData();
    });
  }

  lbTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      lbTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeLeaderboardMode = tab.getAttribute('data-mode') || 'easy';
      if (cachedLeaderboardData) {
        renderLeaderboard(activeLeaderboardMode);
      } else {
        fetchLeaderboardData();
      }
    });
  });

  // Support Creator Modal Setup & Controls
  const modalSupport = document.getElementById('modal-support-creator');
  const presetButtons = document.querySelectorAll('.preset-btn:not(.upi-preset-btn)');
  const customAmountInput = document.getElementById('custom-support-amount');
  const checkoutBtnText = document.getElementById('checkout-btn-text');
  const btnProceedCheckout = document.getElementById('btn-proceed-checkout');

  // Open Support Creator modal
  // Anyone can tip via UPI / Ko-fi; card checkout (badge) still requires login.
  btnSupport.addEventListener('click', () => {
    openModal(modalSupport);
  });

  // Preset buttons click handler ($2.99, $5.99, $9.99)
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      presetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const amt = btn.getAttribute('data-amount');
      if (customAmountInput) customAmountInput.value = amt;
      if (checkoutBtnText) checkoutBtnText.textContent = `SUPPORT $${parseFloat(amt).toFixed(2)}`;
    });
  });

  // Custom amount input event handler
  if (customAmountInput) {
    customAmountInput.addEventListener('input', () => {
      const val = parseFloat(customAmountInput.value);
      // Sync active state on preset buttons
      presetButtons.forEach(b => {
        if (parseFloat(b.getAttribute('data-amount')) === val) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
      if (checkoutBtnText) {
        if (!isNaN(val) && val > 0) {
          checkoutBtnText.textContent = `SUPPORT $${val.toFixed(2)}`;
        } else {
          checkoutBtnText.textContent = 'ENTER AN AMOUNT';
        }
      }
    });
  }

  // Proceed to Checkout trigger (Lemon Squeezy / Stripe)
  if (btnProceedCheckout) {
    btnProceedCheckout.addEventListener('click', async () => {
      const token = localStorage.getItem('ls_token');
      if (!token) {
        alert('Please log in first to support the creator!');
        closeModal(modalSupport);
        openModal(modalLink);
        return;
      }

      const amountVal = customAmountInput ? parseFloat(customAmountInput.value) : 2.99;
      if (isNaN(amountVal) || amountVal < 1.0) {
        alert('Please enter a contribution amount of at least $1.00 USD.');
        return;
      }
      if (amountVal > 1000.0) {
        alert('Maximum contribution amount is $1,000.00 USD.');
        return;
      }

      btnProceedCheckout.disabled = true;
      if (checkoutBtnText) checkoutBtnText.textContent = 'CONNECTING TO CHECKOUT...';

      try {
        const res = await fetch(API_BASE + '/api/create-checkout-session', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ amount: amountVal })
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 503) {
            alert('🍋 Creator Support Setup Required:\n\n' + data.error + '\n\nTo enable checkout:\n1. Open your Vercel Dashboard -> Project Settings -> Environment Variables\n2. Add the following Lemon Squeezy keys:\n   • LEMONSQUEEZY_API_KEY\n   • LEMONSQUEEZY_STORE_ID\n   • LEMONSQUEEZY_VARIANT_ID\n   • LEMONSQUEEZY_WEBHOOK_SECRET\n3. Trigger a redeploy (or push to git) to apply the variables.');
            btnProceedCheckout.disabled = false;
            if (checkoutBtnText) checkoutBtnText.textContent = `SUPPORT $${amountVal.toFixed(2)}`;
            return;
          }
          throw new Error(data.error || 'Checkout session failed');
        }
        
        window.location.href = data.url;
      } catch (err) {
        alert('Error: ' + err.message);
        playTone(160, 0.2, 'sawtooth', 0.1);
        btnProceedCheckout.disabled = false;
        if (checkoutBtnText) checkoutBtnText.textContent = `SUPPORT $${amountVal.toFixed(2)}`;
      }
    });
  }

  // ===== Support tabs: UPI (India) and Card / PayPal (international) =====
  const supportTabs = document.querySelectorAll('.support-tab');
  const supportPanes = document.querySelectorAll('.support-pane');
  supportTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      supportTabs.forEach(t => t.classList.toggle('active', t === tab));
      supportPanes.forEach(p => p.classList.toggle('hidden', p.id !== tab.dataset.pane));
    });
  });

  const upiPresetButtons = document.querySelectorAll('.upi-preset-btn');
  const upiAmountInput = document.getElementById('custom-upi-amount');
  const upiQrImg = document.getElementById('upi-qr-img');
  const upiAppBtn = document.getElementById('btn-open-upi-app');
  const upiAppBtnText = document.getElementById('upi-app-btn-text');
  const upiMaskedId = document.getElementById('upi-masked-id');
  const btnCopyUpi = document.getElementById('btn-copy-upi');
  const btnUpiPaid = document.getElementById('btn-upi-paid');
  let upiLinkTimer = null;

  function currentUpiAmount() {
    const v = Math.round(parseFloat(upiAmountInput ? upiAmountInput.value : '99'));
    return (!isNaN(v) && v >= 1 && v <= 100000) ? v : null;
  }

  async function fetchUpiLink(amount) {
    const res = await fetch(API_BASE + `/api/support/upi-link?amount=${amount}`);
    if (!res.ok) throw new Error('Could not build UPI link');
    return (await res.json()).link;
  }

  function refreshUpi() {
    const amt = currentUpiAmount();
    if (!amt) {
      if (upiAppBtnText) upiAppBtnText.textContent = 'ENTER AN AMOUNT';
      upiAppBtn && upiAppBtn.classList.add('disabled');
      return;
    }
    upiAppBtn && upiAppBtn.classList.remove('disabled');
    if (upiAppBtnText) upiAppBtnText.textContent = `PAY ₹${amt} WITH UPI APP`;
    if (upiQrImg) upiQrImg.src = API_BASE + `/api/support/upi-qr.svg?amount=${amt}`;
    clearTimeout(upiLinkTimer);
    upiLinkTimer = setTimeout(async () => {
      try {
        const link = await fetchUpiLink(amt);
        if (upiAppBtn && currentUpiAmount() === amt) upiAppBtn.href = link;
      } catch (e) { /* keep previous link */ }
    }, 150);
  }

  upiPresetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      upiPresetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (upiAmountInput) upiAmountInput.value = btn.dataset.amount;
      refreshUpi();
    });
  });

  if (upiAmountInput) {
    upiAmountInput.addEventListener('input', () => {
      const v = parseFloat(upiAmountInput.value);
      upiPresetButtons.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.amount) === v));
      refreshUpi();
    });
  }

  if (upiAppBtn) {
    upiAppBtn.addEventListener('click', (e) => {
      if (!currentUpiAmount() || !upiAppBtn.href.startsWith('upi:')) {
        e.preventDefault();
        return;
      }
      if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        e.preventDefault();
        alert('UPI apps open on phones. On a computer, scan the QR code above with Google Pay, PhonePe, Paytm or any UPI app.');
      }
    });
  }

  if (btnCopyUpi) {
    btnCopyUpi.addEventListener('click', async () => {
      try {
        const amt = currentUpiAmount() || 1;
        const link = await fetchUpiLink(amt);
        const id = new URLSearchParams(link.split('?')[1]).get('pa');
        await navigator.clipboard.writeText(id);
        btnCopyUpi.textContent = 'COPIED!';
      } catch (e) {
        btnCopyUpi.textContent = 'FAILED';
      }
      setTimeout(() => { btnCopyUpi.textContent = 'COPY'; }, 1500);
    });
  }

  if (btnUpiPaid) {
    btnUpiPaid.addEventListener('click', () => {
      alert('🎉 Thank you so much for supporting LoopShot! Every rupee helps keep the game growing.');
      closeModal(modalSupport);
    });
  }

  // Load support configuration (UPI, Ko-fi, card checkout availability)
  (async () => {
    try {
      const res = await fetch(API_BASE + '/api/support/config');
      const cfg = await res.json();
      if (upiMaskedId && cfg.upi && cfg.upi.maskedId) upiMaskedId.textContent = cfg.upi.maskedId;
      const kofiBox = document.getElementById('kofi-box');
      const kofiBtn = document.getElementById('btn-kofi');
      if (cfg.kofi && cfg.kofi.enabled && kofiBox && kofiBtn) {
        kofiBtn.href = cfg.kofi.url;
        kofiBox.classList.remove('hidden');
      }
      const cardBox = document.getElementById('card-checkout-box');
      if (cardBox && !(cfg.card && cfg.card.enabled)) {
        cardBox.classList.add('hidden');
        if (!(cfg.kofi && cfg.kofi.enabled)) {
          const na = document.getElementById('card-unavailable');
          na && na.classList.remove('hidden');
        }
      }
    } catch (e) { /* leave defaults */ }
    refreshUpi();
  })();

  // Event listener for all close buttons
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modalId = btn.getAttribute('data-modal');
      closeModal(document.getElementById(modalId));
    });
  });

  // Close modals on backdrop click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal);
      }
    });
  });

  // Close the top-most open modal with the Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = Array.from(document.querySelectorAll('.modal:not(.hidden)')).pop();
    if (open) closeModal(open);
  });

  // Settings: Volume slider change
  let volumeTimeout = null;
  volumeSlider.addEventListener('input', (e) => {
    volume = parseInt(e.target.value, 10);
    volumeValue.textContent = volume + '%';
    mute = volume === 0;
    
    localStorage.setItem('ls_volume', volume);
    localStorage.setItem('ls_mute', mute ? 'true' : 'false');
    
    // Play a preview tone with simple debounce
    if (volumeTimeout) clearTimeout(volumeTimeout);
    volumeTimeout = setTimeout(() => {
      playTone(440, 0.08, 'square', 0.08);
    }, 100);
  });

  // Settings: Reset score
  btnResetScore.addEventListener('click', () => {
    if (getBest() === 0) return;
    if (confirm('Are you sure you want to reset your personal best score?')) {
      localStorage.setItem('ls_best', '0');
      // If logged in, let's keep database but clear local storage best
      localStorage.setItem('ls_best_easy', '0');
      localStorage.setItem('ls_best_hard', '0');
      localStorage.setItem('ls_best_nightmare', '0');
      updateUI();
      playTone(160, 0.2, 'sawtooth', 0.12);
    }
  });

  // Helper to submit pending score after login if one exists
  async function checkAndSubmitPendingScore(token) {
    const pendingRaw = localStorage.getItem('ls_pending_score');
    if (!pendingRaw || !token) return;
    try {
      const pending = JSON.parse(pendingRaw);
      if (pending && pending.score > 0) {
        const res = await fetch(API_BASE + '/api/scores', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ mode: pending.mode, score: pending.score })
        });
        if (res.ok) {
          localStorage.removeItem('ls_pending_score');
          alert(`🎉 Great news! Your score of ${pending.score} (${pending.mode.toUpperCase()} mode) has been saved to your account!`);
          updateUI();
          fetchGlobalScores();
        }
      }
    } catch (e) {
      console.warn("Failed to sync pending score:", e);
    }
  }

  // Login Form Submission
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;
    
    try {
      const res = await fetch(API_BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid credentials');
      
      localStorage.setItem('ls_token', data.token);
      localStorage.setItem('ls_user', data.username);
      if (data.bestScores) {
        localStorage.setItem('ls_best_easy', data.bestScores.easy || 0);
        localStorage.setItem('ls_best_hard', data.bestScores.hard || 0);
        localStorage.setItem('ls_best_nightmare', data.bestScores.nightmare || 0);
        const maxScore = Math.max(data.bestScores.easy || 0, data.bestScores.hard || 0, data.bestScores.nightmare || 0);
        localStorage.setItem('ls_best', maxScore);
      }
      
      closeModal(modalLink);
      updateUI();
      playTone(523, 0.06, 'square', 0.08);
      playTone(659, 0.06, 'square', 0.08, 0.05);

      // Check if there was a score waiting to be saved from guest play
      await checkAndSubmitPendingScore(data.token);

      // Older accounts: ask for an email
      if (data.needsEmail && modalAddEmail) openModal(modalAddEmail);
    } catch (err) {
      loginError.textContent = err.message;
      loginError.style.display = 'block';
      playTone(160, 0.2, 'sawtooth', 0.1);
    }
  });

  // Register Form Submission
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerError.style.display = 'none';
    const username = registerUsernameInput.value.trim();
    const password = registerPasswordInput.value;
    const email = registerEmailInput.value.trim();

    const showRegisterError = (msg) => {
      registerError.textContent = msg;
      registerError.style.display = 'block';
      playTone(160, 0.2, 'sawtooth', 0.1);
    };
    if (!EMAIL_RE.test(email)) return showRegisterError('Please enter a valid email address');
    if (!/^[A-Za-z0-9_.-]{3,15}$/.test(username)) return showRegisterError('Username must be 3–15 characters: letters, numbers, _ . or -');
    const checks = passwordChecks(password);
    if (!checks.len) return showRegisterError('Password must be 8–72 characters');
    if (!checks.upper) return showRegisterError('Password needs at least one uppercase letter');
    if (!checks.special) return showRegisterError('Password needs at least one special character');
    
    try {
      const res = await fetch(API_BASE + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      
      localStorage.setItem('ls_token', data.token);
      localStorage.setItem('ls_user', data.username);
      localStorage.setItem('ls_best_easy', '0');
      localStorage.setItem('ls_best_hard', '0');
      localStorage.setItem('ls_best_nightmare', '0');
      localStorage.setItem('ls_best', '0');
      
      closeModal(modalLink);
      updateUI();
      playTone(523, 0.06, 'square', 0.08);
      playTone(659, 0.06, 'square', 0.08, 0.05);
      playTone(784, 0.1, 'square', 0.08, 0.1);

      // Check if there was a score waiting to be saved from guest play
      await checkAndSubmitPendingScore(data.token);
    } catch (err) {
      registerError.textContent = err.message;
      registerError.style.display = 'block';
      playTone(160, 0.2, 'sawtooth', 0.1);
    }
  });

  // Add email for older accounts
  if (formAddEmail) {
    formAddEmail.addEventListener('submit', async (e) => {
      e.preventDefault();
      addEmailError.style.display = 'none';
      const email = addEmailInput.value.trim();
      if (!EMAIL_RE.test(email)) {
        addEmailError.textContent = 'Please enter a valid email address';
        addEmailError.style.display = 'block';
        return;
      }
      try {
        const res = await fetch(API_BASE + '/api/auth/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('ls_token')}` },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not save email');
        closeModal(modalAddEmail);
        playTone(659, 0.08, 'square', 0.08);
      } catch (err) {
        addEmailError.textContent = err.message;
        addEmailError.style.display = 'block';
      }
    });
  }

  // Logout button trigger
  btnLogout.addEventListener('click', () => {
    if (confirm('Are you sure you want to log out?')) {
      localStorage.removeItem('ls_token');
      localStorage.removeItem('ls_user');
      localStorage.setItem('ls_best_easy', '0');
      localStorage.setItem('ls_best_hard', '0');
      localStorage.setItem('ls_best_nightmare', '0');
      localStorage.setItem('ls_best', '0');
      updateUI();
      playTone(330, 0.1, 'sawtooth', 0.08);
    }
  });

  const clearLocalAccount = () => {
    localStorage.removeItem('ls_token');
    localStorage.removeItem('ls_user');
    localStorage.setItem('ls_best_easy', '0');
    localStorage.setItem('ls_best_hard', '0');
    localStorage.setItem('ls_best_nightmare', '0');
    localStorage.setItem('ls_best', '0');
  };

  // Permanently delete the account (App Store guideline 5.1.1(v))
  if (btnDeleteAccount) {
    btnDeleteAccount.addEventListener('click', async () => {
      const token = localStorage.getItem('ls_token');
      if (!token) return;
      if (!confirm('Delete your account permanently? Your username, email and saved scores will be erased. This cannot be undone.')) return;
      const password = prompt('Enter your password to confirm:');
      if (!password) return;
      try {
        const res = await fetch(API_BASE + '/api/auth/account', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || 'Could not delete account. Please try again.');
          return;
        }
        clearLocalAccount();
        updateUI();
        alert('Your account has been deleted.');
      } catch (e) {
        alert('Could not reach the server. Please check your connection and try again.');
      }
    });
  }

  // Check token session on load
  const checkSession = async () => {
    const token = localStorage.getItem('ls_token');
    if (!token) return;
    try {
      const res = await fetch(API_BASE + '/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('ls_user', data.username);
        if (data.bestScores) {
          localStorage.setItem('ls_best_easy', data.bestScores.easy || 0);
          localStorage.setItem('ls_best_hard', data.bestScores.hard || 0);
          localStorage.setItem('ls_best_nightmare', data.bestScores.nightmare || 0);
          const maxScore = Math.max(data.bestScores.easy || 0, data.bestScores.hard || 0, data.bestScores.nightmare || 0);
          localStorage.setItem('ls_best', maxScore);
        }
        updateUI();
        // Ask older accounts for an email once per browser session
        let asked = false;
        try { asked = sessionStorage.getItem('ls_email_prompted') === '1'; } catch (e) {}
        if (data.hasEmail === false && !asked && modalAddEmail) {
          try { sessionStorage.setItem('ls_email_prompted', '1'); } catch (e) {}
          openModal(modalAddEmail);
        }
      } else {
        // Clear invalid token
        localStorage.removeItem('ls_token');
        localStorage.removeItem('ls_user');
        updateUI();
      }
    } catch (e) {
      console.warn("Session check failed:", e);
    }
  };
  checkSession();

  // Play click feedback
  btnStart.addEventListener('mousedown', () => {
    playTone(523, 0.06, 'square', 0.09);
  });

  // ---------- Canvas Ambient Demo ----------
  const cv = document.getElementById('game');
  const cx = cv.getContext('2d');
  const elTitleContainer = document.getElementById('menu-title-container');
  let W = 0, H = 0, DPR = 1, R = 0, CX = 0, CY = 0;
  let angle = -Math.PI / 2;
  var ambient = { skin: window.LS ? LS.skin() : null };
  let zone = Math.PI * 0.25, zoneHit = 0;
  const trail = [];

  const updateTitlePosition = () => {
    if (elTitleContainer) {
      elTitleContainer.style.left = CX + 'px';
      elTitleContainer.style.top = CY + 'px';
    }
  };

  const resize = () => {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = W * DPR;
    cv.height = H * DPR;
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    cx.setTransform(DPR, 0, 0, DPR, 0, 0);

    if (W >= 768) {
      CX = 380 + (W - 380) * 0.5;
      CY = H / 2;
      R = Math.min(W - 380, H) * 0.32;
    } else {
      // Hero area is the top ~30% of the screen on phones
      const hero = Math.max(170, H * 0.3);
      CX = W / 2;
      CY = hero * 0.55;
      R = Math.min(W * 0.5, hero * 0.8) * 0.5;
    }
    document.documentElement.style.setProperty('--hero-r', R + 'px');
    updateTitlePosition();
  };
  window.addEventListener('resize', resize);
  resize();

  const norm = (a) => { a %= Math.PI * 2; return a < 0 ? a + Math.PI * 2 : a; };
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;

    // The demo ball "plays itself": it hits the mark and the mark jumps on
    angle = norm(angle + 1.5 * dt);
    let d = norm(zone - angle);
    if (d > Math.PI) d -= Math.PI * 2;
    if (Math.abs(d) < 0.03) { zoneHit = 1; zone = norm(angle + 1.6 + Math.random() * 2.4); }
    zoneHit = Math.max(0, zoneHit - dt * 3);

    cx.clearRect(0, 0, W, H);
    const lw = Math.max(8, R * 0.085);
    const sk = ambient.skin || { ball: '#fff', trail: '#ffffff', glow: null };

    cx.beginPath();
    cx.arc(CX, CY, R + zoneHit * 10, 0, Math.PI * 2);
    cx.strokeStyle = `rgba(255,255,255,${0.22 + zoneHit * 0.2})`;
    cx.lineWidth = lw;
    cx.stroke();

    cx.beginPath();
    cx.arc(CX, CY, R, zone - 0.35, zone + 0.35);
    cx.strokeStyle = 'rgba(22,18,31,.55)';
    cx.lineWidth = lw + 3;
    cx.lineCap = 'round';
    cx.stroke();

    trail.push(angle); if (trail.length > 14) trail.shift();
    trail.forEach((a, i) => {
      cx.beginPath();
      cx.arc(CX + Math.cos(a) * R, CY + Math.sin(a) * R, lw * 0.6 * (i / trail.length), 0, Math.PI * 2);
      cx.fillStyle = sk.trail === 'rainbow' ? `hsla(${(now / 6 + i * 20) % 360} 95% 72% / ${i / trail.length * 0.5})` : `rgba(255,255,255,${i / trail.length * 0.35})`;
      cx.fill();
    });

    if (sk.glow) { cx.shadowColor = sk.glow; cx.shadowBlur = 14; }
    cx.beginPath();
    cx.arc(CX + Math.cos(angle) * R, CY + Math.sin(angle) * R, lw * 0.62, 0, Math.PI * 2);
    cx.fillStyle = sk.ball;
    cx.fill();
    cx.shadowBlur = 0;
    if (sk.ring) { cx.lineWidth = 2; cx.strokeStyle = '#fff'; cx.stroke(); }

    requestAnimationFrame(frame);
  };
  
  // Background follows the selected mode
  selectMode(selectedMode, false);
  
  // Real-time Global High Scores Polling (Numeric score only, no usernames in brackets)
  const fetchGlobalScores = async () => {
    try {
      const res = await fetch(API_BASE + '/api/scores');
      if (!res.ok) throw new Error("Failed to load scores");
      const scores = await res.json();
      
      // Update Mode Modal cards
      const elGlobalEasy = document.getElementById('global-best-easy');
      if (elGlobalEasy && scores.easy) {
        elGlobalEasy.textContent = `${scores.easy.score || 0}`;
      }
      const elGlobalHard = document.getElementById('global-best-hard');
      if (elGlobalHard && scores.hard) {
        elGlobalHard.textContent = `${scores.hard.score || 0}`;
      }
      const elGlobalNightmare = document.getElementById('global-best-nightmare');
      if (elGlobalNightmare && scores.nightmare) {
        elGlobalNightmare.textContent = `${scores.nightmare.score || 0}`;
      }

      // Update Sidebar overall global best
      const elGlobalBestOverall = document.getElementById('global-best-score');
      if (elGlobalBestOverall) {
        const maxScore = Math.max(
          scores.easy ? scores.easy.score : 0,
          scores.hard ? scores.hard.score : 0,
          scores.nightmare ? scores.nightmare.score : 0
        );
        elGlobalBestOverall.textContent = maxScore > 0 ? `${maxScore}` : '0';
      }
    } catch (e) {
      console.warn("Failed to fetch global high scores:", e);
    }
  };

  // Handle URL query parameters (Stripe payment return & Game login redirect)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auth') === 'login' || urlParams.get('login') === 'true') {
    openModal(modalLink);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Handle Stripe Payment redirect return
  if (urlParams.get('payment') === 'success') {
    const paidAmount = urlParams.get('amt');
    const msg = paidAmount 
      ? `🎉 Thank you so much for your generous $${paidAmount} contribution to LoopShot! Your golden SUPPORTER badge is now active.`
      : '🎉 Thank you so much for supporting LoopShot! Your golden SUPPORTER badge is now active.';
    alert(msg);
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (urlParams.get('payment') === 'cancelled') {
    alert('Payment was cancelled. You can support anytime! Thanks for playing LoopShot.');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  fetchGlobalScores();
  // Poll every 5 seconds for real-time updates, but only while the tab is visible
  setInterval(() => { if (!document.hidden) fetchGlobalScores(); }, 5000);
  
  updateUI();
  requestAnimationFrame(frame);
})();
