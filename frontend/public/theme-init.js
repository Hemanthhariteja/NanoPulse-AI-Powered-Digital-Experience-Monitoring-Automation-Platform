// Apply the saved theme before first paint to avoid a flash (external file so a strict CSP can allow it).
try {
  var t = localStorage.getItem('np-theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {}
