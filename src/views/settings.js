import { h, clear } from '../dom.js';
import { getSettings, updateSettings, exportData } from '../store.js';
import { initSync, syncNow, signOut, sendMagicLink, onSyncStatus, isSignedIn } from '../sync.js';

// The view is rebuilt on every visit, so drop the previous subscription or the
// old status line keeps getting written to after it leaves the document.
let unwatchStatus = null;

function renderSyncSection(container) {
  const settings = getSettings();

  const status = h('p', { 'aria-live': 'polite' }, 'Sync is off.');

  const urlInput = h('input', {
    type: 'url', placeholder: 'https://yourproject.supabase.co',
    value: settings.syncUrl ?? '',
    onchange: (e) => {
      updateSettings({ syncUrl: e.target.value.trim() });
      initSync();
    },
  });

  const keyInput = h('input', {
    type: 'text', placeholder: 'anon public key', spellcheck: 'false',
    value: settings.syncAnonKey ?? '',
    onchange: (e) => {
      updateSettings({ syncAnonKey: e.target.value.trim() });
      initSync();
    },
  });

  const emailInput = h('input', {
    type: 'email', placeholder: 'you@example.com', autocomplete: 'email',
  });

  const linkFeedback = h('p', { 'aria-live': 'polite' });

  const linkButton = h('button', {
    type: 'button',
    onclick: async () => {
      clear(linkFeedback);
      linkButton.disabled = true;
      try {
        await sendMagicLink(emailInput.value.trim());
        linkFeedback.append(h('span', { class: 'correct' }, 'Link sent. Open it on this device.'));
      } catch (err) {
        linkFeedback.append(h('span', { class: 'incorrect' }, err.message));
      } finally {
        linkButton.disabled = false;
      }
    },
  }, 'Email me a sign in link');

  const syncButton = h('button', { type: 'button', onclick: () => syncNow() }, 'Sync now');
  const signOutButton = h('button', { type: 'button', onclick: () => signOut() }, 'Sign out');

  container.append(
    h('h2', {}, 'Sync'),
    h('p', {}, 'Sync keeps one schedule across your laptop and your phone. The app works fully without it.'),
    status,
    h('p', {}, [h('label', {}, ['Supabase project URL ', urlInput])]),
    h('p', {}, [h('label', {}, ['Supabase anon key ', keyInput])]),
    h('p', {}, [h('label', {}, ['Email ', emailInput])]),
    h('div', { class: 'button-row' }, [linkButton, syncButton, signOutButton]),
    linkFeedback,
    h('p', { class: 'gloss' }, 'Set up the progress table first. README.md has the SQL and the redirect URL to allow.'),
  );

  if (unwatchStatus) unwatchStatus();
  unwatchStatus = onSyncStatus((next) => {
    clear(status);
    status.append(h('span', { class: next.state === 'error' ? 'incorrect' : null }, next.message));
    // Signing out and signing in change which buttons make sense.
    const signedIn = isSignedIn();
    syncButton.disabled = !signedIn;
    signOutButton.disabled = !signedIn;
    linkButton.disabled = signedIn;
  });
}

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

  const ttsToggle = h('input', {
    type: 'checkbox',
    onchange: (e) => updateSettings({ ttsEnabled: e.target.checked }),
  });
  if (settings.ttsEnabled) ttsToggle.checked = true;

  const accentTouchToggle = h('input', {
    type: 'checkbox',
    onchange: (e) => updateSettings({ accentHelperOnTouch: e.target.checked }),
  });
  if (settings.accentHelperOnTouch) accentTouchToggle.checked = true;

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
    h('p', {}, [h('label', {}, [ttsToggle, ' Speak French words aloud (fr-FR)'])]),
    h('p', {}, [h('label', {}, [accentTouchToggle, ' Show the accent button row on touch devices too'])]),
    h('p', {}, 'Browser storage on iOS can be cleared without warning. Export after a session, or turn on sync below.'),
    exportButton,
  );

  renderSyncSection(container);

  if (/iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone) {
    container.append(h('p', {}, 'On iPhone or iPad: open this page in Safari, then Share, then Add to Home Screen. Chrome on iOS cannot install it.'));
  }
}
