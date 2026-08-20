/* text-source.js — reads the user's .txt file entirely in the browser.
 *
 * Nothing is uploaded anywhere: the file is read with the File API, parsed
 * into lines, and (if small enough) cached in localStorage so it survives a
 * reload. Handles the common case of a file saved by Windows in cp1252,
 * which would otherwise silently lose every accent.
 */
(function (root) {
  'use strict';

  var STORE_KEY = 'dictation:text';
  var MAX_CACHE_BYTES = 1024 * 1024;   // don't blow the localStorage quota
  var MAX_LINE_LENGTH = 400;           // a "sentence" longer than this is likely a paragraph

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

  /* One line = one dictation item. Blank lines and #-comments are dropped,
     duplicates are collapsed, and the original text is kept verbatim as the
     answer key. */
  function parseLines(text) {
    var seen = Object.create(null);
    var lines = [];
    var skippedLong = 0;
    text.split(/\r\n|\r|\n/).forEach(function (raw) {
      var line = raw.replace(/\ufeff/g, '').trim();
      if (!line) return;
      if (line.charAt(0) === '#') return;
      if (!/[\p{L}]/u.test(line)) return;              // no letters: not dictatable
      if (line.length > MAX_LINE_LENGTH) { skippedLong++; return; }
      var key = line.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      lines.push(line);
    });
    return { lines: lines, skippedLong: skippedLong };
  }

  // ------------------------------------------------------------------- store

  function save(source) {
    try {
      var payload = JSON.stringify({ name: source.name, lines: source.lines, savedAt: Date.now() });
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
      if (!data || !Array.isArray(data.lines) || !data.lines.length) return null;
      return { name: data.name || 'saved text', lines: data.lines, restored: true };
    } catch (e) {
      return null;
    }
  }

  function forget() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ public

  /* Resolves to {name, lines, encoding, skippedLong} or rejects with a
     human-readable Error. */
  function loadFile(file) {
    if (!file) return Promise.reject(new Error('No file chosen.'));
    if (!/\.(txt|text|md)$/i.test(file.name) && file.type && !/^text\//.test(file.type)) {
      return Promise.reject(new Error('That does not look like a plain text file. Save your sentences as .txt (one per line).'));
    }
    return readArrayBuffer(file).then(function (buffer) {
      var d = decode(buffer);
      var p = parseLines(d.text);
      if (!p.lines.length) {
        throw new Error('No usable lines found in "' + file.name + '". Put one sentence per line.');
      }
      var source = {
        name: file.name,
        lines: p.lines,
        encoding: d.encoding,
        skippedLong: p.skippedLong
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

  root.TextSource = {
    attach: attach,
    loadFile: loadFile,
    parseLines: parseLines,
    restore: restore,
    forget: forget,
    MAX_LINE_LENGTH: MAX_LINE_LENGTH
  };
})(typeof window !== 'undefined' ? window : this);
