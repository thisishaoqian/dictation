/* text-source.js — reads the user's .txt file entirely in the browser.
 *
 * Nothing is uploaded anywhere: the file is read with the File API, parsed
 * into items, and (if small enough) cached in localStorage so it survives a
 * reload. Handles the common case of a file saved by Windows in cp1252,
 * which would otherwise silently lose every accent.
 *
 * File format — one item per line:
 *
 *     Il fait beau. | It's nice out.        <- both modes
 *     Le chat dort.                         <- listening mode only
 *     # a whole-line comment
 *     J'ai froid. | I'm cold.   # trailing note, ignored
 *
 * Fields are separated by "|" or a tab. Everything from the first unescaped
 * "#" to the end of the line is a comment, wherever it appears. Use \# , \|
 * and \\ for a literal #, | or backslash.
 *
 * Also usable from Node (module.exports) so the parser can be unit-tested.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TextSource = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var STORE_KEY = 'dictation:text:v2';
  var MAX_CACHE_BYTES = 1024 * 1024;   // don't blow the localStorage quota
  var MAX_LINE_LENGTH = 400;           // longer than this is a paragraph, not a sentence

  // ------------------------------------------------------------------ decode

  function readArrayBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('Could not read the file')); };
      fr.readAsArrayBuffer(file);
    });
  }

  /* Mojibake fingerprints: cp1252 bytes decoded as UTF-8 land in this range. */
  var MOJIBAKE = /[\u00c2\u00c3][\u0080-\u00bf]|\u00e2\u0080[\u0099\u009c\u009d]/;

  function decode(buffer) {
    var bytes = new Uint8Array(buffer);
    var text, encoding = 'utf-8';
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (MOJIBAKE.test(text)) throw new Error('mojibake');
    } catch (e) {
      try {
        text = new TextDecoder('windows-1252').decode(bytes);
        encoding = 'windows-1252';
      } catch (e2) {
        text = new TextDecoder('utf-8').decode(bytes);   // last resort, lossy
        encoding = 'utf-8 (lossy)';
      }
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // strip BOM
    return { text: text, encoding: encoding };
  }

  // ------------------------------------------------------------------- parse

  /* Split one raw line into trimmed fields, honouring escapes and dropping
     the comment. Returns [] for a line that is entirely comment/blank. */
  function splitFields(raw) {
    var fields = [];
    var cur = '';
    for (var i = 0; i < raw.length; i++) {
      var c = raw.charAt(i);
      if (c === '\\') {
        var next = raw.charAt(i + 1);
        if (next === '#' || next === '|' || next === '\\') { cur += next; i++; continue; }
        cur += c;
        continue;
      }
      if (c === '#') break;                                  // comment to end of line
      if (c === '|' || c === '\t') { fields.push(cur); cur = ''; continue; }
      cur += c;
    }
    fields.push(cur);
    return fields.map(function (f) { return f.replace(/\ufeff/g, '').trim(); });
  }

  /* One line = one item. Blank lines, comments and lines with no French are
     dropped; duplicates (by French) are collapsed. The original text is kept
     verbatim as the answer key. */
  function parseItems(text) {
    var seen = Object.create(null);
    var items = [];
    var skippedLong = 0;

    text.split(/\r\n|\r|\n/).forEach(function (raw) {
      var fields = splitFields(raw);
      var fr = fields[0];
      if (!fr) return;
      if (!/[\p{L}]/u.test(fr)) return;                      // no letters: not dictatable
      if (fr.length > MAX_LINE_LENGTH) { skippedLong++; return; }

      var key = fr.toLowerCase();
      if (seen[key]) {
        // A later line may supply the translation a previous one lacked.
        var prev = items[seen[key].at];
        if (!prev.en && fields[1]) prev.en = fields[1];
        return;
      }
      seen[key] = { at: items.length };
      items.push({ fr: fr, en: fields[1] || '' });
    });

    return {
      items: items,
      skippedLong: skippedLong,
      withTranslation: items.filter(function (it) { return !!it.en; }).length
    };
  }

  // ------------------------------------------------------------------- store

  function save(source) {
    try {
      var payload = JSON.stringify({ name: source.name, items: source.items, savedAt: Date.now() });
      if (payload.length > MAX_CACHE_BYTES) { forget(); return false; }
      localStorage.setItem(STORE_KEY, payload);
      return true;
    } catch (e) {
      return false;   // private mode, quota, whatever — not fatal
    }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.items) || !data.items.length) return null;
      var items = data.items.filter(function (it) { return it && it.fr; });
      if (!items.length) return null;
      return {
        name: data.name || 'saved text',
        items: items,
        withTranslation: items.filter(function (it) { return !!it.en; }).length,
        restored: true
      };
    } catch (e) {
      return null;
    }
  }

  function forget() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ public

  /* Resolves to {name, items, encoding, skippedLong, withTranslation} or
     rejects with a human-readable Error. */
  function loadFile(file) {
    if (!file) return Promise.reject(new Error('No file chosen.'));
    if (!/\.(txt|text|md|tsv)$/i.test(file.name) && file.type && !/^text\//.test(file.type)) {
      return Promise.reject(new Error('That does not look like a plain text file. Save your sentences as .txt (one per line).'));
    }
    return readArrayBuffer(file).then(function (buffer) {
      var d = decode(buffer);
      var p = parseItems(d.text);
      if (!p.items.length) {
        throw new Error('No usable lines found in "' + file.name + '". Put one French sentence per line, optionally followed by "| its English translation".');
      }
      var source = {
        name: file.name,
        items: p.items,
        encoding: d.encoding,
        skippedLong: p.skippedLong,
        withTranslation: p.withTranslation
      };
      source.cached = save(source);
      return source;
    });
  }

  /* Wires a file input and a drop target. onLoad(source) / onError(message). */
  function attach(opts) {
    var input = opts.input;
    var zone = opts.dropZone || document.body;

    function handle(file) {
      loadFile(file).then(opts.onLoad, function (err) {
        opts.onError(err && err.message ? err.message : 'Could not read that file.');
      });
    }

    if (input) {
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) handle(input.files[0]);
        input.value = '';   // so re-picking the same file fires again
      });
    }

    ['dragenter', 'dragover'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'dragend', 'drop'].forEach(function (evt) {
      zone.addEventListener(evt, function () { zone.classList.remove('is-dragover'); });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) handle(dt.files[0]);
    });
  }

  return {
    attach: attach,
    loadFile: loadFile,
    parseItems: parseItems,
    splitFields: splitFields,
    restore: restore,
    forget: forget,
    MAX_LINE_LENGTH: MAX_LINE_LENGTH
  };
});
