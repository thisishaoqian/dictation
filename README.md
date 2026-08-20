# La dictée — French Dictation Game

A tiny browser game for practising French dictation with **your own sentences**.
Drop in a `.txt` file, and the game reads a random line aloud in French; you type
what you hear, and it shows you exactly what went wrong — word by word, letter by
letter — along with the correction.

No build step, no dependencies, no server, no database. Your text file is read in
your browser and **never leaves your device**.

## How to play

1. **Load a file** — drag a `.txt` onto the page, or click *Choose a file…*.
   One sentence per line; blank lines and lines starting with `#` are ignored,
   and duplicates are collapsed. `sample.txt` in this repo is there to try it out.
2. Choose how many **rounds** (5, 10, 20, or the whole file) and press
   **Start dictation**. The timer starts.
3. Each round: listen, then type the sentence and press <kbd>Enter</kbd> (or
   **Check**).
   - **▶ Replay** — or <kbd>Space</kbd> when you're not typing — repeats it.
   - **🐢 Slower** repeats it at 70% speed.
   - **Reveal** gives up and shows the answer.
   - <kbd>Shift</kbd>+<kbd>Enter</kbd> inserts a newline instead of submitting.
4. After the last sentence you get a **results screen**: sentences correct,
   overall word accuracy, total and average time, every sentence with its diff,
   plus **Play again** and **Retry my mistakes**.

Your file and your settings are remembered in the browser, so a reload drops you
straight back in.

## How the marking works

Your answer is aligned against the original sentence word by word, so the game
can tell the difference between *"you wrote the wrong word"*, *"you left a word
out"* and *"you added a word"*. Wrong words are then compared letter by letter,
so only the characters that actually differ are highlighted.

Errors come in two strengths:

- **Errors** (red) — a genuinely different, missing or extra word. These fail
  the sentence.
- **Slips** (amber) — the right word with the wrong accent or capital. These are
  reported and highlighted, but the sentence still counts as correct.

Three dials in **⚙ Settings → Marking** control which is which. Each can be
*Ignore*, *Count as slips*, or *Must be exact*:

| Dimension   | Default        | Example                          |
|-------------|----------------|----------------------------------|
| Accents     | Count as slips | `a` for `à`, `ete` for `été`     |
| Capitals    | Ignore         | `paris` for `Paris`              |
| Punctuation | Ignore         | a missing comma, `.` for `!`     |

Straight and curly apostrophes are always treated as the same character, as are
hyphens and dashes, `œ`/`oe`, and any amount of whitespace. Hyphens count as
punctuation, so with the default settings `vingt-deux` and `vingt deux` both pass.

## Your text file

Plain UTF-8 is expected; a file saved by Windows in cp1252 is detected and
re-decoded so the accents survive. Lines over 400 characters are skipped — this
is a sentence dictation game, not a paragraph one. Files up to about 1 MB are
remembered between visits; larger ones work fine but need re-picking each time.

## A note on audio

The game uses your browser's built-in speech synthesis (the Web Speech API).
Audio must be started by a tap or click (a browser rule), which is why there's a
Start button. Long sentences are split into chunks before being spoken, because
some engines truncate long utterances, and a keep-alive nudge works around
Chrome's habit of stopping after ~15 seconds.

If no French voice is installed, the default system voice reads the sentences,
which will sound wrong — you can add a French voice in your OS speech settings.
The correct sentence is always shown after each answer, so the game still works.

Best supported in Chrome, Edge, and Safari.

## Deploy to GitHub Pages

1. Create a new repository on GitHub (e.g. `dictation`).
2. Put these files in the repository root and push:

   ```bash
   git init
   git add .
   git commit -m "French dictation game"
   git branch -M main
   git remote add origin https://github.com/<your-username>/dictation.git
   git push -u origin main
   ```

3. On GitHub, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to *Deploy from a branch*,
   choose branch **main** and folder **/ (root)**, then **Save**.
5. Wait a minute; your game will be live at:

   ```
   https://<your-username>.github.io/dictation/
   ```

That's it — any future `git push` to `main` redeploys automatically. Because the
sentences come from a file the player picks themselves, there is nothing to host
but these static files.

## Files

| File             | Purpose                                                        |
|------------------|----------------------------------------------------------------|
| `index.html`     | Page structure and controls                                    |
| `style.css`      | Styling (dark theme, responsive)                               |
| `app.js`         | Game flow, speech, timing, rendering                           |
| `text-source.js` | Reading and parsing the user's `.txt`, localStorage cache      |
| `diff-fr.js`     | The diff engine: tokenizer, word alignment, character diff     |
| `test-diff.js`   | Node self-tests for the diff engine                            |
| `sample.txt`     | Example sentences                                              |

## Developing / testing the diff logic

```bash
node test-diff.js
```

Covers normalization, the tokenizer (elisions, hyphens), word alignment
(substitutions, missing and extra words, transpositions), character-level
detail, and every combination of the three marking dials.
