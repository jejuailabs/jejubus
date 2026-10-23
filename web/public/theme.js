try {
  const theme = localStorage.getItem('jejubus.theme');
  document.documentElement.dataset.theme = theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
} catch { /* Browser storage is optional. */ }
