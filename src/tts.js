import { getSettings } from './store.js';

let cachedVoice;
let voicesReady = false;

function pickFrenchVoice() {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  voicesReady = true;
  return voices.find((v) => v.lang === 'fr-FR') ?? voices.find((v) => v.lang?.startsWith('fr')) ?? null;
}

if (typeof speechSynthesis !== 'undefined') {
  // getVoices() is often empty on first call; the list loads asynchronously.
  speechSynthesis.addEventListener('voiceschanged', () => {
    cachedVoice = pickFrenchVoice();
  });
  cachedVoice = pickFrenchVoice();
}

/**
 * Speaks French text. Must be called synchronously from a user gesture
 * (a click handler) for iOS Safari to allow audio. Fails silently when
 * speech synthesis or a French voice is unavailable.
 */
export function speak(text) {
  if (!getSettings().ttsEnabled) return;
  if (typeof speechSynthesis === 'undefined' || !text) return;
  if (!voicesReady) cachedVoice = pickFrenchVoice();
  if (!cachedVoice) return; // no fr-FR voice available; skip rather than mispronounce

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = cachedVoice;
  utterance.lang = 'fr-FR';
  speechSynthesis.cancel(); // don't stack utterances if tapped repeatedly
  speechSynthesis.speak(utterance);
}
