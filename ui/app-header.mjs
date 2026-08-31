const node = (document, tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };

export function createAppHeader({ document, title, onBack, action = null }) {
  if (!document?.createElement) throw new TypeError('App header requires a DOM document');
  if (typeof onBack !== 'function') throw new TypeError('App header requires real Back behavior');
  const header = node(document, 'header');
  header.className = 'tmrw-v3-app-header';

  const back = node(document, 'button', '←');
  back.type = 'button';
  back.className = 'tmrw-v3-app-back';
  back.dataset.navAction = 'back';
  back.setAttribute('aria-label', 'Back');
  back.addEventListener('click', onBack);

  const heading = node(document, 'h2', String(title || 'App'));
  heading.className = 'tmrw-v3-app-title';

  const actionSlot = node(document, 'div');
  actionSlot.className = 'tmrw-v3-app-action';
  if (action?.node) actionSlot.append(action.node);
  else actionSlot.setAttribute('aria-hidden', 'true');

  header.append(back, heading, actionSlot);
  return header;
}
