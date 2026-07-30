import { h, clear } from '../dom.js';
import { getSettings, updateSettings, exportData } from '../store.js';

export function renderSettingsView(container) {
  clear(container);
  const settings = getSettings();

  const newCardsInput = h('input', {
    type: 'number', min: '1', max: '50', value: String(settings.newCardsPerDay),
    onchange: (e) => updateSettings({ newCardsPerDay: Math.max(1, Number(e.target.value) || 12) }),
  });

  const conditionnelToggle = h('input', {
    type: 'checkbox',
    onchange: (e) => updateSettings({ conditionnelEnabled: e.target.checked }),
  });
  if (settings.conditionnelEnabled) conditionnelToggle.checked = true;

  const exportButton = h('button', {
    type: 'button',
    onclick: () => {
      const blob = new Blob([exportData()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: 'le-cahier-export.json' });
      a.click();
      URL.revokeObjectURL(url);
    },
  }, 'Export progress as JSON');

  container.append(
    h('h1', {}, 'Settings'),
    h('p', {}, [h('label', {}, ['New cards per day: ', newCardsInput])]),
    h('p', {}, [h('label', {}, [conditionnelToggle, ' Show conditionnel présent in Browse'])]),
    h('p', {}, 'Progress lives only on this device until sync is built. Export it after a session so a browser storage clear cannot take it with it.'),
    exportButton,
  );

  if (/iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone) {
    container.append(h('p', {}, 'On iPhone or iPad: open this page in Safari, then Share, then Add to Home Screen. Chrome on iOS cannot install it.'));
  }
}
