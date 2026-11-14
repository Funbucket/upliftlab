// The interface language, decided once per page load: ?lang=ko|en in the address, else the viewer's last choice, else the
// browser's language (Korean browsers get Korean, everyone else English). Switching saves the choice and reloads, so every
// view simply reads `EN` and `tr()` while it renders.
const LANGS = ['ko', 'en'], KEY = 'upliftlab.lang';
const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const asked = new URLSearchParams(location.search).get('lang');
export const lang = LANGS.includes(asked) ? asked : LANGS.includes(stored()) ? stored() : /^ko\b/i.test(navigator.language || '') ? 'ko' : 'en';
export const EN = lang === 'en';
export const LOCALE = EN ? 'en-US' : 'ko-KR';
/** The text for the current language: tr('한국어', 'English'). */
export const tr = (ko, en) => (EN ? en : ko);
document.documentElement.lang = lang;

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  let saved = true;
  try { localStorage.setItem(KEY, next); } catch { saved = false; }
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  if (asked || !saved) url.searchParams.set('lang', next);  // a shared ?lang= link, or a browser without storage, keeps it in the address
  history.replaceState(null, '', url);
  location.reload();  // replace() alone would not reload when only the hash part is left
}

// Static text in index.html: elements with data-en get English text, data-en-label an English aria-label.
export function translateStatic(root = document) {
  if (!EN) return;
  root.querySelectorAll('[data-en]').forEach(el => { el.textContent = el.dataset.en; });
  root.querySelectorAll('[data-en-label]').forEach(el => el.setAttribute('aria-label', el.dataset.enLabel));
  document.title = 'upliftlab · Race uplift models on the same budget';
}
