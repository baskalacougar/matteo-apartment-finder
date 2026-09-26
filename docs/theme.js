// Theme switcher: light / dark / custom (accent + background picked in RGB).
// Loaded synchronously in <head> so the saved theme applies before first paint.
(function () {
  var KEY = 'wr_theme';
  var DEFAULTS = { mode: 'light', accent: '#16a34a', bg: '#101614' };
  var ACCENTS = ['#16a34a', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#ca8a04'];
  var BGS = ['#101614', '#0b1020', '#1a1025', '#f4f7f5', '#f5f1ea', '#eef2ff', '#ffffff'];
  var root = document.documentElement;

  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save(t) { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) {} }

  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function hex(r, g, b) { return '#' + [r, g, b].map(function (v) { return ('0' + Math.max(0, Math.min(255, v | 0)).toString(16)).slice(-2); }).join(''); }
  function lum(h) {
    var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  var state = load();

  function apply(t) {
    state = t;
    var s = root.style;
    root.setAttribute('data-theme', t.mode);
    if (t.mode === 'custom') {
      root.setAttribute('data-tone', lum(t.bg) < 0.3 ? 'dark' : 'light');
      s.setProperty('--c-bg', t.bg);
      s.setProperty('--c-accent', t.accent);
      // White text on the accent unless the accent is light (e.g. yellow), then near-black.
      s.setProperty('--on-accent', lum(t.accent) > 0.45 ? '#111' : '#fff');
    } else {
      root.setAttribute('data-tone', t.mode);
      ['--c-bg', '--c-accent', '--on-accent'].forEach(function (p) { s.removeProperty(p); });
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.mode === 'custom' ? t.bg : t.mode === 'dark' ? '#0e1311' : '#16a34a');
  }
  apply(state);

  // ---------- picker UI ----------
  var pop = null;

  function close() {
    if (!pop) return;
    pop.remove(); pop = null;
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', esc, true);
  }
  function outside(e) { if (pop && !pop.contains(e.target) && !e.target.closest('#themeBtn')) close(); }
  function esc(e) { if (e.key === 'Escape') close(); }

  function modeCard(mode, label, main, side) {
    return '<button class="theme-mode' + (state.mode === mode ? ' on' : '') + '" data-mode="' + mode + '">' +
      '<span class="sw"><i style="background:' + main + '"></i><i style="background:' + side + '"></i></span>' + label + '</button>';
  }

  function colorRow(key, label, presets) {
    var v = state[key], c = rgb(v);
    var sw = presets.map(function (p) {
      return '<button data-set="' + key + '" data-v="' + p + '" title="' + p + '" style="background:' + p + '"' + (p === v ? ' class="on"' : '') + '></button>';
    }).join('');
    var sliders = ['R', 'G', 'B'].map(function (ch, i) {
      return '<span>' + ch + '</span><input type="range" min="0" max="255" value="' + c[i] + '" data-rgb="' + key + '" data-i="' + i + '"><output>' + c[i] + '</output>';
    }).join('');
    return '<div class="theme-row"><span>' + label + ' <code>' + v.toUpperCase() + '</code></span>' +
      '<div class="theme-swatches">' + sw + '<label class="picker" title="Dowolny kolor"><input type="color" data-pick="' + key + '" value="' + v + '"></label></div>' +
      '<div class="theme-rgb">' + sliders + '</div></div>';
  }

  function render() {
    var custom = state.mode === 'custom';
    pop.innerHTML =
      '<h4>Wygląd</h4>' +
      '<div class="theme-modes">' +
        modeCard('light', 'Jasny', '#f4f7f5', '#16a34a') +
        modeCard('dark', 'Ciemny', '#0e1311', '#22c55e') +
        modeCard('custom', 'Własny', state.bg, state.accent) +
      '</div>' +
      (custom
        ? '<div class="theme-custom">' + colorRow('accent', 'Kolor akcentu', ACCENTS) + colorRow('bg', 'Tło', BGS) +
          '<div class="theme-foot"><small>Zapisane na tym urządzeniu</small><button class="btn btn-ghost btn-sm" data-reset>Przywróć domyślne</button></div></div>'
        : '');
  }

  function set(patch) {
    var t = Object.assign({}, state, patch);
    apply(t); save(t);
  }

  function open(anchor) {
    if (pop) { close(); return; }
    pop = document.createElement('div');
    pop.className = 'theme-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Wygląd');
    render();
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    var w = Math.min(320, window.innerWidth - 16);
    pop.style.width = w + 'px';
    pop.style.top = (r.bottom + 8) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';

    pop.addEventListener('click', function (e) {
      var m = e.target.closest('[data-mode]');
      if (m) { set({ mode: m.dataset.mode }); render(); return; }
      var p = e.target.closest('[data-set]');
      if (p) { var o = {}; o[p.dataset.set] = p.dataset.v; set(o); render(); return; }
      if (e.target.closest('[data-reset]')) { set({ accent: DEFAULTS.accent, bg: DEFAULTS.bg }); render(); }
    });
    // Live updates while dragging; re-render only the labels so the slider keeps focus.
    pop.addEventListener('input', function (e) {
      var el = e.target, key, v;
      if (el.dataset.pick) { key = el.dataset.pick; v = el.value; }
      else if (el.dataset.rgb) {
        key = el.dataset.rgb;
        var c = rgb(state[key]); c[+el.dataset.i] = +el.value; v = hex(c[0], c[1], c[2]);
        el.nextElementSibling.textContent = el.value;
      } else return;
      var o = {}; o[key] = v; set(o);
      var row = el.closest('.theme-row');
      row.querySelector('code').textContent = v.toUpperCase();
      var cc = rgb(v);
      row.querySelectorAll('[data-rgb]').forEach(function (s) { if (s !== el) { s.value = cc[+s.dataset.i]; s.nextElementSibling.textContent = s.value; } });
      if (el.dataset.rgb) row.querySelector('[data-pick]').value = v;
      row.querySelectorAll('[data-set]').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
      var sw = pop.querySelector('[data-mode=custom] .sw');
      if (sw) { sw.children[0].style.background = state.bg; sw.children[1].style.background = state.accent; }
    });
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', esc, true);
  }

  function mount() {
    var bar = document.querySelector('.titlebar-actions');
    if (!bar || document.getElementById('themeBtn')) return;
    var b = document.createElement('button');
    b.id = 'themeBtn';
    b.className = 'btn btn-ghost theme-btn';
    b.title = 'Wygląd: jasny, ciemny, własny';
    b.setAttribute('aria-label', 'Wygląd');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2.2a2 2 0 0 0-1.5 3.3c.8.9.3 2.7-2.3 2.7z"/><circle cx="7.5" cy="10.5" r="1.2" fill="currentColor"/><circle cx="11" cy="6.5" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/></svg>';
    b.addEventListener('click', function () { open(b); });
    bar.insertBefore(b, bar.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  // Other tabs follow changes.
  window.addEventListener('storage', function (e) { if (e.key === KEY) { apply(load()); if (pop) render(); } });

  window.Theme = { get: function () { return Object.assign({}, state); }, set: set, open: function () { var b = document.getElementById('themeBtn'); if (b) open(b); } };
})();
