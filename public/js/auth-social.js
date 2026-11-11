// "Continue with Google" / "Continue with Apple".
//
// Which buttons appear depends on the platform and on what the server has set up
// (GET /api/auth/providers). Nothing shows until the server is configured.
//   Website: Google's own button (Google Identity Services).
//   Android app: native Google sign-in via @capgo/capacitor-social-login.
//   iPhone app: native Apple and Google sign-in. Google only appears when
//     Apple is also available, because App Store guideline 4.8 requires an
//     Apple-style private sign-in option next to any third-party one.
//
// SocialAuth.init({ onToken(provider, idToken), onError(message) }) -> Promise<boolean>
(function () {
  'use strict';

  var cap = window.Capacitor;
  var isApp = !!window.LOOPSHOT_IS_APP;
  var platform = (cap && cap.getPlatform) ? cap.getPlatform() : 'web';
  var plugin = function () { return cap && cap.Plugins && cap.Plugins.SocialLogin; };
  var cfg = null, handlers = null, nativeReady = null;

  function $(id) { return document.getElementById(id); }

  async function loadProviders() {
    try {
      var r = await fetch((window.API_BASE || '') + '/api/auth/providers');
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  function initNative() {
    if (!nativeReady) {
      var opts = {};
      if (cfg.google) {
        opts.google = { webClientId: cfg.google.webClientId, mode: 'online' };
        if (cfg.google.iosClientId) {
          opts.google.iOSClientId = cfg.google.iosClientId;
          opts.google.iOSServerClientId = cfg.google.webClientId;
        }
      }
      if (cfg.apple && platform === 'ios') opts.apple = { clientId: cfg.apple.bundleId || 'com.yashasmahale.loopshot' };
      nativeReady = plugin().initialize(opts);
    }
    return nativeReady;
  }

  function friendly(err) {
    var m = String((err && (err.message || err.error)) || err || '');
    if (/cancel/i.test(m) || /1001|12501|16\b/.test(m)) return null; // user closed the sheet
    if (/network/i.test(m)) return 'No connection. Check your internet and try again.';
    return 'Sign-in didn’t finish. Please try again.';
  }

  async function nativeLogin(provider) {
    try {
      await initNative();
      var res = await plugin().login(provider === 'google'
        ? { provider: 'google', options: {} }
        : { provider: 'apple', options: { scopes: ['email', 'name'] } });
      var token = res && res.result && res.result.idToken;
      if (!token) throw new Error('No ID token returned');
      handlers.onToken(provider, token);
    } catch (e) {
      var msg = friendly(e);
      if (msg) handlers.onError(msg);
    }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.defer = true;
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function setupWebGoogle(slot) {
    await loadScript('https://accounts.google.com/gsi/client');
    google.accounts.id.initialize({
      client_id: cfg.google.webClientId,
      callback: function (r) { if (r && r.credential) handlers.onToken('google', r.credential); },
      ux_mode: 'popup',
      cancel_on_tap_outside: true
    });
    var render = function () {
      slot.innerHTML = '';
      google.accounts.id.renderButton(slot, {
        theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'center',
        width: Math.min(400, Math.max(200, Math.floor(slot.getBoundingClientRect().width || 320)))
      });
    };
    render();
    return render;
  }

  var webRender = null;

  async function init(h) {
    handlers = h;
    cfg = await loadProviders();
    if (!cfg) return false;
    var wrap = $('social-auth'), gBtn = $('btn-google'), aBtn = $('btn-apple'), slot = $('google-btn-slot');
    var showGoogle = false, showApple = false;

    if (isApp) {
      if (!plugin()) return false;
      if (platform === 'ios') {
        showApple = !!cfg.apple;
        showGoogle = !!(cfg.google && cfg.google.iosClientId && showApple);
      } else if (platform === 'android') {
        showGoogle = !!cfg.google;
      }
      if (showGoogle) { gBtn.hidden = false; gBtn.onclick = function () { nativeLogin('google'); }; }
      if (showApple) { aBtn.hidden = false; aBtn.onclick = function () { nativeLogin('apple'); }; }
    } else if (cfg.google) {
      showGoogle = true;
      // Rendered when the sign-in sheet opens, so the button can size itself
      webRender = function () {
        if (webRender._done) return;
        webRender._done = true;
        setupWebGoogle(slot).then(function (r) { webRender._rerender = r; }).catch(function () {
          webRender._done = false;
          handlers.onError('Google sign-in couldn’t load. Check your connection.');
        });
      };
    }
    wrap.hidden = !(showGoogle || showApple);
    return showGoogle || showApple;
  }

  window.SocialAuth = {
    init: init,
    // Call when the sign-in sheet becomes visible
    onSheetOpen: function () { if (webRender) webRender(); }
  };
})();
