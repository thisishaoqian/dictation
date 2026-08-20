/* app.js — timed French dictation game.
 *
 * Flow: load a .txt -> pick N random lines -> for each, speak it, take the
 * typed answer, diff it, show the correction -> results screen.
 */
(function () {
  'use strict';

  var SETTINGS_KEY = 'dictation:settings';

  // ------------------------------------------------------------------ state

  var state = {
    source: null,       // {name, lines}
    rounds: 10,         // number, or 'all'
    rate: 0.9,
    voiceURI: '',
    marking: { case: 'ignore', accents: 'minor', punct: 'ignore' },

    active: false,
    queue: [],          // sentences for this session
    index: 0,           // 0-based position in queue
    answered: false,
    correct: 0,
    results: [],        // {line, answer, result}
    startTime: 0
  };

  // --------------------------------------------------------------- elements

  function $(id) { return document.getElementById(id); }

  var el = {
    dropzone: $('dropzone'), file: $('file'), filechip: $('filechip'),
    fileName: $('file-name'), fileCount: $('file-count'), changeFile: $('change-file'),
    sourceError: $('source-error'), sourceNote: $('source-note'),

    rounds: $('rounds'),
    round: $('round'), correct: $('correct'), time: $('time'),

    stage: $('stage'), play: $('play'), playLabel: $('play-label'), slow: $('slow'),
    form: $('answer-form'), input: $('answer'), check: $('check'), reveal: $('reveal'),
    feedback: $('feedback'),

    results: $('results'), rCorrect: $('r-correct'), rTotal: $('r-total'),
    rAccuracy: $('r-accuracy'), rTime: $('r-time'), rAvg: $('r-avg'), rList: $('r-list'),
    playagain: $('playagain'), retry: $('retry'),

    rate: $('rate'), rateOut: $('rate-out'), voice: $('voice'), voiceNote: $('voice-note'),
    optAccents: $('opt-accents'), optCase: $('opt-case'), optPunct: $('opt-punct')
  };

  // ---------------------------------------------------------------- settings

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        rounds: state.rounds, rate: state.rate, voiceURI: state.voiceURI, marking: state.marking
      }));
    } catch (e) { /* private mode — fine */ }
  }

  function loadSettings() {
    var data;
    try { data = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { data = null; }
    if (!data) return;
    if (data.rounds) { state.rounds = data.rounds; el.rounds.value = String(data.rounds); }
    if (typeof data.rate === 'number') { state.rate = data.rate; el.rate.value = String(data.rate); }
    if (typeof data.voiceURI === 'string') state.voiceURI = data.voiceURI;
    if (data.marking) {
      state.marking = Object.assign(state.marking, data.marking);
      el.optAccents.value = state.marking.accents;
      el.optCase.value = state.marking.case;
      el.optPunct.value = state.marking.punct;
    }
    el.rateOut.textContent = state.rate + '×';
  }

  // ------------------------------------------------------------------ speech

  var synth = window.speechSynthesis;
  var voices = [];
  var keepAlive = null;

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices().filter(function (v) { return /^fr(-|_|$)/i.test(v.lang); });
    renderVoiceOptions();
    updateVoiceNote();
  }

  function renderVoiceOptions() {
    el.voice.innerHTML = '';
    var auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'Automatic (best match)';
    el.voice.appendChild(auto);
    voices.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.voiceURI;
      o.textContent = v.name + ' (' + v.lang + ')';
      el.voice.appendChild(o);
    });
    el.voice.value = state.voiceURI;
  }

  function pickVoice() {
    if (state.voiceURI) {
      var chosen = voices.filter(function (v) { return v.voiceURI === state.voiceURI; })[0];
      if (chosen) return chosen;
    }
    var exact = voices.filter(function (v) { return v.lang.toLowerCase() === 'fr-fr'; })[0];
    return exact || voices[0] || null;
  }

  function updateVoiceNote() {
    if (!synth) {
      el.voiceNote.textContent = '⚠ This browser has no speech synthesis. The sentence is shown as text instead.';
      return;
    }
    if (!voices.length) {
      el.voiceNote.textContent = '⚠ No French voice found on this device — the default voice will read the sentences, which may sound wrong. On macOS/Windows you can add one in the system speech settings.';
      return;
    }
    var v = pickVoice();
    el.voiceNote.textContent = 'Using voice: ' + (v ? v.name + ' (' + v.lang + ')' : 'default');
  }

  /* Long utterances get truncated by some engines — split on sentence, then
     clause, then hard-wrap. */
  function chunk(text, limit) {
    limit = limit || 180;
    if (text.length <= limit) return [text];
    var parts = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
    var out = [];
    parts.forEach(function (p) {
      if (p.length <= limit) { out.push(p); return; }
      var clauses = p.replace(/([,;:])\s+/g, '$1\u0001').split('\u0001');
      clauses.forEach(function (c) {
        while (c.length > limit) {
          var cut = c.lastIndexOf(' ', limit);
          if (cut <= 0) cut = limit;
          out.push(c.slice(0, cut));
          c = c.slice(cut);
        }
        if (c.trim()) out.push(c);
      });
    });
    return out.filter(function (s) { return s.trim(); });
  }

  function speak(text, rate) {
    if (!synth || !text) return;
    synth.cancel();
    var v = pickVoice();
    var pieces = chunk(text);
    el.play.classList.add('is-speaking');
    pieces.forEach(function (piece, i) {
      var u = new SpeechSynthesisUtterance(piece);
      if (v) u.voice = v;
      u.lang = v ? v.lang : 'fr-FR';
      u.rate = rate;
      if (i === pieces.length - 1) {
        u.onend = stopSpeakingUI;
        u.onerror = stopSpeakingUI;
      }
      synth.speak(u);
    });
    startKeepAlive();
  }

  function stopSpeakingUI() {
    el.play.classList.remove('is-speaking');
    stopKeepAlive();
  }

  /* Chrome stops speaking after ~15s unless nudged. */
  function startKeepAlive() {
    stopKeepAlive();
    keepAlive = setInterval(function () {
      if (!synth) return;
      if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); }
      else if (!synth.speaking) stopKeepAlive();
    }, 9000);
  }
  function stopKeepAlive() { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } }

  function speakCurrent(slow) {
    var line = state.queue[state.index];
    if (!line) return;
    speak(line, slow ? Math.max(0.4, state.rate * 0.7) : state.rate);
  }

  // ------------------------------------------------------------------- clock

  var clockId = null;
  function fmt(ms) {
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function startClock() {
    stopClock();
    clockId = setInterval(function () { el.time.textContent = fmt(Date.now() - state.startTime); }, 250);
  }
  function stopClock() { if (clockId) { clearInterval(clockId); clockId = null; } }

  // ------------------------------------------------------------ file loading

  /* Back to a clean pre-game screen (used when a new file is picked while an
     old results screen is still up). */
  function resetToIdle() {
    state.active = false;
    state.queue = [];
    state.index = 0;
    state.results = [];
    state.correct = 0;
    stopClock();
    if (synth) synth.cancel();
    stopSpeakingUI();
    el.results.hidden = true;
    el.stage.hidden = false;
    el.feedback.className = 'feedback';
    el.feedback.innerHTML = '';
    el.input.value = '';
    el.input.disabled = true;
    el.reveal.disabled = true;
    el.check.textContent = 'Check';
    el.playLabel.textContent = 'Start dictation';
    el.correct.textContent = '0';
    el.time.textContent = '0:00';
    el.rounds.disabled = false;
    el.changeFile.disabled = false;
  }

  function applySource(source) {
    resetToIdle();
    state.source = source;
    el.dropzone.hidden = true;
    el.filechip.hidden = false;
    el.fileName.textContent = source.name;
    el.fileCount.textContent = source.lines.length + (source.lines.length === 1 ? ' sentence' : ' sentences');
    el.sourceError.hidden = true;

    var notes = [];
    if (source.encoding === 'windows-1252') notes.push('Read as Windows-1252 so the accents survived.');
    if (source.skippedLong) notes.push(source.skippedLong + ' very long line(s) skipped (over ' + window.TextSource.MAX_LINE_LENGTH + ' characters).');
    if (source.cached === false) notes.push('Too large to remember between visits — you will need to pick it again next time.');
    if (source.restored) notes.push('Restored from your last visit.');
    el.sourceNote.textContent = notes.join(' ');
    el.sourceNote.hidden = !notes.length;

    el.play.disabled = false;
    el.input.placeholder = 'Press Start, then type what you hear…';
    updateRoundLabel();
  }

  function sourceError(message) {
    el.sourceError.textContent = message;
    el.sourceError.hidden = false;
  }

  function updateRoundLabel() {
    var total = plannedRounds();
    el.round.textContent = (state.active ? (state.index + 1) : '–') + ' / ' + (total || '–');
  }

  function plannedRounds() {
    if (!state.source) return 0;
    if (state.rounds === 'all') return state.source.lines.length;
    return Math.min(parseInt(state.rounds, 10), state.source.lines.length);
  }

  // -------------------------------------------------------------- game flow

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function buildQueue() {
    var lines = state.source.lines;
    var n = plannedRounds();
    return shuffle(lines).slice(0, n);
  }

  function startGame(queue) {
    if (!state.source) return;
    state.queue = queue || buildQueue();
    if (!state.queue.length) { sourceError('That file has no sentences to practise.'); return; }

    state.active = true;
    state.index = 0;
    state.correct = 0;
    state.results = [];
    state.startTime = Date.now();

    el.results.hidden = true;
    el.stage.hidden = false;
    el.retry.hidden = true;
    el.correct.textContent = '0';
    el.time.textContent = '0:00';
    el.playLabel.textContent = 'Replay';
    el.slow.disabled = false;
    el.rounds.disabled = true;
    el.changeFile.disabled = true;
    startClock();
    beginRound();
  }

  function beginRound() {
    state.answered = false;
    updateRoundLabel();
    el.input.value = '';
    el.input.disabled = false;
    el.reveal.disabled = false;
    el.check.textContent = 'Check';
    el.feedback.className = 'feedback';
    el.feedback.innerHTML = '';
    el.input.focus();
    speakCurrent(false);
  }

  function resolveRound(revealed) {
    if (state.answered) return;
    state.answered = true;
    if (synth) synth.cancel();
    stopSpeakingUI();

    var line = state.queue[state.index];
    var answer = el.input.value.trim();
    var result = revealed
      ? window.FrDiff.compare(line, '', state.marking)
      : window.FrDiff.compare(line, answer, state.marking);
    if (revealed) result.correct = false;

    state.results.push({ line: line, answer: answer, result: result, revealed: !!revealed });
    if (result.correct) state.correct++;
    el.correct.textContent = state.correct;

    el.input.disabled = true;
    el.reveal.disabled = true;
    el.check.textContent = (state.index + 1 >= state.queue.length) ? 'See results' : 'Next';
    renderFeedback(line, result, revealed);
    el.check.focus();
  }

  function nextRound() {
    state.index++;
    if (state.index >= state.queue.length) { endGame(); return; }
    beginRound();
  }

  function endGame() {
    state.active = false;
    state.answered = true;
    stopClock();
    if (synth) synth.cancel();
    stopSpeakingUI();

    var totalMs = Date.now() - state.startTime;
    var n = state.results.length;
    var accuracy = n
      ? state.results.reduce(function (s, r) { return s + r.result.wordAccuracy; }, 0) / n
      : 0;

    el.rCorrect.textContent = state.correct;
    el.rTotal.textContent = n;
    el.rAccuracy.textContent = Math.round(accuracy * 100) + '%';
    el.rTime.textContent = fmt(totalMs);
    el.rAvg.textContent = (totalMs / Math.max(n, 1) / 1000).toFixed(1) + 's';
    el.time.textContent = fmt(totalMs);

    el.rList.innerHTML = '';
    state.results.forEach(function (r, i) {
      el.rList.appendChild(resultItem(r, i + 1));
    });

    var missed = state.results.filter(function (r) { return !r.result.correct; });
    el.retry.hidden = missed.length === 0;

    el.stage.hidden = true;
    el.results.hidden = false;
    el.rounds.disabled = false;
    el.changeFile.disabled = false;
    el.playLabel.textContent = 'Start dictation';
  }

  // --------------------------------------------------------------- rendering

  /* Should this token be glued to whatever came before it? */
  var NO_SPACE_BEFORE = /^[,.;:!?…)\]}»%"']$/;
  function endsOpen(text) { return /['’(\[{«]$/.test(text); }

  function tokenSpan(text, cls, title) {
    var s = document.createElement('span');
    s.className = 'tok ' + cls;
    s.textContent = text;
    if (title) s.title = title;
    return s;
  }

  function charSpans(runs, cls) {
    var frag = document.createDocumentFragment();
    runs.forEach(function (run) {
      if (run.same) {
        frag.appendChild(document.createTextNode(run.text));
      } else {
        var b = document.createElement('mark');
        b.className = cls;
        b.textContent = run.text;
        frag.appendChild(b);
      }
    });
    return frag;
  }

  /* The user's answer, annotated op by op. */
  function renderDiffLine(result) {
    var wrap = document.createElement('p');
    wrap.className = 'diffline';
    var prev = '';

    result.ops.forEach(function (op) {
      var shown = op.got || op.expected || '';
      var needsSpace = wrap.childNodes.length &&
        !NO_SPACE_BEFORE.test(shown) && !endsOpen(prev);
      if (needsSpace) wrap.appendChild(document.createTextNode(' '));

      var node;
      if (op.op === 'match' || op.severity === 'ignored') {
        node = tokenSpan(shown, 'tok--ok');
      } else if (op.op === 'sub') {
        node = document.createElement('span');
        node.className = 'tok ' + (op.severity === 'minor' ? 'tok--minor' : 'tok--wrong');
        var got = document.createElement('span');
        got.className = 'tok__got';
        got.appendChild(charSpans(op.charDiff.got, 'bad'));
        node.appendChild(got);
        var fix = document.createElement('span');
        fix.className = 'tok__fix';
        fix.appendChild(charSpans(op.charDiff.expected, 'good'));
        node.appendChild(fix);
        node.title = op.reasons.indexOf('accent') > -1 ? 'Accent' :
          op.reasons.indexOf('case') > -1 ? 'Capital letter' : 'Wrong word';
      } else if (op.op === 'missing') {
        node = tokenSpan(op.expected, 'tok--missing', 'You left this out');
      } else {
        node = tokenSpan(op.got, 'tok--extra', 'Not in the sentence');
      }
      wrap.appendChild(node);
      prev = shown;
    });

    if (!result.ops.length) {
      wrap.appendChild(document.createElement('em')).textContent = '(nothing typed)';
    }
    return wrap;
  }

  function renderFeedback(line, result, revealed) {
    el.feedback.innerHTML = '';
    el.feedback.className = 'feedback ' + (result.correct ? 'is-ok' : 'is-err');

    var head = document.createElement('p');
    head.className = 'feedback__head';
    var summary = window.FrDiff.summarize(result);
    if (revealed) head.textContent = '👀 Revealed';
    else if (result.perfect) head.textContent = '✓ Perfect!';
    else if (result.correct) head.textContent = '✓ Correct — ' + summary;
    else head.textContent = '✗ ' + (summary || 'Not quite');
    el.feedback.appendChild(head);

    if (!revealed && !result.perfect) {
      var yours = document.createElement('div');
      yours.className = 'block';
      yours.appendChild(label('You typed'));
      yours.appendChild(renderDiffLine(result));
      el.feedback.appendChild(yours);
    }

    var truth = document.createElement('div');
    truth.className = 'block';
    truth.appendChild(label('Correct'));
    var p = document.createElement('p');
    p.className = 'diffline diffline--truth';
    p.textContent = line;
    truth.appendChild(p);
    el.feedback.appendChild(truth);

    if (!result.perfect) el.feedback.appendChild(legend());
  }

  function label(text) {
    var s = document.createElement('span');
    s.className = 'block__label';
    s.textContent = text;
    return s;
  }

  function legend() {
    var p = document.createElement('p');
    p.className = 'legend';
    p.innerHTML =
      '<span class="tok tok--wrong legend__x">wrong</span>' +
      '<span class="tok tok--minor legend__x">slip</span>' +
      '<span class="tok tok--missing legend__x">missing</span>' +
      '<span class="tok tok--extra legend__x">extra</span>';
    return p;
  }

  function resultItem(r, n) {
    var li = document.createElement('li');
    li.className = r.result.correct ? 'ok' : 'err';

    var head = document.createElement('div');
    head.className = 'r-head';
    head.innerHTML = '<span class="r-mark">' + (r.result.correct ? '✓' : '✗') + '</span>' +
      '<span class="r-n">' + n + '</span>';
    var sentence = document.createElement('span');
    sentence.className = 'r-line';
    sentence.textContent = r.line;
    head.appendChild(sentence);
    li.appendChild(head);

    if (!r.result.correct) {
      var d = renderDiffLine(r.result);
      d.classList.add('diffline--compact');
      li.appendChild(d);
      var s = window.FrDiff.summarize(r.result);
      if (s) {
        var sum = document.createElement('p');
        sum.className = 'r-summary';
        sum.textContent = s;
        li.appendChild(sum);
      }
    }
    return li;
  }

  // ------------------------------------------------------------------ events

  window.TextSource.attach({
    input: el.file,
    dropZone: el.dropzone,
    onLoad: applySource,
    onError: sourceError
  });

  el.changeFile.addEventListener('click', function () {
    if (state.active) return;
    resetToIdle();
    el.filechip.hidden = true;
    el.dropzone.hidden = false;
    el.sourceNote.hidden = true;
    window.TextSource.forget();
    state.source = null;
    el.play.disabled = true;
    el.slow.disabled = true;
    el.input.disabled = true;
    el.input.placeholder = 'Load a text file to begin…';
    updateRoundLabel();
  });

  el.play.addEventListener('click', function () {
    if (!state.active) { startGame(); return; }
    speakCurrent(false);
  });

  el.slow.addEventListener('click', function () {
    if (state.active && !state.answered) speakCurrent(true);
  });

  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!state.active) { startGame(); return; }
    if (state.answered) { nextRound(); return; }
    resolveRound(false);
  });

  el.reveal.addEventListener('click', function () {
    if (!state.active || state.answered) return;
    resolveRound(true);
  });

  el.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.code === 'Space' && document.activeElement !== el.input && state.active && !state.answered) {
      e.preventDefault();
      speakCurrent(false);
    }
  });

  el.playagain.addEventListener('click', function () { startGame(); });

  el.retry.addEventListener('click', function () {
    var missed = state.results.filter(function (r) { return !r.result.correct; })
      .map(function (r) { return r.line; });
    startGame(shuffle(missed));
  });

  el.rounds.addEventListener('change', function () {
    state.rounds = el.rounds.value === 'all' ? 'all' : parseInt(el.rounds.value, 10);
    saveSettings();
    updateRoundLabel();
  });

  el.rate.addEventListener('input', function () {
    state.rate = parseFloat(el.rate.value);
    el.rateOut.textContent = (Math.round(state.rate * 100) / 100) + '×';
    saveSettings();
  });

  el.voice.addEventListener('change', function () {
    state.voiceURI = el.voice.value;
    updateVoiceNote();
    saveSettings();
  });

  [['optAccents', 'accents'], ['optCase', 'case'], ['optPunct', 'punct']].forEach(function (pair) {
    el[pair[0]].addEventListener('change', function () {
      state.marking[pair[1]] = el[pair[0]].value;
      saveSettings();
    });
  });

  // -------------------------------------------------------------------- init

  loadSettings();
  if (synth) {
    loadVoices();
    synth.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 300);
  } else {
    updateVoiceNote();
  }

  var saved = window.TextSource.restore();
  if (saved) applySource(saved);
  updateRoundLabel();
})();
