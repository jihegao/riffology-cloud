import {subscribe, t} from './i18n.js';

// Only explicitly registered platform labels are touched. Values, user content,
// iframe documents and the containing panels are never discovered or rebuilt.
const records = new Set();
const finalized = new FinalizationRegistry(record => records.delete(record));
function release(record) { records.delete(record); finalized.unregister(record); }
const slots = new WeakMap();
const attributes = new Set(['aria-label', 'aria-valuetext', 'title', 'placeholder', 'alt']);

function update(record) {
  const node = record.node.deref();
  if (!node) { release(record); return; }
  try {
    const text = typeof record.key === 'function'
      ? record.key()
      : t(record.key, typeof record.vars === 'function' ? record.vars() : record.vars);
    if (record.attribute) node.setAttribute(record.attribute, String(text ?? ''));
    else node.textContent = String(text ?? '');
  } catch {
    // A malformed display value must not interrupt the rest of a locale change
    // or discard the existing label; its owning UI can report the data error.
  }
}

function bind(node, attribute, key, vars = {}) {
  if (!node || typeof node !== 'object') throw new TypeError('A platform text node is required');
  const property = attribute ?? 'textContent';
  let bindings = slots.get(node);
  if (!bindings) { bindings = new Map(); slots.set(node, bindings); }
  const previous = bindings.get(property);
  if (previous) release(previous);
  const record = {node:new WeakRef(node), attribute, key, vars};
  bindings.set(property, record); records.add(record);
  finalized.register(node, record, record);
  // A dynamic binding owns this property, including when HTML provided its
  // initial fallback. A subsequent static shell pass cannot overwrite it.
  if (!attribute) node.removeAttribute?.('data-i18n');
  else node.removeAttribute?.(`data-i18n-${attribute}`);
  update(record);
  return node;
}

export function bindText(node, key, vars) { return bind(node, null, key, vars); }
export function bindValue(node, value) {
  return bindText(node, () => String((typeof value === 'function' ? value() : value) ?? ''));
}
export function bindAttribute(node, attribute, key, vars) {
  if (!attributes.has(attribute)) throw new TypeError('Only presentation attributes can be localized');
  return bind(node, attribute, key, vars);
}
export function unbindI18n(node) {
  for (const record of slots.get(node)?.values() ?? []) release(record);
  slots.delete(node);
}
subscribe(() => { for (const record of records) update(record); });
