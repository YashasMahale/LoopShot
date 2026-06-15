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

  const playTone = (freq, dur = 0.08, type = 'square', vol = 0.1) => {
    if (mute) return;
    const ctx = ac();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const t = ctx.currentTime;
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
  const modalModeSelect = document.getElementById('modal-mode-select');

  // Modal Triggers
  const btnLink = document.getElementById('btn-link-account');
  const btnHowToPlay = document.getElementById('btn-how-to-play');
  const btnSettings = document.getElementById('btn-settings-toggle');
  const btnCredits = document.getElementById('btn-credits');

  // Settings Modal controls
  const volumeSlider = document.getElementById('volume-slider');
  const volumeValue = document.getElementById('volume-value');
  const btnResetScore = document.getElementById('btn-reset-score');

  // Account form
  const formLink = document.getElementById('form-link-account');
  const linkUsername = document.getElementById('link-username');

  // Clerk initialization state
  let clerkActive = false;

  window.initializeClerk = async () => {
    try {
      const Clerk = window.Clerk;
      if (!Clerk) throw new Error("Clerk script not loaded");

      await Clerk.load();
      clerkActive = true;
      console.log("Clerk loaded successfully");

      updateUI();

      Clerk.addListener(({ user }) => {
        updateUI();
      });
    } catch (e) {
      console.warn("Clerk initialization failed, using local mock fallback:", e);
      clerkActive = false;
      updateUI();
    }
  };

  // Update DOM from localStorage / Clerk
  const updateUI = () => {
    elBest.textContent = getBest();
    
    if (clerkActive && window.Clerk && window.Clerk.user) {
      const user = window.Clerk.user;
      const username = user.username || (user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : 'User');
      elUserStatus.textContent = 'LINKED: ' + username.toUpperCase();
      
      elUserAvatar.style.display = 'none';
      if (clerkBtnContainer) {
        clerkBtnContainer.style.display = 'block';
        window.Clerk.mountUserButton(clerkBtnContainer);
      }
      
      btnLink.style.display = 'none';
    } else {
      // Fallback/Local storage status
      const username = getUser();
      if (username) {
        elUserStatus.textContent = 'LINKED: ' + username.toUpperCase();
        elUserAvatar.textContent = username.slice(0, 2).toUpperCase();
        elUserAvatar.style.background = '#ffd166';
        elUserAvatar.style.color = '#16121f';
      } else {
        elUserStatus.textContent = 'GUEST ACCOUNT';
        elUserAvatar.textContent = '?';
        elUserAvatar.style.background = '';
        elUserAvatar.style.color = '';
      }
      
      elUserAvatar.style.display = 'flex';
      if (clerkBtnContainer) {
        clerkBtnContainer.style.display = 'none';
      }
      btnLink.style.display = 'flex';
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

  btnStart.addEventListener('click', () => openModal(modalModeSelect));

  btnLink.addEventListener('click', () => {
    if (clerkActive && window.Clerk) {
      window.Clerk.openSignIn();
    } else {
      openModal(modalLink);
    }
  });

  btnHowToPlay.addEventListener('click', () => openModal(modalHowToPlay));
  btnSettings.addEventListener('click', () => openModal(modalSettings));
  btnCredits.addEventListener('click', () => openModal(modalCredits));

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
      updateUI();
      playTone(160, 0.2, 'sawtooth', 0.12);
    }
  });

  // Account: Form submission simulation
  formLink.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = linkUsername.value.trim();
    if (user) {
      localStorage.setItem('ls_user', user);
      updateUI();
      closeModal(modalLink);
      // Play a success sound
      playTone(523, 0.06, 'square', 0.08);
      playTone(659, 0.06, 'square', 0.08, 0.05);
      playTone(784, 0.1, 'square', 0.08, 0.1);
    }
  });

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

    // Dynamic split screen alignment
    if (W >= 768) {
      CX = 380 + (W - 380) * 0.5;
      CY = H / 2;
      R = Math.min(W - 380, H) * 0.32;
    } else {
      CX = W / 2;
      CY = H * 0.26;
      R = Math.min(W, H * 0.52) * 0.3;
    }
    
    updateTitlePosition();
  };
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;

    // Slow spinning menu loop
    angle = (angle + 1.2 * dt) % (Math.PI * 2);

    cx.clearRect(0, 0, W, H);
    
    // Ambient ring
    const lw = Math.max(10, R * 0.085);
    cx.globalAlpha = 0.5;
    cx.beginPath();
    cx.arc(CX, CY, R, 0, Math.PI * 2);
    cx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    cx.lineWidth = lw;
    cx.stroke();

    // Ambient ball orbiting
    cx.beginPath();
    cx.arc(CX + Math.cos(angle) * R, CY + Math.sin(angle) * R, lw * 0.6, 0, Math.PI * 2);
    cx.fillStyle = '#ffffff';
    cx.fill();
    cx.globalAlpha = 1;

    requestAnimationFrame(frame);
  };
  
  // Set default body color
  document.body.style.background = 'hsl(8, 72%, 54%)';
  
  updateUI();
  requestAnimationFrame(frame);
})();
