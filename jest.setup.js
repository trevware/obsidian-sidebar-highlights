// Minimal shims for Obsidian's global DOM helpers (createEl/createDiv/createSpan/createFragment)
// so modules using them can run under jsdom. Mirrors DomElementInfo handling for the
// options this codebase uses: cls, text, attr, title, parent.
function applyDomElementInfo(el, o) {
  if (typeof o === 'string') {
    el.className = o;
    return;
  }
  if (!o) return;
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
  if (o.text != null) el.textContent = o.text;
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
  if (o.title != null) el.title = o.title;
  if (o.parent) o.parent.appendChild(el);
}
global.createEl = (tag, o, callback) => {
  const el = document.createElement(tag);
  applyDomElementInfo(el, o);
  if (callback) callback(el);
  return el;
};
global.createDiv = (o, callback) => global.createEl('div', o, callback);
global.createSpan = (o, callback) => global.createEl('span', o, callback);
global.createFragment = (callback) => {
  const f = document.createDocumentFragment();
  if (callback) callback(f);
  return f;
};
