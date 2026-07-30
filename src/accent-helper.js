import { h } from './dom.js';
import { getSettings } from './store.js';

const ACCENTS = ['é', 'è', 'ê', 'à', 'â', 'ç', 'î', 'ô', 'û', 'ù'];

// Alt-key shortcuts for desktop typists. Long-pressing a vowel already gives
// accents on both iOS and Android keyboards, so this row is a desktop aid,
// not a touch one (section 12.1) — Alt+e/shift/ctrl covers e's three forms,
// the rest get one or two.
const SHORTCUTS = [
  { key: 'e', alt: true, char: 'é' },
  { key: 'e', alt: true, shift: true, char: 'è' },
  { key: 'e', alt: true, ctrl: true, char: 'ê' },
  { key: 'a', alt: true, char: 'à' },
  { key: 'a', alt: true, shift: true, char: 'â' },
  { key: 'c', alt: true, char: 'ç' },
  { key: 'i', alt: true, char: 'î' },
  { key: 'o', alt: true, char: 'ô' },
  { key: 'u', alt: true, char: 'û' },
  { key: 'u', alt: true, shift: true, char: 'ù' },
];

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function insertAt(input, char) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + char + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + char.length;
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Attaches the accent row (desktop, unless the learner opts in on touch)
 * and Alt-key shortcuts (always, harmless on touch) to a text input.
 * Returns the row element, or null if it wasn't rendered.
 */
export function attachAccentHelper(input) {
  input.addEventListener('keydown', (e) => {
    const match = SHORTCUTS.find((s) =>
      s.key === e.key.toLowerCase() && Boolean(s.alt) === e.altKey &&
      Boolean(s.shift) === e.shiftKey && Boolean(s.ctrl) === e.ctrlKey);
    if (match) {
      e.preventDefault();
      insertAt(input, match.char);
    }
  });

  const settings = getSettings();
  if (isTouchDevice() && !settings.accentHelperOnTouch) return null;

  const row = h('div', { class: 'accent-row' },
    ACCENTS.map((char) => h('button', {
      type: 'button',
      tabindex: '-1',
      onclick: () => insertAt(input, char),
    }, char)));
  return row;
}
