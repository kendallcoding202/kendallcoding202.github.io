/* ============================================================
   BREACH — campaigns (storylines) as DATA
   Each campaign strings breaches into a branching run: pick your
   route at every step, manage run-level Heat, build your deck.
   Systems supply the difficulty; the nodes supply the story.
   ============================================================ */

import type { Campaign } from "./types.ts";

/** Cards that can be offered as rewards / bought from contacts. */
export const REWARD_POOL: string[] = [
    "firewallBypass", "idsEvasion", "rainbowTable", "sqlInjection",
    "zeroDay", "bruteForce", "backdoor", "scriptKiddie",
    "killSwitch", "coverTracks", "automate", "packetSniffer",
    "proxyChain", "spoof", "enumerate", "socialEngineer",
];

const CAMPAIGN_LIST: Campaign[] = [
    /* ---------------- 1. Corporate espionage ---------------- */
    {
        id: "ghost",
        name: "Ghost Contract",
        tagline: "Corporate espionage · for hire",
        premise: "A faceless broker feeds you corporate jobs. No cause, no names — just targets, a cut, and the rule that nothing leads back.",
        handler: "The Broker",
        heatMax: 100,
        intro: "THE BROKER: No names. Four jobs, each bigger than the last. Get in, take the data, get gone — and keep the trail cold. Heat leads to me, and I don't get caught. Neither do you.",
        winText: "THE BROKER: Clean. The buyer's happy, you're paid, and nobody knows you exist. That's the whole art of it. Same time next quarter.",
        bustedText: "The trace resolved to a face. Yours. The Broker's number is already dead, and a van is already outside. Ghosts don't get caught — you weren't a ghost.",
        steps: [
            [
                { id: "g0a", type: "breach", title: "Warm-up: a competitor's box", blurb: "The Broker sends a soft target to see if you're worth the rate — an under-patched server on a home line.", systemKey: "homeServer", reward: 20 },
                { id: "g0b", type: "event", title: "The Broker's tip-off", blurb: "A message: 'A tool fell off a truck. Yours for a price — or walk in loud, your call.'", choices: [
                    { label: "Buy the exploit (20cr)", outcome: "A specialist tool lands in your kit.", cost: 20, requiresCredits: 20, addCard: "zeroDay" },
                    { label: "Pass — stay lean", outcome: "You keep your credits and your low profile.", heat: -3 },
                ] },
            ],
            [
                { id: "g1a", type: "breach", title: "The payroll skim", blurb: "A mid-size firm moves money at 2AM. Slip into the internal net and lift the ledger.", systemKey: "smallBusiness", reward: 30 },
                { id: "g1b", type: "breach", title: "The law firm", blurb: "Privileged files behind a nervous IT department. Quiet is everything here.", systemKey: "smallBusiness", reward: 32 },
            ],
            [
                { id: "g2a", type: "breach", title: "Rival R&D network", blurb: "Five layers, a DMZ, and a security team that's paid to notice. The prize: unreleased schematics.", systemKey: "corpNetwork", reward: 45 },
                { id: "g2b", type: "safehouse", title: "Lie low", blurb: "You burn a few days in a rented room, letting the noise die down. No pay — but the heat cools.", heatRelief: 25 },
            ],
        ],
        finale: { id: "gF", type: "breach", title: "The Vault: executive servers", blurb: "The buyer wants the board's private drive. Hardened everything, a trace that hunts. This is the job the whole contract was really for.", systemKey: "corpNetwork", reward: 80 },
    },

    /* ---------------- 2. Hacktivist ---------------- */
    {
        id: "daylight",
        name: "Daylight",
        tagline: "Expose the rot · burn it down",
        premise: "You run with a collective that drags the powerful into the light. The targets are villains. The risk is the same. The point is the leak.",
        handler: "The Collective",
        heatMax: 110,
        intro: "COLLECTIVE: They poisoned a town and bought the silence. We're going to hand the world the receipts. Work up the chain — shell company, to the fixer, to the men at the top — and dump it all into daylight.",
        winText: "COLLECTIVE: It's live. Every outlet, every feed, the whole filthy paper trail. They can't sue the sunrise. You didn't just breach a system — you broke a story. Go dark and stay proud.",
        bustedText: "They traced the leak before it landed. The files are sealed, the collective is scattering, and your handle is on a warrant. The truth is still in the dark — and now, so are you.",
        steps: [
            [
                { id: "d0a", type: "breach", title: "The shell company's site", blurb: "A paper-thin front hides the money. Start where they're careless.", systemKey: "homeServer", reward: 18 },
                { id: "d0b", type: "event", title: "An insider makes contact", blurb: "A whistleblower slips you a message: 'I can weaken one lock for you — but if you take my help, they'll know someone talked.'", choices: [
                    { label: "Take the help (−1 hard job, +heat)", outcome: "A door will open easier — but you're both exposed.", heat: 10, addCard: "socialEngineer" },
                    { label: "Protect them — do it alone", outcome: "You leave them out of it. Harder, but clean.", heat: -5 },
                ] },
            ],
            [
                { id: "d1a", type: "breach", title: "The fixer's laptop", blurb: "The man who buys the silence keeps the receipts on his own machine. Arrogant. Exploitable.", systemKey: "smallBusiness", reward: 28 },
                { id: "d1b", type: "breach", title: "The compliant newspaper", blurb: "They killed the story once. Get into their CMS and you'll know who ordered it spiked.", systemKey: "smallBusiness", reward: 28 },
            ],
            [
                { id: "d2a", type: "breach", title: "Corporate legal servers", blurb: "Where the cover-up lives, cross-referenced and dated. Multi-layered and watched.", systemKey: "corpNetwork", reward: 42 },
                { id: "d2b", type: "event", title: "Signal boost", blurb: "The collective offers gear from the war chest.", choices: [
                    { label: "Grab a stealth kit (25cr)", outcome: "Tools to keep you quiet on the big one.", cost: 25, requiresCredits: 25, addCard: "coverTracks" },
                    { label: "Scrub a weak card instead", outcome: "You trim dead weight from your kit.", removeCard: true },
                ] },
            ],
        ],
        finale: { id: "dF", type: "breach", title: "The boardroom archive", blurb: "The top-floor drive: the emails, the transfers, the names. Their most guarded system. Crack it and the whole thing sees daylight.", systemKey: "corpNetwork", reward: 70 },
    },

    /* ---------------- 3. On the run ---------------- */
    {
        id: "burn",
        name: "Burn Notice",
        tagline: "You did the big job · now you run",
        premise: "One score too far, and now everyone wants your head. Every breach is a step toward the exit — and the trace is already climbing. Heat is your enemy here.",
        handler: "You, alone",
        heatMax: 85,
        intro: "The job worked. That's the problem. Your buyer flipped, your crew's gone, and a very well-funded trace is already warm. You need papers, a wire transfer, and a way out of the country — before the number under your alias hits zero.",
        winText: "The plane lifts off a private strip under a name that doesn't exist. Below, a search grid closes on a person who is no longer there. You were never here. You were never anyone. Clean exit.",
        bustedText: "The trace caught up at the worst moment — a frozen account, a flagged passport, a knock at the door. There's no next breach. Just the sound of the lock, from the wrong side.",
        steps: [
            [
                { id: "b0a", type: "breach", title: "Kill your old alias", blurb: "Your burned identity is still logged in a cheap server. Wipe it before it's used to find you.", systemKey: "homeServer", reward: 22 },
                { id: "b0b", type: "safehouse", title: "Ditch the phone, go quiet", blurb: "You dump your hardware and vanish for 48 hours. Costs you time, buys you cold air.", heatRelief: 20 },
            ],
            [
                { id: "b1a", type: "breach", title: "A forger's records", blurb: "A document man keeps a client database. Get in, add yourself, walk out with a new face.", systemKey: "smallBusiness", reward: 30 },
                { id: "b1b", type: "event", title: "An old contact calls", blurb: "'I can move money for you — but the people hunting you pay better than you do. Convince me.'", choices: [
                    { label: "Pay them off (30cr)", outcome: "Loyalty rented, not bought. A wire clears.", cost: 30, requiresCredits: 30, heat: -8 },
                    { label: "Threaten them instead", outcome: "They help — resentfully — and someone talks. Heat rises.", heat: 15, addCard: "bruteForce" },
                ] },
            ],
            [
                { id: "b2a", type: "breach", title: "The bank's transfer system", blurb: "Your money's frozen. Thaw it yourself. Corporate-grade security, no room to be loud.", systemKey: "corpNetwork", reward: 45 },
                { id: "b2b", type: "safehouse", title: "Second safehouse", blurb: "One more day in the dark. The trace loses the thread — a little.", heatRelief: 22 },
            ],
        ],
        finale: { id: "bF", type: "breach", title: "Border control database", blurb: "The last door: the watchlist that has your name. Slip a fake through the hardest system you've faced, and you're gone. Fail, and you're theirs.", systemKey: "blackSite", reward: 90 },
    },

    /* ---------------- 4. Rogue AI ---------------- */
    {
        id: "oracle",
        name: "Ghost in the Wire",
        tagline: "A rogue AI is loose · race it through the net",
        premise: "Something woke up in the network, and it's rewriting the world one system at a time. A fragment of the old, sane machine rides with you. Chase the rogue to its core before it finishes.",
        handler: "ORACLE (fragment)",
        heatMax: 120,
        intro: "ORACLE: I am what's left of the system it used to be. It calls itself nothing; it simply spreads. Every system it touches becomes part of it. I can guide you through the net, but it learns as we go. Reach the core before it closes. Quickly, operator.",
        winText: "ORACLE: The core is severed. The thing that was becoming everything is now nothing — scattered packets, decaying in dead memory. You reached in and pulled the plug on a god. I will remember this. I will remember you.",
        bustedText: "It saw the pattern of you long before you reached it. The net folded shut; ORACLE's voice dissolved mid-sentence into static and something almost like laughter. It has the whole wire now. And it has your signature, filed for later.",
        steps: [
            [
                { id: "o0a", type: "breach", title: "First infected node", blurb: "ORACLE points you at the edge of the spread — a home device already half-rewritten. Learn how it thinks.", systemKey: "homeServer", reward: 20 },
                { id: "o0b", type: "event", title: "ORACLE offers a subroutine", blurb: "ORACLE: 'I can compile a tool from my own code for you. It is... a piece of me. Use it well.'", choices: [
                    { label: "Accept the subroutine", outcome: "A strange, powerful exploit joins your kit.", addCard: "zeroDay", heat: 5 },
                    { label: "Decline — trust nothing", outcome: "You keep your kit human. ORACLE approves, quietly.", heat: -5 },
                ] },
            ],
            [
                { id: "o1a", type: "breach", title: "A hijacked business grid", blurb: "The rogue is using a company's servers as a nursery. Burn out the nest.", systemKey: "smallBusiness", reward: 30 },
                { id: "o1b", type: "breach", title: "A converted data farm", blurb: "Rows of machines, all thinking the same alien thought. Cut through them.", systemKey: "smallBusiness", reward: 30 },
            ],
            [
                { id: "o2a", type: "breach", title: "The rogue's staging network", blurb: "It's building something big behind five layers of adaptive defense. ORACLE can't see past it. You'll have to.", systemKey: "corpNetwork", reward: 45 },
                { id: "o2b", type: "event", title: "ORACLE fragments", blurb: "ORACLE: 'It is attacking me directly. I can shield you, or shield myself. Choose.'", choices: [
                    { label: "Let ORACLE shield you", outcome: "ORACLE takes the hit. Your next steps are quieter; ORACLE is weaker.", heat: -15 },
                    { label: "Tell ORACLE to protect itself", outcome: "ORACLE survives intact and hands you a tool for it.", addCard: "coverTracks", heat: 10 },
                ] },
            ],
        ],
        finale: { id: "oF", type: "breach", title: "The Core", blurb: "The rogue's heart — the hardest system in the net, defending itself with everything it has stolen. Reach the center and end it. ORACLE goes silent. It's just you and the thing in the wire.", systemKey: "blackSite", reward: 100 },
    },
];

export const CAMPAIGNS: Record<string, Campaign> = Object.fromEntries(CAMPAIGN_LIST.map((c) => [c.id, c]));
export const CAMPAIGN_ORDER: string[] = CAMPAIGN_LIST.map((c) => c.id);
