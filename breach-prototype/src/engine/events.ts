/* ============================================================
   BREACH — the EVENT DECK (data)
   A pool of campaign-agnostic events. At run start, each event
   node on the map is dealt one of these (or one of the campaign's
   own signature events), so what you meet between jobs changes
   from run to run. Choices spend/earn credits, move Heat, and
   add or scrub cards.
   ============================================================ */

import type { EventDef } from "./types.ts";

export const GENERIC_EVENTS: EventDef[] = [
    {
        id: "ev_dealer",
        title: "A tool dealer surfaces",
        blurb: "An encrypted channel opens: 'Got something specialist. Half up front, no refunds.'",
        choices: [
            { label: "Buy a specialist exploit (25cr)", outcome: "A precision tool joins your kit.", cost: 25, requiresCredits: 25, addCard: "sqlInjection" },
            { label: "Not tonight", outcome: "You keep your credits and move on.", heat: -2 },
        ],
    },
    {
        id: "ev_informant",
        title: "An informant with a warning",
        blurb: "'They're sniffing your traffic. Fifty says I muddy the water for you.'",
        choices: [
            { label: "Pay for the misdirection (20cr)", outcome: "The trail goes cold for a while.", cost: 20, requiresCredits: 20, heat: -12 },
            { label: "Handle it yourself", outcome: "You reroute through your own proxies. Slower, free.", heat: -3 },
        ],
    },
    {
        id: "ev_cache",
        title: "An unguarded data cache",
        blurb: "You stumble on a fat, poorly-secured cache. Grabbing it is easy money — and a little noisy.",
        choices: [
            { label: "Grab it (+30cr, +heat)", outcome: "Quick money, a few more eyes your way.", credits: 30, heat: 8 },
            { label: "Leave it — smells like bait", outcome: "You walk. Nothing gained, nothing risked.", heat: -2 },
        ],
    },
    {
        id: "ev_fixer",
        title: "A fixer offers a scrub",
        blurb: "'That junk code you're carrying is slowing you down. I'll strip a piece out, clean.'",
        choices: [
            { label: "Scrub a card from your deck", outcome: "You cut dead weight from your kit.", removeCard: true },
            { label: "Keep the deck intact", outcome: "You'd rather have the options.", heat: -2 },
        ],
    },
    {
        id: "ev_honeypot",
        title: "Honeypot flagged",
        blurb: "Your scanner lights up: the next easy-looking target is a trap wired to trace you.",
        choices: [
            { label: "Pay a lookout to steer you clear (15cr)", outcome: "You route around it cleanly.", cost: 15, requiresCredits: 15, heat: -6 },
            { label: "Tiptoe past it yourself", outcome: "Nerve-wracking, but you slip by. Mostly.", heat: 5 },
        ],
    },
    {
        id: "ev_broker_intel",
        title: "Sell what you've scraped",
        blurb: "A broker wants the incidental intel you've picked up along the way. Clean money — if you don't mind the exposure.",
        choices: [
            { label: "Sell it (+35cr, +heat)", outcome: "The credits clear. So does your anonymity, a little.", credits: 35, heat: 9 },
            { label: "Sit on it", outcome: "Some things are safer unsold.", heat: -3 },
        ],
    },
    {
        id: "ev_friendly",
        title: "A friendly node",
        blurb: "Another operator, retiring, hands off a favorite tool. 'Make it count. I'm out.'",
        choices: [
            { label: "Take the tool", outcome: "A reliable exploit joins your kit, no charge.", addCard: "backdoor" },
            { label: "Politely decline", outcome: "You travel light. They respect that.", heat: -4 },
        ],
    },
    {
        id: "ev_bribe",
        title: "A sysadmin who can be bought",
        blurb: "An admin on the inside floats a number. Grease the right palm and doors get quieter.",
        choices: [
            { label: "Pay them off (30cr)", outcome: "Logs get 'lost.' The heat drops.", cost: 30, requiresCredits: 30, heat: -16 },
            { label: "Don't leave a money trail", outcome: "Cash is evidence. You pass.", heat: -1 },
        ],
    },
    {
        id: "ev_zeroday",
        title: "A zero-day, live in the wild",
        blurb: "You catch a fresh, unpatched exploit crossing the wire. Grab it before it's burned — but using it makes waves.",
        choices: [
            { label: "Snatch the zero-day", outcome: "A one-shot, break-anything exploit — very loud.", addCard: "zeroDay", heat: 6 },
            { label: "Let it go", outcome: "Too hot to hold. You leave it.", heat: -3 },
        ],
    },
    {
        id: "ev_crew",
        title: "Muscle for hire",
        blurb: "A brute-force specialist offers to ride along. Effective. Subtle, not so much.",
        choices: [
            { label: "Bring them on", outcome: "A heavy exploit joins your kit — and draws eyes.", addCard: "bruteForce", heat: 7 },
            { label: "Work alone", outcome: "Quieter your way. You keep it lean.", heat: -4 },
        ],
    },
    {
        id: "ev_stealthkit",
        title: "A stealth kit on offer",
        blurb: "A quiet vendor deals in silence itself — noise-dampening tooling, cheap tonight.",
        choices: [
            { label: "Buy the dampener (18cr)", outcome: "A silent tool to keep you invisible.", cost: 18, requiresCredits: 18, addCard: "coverTracks" },
            { label: "Pass", outcome: "You'll stay quiet the hard way.", heat: -2 },
        ],
    },
    {
        id: "ev_downtime",
        title: "A window to breathe",
        blurb: "A lull in the hunt. You can push your luck for a score, or use the quiet to cool off.",
        choices: [
            { label: "Cool off", outcome: "You go still and let the trace fade.", heat: -14 },
            { label: "Push for a quick score (+25cr)", outcome: "You can't help yourself. Worth it — probably.", credits: 25, heat: 6 },
        ],
    },
];
