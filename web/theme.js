// Light or dark: the saved choice, else the system setting, followed live. The inline script in index.html sets the first
// value before the page paints. Choosing the theme the system already has clears the saved choice, so the page follows the
// system again.
import {paletteCss} from './lib.js?v=0.27.0';

const KEY = 'upliftlab.theme', THEMES = ['light', 'dark'], media = matchMedia('(prefers-color-scheme: light)');
const saved = () => { try { const t = localStorage.getItem(KEY); return THEMES.includes(t) ? t : null; } catch { return null; } };
const system = () => (media.matches ? 'light' : 'dark');
const listeners = new Set();
export const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
export const onTheme = f => { listeners.add(f); f(theme()); };

function apply(next) {
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#f4f5f7' : '#06070a');
  listeners.forEach(f => f(next));
}
export function toggleTheme() {
  const next = theme() === 'light' ? 'dark' : 'light';
  try { if (next === system()) localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch { /* this tab only */ }
  apply(next);
}
media.addEventListener('change', () => { if (!saved()) apply(system()); });

const style = document.createElement('style');
style.textContent = `:root{${paletteCss('dark')}}:root[data-theme=light]{${paletteCss('light')}}`;
document.head.append(style);
apply(saved() || system());
