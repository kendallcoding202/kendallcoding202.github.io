/* ============================================================
   Spire of Trials — a Slay the Spire style deckbuilder
   Pure vanilla JS, no dependencies. All state lives in `G`.
   ============================================================ */

(function () {
    "use strict";

    /* ---------- tiny helpers ---------- */
    const $ = (sel) => document.querySelector(sel);
    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const rnd = (n) => Math.floor(Math.random() * n);
    const pick = (arr) => arr[rnd(arr.length)];
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    function shuffle(a) {
        for (let i = a.length - 1; i > 0; i--) {
            const j = rnd(i + 1);
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    let _uid = 1;
    const uid = () => _uid++;

    /* ============================================================
       CARD DEFINITIONS
       type: attack | skill | power
       effect(ctx) where ctx = {target, enemies} — see playCard
       Upgraded versions are computed via the `.upg` overrides.
       ============================================================ */
    const CARDS = {
        /* ---- Starter / common ---- */
        strike: {
            name: "Strike", type: "attack", cost: 1, art: "🗡️", rarity: "starter",
            desc: (c) => `Deal <b>${dmgVal(6, c)}</b> damage.`,
            upg: { dmg: 9 },
            play: (c, ctx) => dealDamage(ctx.target, val(c, "dmg", 6)),
        },
        defend: {
            name: "Defend", type: "skill", cost: 1, art: "🛡️", rarity: "starter",
            desc: (c) => `Gain <b>${blkVal(5, c)}</b> Block.`,
            upg: { blk: 8 },
            play: (c) => gainBlock(G.player, val(c, "blk", 5)),
        },
        bash: {
            name: "Bash", type: "attack", cost: 2, art: "🔨", rarity: "starter",
            desc: (c) => `Deal <b>${dmgVal(8, c)}</b> damage. Apply <b>${val(c, "vuln", 2)}</b> Vulnerable.`,
            upg: { dmg: 10, vuln: 3 },
            play: (c, ctx) => {
                dealDamage(ctx.target, val(c, "dmg", 8));
                applyStatus(ctx.target, "vuln", val(c, "vuln", 2));
            },
        },
        /* ---- Common attacks ---- */
        cleave: {
            name: "Cleave", type: "attack", cost: 1, art: "🪓", rarity: "common",
            desc: (c) => `Deal <b>${dmgVal(8, c)}</b> damage to <b>ALL</b> enemies.`,
            upg: { dmg: 11 },
            play: (c, ctx) => ctx.enemies.slice().forEach((e) => dealDamage(e, val(c, "dmg", 8))),
        },
        ironWave: {
            name: "Iron Wave", type: "attack", cost: 1, art: "🌊", rarity: "common",
            desc: (c) => `Gain <b>${blkVal(5, c)}</b> Block. Deal <b>${dmgVal(5, c)}</b> damage.`,
            upg: { dmg: 7, blk: 7 },
            play: (c, ctx) => {
                gainBlock(G.player, val(c, "blk", 5));
                dealDamage(ctx.target, val(c, "dmg", 5));
            },
        },
        twinStrike: {
            name: "Twin Strike", type: "attack", cost: 1, art: "⚔️", rarity: "common",
            desc: (c) => `Deal <b>${dmgVal(5, c)}</b> damage <b>twice</b>.`,
            upg: { dmg: 7 },
            play: (c, ctx) => {
                dealDamage(ctx.target, val(c, "dmg", 5));
                if (ctx.target.hp > 0) dealDamage(ctx.target, val(c, "dmg", 5));
            },
        },
        pommelStrike: {
            name: "Pommel Strike", type: "attack", cost: 1, art: "🤺", rarity: "common",
            desc: (c) => `Deal <b>${dmgVal(9, c)}</b> damage. Draw <b>${val(c, "draw", 1)}</b> card.`,
            upg: { dmg: 10, draw: 2 },
            play: (c, ctx) => {
                dealDamage(ctx.target, val(c, "dmg", 9));
                drawCards(val(c, "draw", 1));
            },
        },
        anger: {
            name: "Anger", type: "attack", cost: 0, art: "😡", rarity: "common",
            desc: (c) => `Deal <b>${dmgVal(6, c)}</b> damage. Add a copy of Anger to your discard pile.`,
            upg: { dmg: 8 },
            play: (c, ctx) => {
                dealDamage(ctx.target, val(c, "dmg", 6));
                G.discard.push(makeCard("anger", c.upgraded));
            },
        },
        clothesline: {
            name: "Clothesline", type: "attack", cost: 2, art: "💪", rarity: "common",
            desc: (c) => `Deal <b>${dmgVal(12, c)}</b> damage. Apply <b>${val(c, "weak", 2)}</b> Weak.`,
            upg: { dmg: 14, weak: 3 },
            play: (c, ctx) => {
                dealDamage(ctx.target, val(c, "dmg", 12));
                applyStatus(ctx.target, "weak", val(c, "weak", 2));
            },
        },
        /* ---- Common skills ---- */
        shrugItOff: {
            name: "Shrug It Off", type: "skill", cost: 1, art: "😌", rarity: "common",
            desc: (c) => `Gain <b>${blkVal(8, c)}</b> Block. Draw <b>1</b> card.`,
            upg: { blk: 11 },
            play: (c) => {
                gainBlock(G.player, val(c, "blk", 8));
                drawCards(1);
            },
        },
        trueGrit: {
            name: "True Grit", type: "skill", cost: 1, art: "🧱", rarity: "common",
            desc: (c) => `Gain <b>${blkVal(7, c)}</b> Block. Exhaust a random card in your hand.`,
            upg: { blk: 9 },
            play: (c) => {
                gainBlock(G.player, val(c, "blk", 7));
                if (G.hand.length) {
                    const idx = rnd(G.hand.length);
                    exhaustCard(G.hand[idx]);
                }
            },
        },
        warcry: {
            name: "Warcry", type: "skill", cost: 0, art: "📣", rarity: "common",
            desc: () => `Draw <b>1</b> card. Exhaust this card.`,
            upg: { draw: 2 },
            exhaust: true,
            play: (c) => drawCards(val(c, "draw", 1)),
        },
        /* ---- Uncommon ---- */
        heavyBlade: {
            name: "Heavy Blade", type: "attack", cost: 2, art: "🗡️", rarity: "uncommon",
            desc: (c) => `Deal <b>${dmgVal(14, c)}</b> damage. Strength affects this card <b>${val(c, "mult", 3)}×</b>.`,
            upg: { mult: 5 },
            play: (c, ctx) => {
                const bonus = (G.player.status.strength || 0) * (val(c, "mult", 3) - 1);
                dealDamage(ctx.target, val(c, "dmg", 14) + bonus);
            },
        },
        bodySlam: {
            name: "Body Slam", type: "attack", cost: 1, art: "🧍", rarity: "uncommon",
            desc: () => `Deal damage equal to your current <b>Block</b>.`,
            upg: { cost: 0 },
            play: (c, ctx) => dealDamage(ctx.target, G.player.block),
        },
        pummel: {
            name: "Pummel", type: "attack", cost: 1, art: "👊", rarity: "uncommon",
            desc: (c) => `Deal <b>${dmgVal(2, c)}</b> damage <b>${val(c, "hits", 4)}</b> times. Exhaust.`,
            upg: { hits: 5 },
            exhaust: true,
            play: (c, ctx) => {
                const n = val(c, "hits", 4);
                for (let i = 0; i < n; i++) if (ctx.target.hp > 0) dealDamage(ctx.target, 2);
            },
        },
        uppercut: {
            name: "Uppercut", type: "attack", cost: 2, art: "🥊", rarity: "uncommon",
            desc: (c) => `Deal <b>${dmgVal(13, c)}</b> damage. Apply <b>1</b> Weak and <b>1</b> Vulnerable.`,
            upg: { vuln: 2, weak: 2 },
            play: (c, ctx) => {
                dealDamage(ctx.target, val(c, "dmg", 13));
                applyStatus(ctx.target, "weak", val(c, "weak", 1));
                applyStatus(ctx.target, "vuln", val(c, "vuln", 1));
            },
        },
        secondWind: {
            name: "Second Wind", type: "skill", cost: 1, art: "🌬️", rarity: "uncommon",
            desc: (c) => `Exhaust all non-Attack cards in your hand. Gain <b>${val(c, "blk", 5)}</b> Block per card exhausted.`,
            upg: { blk: 7 },
            play: (c) => {
                const toEx = G.hand.filter((h) => h.def.type !== "attack" && h !== c);
                toEx.forEach((h) => {
                    exhaustCard(h);
                    gainBlock(G.player, val(c, "blk", 5));
                });
            },
        },
        bloodletting: {
            name: "Bloodletting", type: "skill", cost: 0, art: "🩸", rarity: "uncommon",
            desc: (c) => `Lose <b>3</b> HP. Gain <b>${val(c, "energy", 2)}</b> Energy.`,
            upg: { energy: 3 },
            play: (c) => {
                loseHP(G.player, 3);
                G.energy += val(c, "energy", 2);
                renderCombat();
            },
        },
        inflame: {
            name: "Inflame", type: "power", cost: 1, art: "🔥", rarity: "uncommon",
            desc: (c) => `Gain <b>${val(c, "str", 2)}</b> Strength.`,
            upg: { str: 3 },
            play: (c) => applyStatus(G.player, "strength", val(c, "str", 2)),
        },
        metallicize: {
            name: "Metallicize", type: "power", cost: 1, art: "⚙️", rarity: "uncommon",
            desc: (c) => `At the end of your turn, gain <b>${val(c, "metal", 3)}</b> Block.`,
            upg: { metal: 4 },
            play: (c) => applyStatus(G.player, "metal", val(c, "metal", 3)),
        },
        /* ---- Rare ---- */
        bludgeon: {
            name: "Bludgeon", type: "attack", cost: 3, art: "💥", rarity: "rare",
            desc: (c) => `Deal <b>${dmgVal(32, c)}</b> damage.`,
            upg: { dmg: 42 },
            play: (c, ctx) => dealDamage(ctx.target, val(c, "dmg", 32)),
        },
        offering: {
            name: "Offering", type: "skill", cost: 0, art: "🕯️", rarity: "rare",
            desc: (c) => `Lose <b>6</b> HP. Gain <b>2</b> Energy. Draw <b>${val(c, "draw", 3)}</b> cards. Exhaust.`,
            upg: { draw: 5 },
            exhaust: true,
            play: (c) => {
                loseHP(G.player, 6);
                G.energy += 2;
                drawCards(val(c, "draw", 3));
                renderCombat();
            },
        },
        demonForm: {
            name: "Demon Form", type: "power", cost: 3, art: "😈", rarity: "rare",
            desc: (c) => `At the start of each turn, gain <b>${val(c, "str", 2)}</b> Strength.`,
            upg: { str: 3 },
            play: (c) => applyStatus(G.player, "demon", val(c, "str", 2)),
        },
        impervious: {
            name: "Impervious", type: "skill", cost: 2, art: "🏰", rarity: "rare",
            desc: (c) => `Gain <b>${blkVal(30, c)}</b> Block. Exhaust.`,
            upg: { blk: 40 },
            exhaust: true,
            play: (c) => gainBlock(G.player, val(c, "blk", 30)),
        },
        limitBreak: {
            name: "Limit Break", type: "skill", cost: 1, art: "📈", rarity: "rare",
            desc: () => `Double your Strength. Exhaust.`,
            upg: { keep: true },
            play: (c) => {
                const s = G.player.status.strength || 0;
                if (s > 0) applyStatus(G.player, "strength", s);
            },
        },
    };

    // Card pools by rarity for rewards
    const POOL = {
        common: ["cleave", "ironWave", "twinStrike", "pommelStrike", "anger", "clothesline", "shrugItOff", "trueGrit", "warcry"],
        uncommon: ["heavyBlade", "bodySlam", "pummel", "uppercut", "secondWind", "bloodletting", "inflame", "metallicize"],
        rare: ["bludgeon", "offering", "demonForm", "impervious", "limitBreak"],
    };

    /* ============================================================
       RELICS — passive effects hooked at various events
       ============================================================ */
    const RELICS = {
        burningBlood: { name: "Burning Blood", art: "🩸", desc: "At the end of combat, heal 6 HP.", onCombatEnd: () => healPlayer(6) },
        vajra: { name: "Vajra", art: "🔱", desc: "At the start of each combat, gain 1 Strength.", onCombatStart: () => applyStatus(G.player, "strength", 1) },
        anchor: { name: "Anchor", art: "⚓", desc: "At the start of each combat, gain 10 Block.", onCombatStart: () => gainBlock(G.player, 10) },
        bagOfPrep: { name: "Bag of Preparation", art: "🎒", desc: "At the start of each combat, draw 2 extra cards.", onFirstTurn: () => drawCards(2) },
        oddBerry: { name: "Strawberry", art: "🍓", desc: "Raise your Max HP by 7.", onPickup: () => { G.player.maxHp += 7; healPlayer(7); } },
        bronzeScales: { name: "Bronze Scales", art: "🐉", desc: "Whenever you take unblocked attack damage, deal 3 back.", thorns: 3 },
        pantograph: { name: "Pantograph", art: "📐", desc: "At the start of Elite & Boss fights, heal 25 HP.", onCombatStart: (kind) => { if (kind === "elite" || kind === "boss") healPlayer(25); } },
        energyCore: { name: "Energy Core", art: "🔋", desc: "Gain 1 additional Energy at the start of each turn.", energy: 1 },
        lantern: { name: "Lantern", art: "🏮", desc: "Gain 1 Energy on the first turn of each combat.", onFirstTurn: () => { G.energy += 1; } },
    };
    const RELIC_POOL = ["vajra", "anchor", "bagOfPrep", "oddBerry", "bronzeScales", "pantograph", "energyCore", "lantern"];

    /* ============================================================
       CHARACTERS
       ============================================================ */
    const CHARACTERS = {
        warrior: {
            name: "The Warrior", emoji: "⚔️", sprite: "🧝‍♂️",
            desc: "80 HP. A balanced brawler. Starts with Bash for early aggression.",
            maxHp: 80, relic: "burningBlood",
            deck: ["strike", "strike", "strike", "strike", "strike", "defend", "defend", "defend", "defend", "bash"],
        },
        knight: {
            name: "The Knight", emoji: "🛡️", sprite: "🤴",
            desc: "84 HP. Sturdy and defensive. Starts with extra Defends and Bronze Scales.",
            maxHp: 84, relic: "bronzeScales",
            deck: ["strike", "strike", "strike", "strike", "defend", "defend", "defend", "defend", "defend", "ironWave"],
        },
        berserker: {
            name: "The Berserker", emoji: "🔥", sprite: "🧟",
            desc: "68 HP. Glass cannon. Lower HP but starts with Vajra (+1 Strength each fight).",
            maxHp: 68, relic: "vajra",
            deck: ["strike", "strike", "strike", "strike", "strike", "defend", "defend", "defend", "anger", "twinStrike"],
        },
    };

    /* ============================================================
       ENEMIES  — moves define the intent each turn
       move.type: attack | block | buff | debuff | attackBlock | attackDebuff
       ============================================================ */
    const ENEMIES = {
        jawWorm: {
            name: "Jaw Worm", sprite: "🐛", hp: [42, 46],
            moves: [
                { name: "Chomp", type: "attack", dmg: 11 },
                { name: "Thrash", type: "attackBlock", dmg: 7, block: 5 },
                { name: "Bellow", type: "buff", strength: 3, block: 6 },
            ],
            ai: (self, turn) => {
                if (turn === 0) return 0; // chomp first
                return pick([1, 1, 2]);
            },
        },
        cultist: {
            name: "Cultist", sprite: "🧙", hp: [45, 50],
            moves: [
                { name: "Incantation", type: "buff", ritual: 3 },
                { name: "Dark Strike", type: "attack", dmg: 6 },
            ],
            ai: (self, turn) => (turn === 0 ? 0 : 1),
        },
        redLouse: {
            name: "Red Louse", sprite: "🐞", hp: [10, 15],
            moves: [
                { name: "Bite", type: "attack", dmg: 6 },
                { name: "Grow", type: "buff", strength: 3 },
            ],
            ai: (self, turn) => pick([0, 0, 1]),
        },
        greenSlime: {
            name: "Acid Slime", sprite: "🟢", hp: [28, 32],
            moves: [
                { name: "Corrosive Spit", type: "attackDebuff", dmg: 7, weak: 1 },
                { name: "Lick", type: "debuff", weak: 1 },
                { name: "Tackle", type: "attack", dmg: 10 },
            ],
            ai: (self, turn) => pick([0, 2, 2, 1]),
        },
        fungiBeast: {
            name: "Fungi Beast", sprite: "🍄", hp: [22, 28],
            moves: [
                { name: "Bite", type: "attack", dmg: 6 },
                { name: "Grow", type: "buff", strength: 4 },
            ],
            ai: (self, turn) => pick([0, 0, 1]),
        },
        // Elites
        gremlinNob: {
            name: "Gremlin Nob", sprite: "👹", hp: [82, 86], elite: true,
            moves: [
                { name: "Bellow", type: "buff", strength: 3 },
                { name: "Rush", type: "attack", dmg: 14 },
                { name: "Skull Bash", type: "attackDebuff", dmg: 6, vuln: 2 },
            ],
            ai: (self, turn) => {
                if (turn === 0) return 0;
                return pick([1, 1, 2]);
            },
        },
        sentry: {
            name: "Sentry", sprite: "🤖", hp: [70, 74], elite: true,
            moves: [
                { name: "Beam", type: "attack", dmg: 9 },
                { name: "Bolt", type: "attackDebuff", dmg: 7, weak: 2 },
                { name: "Fortify", type: "block", block: 12 },
            ],
            ai: (self, turn) => pick([0, 1, 2]),
        },
        // Boss
        theColossus: {
            name: "The Colossus", sprite: "🗿", hp: [140, 140], boss: true,
            moves: [
                { name: "Boulder Smash", type: "attack", dmg: 18 },
                { name: "Stone Skin", type: "block", block: 18 },
                { name: "Earthquake", type: "attackDebuff", dmg: 10, vuln: 2 },
                { name: "Enrage", type: "buff", strength: 4 },
            ],
            ai: (self, turn) => {
                if (turn === 0) return 3; // enrage
                return pick([0, 0, 2, 1]);
            },
        },
    };

    // Encounter groups keyed by difficulty
    const ENCOUNTERS = {
        easy: [["jawWorm"], ["cultist"], ["redLouse", "redLouse"], ["greenSlime"], ["fungiBeast", "fungiBeast"]],
        hard: [["jawWorm", "cultist"], ["greenSlime", "fungiBeast"], ["cultist", "cultist"], ["jawWorm", "redLouse", "redLouse"]],
        elite: [["gremlinNob"], ["sentry", "sentry"]],
        boss: [["theColossus"]],
    };

    /* ============================================================
       GLOBAL GAME STATE
       ============================================================ */
    let G = null;

    function newGame(charKey) {
        const ch = CHARACTERS[charKey];
        G = {
            char: charKey,
            player: {
                name: ch.name, sprite: ch.sprite,
                hp: ch.maxHp, maxHp: ch.maxHp,
                block: 0, status: {}, isPlayer: true,
            },
            deck: ch.deck.map((k) => makeCard(k, false)),
            relics: [ch.relic],
            gold: 99,
            floor: 0,
            map: null,
            // combat-scoped:
            hand: [], drawPile: [], discard: [], exhaust: [],
            enemies: [], energy: 0, maxEnergy: 3, turn: 0,
            selectedCard: null, inCombat: false, currentNode: null,
        };
        // relic pickup hooks
        const r = RELICS[ch.relic];
        if (r.onPickup) r.onPickup();
        generateMap();
        showMap();
        $("#topbar").classList.remove("hidden");
        updateTopbar();
    }

    function makeCard(key, upgraded) {
        return { id: uid(), key, def: CARDS[key], upgraded: !!upgraded };
    }

    /* Card value resolution: base value or upgraded override */
    function val(card, prop, base) {
        if (card.upgraded && card.def.upg && card.def.upg[prop] != null) return card.def.upg[prop];
        // fall back: upg may define base-changed props; else the passed base
        return base;
    }
    function cardCost(card) {
        if (card.upgraded && card.def.upg && card.def.upg.cost != null) return card.def.upg.cost;
        return card.def.cost;
    }
    // damage number preview including strength & upgrade
    function dmgVal(base, card) {
        const v = card.upgraded && card.def.upg && card.def.upg.dmg != null ? card.def.upg.dmg : base;
        return v;
    }
    function blkVal(base, card) {
        const v = card.upgraded && card.def.upg && card.def.upg.blk != null ? card.def.upg.blk : base;
        return v;
    }

    /* ============================================================
       MAP GENERATION  (rows of branching nodes)
       ============================================================ */
    const ROWS = 14;
    function generateMap() {
        const map = { rows: [] };
        for (let r = 0; r < ROWS; r++) {
            const count = r === 0 ? 3 : r === ROWS - 1 ? 1 : 2 + rnd(3); // 2-4
            const row = [];
            for (let i = 0; i < count; i++) {
                row.push({
                    row: r, idx: i,
                    type: nodeType(r),
                    x: 0, y: 0, next: [], visited: false, reachable: false,
                });
            }
            map.rows.push(row);
        }
        // last row is a single boss
        map.rows[ROWS - 1] = [{ row: ROWS - 1, idx: 0, type: "boss", x: 0, y: 0, next: [], visited: false, reachable: false }];

        // connect each node to 1-2 nodes in the next row
        for (let r = 0; r < ROWS - 1; r++) {
            const cur = map.rows[r];
            const nxt = map.rows[r + 1];
            cur.forEach((node, i) => {
                const links = 1 + rnd(2);
                const centerIdx = Math.round((i / Math.max(1, cur.length - 1)) * (nxt.length - 1));
                const targets = new Set();
                for (let l = 0; l < links; l++) {
                    const t = clamp(centerIdx + (rnd(3) - 1), 0, nxt.length - 1);
                    targets.add(t);
                }
                targets.forEach((t) => node.next.push(nxt[t]));
            });
            // guarantee every next-row node is reachable
            nxt.forEach((n, ni) => {
                const hasParent = cur.some((c) => c.next.includes(n));
                if (!hasParent) {
                    // connect from nearest current node
                    let best = 0, bestDist = 1e9;
                    cur.forEach((c, ci) => {
                        const d = Math.abs(ci / cur.length - ni / nxt.length);
                        if (d < bestDist) { bestDist = d; best = ci; }
                    });
                    cur[best].next.push(n);
                }
            });
        }
        G.map = map;
        // first row reachable
        map.rows[0].forEach((n) => (n.reachable = true));
    }

    function nodeType(r) {
        if (r === 0) return "monster";
        if (r === ROWS - 2) return "rest"; // rest before boss
        const roll = Math.random();
        if (r >= 6 && roll < 0.16) return "elite";
        if (roll < 0.1) return "rest";
        if (roll < 0.2) return "treasure";
        if (roll < 0.3) return "shop";
        if (roll < 0.42) return "unknown";
        return "monster";
    }

    const NODE_ICON = {
        monster: "⚔️", elite: "💀", rest: "🔥", treasure: "💰",
        shop: "🏪", unknown: "❓", boss: "👑",
    };

    /* ============================================================
       SCREEN SWITCHING
       ============================================================ */
    function hideAllScreens() {
        ["#title-screen", "#map-screen", "#combat-screen"].forEach((s) => $(s).classList.add("hidden"));
    }
    function showMap() {
        hideAllScreens();
        $("#map-screen").classList.remove("hidden");
        renderMap();
    }

    function renderMap() {
        const inner = $("#map-inner");
        inner.innerHTML = "";
        const rowGap = 78, colGap = 92;
        const maxCols = Math.max(...G.map.rows.map((r) => r.length));
        const width = Math.max(700, maxCols * colGap + 60);
        const height = ROWS * rowGap + 40;
        inner.style.width = width + "px";
        inner.style.height = height + "px";

        // compute positions (bottom row 0 = start at bottom)
        G.map.rows.forEach((row, r) => {
            const y = height - 40 - r * rowGap;
            const spread = (row.length - 1) * colGap;
            row.forEach((node, i) => {
                node.x = width / 2 - spread / 2 + i * colGap;
                node.y = y;
            });
        });

        // draw connecting lines
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "map-svg");
        svg.setAttribute("width", width);
        svg.setAttribute("height", height);
        G.map.rows.forEach((row) => {
            row.forEach((node) => {
                node.next.forEach((n) => {
                    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                    line.setAttribute("x1", node.x);
                    line.setAttribute("y1", node.y);
                    line.setAttribute("x2", n.x);
                    line.setAttribute("y2", n.y);
                    const active = node.visited && n.reachable;
                    line.setAttribute("stroke", active ? "#ffcc44" : "#4a4266");
                    line.setAttribute("stroke-width", active ? 3 : 2);
                    line.setAttribute("stroke-dasharray", active ? "0" : "5,5");
                    svg.appendChild(line);
                });
            });
        });
        inner.appendChild(svg);

        // draw nodes
        G.map.rows.forEach((row) => {
            row.forEach((node) => {
                const d = el("div", "map-node", NODE_ICON[node.type]);
                d.style.left = node.x + "px";
                d.style.top = node.y + "px";
                if (node.visited) d.classList.add("visited");
                if (node === G.currentNode) d.classList.add("current");
                if (node.reachable && !node.visited) {
                    d.classList.add("reachable");
                    d.onclick = () => enterNode(node);
                }
                attachTip(d, `<b>${nodeLabel(node.type)}</b><br>${nodeDesc(node.type)}`);
                inner.appendChild(d);
            });
        });
        // scroll to bottom (start)
        $("#map-scroll").scrollLeft = (width - $("#map-scroll").clientWidth) / 2;
    }

    function nodeLabel(t) {
        return { monster: "Monster", elite: "Elite", rest: "Rest Site", treasure: "Treasure", shop: "Shop", unknown: "Unknown", boss: "Boss" }[t];
    }
    function nodeDesc(t) {
        return {
            monster: "A normal fight. Rewards gold + a card.",
            elite: "A tough fight, but drops a relic.",
            rest: "Heal 30% HP or upgrade a card.",
            treasure: "A free relic.",
            shop: "Spend gold on cards & relics.",
            unknown: "A random event — could be good or bad.",
            boss: "The guardian of the spire. Beat it to win!",
        }[t];
    }

    function enterNode(node) {
        // mark reachability
        G.map.rows.forEach((row) => row.forEach((n) => (n.reachable = false)));
        node.visited = true;
        G.currentNode = node;
        node.next.forEach((n) => (n.reachable = true));
        G.floor++;
        updateTopbar();

        switch (node.type) {
            case "monster": startCombat(difficultyEncounter("monster"), "monster"); break;
            case "elite": startCombat(pick(ENCOUNTERS.elite), "elite"); break;
            case "boss": startCombat(ENCOUNTERS.boss[0], "boss"); break;
            case "rest": restSite(); break;
            case "treasure": treasureRoom(); break;
            case "shop": shopRoom(); break;
            case "unknown": unknownEvent(); break;
        }
    }

    function difficultyEncounter() {
        // scale up as floors progress
        const grp = G.floor < 5 ? ENCOUNTERS.easy : Math.random() < 0.5 ? ENCOUNTERS.easy : ENCOUNTERS.hard;
        return pick(grp);
    }

    /* ============================================================
       COMBAT ENGINE
       ============================================================ */
    function startCombat(encounterKeys, kind) {
        hideAllScreens();
        $("#combat-screen").classList.remove("hidden");
        G.inCombat = true;
        G.combatKind = kind;
        G.turn = 0;
        G.player.block = 0;
        G.player.status = {}; // status clears between combats
        // build enemies
        G.enemies = encounterKeys.map((k) => spawnEnemy(k));
        // piles
        G.hand = [];
        G.discard = [];
        G.exhaust = [];
        G.drawPile = shuffle(G.deck.map((c) => c));
        G.maxEnergy = 3;
        G.log = [];

        // relic combat-start hooks
        G.relics.forEach((rk) => {
            const r = RELICS[rk];
            if (r.onCombatStart) r.onCombatStart(kind);
        });

        logMsg(`⚔️ Combat begins!`);
        startPlayerTurn(true);
    }

    function spawnEnemy(key) {
        const def = ENEMIES[key];
        const hp = def.hp[0] + rnd(def.hp[1] - def.hp[0] + 1);
        return {
            key, def, name: def.name, sprite: def.sprite,
            hp, maxHp: hp, block: 0, status: {},
            isPlayer: false, turnCount: 0, intent: null,
        };
    }

    function startPlayerTurn(first) {
        G.turn++;
        G.player.block = 0; // block resets (unless Barricade — not implemented)
        // energy
        G.energy = G.maxEnergy;
        G.relics.forEach((rk) => { if (RELICS[rk].energy) G.energy += RELICS[rk].energy; });

        // demon form: strength each turn
        if (G.player.status.demon) applyStatus(G.player, "strength", G.player.status.demon, true);

        // draw
        drawCards(5);

        if (first) {
            G.relics.forEach((rk) => { if (RELICS[rk].onFirstTurn) RELICS[rk].onFirstTurn(); });
        }

        // set enemy intents for the coming turn
        G.enemies.forEach((e) => setIntent(e));

        renderCombat();
    }

    function setIntent(enemy) {
        const moveIdx = enemy.def.ai(enemy, enemy.turnCount);
        enemy.intent = enemy.def.moves[moveIdx];
    }

    function drawCards(n) {
        for (let i = 0; i < n; i++) {
            if (G.drawPile.length === 0) {
                if (G.discard.length === 0) break;
                G.drawPile = shuffle(G.discard.splice(0));
            }
            const c = G.drawPile.pop();
            if (c) G.hand.push(c);
        }
    }

    /* ---------- damage & status math ---------- */
    function attackDamage(attacker, base) {
        let dmg = base + (attacker.status.strength || 0);
        if (attacker.status.weak) dmg = Math.floor(dmg * 0.75);
        return Math.max(0, dmg);
    }
    // damage dealt TO a target, accounting for target's vulnerable
    function incomingDamage(target, dmg) {
        if (target.status.vuln) dmg = Math.floor(dmg * 1.5);
        return dmg;
    }

    // Player deals damage to an enemy target
    function dealDamage(target, base) {
        if (!target || target.hp <= 0) return;
        let dmg = attackDamage(G.player, base);
        dmg = incomingDamage(target, dmg);
        applyDamageToCombatant(target, dmg, true);
    }

    // generic damage application returning unblocked amount
    function applyDamageToCombatant(target, dmg, fromPlayer) {
        let remaining = dmg;
        if (target.block > 0) {
            const absorbed = Math.min(target.block, remaining);
            target.block -= absorbed;
            remaining -= absorbed;
        }
        if (remaining > 0) {
            target.hp = Math.max(0, target.hp - remaining);
            floatText(target, "-" + remaining, "dmg");
            shakeSprite(target);
            // bronze scales / thorns when PLAYER is hit
            if (target.isPlayer && fromPlayer === false) {
                G.relics.forEach((rk) => {
                    const r = RELICS[rk];
                    if (r.thorns && G._currentAttacker && G._currentAttacker.hp > 0) {
                        applyDamageToCombatant(G._currentAttacker, r.thorns, true);
                    }
                });
            }
        } else {
            floatText(target, "Blocked", "block");
        }
        if (target.hp <= 0 && !target.isPlayer) onEnemyDeath(target);
        if (target.isPlayer && target.hp <= 0) checkPlayerDeath();
    }

    function gainBlock(who, amount) {
        let a = amount + (who.status.dexterity || 0);
        if (who.status.frail) a = Math.floor(a * 0.75);
        a = Math.max(0, a);
        who.block += a;
        floatText(who, "+" + a + "🛡️", "block");
    }

    function healPlayer(n) {
        if (!G.player) return;
        const before = G.player.hp;
        G.player.hp = Math.min(G.player.maxHp, G.player.hp + n);
        const healed = G.player.hp - before;
        if (healed > 0 && G.inCombat) floatText(G.player, "+" + healed, "heal");
        updateTopbar();
    }
    function loseHP(who, n) {
        who.hp = Math.max(0, who.hp - n);
        floatText(who, "-" + n, "dmg");
        if (who.isPlayer) { updateTopbar(); checkPlayerDeath(); }
    }

    function applyStatus(who, key, amount, silent) {
        who.status[key] = (who.status[key] || 0) + amount;
        if (who.status[key] === 0) delete who.status[key];
        if (!silent && G.inCombat) renderCombat();
    }

    /* ---------- playing cards ---------- */
    function canPlay(card) {
        return G.energy >= cardCost(card);
    }

    function onCardClicked(card) {
        if (!canPlay(card)) return;
        const needsTarget = card.def.type === "attack" && !isAllTarget(card);
        if (needsTarget) {
            // toggle target-selection mode
            if (G.selectedCard === card) {
                G.selectedCard = null;
            } else {
                G.selectedCard = card;
            }
            renderCombat();
        } else {
            resolveCard(card, null);
        }
    }
    function isAllTarget(card) {
        return card.key === "cleave"; // cards that hit all enemies need no single target
    }

    function onEnemyClicked(enemy) {
        if (!G.selectedCard) return;
        if (enemy.hp <= 0) return;
        const card = G.selectedCard;
        G.selectedCard = null;
        resolveCard(card, enemy);
    }

    function resolveCard(card, target) {
        if (!canPlay(card)) return;
        // default target = first alive enemy for all-target or auto
        if (!target) target = G.enemies.find((e) => e.hp > 0);
        G.energy -= cardCost(card);
        // remove from hand
        const idx = G.hand.indexOf(card);
        if (idx >= 0) G.hand.splice(idx, 1);

        logMsg(`You play <b>${card.def.name}</b>${card.upgraded ? "+" : ""}.`);
        const ctx = { target, enemies: G.enemies.filter((e) => e.hp > 0) };
        card.def.play(card, ctx);

        // where the card goes
        if (card.def.type === "power") {
            // powers are consumed (already applied)
        } else if (card.def.exhaust) {
            G.exhaust.push(card);
        } else {
            G.discard.push(card);
        }
        cleanupDeadEnemies();
        renderCombat();
        if (G.enemies.every((e) => e.hp <= 0)) winCombat();
    }

    function exhaustCard(card) {
        const idx = G.hand.indexOf(card);
        if (idx >= 0) {
            G.hand.splice(idx, 1);
            G.exhaust.push(card);
        }
    }

    function endTurn() {
        if (!G.inCombat) return;
        // metallicize
        if (G.player.status.metal) gainBlock(G.player, G.player.status.metal);
        // discard hand
        G.discard.push(...G.hand);
        G.hand = [];
        G.selectedCard = null;
        // decrement player debuffs at end of turn
        tickStatusEndOfTurn(G.player);
        renderCombat();
        setTimeout(enemyTurn, 350);
    }

    function tickStatusEndOfTurn(who) {
        ["weak", "vuln", "frail"].forEach((k) => {
            if (who.status[k]) {
                who.status[k]--;
                if (who.status[k] <= 0) delete who.status[k];
            }
        });
    }

    /* ---------- enemy turn ---------- */
    function enemyTurn() {
        if (!G.inCombat) return;
        const alive = G.enemies.filter((e) => e.hp > 0);
        let i = 0;
        const step = () => {
            if (i >= alive.length || !G.inCombat) {
                if (G.inCombat && G.player.hp > 0) startPlayerTurn(false);
                return;
            }
            const e = alive[i++];
            if (e.hp > 0) doEnemyMove(e);
            renderCombat();
            setTimeout(step, 550);
        };
        step();
    }

    function doEnemyMove(enemy) {
        enemy.block = 0; // enemy block resets on their turn start
        // ritual: cultist-style strength gain accrues
        if (enemy.status.ritual) applyStatus(enemy, "strength", enemy.status.ritual, true);

        const m = enemy.intent || enemy.def.moves[0];
        G._currentAttacker = enemy;

        const doAttack = (dmg) => {
            let d = attackDamage(enemy, dmg);
            d = incomingDamage(G.player, d);
            applyDamageToCombatant(G.player, d, false);
            updateTopbar();
        };

        switch (m.type) {
            case "attack": doAttack(m.dmg); logMsg(`${enemy.name} attacks for ${attackDamage(enemy, m.dmg)}.`); break;
            case "attackBlock": doAttack(m.dmg); enemy.block += m.block; break;
            case "attackDebuff":
                doAttack(m.dmg);
                if (m.weak) applyStatus(G.player, "weak", m.weak, true);
                if (m.vuln) applyStatus(G.player, "vuln", m.vuln, true);
                break;
            case "block": enemy.block += m.block; logMsg(`${enemy.name} defends.`); break;
            case "buff":
                if (m.strength) applyStatus(enemy, "strength", m.strength, true);
                if (m.block) enemy.block += m.block;
                if (m.ritual) applyStatus(enemy, "ritual", m.ritual, true);
                logMsg(`${enemy.name} empowers itself.`);
                break;
            case "debuff":
                if (m.weak) applyStatus(G.player, "weak", m.weak, true);
                logMsg(`${enemy.name} weakens you.`);
                break;
        }
        G._currentAttacker = null;
        enemy.turnCount++;
        tickStatusEndOfTurn(enemy);
        if (G.player.hp <= 0) return;
    }

    function cleanupDeadEnemies() {
        G.enemies.forEach((e) => { if (e.hp < 0) e.hp = 0; });
    }
    function onEnemyDeath(e) {
        floatText(e, "💀", "dmg");
    }

    function checkPlayerDeath() {
        if (G.player.hp <= 0 && G.inCombat) {
            G.inCombat = false;
            setTimeout(gameOver, 500);
        }
    }

    /* ---------- combat resolution ---------- */
    function winCombat() {
        if (!G.inCombat) return;
        G.inCombat = false;
        // relic end-of-combat hooks
        G.relics.forEach((rk) => { if (RELICS[rk].onCombatEnd) RELICS[rk].onCombatEnd(); });
        setTimeout(() => combatRewards(G.combatKind), 400);
    }

    function combatRewards(kind) {
        const goldGain = kind === "boss" ? 100 + rnd(20) : kind === "elite" ? 30 + rnd(15) : 10 + rnd(11);
        G.gold += goldGain;
        updateTopbar();

        // Build a persistent reward list so partially-claimed rewards survive
        // sub-screens (like the card chooser) and re-renders.
        const rewards = [
            { icon: "🪙", label: `<b class="gold">${goldGain} Gold</b>`, claimed: true, info: true },
            { icon: "🃏", label: "Add a card to your deck", claimed: false, type: "card" },
        ];
        if (kind === "elite" || kind === "boss") {
            const relicKey = randomRelic();
            if (relicKey) {
                rewards.push({
                    icon: RELICS[relicKey].art,
                    label: `<b>Relic:</b> ${RELICS[relicKey].name} <span class="muted">— ${RELICS[relicKey].desc}</span>`,
                    claimed: false, type: "relic", relicKey,
                });
            }
        }
        renderRewardScreen(kind, rewards);
    }

    function renderRewardScreen(kind, rewards) {
        const isBoss = kind === "boss";
        openOverlay(`
            <h2>${isBoss ? "👑 Boss Defeated!" : "Victory!"}</h2>
            <p class="muted">Claim your rewards, then continue.</p>
            <div class="reward-list" id="reward-list"></div>
            <button class="big-btn" id="reward-continue">${isBoss ? "🏆 You Win! Play Again" : "Continue ▶"}</button>
        `);
        const list = $("#reward-list");
        rewards.forEach((it) => {
            const row = el("div", "reward-item" + (it.claimed ? " taken" : ""),
                `<span class="r-icon">${it.icon}</span><span>${it.label}</span>`);
            if (!it.claimed && !it.info) {
                row.onclick = () => {
                    if (it.type === "card") {
                        showCardReward(kind, rewards, it);
                    } else if (it.type === "relic") {
                        addRelic(it.relicKey);
                        it.claimed = true;
                        renderRewardScreen(kind, rewards);
                    }
                };
            }
            list.appendChild(row);
        });
        $("#reward-continue").onclick = () => {
            closeOverlay();
            if (isBoss) { winRun(); } else { showMap(); }
        };
    }

    function showCardReward(kind, rewards, rewardItem) {
        const choices = [];
        for (let i = 0; i < 3; i++) {
            let rarity;
            const roll = Math.random() + (kind === "elite" ? 0.15 : 0) + (kind === "boss" ? 0.3 : 0);
            if (roll > 0.92) rarity = "rare";
            else if (roll > 0.62) rarity = "uncommon";
            else rarity = "common";
            let key;
            let tries = 0;
            do { key = pick(POOL[rarity]); tries++; } while (choices.some((c) => c.key === key) && tries < 20);
            choices.push(makeCard(key, false));
        }
        const back = () => { rewardItem.claimed = true; renderRewardScreen(kind, rewards); };
        openOverlay(`
            <h2>Choose a card</h2>
            <div class="card-choices" id="card-choices"></div>
            <button class="pile-btn" id="skip-card">Skip</button>
        `);
        const cc = $("#card-choices");
        choices.forEach((card) => {
            const cel = renderCardEl(card, true);
            cel.classList.add("playable");
            cel.onclick = () => {
                G.deck.push(card);
                updateTopbar();
                back();
            };
            cc.appendChild(cel);
        });
        $("#skip-card").onclick = back;
    }

    function randomRelic() {
        const owned = new Set(G.relics);
        const avail = RELIC_POOL.filter((r) => !owned.has(r));
        if (avail.length === 0) return null;
        return pick(avail);
    }
    function addRelic(key) {
        if (G.relics.includes(key)) return;
        G.relics.push(key);
        const r = RELICS[key];
        if (r.onPickup) r.onPickup();
        updateTopbar();
    }

    /* ============================================================
       NON-COMBAT ROOMS
       ============================================================ */
    function restSite() {
        openOverlay(`
            <h2>🔥 Rest Site</h2>
            <p class="muted">Take a moment to recover or hone your skills.</p>
            <div class="reward-list">
                <div class="reward-item" id="rest-heal">
                    <span class="r-icon">❤️</span>
                    <span>Rest — heal <b>${Math.floor(G.player.maxHp * 0.3)}</b> HP</span>
                </div>
                <div class="reward-item" id="rest-upgrade">
                    <span class="r-icon">⚒️</span>
                    <span>Smith — upgrade a card in your deck</span>
                </div>
            </div>
        `);
        $("#rest-heal").onclick = () => {
            healPlayer(Math.floor(G.player.maxHp * 0.3));
            closeOverlay();
            showMap();
        };
        $("#rest-upgrade").onclick = () => showUpgradeChooser();
    }

    function showUpgradeChooser() {
        const upgradable = G.deck.filter((c) => !c.upgraded && c.def.upg);
        if (upgradable.length === 0) {
            openOverlay(`<h2>Nothing to upgrade</h2><p class="muted">All your cards are already upgraded.</p><button class="big-btn" id="ok">OK</button>`);
            $("#ok").onclick = () => { closeOverlay(); showMap(); };
            return;
        }
        openOverlay(`
            <h2>Upgrade a card</h2>
            <div class="grid-cards" id="upg-cards"></div>
        `);
        const wrap = $("#upg-cards");
        G.deck.forEach((card) => {
            const cel = renderCardEl(card, true);
            if (!card.upgraded && card.def.upg) {
                cel.classList.add("playable");
                cel.onclick = () => {
                    card.upgraded = true;
                    closeOverlay();
                    showMap();
                };
            } else {
                cel.classList.add("unplayable");
            }
            wrap.appendChild(cel);
        });
    }

    function treasureRoom() {
        const relicKey = randomRelic();
        if (!relicKey) {
            const g = 50 + rnd(50);
            G.gold += g;
            updateTopbar();
            openOverlay(`<h2>💰 Treasure!</h2><p>No new relics — you find <b class="gold">${g} gold</b> instead.</p><button class="big-btn" id="ok">Take it</button>`);
            $("#ok").onclick = () => { closeOverlay(); showMap(); };
            return;
        }
        const r = RELICS[relicKey];
        openOverlay(`
            <h2>💰 Treasure!</h2>
            <p>You found a relic:</p>
            <div class="reward-item" style="justify-content:center; cursor:default; pointer-events:none;">
                <span class="r-icon">${r.art}</span>
                <span><b>${r.name}</b> — ${r.desc}</span>
            </div>
            <button class="big-btn" id="take-relic">Take Relic</button>
        `);
        $("#take-relic").onclick = () => { addRelic(relicKey); closeOverlay(); showMap(); };
    }

    function shopRoom() {
        // 3 cards + 1 relic + card-removal service
        const cards = [];
        for (let i = 0; i < 4; i++) {
            const roll = Math.random();
            const rarity = roll > 0.85 ? "rare" : roll > 0.5 ? "uncommon" : "common";
            cards.push(makeCard(pick(POOL[rarity]), false));
        }
        const relicKey = randomRelic();
        const cardPrice = (c) => ({ common: 45, uncommon: 70, rare: 130, starter: 40 }[c.def.rarity] || 50);

        openOverlay(`
            <h2>🏪 The Merchant</h2>
            <p class="muted">Gold: <span class="gold" id="shop-gold">${G.gold}</span></p>
            <div id="shop-cards"></div>
            <div id="shop-relic"></div>
            <div id="shop-remove"></div>
            <button class="big-btn" id="shop-leave">Leave Shop</button>
        `);

        const cardsWrap = $("#shop-cards");
        cards.forEach((card) => {
            const price = cardPrice(card);
            const row = el("div", "shop-item");
            row.innerHTML = `<span>${card.def.art} <b>${card.def.name}</b> <span class="muted">(${card.def.type})</span></span>`;
            const btn = el("button", "buy-btn", `🪙 ${price}`);
            btn.disabled = G.gold < price;
            btn.onclick = () => {
                if (G.gold < price) return;
                G.gold -= price;
                G.deck.push(card);
                row.remove();
                updateTopbar();
                refreshShop();
            };
            row.appendChild(btn);
            cardsWrap.appendChild(row);
        });

        if (relicKey) {
            const price = 150;
            const r = RELICS[relicKey];
            const row = el("div", "shop-item");
            row.innerHTML = `<span>${r.art} <b>${r.name}</b> <span class="muted">— ${r.desc}</span></span>`;
            const btn = el("button", "buy-btn", `🪙 ${price}`);
            btn.disabled = G.gold < price;
            btn.onclick = () => {
                if (G.gold < price) return;
                G.gold -= price;
                addRelic(relicKey);
                row.remove();
                refreshShop();
            };
            row.appendChild(btn);
            $("#shop-relic").appendChild(row);
        }

        // card removal
        const remRow = el("div", "shop-item");
        remRow.innerHTML = `<span>🗑️ <b>Remove a card</b> <span class="muted">from your deck</span></span>`;
        const remBtn = el("button", "buy-btn", `🪙 75`);
        remBtn.disabled = G.gold < 75 || G.deck.length <= 1;
        remBtn.onclick = () => showRemoveChooser();
        remRow.appendChild(remBtn);
        $("#shop-remove").appendChild(remRow);

        function refreshShop() {
            $("#shop-gold").textContent = G.gold;
            document.querySelectorAll(".buy-btn").forEach((b) => {
                const label = b.textContent.replace("🪙", "").trim();
                const p = parseInt(label, 10);
                if (!isNaN(p)) b.disabled = G.gold < p;
            });
            remBtn.disabled = G.gold < 75 || G.deck.length <= 1;
        }

        $("#shop-leave").onclick = () => { closeOverlay(); showMap(); };
    }

    function showRemoveChooser() {
        openOverlay(`<h2>Remove a card (🪙75)</h2><div class="grid-cards" id="rem-cards"></div><button class="pile-btn" id="rem-cancel">Cancel</button>`);
        const wrap = $("#rem-cards");
        G.deck.forEach((card) => {
            const cel = renderCardEl(card, true);
            cel.classList.add("playable");
            cel.onclick = () => {
                G.gold -= 75;
                const idx = G.deck.indexOf(card);
                if (idx >= 0) G.deck.splice(idx, 1);
                updateTopbar();
                closeOverlay();
                shopRoom();
            };
            wrap.appendChild(cel);
        });
        $("#rem-cancel").onclick = () => { closeOverlay(); shopRoom(); };
    }

    function unknownEvent() {
        const events = [
            {
                title: "🕳️ A Mysterious Shrine",
                text: "An altar hums with power. You may offer 6 HP for a surge of strength (a random relic), or leave.",
                options: [
                    { label: "Offer 6 HP", run: () => { loseHP(G.player, 6); const rk = randomRelic(); if (rk) addRelic(rk); else { G.gold += 40; updateTopbar(); } endEvent(); } },
                    { label: "Leave", run: endEvent },
                ],
            },
            {
                title: "💰 Wandering Merchant",
                text: "A traveler drops a coin purse as they flee. Free gold!",
                options: [{ label: "Take 40 gold", run: () => { G.gold += 40; updateTopbar(); endEvent(); } }],
            },
            {
                title: "⛲ Healing Spring",
                text: "Crystal water glimmers. Drink to heal 20 HP, or bottle it (raise Max HP by 4).",
                options: [
                    { label: "Drink (heal 20)", run: () => { healPlayer(20); endEvent(); } },
                    { label: "Bottle it (+4 Max HP)", run: () => { G.player.maxHp += 4; healPlayer(4); endEvent(); } },
                ],
            },
            {
                title: "👺 Ambush!",
                text: "Bandits leap from the shadows. There's no avoiding this fight.",
                options: [{ label: "Fight!", run: () => { closeOverlay(); startCombat(difficultyEncounter("monster"), "monster"); } }],
            },
            {
                title: "📜 Ancient Writings",
                text: "You study a stone tablet and gain insight — upgrade a random card in your deck.",
                options: [{ label: "Study", run: () => {
                    const up = G.deck.filter((c) => !c.upgraded && c.def.upg);
                    if (up.length) pick(up).upgraded = true;
                    endEvent();
                } }],
            },
        ];
        const ev = pick(events);
        openOverlay(`
            <h2>${ev.title}</h2>
            <p class="muted">${ev.text}</p>
            <div class="reward-list" id="ev-opts"></div>
        `);
        const wrap = $("#ev-opts");
        ev.options.forEach((o) => {
            const row = el("div", "reward-item", `<span>${o.label}</span>`);
            row.style.justifyContent = "center";
            row.onclick = o.run;
            wrap.appendChild(row);
        });
        function endEvent() { closeOverlay(); showMap(); }
    }

    /* ============================================================
       RENDERING — combat
       ============================================================ */
    function renderCombat() {
        if (!$("#combat-screen")) return;
        renderPlayer();
        renderEnemies();
        renderHand();
        // energy
        $("#ui-energy").textContent = G.energy;
        $("#ui-maxenergy").textContent = G.maxEnergy + relicEnergyBonus();
        $("#ui-drawcount").textContent = G.drawPile.length;
        $("#ui-discardcount").textContent = G.discard.length;
        // target hint
        $("#target-hint").textContent = G.selectedCard ? "↳ Click an enemy to target" : "";
        renderLog();
        updateTopbar();
    }
    function relicEnergyBonus() {
        let b = 0;
        G.relics.forEach((rk) => { if (RELICS[rk].energy) b += RELICS[rk].energy; });
        return b;
    }

    function renderPlayer() {
        const side = $("#player-side");
        side.innerHTML = "";
        const c = el("div", "combatant" + (G.player._hit ? " hit" : ""));
        c.id = "cmb-player";
        c.innerHTML = `
            <div class="sprite">${G.player.sprite}</div>
            <div class="name">${G.player.name}</div>
            ${hpBarHTML(G.player)}
            ${badgesHTML(G.player)}
        `;
        side.appendChild(c);
    }

    function renderEnemies() {
        const side = $("#enemy-side");
        side.innerHTML = "";
        G.enemies.forEach((e, i) => {
            if (e.hp <= 0) return;
            const c = el("div", "combatant" + (e._hit ? " hit" : ""));
            c.dataset.enemy = i;
            const targetable = G.selectedCard && e.hp > 0;
            if (targetable) c.classList.add("targetable");
            c.innerHTML = `
                <div>${intentHTML(e)}</div>
                <div class="sprite">${e.sprite}</div>
                <div class="name">${e.name}</div>
                ${hpBarHTML(e)}
                ${badgesHTML(e)}
            `;
            if (targetable) c.onclick = () => onEnemyClicked(e);
            side.appendChild(c);
        });
    }

    function intentHTML(e) {
        const m = e.intent;
        if (!m) return `<div class="intent">❔</div>`;
        let icon = "❔", extra = "";
        if (m.type === "attack" || m.type === "attackBlock" || m.type === "attackDebuff") {
            const d = incomingDamage(G.player, attackDamage(e, m.dmg));
            icon = "🗡️";
            extra = `<span class="dmg">${d}</span>`;
            if (m.type === "attackDebuff") extra += ` <span class="muted">+debuff</span>`;
            if (m.type === "attackBlock") extra += ` 🛡️`;
        } else if (m.type === "block") icon = "🛡️";
        else if (m.type === "buff") icon = "💪";
        else if (m.type === "debuff") icon = "☠️";
        return `<div class="intent" title="${m.name}">${icon} ${extra}</div>`;
    }

    function hpBarHTML(who) {
        const pct = clamp((who.hp / who.maxHp) * 100, 0, 100);
        const blockBadge = who.block > 0 ? `<span style="color:var(--block)">🛡️${who.block}</span>` : "";
        return `
            <div class="hp-bar">
                <div class="hp-fill" style="width:${pct}%"></div>
                <div class="hp-label">${who.hp}/${who.maxHp} ${blockBadge}</div>
            </div>`;
    }

    function badgesHTML(who) {
        const s = who.status;
        const b = [];
        if (who.block > 0) b.push(`<span class="badge block">🛡️ ${who.block}</span>`);
        if (s.strength) b.push(`<span class="badge strength" title="Strength: +dmg">💪 ${s.strength}</span>`);
        if (s.dexterity) b.push(`<span class="badge dex" title="Dexterity: +block">🤸 ${s.dexterity}</span>`);
        if (s.vuln) b.push(`<span class="badge vuln" title="Vulnerable: takes 50% more">💔 ${s.vuln}</span>`);
        if (s.weak) b.push(`<span class="badge weak" title="Weak: deals 25% less">🥴 ${s.weak}</span>`);
        if (s.ritual) b.push(`<span class="badge ritual" title="Ritual: gains Strength each turn">🔮 ${s.ritual}</span>`);
        if (s.metal) b.push(`<span class="badge metal" title="Metallicize: block each turn">⚙️ ${s.metal}</span>`);
        if (s.demon) b.push(`<span class="badge strength" title="Demon Form: Strength each turn">😈 ${s.demon}</span>`);
        return `<div class="badges">${b.join("")}</div>`;
    }

    function renderHand() {
        const hand = $("#hand");
        hand.innerHTML = "";
        G.hand.forEach((card) => {
            const cel = renderCardEl(card, false);
            if (canPlay(card)) {
                cel.classList.add("playable");
                if (G.selectedCard === card) cel.classList.add("selected");
                cel.onclick = () => onCardClicked(card);
            } else {
                cel.classList.add("unplayable");
            }
            hand.appendChild(cel);
        });
        $("#btn-end-turn").disabled = false;
    }

    function renderCardEl(card, showFull) {
        const d = card.def;
        const cel = el("div", "card " + d.type);
        const cost = cardCost(card);
        cel.innerHTML = `
            <div class="cost">${cost}</div>
            <div class="card-name">${d.name}${card.upgraded ? '<span class="upg">+</span>' : ""}</div>
            <div class="card-art">${d.art}</div>
            <div class="card-type">${d.type}</div>
            <div class="card-desc">${d.desc(card)}</div>
        `;
        return cel;
    }

    /* ---------- visual feedback ---------- */
    function floatText(who, text, cls) {
        const map = who.isPlayer ? "#cmb-player" : `[data-enemy]`;
        let container;
        if (who.isPlayer) container = $("#cmb-player");
        else {
            const idx = G.enemies.indexOf(who);
            container = document.querySelector(`.combatant[data-enemy="${idx}"]`);
        }
        if (!container) return;
        const f = el("div", "floating " + cls, text);
        container.appendChild(f);
        setTimeout(() => f.remove(), 900);
    }
    function shakeSprite(who) {
        who._hit = true;
        setTimeout(() => { who._hit = false; renderCombat(); }, 300);
        // trigger immediate class without full re-render race
        const sel = who.isPlayer ? "#cmb-player" : `.combatant[data-enemy="${G.enemies.indexOf(who)}"]`;
        const node = document.querySelector(sel);
        if (node) node.classList.add("hit");
    }

    function logMsg(m) {
        if (!G.log) G.log = [];
        G.log.push(m);
        if (G.log.length > 30) G.log.shift();
        renderLog();
    }
    function renderLog() {
        const l = $("#combat-log");
        if (!l || !G.log) return;
        l.innerHTML = G.log.slice(-6).join(" &nbsp;·&nbsp; ");
        l.scrollTop = l.scrollHeight;
    }

    /* ============================================================
       TOP BAR + DECK VIEW + RELIC TIPS
       ============================================================ */
    function updateTopbar() {
        if (!G) return;
        $("#ui-hp").textContent = G.player.hp;
        $("#ui-maxhp").textContent = G.player.maxHp;
        $("#ui-gold").textContent = G.gold;
        $("#ui-floor").textContent = G.floor;
        $("#ui-decksize").textContent = G.deck.length;
        const rw = $("#ui-relics");
        rw.innerHTML = "";
        G.relics.forEach((rk) => {
            const r = RELICS[rk];
            const span = el("span", "relic", r.art);
            attachTip(span, `<b>${r.name}</b><br>${r.desc}`);
            rw.appendChild(span);
        });
    }

    function showDeck() {
        const sorted = G.deck.slice().sort((a, b) => a.def.name.localeCompare(b.def.name));
        openOverlay(`<h2>Your Deck (${G.deck.length})</h2><div class="grid-cards" id="deck-grid"></div><button class="big-btn" id="deck-close">Close</button>`);
        const grid = $("#deck-grid");
        sorted.forEach((c) => grid.appendChild(renderCardEl(c, true)));
        $("#deck-close").onclick = () => closeOverlay();
    }

    /* ============================================================
       OVERLAYS + TOOLTIPS
       ============================================================ */
    function openOverlay(html) {
        const ov = $("#overlay");
        ov.innerHTML = `<div class="overlay-inner">${html}</div>`;
        ov.classList.remove("hidden");
    }
    function closeOverlay() {
        $("#overlay").classList.add("hidden");
        $("#overlay").innerHTML = "";
    }

    const tip = () => $("#tooltip");
    function attachTip(node, html) {
        node.addEventListener("mouseenter", (e) => {
            tip().innerHTML = html;
            tip().classList.remove("hidden");
            moveTip(e);
        });
        node.addEventListener("mousemove", moveTip);
        node.addEventListener("mouseleave", () => tip().classList.add("hidden"));
    }
    function moveTip(e) {
        const t = tip();
        let x = e.clientX + 14, y = e.clientY + 14;
        const rect = t.getBoundingClientRect();
        if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - 14;
        if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - 14;
        t.style.left = x + "px";
        t.style.top = y + "px";
    }

    /* ============================================================
       WIN / LOSE
       ============================================================ */
    function gameOver() {
        openOverlay(`
            <h2>💀 You Died</h2>
            <p class="muted">You fell on floor ${G.floor}. The spire claims another challenger.</p>
            <button class="big-btn" id="go-restart">Try Again</button>
        `);
        $("#go-restart").onclick = () => { closeOverlay(); resetToTitle(); };
    }
    function winRun() {
        openOverlay(`
            <h2>🏆 The Spire is Yours!</h2>
            <p class="muted">You defeated The Colossus and conquered the Spire of Trials. Well fought, ${G.player.name}!</p>
            <p>Final deck size: <b>${G.deck.length}</b> · Relics: <b>${G.relics.length}</b> · Gold: <b class="gold">${G.gold}</b></p>
            <button class="big-btn" id="win-restart">Play Again</button>
        `);
        $("#win-restart").onclick = () => { closeOverlay(); resetToTitle(); };
    }

    function resetToTitle() {
        G = null;
        $("#topbar").classList.add("hidden");
        hideAllScreens();
        $("#title-screen").classList.remove("hidden");
    }

    /* ============================================================
       TITLE SCREEN + WIRING
       ============================================================ */
    let selectedChar = "warrior";
    function buildCharPicker() {
        const wrap = $("#char-picker");
        wrap.innerHTML = "";
        Object.entries(CHARACTERS).forEach(([key, ch]) => {
            const c = el("div", "char-card" + (key === selectedChar ? " selected" : ""));
            const r = RELICS[ch.relic];
            c.innerHTML = `
                <div class="emoji">${ch.emoji}</div>
                <h3>${ch.name}</h3>
                <p>${ch.desc}</p>
                <p class="gold">Starts with: ${r.art} ${r.name}</p>
            `;
            c.onclick = () => { selectedChar = key; buildCharPicker(); };
            wrap.appendChild(c);
        });
    }

    function wire() {
        buildCharPicker();
        $("#btn-start").onclick = () => newGame(selectedChar);
        $("#btn-end-turn").onclick = endTurn;
        $("#btn-deck").onclick = showDeck;
        $("#btn-abandon").onclick = () => {
            openOverlay(`<h2>Abandon this run?</h2><p class="muted">Your progress will be lost.</p>
                <button class="big-btn" id="ab-yes">Abandon</button>
                <button class="pile-btn" id="ab-no" style="margin-left:10px">Keep Playing</button>`);
            $("#ab-yes").onclick = () => { closeOverlay(); resetToTitle(); };
            $("#ab-no").onclick = () => closeOverlay();
        };
        $("#btn-draw-pile").onclick = () => showPile("Draw Pile", G.drawPile, true);
        $("#btn-discard-pile").onclick = () => showPile("Discard Pile", G.discard, false);

        // keyboard: E ends turn
        document.addEventListener("keydown", (e) => {
            if (!G || !G.inCombat) return;
            if (e.key === "e" || e.key === "E") endTurn();
            if (e.key === "Escape") { G.selectedCard = null; renderCombat(); }
        });
    }

    function showPile(title, pile, shuffled) {
        const arr = shuffled ? shuffle(pile.slice()) : pile.slice();
        openOverlay(`<h2>${title} (${pile.length})</h2>${shuffled ? '<p class="muted">Order hidden (shuffled).</p>' : ""}<div class="grid-cards" id="pile-grid"></div><button class="big-btn" id="pile-close">Close</button>`);
        const grid = $("#pile-grid");
        arr.forEach((c) => grid.appendChild(renderCardEl(c, true)));
        $("#pile-close").onclick = () => closeOverlay();
    }

    document.addEventListener("DOMContentLoaded", wire);
})();
