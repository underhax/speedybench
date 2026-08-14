export function initTheme(): void {
  const savedTheme = window.localStorage.getItem('theme');
  if (savedTheme) {
    document.documentElement.className = savedTheme;
  } else {
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    document.documentElement.className = prefersLight ? 'theme-light' : 'theme-dark';
  }
}

export function toggleTheme(): void {
  const isLight = document.documentElement.classList.contains('theme-light');
  const newTheme = isLight ? 'theme-dark' : 'theme-light';
  document.documentElement.className = newTheme;
  window.localStorage.setItem('theme', newTheme);
}
