# Interlude

[简体中文](README.md) | **English**

**You write a line of story. The engine handles the rest.**

It takes what you wrote, breaks it apart, builds the scene, hands each character on stage their own private version of it, lets them react **one after another**, and stitches the whole thing back into the story in chronological order.

![Main board](docs/images/01-board.jpg)

---

## How it differs from SillyTavern

Both are self-hosted roleplay frontends. Both use your own API key. Both let you bring whatever model you like. The difference is **who decides what happens next.**

SillyTavern hands you the controls: you write a message, the AI writes one back, and if it feels wrong you rewrite the prompt, tweak the samplers, add a regex. It is a **very good single-character chat machine.**

Interlude is aiming at something else: **you write the story, the engine does the staging.** You drop in a chunk of material; it works out which parts are dialogue, which are action, which are scenery, which were never said out loud; works out who is present; lets a **director** decide who moves first this round and how the world moves; then has the characters react **in order** — whoever speaks later can see what the one before them just said.

| | SillyTavern | Interlude |
|---|---|---|
| **One input** | One message = one generation | One chunk of material = a whole round; every character reacts **in sequence**, and later speakers can hear earlier ones |
| **What you say** | It *is* the message | It gets segmented first; your spoken lines are **locked** and no AI may change a word |
| **Inner thoughts** | Written out, everyone sees them | Never transmitted. Your persona decides what *visible trace* leaks out instead |
| **Information asymmetry** | One shared context for everyone | A **private context** per character, including an explicit "what you definitely do not know" |
| **Side characters** | You build the card yourself | Generated automatically, and **reused** on later appearances so the persona does not drift |
| **Seeing what happened** | You only see the final output | Click any character to see **exactly what it received** this round |
| **Breaking something** | Delete the message and retry | Every step is editable, and **only the affected branch re-runs** |
| **Keeping the plot moving** | Nothing happens until you write | A separate actor — the **director** — decides how the world moves and who moves first |
| **Who directs** | You. Every word you write has to carry the whole scene | You only supply the **beats**; a **director** decides what else happens, who does what, where it goes |
| **Structure** | One chat log | Multiple "conversations" (switchable storylines) plus linear rounds |
| **Settings** | A pile of samplers, presets and regexes | Three switches |

And the biggest difference of all: **in Interlude, the AI cannot rewrite what you said.** In SillyTavern what you type is usually just input for the model. Here it is a script that gets performed — your spoken lines appear on stage verbatim, and the AI can only add actions, micro-expressions, and its own words.

### Three layers: you supply the beats, the director directs

This is where the two feel most different in practice.

In SillyTavern the story advances **one message at a time**: you do not send anything and it stops. You are effectively the writer, the director and the lead at once — tiring, and easy to stall.

Interlude splits that into three layers:

- **You** only supply the **beats** — a line, an action, a thought. But a beat **must be honoured**: it is something that will happen this round, and nothing may quietly drop it. Beyond that, none of it is your problem.
- **The director** (an actor in the engine that is not any character) has **full autonomy**: what else happens this round, who does what, how fast it moves, where the scene is heading. What you did not write is not "something that should not happen" — it is **the director's job to arrange it**. Every round it asks itself one question: **if nobody does anything, what happens next?** Then it moves the world a step: the wolves close in a little more, the fire collapses, the other side's patience runs out.
- **Characters** only perform. The director hands them a blueprint (who, doing what this round) and they play the details according to their own persona — the same event comes out completely different from different people.

And if it still deadlocks — your persona simply is not someone who acts, and every character has their own reason to wait — the director **calls someone out**: it picks whoever most needs to move and tells them what happens this round ("the pack is three steps away and the one standing behind you gets taken first; he moved — the first wolf was in the mud before it finished its leap"). The director reads the whole script and has the same authority as the actors — it just only uses it when things are stuck. The instruction stops at plot: how it happens, what is said, at what pace, is still that character's own performance. **The character you play is never on that list** — what you wrote is what happens, and nobody moves you.

There is also no rule anywhere that says every character must speak every round. When a fight breaks out, their main channel is action, not dialogue.

And **a character's reaction does not have to be aimed at you**. What the situation does — the wolves closing in, the fire collapsing — sits on the **same timeline** as what you wrote, not in the background scenery. So when Wolverine needs to fight, he fights, and he can go a whole round without saying a word to you. He is not going to turn around and start directing you, because what he is responding to is the situation, not you. When it is needed, the director will also **stop him outright**: "do not interact with the user this round."

**And a fight does not hang forever.** Four rounds of "another punch" is not tension, it is a stuck scene — so the director carries a separate **closing** duty: when several rounds in a row have been escalations, it has to land the scene (someone goes down, someone runs, something interrupts, the price gets paid). What is already over does not get dug back up.

**SillyTavern is the better fit if** you want fine control over every generation, you rely on lorebooks and regex, and you like tuning prompts yourself.
**Interlude is the better fit if** you would rather not manage any of that and just want to write a story and watch a group of people move on their own.

---

## Inner thoughts stay private — but they leak

This is the core rule of the whole thing.

You write:

```
I actually.... (I'm hesitating) .... don't really want to go home either....
```

The engine will **not** send "I'm hesitating" to anyone. It reads your persona and decides what that hesitation would leave behind as a **visible trace** — something like:

> stopped mid-sentence, fingers rubbing once against the umbrella handle

That is what the characters get. Not your inner voice. And it comes with two numbers:

- **Readability 35%** — how likely they are to read this as "he's hesitating"
- **Leakage 50%** — how bad *you* are at hiding things, given your persona

Write a persona who is guarded and controls their face, and leakage drops to 10–20%. Write someone who cannot hide anything, and it climbs to 70–80%. If the persona genuinely can keep it in, **nothing has to leak at all.**

![Segments](docs/images/03-segments.jpg)

---

## Click any character to see what they actually received

This is where Interlude parts ways with ordinary roleplay: **no black box.**

Click "what it received" on a character card and you see everything they got this round, in the order it happened:

```
1. You said: "I actually...."
2. You noticed "me": stopped mid-sentence, fingers rubbing once against the umbrella handle
3. You said: ".... don't really want to go home either...."
4. You look at me
5. You said: "Can I .... stay with you a while."
```

**Note that these happen in sequence, not in parallel.** You say something, pause, say something else — and that is the order the character experienced, not a categorised list of "things he said / things he did".

And **it is worded from their own point of view**. You write "I glance up at you"; the person you looked at reads "he glanced up at me", and a third person in the room reads "he glanced up at Lin Yan". The "I" you wrote is never "I" to anybody else — that would make them think they did it. Dialogue is the one exception: what is inside the quotes is your exact wording, unchanged, and only the speaker's label is swapped.

Further down you get their **past**: one block per round, accumulating from round 1, including what they themselves said and did and what they were thinking at the time — plus an explicit list of **what they definitely do not know.**

That past is **append-only and never rewritten**: what goes out in round 5 is what went out in round 4 with one more block appended. Two consequences: the prompt prefix for a given character hits the provider's cache across rounds, and the character does not forget a line they said three rounds ago — which is the thing "just send the last few messages" always gets wrong.

![Context](docs/images/02-context.jpg)

---

## Characters remember previous rounds

When a character comes back on stage, they arrive carrying the previous rounds — what they heard, what they said, what they were thinking. So they can reminisce, hold a grudge, or press you on something. They do not meet you again from scratch.

And that memory is **their own version**, not the omniscient script: things you did behind their back, they do not remember; for rounds they were not present in, the only thing in their past is a line saying "rounds 2–4: you were not here", with no content at all.

Ordering holds inside a round too: anyone who spoke **before** them was heard at the time, and anyone who spoke **after** them becomes something they know by the time they next step on stage.

Character cards are reused across rounds as well. You do not have to worry about them becoming a different person in scene two — the engine reuses the card it built the first time.

---

## A time skip is not a blank

Write "three days later" and those three days are not frozen for everyone else. The engine fills them in:

- **The layer everyone can see**: what became of the place (the teahouse stayed open; the table by the back wall just stayed empty)
- **One line per person**: what they did during those three days and how their state changed. Each character only sees their own line

That fill-in travels with the characters into the next round — when you come back, they are not the people from three days ago, they are people who each lived three days. You can turn it off in settings.

---

## Named characters do not get generic personalities

Write `(I run into Wolverine)` and the engine will:

1. **Decide whether you wrote a performed scene or an outline.** A one-line outline is fine — it will fill in time, place, atmosphere, an opening image, and who else is present (including an extra or two to make the place feel alive).
2. **Look the new character up** (Chinese and English Wikipedia, no key needed, 3-second timeout, skipped if the network is down).
3. If it finds material, it writes the card from that. If it cannot find anything but knows the character, it uses the model's own knowledge — but the prompt explicitly bans filler that would fit a hundred different characters:

```
✗ "powerful, with hidden depths"
✓ "cracks his neck before a fight"
✓ "changes the subject whenever his past comes up"
✓ "grumbles about being asked for help, then does it anyway"
```

Named characters also have to fill in four things: signature traits, sample lines, established canon facts, and **things they would never do**. The last one exists specifically to keep them in character.

---

## Getting it running

```bash
git clone <this repo>
cd interlude
npm install
npm run dev
```

Open http://127.0.0.1:5273/ and fill in your model endpoint under "Settings" in the top right.

Any **OpenAI-compatible** endpoint works: DeepSeek, OpenAI, Kimi, Ollama, and the various proxies.

| Field | Example |
|---|---|
| baseUrl | `https://api.deepseek.com/v1` |
| model | `deepseek-chat` |
| apiKey | `sk-...` |

The key lives only in your own browser's localStorage. It is not sent anywhere else.

**Want to see it first?** No key needed:

```
http://127.0.0.1:5273/?demo=1
```

That is the built-in demo: it uses a scripted set of model responses and **actually runs the whole pipeline in your browser**, so everything you see is a real artefact, not mock data. (Reload to get back to your own data.)

---

## Using it

1. **Write "my own persona" first** (above the input box, collapsed by default). Who you are, what you are like, what state you are in. It feeds segmentation, scene building, and every character's judgement of you.
2. **Write the round in the box at the bottom.** A performed scene or a one-line outline, either is fine:
   - `I said: "You're earlier than I expected."`
   - `(I run into Wolverine)`
3. **Hit send.** The new round is appended and the view scrolls to it.

   If you do not want to do anything this round, hit **"do nothing"** next to it. It still generates a round, but down a different path: the input is recorded as "(I did nothing this round.)" and the director gets a **strong signal** — the world has to move a big step, and at least one character has to be called out to do something substantial. If your persona is someone who never takes the initiative, this is your normal move.
4. **Need to change something?** Two ways:
   - Click **"edit the source"** at the top right of your input block and rewrite the whole thing
   - Hover the round divider and click **"replay from this round"** (same input, run again)

   Both discard everything after that round — the timeline is linear. There is no confirmation dialog, but the top bar has an **undo**.

5. **Want an unrelated new storyline?** Use "＋ new conversation" in the left column. It is genuinely fresh: cast library, memories, and the previous scene are all isolated per conversation. Mention "Lin Yan" in the new story and the engine will not recognise the one from the last one.

---

## Want to go adult? Per round, opt in

There is an **"R18 leaning"** checkbox next to the input box. **It stays checked** (across reloads) — it is visible enough not to be forgotten, while the rating itself lives on each round, so you can turn it on or off for a single round at any time.

When it is on, the engine tells **both the director and the characters** they may move in that direction. The director's remit is wider — it can assign actions with physical distance, testing and suggestion in them, make the setting private, and slow the pace down. But the same three lines are written into its prompt as inviolable:

1. **The personality does not change.** A restrained person is still restrained in that scene — only what they restrain changes. Someone who jokes around still jokes around. Nobody becomes a different person because the scene allows it.
2. **Any advance has to be something *they* would do.** If the relationship is not there yet, it does not jump there — hesitation stays hesitation, testing stays testing.
3. **Do not skip to the end.** The pace comes from the relationship and the moment, not from the rating.

For the director the third line carries extra weight: **the physical boundary belongs to the player, not to the director** — it may decide what other characters do, but never anything on your behalf.

Scene building and the "exteriorisation" step get the same signal: the atmosphere may be more private and charged, and the visible traces may be more direct (breathing, warmth, where a gaze lingers). But **how much leaks is still decided by the persona** — someone who keeps things in still keeps things in; ticking R18 does not put it on their face.

Rounds with R18 on get a red marker on the divider in the main board, so you can see at a glance which ones they were when reading back.

To change a round's rating: click "edit the source", where the same checkbox lives. **Even if the text is untouched and you only flip the checkbox, that counts as a change**, and "save and regenerate" will replay that round under the new rating (later rounds are discarded as usual, undo available).

---

## Three mechanisms worth knowing

**① Your lines are locked.** What you wrote as speech appears on stage verbatim; the AI can only add actions and micro-expressions.

**② Information isolation is a hard constraint.** Every character's context contains a "what you definitely do not know" list, and nobody else's inner thoughts ever enter it. So characters have to read faces, tone and body language — and they are **allowed to get it wrong**.

　**Every character goes through the same "information distribution" layer.** What actually happened this round — dialogue, action, environment, your subtle tells — is numbered item by item, then a **single model call** turns it into each character's own received version: who had their back turned and missed it, who was distracted and only caught half a sentence, who heard a joke as a provocation.

　The default is that everyone receives everything, and the layer **only reports deviations** (what was missed, what it was misheard as, what was noticed beyond the obvious). That keeps the output short, and dialogue text is fetched back by item number, so it is **never paraphrased**.

　Why one combined call instead of one judgement per character: working out "who has their back to whom" **needs a global view** — a per-character call cannot see where the others are standing — and it also saves N−1 calls.

**③ A persona is not just a personality.** Every character also carries three things that genuinely change engine behaviour:

| | What it changes |
|---|---|
| **Abilities** | What they can do. Outside that range, they cannot — a character will not suddenly know how to pick a lock |
| **Perception** | What they can notice. Mind-reading or a superhuman sense of smell changes what information reaches them |
| **Hooks** | What their presence drags in. A trouble-magnet constitution, being hunted, being cursed — the scene will grow such things naturally |

　The last one only activates when it was **actually written down**; it will not force trouble into an ordinary story.

**④ Every step can be rolled back, and only the affected branch re-runs.**

```
normalise → segment → scene → cast → director → distribution
                                                    ↓
                                       A's context → A's reaction
                                             ↓ (A's words go into the next context)
                                       B's context → B's reaction
                                             ↓
                                        compose → memory write-back
```

Edit "B's context" and only what comes after B is recomputed; A is reused as-is. Otherwise you are both paying twice and letting the performance drift.

---

## What is not here yet

- **A real clock**: time advances through what you write ("three days later"); the engine keeps no calendar of its own. What happened during the gap does get filled in, but that is a narrative fill, not a time system.
- **Interruption and talking over each other**: characters react one at a time in the order the director set. There is no genuine simultaneity yet — nobody gets cut off mid-sentence.
- **Per-observer misreading**: cues carry a readability number, but the engine does not yet compute what each individual character read it as.
- **Lorebooks / regex / presets**: SillyTavern has all of these; Interlude does not, and does not intend to copy them wholesale.
- **End-to-end validation against real providers**: development used a scripted set of model responses. Compatibility with the various proxies still needs testing by you.

---

## Going deeper

The design document is [`docs/DESIGN.md`](docs/DESIGN.md) (Chinese) — full data structures, pipeline design, and a change log for every iteration.

If you want to work on it:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest, 187 cases
npm run build       # typecheck + production build
```
