// Shared runtime config, loaded before the other scripts.
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

  // Vercel Web Analytics + Speed Insights run on the website only.
  // The app bundle doesn't include them, and the store privacy answers
  // assume the app does no analytics tracking.
  if (!isApp && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
    ['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js'].forEach(function (src) {
      var s = document.createElement('script');
      s.defer = true; s.src = src;
      document.head.appendChild(s);
    });
  }
})();
