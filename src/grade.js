const LEADING_PRONOUN = /^(j'|je |tu |il |elle |on |nous |vous |ils |elles )/;

// Unicode combining diacritical marks block (0x0300-0x036f), built from
// code points rather than a literal regex range so the source stays plain
// ASCII instead of embedding invisible combining characters.
const COMBINING_MARK_START = 0x0300;
const COMBINING_MARK_END = 0x036f;

export function normalizeForCompare(str) {
  return str.trim().toLowerCase().replace(LEADING_PRONOUN, '').trim();
}

export function stripAccents(str) {
  return Array.from(str.normalize('NFD'))
    .filter((ch) => {
      const cp = ch.codePointAt(0);
      return cp < COMBINING_MARK_START || cp > COMBINING_MARK_END;
    })
    .join('');
}

/**
 * Compares a typed answer against one or more accepted answers (a single
 * string, or several separated by commas, for words with more than one
 * accepted sense). Returns { grade, correction }, grade one of
 * 'good' | 'almost' | 'again'. correction is the accepted form to display,
 * null when the typed answer was already exact.
 */
export function gradeAnswer(typed, expected) {
  const candidates = Array.isArray(expected)
    ? expected
    : String(expected).split(',').map((s) => s.trim());
  const typedNorm = normalizeForCompare(typed);

  for (const candidate of candidates) {
    if (normalizeForCompare(candidate) === typedNorm) {
      return { grade: 'good', correction: null };
    }
  }

  for (const candidate of candidates) {
    if (stripAccents(normalizeForCompare(candidate)) === stripAccents(typedNorm)) {
      return { grade: 'almost', correction: candidate };
    }
  }

  return { grade: 'again', correction: candidates[0] };
}
