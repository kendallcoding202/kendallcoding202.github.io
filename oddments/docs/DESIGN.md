# Oddments — design on one page

*Working title. The name is not decided; five suggestions are in the README.*

**The pitch.** You are house-sitting. The cats sleep all day because they fight the house all night (that is Pawst Lives). You try something else: you talk to it. The odd socks, burnt toast and dust under the bed have woken up restless, and you befriend them and battle alongside them, room by room, before the clearance van comes on Monday. The whole world is one house. Nobody leaves home.

**The loop.** Walk the house map to a room → follow its short path of encounters → each is a three-against-three, turn-based fight → win experience, and bring home any restless Oddment you calmed → rest at home, change your team of three → go further. A room's last encounter is its boss; beating it opens the next room.

**How Oddments join.** Three ways were considered:

1. **Reach out (chosen).** Every restless Oddment is in a *Huff*, shown as pips. Once a round your house-sitter may *Reach out* to one: 2 pips off, 3 if an Oddment it has a soft spot for is standing on your side. Every hit your team lands on it puts a pip back. At no pips it settles, sits the fight out, and comes home if you win.
2. **Keepsakes.** Each kind drops a lost bit of itself (a button, a tuft); return enough and one follows you home.
3. **Errands.** Each kind wants one thing put right in its room (find its pair, clear its shelf).

Reach out wins because it happens inside the fight and costs something real: the house-sitter's one action that round (so no patching up), and turns spent not hitting a thing that is still hitting you. It has no dice, so it never feels like a slot machine; no item to stock, so nothing to sell later; and it makes team-building matter twice (see soft spots). Keepsakes is a grind in a menu. Errands is the richest but needs forty hand-written quests; it is the natural way to win over *bosses* later. One friend per kind: calming a kind you already have sends it off happy and gives your friend of that kind the experience instead. Bosses are too proud to reach.

**Elements.** Six, in one ring. Each beats the next (damage ×1.5) and is beaten by the one before (×0.7):

**Spark** singes **Fluff** · Fluff mops up **Suds** · Suds wash away **Crumb** · Crumb jams **Clank** · Clank mows **Sprout** · Sprout grounds Spark.

One element per Oddment and per move; no double types. An Oddment's *soft spot* is the element it beats: it lets its guard down around things it is not afraid of. So the friend that helps you calm it is the one it hits hardest.

**Stats and moves.** Four stats: **Health**, **Oomph** (hitting), **Grit** (taking hits), **Pep** (who goes first). Each grows 10% of its base per level. Damage = move power × Oomph × (Oomph ÷ Grit) × element × a ±10% wobble. No misses, no critical hits. Each Oddment learns three moves, at levels 1, 3 and 6, of five kinds: *hit* one, *sweep* all, *mend*, *boost* a stat, *sap* a stat. Strong moves need turns to recharge; nothing runs out. Anyone can *Brace* instead. Each round everyone standing acts once, fastest first; a boss acts twice. Once a round the house-sitter makes one *Call*: Reach out, Cheer on (+30% to a friend's next move) or Patch up (heal 20%, every other round).

**Progress through rooms.** The eight rooms of Pawst Lives, in order: The Garden Gate, Tin Can Alley, The Midnight Pantry, The Wash, The Dusty Stacks, Moonlit Rooftops, The Tick-Tock Attic, The Roaring Dark. A room is a path of four encounters and a boss. Health carries from one encounter to the next with a breather between (everyone regains 30%); leaving, losing or winning sends you home, fully rested. Losing costs nothing but the walk: experience and friends are kept. Winning a fight gives every friend on the team full experience and friends at home half. **Later:** at a set level an Oddment *grows up* into a new form (needs new art; the data hook is in place, the rule is not).

**The human cast.** People, not animals; the cats are a cameo, asleep on things.

- **The house-sitter** (you; named by the player). Up all night in pyjamas with a lamp. Patient rather than brave.
- **Great-aunt Maribel**, who owns the house and has always known. On the phone from her trip; teaches Calls.
- **Dov**, the kid next door, who collects bottle caps and swaps news. Met in Tin Can Alley.
- **Ines Tock**, who mends the clocks in the attic and knows how things grow up.
- **Mr. Spick** of Spick & Span Clearances, who is paid to empty the house on Monday and sees only junk. Not a villain so much as a deadline. THE VACUUM is his.

Later, cast members travel with you and each brings a different set of Calls.

**What is saved.** One versioned record on the device, nowhere else: the random seed, the house-sitter's name and look, every friend (kind, level, experience), the team of three, progress in each room, the room visit in progress (path position and team health), which kinds have been seen, a few counters and settings. A fight in progress is not saved; reloading puts you back on the path before it. A save is rebuilt field by field when loaded, so an old, damaged or edited one cannot stop the game from starting.

**Not in the game.** Ads, analytics, accounts, network calls, purchases. Throwing things at monsters to catch them.
