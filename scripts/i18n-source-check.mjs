// Conservative copy detection, not a JavaScript parser. Technical strings have
// reviewed exceptions; new prose or capitalized action labels require review.
export function englishLiterals(source) {
  const counts = {};
  const tokens = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|(['"`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g;
  for (const match of source.matchAll(tokens)) {
    if (!match[1]) continue;
    const value = match[2];
    if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(value) || /^[A-Z][a-z]+(?:[.!?]|…)?$/.test(value)) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
  }
  return counts;
}
