// Sets data-theme on <html> before the first paint so the console never
// flashes the wrong theme. Loaded as a blocking same-origin script from
// index.html, because the CSP allows no inline script.
//
// The only thing stored is the theme choice ("light" or "dark"). With no
// choice stored, the console follows the system setting and keeps
// following it while the tab is open. src/theme/theme.ts owns the toggle
// and uses the same key.
(function () {
  var KEY = 'sb-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try {
      var v = window.localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch {
      return null;
    }
  }

  function apply() {
    var theme = stored() || (media && media.matches ? 'dark' : 'light');
    root.setAttribute('data-theme', theme);
  }

  apply();
  if (media) {
    var onChange = function () {
      if (!stored()) apply();
    };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }
})();
