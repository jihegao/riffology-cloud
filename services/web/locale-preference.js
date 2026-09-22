/** Keeps an optional account locale separate from the page's local locale. */
export function createLocalePreferenceController({read, write, currentLocale, applyLocale, onSaveFailure, onSaveSuccess = () => {}}) {
  let account = null;
  let selection = 0;
  let pending = null;
  let writing = false;
  let queued = null;

  const current = context => account?.userId === context.userId && account?.generation === context.generation;
  async function flush() {
    if (writing) return;
    writing = true;
    try {
      while (pending) {
        const next = pending;
        pending = null;
        if (!current(next.context)) continue;
        try { await write(next.locale); if (current(next.context) && selection === next.selection) onSaveSuccess(); }
        catch { if (current(next.context) && selection === next.selection) onSaveFailure(); }
      }
    } finally { writing = false; if (pending) void flush(); }
  }
  function queue(context, locale, version) {
    if (queued?.userId === context.userId && queued?.generation === context.generation && queued?.selection === version) return;
    queued = {userId:context.userId, generation:context.generation, selection:version};
    pending = {context, locale, selection:version};
    void flush();
  }
  async function hydrate(context, startedAt, loadedPreference) {
    let preference = loadedPreference;
    if (preference === undefined) {
      try { preference = await read(); } catch { return; }
    }
    if (!current(context)) return;
    if (selection === startedAt) { if (typeof preference?.locale === 'string') applyLocale(preference.locale); return; }
    queue(context, currentLocale(), selection);
  }
  function begin() {
    pending = null;
    queued = null;
    account = null;
    return selection;
  }
  function activate(userId, generation, startedAt = selection, loadedPreference = undefined) {
    account = typeof userId === 'string' ? {userId, generation} : null;
    if (account) void hydrate(account, startedAt, loadedPreference);
  }
  function select(locale) { const version = ++selection; onSaveSuccess(); if (account) queue(account, locale, version); }
  return {begin, activate, select};
}
