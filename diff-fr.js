/* diff-fr.js — French dictation diff engine.
 *
 * Pure logic, no DOM: usable in the browser (window.FrDiff) and in Node
 * (module.exports) so it can be unit-tested with `node test-diff.js`.
 *
 * Public API
 *   FrDiff.compare(expected, got, opts) -> result
 *   FrDiff.DEFAULTS
 *   FrDiff.tokenize / normalizeChars / deaccent   (exposed for tests)
 *
 * Options — each dimension is 'ignore' | 'minor' | 'strict':
 *   { case: 'ignore', accents: 'minor', punct: 'ignore' }
 *     ignore : difference is invisible to the grader
 *     minor  : difference is reported as a slip but does not fail the line
 *     strict : difference is a real error and fails the line
 *
 * Result
 *   {
 *     ops: [ {op, expected, got, severity, reasons, charDiff} ],
 *     counts: {match, wrong, missing, extra, minor},
 *     correct: bool,        // no major errors -> the round is passed
 *     perfect: bool,        // not even a minor slip
 *     wordAccuracy: 0..1
 *   }
 *   op       : 'match' | 'sub' | 'missing' | 'extra'
 *   severity : 'match' | 'minor' | 'major' | 'ignored'
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FrDiff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULTS = { case: 'ignore', accents: 'minor', punct: 'ignore' };

  // ---------------------------------------------------------------- normalize

  var APOSTROPHES = /[’‘‛´`]/g;   // ’ ‘ ‛ ´ `
  var DASHES = /[‐‑‒–—―]/g;  // ‐ ‑ ‒ – — ―
  var QUOTES = /[«»“”„]/g;        // « » “ ” „
  var SPACES = /[     ]/g;   // nbsp, narrow nbsp, figure/thin/hair

  /* Canonicalise characters that are really the same character typed
     differently. This is applied everywhere before comparing. */
  function normalizeChars(s) {
    return String(s)
      .normalize('NFC')
      .replace(APOSTROPHES, "'")
      .replace(DASHES, '-')
      .replace(QUOTES, '"')
      .replace(SPACES, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Strip diacritics and unpack French ligatures: é->e, ç->c, œ->oe, æ->ae. */
  function deaccent(s) {
    return String(s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .normalize('NFC')
      .replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
      .replace(/æ/g, 'ae').replace(/Æ/g, 'AE');
  }

  // ---------------------------------------------------------------- tokenize

  /* A token is a word, an elided prefix (l', d', qu', aujourd'), or a single
     punctuation character. Hyphens come out as punctuation, so "est-ce" and
     "est ce" align word-for-word. */
  var TOKEN_RE = /[0-9\p{L}\p{M}]+['’]|[0-9\p{L}\p{M}]+|[^\s0-9\p{L}\p{M}]/gu;

  function tokenize(line) {
    var text = normalizeChars(line);
    var out = [];
    var m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      var raw = m[0];
      var isWord = /[0-9\p{L}]/u.test(raw);
      out.push({ text: raw, type: isWord ? 'word' : 'punct' });
    }
    return out;
  }

  // ---------------------------------------------------------------- compare 2

  function lower(s) { return s.toLowerCase(); }

  /* Compare two tokens under the given leniency options.
     Returns {severity, reasons} where severity is
     'match' | 'ignored' | 'minor' | 'major'. */
  function compareTokens(a, b, opts) {
    var ta = a.text, tb = b.text;
    if (ta === tb) return { severity: 'match', reasons: [] };

    // Punctuation is graded as one single dimension.
    if (a.type === 'punct' || b.type === 'punct') {
      if (a.type !== b.type) return { severity: 'major', reasons: ['word'] };
      return { severity: rank(opts.punct), reasons: ['punct'] };
    }

    var sameBase = deaccent(lower(ta)) === deaccent(lower(tb));
    if (!sameBase) return { severity: 'major', reasons: ['word'] };

    // Same letters — so whatever is left is accents and/or capitals.
    var accentDiff = lower(ta) !== lower(tb);
    var caseDiff = deaccent(ta) !== deaccent(tb);

    var severity = 'match';
    var reasons = [];
    if (accentDiff) { severity = worse(severity, rank(opts.accents)); reasons.push('accent'); }
    if (caseDiff) { severity = worse(severity, rank(opts.case)); reasons.push('case'); }
    if (severity === 'match') reasons = [];
    return { severity: severity, reasons: reasons };
  }

  function rank(mode) {
    if (mode === 'strict') return 'major';
    if (mode === 'minor') return 'minor';
    return 'ignored';
  }

  var ORDER = { match: 0, ignored: 1, minor: 2, major: 3 };
  function worse(a, b) { return ORDER[a] >= ORDER[b] ? a : b; }

  /* Severity of a token that is missing from, or extra in, the answer. */
  function gapSeverity(token, opts) {
    if (token.type === 'punct') return rank(opts.punct);
    return 'major';
  }

  // ---------------------------------------------------------------- char diff

  /* Levenshtein backtrace over characters, returned as runs so a renderer can
     highlight exactly which letters differ. */
  function charDiff(a, b) {
    var n = a.length, m = b.length;
    var d = [], i, j;
    for (i = 0; i <= n; i++) { d[i] = [i]; }
    for (j = 0; j <= m; j++) { d[0][j] = j; }
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      }
    }
    var ea = [], eb = [];
    i = n; j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
        var same = a[i - 1] === b[j - 1];
        ea.unshift({ ch: a[i - 1], same: same });
        eb.unshift({ ch: b[j - 1], same: same });
        i--; j--;
      } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
        ea.unshift({ ch: a[i - 1], same: false });
        i--;
      } else {
        eb.unshift({ ch: b[j - 1], same: false });
        j--;
      }
    }
    return { expected: runs(ea), got: runs(eb), distance: d[n][m] };
  }

  function runs(chars) {
    var out = [];
    chars.forEach(function (c) {
      var last = out[out.length - 1];
      if (last && last.same === c.same) last.text += c.ch;
      else out.push({ text: c.ch, same: c.same });
    });
    return out;
  }

  function charRatio(a, b) {
    var max = Math.max(a.length, b.length) || 1;
    return charDiff(a, b).distance / max;
  }

  // ---------------------------------------------------------------- alignment

  var GAP_IGNORED = 0.02;   // dropping a comma when commas are ignored: near-free
  var GAP = 1;

  function compare(expected, got, options) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    var A = tokenize(expected);
    var B = tokenize(got);
    var n = A.length, m = B.length, i, j;

    function gapCost(tok) {
      return gapSeverity(tok, opts) === 'ignored' ? GAP_IGNORED : GAP;
    }

    function subCost(a, b) {
      // Never swap a word for a punctuation mark — show them as extra/missing.
      if (a.type !== b.type) return 99;
      var c = compareTokens(a, b, opts);
      if (c.severity === 'match') return 0;
      if (c.severity === 'ignored') return 0.05;
      if (c.severity === 'minor') return 0.15;
      // Cheaper than two gaps, so a wrong word reads as "you wrote X, not Y".
      return 0.4 + 0.5 * charRatio(deaccent(lower(a.text)), deaccent(lower(b.text)));
    }

    var d = [], bt = [];
    for (i = 0; i <= n; i++) { d[i] = new Array(m + 1); bt[i] = new Array(m + 1); }
    d[0][0] = 0; bt[0][0] = null;
    for (i = 1; i <= n; i++) { d[i][0] = d[i - 1][0] + gapCost(A[i - 1]); bt[i][0] = 'up'; }
    for (j = 1; j <= m; j++) { d[0][j] = d[0][j - 1] + gapCost(B[j - 1]); bt[0][j] = 'left'; }

    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        var diag = d[i - 1][j - 1] + subCost(A[i - 1], B[j - 1]);
        var up = d[i - 1][j] + gapCost(A[i - 1]);      // expected token unmatched -> missing
        var left = d[i][j - 1] + gapCost(B[j - 1]);    // answer token unmatched   -> extra
        var best = Math.min(diag, up, left);
        d[i][j] = best;
        bt[i][j] = best === diag ? 'diag' : (best === up ? 'up' : 'left');
      }
    }

    // ---- traceback
    var ops = [];
    i = n; j = m;
    while (i > 0 || j > 0) {
      var move = (i > 0 && j > 0) ? bt[i][j] : (i > 0 ? 'up' : 'left');
      if (move === 'diag') {
        var cmp = compareTokens(A[i - 1], B[j - 1], opts);
        ops.unshift({
          op: cmp.severity === 'match' ? 'match' : 'sub',
          expected: A[i - 1].text,
          got: B[j - 1].text,
          type: A[i - 1].type,
          severity: cmp.severity,
          reasons: cmp.reasons,
          charDiff: cmp.severity === 'match' ? null : charDiff(A[i - 1].text, B[j - 1].text)
        });
        i--; j--;
      } else if (move === 'up') {
        ops.unshift({
          op: 'missing', expected: A[i - 1].text, got: null, type: A[i - 1].type,
          severity: gapSeverity(A[i - 1], opts), reasons: [A[i - 1].type === 'punct' ? 'punct' : 'word'],
          charDiff: null
        });
        i--;
      } else {
        ops.unshift({
          op: 'extra', expected: null, got: B[j - 1].text, type: B[j - 1].type,
          severity: gapSeverity(B[j - 1], opts), reasons: [B[j - 1].type === 'punct' ? 'punct' : 'word'],
          charDiff: null
        });
        j--;
      }
    }

    // ---- tally
    var counts = { match: 0, wrong: 0, missing: 0, extra: 0, minor: 0 };
    var hasMajor = false, hasMinor = false;
    ops.forEach(function (o) {
      if (o.severity === 'major') hasMajor = true;
      if (o.severity === 'minor') { hasMinor = true; counts.minor++; }
      if (o.op === 'match' || o.severity === 'ignored') counts.match++;
      else if (o.op === 'sub') counts.wrong += (o.severity === 'major' ? 1 : 0);
      else if (o.op === 'missing') counts.missing += (o.severity === 'major' ? 1 : 0);
      else if (o.op === 'extra') counts.extra += (o.severity === 'major' ? 1 : 0);
    });

    var expectedWords = A.filter(function (t) { return t.type === 'word'; }).length;
    var goodWords = ops.filter(function (o) {
      return o.type === 'word' && o.op !== 'extra' && o.severity !== 'major';
    }).length;

    return {
      ops: ops,
      counts: counts,
      correct: !hasMajor,
      perfect: !hasMajor && !hasMinor,
      wordAccuracy: expectedWords ? goodWords / expectedWords : 1,
      expectedWords: expectedWords
    };
  }

  /* Short human summary, e.g. "2 wrong words · 1 missing word · 1 accent". */
  function summarize(result) {
    var bits = [];
    var c = result.counts;
    if (c.wrong) bits.push(c.wrong + (c.wrong > 1 ? ' wrong words' : ' wrong word'));
    if (c.missing) bits.push(c.missing + (c.missing > 1 ? ' missing words' : ' missing word'));
    if (c.extra) bits.push(c.extra + (c.extra > 1 ? ' extra words' : ' extra word'));
    if (c.minor) {
      var kinds = {};
      result.ops.forEach(function (o) {
        if (o.severity === 'minor') o.reasons.forEach(function (r) { kinds[r] = (kinds[r] || 0) + 1; });
      });
      Object.keys(kinds).forEach(function (k) {
        var label = k === 'accent' ? 'accent' : k === 'case' ? 'capital' : 'punctuation';
        bits.push(kinds[k] + ' ' + label + (kinds[k] > 1 ? 's' : ''));
      });
    }
    return bits.join(' · ');
  }

  return {
    DEFAULTS: DEFAULTS,
    compare: compare,
    summarize: summarize,
    tokenize: tokenize,
    normalizeChars: normalizeChars,
    deaccent: deaccent,
    charDiff: charDiff
  };
});
