// In-game dialogs that replace the browser's alert / confirm / prompt boxes.
// UI.alert(text, opts)   -> Promise<void>
// UI.confirm(text, opts) -> Promise<boolean>
// UI.prompt(text, opts)  -> Promise<string|null>
// UI.toast(text)
(function () {
  'use strict';
  var root = null, active = null, toastEl = null, toastTimer = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function open(kind, text, opts) {
    opts = opts || {};
    if (active) active.finish(kind === 'confirm' ? false : null);
    return new Promise(function (resolve) {
      var lastFocus = document.activeElement;
      root = el('div', 'ui-dialog-backdrop');
      var box = el('div', 'ui-dialog' + (opts.danger ? ' danger' : ''));
      box.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
      box.setAttribute('aria-modal', 'true');
      var title = el('h3', 'ui-dialog-title', opts.title || (kind === 'alert' ? 'LoopShot' : 'Are you sure?'));
      title.id = 'ui-dialog-title';
      box.setAttribute('aria-labelledby', title.id);
      box.appendChild(title);
      if (text) box.appendChild(el('p', 'ui-dialog-text', text));

      var input = null;
      if (kind === 'prompt') {
        input = el('input', 'ui-dialog-input');
        input.type = opts.type || 'text';
        if (opts.placeholder) input.placeholder = opts.placeholder;
        if (opts.autocomplete) input.autocomplete = opts.autocomplete;
        input.setAttribute('aria-label', opts.label || opts.title || 'Answer');
        input.autocapitalize = 'none';
        box.appendChild(input);
      }

      var row = el('div', 'ui-dialog-actions');
      var cancel = null;
      if (kind !== 'alert') {
        cancel = el('button', 'ui-btn ghost', opts.cancel || 'Cancel');
        cancel.type = 'button';
        row.appendChild(cancel);
      }
      var ok = el('button', 'ui-btn' + (opts.danger ? ' danger' : ''), opts.ok || 'OK');
      ok.type = 'button';
      row.appendChild(ok);
      box.appendChild(row);
      root.appendChild(box);
      document.body.appendChild(root);
      requestAnimationFrame(function () { root.classList.add('on'); });

      function finish(value) {
        if (!active) return;
        active = null;
        document.removeEventListener('keydown', onKey, true);
        root.classList.remove('on');
        var r = root;
        setTimeout(function () { r.remove(); }, 180);
        if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { }
        resolve(value);
      }
      function accept() {
        if (kind === 'prompt') finish(input.value);
        else finish(kind === 'confirm' ? true : undefined);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(kind === 'confirm' ? false : (kind === 'prompt' ? null : undefined)); }
        else if (e.key === 'Enter' && (kind !== 'prompt' || document.activeElement === input)) { e.preventDefault(); e.stopPropagation(); accept(); }
        else if (e.key === 'Tab') {
          var f = Array.prototype.slice.call(box.querySelectorAll('button, input'));
          var i = f.indexOf(document.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      }
      ok.addEventListener('click', accept);
      if (cancel) cancel.addEventListener('click', function () { finish(kind === 'confirm' ? false : null); });
      root.addEventListener('pointerdown', function (e) { if (e.target === root && kind !== 'alert') finish(kind === 'confirm' ? false : null); });
      document.addEventListener('keydown', onKey, true);
      active = { finish: finish };
      setTimeout(function () { (input || (opts.danger && cancel) || ok).focus(); }, 30);
    });
  }

  function toast(text) {
    if (!toastEl) {
      toastEl = el('div', 'toast');
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2600);
  }

  window.UI = {
    alert: function (t, o) { return open('alert', t, o); },
    confirm: function (t, o) { return open('confirm', t, o); },
    prompt: function (t, o) { return open('prompt', t, o); },
    toast: toast
  };
})();
