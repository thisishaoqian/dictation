/* test-diff.js — self-tests for the dictation diff engine.
 * Run with:  node test-diff.js
 */
'use strict';

var FrDiff = require('./diff-fr.js');

var pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

function eq(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function deepEq(name, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + '\n      got      ' + a);
}

/* Compact view of the ops for readable assertions. */
function shape(res) {
  return res.ops.map(function (o) {
    if (o.op === 'match') return 'ok:' + o.expected;
    if (o.op === 'sub') return (o.severity === 'ignored' ? 'ign' : o.severity) + ':' + o.expected + '>' + o.got;
    if (o.op === 'missing') return (o.severity === 'ignored' ? 'ign' : 'miss') + ':' + o.expected;
    return (o.severity === 'ignored' ? 'ign' : 'extra') + ':' + o.got;
  });
}

// ---------------------------------------------------------------- normalizing

console.log('\nnormalization');
eq('curly apostrophe folds to straight',
  FrDiff.normalizeChars('L’école'), "L'école");
eq('non-breaking space folds to a space',
  FrDiff.normalizeChars('Bonjour !'), 'Bonjour !');
eq('deaccent strips diacritics', FrDiff.deaccent('Ça été où ?'), 'Ca ete ou ?');
eq('deaccent unpacks the oe ligature', FrDiff.deaccent('un œuf'), 'un oeuf');
eq('NFD input is treated as NFC', FrDiff.normalizeChars('école'), 'école');

// ------------------------------------------------------------------ tokenizer

console.log('\ntokenizer');
deepEq('splits elisions after the apostrophe',
  FrDiff.tokenize("L'école, c'est fini !").map(function (t) { return t.text; }),
  ["L'", 'école', ',', "c'", 'est', 'fini', '!']);
deepEq("aujourd'hui splits the same way",
  FrDiff.tokenize("aujourd'hui").map(function (t) { return t.text; }),
  ["aujourd'", 'hui']);
deepEq('hyphens come out as punctuation',
  FrDiff.tokenize('est-ce que').map(function (t) { return t.text; }),
  ['est', '-', 'ce', 'que']);

// -------------------------------------------------------------------- grading

console.log('\ngrading — defaults (case ignored, accents minor, punctuation ignored)');

var r;

r = FrDiff.compare('Je vais à la plage.', 'Je vais à la plage.');
check('identical line is perfect', r.perfect && r.correct);
eq('identical line scores 100%', r.wordAccuracy, 1);

r = FrDiff.compare('Je vais à la plage.', 'je vais à la plage');
check('capitals and final period are ignored by default', r.perfect, JSON.stringify(shape(r)));

r = FrDiff.compare('Je vais à la plage.', 'Je vais a la plage.');
check('a missing accent is a minor slip, not a failure', r.correct && !r.perfect);
eq('...and is counted once', r.counts.minor, 1);
deepEq('...and is reported as an accent', r.ops.filter(function (o) { return o.severity === 'minor'; })[0].reasons, ['accent']);
eq('...with the summary naming it', FrDiff.summarize(r), '1 accent');

r = FrDiff.compare('Le chat dort sur le lit.', 'Le chien dort sur le lit.');
check('a different word fails the line', !r.correct);
eq('...counted as one wrong word', r.counts.wrong, 1);
deepEq('...aligned as a substitution', shape(r).slice(0, 3), ['ok:Le', 'major:chat>chien', 'ok:dort']);

r = FrDiff.compare('Le chat noir dort.', 'Le chat dort.');
eq('a dropped word is reported as missing', r.counts.missing, 1);
deepEq('...in the right position', shape(r).slice(0, 4), ['ok:Le', 'ok:chat', 'miss:noir', 'ok:dort']);

r = FrDiff.compare('Le chat dort.', 'Le petit chat dort.');
eq('an invented word is reported as extra', r.counts.extra, 1);
deepEq('...in the right position', shape(r).slice(0, 4), ['ok:Le', 'extra:petit', 'ok:chat', 'ok:dort']);

r = FrDiff.compare("J'ai mangé une pomme.", "J'ai mangé une pomme");
check('a missing final period alone stays perfect', r.perfect, JSON.stringify(shape(r)));

r = FrDiff.compare("L'homme est parti.", 'Le homme est parti.');
check('a botched elision fails the line', !r.correct, JSON.stringify(shape(r)));

r = FrDiff.compare('Il est très content.', 'Il est tres contant.');
check('accent slip + wrong word: fails, and both are reported', !r.correct);
eq('...one wrong word', r.counts.wrong, 1);
eq('...one accent slip', r.counts.minor, 1);

r = FrDiff.compare('Nous partons demain matin.', 'Nous partons matin demain.');
check('transposed words are caught', !r.correct, JSON.stringify(shape(r)));

r = FrDiff.compare('Le petit chat noir dort sur le canapé.', 'Le petit chien noir dor sur le canape.');
check('mixed sentence fails', !r.correct);
eq('...one wrong word (chat/chien)', r.counts.wrong, 2, JSON.stringify(shape(r)));

// ---------------------------------------------------------------- char detail

console.log('\ncharacter detail');
r = FrDiff.compare('la fenêtre', 'la fenetre');
var sub = r.ops.filter(function (o) { return o.op === 'sub'; })[0];
check('the substitution carries a character diff', !!sub.charDiff);
deepEq('...highlighting only the wrong letter',
  sub.charDiff.got.map(function (x) { return x.text + (x.same ? '' : '!'); }),
  ['fen', 'e!', 'tre']);

// ---------------------------------------------------------------- strictness

console.log('\nstrict options');
r = FrDiff.compare('Je vais à la plage.', 'Je vais a la plage.', { accents: 'strict' });
check('accents:strict turns an accent slip into a failure', !r.correct);

r = FrDiff.compare('Paris est belle.', 'paris est belle.', { case: 'strict' });
check('case:strict fails a lowercased proper noun', !r.correct);

r = FrDiff.compare('Paris est belle.', 'paris est belle.', { case: 'minor' });
check('case:minor reports it without failing', r.correct && !r.perfect);

r = FrDiff.compare('Viens ici, tout de suite !', 'Viens ici tout de suite.', { punct: 'strict' });
check('punct:strict fails on missing comma / wrong end mark', !r.correct, JSON.stringify(shape(r)));

r = FrDiff.compare('Viens ici, tout de suite !', 'Viens ici tout de suite.');
check('...but the default ignores both', r.perfect, JSON.stringify(shape(r)));

// ------------------------------------------------------------------- oddities

console.log('\nedge cases');
r = FrDiff.compare('Bonjour.', '');
check('an empty answer fails', !r.correct);
eq('...with the word marked missing', r.counts.missing, 1);
eq('...and 0% accuracy', r.wordAccuracy, 0);

r = FrDiff.compare('', '');
check('two empty strings are perfect', r.perfect);

r = FrDiff.compare('Il a mangé.', "  Il   a   mangé.  ");
check('extra whitespace is irrelevant', r.perfect);

r = FrDiff.compare("C'est l'été.", "C’est l’été.");
check('curly vs straight apostrophes match', r.perfect, JSON.stringify(shape(r)));

r = FrDiff.compare('Elle a vingt-deux ans.', 'Elle a vingt deux ans.');
check('hyphen vs space is ignored by default', r.perfect, JSON.stringify(shape(r)));

// ----------------------------------------------------------------------- done

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
