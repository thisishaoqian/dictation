/* test-source.js — self-tests for the sentence-file parser.
 * Run with:  node test-source.js
 */
'use strict';

var TextSource = require('./text-source.js');

var pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

function deepEq(name, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + '\n      got      ' + a);
}

function parse(text) { return TextSource.parseItems(text); }
function pairs(text) {
  return parse(text).items.map(function (it) { return it.en ? it.fr + ' >> ' + it.en : it.fr; });
}

// -------------------------------------------------------------- separators

console.log('\nseparators');
deepEq('pipe splits French from English',
  pairs("Il fait beau. | It's nice out."),
  ["Il fait beau. >> It's nice out."]);
deepEq('spaces around the pipe are optional',
  pairs('Il fait beau.|It is nice out.'),
  ['Il fait beau. >> It is nice out.']);
deepEq('a tab works too',
  pairs('Il fait beau.\tIt is nice out.'),
  ['Il fait beau. >> It is nice out.']);
deepEq('a line with no separator is French-only',
  pairs('Le chat dort.'),
  ['Le chat dort.']);
deepEq('an empty English field is treated as absent',
  pairs('Le chat dort. |   '),
  ['Le chat dort.']);
deepEq('extra fields after the English are ignored',
  pairs('Bonjour. | Hello. | greeting'),
  ['Bonjour. >> Hello.']);

// ---------------------------------------------------------------- comments

console.log('\ncomments');
deepEq('a whole-line comment is dropped', pairs('# just a note'), []);
deepEq('an indented comment is dropped', pairs('    # indented note'), []);
deepEq('a trailing comment is stripped from a French-only line',
  pairs('Le chat dort.   # easy one'),
  ['Le chat dort.']);
deepEq('a trailing comment is stripped from a pair',
  pairs('Le chat dort. | The cat sleeps.   # easy one'),
  ['Le chat dort. >> The cat sleeps.']);
deepEq('a comment between the fields kills the English',
  pairs('Le chat dort. # | The cat sleeps.'),
  ['Le chat dort.']);
deepEq('the comment marker needs no leading space',
  pairs('Bonjour.|Hello.#note'),
  ['Bonjour. >> Hello.']);

// ----------------------------------------------------------------- escapes

console.log('\nescapes');
deepEq('an escaped hash is a literal hash',
  pairs('Le mot-dièse \\# est utile. | The hash sign is useful.'),
  ['Le mot-dièse # est utile. >> The hash sign is useful.']);
deepEq('an escaped pipe is a literal pipe',
  pairs('Le symbole \\| existe. | The pipe symbol exists.'),
  ['Le symbole | existe. >> The pipe symbol exists.']);
deepEq('a doubled backslash is one literal backslash',
  pairs('Un antislash \\\\ ici.'),
  ['Un antislash \\ ici.']);
deepEq('a lone backslash is left alone',
  pairs('C:\\dossier va bien.'),
  ['C:\\dossier va bien.']);

// -------------------------------------------------------------- line rules

console.log('\nline rules');
deepEq('blank lines are dropped', pairs('Bonjour.\n\n\nSalut.'), ['Bonjour.', 'Salut.']);
deepEq('surrounding whitespace is trimmed',
  pairs('   Bonjour.   |   Hello.   '),
  ['Bonjour. >> Hello.']);
deepEq('CRLF and CR line endings both work',
  pairs('Bonjour.\r\nSalut.\rCoucou.'),
  ['Bonjour.', 'Salut.', 'Coucou.']);
deepEq('a line with no letters is dropped', pairs('12345\n---\nBonjour.'), ['Bonjour.']);
deepEq('a line with only an English half is dropped', pairs('| Hello there.'), []);

var long = parse('Bonjour.\n' + 'a'.repeat(TextSource.MAX_LINE_LENGTH + 1) + ' fin.');
check('over-long lines are skipped and counted',
  long.items.length === 1 && long.skippedLong === 1,
  JSON.stringify(long));

// ------------------------------------------------------------------ dedupe

console.log('\nduplicates');
deepEq('an exact duplicate is collapsed', pairs('Bonjour.\nBonjour.'), ['Bonjour.']);
deepEq('a case-only duplicate is collapsed', pairs('Bonjour.\nbonjour.'), ['Bonjour.']);
deepEq('a duplicate can fill in a missing translation',
  pairs('Bonjour.\nBonjour. | Hello.'),
  ['Bonjour. >> Hello.']);
deepEq('the first translation wins',
  pairs('Bonjour. | Hello.\nBonjour. | Hi.'),
  ['Bonjour. >> Hello.']);

// ------------------------------------------------------------------ counts

console.log('\ncounts');
var mixed = parse([
  '# a heading',
  "Il fait beau. | It's nice out.",
  'Le chat dort.',
  'Je suis prêt. | I am ready.'
].join('\n'));
check('items counted', mixed.items.length === 3, JSON.stringify(mixed.items));
check('translations counted', mixed.withTranslation === 2, String(mixed.withTranslation));

var noneTranslated = parse('Bonjour.\nSalut.');
check('a file with no translations reports zero', noneTranslated.withTranslation === 0);

// ------------------------------------------------------------------ accents

console.log('\naccents');
deepEq('accents and curly apostrophes survive parsing',
  pairs("L’été s’achève déjà. | Summer is already ending."),
  ["L’été s’achève déjà. >> Summer is already ending."]);

// --------------------------------------------------------------------- end

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
