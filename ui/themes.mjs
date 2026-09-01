export const PHONE_THEME = Object.freeze({ LIGHT_BLUE: 'light-blue', SOFT_SLATE: 'soft-slate', PAPER: 'paper' });

export const PHONE_THEMES = Object.freeze([
  Object.freeze({ id: PHONE_THEME.LIGHT_BLUE, label: 'Light Blue', description: 'TMRW default · light blue accent' }),
  Object.freeze({ id: PHONE_THEME.SOFT_SLATE, label: 'Soft Slate', description: 'Calm neutral blue-gray' }),
  Object.freeze({ id: PHONE_THEME.PAPER, label: 'Paper', description: 'Warm-white minimal surface' }),
]);

export function normalizePhoneTheme(value) {
  const id = String(value || '').trim();
  return PHONE_THEMES.some(theme => theme.id === id) ? id : PHONE_THEME.LIGHT_BLUE;
}

const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export function renderTheme({ document, selectedTheme, onSelect }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-theme';
  const choices = el(document, 'div'); choices.className = 'tmrw-v3-theme-choices tmrw-phone-utility-list';
  for (const theme of PHONE_THEMES) {
    const button = el(document, 'button'); button.type = 'button'; button.dataset.themeChoice = theme.id; button.setAttribute('aria-pressed', String(theme.id === selectedTheme)); button.setAttribute('aria-label', `Use ${theme.label} theme`);
    const copy = el(document, 'span'); copy.append(el(document, 'strong', theme.label), el(document, 'small', theme.description)); button.append(copy, el(document, 'b', theme.id === selectedTheme ? '✓' : ''));
    let busy = false; button.addEventListener('click', () => { if (busy || button.disabled || theme.id === selectedTheme) return; busy = true; button.disabled = true; void Promise.resolve(onSelect?.(theme.id)).finally(() => { busy = false; }); });
    choices.append(button);
  }
  root.append(choices); return root;
}
