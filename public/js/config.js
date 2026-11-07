// Shared runtime config, loaded before menu.js and game.js.
// On the website, API calls stay relative ("/api/..."). Inside the
// Android/iOS app the pages are served from the device itself, so API
// calls must go to the live server instead.
(function () {
  var LIVE_API = 'https://project-tgtho.vercel.app';
  var cap = window.Capacitor;
  var isApp = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) ||
    location.protocol === 'capacitor:' ||
    (location.hostname === 'localhost' && !location.port && location.protocol === 'https:');
  window.LOOPSHOT_IS_APP = isApp;
  window.API_BASE = isApp ? LIVE_API : '';
  if (isApp) document.documentElement.classList.add('is-app');
})();
