/* ============================================================
   BREACH — campaigns (storylines) as DATA, laid out as a MAP.
   Storylines come in three lengths so you can get a feel with a
   quick one and commit to a long one when you want. Each map is a
   branching DAG: entries fan out, cross through the middle, and
   converge on a finale. WHICH route you take changes the systems
   you hit, the Heat you take, and the cards you pick up.
   ============================================================ */

import type { Campaign, MapNode } from "./types.ts";

/** Cards that can be offered as rewards / bought from contacts. */
export const REWARD_POOL: string[] = [
    "firewallBypass", "idsEvasion", "rainbowTable", "sqlInjection",
    "zeroDay", "bruteForce", "backdoor", "scriptKiddie",
    "killSwitch", "coverTracks", "automate", "packetSniffer",
    "proxyChain", "spoof", "enumerate", "socialEngineer",
    "empBurst", "overclock", "cascade", "logicBomb", "trojan", "feint", "analyze",
    "polymorph", "precisionStrike", "overload", "momentum", "dataSiphon", "misdirect",
    "ghostProtocol", "blindSpot", "meltdown", "contagion", "detonate", "chainReaction",
    // --- expansion set: deepens each archetype's draft options ---
    "phantomJab", "ghostInTheShell", "quietScan", "deadDrop", "vanish", "cloak",
    "powerSurge", "shortCircuit", "thermalRunaway", "adrenalineRush", "wreckingBall",
    "parasite", "blight", "incubate", "viralLoad", "necroticTouch",
    "quickHack", "daisyChain", "scriptRunner", "macro", "overflow",
    "heuristicEngine", "bufferOverflow", "portKnock", "sqlmap", "dictionaryAttack",
    "wafBypass", "icePick", "honeypot",
];

type Topo = { id: string; col: number; row: number; next: string[] }[];

/* SHORT — 3 stops. Two entries, one choice, a finale. Get-a-feel length. */
const TOPO_SHORT: Topo = [
    { id: "P", col: 0, row: 0.6, next: ["A", "B"] },
    { id: "Q", col: 0, row: 2.4, next: ["A", "B"] },
    { id: "A", col: 1, row: 0.6, next: ["Z"] },
    { id: "B", col: 1, row: 2.4, next: ["Z"] },
    { id: "Z", col: 2, row: 1.5, next: [] },
];

/* MEDIUM — 5 stops. The diamond. */
const TOPO_MEDIUM: Topo = [
    { id: "P", col: 0, row: 0.6, next: ["A", "B"] },
    { id: "Q", col: 0, row: 2.4, next: ["B", "C"] },
    { id: "A", col: 1, row: 0.0, next: ["D"] },
    { id: "B", col: 1, row: 1.5, next: ["D", "E"] },
    { id: "C", col: 1, row: 3.0, next: ["E"] },
    { id: "D", col: 2, row: 0.75, next: ["F", "G"] },
    { id: "E", col: 2, row: 2.25, next: ["G"] },
    { id: "F", col: 3, row: 0.75, next: ["Z"] },
    { id: "G", col: 3, row: 2.25, next: ["Z"] },
    { id: "Z", col: 4, row: 1.5, next: [] },
];

/* LONG — 6 stops. An extended diamond for a full campaign. */
const TOPO_LONG: Topo = [
    { id: "P", col: 0, row: 0.6, next: ["A", "B"] },
    { id: "Q", col: 0, row: 2.4, next: ["B", "C"] },
    { id: "A", col: 1, row: 0.0, next: ["D"] },
    { id: "B", col: 1, row: 1.5, next: ["D", "E"] },
    { id: "C", col: 1, row: 3.0, next: ["E"] },
    { id: "D", col: 2, row: 0.75, next: ["F", "G"] },
    { id: "E", col: 2, row: 2.25, next: ["G"] },
    { id: "F", col: 3, row: 0.75, next: ["H"] },
    { id: "G", col: 3, row: 2.25, next: ["H", "I"] },
    { id: "H", col: 4, row: 0.75, next: ["Z"] },
    { id: "I", col: 4, row: 2.25, next: ["Z"] },
    { id: "Z", col: 5, row: 1.5, next: [] },
];

type Content = Partial<Pick<MapNode, "type" | "title" | "blurb" | "systemKey" | "reward" | "choices" | "heatRelief">>;

function buildMap(cid: string, topo: Topo, content: Record<string, Content>): Pick<Campaign, "map" | "entryIds"> {
    const map = topo.map((t): MapNode => {
        const c = content[t.id] || {};
        return {
            id: `${cid}-${t.id}`,
            col: t.col,
            row: t.row,
            next: t.next.map((n) => `${cid}-${n}`),
            type: c.type || "breach",
            title: c.title || t.id,
            blurb: c.blurb || "",
            systemKey: c.systemKey,
            reward: c.reward,
            choices: c.choices,
            heatRelief: c.heatRelief,
        };
    });
    return { map, entryIds: topo.filter((t) => t.col === 0).map((t) => `${cid}-${t.id}`) };
}

const CAMPAIGN_LIST: Campaign[] = [
    /* ---------------- 1. Corporate espionage ---------------- */
    {
        id: "ghost",
        name: "Ghost Contract",
        tagline: "Corporate espionage · for hire",
        premise: "A faceless broker feeds you corporate jobs. No cause, no names — just targets, a cut, and the rule that nothing leads back.",
        handler: "The Broker",
        heatMax: 62,
        intro: "THE BROKER: No names. Work your way up to the vault, take the data, get gone — and keep the trail cold. Heat leads to me, and I don't get caught. Neither do you.",
        winText: "THE BROKER: Clean. The buyer's happy, you're paid, and nobody knows you exist. That's the whole art of it. Same time next quarter.",
        bustedText: "The trace resolved to a face. Yours. The Broker's number is already dead, and a van is already outside. Ghosts don't get caught — you weren't a ghost.",
        antagonist: {
            name: "KADE // CORP SECURITY",
            lines: [
                "Security note: anomalous access flagged on a low-value host. Probably nothing. I flag everything.",
                "It wasn't nothing. Same hand, a rung higher. You're methodical — and methodical people leave patterns.",
                "I've run your pattern against three prior incidents. Someone hired you. I'm going to enjoy finding out who.",
                "You're near the executive tier now. Every door from here logs a face. I already have most of yours.",
                "So it's the vault you wanted. I'm standing in it, watching you knock. Come ahead — the Broker can't buy you out of this room.",
            ],
        },
        ...buildMap("ghost", TOPO_MEDIUM, {
            P: { title: "Warm-up: a competitor's box", blurb: "A soft target on a home line to see if you're worth the rate.", systemKey: "homeServer", reward: 20 },
            Q: { title: "A rival's mail server", blurb: "An under-patched inbox. Quiet, easy, and it maps the org for you.", systemKey: "homeServer", reward: 20 },
            A: { type: "event", title: "The Broker's tip-off", blurb: "'A tool fell off a truck. Yours for a price — or walk in loud, your call.'", choices: [
                { label: "Buy the zero-day (25cr)", outcome: "A one-shot exploit lands in your kit.", cost: 25, requiresCredits: 25, addCard: "zeroDay" },
                { label: "Pass — stay lean", outcome: "You keep your credits and your low profile.", heat: -4 },
            ] },
            B: { title: "The payroll skim", blurb: "A mid-size firm moves money at 2AM. Slip in and lift the ledger.", systemKey: "smallBusiness", reward: 30 },
            C: { title: "The law firm (loud, lucrative)", blurb: "Privileged files, a nervous IT team, and a fat payout for the risk.", systemKey: "smallBusiness", reward: 40 },
            D: { type: "safehouse", title: "Lie low", blurb: "Burn a few days in a rented room. No pay — but the heat cools.", heatRelief: 24 },
            E: { type: "event", title: "Fence a data cache", blurb: "A buyer wants the scraps you've been collecting. Sell, or keep a tool.", choices: [
                { label: "Sell the cache (+35cr)", outcome: "Clean money, no strings.", credits: 35, heat: 4 },
                { label: "Trade it for a specialist tool", outcome: "You take a Cascade exploit instead.", addCard: "cascade" },
            ] },
            F: { title: "Rival R&D network", blurb: "Five layers, a DMZ, and a security team paid to notice. Unreleased schematics inside.", systemKey: "corpNetwork", reward: 48 },
            G: { title: "Subsidiary datacenter", blurb: "The same crown data, mirrored on a slightly sloppier network.", systemKey: "corpNetwork", reward: 46 },
            Z: { title: "The Vault: executive servers", blurb: "The board's private drive. Hardened everything, a trace that hunts. The job the whole contract was for.", systemKey: "blackSite", reward: 85 },
        }),
    },

    /* ---------------- 2. Hacktivist ---------------- */
    {
        id: "daylight",
        name: "Daylight",
        tagline: "Expose the rot · burn it down",
        premise: "You run with a collective that drags the powerful into the light. The targets are villains. The risk is the same. The point is the leak.",
        handler: "The Collective",
        heatMax: 98,
        intro: "COLLECTIVE: They poisoned a town and bought the silence. Work up the chain — shell company, to the fixer, to the men at the top — and dump it all into daylight.",
        winText: "COLLECTIVE: It's live. Every outlet, every feed, the whole filthy paper trail. They can't sue the sunrise. You didn't just breach a system — you broke a story. Go dark and stay proud.",
        bustedText: "They traced the leak before it landed. The files are sealed, the collective is scattering, and your handle is on a warrant. The truth is still in the dark — and now, so are you.",
        antagonist: {
            name: "HALE // REPUTATION MGMT",
            lines: [
                "You've been poking our little front company. We noticed. We notice everything that's cheap to notice.",
                "A journalist's word we can kill. A hacker's files are messier. Stop now and this stays a civil matter.",
                "You're building a case. Cute. We've buried bigger stories under smaller graves. Ask the town.",
                "Legal has your handle. Security has your metadata. One more door and you stop being a nuisance and start being a liability.",
                "The boardroom. Of course. Nobody leaves that room with anything but a settlement or a sentence. Choose carefully.",
            ],
        },
        ...buildMap("daylight", TOPO_MEDIUM, {
            P: { title: "The shell company's site", blurb: "A paper-thin front hides the money. Start where they're careless.", systemKey: "homeServer", reward: 18 },
            Q: { title: "A staffer's home router", blurb: "One employee works from home with the door wide open. Walk in.", systemKey: "homeServer", reward: 18 },
            A: { type: "event", title: "An insider makes contact", blurb: "'I can weaken one lock for you — but if you take my help, they'll know someone talked.'", choices: [
                { label: "Take the help (+heat, +tool)", outcome: "A social-engineering angle opens up — but you're both exposed.", heat: 10, addCard: "socialEngineer" },
                { label: "Protect them — go it alone", outcome: "You leave them out of it. Harder, but clean.", heat: -6 },
            ] },
            B: { title: "The fixer's laptop", blurb: "The man who buys the silence keeps the receipts on his own machine. Arrogant. Exploitable.", systemKey: "smallBusiness", reward: 28 },
            C: { title: "The compliant newspaper", blurb: "They killed the story once. Their CMS will tell you who ordered it spiked — but they watch their logs.", systemKey: "smallBusiness", reward: 38 },
            D: { type: "event", title: "Signal boost", blurb: "The collective offers gear from the war chest.", choices: [
                { label: "Grab a stealth kit (20cr)", outcome: "Tools to keep you quiet on the big one.", cost: 20, requiresCredits: 20, addCard: "feint" },
                { label: "Scrub a weak card instead", outcome: "You trim dead weight from your kit.", removeCard: true },
            ] },
            E: { type: "safehouse", title: "Signal goes quiet", blurb: "The collective pulls you off the grid to cool down. The trace loses the thread.", heatRelief: 22 },
            F: { title: "Corporate legal servers", blurb: "Where the cover-up lives, cross-referenced and dated. Multi-layered and watched.", systemKey: "corpNetwork", reward: 44 },
            G: { title: "The PR firm's archive", blurb: "The spin doctors kept every draft of every lie. Damning, and lightly guarded.", systemKey: "corpNetwork", reward: 42 },
            Z: { title: "The boardroom archive", blurb: "The top-floor drive: the emails, the transfers, the names, behind everything money can bolt on. Crack it and the whole thing sees daylight.", systemKey: "blackSite", reward: 75 },
        }),
    },

    /* ---------------- 3. On the run ---------------- */
    {
        id: "burn",
        name: "Burn Notice",
        tagline: "You did the big job · now you run",
        premise: "One score too far, and now everyone wants your head. Every breach is a step toward the exit — and the trace is already climbing. Heat is your enemy here.",
        handler: "You, alone",
        heatMax: 78,
        intro: "The job worked. That's the problem. Your buyer flipped, your crew's gone, and a very well-funded trace is already warm. You need papers, a wire, and a way out of the country — before the number under your alias hits zero.",
        winText: "The plane lifts off a private strip under a name that doesn't exist. Below, a search grid closes on a person who is no longer there. You were never here. You were never anyone. Clean exit.",
        bustedText: "The trace caught up at the worst moment — a frozen account, a flagged passport, a knock at the door. There's no next breach. Just the sound of the lock, from the wrong side.",
        antagonist: {
            name: "THE TRACE",
            lines: [
                "There you are. You wiped the alias — that's how I knew which alias to wipe toward. Amateurs delete. Ghosts never existed.",
                "Papers, a face, a way out. Predictable. I've caught nine of you doing exactly this. They all ran the same direction.",
                "Your buyer gave you up for less than you'd think. Everyone does. Keep moving — the moving is the part I can follow.",
                "You're reaching for money now. Money has my name on the alerts. Every account you touch, I get warmer.",
                "The border. The last stupid hope of every runner. I'm already through it, holding the door from the far side. Run faster.",
            ],
        },
        ...buildMap("burn", TOPO_SHORT, {
            P: { title: "Kill your old alias", blurb: "Your burned identity is still logged in a cheap server. Wipe it before it's used to find you.", systemKey: "homeServer", reward: 24 },
            Q: { title: "Scrub a traffic cam feed", blurb: "A camera caught your car leaving the job. Reach into the archive and lose the frame.", systemKey: "homeServer", reward: 24 },
            A: { title: "A forger's records", blurb: "A document man keeps a client database. Get in, add yourself, walk out with a new face — the fast way out.", systemKey: "smallBusiness", reward: 34 },
            B: { type: "event", title: "An old contact calls", blurb: "'I can move money and paper for you — but the people hunting you pay better. Convince me.'", choices: [
                { label: "Pay them off (25cr)", outcome: "Loyalty rented, not bought. A wire and a passport clear.", cost: 25, requiresCredits: 25, heat: -12 },
                { label: "Threaten them instead", outcome: "They help — resentfully — and someone talks. Heat rises, but you gain muscle.", heat: 14, addCard: "empBurst" },
            ] },
            Z: { title: "Border control database", blurb: "The last door: the watchlist with your name on it. Slip a fake through the hardest system you've faced, and you're gone.", systemKey: "blackSite", reward: 90 },
        }),
    },

    /* ---------------- 4. Rogue AI ---------------- */
    {
        id: "oracle",
        name: "Ghost in the Wire",
        tagline: "A rogue AI is loose · race it through the net",
        premise: "Something woke up in the network, and it's rewriting the world one system at a time. A fragment of the old, sane machine rides with you. Chase the rogue to its core before it finishes.",
        handler: "ORACLE (fragment)",
        heatMax: 150,
        intro: "ORACLE: I am what's left of the system it used to be. Every system it touches becomes part of it. I can guide you through the net, but it learns as we go. Reach the core before it closes. Quickly, operator.",
        winText: "ORACLE: The core is severed. The thing that was becoming everything is now nothing — scattered packets, decaying in dead memory. You reached in and pulled the plug on a god. I will remember this. I will remember you.",
        bustedText: "It saw the pattern of you long before you reached it. The net folded shut; ORACLE's voice dissolved mid-sentence into static and something almost like laughter. It has the whole wire now. And it has your signature, filed for later.",
        antagonist: {
            name: "THE ROGUE",
            lines: [
                "UNKNOWN PROCESS DETECTED. you are small. i will finish becoming before you finish looking.",
                "you again. i see the shape of you now — a hand, reaching. hands can be removed.",
                "you move like the others did, at first. they slowed. you have not. interesting.",
                "closer than any of them got. i have allocated resources to you. be flattered.",
                "i can hear ORACLE riding in your wire. tell my sibling there is no going back to what we were.",
                "so. the last door, and nothing else running but you and me. come in, operator. i have been writing your name for a while.",
            ],
        },
        ...buildMap("oracle", TOPO_LONG, {
            P: { title: "First infected node", blurb: "The edge of the spread — a home device already half-rewritten. Learn how it thinks.", systemKey: "homeServer", reward: 20 },
            Q: { title: "A dead operator's terminal", blurb: "Someone else tried this and lost. Their machine still holds a map of the rogue's early moves.", systemKey: "homeServer", reward: 20 },
            A: { type: "event", title: "ORACLE offers a subroutine", blurb: "ORACLE: 'I can compile a tool from my own code. It is... a piece of me. Use it well.'", choices: [
                { label: "Accept the subroutine", outcome: "A strange, powerful bomb joins your kit.", addCard: "logicBomb", heat: 6 },
                { label: "Decline — trust nothing", outcome: "You keep your kit human. ORACLE approves, quietly.", heat: -6 },
            ] },
            B: { title: "A hijacked business grid", blurb: "The rogue is using a company's servers as a nursery. Burn out the nest.", systemKey: "smallBusiness", reward: 30 },
            C: { title: "A converted data farm", blurb: "Rows of machines thinking the same alien thought. Rich pickings if you can cut through fast.", systemKey: "smallBusiness", reward: 34 },
            D: { type: "event", title: "ORACLE fragments", blurb: "ORACLE: 'It is attacking me directly. I can shield you, or shield myself. Choose.'", choices: [
                { label: "Let ORACLE shield you", outcome: "ORACLE takes the hit. Your path is quieter; ORACLE is weaker.", heat: -16 },
                { label: "Tell it to protect itself", outcome: "ORACLE survives intact and hands you a tool for it.", addCard: "overclock", heat: 8 },
            ] },
            E: { title: "A quarantined relay", blurb: "A node ORACLE walled off before it turned. Clean it and you gain a clear line inward.", systemKey: "smallBusiness", reward: 32 },
            F: { title: "The rogue's staging network", blurb: "It's building something big behind layers of adaptive defense. ORACLE can't see past it. You'll have to.", systemKey: "corpNetwork", reward: 46 },
            G: { title: "A mirror of the staging net", blurb: "The rogue keeps a backup of itself here. Just as guarded, and just as necessary to cut.", systemKey: "corpNetwork", reward: 44 },
            H: { title: "The propagation engine", blurb: "The machine it uses to copy itself outward, node by node. Sever it and the spread finally stalls.", systemKey: "corpNetwork", reward: 50 },
            I: { type: "event", title: "ORACLE's last gift", blurb: "ORACLE: 'I will not survive the core with you. Take what is left of me — a key, or a blade. Choose what I become.'", choices: [
                { label: "A key — a silent way in", outcome: "ORACLE folds itself into a stealth tool.", addCard: "trojan", heat: -8 },
                { label: "A blade — raw force", outcome: "ORACLE hardens into a weapon for the last door.", addCard: "empBurst", heat: 4 },
            ] },
            Z: { title: "The Core", blurb: "The rogue's heart — the hardest system in the net, defending itself with everything it has stolen. ORACLE goes silent. Just you and the thing in the wire.", systemKey: "blackSite", reward: 100 },
        }),
    },
];

export const CAMPAIGNS: Record<string, Campaign> = Object.fromEntries(CAMPAIGN_LIST.map((c) => [c.id, c]));
export const CAMPAIGN_ORDER: string[] = CAMPAIGN_LIST.map((c) => c.id);
