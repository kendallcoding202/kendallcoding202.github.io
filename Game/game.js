/* ============================================================
   COGFALL — a clockwork deckbuilding roguelike
   Original setting & mechanics. Vanilla JS, no dependencies.
   All run state lives in `G`.

   Signature mechanics (what makes each character play differently):
     • The Bulwark    — retains half its Plating each turn + Recoil (thorns)
     • The Overclocker — builds Heat; spend it for big hits or overheat & burn
     • The Artificer   — deploys Contraptions that act automatically each turn
   Shared keywords: Steam (energy), Plating (block), Power, Exposed, Jammed,
   Precision, Rust (damage over time).
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
       play(card, ctx) where ctx = {target, enemies}
       upg = overrides used when the card is upgraded (+)
       ============================================================ */
    const CARDS = {
        /* ---------- Universal starters / common ---------- */
        pistonPunch: {
            name: "Piston Punch", type: "attack", cost: 1, art: "🥊", rarity: "starter",
            desc: (c) => `Deal <b>${dv(6, c)}</b> damage.`,
            upg: { dmg: 9 },
            play: (c, x) => dealDamage(x.target, v(c, "dmg", 6)),
        },
        reinforce: {
            name: "Reinforce", type: "skill", cost: 1, art: "🔩", rarity: "starter",
            desc: (c) => `Gain <b>${pv(5, c)}</b> Plating.`,
            upg: { blk: 8 },
            play: (c) => gainPlating(G.player, v(c, "blk", 5)),
        },
        sawblade: {
            name: "Sawblade", type: "attack", cost: 1, art: "🪚", rarity: "common",
            desc: (c) => `Deal <b>${dv(8, c)}</b> damage to <b>ALL</b> enemies.`,
            upg: { dmg: 11 },
            play: (c, x) => x.enemies.slice().forEach((e) => dealDamage(e, v(c, "dmg", 8))),
        },
        ratchetStrike: {
            name: "Ratchet Strike", type: "attack", cost: 1, art: "🔧", rarity: "common",
            desc: (c) => `Gain <b>${pv(5, c)}</b> Plating. Deal <b>${dv(5, c)}</b> damage.`,
            upg: { dmg: 7, blk: 7 },
            play: (c, x) => { gainPlating(G.player, v(c, "blk", 5)); dealDamage(x.target, v(c, "dmg", 5)); },
        },
        twinRivets: {
            name: "Twin Rivets", type: "attack", cost: 1, art: "⚙️", rarity: "common",
            desc: (c) => `Deal <b>${dv(5, c)}</b> damage <b>twice</b>.`,
            upg: { dmg: 7 },
            play: (c, x) => { dealDamage(x.target, v(c, "dmg", 5)); if (x.target.hp > 0) dealDamage(x.target, v(c, "dmg", 5)); },
        },
        rivetGun: {
            name: "Rivet Gun", type: "attack", cost: 1, art: "🔫", rarity: "common",
            desc: (c) => `Deal <b>${dv(9, c)}</b> damage. Draw <b>${v(c, "draw", 1)}</b> card.`,
            upg: { dmg: 10, draw: 2 },
            play: (c, x) => { dealDamage(x.target, v(c, "dmg", 9)); drawCards(v(c, "draw", 1)); },
        },
        scrapshot: {
            name: "Scrapshot", type: "attack", cost: 0, art: "💢", rarity: "common",
            desc: (c) => `Deal <b>${dv(6, c)}</b> damage. Add a copy of Scrapshot to your discard pile.`,
            upg: { dmg: 8 },
            play: (c, x) => { dealDamage(x.target, v(c, "dmg", 6)); G.discard.push(makeCard("scrapshot", c.upgraded)); },
        },
        haymaker: {
            name: "Haymaker", type: "attack", cost: 2, art: "🦾", rarity: "common",
            desc: (c) => `Deal <b>${dv(12, c)}</b> damage. Apply <b>${v(c, "jam", 2)}</b> Jammed.`,
            upg: { dmg: 14, jam: 3 },
            play: (c, x) => { dealDamage(x.target, v(c, "dmg", 12)); applyStatus(x.target, "jammed", v(c, "jam", 2)); },
        },
        corrosiveSpray: {
            name: "Corrosive Spray", type: "attack", cost: 1, art: "🧪", rarity: "common",
            desc: (c) => `Deal <b>${dv(5, c)}</b> damage. Apply <b>${v(c, "rust", 3)}</b> Rust.`,
            upg: { dmg: 7, rust: 4 },
            play: (c, x) => { dealDamage(x.target, v(c, "dmg", 5)); applyStatus(x.target, "rust", v(c, "rust", 3)); },
        },
        emergencyPatch: {
            name: "Emergency Patch", type: "skill", cost: 1, art: "🩹", rarity: "common",
            desc: (c) => `Gain <b>${pv(8, c)}</b> Plating. Draw <b>1</b> card.`,
            upg: { blk: 11 },
            play: (c) => { gainPlating(G.player, v(c, "blk", 8)); drawCards(1); },
        },
        wrenchToss: {
            name: "Wrench Toss", type: "skill", cost: 1, art: "🛠️", rarity: "common",
            desc: (c) => `Gain <b>${pv(7, c)}</b> Plating. Exhaust a random card in your hand.`,
            upg: { blk: 9 },
            play: (c) => { gainPlating(G.player, v(c, "blk", 7)); if (G.hand.length) exhaustCard(G.hand[rnd(G.hand.length)]); },
        },
        kickstart: {
            name: "Kickstart", type: "skill", cost: 0, art: "🔑", rarity: "common",
            desc: (c) => `Draw <b>${v(c, "draw", 1)}</b> card. Exhaust this card.`,
            upg: { draw: 2 },
            exhaust: true,
            play: (c) => drawCards(v(c, "draw", 1)),
        },

        /* ---------- Uncommon ---------- */
        flywheel: {
            name: "Flywheel", type: "attack", cost: 2, art: "🌀", rarity: "uncommon",
            desc: (c) => `Deal <b>${dv(14, c)}</b> damage. Power affects this <b>${v(c, "mult", 3)}×</b>.`,
            upg: { mult: 5 },
            play: (c, x) => {
                const bonus = (G.player.status.power || 0) * (v(c, "mult", 3) - 1);
                dealDamage(x.target, v(c, "dmg", 14) + bonus);
            },
        },
        recoilSlam: {
            name: "Recoil Slam", type: "attack", cost: 1, art: "🛡️", rarity: "uncommon",
            desc: () => `Deal damage equal to your current <b>Plating</b>.`,
            upg: { cost: 0 },
            play: (c, x) => dealDamage(x.target, G.player.block),
        },
        rivetStorm: {
            name: "Rivet Storm", type: "attack", cost: 1, art: "💥", rarity: "uncommon",
            desc: (c) => `Deal <b>2</b> damage <b>${v(c, "hits", 4)}</b> times. Exhaust.`,
            upg: { hits: 5 },
            exhaust: true,
            play: (c, x) => { const n = v(c, "hits", 4); for (let i = 0; i < n; i++) if (x.target.hp > 0) dealDamage(x.target, 2); },
        },
        hydraulicPress: {
            name: "Hydraulic Press", type: "attack", cost: 2, art: "🗜️", rarity: "uncommon",
            desc: (c) => `Deal <b>${dv(13, c)}</b> damage. Apply <b>${v(c, "jam", 1)}</b> Jammed & <b>${v(c, "exp", 1)}</b> Exposed.`,
            upg: { jam: 2, exp: 2 },
            play: (c, x) => {
                dealDamage(x.target, v(c, "dmg", 13));
                applyStatus(x.target, "jammed", v(c, "jam", 1));
                applyStatus(x.target, "exposed", v(c, "exp", 1));
            },
        },
        scrapArmor: {
            name: "Scrap Armor", type: "skill", cost: 1, art: "♻️", rarity: "uncommon",
            desc: (c) => `Exhaust all non-Attack cards in your hand. Gain <b>${v(c, "blk", 5)}</b> Plating each.`,
            upg: { blk: 7 },
            play: (c) => {
                G.hand.filter((h) => h.def.type !== "attack" && h !== c).forEach((h) => { exhaustCard(h); gainPlating(G.player, v(c, "blk", 5)); });
            },
        },
        pressureRelease: {
            name: "Pressure Release", type: "skill", cost: 0, art: "💨", rarity: "uncommon",
            desc: (c) => `Lose <b>3</b> HP. Gain <b>${v(c, "steam", 2)}</b> Steam.`,
            upg: { steam: 3 },
            play: (c) => { loseHP(G.player, 3); G.energy += v(c, "steam", 2); renderCombat(); },
        },
        overdrive: {
            name: "Overdrive", type: "power", cost: 1, art: "⚡", rarity: "uncommon",
            desc: (c) => `Gain <b>${v(c, "pow", 2)}</b> Power.`,
            upg: { pow: 3 },
            play: (c) => applyStatus(G.player, "power", v(c, "pow", 2)),
        },
        autoLoader: {
            name: "Auto-Loader", type: "power", cost: 1, art: "🔁", rarity: "uncommon",
            desc: (c) => `At the end of your turn, gain <b>${v(c, "metal", 3)}</b> Plating.`,
            upg: { metal: 4 },
            play: (c) => applyStatus(G.player, "platingGen", v(c, "metal", 3)),
        },
        coolantFlush: {
            name: "Coolant Flush", type: "skill", cost: 1, art: "❄️", rarity: "uncommon",
            desc: (c) => `Remove <b>6</b> Heat. Gain <b>${pv(6, c)}</b> Plating. Draw <b>1</b>.`,
            upg: { blk: 9 },
            play: (c) => { addHeat(-6); gainPlating(G.player, v(c, "blk", 6)); drawCards(1); },
        },
        deployWarTurret: {
            name: "Deploy: War Turret", type: "power", cost: 2, art: "🛰️", rarity: "uncommon",
            desc: (c) => `Deploy a Contraption that deals <b>${v(c, "amt", 5)}</b> damage to a random enemy each turn.`,
            upg: { amt: 7 },
            play: (c) => deployContraption({ name: "War Turret", art: "🛰️", kind: "attack", amount: v(c, "amt", 5) }),
        },

        /* ---------- Rare ---------- */
        wreckingBall: {
            name: "Wrecking Ball", type: "attack", cost: 3, art: "🏀", rarity: "rare",
            desc: (c) => `Deal <b>${dv(32, c)}</b> damage.`,
            upg: { dmg: 42 },
            play: (c, x) => dealDamage(x.target, v(c, "dmg", 32)),
        },
        juryRig: {
            name: "Jury-Rig", type: "skill", cost: 0, art: "🎛️", rarity: "rare",
            desc: (c) => `Lose <b>6</b> HP. Gain <b>2</b> Steam. Draw <b>${v(c, "draw", 3)}</b>. Exhaust.`,
            upg: { draw: 5 },
            exhaust: true,
            play: (c) => { loseHP(G.player, 6); G.energy += 2; drawCards(v(c, "draw", 3)); renderCombat(); },
        },
        perpetualMotion: {
            name: "Perpetual Motion", type: "power", cost: 3, art: "♾️", rarity: "rare",
            desc: (c) => `At the start of each turn, gain <b>${v(c, "pow", 2)}</b> Power.`,
            upg: { pow: 3 },
            play: (c) => applyStatus(G.player, "engine", v(c, "pow", 2)),
        },
        aegisProtocol: {
            name: "Aegis Protocol", type: "skill", cost: 2, art: "🏰", rarity: "rare",
            desc: (c) => `Gain <b>${pv(30, c)}</b> Plating. Exhaust.`,
            upg: { blk: 40 },
            exhaust: true,
            play: (c) => gainPlating(G.player, v(c, "blk", 30)),
        },
        redline: {
            name: "Redline", type: "skill", cost: 1, art: "📈", rarity: "rare",
            desc: () => `Double your Power. Exhaust.`,
            play: (c) => { const s = G.player.status.power || 0; if (s > 0) applyStatus(G.player, "power", s); },
        },
        acidBath: {
            name: "Acid Bath", type: "skill", cost: 1, art: "🧫", rarity: "rare",
            desc: (c) => `Apply <b>${v(c, "rust", 4)}</b> Rust to <b>ALL</b> enemies.`,
            upg: { rust: 6 },
            play: (c, x) => x.enemies.slice().forEach((e) => applyStatus(e, "rust", v(c, "rust", 4))),
        },

        /* ---------- Additional common ---------- */
        ricochet: {
            name: "Ricochet", type: "attack", cost: 1, art: "🔻", rarity: "common",
            desc: (c) => `Deal <b>${dv(4, c)}</b> damage to a random enemy <b>3</b> times.`,
            upg: { dmg: 5 },
            play: (c, x) => {
                for (let i = 0; i < 3; i++) {
                    const alive = G.enemies.filter((e) => e.hp > 0);
                    if (!alive.length) break;
                    dealDamage(pick(alive), v(c, "dmg", 4));
                }
            },
        },
        boltCutter: {
            name: "Bolt Cutter", type: "attack", cost: 1, art: "✂️", rarity: "common",
            desc: (c) => `Deal <b>${dv(7, c)}</b> damage. If the target is Rusted, deal <b>${v(c, "bonus", 5)}</b> more.`,
            upg: { dmg: 9, bonus: 7 },
            play: (c, x) => dealDamage(x.target, v(c, "dmg", 7) + (x.target && x.target.status.rust ? v(c, "bonus", 5) : 0)),
        },
        tuneUp: {
            name: "Tune-Up", type: "skill", cost: 0, art: "🔧", rarity: "common",
            desc: (c) => `Gain <b>${pv(4, c)}</b> Plating.`,
            upg: { blk: 6 },
            play: (c) => gainPlating(G.player, v(c, "blk", 4)),
        },

        /* ---------- Additional uncommon ---------- */
        steamCannon: {
            name: "Steam Cannon", type: "attack", cost: 2, art: "💣", rarity: "uncommon",
            desc: (c) => `Deal <b>${dv(12, c)}</b> damage. Gain <b>3</b> Heat.`,
            upg: { dmg: 16 },
            play: (c, x) => { dealDamage(x.target, v(c, "dmg", 12)); addHeat(3); },
        },
        reactivePlating: {
            name: "Reactive Plating", type: "power", cost: 1, art: "🧷", rarity: "uncommon",
            desc: (c) => `Whenever you take unblocked damage, gain <b>${v(c, "amt", 2)}</b> Plating.`,
            upg: { amt: 3 },
            play: (c) => applyStatus(G.player, "reactive", v(c, "amt", 2)),
        },
        flakBurst: {
            name: "Flak Burst", type: "attack", cost: 1, art: "🎆", rarity: "uncommon",
            desc: (c) => `Deal <b>${dv(6, c)}</b> damage to a target and apply <b>1</b> Exposed to <b>ALL</b> enemies.`,
            upg: { dmg: 8 },
            play: (c, x) => { dealDamage(x.target, v(c, "dmg", 6)); x.enemies.slice().forEach((e) => applyStatus(e, "exposed", 1)); },
        },
        corrode: {
            name: "Corrode", type: "skill", cost: 1, art: "🫧", rarity: "uncommon",
            desc: (c) => `Apply <b>${v(c, "rust", 3)}</b> Rust to <b>ALL</b> enemies.`,
            upg: { rust: 5 },
            play: (c, x) => x.enemies.slice().forEach((e) => applyStatus(e, "rust", v(c, "rust", 3))),
        },
        nanobots: {
            name: "Nanobots", type: "skill", cost: 1, art: "🔬", rarity: "uncommon",
            desc: (c) => `Gain <b>${v(c, "prec", 3)}</b> Precision. Draw <b>1</b> card.`,
            upg: { prec: 4 },
            play: (c) => { applyStatus(G.player, "precision", v(c, "prec", 3)); drawCards(1); },
        },

        /* ---------- Additional rare ---------- */
        meltdown: {
            name: "Meltdown", type: "attack", cost: 2, art: "☢️", rarity: "rare",
            desc: (c) => `Deal <b>${dv(8, c)}</b> damage, plus <b>4</b> for each Contraption you control.`,
            upg: { dmg: 12 },
            play: (c, x) => dealDamage(x.target, v(c, "dmg", 8) + 4 * G.contraptions.length),
        },
        reactor: {
            name: "Reactor", type: "power", cost: 2, art: "🔆", rarity: "rare",
            desc: (c) => `At the start of each turn, gain <b>1</b> Steam.`,
            upg: { cost: 1 },
            play: (c) => applyStatus(G.player, "reactor", 1),
        },
        juggernaut: {
            name: "Juggernaut", type: "power", cost: 2, art: "🛞", rarity: "rare",
            desc: (c) => `Whenever you gain Plating, deal <b>${v(c, "amt", 3)}</b> damage to a random enemy.`,
            upg: { amt: 5 },
            play: (c) => applyStatus(G.player, "juggernaut", v(c, "amt", 3)),
        },

        /* ---------- The Bulwark — signature ---------- */
        bulwark: {
            name: "Bulwark", type: "skill", cost: 2, art: "🛡️", rarity: "special",
            desc: (c) => `Gain <b>${pv(12, c)}</b> Plating. Gain <b>${v(c, "recoil", 4)}</b> Recoil this combat.`,
            upg: { blk: 16, recoil: 6 },
            play: (c) => { gainPlating(G.player, v(c, "blk", 12)); applyStatus(G.player, "recoil", v(c, "recoil", 4)); },
        },

        /* ---------- The Overclocker — signature (Heat) ---------- */
        steamBlast: {
            name: "Steam Blast", type: "attack", cost: 1, art: "♨️", rarity: "special",
            desc: (c) => `Deal <b>${dv(7, c)}</b> damage. Gain <b>2</b> Heat.`,
            upg: { dmg: 10 },
            play: (c, x) => { dealDamage(x.target, v(c, "dmg", 7)); addHeat(2); },
        },
        overloadStrike: {
            name: "Overload Strike", type: "attack", cost: 1, art: "🔥", rarity: "special",
            desc: (c) => `Deal <b>${dv(6, c)}</b> damage <b>plus your Heat</b>, then lose all Heat.`,
            upg: { dmg: 9 },
            play: (c, x) => { const h = G.heat; dealDamage(x.target, v(c, "dmg", 6) + h); addHeat(-h); },
        },
        ventSteam: {
            name: "Vent Steam", type: "skill", cost: 1, art: "🌫️", rarity: "special",
            desc: (c) => `Lose <b>3</b> Heat. Gain <b>${pv(9, c)}</b> Plating.`,
            upg: { blk: 12 },
            play: (c) => { addHeat(-3); gainPlating(G.player, v(c, "blk", 9)); },
        },

        /* ---------- The Artificer — signature (Contraptions) ---------- */
        deployTurret: {
            name: "Deploy: Turret", type: "power", cost: 1, art: "🔭", rarity: "special",
            desc: (c) => `Deploy a Contraption dealing <b>${v(c, "amt", 3)}</b> damage to a random enemy each turn.`,
            upg: { amt: 5 },
            play: (c) => deployContraption({ name: "Turret", art: "🔭", kind: "attack", amount: v(c, "amt", 3) }),
        },
        deployCoil: {
            name: "Deploy: Coil", type: "power", cost: 1, art: "🧲", rarity: "special",
            desc: (c) => `Deploy a Contraption granting <b>${v(c, "amt", 4)}</b> Plating each turn.`,
            upg: { amt: 6 },
            play: (c) => deployContraption({ name: "Coil", art: "🧲", kind: "plating", amount: v(c, "amt", 4) }),
        },
    };

    // Reward pools by rarity (signature/special cards are NOT randomly offered)
    const POOL = {
        common: ["sawblade", "ratchetStrike", "twinRivets", "rivetGun", "scrapshot", "haymaker", "corrosiveSpray", "emergencyPatch", "wrenchToss", "kickstart", "ricochet", "boltCutter", "tuneUp"],
        uncommon: ["flywheel", "recoilSlam", "rivetStorm", "hydraulicPress", "scrapArmor", "pressureRelease", "overdrive", "autoLoader", "coolantFlush", "deployWarTurret", "steamCannon", "reactivePlating", "flakBurst", "corrode", "nanobots"],
        rare: ["wreckingBall", "juryRig", "perpetualMotion", "aegisProtocol", "redline", "acidBath", "meltdown", "reactor", "juggernaut"],
    };

    /* ============================================================
       COGS (relics)
       ============================================================ */
    const COGS = {
        furnaceHeart: { name: "Furnace Heart", art: "❤️‍🔥", desc: "At the end of combat, repair 6 HP.", onCombatEnd: () => healPlayer(6) },
        recoilPlating: { name: "Recoil Plating", art: "🛡️", desc: "When you take unblocked attack damage, deal 3 back.", thorns: 3 },
        overtunedSpring: { name: "Overtuned Spring", art: "🔧", desc: "At the start of each combat, gain 1 Power.", onCombatStart: () => applyStatus(G.player, "power", 1) },
        ballast: { name: "Ballast", art: "⚓", desc: "At the start of each combat, gain 10 Plating.", onCombatStart: () => gainPlating(G.player, 10) },
        preloader: { name: "Preloader", art: "🎒", desc: "At the start of each combat, draw 2 extra cards.", onFirstTurn: () => drawCards(2) },
        oilCan: { name: "Oil Can", art: "🛢️", desc: "Raise your Max HP by 8.", onPickup: () => { G.player.maxHp += 8; healPlayer(8); } },
        gyroscope: { name: "Gyroscope", art: "🧭", desc: "At the start of Warden & Core fights, repair 25 HP.", onCombatStart: (k) => { if (k === "elite" || k === "guardian" || k === "boss") healPlayer(25); } },
        steamCore: { name: "Steam Core", art: "🔋", desc: "Gain 1 additional Steam at the start of each turn.", energy: 1 },
        sparkPlug: { name: "Spark Plug", art: "🔌", desc: "Gain 1 Steam on the first turn of each combat.", onFirstTurn: () => { G.energy += 1; } },
        pressureGauge: { name: "Pressure Gauge", art: "🌡️", desc: "At the start of each turn, if your Heat is 8+, vent 3 Heat.", onTurnStart: () => { if (G.usesHeat && G.heat >= 8) addHeat(-3); } },
        toolkit: { name: "Toolkit", art: "🧰", desc: "At the start of each combat, deploy a Turret (3 dmg/turn).", onCombatStart: () => deployContraption({ name: "Turret", art: "🔭", kind: "attack", amount: 3 }) },
        reinforcedChassis: { name: "Reinforced Chassis", art: "🦿", desc: "At the start of each combat, gain 3 Precision.", onCombatStart: () => applyStatus(G.player, "precision", 3) },
        scrapMagnet: { name: "Scrap Magnet", art: "🧲", desc: "Gain 30% more scrap from combats.", scrapMult: 1.3 },
        rustCoating: { name: "Rust Coating", art: "🦠", desc: "Your attacks apply 1 Rust.", rustOnHit: 1 },
        counterweight: { name: "Counterweight", art: "⚖️", desc: "The first time you take unblocked damage each combat, gain 8 Plating." },
        recycler: { name: "Recycler", art: "♻️", desc: "Whenever a card is Exhausted, gain 2 Plating.", onExhaust: () => { if (G.inCombat) gainPlating(G.player, 2); } },
        coolingFins: { name: "Cooling Fins", art: "❄️", desc: "Your Overheat threshold is 4 higher.", onPickup: () => { if (G.usesHeat) G.maxHeat += 4; } },
        ablativeArmor: { name: "Ablative Armor", art: "🧱", desc: "Retain 25% of your Plating each turn.", onPickup: () => { G.platingRetain = Math.max(G.platingRetain || 0, 0.25); } },
    };
    const COG_POOL = ["recoilPlating", "overtunedSpring", "ballast", "preloader", "oilCan", "gyroscope", "steamCore", "sparkPlug", "pressureGauge", "toolkit", "reinforcedChassis", "scrapMagnet", "rustCoating", "counterweight", "recycler", "coolingFins", "ablativeArmor"];

    /* ============================================================
       CHARACTERS
       ============================================================ */
    const CHARACTERS = {
        bulwark: {
            name: "The Bulwark", emoji: "🛡️", sprite: "🤖",
            desc: "82 HP. Retains HALF its Plating each turn and hits back with Recoil. A fortress that turns defense into damage.",
            maxHp: 82, cog: "recoilPlating", platingRetain: 0.5, usesHeat: false,
            deck: ["pistonPunch", "pistonPunch", "pistonPunch", "pistonPunch", "reinforce", "reinforce", "reinforce", "reinforce", "recoilSlam", "bulwark"],
            hint: "Signature: keep Plating stacking, then unload with Recoil Slam.",
        },
        overclocker: {
            name: "The Overclocker", emoji: "🔥", sprite: "🦿",
            desc: "68 HP. Builds Heat with every blast. Spend it for devastating hits — but let it hit 10 and you'll overheat and burn.",
            maxHp: 68, cog: "pressureGauge", platingRetain: 0, usesHeat: true, maxHeat: 10, overheatDmg: 6,
            deck: ["steamBlast", "steamBlast", "steamBlast", "pistonPunch", "reinforce", "reinforce", "reinforce", "ventSteam", "overloadStrike", "overloadStrike"],
            hint: "Signature: bank Heat with Steam Blast, cash it in with Overload Strike before you overheat.",
        },
        artificer: {
            name: "The Artificer", emoji: "🔧", sprite: "🛸",
            desc: "74 HP. Deploys Contraptions that fight for you every turn. Build a machine that wins on its own.",
            maxHp: 74, cog: "toolkit", platingRetain: 0, usesHeat: false,
            deck: ["pistonPunch", "pistonPunch", "pistonPunch", "reinforce", "reinforce", "reinforce", "rivetGun", "deployTurret", "deployCoil", "deployTurret"],
            hint: "Signature: deploy Turrets & Coils early; they act automatically each turn.",
        },
    };

    /* ============================================================
       ENEMIES — a clockwork bestiary
       move.type: attack | block | buff | debuff | attackBlock | attackDebuff
       ============================================================ */
    const ENEMIES = {
        cogSentry: {
            name: "Cog Sentry", sprite: "🤖", hp: [42, 46],
            moves: [
                { name: "Ram", type: "attack", dmg: 11 },
                { name: "Brace", type: "attackBlock", dmg: 7, block: 5 },
                { name: "Wind Up", type: "buff", power: 3, block: 6 },
            ],
            ai: (s, t) => (t === 0 ? 0 : pick([1, 1, 2])),
        },
        sparrowDrone: {
            name: "Sparrow Drone", sprite: "🛸", hp: [45, 50],
            moves: [
                { name: "Spin Up", type: "buff", ritual: 3 },
                { name: "Zap", type: "attack", dmg: 6 },
            ],
            ai: (s, t) => (t === 0 ? 0 : 1),
        },
        rustMite: {
            name: "Rust Mite", sprite: "🐜", hp: [10, 15],
            moves: [
                { name: "Nip", type: "attackDebuff", dmg: 5, rust: 1 },
                { name: "Skitter", type: "buff", power: 3 },
            ],
            ai: (s, t) => pick([0, 0, 1]),
        },
        acidSprayer: {
            name: "Acid Sprayer", sprite: "🟢", hp: [28, 32],
            moves: [
                { name: "Spray", type: "attackDebuff", dmg: 7, jam: 1 },
                { name: "Hiss", type: "debuff", jam: 1 },
                { name: "Slam", type: "attack", dmg: 10 },
            ],
            ai: (s, t) => pick([0, 2, 2, 1]),
        },
        furnaceImp: {
            name: "Furnace Imp", sprite: "🔥", hp: [22, 28],
            moves: [
                { name: "Ember", type: "attackDebuff", dmg: 6, rust: 2 },
                { name: "Stoke", type: "buff", power: 4 },
            ],
            ai: (s, t) => pick([0, 0, 1]),
        },
        boltHound: {
            name: "Bolt Hound", sprite: "🐕", hp: [30, 34],
            moves: [
                { name: "Pounce", type: "attack", dmg: 8 },
                { name: "Snarl", type: "attackDebuff", dmg: 5, jam: 1 },
            ],
            ai: (s, t) => pick([0, 0, 1]),
        },
        // Elites (Wardens)
        theForeman: {
            name: "The Foreman", sprite: "👷", hp: [82, 86], elite: true,
            moves: [
                { name: "Bellow", type: "buff", power: 3 },
                { name: "Sledge", type: "attack", dmg: 14 },
                { name: "Rivet Barrage", type: "attackDebuff", dmg: 6, exp: 2 },
            ],
            ai: (s, t) => (t === 0 ? 0 : pick([1, 1, 2])),
        },
        wardenUnit: {
            name: "Warden Unit", sprite: "🦾", hp: [68, 72], elite: true,
            moves: [
                { name: "Beam", type: "attack", dmg: 9 },
                { name: "Suppress", type: "attackDebuff", dmg: 7, jam: 2 },
                { name: "Fortify", type: "block", block: 12 },
            ],
            ai: (s, t) => pick([0, 1, 2]),
        },
        /* ---- Act 2: The Gearworks (mid-tier) ---- */
        pistonGolem: {
            name: "Piston Golem", sprite: "🗿", hp: [46, 52],
            moves: [
                { name: "Stomp", type: "attack", dmg: 14 },
                { name: "Guard", type: "attackBlock", dmg: 8, block: 10 },
                { name: "Wind Up", type: "buff", power: 4, block: 8 },
            ],
            ai: (s, t) => (t === 0 ? 0 : pick([1, 2, 0])),
        },
        teslaTurret: {
            name: "Tesla Turret", sprite: "🗼", hp: [36, 42],
            moves: [
                { name: "Arc", type: "attackDebuff", dmg: 9, jam: 1 },
                { name: "Overcharge", type: "buff", power: 3 },
                { name: "Discharge", type: "attackDebuff", dmg: 12, exp: 1 },
            ],
            ai: (s, t) => pick([0, 0, 1, 2]),
        },
        scrapHound: {
            name: "Scrap Hound", sprite: "🐺", hp: [34, 38],
            moves: [
                { name: "Lunge", type: "attack", dmg: 12 },
                { name: "Howl", type: "buff", power: 4 },
            ],
            ai: (s, t) => pick([0, 0, 1]),
        },
        moltenSlug: {
            name: "Molten Slug", sprite: "🫠", hp: [40, 46],
            moves: [
                { name: "Splash", type: "attackDebuff", dmg: 8, rust: 3 },
                { name: "Ooze", type: "debuff", rust: 2 },
                { name: "Bash", type: "attack", dmg: 11 },
            ],
            ai: (s, t) => pick([0, 2, 2, 1]),
        },
        drillWarden: {
            name: "Drill Warden", sprite: "🦿", hp: [92, 98], elite: true,
            moves: [
                { name: "Drill", type: "attackDebuff", dmg: 9, exp: 2 },
                { name: "Reinforce", type: "block", block: 16 },
                { name: "Rampage", type: "attack", dmg: 16 },
                { name: "Rev", type: "buff", power: 4 },
            ],
            ai: (s, t) => (t === 0 ? 3 : pick([0, 2, 1])),
        },
        /* ---- Act 3: The Core Sanctum (hard) ---- */
        coreSentinel: {
            name: "Core Sentinel", sprite: "🛡️", hp: [52, 58],
            moves: [
                { name: "Purge", type: "attack", dmg: 16 },
                { name: "Bulwark", type: "block", block: 16 },
                { name: "Smite", type: "attackDebuff", dmg: 10, exp: 2 },
            ],
            ai: (s, t) => pick([0, 0, 1, 2]),
        },
        plasmaWraith: {
            name: "Plasma Wraith", sprite: "👻", hp: [44, 48],
            moves: [
                { name: "Drain", type: "attack", dmg: 13 },
                { name: "Phase", type: "block", block: 14 },
                { name: "Wail", type: "debuff", jam: 2, rust: 2 },
            ],
            ai: (s, t) => pick([0, 0, 1, 2]),
        },
        sawConstruct: {
            name: "Saw Construct", sprite: "⚙️", hp: [48, 54],
            moves: [
                { name: "Spin", type: "attackDebuff", dmg: 13, jam: 1 },
                { name: "Sharpen", type: "buff", power: 5 },
                { name: "Whirl", type: "attack", dmg: 9 },
            ],
            ai: (s, t) => pick([0, 2, 1]),
        },
        arcWarden: {
            name: "Arc Warden", sprite: "🤖", hp: [100, 106], elite: true,
            moves: [
                { name: "Beam", type: "attack", dmg: 13 },
                { name: "Chain", type: "attackDebuff", dmg: 8, jam: 2 },
                { name: "Barrier", type: "block", block: 18 },
                { name: "Surge", type: "buff", power: 5 },
            ],
            ai: (s, t) => (t === 0 ? 3 : pick([0, 1, 2])),
        },
        // Sector guardians (gate mini-bosses)
        theAssembler: {
            name: "The Assembler", sprite: "🏭", hp: [110, 116], guardian: true,
            moves: [
                { name: "Assemble", type: "buff", power: 3, block: 10 },
                { name: "Sweep", type: "attack", dmg: 18 },
                { name: "Rivet Storm", type: "attackDebuff", dmg: 7, exp: 2 },
                { name: "Fortify", type: "block", block: 20 },
            ],
            ai: (s, t) => (t === 0 ? 0 : pick([1, 1, 2, 3])),
        },
        grindmaw: {
            name: "Gate Warden Grindmaw", sprite: "🦿", hp: [96, 100], guardian: true,
            moves: [
                { name: "Grind", type: "attackDebuff", dmg: 9, rust: 2 },
                { name: "Lockdown", type: "block", block: 16 },
                { name: "Crush", type: "attack", dmg: 16 },
                { name: "Rev Up", type: "buff", power: 3 },
            ],
            ai: (s, t) => (t === 0 ? 3 : pick([0, 2, 1])),
        },
        furnaceColossus: {
            name: "Furnace Colossus", sprite: "🗿", hp: [118, 122], guardian: true,
            moves: [
                { name: "Magma Fist", type: "attack", dmg: 20 },
                { name: "Heat Shield", type: "block", block: 18 },
                { name: "Cinder Spray", type: "attackDebuff", dmg: 8, rust: 3 },
                { name: "Ignite", type: "buff", power: 4 },
            ],
            ai: (s, t) => (t === 0 ? 3 : pick([0, 0, 2, 1])),
        },
        // Final boss
        aurumCore: {
            name: "The Aurum Core", sprite: "⚙️", hp: [155, 155], boss: true,
            moves: [
                { name: "Piston Barrage", type: "attack", dmg: 20 },
                { name: "Harden", type: "block", block: 20 },
                { name: "Seismic Gear", type: "attackDebuff", dmg: 11, exp: 2 },
                { name: "Overclock", type: "buff", power: 4, block: 8 },
            ],
            ai: (s, t) => (t === 0 ? 3 : pick([0, 0, 2, 1])),
        },
    };

    // Each act has its own bestiary, elites, and gate guardian, so the three
    // sectors escalate and feel distinct. The final act's gate is the Core boss.
    const ACTS = [
        {
            name: "The Foundry", cols: 4, hardChance: 0.25,
            easy: [["cogSentry"], ["sparrowDrone"], ["rustMite", "rustMite"], ["acidSprayer"], ["furnaceImp", "furnaceImp"], ["boltHound"]],
            hard: [["cogSentry", "sparrowDrone"], ["acidSprayer", "furnaceImp"], ["boltHound", "boltHound"], ["cogSentry", "rustMite", "rustMite"]],
            elites: [["theForeman"], ["wardenUnit", "wardenUnit"]],
            guardians: [["grindmaw"]],
        },
        {
            name: "The Gearworks", cols: 4, hardChance: 0.5,
            easy: [["pistonGolem"], ["teslaTurret"], ["scrapHound", "scrapHound"], ["moltenSlug"], ["teslaTurret", "furnaceImp"]],
            hard: [["pistonGolem", "teslaTurret"], ["scrapHound", "moltenSlug"], ["pistonGolem", "rustMite", "rustMite"], ["teslaTurret", "teslaTurret"]],
            elites: [["drillWarden"], ["theForeman", "wardenUnit"]],
            guardians: [["furnaceColossus"], ["theAssembler"]],
        },
        {
            name: "The Core Sanctum", cols: 4, hardChance: 0.6,
            easy: [["coreSentinel"], ["plasmaWraith"], ["sawConstruct"], ["plasmaWraith", "teslaTurret"]],
            hard: [["coreSentinel", "plasmaWraith"], ["sawConstruct", "sawConstruct"], ["coreSentinel", "teslaTurret"], ["plasmaWraith", "plasmaWraith"]],
            elites: [["arcWarden"], ["drillWarden", "teslaTurret"]],
            guardians: [["aurumCore"]], // final gate = the Core boss
        },
    ];
    function pickEncounter(sector) {
        const act = ACTS[sector] || ACTS[0];
        const pool = Math.random() < act.hardChance ? act.hard : act.easy;
        return pick(pool);
    }

    /* ============================================================
       GLOBAL RUN STATE
       ============================================================ */
    let G = null;

    function newGame(charKey, ascension) {
        const ch = CHARACTERS[charKey];
        G = {
            char: charKey,
            ascension: ascension || 0,
            player: {
                name: ch.name, sprite: ch.sprite,
                hp: ch.maxHp, maxHp: ch.maxHp,
                block: 0, status: {}, isPlayer: true,
            },
            platingRetain: ch.platingRetain || 0,
            usesHeat: !!ch.usesHeat, maxHeat: ch.maxHeat || 10, overheatDmg: ch.overheatDmg || 6,
            heat: 0, contraptions: [],
            deck: ch.deck.map((k) => makeCard(k, false)),
            cogs: [ch.cog],
            gold: 99,
            floor: 0,
            map: null,
            hand: [], drawPile: [], discard: [], exhaust: [],
            enemies: [], energy: 0, maxEnergy: 3, turn: 0,
            selectedCard: null, inCombat: false, currentNode: null,
        };
        const r = COGS[ch.cog];
        if (r.onPickup) r.onPickup();
        STATS.runs = (STATS.runs || 0) + 1;
        saveStats();
        generateMap();
        showMap();
        $("#topbar").classList.remove("hidden");
        updateTopbar();
    }

    function makeCard(key, upgraded) {
        return { id: uid(), key, def: CARDS[key], upgraded: !!upgraded };
    }

    /* value resolution for upgrades */
    function v(card, prop, base) {
        if (card.upgraded && card.def.upg && card.def.upg[prop] != null) return card.def.upg[prop];
        return base;
    }
    function cardCost(card) {
        if (card.upgraded && card.def.upg && card.def.upg.cost != null) return card.def.upg.cost;
        return card.def.cost;
    }
    function dv(base, card) { return card.upgraded && card.def.upg && card.def.upg.dmg != null ? card.def.upg.dmg : base; }
    function pv(base, card) { return card.upgraded && card.def.upg && card.def.upg.blk != null ? card.def.upg.blk : base; }

    /* ============================================================
       MAP — horizontal sectors with forced guardian gates
       ============================================================ */
    function generateMap() {
        // Build a list of columns left→right. Each sector is `cols` normal
        // columns followed by a full-height gate (guardian) — except the last
        // sector, which ends in the Core (boss). Gates funnel every path.
        const columns = [];
        ACTS.forEach((sec, si) => {
            for (let c = 0; c < sec.cols; c++) {
                const count = c === 0 && si === 0 ? 3 : 2 + rnd(3); // 2-4 lanes
                const nodes = [];
                for (let i = 0; i < count; i++) {
                    nodes.push(mkNode(nodeType(si, c, sec.cols), columns.length, i, count, si));
                }
                columns.push({ kind: "normal", sector: si, nodes });
            }
            // gate at the end of the sector
            const isLast = si === ACTS.length - 1;
            const gate = mkNode(isLast ? "core" : "guardian", columns.length, 0, 1, si);
            columns.push({ kind: "gate", sector: si, nodes: [gate] });
        });

        // connect columns
        for (let c = 0; c < columns.length - 1; c++) {
            const cur = columns[c].nodes, nxt = columns[c + 1].nodes;
            cur.forEach((node, i) => {
                if (nxt.length === 1) { node.next.push(nxt[0]); return; } // funnel into gate
                const center = Math.round((i / Math.max(1, cur.length - 1)) * (nxt.length - 1));
                const targets = new Set();
                const links = 1 + rnd(2);
                for (let l = 0; l < links; l++) targets.add(clamp(center + (rnd(3) - 1), 0, nxt.length - 1));
                targets.forEach((t) => node.next.push(nxt[t]));
            });
            // ensure every next node has a parent
            nxt.forEach((n, ni) => {
                if (!cur.some((cc) => cc.next.includes(n))) {
                    let best = 0, bd = 1e9;
                    cur.forEach((cc, ci) => { const d = Math.abs(ci / cur.length - ni / nxt.length); if (d < bd) { bd = d; best = ci; } });
                    cur[best].next.push(n);
                }
            });
        }

        G.map = { columns };
        columns[0].nodes.forEach((n) => (n.reachable = true));
    }

    function mkNode(type, col, idx, count, sector) {
        return { type, col, idx, count, sector: sector || 0, x: 0, y: 0, next: [], visited: false, reachable: false };
    }

    function nodeType(sectorIdx, col, secCols) {
        if (sectorIdx === 0 && col === 0) return "sentinel";
        if (col === secCols - 1) return "repair"; // repair bay right before each gate
        const roll = Math.random();
        if (col >= 1 && roll < 0.16) return "warden";
        if (roll < 0.1) return "repair";
        if (roll < 0.2) return "vault";
        if (roll < 0.32) return "market";
        if (roll < 0.44) return "anomaly";
        return "sentinel";
    }

    const NODE_ICON = {
        sentinel: "⚔️", warden: "💀", repair: "🔧", vault: "💰",
        market: "🏪", anomaly: "❓", guardian: "🦿", core: "⚙️",
    };
    const NODE_LABEL = {
        sentinel: "Sentinel", warden: "Warden", repair: "Repair Bay", vault: "Vault",
        market: "Black Market", anomaly: "Anomaly", guardian: "Sector Guardian", core: "The Aurum Core",
    };
    const NODE_DESC = {
        sentinel: "A machine patrol. Rewards scrap (gold) + a card.",
        warden: "A tough elite. Drops a Cog.",
        repair: "Repair 30% HP or modify (upgrade) a card.",
        vault: "A free Cog.",
        market: "Spend scrap on cards & Cogs.",
        anomaly: "A malfunction — could help or harm.",
        guardian: "A gate mini-boss. Beat it to enter the next sector.",
        core: "The dead god's heart. Defeat it to win.",
    };

    /* ============================================================
       SCREENS
       ============================================================ */
    function hideAllScreens() {
        ["#title-screen", "#map-screen", "#combat-screen"].forEach((s) => $(s).classList.add("hidden"));
    }
    function showMap() {
        hideAllScreens();
        $("#map-screen").classList.remove("hidden");
        renderMap();
        saveRun();
    }

    function renderMap() {
        const inner = $("#map-inner");
        inner.innerHTML = "";
        const colGap = 116, rowGap = 74;
        const cols = G.map.columns;
        const maxLanes = Math.max(...cols.map((c) => c.nodes.length), 3);
        const width = cols.length * colGap + 80;
        const height = Math.max(360, maxLanes * rowGap + 60);
        inner.style.width = width + "px";
        inner.style.height = height + "px";

        cols.forEach((col, ci) => {
            const x = 50 + ci * colGap;
            const n = col.nodes.length;
            const spread = (n - 1) * rowGap;
            col.nodes.forEach((node, i) => {
                node.x = x;
                node.y = height / 2 - spread / 2 + i * rowGap;
            });
        });

        // sector band labels
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "map-svg");
        svg.setAttribute("width", width);
        svg.setAttribute("height", height);
        cols.forEach((col) => {
            col.nodes.forEach((node) => {
                node.next.forEach((nx) => {
                    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                    line.setAttribute("x1", node.x); line.setAttribute("y1", node.y);
                    line.setAttribute("x2", nx.x); line.setAttribute("y2", nx.y);
                    const active = node.visited && nx.reachable;
                    line.setAttribute("stroke", active ? "#d4af37" : "#5a4d33");
                    line.setAttribute("stroke-width", active ? 3 : 2);
                    line.setAttribute("stroke-dasharray", active ? "0" : "5,6");
                    svg.appendChild(line);
                });
            });
        });
        inner.appendChild(svg);

        cols.forEach((col) => {
            col.nodes.forEach((node) => {
                const d = el("div", "map-node" + (col.kind === "gate" ? " gate" : ""), NODE_ICON[node.type]);
                d.style.left = node.x + "px";
                d.style.top = node.y + "px";
                if (node.visited) d.classList.add("visited");
                if (node === G.currentNode) d.classList.add("current");
                if (node.reachable && !node.visited) { d.classList.add("reachable"); d.onclick = () => enterNode(node); }
                attachTip(d, `<b>${NODE_LABEL[node.type]}</b><br>${NODE_DESC[node.type]}`);
                inner.appendChild(d);
            });
        });

        // scroll so the current/left edge is visible
        const sc = $("#map-scroll");
        if (G.currentNode) sc.scrollLeft = clamp(G.currentNode.x - sc.clientWidth / 2, 0, width);
        else sc.scrollLeft = 0;
    }

    function enterNode(node) {
        G.map.columns.forEach((col) => col.nodes.forEach((n) => (n.reachable = false)));
        node.visited = true;
        G.currentNode = node;
        node.next.forEach((n) => (n.reachable = true));
        G.floor++;
        updateTopbar();

        const sector = node.sector || 0;
        switch (node.type) {
            case "sentinel": startCombat(pickEncounter(sector), "monster"); break;
            case "warden": startCombat(pick(ACTS[sector].elites), "elite"); break;
            case "guardian": startCombat(pick(ACTS[sector].guardians), "guardian"); break;
            case "core": startCombat(["aurumCore"], "boss"); break;
            case "repair": repairBay(); break;
            case "vault": vaultRoom(); break;
            case "market": marketRoom(); break;
            case "anomaly": anomalyEvent(); break;
        }
    }

    /* ============================================================
       COMBAT
       ============================================================ */
    function startCombat(encounterKeys, kind) {
        hideAllScreens();
        $("#combat-screen").classList.remove("hidden");
        G.inCombat = true;
        G.combatKind = kind;
        G.turn = 0;
        G.player.block = 0;
        G.player.status = {};
        G.heat = 0;
        G.contraptions = [];
        G._counterUsed = false;
        G.enemies = encounterKeys.map((k) => spawnEnemy(k));
        G.hand = []; G.discard = []; G.exhaust = [];
        G.drawPile = shuffle(G.deck.map((c) => c));
        G.maxEnergy = 3;
        G.log = [];

        G.cogs.forEach((rk) => { const r = COGS[rk]; if (r.onCombatStart) r.onCombatStart(kind); });

        logMsg("⚙️ The machines stir. Combat begins!");
        startPlayerTurn(true);
    }

    function spawnEnemy(key) {
        const def = ENEMIES[key];
        const asc = G.ascension || 0;
        let hp = def.hp[0] + rnd(def.hp[1] - def.hp[0] + 1);
        hp = Math.round(hp * (1 + 0.05 * asc)); // Ascension: tougher enemies
        const dmgBonus = Math.floor(asc / 3);   // Ascension: harder hits
        return { key, def, name: def.name, sprite: def.sprite, hp, maxHp: hp, block: 0, status: {}, isPlayer: false, turnCount: 0, intent: null, _dmgBonus: dmgBonus };
    }

    function startPlayerTurn(first) {
        G.turn++;
        // plating retention (Bulwark keeps a fraction)
        G.player.block = Math.floor(G.player.block * (G.platingRetain || 0));
        // steam
        G.energy = G.maxEnergy;
        G.cogs.forEach((rk) => { if (COGS[rk].energy) G.energy += COGS[rk].energy; });
        if (G.player.status.reactor) G.energy += G.player.status.reactor; // Reactor power
        // engine powers (Perpetual Motion)
        if (G.player.status.engine) applyStatus(G.player, "power", G.player.status.engine, true);
        // cog turn-start hooks (e.g. Pressure Gauge venting)
        G.cogs.forEach((rk) => { if (COGS[rk].onTurnStart) COGS[rk].onTurnStart(); });
        // Rust ticks on the player at the start of their turn
        tickRust(G.player);
        if (G.player.hp <= 0) return;
        // Contraptions act
        triggerContraptions();
        if (G.enemies.every((e) => e.hp <= 0)) { renderCombat(); return winCombat(); }

        drawCards(5);
        if (first) G.cogs.forEach((rk) => { if (COGS[rk].onFirstTurn) COGS[rk].onFirstTurn(); });

        G.enemies.forEach((e) => setIntent(e));
        renderCombat();
    }

    function setIntent(enemy) {
        enemy.intent = enemy.def.moves[enemy.def.ai(enemy, enemy.turnCount)];
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

    /* ---------- Heat (Overclocker) ---------- */
    function addHeat(n) {
        if (!G.usesHeat) return;
        G.heat = Math.max(0, G.heat + n);
        renderCombat();
    }

    /* ---------- Contraptions (Artificer) ---------- */
    function deployContraption(c) {
        G.contraptions.push(c);
        if (G.inCombat) { logMsg(`Deployed <b>${c.name}</b>.`); renderCombat(); }
    }
    function triggerContraptions() {
        G.contraptions.forEach((c) => {
            if (c.kind === "attack") {
                const alive = G.enemies.filter((e) => e.hp > 0);
                if (alive.length) { const t = pick(alive); dealDamage(t, c.amount); logMsg(`${c.art} ${c.name} hits ${t.name} for ${c.amount}.`); }
            } else if (c.kind === "plating") {
                gainPlating(G.player, c.amount);
            } else if (c.kind === "power") {
                applyStatus(G.player, "power", c.amount, true);
            } else if (c.kind === "heat") {
                addHeat(c.amount);
            }
        });
        cleanupDeadEnemies();
    }

    /* ---------- damage & status math ---------- */
    function attackDamage(attacker, base) {
        let dmg = base + (attacker.status.power || 0) + (attacker._dmgBonus || 0);
        if (attacker.status.jammed) dmg = Math.floor(dmg * 0.75);
        return Math.max(0, dmg);
    }
    function incomingDamage(target, dmg) {
        if (target.status.exposed) dmg = Math.floor(dmg * 1.5);
        return dmg;
    }
    function dealDamage(target, base) {
        if (!target || target.hp <= 0) return;
        let dmg = incomingDamage(target, attackDamage(G.player, base));
        applyDamageToCombatant(target, dmg, true);
        // Rust Coating cog: your attacks apply Rust
        if (target.hp > 0) {
            let rust = 0;
            G.cogs.forEach((rk) => { if (COGS[rk].rustOnHit) rust += COGS[rk].rustOnHit; });
            if (rust > 0) applyStatus(target, "rust", rust, true);
        }
    }
    function applyDamageToCombatant(target, dmg, fromPlayer) {
        let remaining = dmg;
        if (target.block > 0) {
            const absorbed = Math.min(target.block, remaining);
            target.block -= absorbed; remaining -= absorbed;
        }
        if (remaining > 0) {
            target.hp = Math.max(0, target.hp - remaining);
            floatText(target, "-" + remaining, "dmg");
            shakeSprite(target);
            if (target.isPlayer && fromPlayer === false) {
                // Recoil / thorns strike attackers back
                let thorns = 0;
                G.cogs.forEach((rk) => { if (COGS[rk].thorns) thorns += COGS[rk].thorns; });
                thorns += G.player.status.recoil || 0;
                if (thorns > 0 && G._currentAttacker && G._currentAttacker.hp > 0) {
                    applyDamageToCombatant(G._currentAttacker, thorns, true);
                    floatText(G._currentAttacker, "⚡" + thorns, "dmg");
                }
                // Counterweight cog: first unblocked hit each combat grants Plating
                if (hasCog("counterweight") && !G._counterUsed) { G._counterUsed = true; gainPlating(G.player, 8); }
                // Reactive Plating power
                if (G.player.status.reactive) gainPlating(G.player, G.player.status.reactive);
            }
        } else {
            floatText(target, "Blocked", "block");
        }
        if (target.hp <= 0 && !target.isPlayer) onEnemyDeath(target);
        if (target.isPlayer && target.hp <= 0) checkPlayerDeath();
    }
    function hasCog(k) { return G && G.cogs && G.cogs.includes(k); }

    function gainPlating(who, amount) {
        let a = amount + (who.status.precision || 0);
        a = Math.max(0, a);
        who.block += a;
        floatText(who, "+" + a + "🛡️", "block");
        // Juggernaut power: gaining Plating deals damage to a random enemy
        if (who.isPlayer && a > 0 && G.player.status.juggernaut) {
            const alive = G.enemies.filter((e) => e.hp > 0);
            if (alive.length) applyDamageToCombatant(pick(alive), G.player.status.juggernaut, true);
        }
    }
    function healPlayer(n) {
        if (!G || !G.player) return;
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

    // Rust: damage over time, ignores Plating, then decays by 1.
    function tickRust(who) {
        const r = who.status.rust;
        if (!r) return;
        who.hp = Math.max(0, who.hp - r);
        floatText(who, "-" + r + "🦠", "dmg");
        who.status.rust = r - 1;
        if (who.status.rust <= 0) delete who.status.rust;
        if (who.hp <= 0 && !who.isPlayer) onEnemyDeath(who);
        if (who.isPlayer && who.hp <= 0) checkPlayerDeath();
    }

    /* ---------- playing cards ---------- */
    const canPlay = (card) => G.energy >= cardCost(card);
    function isAllTarget(card) { return ["sawblade", "acidBath", "corrode", "ricochet"].includes(card.key); }

    function onCardClicked(card) {
        if (!canPlay(card)) return;
        const needsTarget = card.def.type === "attack" && !isAllTarget(card);
        if (needsTarget) {
            G.selectedCard = G.selectedCard === card ? null : card;
            renderCombat();
        } else {
            resolveCard(card, null);
        }
    }
    function onEnemyClicked(enemy) {
        if (!G.selectedCard || enemy.hp <= 0) return;
        const card = G.selectedCard; G.selectedCard = null;
        resolveCard(card, enemy);
    }
    function resolveCard(card, target) {
        if (!canPlay(card)) return;
        if (!target) target = G.enemies.find((e) => e.hp > 0);
        G.energy -= cardCost(card);
        const idx = G.hand.indexOf(card);
        if (idx >= 0) G.hand.splice(idx, 1);
        logMsg(`You play <b>${card.def.name}</b>${card.upgraded ? "+" : ""}.`);
        card.def.play(card, { target, enemies: G.enemies.filter((e) => e.hp > 0) });

        if (card.def.type === "power") { /* consumed */ }
        else if (card.def.exhaust) G.exhaust.push(card);
        else G.discard.push(card);

        cleanupDeadEnemies();
        renderCombat();
        if (G.enemies.every((e) => e.hp <= 0)) winCombat();
    }
    function exhaustCard(card) {
        const idx = G.hand.indexOf(card);
        if (idx >= 0) {
            G.hand.splice(idx, 1); G.exhaust.push(card);
            G.cogs.forEach((rk) => { if (COGS[rk].onExhaust) COGS[rk].onExhaust(); });
        }
    }

    function endTurn() {
        if (!G.inCombat) return;
        if (G.player.status.platingGen) gainPlating(G.player, G.player.status.platingGen);
        // Overheat penalty (Overclocker)
        if (G.usesHeat && G.heat >= G.maxHeat) {
            logMsg(`🔥 <b>Overheat!</b> You take ${G.overheatDmg} damage and vent all Heat.`);
            floatText(G.player, "OVERHEAT!", "dmg");
            G.heat = 0;
            loseHP(G.player, G.overheatDmg);
            if (G.player.hp <= 0) return;
        }
        G.discard.push(...G.hand);
        G.hand = [];
        G.selectedCard = null;
        tickStatusEndOfTurn(G.player);
        renderCombat();
        setTimeout(enemyTurn, T(350));
    }
    function tickStatusEndOfTurn(who) {
        ["jammed", "exposed"].forEach((k) => { if (who.status[k]) { who.status[k]--; if (who.status[k] <= 0) delete who.status[k]; } });
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
            setTimeout(step, T(520));
        };
        step();
    }
    function doEnemyMove(enemy) {
        // Rust ticks on the enemy at the start of its turn
        tickRust(enemy);
        if (enemy.hp <= 0) { renderCombat(); return; }
        enemy.block = 0;
        if (enemy.status.ritual) applyStatus(enemy, "power", enemy.status.ritual, true);
        const m = enemy.intent || enemy.def.moves[0];
        G._currentAttacker = enemy;
        const doAttack = (dmg) => {
            let d = incomingDamage(G.player, attackDamage(enemy, dmg));
            applyDamageToCombatant(G.player, d, false);
            updateTopbar();
        };
        switch (m.type) {
            case "attack": doAttack(m.dmg); logMsg(`${enemy.name} strikes for ${attackDamage(enemy, m.dmg)}.`); break;
            case "attackBlock": doAttack(m.dmg); enemy.block += m.block; break;
            case "attackDebuff":
                doAttack(m.dmg);
                if (m.jam) applyStatus(G.player, "jammed", m.jam, true);
                if (m.exp) applyStatus(G.player, "exposed", m.exp, true);
                if (m.rust) applyStatus(G.player, "rust", m.rust, true);
                break;
            case "block": enemy.block += m.block; logMsg(`${enemy.name} fortifies.`); break;
            case "buff":
                if (m.power) applyStatus(enemy, "power", m.power, true);
                if (m.block) enemy.block += m.block;
                if (m.ritual) applyStatus(enemy, "ritual", m.ritual, true);
                logMsg(`${enemy.name} powers up.`);
                break;
            case "debuff":
                if (m.jam) applyStatus(G.player, "jammed", m.jam, true);
                if (m.rust) applyStatus(G.player, "rust", m.rust, true);
                logMsg(`${enemy.name} sabotages you.`);
                break;
        }
        G._currentAttacker = null;
        enemy.turnCount++;
        if (G.player.hp <= 0) return;
    }

    function cleanupDeadEnemies() { G.enemies.forEach((e) => { if (e.hp < 0) e.hp = 0; }); }
    function onEnemyDeath(e) { floatText(e, "💥", "dmg"); }
    function checkPlayerDeath() {
        if (G.player.hp <= 0 && G.inCombat) { G.inCombat = false; setTimeout(gameOver, T(500)); }
    }

    /* ---------- rewards ---------- */
    function winCombat() {
        if (!G.inCombat) return;
        G.inCombat = false;
        G.cogs.forEach((rk) => { if (COGS[rk].onCombatEnd) COGS[rk].onCombatEnd(); });
        setTimeout(() => combatRewards(G.combatKind), T(400));
    }
    function combatRewards(kind) {
        let goldGain = kind === "boss" ? 100 + rnd(20) : (kind === "elite" || kind === "guardian") ? 30 + rnd(15) : 10 + rnd(11);
        let mult = 1;
        G.cogs.forEach((rk) => { if (COGS[rk].scrapMult) mult *= COGS[rk].scrapMult; });
        goldGain = Math.round(goldGain * mult);
        G.gold += goldGain;
        updateTopbar();
        const rewards = [
            { icon: "🪙", label: `<b class="gold">${goldGain} Scrap</b>`, claimed: true, info: true },
            { icon: "🃏", label: "Add a card to your deck", claimed: false, type: "card" },
        ];
        if (kind === "elite" || kind === "guardian" || kind === "boss") {
            const cogKey = randomCog();
            if (cogKey) rewards.push({ icon: COGS[cogKey].art, label: `<b>Cog:</b> ${COGS[cogKey].name} <span class="muted">— ${COGS[cogKey].desc}</span>`, claimed: false, type: "cog", cogKey });
        }
        renderRewardScreen(kind, rewards);
    }
    function renderRewardScreen(kind, rewards) {
        const isBoss = kind === "boss";
        openOverlay(`
            <h2>${isBoss ? "⚙️ The Core Falls!" : "Victory!"}</h2>
            <p class="muted">Claim your rewards, then continue.</p>
            <div class="reward-list" id="reward-list"></div>
            <button class="big-btn" id="reward-continue">${isBoss ? "🏆 You Win! Play Again" : "Continue ▶"}</button>
        `);
        const list = $("#reward-list");
        rewards.forEach((it) => {
            const row = el("div", "reward-item" + (it.claimed ? " taken" : ""), `<span class="r-icon">${it.icon}</span><span>${it.label}</span>`);
            if (!it.claimed && !it.info) {
                row.onclick = () => {
                    if (it.type === "card") showCardReward(kind, rewards, it);
                    else if (it.type === "cog") { addCog(it.cogKey); it.claimed = true; renderRewardScreen(kind, rewards); }
                };
            }
            list.appendChild(row);
        });
        $("#reward-continue").onclick = () => { closeOverlay(); isBoss ? winRun() : showMap(); };
    }
    function showCardReward(kind, rewards, rewardItem) {
        const choices = [];
        for (let i = 0; i < 3; i++) {
            const roll = Math.random() + (kind === "elite" || kind === "guardian" ? 0.15 : 0) + (kind === "boss" ? 0.3 : 0);
            const rarity = roll > 0.92 ? "rare" : roll > 0.62 ? "uncommon" : "common";
            let key, tries = 0;
            do { key = pick(POOL[rarity]); tries++; } while (choices.some((c) => c.key === key) && tries < 20);
            choices.push(makeCard(key, false));
        }
        const back = () => { rewardItem.claimed = true; renderRewardScreen(kind, rewards); };
        openOverlay(`<h2>Choose a card</h2><div class="card-choices" id="card-choices"></div><button class="pile-btn" id="skip-card">Skip</button>`);
        const cc = $("#card-choices");
        choices.forEach((card) => {
            const cel = renderCardEl(card);
            cel.classList.add("playable");
            cel.onclick = () => { G.deck.push(card); updateTopbar(); back(); };
            cc.appendChild(cel);
        });
        $("#skip-card").onclick = back;
    }

    function randomCog() {
        const owned = new Set(G.cogs);
        const avail = COG_POOL.filter((r) => !owned.has(r));
        return avail.length ? pick(avail) : null;
    }
    function addCog(key) {
        if (G.cogs.includes(key)) return;
        G.cogs.push(key);
        if (COGS[key].onPickup) COGS[key].onPickup();
        updateTopbar();
    }

    /* ============================================================
       NON-COMBAT ROOMS
       ============================================================ */
    function repairBay() {
        openOverlay(`
            <h2>🔧 Repair Bay</h2>
            <p class="muted">Patch yourself up or refine your gear.</p>
            <div class="reward-list">
                <div class="reward-item" id="rb-heal"><span class="r-icon">❤️</span><span>Repair — restore <b>${Math.floor(G.player.maxHp * 0.3)}</b> HP</span></div>
                <div class="reward-item" id="rb-upg"><span class="r-icon">⚒️</span><span>Modify — upgrade a card in your deck</span></div>
            </div>
        `);
        $("#rb-heal").onclick = () => { healPlayer(Math.floor(G.player.maxHp * 0.3)); closeOverlay(); showMap(); };
        $("#rb-upg").onclick = () => showUpgradeChooser();
    }
    function showUpgradeChooser() {
        const upgradable = G.deck.filter((c) => !c.upgraded && c.def.upg);
        if (!upgradable.length) {
            openOverlay(`<h2>Nothing to modify</h2><p class="muted">All your cards are already upgraded.</p><button class="big-btn" id="ok">OK</button>`);
            $("#ok").onclick = () => { closeOverlay(); showMap(); };
            return;
        }
        openOverlay(`<h2>Modify a card</h2><div class="grid-cards" id="upg-cards"></div>`);
        const wrap = $("#upg-cards");
        G.deck.forEach((card) => {
            const cel = renderCardEl(card);
            if (!card.upgraded && card.def.upg) { cel.classList.add("playable"); cel.onclick = () => { card.upgraded = true; closeOverlay(); showMap(); }; }
            else cel.classList.add("unplayable");
            wrap.appendChild(cel);
        });
    }
    function vaultRoom() {
        const cogKey = randomCog();
        if (!cogKey) {
            const g = 50 + rnd(50); G.gold += g; updateTopbar();
            openOverlay(`<h2>💰 Vault</h2><p>No new Cogs — you salvage <b class="gold">${g} scrap</b> instead.</p><button class="big-btn" id="ok">Take it</button>`);
            $("#ok").onclick = () => { closeOverlay(); showMap(); };
            return;
        }
        const r = COGS[cogKey];
        openOverlay(`
            <h2>💰 Vault</h2><p>You pry loose a Cog:</p>
            <div class="reward-item" style="justify-content:center; cursor:default; pointer-events:none;"><span class="r-icon">${r.art}</span><span><b>${r.name}</b> — ${r.desc}</span></div>
            <button class="big-btn" id="take-cog">Install Cog</button>
        `);
        $("#take-cog").onclick = () => { addCog(cogKey); closeOverlay(); showMap(); };
    }
    function marketRoom() {
        const cards = [];
        for (let i = 0; i < 4; i++) { const roll = Math.random(); const rarity = roll > 0.85 ? "rare" : roll > 0.5 ? "uncommon" : "common"; cards.push(makeCard(pick(POOL[rarity]), false)); }
        const cogKey = randomCog();
        const cardPrice = (c) => ({ common: 45, uncommon: 70, rare: 130, starter: 40, special: 60 }[c.def.rarity] || 50);

        openOverlay(`
            <h2>🏪 Black Market</h2>
            <p class="muted">Scrap: <span class="gold" id="shop-gold">${G.gold}</span></p>
            <div id="shop-cards"></div><div id="shop-cog"></div><div id="shop-remove"></div>
            <button class="big-btn" id="shop-leave">Leave Market</button>
        `);
        const cardsWrap = $("#shop-cards");
        cards.forEach((card) => {
            const price = cardPrice(card);
            const row = el("div", "shop-item");
            row.innerHTML = `<span>${card.def.art} <b>${card.def.name}</b> <span class="muted">(${card.def.type})</span></span>`;
            const btn = el("button", "buy-btn", `🪙 ${price}`);
            btn.disabled = G.gold < price;
            btn.onclick = () => { if (G.gold < price) return; G.gold -= price; G.deck.push(card); row.remove(); updateTopbar(); refreshShop(); };
            row.appendChild(btn); cardsWrap.appendChild(row);
        });
        if (cogKey) {
            const price = 150, r = COGS[cogKey];
            const row = el("div", "shop-item");
            row.innerHTML = `<span>${r.art} <b>${r.name}</b> <span class="muted">— ${r.desc}</span></span>`;
            const btn = el("button", "buy-btn", `🪙 ${price}`);
            btn.disabled = G.gold < price;
            btn.onclick = () => { if (G.gold < price) return; G.gold -= price; addCog(cogKey); row.remove(); refreshShop(); };
            row.appendChild(btn); $("#shop-cog").appendChild(row);
        }
        const remRow = el("div", "shop-item");
        remRow.innerHTML = `<span>🗑️ <b>Scrap a card</b> <span class="muted">remove it from your deck</span></span>`;
        const remBtn = el("button", "buy-btn", `🪙 75`);
        remBtn.disabled = G.gold < 75 || G.deck.length <= 1;
        remBtn.onclick = () => showRemoveChooser();
        remRow.appendChild(remBtn); $("#shop-remove").appendChild(remRow);

        function refreshShop() {
            $("#shop-gold").textContent = G.gold;
            document.querySelectorAll(".buy-btn").forEach((b) => { const p = parseInt(b.textContent.replace("🪙", "").trim(), 10); if (!isNaN(p)) b.disabled = G.gold < p; });
            remBtn.disabled = G.gold < 75 || G.deck.length <= 1;
        }
        $("#shop-leave").onclick = () => { closeOverlay(); showMap(); };
    }
    function showRemoveChooser() {
        openOverlay(`<h2>Scrap a card (🪙75)</h2><div class="grid-cards" id="rem-cards"></div><button class="pile-btn" id="rem-cancel">Cancel</button>`);
        const wrap = $("#rem-cards");
        G.deck.forEach((card) => {
            const cel = renderCardEl(card); cel.classList.add("playable");
            cel.onclick = () => { G.gold -= 75; const i = G.deck.indexOf(card); if (i >= 0) G.deck.splice(i, 1); updateTopbar(); closeOverlay(); marketRoom(); };
            wrap.appendChild(cel);
        });
        $("#rem-cancel").onclick = () => { closeOverlay(); marketRoom(); };
    }
    function anomalyEvent() {
        const events = [
            { title: "🕳️ Dormant Assembler", text: "A half-built machine offers an upgrade — for a price. Sacrifice 6 HP to install a Cog, or leave.",
              options: [{ label: "Sacrifice 6 HP", run: () => { loseHP(G.player, 6); const c = randomCog(); if (c) addCog(c); else { G.gold += 40; updateTopbar(); } end(); } }, { label: "Leave", run: end }] },
            { title: "💰 Scrap Cache", text: "A toppled supply drone spills its cargo. Free scrap!",
              options: [{ label: "Take 40 scrap", run: () => { G.gold += 40; updateTopbar(); end(); } }] },
            { title: "⛲ Coolant Reservoir", text: "Clean coolant pools here. Drink to repair 20 HP, or bottle it to reinforce your frame (+4 Max HP).",
              options: [{ label: "Drink (repair 20)", run: () => { healPlayer(20); end(); } }, { label: "Bottle (+4 Max HP)", run: () => { G.player.maxHp += 4; healPlayer(4); end(); } }] },
            { title: "👺 Ambush Protocol", text: "Security drones lock on. No way around this one.",
              options: [{ label: "Fight!", run: () => { closeOverlay(); startCombat(pickEncounter(G.currentNode ? G.currentNode.sector : 0), "monster"); } }] },
            { title: "📜 Schematic Fragment", text: "You decode an old blueprint and gain insight — upgrade a random card in your deck.",
              options: [{ label: "Study", run: () => { const up = G.deck.filter((c) => !c.upgraded && c.def.upg); if (up.length) pick(up).upgraded = true; end(); } }] },
        ];
        const ev = pick(events);
        openOverlay(`<h2>${ev.title}</h2><p class="muted">${ev.text}</p><div class="reward-list" id="ev-opts"></div>`);
        const wrap = $("#ev-opts");
        ev.options.forEach((o) => { const row = el("div", "reward-item", `<span>${o.label}</span>`); row.style.justifyContent = "center"; row.onclick = o.run; wrap.appendChild(row); });
        function end() { closeOverlay(); showMap(); }
    }

    /* ============================================================
       COMBAT RENDERING
       ============================================================ */
    function renderCombat() {
        if (!$("#combat-screen")) return;
        renderPlayer();
        renderEnemies();
        renderHand();
        $("#ui-energy").textContent = G.energy;
        $("#ui-maxenergy").textContent = G.maxEnergy + relicEnergyBonus();
        $("#ui-drawcount").textContent = G.drawPile.length;
        $("#ui-discardcount").textContent = G.discard.length;
        $("#target-hint").textContent = G.selectedCard ? "↳ Click an enemy to target" : "";
        renderLog();
        updateTopbar();
    }
    function relicEnergyBonus() { let b = 0; G.cogs.forEach((rk) => { if (COGS[rk].energy) b += COGS[rk].energy; }); return b; }

    function renderPlayer() {
        const side = $("#player-side");
        side.innerHTML = "";
        const c = el("div", "combatant" + (G.player._hit ? " hit" : ""));
        c.id = "cmb-player";
        let extra = "";
        if (G.usesHeat) {
            const pct = clamp((G.heat / G.maxHeat) * 100, 0, 100);
            const hot = G.heat >= G.maxHeat ? " danger" : G.heat >= G.maxHeat - 2 ? " warn" : "";
            extra += `<div class="heat-gauge${hot}" title="Heat ${G.heat}/${G.maxHeat} — overheats at ${G.maxHeat}">
                <div class="heat-fill" style="width:${pct}%"></div><span class="heat-label">🔥 ${G.heat}/${G.maxHeat}</span></div>`;
        }
        if (G.contraptions.length) {
            extra += `<div class="contraptions">` + G.contraptions.map((k) =>
                `<span class="contraption" title="${k.name}: ${contraptionDesc(k)}">${k.art}${k.kind === "attack" ? "⚔️" : k.kind === "plating" ? "🛡️" : ""}${k.amount}</span>`).join("") + `</div>`;
        }
        c.innerHTML = `<div class="sprite">${G.player.sprite}</div><div class="name">${G.player.name}</div>${hpBarHTML(G.player)}${extra}${badgesHTML(G.player)}`;
        side.appendChild(c);
    }
    function contraptionDesc(k) {
        return k.kind === "attack" ? `${k.amount} dmg/turn` : k.kind === "plating" ? `${k.amount} Plating/turn` : k.kind === "power" ? `${k.amount} Power/turn` : `${k.amount} Heat/turn`;
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
            c.innerHTML = `<div>${intentHTML(e)}</div><div class="sprite">${e.sprite}</div><div class="name">${e.name}</div>${hpBarHTML(e)}${badgesHTML(e)}`;
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
            icon = "🗡️"; extra = `<span class="dmg">${d}</span>`;
            if (m.type === "attackDebuff") extra += ` <span class="muted">+debuff</span>`;
            if (m.type === "attackBlock") extra += ` 🛡️`;
        } else if (m.type === "block") icon = "🛡️";
        else if (m.type === "buff") icon = "⬆️";
        else if (m.type === "debuff") icon = "☠️";
        return `<div class="intent" title="${m.name}">${icon} ${extra}</div>`;
    }
    function hpBarHTML(who) {
        const pct = clamp((who.hp / who.maxHp) * 100, 0, 100);
        const plate = who.block > 0 ? `<span style="color:var(--block)">🛡️${who.block}</span>` : "";
        return `<div class="hp-bar"><div class="hp-fill" style="width:${pct}%"></div><div class="hp-label">${who.hp}/${who.maxHp} ${plate}</div></div>`;
    }
    function badgesHTML(who) {
        const s = who.status, b = [];
        if (who.block > 0) b.push(`<span class="badge block" title="Plating: absorbs damage">🛡️ ${who.block}</span>`);
        if (s.power) b.push(`<span class="badge strength" title="Power: +damage">⚡ ${s.power}</span>`);
        if (s.precision) b.push(`<span class="badge dex" title="Precision: +Plating">🎯 ${s.precision}</span>`);
        if (s.exposed) b.push(`<span class="badge vuln" title="Exposed: takes 50% more">💥 ${s.exposed}</span>`);
        if (s.jammed) b.push(`<span class="badge weak" title="Jammed: deals 25% less">🔧 ${s.jammed}</span>`);
        if (s.rust) b.push(`<span class="badge poison" title="Rust: damage over time">🦠 ${s.rust}</span>`);
        if (s.recoil) b.push(`<span class="badge strength" title="Recoil: deal damage back when hit">🌵 ${s.recoil}</span>`);
        if (s.ritual) b.push(`<span class="badge ritual" title="Spin Up: gains Power each turn">🔮 ${s.ritual}</span>`);
        if (s.platingGen) b.push(`<span class="badge metal" title="Auto-Loader: Plating each turn">🔁 ${s.platingGen}</span>`);
        if (s.engine) b.push(`<span class="badge strength" title="Perpetual Motion: Power each turn">♾️ ${s.engine}</span>`);
        if (s.reactive) b.push(`<span class="badge block" title="Reactive Plating: gain Plating when hit">🧷 ${s.reactive}</span>`);
        if (s.reactor) b.push(`<span class="badge ritual" title="Reactor: +Steam each turn">🔆 ${s.reactor}</span>`);
        if (s.juggernaut) b.push(`<span class="badge strength" title="Juggernaut: gaining Plating damages an enemy">🛞 ${s.juggernaut}</span>`);
        return `<div class="badges">${b.join("")}</div>`;
    }
    function renderHand() {
        const hand = $("#hand");
        hand.innerHTML = "";
        G.hand.forEach((card) => {
            const cel = renderCardEl(card);
            if (canPlay(card)) { cel.classList.add("playable"); if (G.selectedCard === card) cel.classList.add("selected"); cel.onclick = () => onCardClicked(card); }
            else cel.classList.add("unplayable");
            hand.appendChild(cel);
        });
        $("#btn-end-turn").disabled = false;
    }
    function renderCardEl(card) {
        const d = card.def;
        const cel = el("div", "card " + d.type);
        cel.innerHTML = `
            <div class="cost">${cardCost(card)}</div>
            <div class="card-name">${d.name}${card.upgraded ? '<span class="upg">+</span>' : ""}</div>
            <div class="card-art">${d.art}</div>
            <div class="card-type">${d.type}</div>
            <div class="card-desc">${d.desc(card)}</div>`;
        return cel;
    }

    /* ---------- visual feedback ---------- */
    function floatText(who, text, cls) {
        let container;
        if (who.isPlayer) container = $("#cmb-player");
        else container = document.querySelector(`.combatant[data-enemy="${G.enemies.indexOf(who)}"]`);
        if (!container) return;
        const f = el("div", "floating " + cls, text);
        container.appendChild(f);
        setTimeout(() => f.remove(), 900);
    }
    function shakeSprite(who) {
        if (!SETTINGS.shake) return;
        who._hit = true;
        setTimeout(() => { who._hit = false; if (G && G.inCombat) renderCombat(); }, 300);
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
       TOP BAR, DECK VIEW, COG TIPS
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
        G.cogs.forEach((rk) => { const r = COGS[rk]; const span = el("span", "relic", r.art); attachTip(span, `<b>${r.name}</b><br>${r.desc}`); rw.appendChild(span); });
    }
    function showDeck() {
        const sorted = G.deck.slice().sort((a, b) => a.def.name.localeCompare(b.def.name));
        openOverlay(`<h2>Your Deck (${G.deck.length})</h2><div class="grid-cards" id="deck-grid"></div><button class="big-btn" id="deck-close">Close</button>`);
        const grid = $("#deck-grid");
        sorted.forEach((c) => grid.appendChild(renderCardEl(c)));
        $("#deck-close").onclick = () => closeOverlay();
    }

    /* ============================================================
       OVERLAYS + TOOLTIPS
       ============================================================ */
    function openOverlay(html) { const ov = $("#overlay"); ov.innerHTML = `<div class="overlay-inner">${html}</div>`; ov.classList.remove("hidden"); }
    function closeOverlay() { $("#overlay").classList.add("hidden"); $("#overlay").innerHTML = ""; }

    const tipEl = () => $("#tooltip");
    function attachTip(node, html) {
        node.addEventListener("mouseenter", (e) => { tipEl().innerHTML = html; tipEl().classList.remove("hidden"); moveTip(e); });
        node.addEventListener("mousemove", moveTip);
        node.addEventListener("mouseleave", () => tipEl().classList.add("hidden"));
    }
    function moveTip(e) {
        const t = tipEl();
        let x = e.clientX + 14, y = e.clientY + 14;
        const rect = t.getBoundingClientRect();
        if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - 14;
        if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - 14;
        t.style.left = x + "px"; t.style.top = y + "px";
    }

    /* ============================================================
       WIN / LOSE
       ============================================================ */
    function gameOver() {
        STATS.bestFloor = Math.max(STATS.bestFloor || 0, G.floor);
        saveStats();
        clearSave();
        openOverlay(`<h2>💀 Systems Offline</h2><p class="muted">You were dismantled on floor ${G.floor}. The Aurum Core sleeps on.</p><button class="big-btn" id="go-restart">Reboot</button>`);
        $("#go-restart").onclick = () => { closeOverlay(); resetToTitle(); };
    }
    function winRun() {
        STATS.wins = (STATS.wins || 0) + 1;
        STATS.winsBy = STATS.winsBy || {};
        STATS.winsBy[G.char] = (STATS.winsBy[G.char] || 0) + 1;
        STATS.bestFloor = Math.max(STATS.bestFloor || 0, G.floor);
        // Meta-progression: winning at your highest tier unlocks the next Ascension
        let unlocked = false;
        if ((G.ascension || 0) >= (STATS.maxAscension || 0) && (STATS.maxAscension || 0) < MAX_ASCENSION) {
            STATS.maxAscension = (STATS.maxAscension || 0) + 1;
            unlocked = true;
        }
        saveStats();
        clearSave();
        openOverlay(`
            <h2>🏆 The Machine Is Yours!</h2>
            <p class="muted">You reached the heart of the dead god and shattered the Aurum Core at <b>Ascension ${G.ascension || 0}</b>. Cogfall is complete, ${G.player.name}!</p>
            <p>Final deck: <b>${G.deck.length}</b> cards · Cogs: <b>${G.cogs.length}</b> · Scrap: <b class="gold">${G.gold}</b></p>
            ${unlocked ? `<p class="gold">🔓 Ascension ${STATS.maxAscension} unlocked — a harder climb awaits.</p>` : ""}
            <button class="big-btn" id="win-restart">Play Again</button>
        `);
        $("#win-restart").onclick = () => { closeOverlay(); resetToTitle(); };
    }
    function resetToTitle() {
        G = null;
        $("#topbar").classList.add("hidden");
        hideAllScreens();
        $("#title-screen").classList.remove("hidden");
        refreshMenu();
    }

    /* ============================================================
       TITLE SCREEN + WIRING
       ============================================================ */
    let selectedChar = "bulwark";
    let selectedAsc = 0;
    function ascDesc(n) {
        if (n <= 0) return "Standard difficulty. Win to unlock harder Ascensions.";
        return `Enemies have +${Math.round(n * 5)}% HP and deal +${Math.floor(n / 3)} damage. Each win unlocks the next tier.`;
    }
    function refreshAscPicker() {
        const wrap = $("#asc-picker");
        if (!wrap) return;
        const maxA = STATS.maxAscension || 0;
        if (maxA <= 0) { wrap.classList.add("hidden"); selectedAsc = 0; return; }
        wrap.classList.remove("hidden");
        selectedAsc = clamp(selectedAsc, 0, maxA);
        $("#asc-label").textContent = "Ascension " + selectedAsc;
        $("#asc-desc").textContent = ascDesc(selectedAsc);
        $("#asc-down").disabled = selectedAsc <= 0;
        $("#asc-up").disabled = selectedAsc >= maxA;
    }
    function buildCharPicker() {
        const wrap = $("#char-picker");
        wrap.innerHTML = "";
        Object.entries(CHARACTERS).forEach(([key, ch]) => {
            const c = el("div", "char-card" + (key === selectedChar ? " selected" : ""));
            const r = COGS[ch.cog];
            c.innerHTML = `<div class="emoji">${ch.emoji}</div><h3>${ch.name}</h3><p>${ch.desc}</p><p class="hint">${ch.hint}</p><p class="gold">Cog: ${r.art} ${r.name}</p>`;
            c.onclick = () => { selectedChar = key; buildCharPicker(); };
            wrap.appendChild(c);
        });
    }
    /* ============================================================
       SETTINGS, STATS & SAVE / CONTINUE  (localStorage)
       ============================================================ */
    const LS = (() => { try { return window.localStorage; } catch (e) { return null; } })();
    const SAVE_KEY = "cogfall_save_v1";
    const SET_KEY = "cogfall_settings_v1";
    const STAT_KEY = "cogfall_stats_v1";

    const SETTINGS = { speed: "normal", shake: true, confirmEndTurn: false };
    const SPEEDS = { slow: 1.5, normal: 1, fast: 0.5 };
    function loadSettings() { try { Object.assign(SETTINGS, JSON.parse(LS.getItem(SET_KEY)) || {}); } catch (e) {} }
    function saveSettings() { try { LS.setItem(SET_KEY, JSON.stringify(SETTINGS)); } catch (e) {} }
    // scale a timing delay by the chosen animation speed
    function T(ms) { return Math.round(ms * (SPEEDS[SETTINGS.speed] || 1)); }

    const MAX_ASCENSION = 10;
    let STATS = { runs: 0, wins: 0, bestFloor: 0, winsBy: {}, maxAscension: 0 };
    function loadStats() { try { Object.assign(STATS, JSON.parse(LS.getItem(STAT_KEY)) || {}); } catch (e) {} }
    function saveStats() { try { LS.setItem(STAT_KEY, JSON.stringify(STATS)); } catch (e) {} }

    function hasSave() { try { return !!LS.getItem(SAVE_KEY); } catch (e) { return false; } }
    function readSave() { try { return JSON.parse(LS.getItem(SAVE_KEY)); } catch (e) { return null; } }
    function clearSave() { try { LS.removeItem(SAVE_KEY); } catch (e) {} }

    // Auto-save at a clean checkpoint (whenever we're on the map between rooms).
    function saveRun() {
        if (!G || !LS) return;
        try {
            const map = {
                current: G.currentNode ? [G.currentNode.col, G.currentNode.idx] : null,
                columns: G.map.columns.map((col) => ({
                    kind: col.kind, sector: col.sector,
                    nodes: col.nodes.map((n) => ({
                        type: n.type, col: n.col, idx: n.idx, count: n.count, sector: n.sector || 0,
                        visited: n.visited, reachable: n.reachable,
                        next: n.next.map((x) => [x.col, x.idx]),
                    })),
                })),
            };
            LS.setItem(SAVE_KEY, JSON.stringify({
                v: 1, char: G.char, ascension: G.ascension || 0, gold: G.gold, floor: G.floor,
                hp: G.player.hp, maxHp: G.player.maxHp,
                deck: G.deck.map((c) => ({ key: c.key, upgraded: c.upgraded })),
                cogs: G.cogs.slice(), map,
            }));
        } catch (e) {}
    }

    function loadRun() {
        const data = readSave();
        if (!data) return;
        const ch = CHARACTERS[data.char];
        if (!ch) { clearSave(); refreshMenu(); return; }
        G = {
            char: data.char,
            ascension: data.ascension || 0,
            player: { name: ch.name, sprite: ch.sprite, hp: data.hp, maxHp: data.maxHp, block: 0, status: {}, isPlayer: true },
            platingRetain: ch.platingRetain || 0,
            usesHeat: !!ch.usesHeat, maxHeat: ch.maxHeat || 10, overheatDmg: ch.overheatDmg || 6,
            heat: 0, contraptions: [],
            deck: (data.deck || []).filter((c) => CARDS[c.key]).map((c) => makeCard(c.key, c.upgraded)),
            cogs: (data.cogs || []).filter((k) => COGS[k]),
            gold: data.gold, floor: data.floor, map: null,
            hand: [], drawPile: [], discard: [], exhaust: [],
            enemies: [], energy: 0, maxEnergy: 3, turn: 0,
            selectedCard: null, inCombat: false, currentNode: null,
        };
        const columns = data.map.columns.map((col) => ({
            kind: col.kind, sector: col.sector,
            nodes: col.nodes.map((n) => ({ type: n.type, col: n.col, idx: n.idx, count: n.count, sector: n.sector || col.sector || 0, visited: n.visited, reachable: n.reachable, next: [], x: 0, y: 0 })),
        }));
        const at = (c, i) => columns[c] && columns[c].nodes[i];
        data.map.columns.forEach((col, ci) => col.nodes.forEach((n, ni) => {
            columns[ci].nodes[ni].next = (n.next || []).map(([c, i]) => at(c, i)).filter(Boolean);
        }));
        G.map = { columns };
        if (data.map.current) G.currentNode = at(data.map.current[0], data.map.current[1]);
        $("#topbar").classList.remove("hidden");
        updateTopbar();
        showMap();
    }

    /* ---------- menu / settings / how-to UI ---------- */
    function refreshMenu() {
        const cont = $("#btn-continue"), info = $("#continue-info");
        const d = hasSave() ? readSave() : null;
        if (d && CHARACTERS[d.char]) {
            cont.classList.remove("hidden"); info.classList.remove("hidden");
            info.innerHTML = `Resume: ${CHARACTERS[d.char].emoji} ${CHARACTERS[d.char].name} · Floor ${d.floor} · ${d.hp}/${d.maxHp} HP`;
        } else {
            cont.classList.add("hidden"); info.classList.add("hidden");
        }
        const s = $("#run-stats");
        if (s) s.innerHTML = STATS.runs ? `Runs played: <b>${STATS.runs}</b> · Wins: <b class="gold">${STATS.wins}</b> · Best floor reached: <b>${STATS.bestFloor}</b>${STATS.maxAscension ? ` · Highest Ascension: <b class="hp-text">${STATS.maxAscension}</b>` : ""}` : "";
        refreshAscPicker();
    }

    function showSettings() {
        openOverlay(`
            <h2>⚙️ Settings</h2>
            <div style="max-width:440px;margin:6px auto 0">
                <div class="settings-row"><span>Animation speed</span>
                    <div class="seg" id="set-speed"><button data-v="slow">Slow</button><button data-v="normal">Normal</button><button data-v="fast">Fast</button></div></div>
                <div class="settings-row"><span>Screen shake</span><button class="toggle" id="set-shake"></button></div>
                <div class="settings-row"><span>Confirm End Turn with cards left</span><button class="toggle" id="set-confirm"></button></div>
            </div>
            <button class="big-btn" id="set-close">Done</button>
        `);
        const paint = () => {
            $("#set-speed").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === SETTINGS.speed));
            const sh = $("#set-shake"); sh.textContent = SETTINGS.shake ? "On" : "Off"; sh.classList.toggle("on", SETTINGS.shake);
            const cf = $("#set-confirm"); cf.textContent = SETTINGS.confirmEndTurn ? "On" : "Off"; cf.classList.toggle("on", SETTINGS.confirmEndTurn);
        };
        $("#set-speed").querySelectorAll("button").forEach((b) => (b.onclick = () => { SETTINGS.speed = b.dataset.v; saveSettings(); paint(); }));
        $("#set-shake").onclick = () => { SETTINGS.shake = !SETTINGS.shake; saveSettings(); paint(); };
        $("#set-confirm").onclick = () => { SETTINGS.confirmEndTurn = !SETTINGS.confirmEndTurn; saveSettings(); paint(); };
        $("#set-close").onclick = () => closeOverlay();
        paint();
    }

    function showHowTo() {
        openOverlay(`
            <h2>📖 How to Play</h2>
            <div class="howto-body" style="max-width:560px;margin:0 auto">
                <p>Fight your way up through the machine, one room at a time. Each fight is a duel of cards.</p>
                <h4>Your turn</h4>
                <p>You have <span class="kw">Steam</span> (energy) each turn. Click a card to play it; <b>attacks</b> ask you to click an enemy to target. When you're done, <b>End Turn</b> (press <b>E</b>).</p>
                <h4>Defending</h4>
                <p><span class="kw">Plating</span> is your block — it absorbs damage, then resets each turn (unless your machine keeps it). Watch each enemy's <b>intent</b> icon to see what it's about to do.</p>
                <h4>Keywords</h4>
                <p><span class="kw">Power</span> +damage dealt · <span class="kw">Exposed</span> takes 50% more · <span class="kw">Jammed</span> deals 25% less · <span class="kw">Precision</span> +Plating · <span class="kw">Rust</span> damage over time · <span class="kw">Recoil</span> hits attackers back.</p>
                <h4>The three machines</h4>
                <p><b>🛡️ Bulwark</b> — keeps half its Plating each turn; stack it, then unleash Recoil Slam.<br>
                <b>🔥 Overclocker</b> — builds Heat for huge hits, but overheats if it maxes out.<br>
                <b>🔧 Artificer</b> — deploys Contraptions that attack and defend on their own each turn.</p>
                <h4>The climb</h4>
                <p>Between fights, choose your route: heal at <b>Repair Bays</b>, grab <b>Cogs</b> (relics), shop the <b>Black Market</b>, and beat the <b>Sector Guardians</b> to reach the <b>Aurum Core</b>. Your run auto-saves at every room — you can close the tab and pick up where you left off.</p>
            </div>
            <button class="big-btn" id="howto-close">Got it</button>
        `);
        $("#howto-close").onclick = () => closeOverlay();
    }

    function attemptEndTurn() {
        if (!G || !G.inCombat) return;
        if (SETTINGS.confirmEndTurn && G.hand.some(canPlay)) {
            openOverlay(`<h2>End your turn?</h2><p class="muted">You still have cards you can play.</p><button class="big-btn" id="et-yes">End Turn</button> <button class="pile-btn" id="et-no" style="margin-left:10px">Keep Playing</button>`);
            $("#et-yes").onclick = () => { closeOverlay(); endTurn(); };
            $("#et-no").onclick = () => closeOverlay();
        } else endTurn();
    }

    function wire() {
        loadSettings();
        loadStats();
        buildCharPicker();
        refreshMenu();
        refreshAscPicker();
        $("#btn-continue").onclick = () => loadRun();
        $("#btn-start").onclick = () => newGame(selectedChar, selectedAsc);
        $("#asc-down").onclick = () => { selectedAsc = Math.max(0, selectedAsc - 1); refreshAscPicker(); };
        $("#asc-up").onclick = () => { selectedAsc = Math.min(STATS.maxAscension || 0, selectedAsc + 1); refreshAscPicker(); };
        $("#btn-howto").onclick = showHowTo;
        $("#btn-settings").onclick = showSettings;
        $("#btn-settings-run").onclick = showSettings;
        $("#btn-end-turn").onclick = attemptEndTurn;
        $("#btn-deck").onclick = showDeck;
        $("#btn-abandon").onclick = () => {
            openOverlay(`<h2>Abandon this run?</h2><p class="muted">Your progress will be lost.</p><button class="big-btn" id="ab-yes">Abandon</button> <button class="pile-btn" id="ab-no" style="margin-left:10px">Keep Playing</button>`);
            $("#ab-yes").onclick = () => { closeOverlay(); clearSave(); resetToTitle(); };
            $("#ab-no").onclick = () => closeOverlay();
        };
        $("#btn-draw-pile").onclick = () => showPile("Draw Pile", G.drawPile, true);
        $("#btn-discard-pile").onclick = () => showPile("Discard Pile", G.discard, false);
        document.addEventListener("keydown", (e) => {
            if (!G || !G.inCombat) return;
            if ($("#overlay") && !$("#overlay").classList.contains("hidden")) return;
            if (e.key === "e" || e.key === "E") attemptEndTurn();
            if (e.key === "Escape") { G.selectedCard = null; renderCombat(); }
        });
    }
    function showPile(title, pile, shuffled) {
        const arr = shuffled ? shuffle(pile.slice()) : pile.slice();
        openOverlay(`<h2>${title} (${pile.length})</h2>${shuffled ? '<p class="muted">Order hidden (shuffled).</p>' : ""}<div class="grid-cards" id="pile-grid"></div><button class="big-btn" id="pile-close">Close</button>`);
        const grid = $("#pile-grid");
        arr.forEach((c) => grid.appendChild(renderCardEl(c)));
        $("#pile-close").onclick = () => closeOverlay();
    }

    document.addEventListener("DOMContentLoaded", wire);
})();
