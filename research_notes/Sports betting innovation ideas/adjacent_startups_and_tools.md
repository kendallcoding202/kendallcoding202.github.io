# Sports-Betting-Adjacent Apps, Tools and Startups in the US (as of 2026-11-12)

Reader notes on evidence quality (applies to every section):
- Research was done by web search plus a handful of page fetches on 2026-11-12. Many numbers come from search-result summaries of secondary pages (CB Insights, YesPress, vendor blogs, affiliate review sites). Where I only saw a headline or a secondary summary, I say so.
- Vendor-authored comparison pages (SportsGameOdds, SharpAPI, OddsPapi, BettorEdge, botforkalshi, pm.wiki) have an interest in the outcome. Treat their claims about competitors as directional.
- Reddit could not be searched effectively in this session. No r/sportsbook, r/sportsbetting or r/Kalshi threads were retrieved. User-sentiment evidence is therefore thin and comes from app-store reviews, Trustpilot and reviewer write-ups.
- Status labels used: ACTIVE, ACQUIRED, PIVOTED, SHUT DOWN, UNVERIFIED.

## 1. Bet trackers and bankroll tools (Pikkit, Action Network BetSync, Juice Reel, Betstamp, SharpSports-powered apps)

### Takeaway
Automatic sportsbook sync is now table stakes and Pikkit is the clear category leader (hundreds of thousands of users, profitable per one reviewer, free core product). I found no evidence in this session that major sportsbooks are systematically blocking sync; the visible failure mode is flaky sync on some books and bet types, not a ban.

### Cited Findings
- Pikkit (ACTIVE): App Store listing says it syncs bets from 30+ sportsbooks and is "a bet tracker app and not a sportsbook"; app was updated as recently as May-June 2026 — [AppFollow listing](https://apps.appfollow.io/ios/pikkit-sports-betting-tracker/1586567110?country=us); [Pikkit BookSync page](https://pikkit.com/booksync)
- Pikkit pricing: core app free; Pikkit Pro $29.99/month or $199.99/year, 7-day trial; reviewer says Pro was previously $39.99/month or $299.99/year. Free tier includes tracking, unified P&L/ROI dashboard, line shopping, Autofill, and Pikkit AI bet analysis capped at 50 questions/day. Pro adds closing-line-value grading, SGP pricing, odds/market-open alerts, exposure view — [BetSmart review (affiliate-linked)](https://www.betsmart.co/tool-reviews/pikkit)
- Pikkit sync tech: its own "BookSync" logs in with the user's sportsbook credentials, is read-only (cannot place bets or move funds), and covers sportsbooks, DFS apps and prediction markets (Novig and ProphetX named) in the US plus Alberta and Ontario — [BetSmart review](https://www.betsmart.co/tool-reviews/pikkit); [Pikkit supported books page](https://pikkit.com/resources/sportsbooks)
- Pikkit traction: company's 2024 "Instant Replay" release reported 600,000+ monthly active users, 323 million bets tracked in 2024 and about $10.6B in tracked wagers — [BusinessWire, Dec 9 2024](https://www.businesswire.com/news/home/20241209399992/en/Pikkit-Releases-2024-Instant-Replay)
- Pikkit funding: CB Insights lists a $4.38M seed on June 15 2022 (FJ Labs named); VCBacked lists Founder Collective, FJ Labs, Correlation Ventures — [CB Insights](https://www.cbinsights.com/company/pikkit/financials); [VCBacked](https://www.vcbacked.co/company/pikkit). Conflicting: BetSmart says roughly $9M across three rounds and that Pikkit was profitable in 2024 — [BetSmart review](https://www.betsmart.co/tool-reviews/pikkit)
- Pikkit ratings: about 4.9 stars across roughly 22,000 App Store ratings — [BetSmart review](https://www.betsmart.co/tool-reviews/pikkit)
- Pikkit is moving toward distribution of prediction markets: ProphetX signed a B2B deal to bring its prediction-market contracts into the Pikkit app (2026, following ProphetX's $35M round) — [Casino.org](https://casino.org/news/prophetx-expands-b2b-prediction-market-push-with-pikkit-partnership)
- Pikkit buys its odds data from OpticOdds (OpticOdds publishes a Pikkit customer case study) — [OpticOdds](https://opticodds.com/customers/pikkit)
- Reviewer-identified weaknesses of Pikkit: Pro is expensive for a tracker and the tier structure (Pro/Plus/Lite) is confusing; some books and exotic bet types sync slowly or need manual fixes; voided legs and cash-outs are handled inconsistently; not as deep as modeling tools so some users keep spreadsheets; social feed is unvetted — [BetSmart review](https://www.betsmart.co/tool-reviews/pikkit)
- One Google Play reviewer reports ongoing sync issues with certain sportsbooks and a support ticket open for weeks — [Google Play listing](https://play.google.com/store/apps/details?id=com.pikkit.android&hl=en_US&gl=US)
- SharpSports (ACTIVE, B2B): a Plaid-style account-linking API with a hosted embeddable linking UI that returns account balance and bet history — [Product Hunt](https://www.producthunt.com/products/sharpsports/launches); [SharpSports docs](https://docs.sharpsports.io/docs)
- SharpSports' (undated) reference table lists FanDuel and DraftKings as supported for betSync and betPlace; docs say the supported-book list changes and should be checked via the book list endpoint — [SharpSports reference](https://docs.sharpsports.io/reference); [Linking accounts doc](https://docs.sharpsports.io/docs/linking-accounts)
- SharpSports' BettorAccount object includes a counter of bets that could not be pulled due to unrecognized format, i.e. parse failures are an expected condition — [SharpSports BettorAccount reference](https://docs.sharpsports.io/reference/bettoraccount)
- Known SharpSports customers: SportsDataIO (Bet Tracker widget, which requires SharpSports API keys), BettingPros, Cipher Sports (Dimers) — [SBC Americas 2021](https://sbcamericas.com/2021/11/24/sportsdataio-enters-into-bet-tracking-solution-partnership-with-sharpsports/); [SportsDataIO bet tracker guide](https://sportsdata.io/developers/bet-tracker-guide); [PR Newswire, BettingPros](https://prnewswire.com/news-releases/bettingpros-adds-bet-tracking-with-sharpsports-301460932.html); [Cipher Sports](https://www.ciphersports.io/press/cipher-sports-to-launch-new-features-with-sharpsports-technology)
- Action Network BetSync (ACTIVE): described by Action as one-directional (sportsbook to Action Network); Action also has an explainer page on BetSync for prediction markets (page body could not be retrieved) — [Action Network BetSync](https://www.actionnetwork.com/education/action-network-betsync-bet-tracking); [Action Network BetSync prediction markets](https://www.actionnetwork.com/education/action-network-betsync-prediction-markets-explained)
- Juice Reel (ACTIVE): positions as a bet tracker plus verified picks marketplace; claims sync from 300+ sportsbooks; offers AI picks, projections and "matchup intelligence"; free with in-app purchases; publisher Juice Integration, Inc. — [App Store](https://apps.apple.com/app/id1527960097). It also sells a subscription "Crowdsourced Insights" product built from synced user bets — [iGaming Capital](https://igamingcapital.mt/juice-reel-launches-data-driven-crowdsourced-insights-to-elevate-sports-betting-experience/)
- Betstamp (ACTIVE per App Store): listed free, combining bet tracker, odds screen, prop comparison and +EV tools — [App Store](https://apps.apple.com/app/id1525948689)
- A 2026 comparison says Pikkit, Juice Reel and BettingPros can all auto-sync major US books; several newer trackers (BetJournal, Oddible, BettorEdge, StatSniper) publish their own "best bet tracker" roundups — [BetJournal](https://www.betjournal.io/blog/best-bet-tracking-apps/); [Oddible](https://oddible.ai/blog/best-app-to-track-sports-betting-wins-and-losses); [BettorEdge](https://www.bettoredge.com/post/top-bet-tracking-apps)
- Generic benchmark for "unified API" per-linked-account pricing is roughly $50-65 per linked account in other industries (not a SharpSports quote) — [Unified.to](https://unified.to/blog/unified_apis_usage_based_vs_per_connection_pricing_for_integrations)

### Inferences
- The tracker category is saturated at the "sync + P&L + CLV" level. The leader gives the core away free and monetizes Pro, data and (now) prediction-market distribution, which makes a paid indie tracker hard to justify.
- Credential-based read-only sync is fragile by design (it depends on each book's web/app session flow). The practical user pain is "book X stopped syncing" or "parlay legs/cash-outs wrong", which matches the reviewer and Play Store complaints.
- The real business of trackers is the aggregated verified bet data (Juice Reel sells "crowdsourced insights"; Pikkit publishes annual data reports and now partners with an exchange). A solo developer cannot replicate that data moat quickly.
- A solo developer who wants sync must either pay SharpSports (pricing not public) or build screenshot/OCR or email-receipt import. I saw at least one small app (betsAI) advertising screenshot scanning, so that workaround is already in use (see section 7).

### Gaps
- Sportsbooks blocking sync: I found no article, regulator statement or forum thread confirming that DraftKings, FanDuel or others block or penalize tracker sync. Two targeted searches returned nothing. This is "not found", not "not happening"; Reddit was not searchable here.
- SharpSports pricing, funding and current customer count: not public / not found.
- Pikkit current (2026) MAU: only the Dec 2024 figure (600K+) is sourced; a much lower third-party estimate (about 136K MAU) appeared in a search summary without a verifiable source page.
- "Pikkit AI is powered by QuickPickBot" appeared in a search summary but I could not tie it to a source page.
- Betstamp's rumored B2B pivot, Juice Reel funding, and user counts for Juice Reel/Betstamp/Action tracker: not found.

## 2. Odds comparison, +EV, arbitrage and prop research tools (OddsJam, Outlier, Props.cash, Unabated, DarkHorse, OpticOdds, PropFinder, Linemate, Dimers, Rithmm, BetQL)

### Takeaway
This is the most commercially proven adjacent category (OddsJam's parent sold for up to $160M on about $26M revenue) and also the most crowded: a dozen-plus subscription tools at roughly $20-$100+/month selling the same odds-screen, +EV and prop-hit-rate features.

### Cited Findings
- OddsJam (ACQUIRED): Gambling.com Group agreed in Dec 2024 to buy parent Odds Holdings for up to $160M ($80M initial plus up to $80M contingent on performance through 2026); deal closed early January 2025 — [SBC Americas](https://sbcamericas.com/2024/12/12/gamblingcom-buying-oddsjam-parent/); [BusinessWire](https://www.businesswire.com/news/home/20241212903186/en); [SBC News, closing](https://sbcnews.co.uk/europe/uk/2025/01/06/gambling-com-ends-buy-of-oddsjam-for-160m/)
- Odds Holdings projected $26M revenue for 2024 with at least 20% growth expected in 2025; platform described as processing over one million requests per second across nearly 300 sportsbooks; founders Ankit Goyal and Alex Monahan and CEO Matt Restivo joined Gambling.com Group — [iGamingBusiness](https://igamingbusiness.com/strategy/ma/gambling-com-group-acquire-oddsjam/); [Gambling Insider](https://www.gamblinginsider.com/news/27737/gambling-com-group-expands-market-reach-with-odds-holdings-acquisition)
- OddsJam consumer pricing is reported inconsistently by third-party pages: one lists a free plan and Pro from $49/month, another lists consumer subscriptions at $99-$499/month — [SportsAPIs.dev](https://sportsapis.dev/apis/odds-jam); [OddsPapi blog](https://oddspapi.io/blog/?p=2860)
- OddsJam Trustpilot reviews are split between strong praise and complaints calling it a scam and criticizing payment handling — [Trustpilot](https://at.trustpilot.com/review/oddsjam.com)
- OddsJam appears to have a prediction-market product ("Prediction Insiders"), reviewed by a competitor; headline only — [BettorEdge](https://bettoredge.com/post/oddsjam-prediction-insiders-review)
- Outlier (ACTIVE; formerly Colorcast, Austin TX, founded 2019): plans from $19.99 to $79.99/month; researches props, injuries and matchups beside sportsbook prices — [CB Insights](https://www.cbinsights.com/company/colorcast); [YesPress](https://yespress.io/outlier)
- Outlier funding: a roughly $10M Series A including secondaries reported closed Dec 4 2025 (one headline says $10.7M); total raised reported as $15.7M (ZoomInfo) or $17M (CB Insights) — [SignalBase](https://www.trysignalbase.com/news/funding/outlier-raises-107m-series-a-for-data-driven-sports-betting); [ZoomInfo](https://www.zoominfo.com/financial/outlier/566134040); [CB Insights financials](https://www.cbinsights.com/company/colorcast/financials)
- Rithmm (ACTIVE; Massachusetts): last raised $2.5M on May 3 2024, total $4.5M per CB Insights (CityBiz reports a $2M seed); third-party listing gives Core plan at $29.99/month or $19.99/month billed annually — [CB Insights](https://www.cbinsights.com/company/rithmm/financials); [CityBiz](https://www.citybiz.co/?p=424901); [Indexator listing](https://dev.indexator.ai/companies/rithmm-ai-sports-betting-tool)
- Props.cash (ACTIVE per listing): player-prop research tool, founded 2021, based in Hamilton, Ontario — [Village.ai](https://village.ai/company/propsdotcash)
- BetQL (ACTIVE): paywall data shows tiers at $19.99, $24.99, $29.99 and $49.99/month depending on number of sports, a $4.99 all-sports day pass, and yearly plans up to $299.99 — [Adapty paywall library](https://adapty.io/paywall-library/betql-sports-betting/)
- Linemate (ACTIVE): free download with in-app purchases from $9.99 to $79.99 — [App Pricing Lab](https://www.apppricinglab.com/app/apple/1635246793)
- Dimers Pro (ACTIVE): premium subscription for daily model picks and weekly +EV bets; pricing not captured — [Dimers](https://www.dimers.com/subscription/dimers-pro-vs-betql)
- Betstamp bundles a free odds screen and +EV tools with its tracker — [App Store](https://apps.apple.com/app/id1525948689)
- Developer-side evidence of crowding: multiple API vendors now ship ready-made arbitrage/+EV endpoints, including sportsbook-versus-Kalshi/Polymarket arbitrage — [SportsGameOdds](https://sportsgameodds.com/use-cases/prediction-market-arbitrage-api); [Odds-API.io](https://odds-api.io/blog/polymarket-kalshi-arbitrage-sports-betting-api); [SharpAPI](https://sharpapi.io/compare/best-sports-betting-apis)

### Inferences
- OddsJam's exit at roughly 3x-6x revenue is the reference outcome for this category; it also shows the buyer type (public affiliate/marketing groups that want recurring subscription revenue), not sportsbooks.
- Feature parity is high. Differentiation is now price (Outlier/Linemate/BetQL at $10-$80) and UX, not data. A new generic +EV or prop-hit-rate tool would be the Nth entrant.
- The economics for an indie are squeezed from below: real-time multi-book odds with props cost hundreds to thousands of dollars per month (section 9), while consumers anchor on $20-$50/month.
- Arbitrage/+EV tools have a structural churn problem: successful users get limited by sportsbooks. I did not source this in this session; it is commonly asserted and worth the report writer verifying.

### Gaps
- Unabated, DarkHorse Odds and PropFinder: no pricing, traction or status found in this session.
- OddsJam subscriber count and authoritative 2026 pricing: not found (third-party pages conflict).
- That OpticOdds is the B2B sibling of OddsJam inside Odds Holdings is my background understanding; the fetched summaries did not state it explicitly. Check the BusinessWire release.
- Whether the $80M OddsJam earn-out was achieved: not found.
- No Reddit sentiment retrieved on price sensitivity or account limiting.

## 3. AI pick/assistant tools and LLM-based betting agents

### Takeaway
"AI picks" is the most over-supplied, lowest-trust corner of the market: the App Store is full of near-identical AI prediction apps, leaders have added AI chat as a free feature, and the best independent test found frontier LLMs could not beat the betting market. Autonomous agents exist mainly as crypto/Polymarket projects with unaudited results.

### Cited Findings
- KellyBench (General Reasoning) tested eight frontier models (Claude, GPT-5, Gemini, Grok and others) betting across a full Premier League season; none turned a profit — [Decrypt](https://decrypt.co/364406/ai-beat-sports-betting-market-top-8-models?amp=1); [Let's Data Science](https://letsdatascience.com/news/frontier-ai-models-fail-to-beat-sports-betting-9f238438)
- Action Network's own 2026 guide frames the split between useful AI tooling and marketing hype around transparency of records — [Action Network](https://www.actionnetwork.com/playbook/news/ai-sports-betting-what-works-vs-hype)
- Rithmm sells AI model-building/picks at about $20-$30/month and has raised about $4.5M — [CB Insights](https://www.cbinsights.com/company/rithmm/financials); [Indexator listing](https://dev.indexator.ai/companies/rithmm-ai-sports-betting-tool)
- Pikkit gives AI bet analysis away in its free tier (50 questions/day), grounded in the user's synced history — [BetSmart review](https://www.betsmart.co/tool-reviews/pikkit)
- Juice Reel markets AI picks, projections and "smart betting recommendations" inside its tracker — [App Store](https://apps.apple.com/app/id1527960097)
- Sire (formerly "DraiftKing"; ACTIVE per 2026 coverage): operates as a DAO that plans to pool customer funds and have a multi-agent system bet on crypto-based venues such as Polymarket from a crypto wallet; sports markets only for now — [CO/AI](https://getcoai.com/news/ai-startups-chase-150b-sports-gambling-market-with-mixed-results/); [Coinage](https://www.coinage.media/2026/how-sire-is-leveraging-ai-to-democratize-the-edge-in-prediction-markets)
- Billy Bets (crypto AI betting agent): early Decrypt snapshot showed +82% ROI on five golf bets but -6% on NBA, -4% on MLB and an overall portfolio around -3.71%; uses OpenAI SDK, Claude models for reasoning and Grok for personality — [Decrypt](https://decrypt.co/319598/ai-sports-betting-agent-billy-bets-crypto)
- The Polymarket tool ecosystem lists AI agents/research tools including Alphascope, PolyBro, Billy Bets, Semantic 42, Astron and Fraction AI, plus sports-specific Sportstensor and Rainmaker — [DeFiprime, Jan 11 2026](https://defiprime.com/definitive-guide-to-the-polymarket-ecosystem)
- Sportsbooks and media are themselves rolling out AI assistants that predict outcomes and track bets — [The Batch (DeepLearning.AI)](https://www.deeplearning.ai/the-batch/gambling-sites-roll-out-ai-tools-that-predict-wins-and-track-bets-for-sports-fans); [CasinoBeats, June 3 2026 (headline)](https://casinobeats.com/2026/06/03/sportsbooks-integrating-ai-tools-bettors-which-chatbot-is-the-best-tipster/)
- App Store long tail of AI prediction apps surfaced by a single search: betsAI, OSports, Predictive Play, Stat Sniper, SportBot AI, Bet Buddies AI, DeepChamp AI, OddsLab AI — [betsAI](https://apps.apple.com/app/id6756926912); [OSports](https://apps.apple.com/app/id6480043551); [Predictive Play](https://apps.apple.com/us/app/id6748275790); [Stat Sniper](https://apps.apple.com/us/app/id6479165781); [SportBot AI](https://apps.apple.com/app/id6761690250); [Bet Buddies AI](https://apps.apple.com/us/app/id6759182434); [DeepChamp AI](https://apps.apple.com/us/app/id6742149750); [OddsLab AI](https://apps.apple.com/us/app/id6761976516)
- Kalshi's builder program explicitly invites "AI agents" as an app type to be built on its liquidity — [Kalshi News, Dec 1 2025](https://news.kalshi.com/p/kalshi-solana-tokenized-predictions)

### Inferences
- A ChatGPT-wrapper pick app is the single most-tried "twist" and has no moat: incumbents bundle AI chat free, and the only rigorous public benchmark says LLMs do not have predictive edge on their own.
- Where AI adds real value is personal and explanatory (analyzing the user's own bet history, explaining a line move, summarizing injury news), not in selling picks. Pikkit already occupies "AI over your own history".
- Agents that place trades autonomously are feasible on Kalshi/Polymarket (open APIs) and essentially infeasible on regulated sportsbooks (no public betting APIs), which is why the agent activity clusters in prediction markets and crypto.
- Vendor accuracy claims (e.g., "70-85% accurate") are not comparable to profitability because picking favorites yields high hit rates at negative expected value. This is my reasoning; I did not find an independent audit of any consumer AI pick app.

### Gaps
- No independent, audited track record found for Rithmm, Juice Reel AI, Sire, Billy Bets or any App Store AI pick app.
- Funding/token-raise figures for Sire and Billy Bets: not found.
- "BetBuddy-type chatbots": only an App Store listing for "Bet Buddies AI" was found; no traction data.
- No user-reception data from Reddit; no download figures for the App Store long tail.

## 4. Social betting, pick-sharing, copy-betting and creator marketplaces

### Takeaway
The one social model with proven money flow is paid-picks infrastructure for cappers (DubClub, Whop communities). Standalone social betting networks have mostly died or been absorbed, and the sweepstakes "social sportsbook" model (Fliff, Rebet, Thrillzz) is being legislated out and is pivoting to prediction markets.

### Cited Findings
- DubClub (ACTIVE): two-sided marketplace where handicappers sell subscriptions and deliver picks; $7.5M Series A on Sept 5 2024 led by Renegade Partners; total about $10.5M over two rounds — [CB Insights](https://www.cbinsights.com/company/dubclub/financials); [Uncork Capital](https://uncorkcapital.com/blog/the-entrepreneur-economy-and-our-investment-in-dubclub-7de581a32c9e)
- DubClub scale: more than $50M paid to cappers and 6M+ purchases (TechNexus); a later profile reports 10.3M+ purchases — [TechNexus](https://www.technexus.com/dubclub-makes-it-easier-for-sports-gamblers-to-find-and-follow-betting-experts/); [YesPress](https://yespress.io/dubclub)
- DubClub July 2026: appointed ex-DraftKings executive Ed Silva as CEO and closed an undisclosed-size round mostly from existing investors (Uncork, Renegade, Will Ventures); stated pivot from "creator marketplace" to building a "consumer marketplace" — [StreetInsider/PR Newswire](https://www.streetinsider.com/PRNewswire/DubClub+Appoints+DraftKings+Veteran+Ed+Silva+as+CEO/26765349.html)
- Whop-hosted sports pick communities: commonly cited groups include GoldBoys, Beat the Books, Official Picks (claims 10K+ members, 450+ five-star reviews) and KingCapSports; memberships reported at $10-$100/month in one guide and $30-$500/month in another. All sources are promotional/affiliate — [Whop/Methods blog](https://whop.methods.app/blog/sports-picks-community); [Whop reviews site](https://whopreviews.pages.dev/sports-picks); [Hive Index Discord directory](https://thehiveindex.com/topics/sports-betting/platform/discord/)
- Juice Reel pairs its tracker with a "verified picks marketplace" (picks verified by synced bets) — [App Store](https://apps.apple.com/app/id1527960097)
- Pikkit has an optional social feed where anyone can post plays; reviewer notes it is unvetted — [BetSmart review](https://www.betsmart.co/tool-reviews/pikkit)
- Betr (ACTIVE, PIVOTING): relaunched as "Betr 2.0" super app on Sept 8 2026 combining Picks (fantasy), Social Sportsbook, Social Casino, Arcade and a first-of-its-kind Polymarket prediction-market integration (separate Polymarket KYC required) — [Covers](https://www.covers.com/industry/betr-super-app-launches-with-prediction-integration-star-studded-promotion-sept-8-2026); [Action Network](https://www.actionnetwork.com/news/betr-app-prediction-markets-polymarket)
- Onyx Odds (ACTIVE, PIVOTING): sports picks app that raised a $20M Series A led by Kraken parent Payward at a $220M valuation (June 2026); its affiliate became a CFTC introducing broker/NFA member on May 20 2026 backed by NinjaTrader Clearing; regulated product in private beta — [The Block](https://theblock.co/news/deals/2026-06-24-sports-betting-app-onyx-odds-raises-20-million-in-round-led-by-kraken-parent-payward-405997); [DeFi Rate](https://defirate.com/news/sweeps-swaps-fliff-sweepstakes-pivot-prediction-markets/)
- Fliff (ACTIVE, PIVOTING): sweepstakes rules bar Fliff Cash play in 20 states including CA, NY, MI; Arizona ordered it to stop; Fliff FCM LLC applied to the NFA on Aug 12 2026 for futures commission merchant registration (pending) — [DeFi Rate, updated Oct 4 2026](https://defirate.com/news/sweeps-swaps-fliff-sweepstakes-pivot-prediction-markets/)
- Rebet (ACTIVE, PIVOTING): FCM application via Rebet Predictions LLC pending since June 11 2026 — [DeFi Rate](https://defirate.com/news/sweeps-swaps-fliff-sweepstakes-pivot-prediction-markets/)
- Tennessee regulators labeled Thrillzz, KicKr and Rebet "illegal sports gaming entities" and they left the state; Thrillzz shut its Tennessee platform Oct 29 — [Deadspin](https://deadspin.com/legal-betting/thrillzz-kickr-and-rebet-leave-social-sports-betting-tennessee-market/); [Sweepsy](https://www.sweepsy.com/news/3-more-sweeps-sportsbooks-exit-tennessee/)
- State action against sweepstakes models: California dual-currency ban effective Jan 1 2026; Indiana and Maine enacted prohibitions in 2026; Arizona issued cease-and-desists; Betty Sweeps announced a "permanent" shutdown after bans and C&Ds — [DeFi Rate](https://defirate.com/news/sweeps-swaps-fliff-sweepstakes-pivot-prediction-markets/); [SweepsKings](https://sweepskings.com/news/arizona-new-cease-and-desist-wave/); [Sweepsy](https://www.sweepsy.com/news/betty-sweeps-announces-permanent-shutdown/)
- Wagr (SHUT DOWN then ACQUIRED): first licensed social/P2P sports betting operator in the US, raised $12M, launched in Tennessee January 2022, shut down in Q4 2022, acquired by Yahoo on April 25 2023 to fold into Yahoo Sports — [Yahoo press release](https://www.yahooinc.com/press/yahoo-acquires-wagr-unlocking-opportunities-in-social-gaming-for-yahoo-sports); [SBC Americas](https://sbcamericas.com/2023/04/25/wagr-yahoo-sportsbook-acquisition/); [iGamingBusiness](https://igamingbusiness.com/strategy/ma/yahoo-acquires-sports-betting-app-wagr/)
- Juked (SHUT DOWN, Nov 2022): esports social network with about 16,000 app users; closed after an acquisition fell through and the funding environment turned hostile — [Founder post-mortem](https://medium.com/@FishStix/the-juked-story-is-coming-to-a-close-a71f20ce3b8c); [Esports Insider](https://esportsinsider.com/2022/11/esports-app-juked-shuts-down-acquisition-deal-falls-through)
- Buzzer (SHUT DOWN; date not verified in this session): Front Office Sports headline describes it as "the Gen Z sports app backed by $44 million" shutting down — [Front Office Sports](https://frontofficesports.com/buzzer-the-gen-z-sports-app-backed-by-44-million-shuts-down)
- Copy-betting on prediction markets: Kalshi's public trade feed is anonymous and its profiles/leaderboard do not copy orders; third-party Telegram bot Kreo mirrors Kalshi leaderboard traders; Polymarket has PolyCop, PolyGun, Polycopy — [Bot for Kalshi blog (vendor)](https://www.botforkalshi.com/blog/best-prediction-market-bots)

### Inferences
- What worked: selling shovels to cappers (payments, delivery, subscriber management). DubClub's own 2026 leadership change and "consumer marketplace" framing suggests the creator side is maxed out and discovery/trust for buyers is the unsolved half.
- What failed: standalone social networks for bettors (thin engagement, expensive acquisition) and licensed P2P social sportsbooks (Wagr).
- Whop/Discord pick-selling is large but opaque: no verified records, heavy affiliate marketing. "Verified by synced bets" is the obvious trust fix and Juice Reel/Pikkit already do versions of it.
- True one-tap "tail" execution on sportsbooks is blocked by lack of bet-placement APIs (SharpSports lists betPlace for some books, but I could not verify consumer apps using it). On prediction markets copy-trading is technically easy and already commoditized by bots.
- The sweepstakes model as a way to offer betting-like social products without a license is closing state by state; pivots are all toward CFTC-regulated distribution.

### Gaps
- HotStreak: nothing found. Thrillzz national status beyond Tennessee/Arizona: not verified.
- Whop sports category GMV or top-seller revenue: no reliable figure found.
- DubClub's "$95M+ GMV" claim appeared via a CB Insights snippet of a company release that I could not read; treat as unverified.
- "Bettor Capital-backed startups" list: not retrieved (see section 10 for the firm's thesis).
- Whether any consumer app offers legal one-tap copy-betting into US sportsbooks: not found.

## 5. Peer-to-peer / friend betting apps and pool apps

### Takeaway
Friend-vs-friend betting has been tried under four legal wrappers (state sportsbook license, fantasy/skill-contest law, sweepstakes, and now CFTC event contracts). The licensed and sweepstakes versions failed or are retreating; the survivors are pool/contest operators under fantasy law (Splash) and B2B pivots (Lucra). In 2026 even FanDuel killed its P2P picks product and exchanges are abandoning state licenses for federal prediction-market status.

### Cited Findings
- Wagr: licensed in Tennessee (state sportsbook license route), $12M raised, launched Jan 2022, shut down Q4 2022, acquired by Yahoo April 2023; not live in any real-money market at acquisition — [SBC Americas](https://sbcamericas.com/2023/04/25/wagr-yahoo-sportsbook-acquisition/); [Yahoo](https://www.yahooinc.com/press/yahoo-acquires-wagr-unlocking-opportunities-in-social-gaming-for-yahoo-sports)
- Lucra Sports (PIVOTED to B2B, ACTIVE): began as a consumer P2P sports gaming app launched 2021 across 37 states (skill-contest structure); pivoted to a white-label SDK so brands (golf courses, arcades, pickleball clubs) can run money competitions; $10M round in late 2024 led by 7GC and SeventySix Capital with Giannis Antetokounmpo; $20M Series B led by ARK Invest reported in 2026 — [VentureBeat](https://venturebeat.com/business/lucra-raises-10m-in-funding-to-drive-brand-loyalty-through-gamification); [Whalesbook](https://www.whalesbook.com/news/English/startupsvc/Lucra-Sports-Raises-dollar20M-Series-B-Led-by-ARK-Invest-Eyes-B2B-Gamification/6a146a09b979113840ca5069); [YesPress](https://yespress.io/lucra)
- Lucra's founder describes pivoting from consumer to B2B in 45 days; third-party revenue estimate is only about $1.5M — [Equity podcast listing](https://www.castfox.net/podcast/equity-55848/episode/how-lucra-raised-20m-as-an-esports-play-when-every-vc-only-wants-ai-2626796); [YesPress](https://yespress.io/lucra)
- BetOpenly (ACTIVE per 2025-2026 sources): P2P marketplace where users set their own odds and pay a 1% fee on matched wagers; founder said in June 2025 its legal framework allowed operation in 45 states and that P2P blackjack, DFS and prediction markets were planned — [Betting Startups Podcast ep. 167](https://bettingstartups.podbean.com/e/ep-167-reduced-juice-for-all-w-gino-donati-from-betopenly); [BettorEdge comparison (competitor)](https://www.bettoredge.com/post/betopenly-vs-bettoredge)
- BettorEdge (ACTIVE): competing no-house social/P2P platform that now also brands itself among prediction markets — [BettorEdge](https://www.bettoredge.com/post/not-all-prediction-markets-are-created-the-same-why-bettoredge-stands-out-among-a-growing-field-of)
- WagerLab (ACTIVE per roundup): friend-bet tracking without real-money handling — [BettorEdge roundup](https://www.bettoredge.com/post/best-betting-apps-for-friends)
- ZenSports (ACQUIRED 2022): assets bought by KeyStar Corp in Oct 2022, excluding its Nevada assets and gaming licence; KeyStar is described as offering both a traditional sportsbook and P2P betting (profile undated) — [iGamingBusiness](https://igamingbusiness.com/strategy/ma/keystar-shifts-to-betting-and-esports-with-zensports-acquisition/); [Gambling Insider](https://www.gamblinginsider.com/?p=55756); [TradingView profile](https://in.tradingview.com/symbols/OTC-KEYR/)
- Splash Sports (ACTIVE): formed 2021 by acquiring RunYourPool and OfficeFootballPool; peer-to-peer contests only (no house games), takes a rake on entry fees plus a B2B partner business; $14.1M Series A-2 (Feb 2024) and $14.5M Series B led by Dream Ventures (Oct 2025); reports 2M+ active users across 44 states and Canada — [Splash blog](https://splashsports.com/blog/splash-inc-acquires-runyourpool-officefootball-pool); [Pulse 2.0](https://pulse2.com/splash-peer-to-peer-sports-strategy-game-company-secures-14-1-million); [BusinessWire](https://www.businesswire.com/news/home/20251008204652/en/Splash-Sports-Raises-%2414.5M-Series-B-to-Redefine-the-Way-Fans-Compete); [YesPress](https://yespress.io/splash-sports)
- Splash 2026: $5M+ in guaranteed NCAA tournament prizes including a $3M survivor contest; June 2026 partnership with Polymarket on a $21M guaranteed pro football Survivor contest at $1,000/entry, available in 35 states and Canada — [Entrepreneur/BusinessWire](https://www.entrepreneur.com/business-news/splash-sports-launches-over-5-million-in-contest-prizes-for-the-2026-ncaab-tournament-led-by-nick-wrights-3-million-survivor-madness-world-championship); [Covers](https://www.covers.com/industry/splash-sports-partners-with-polymarket-to-expand-survivor-contests-june-18-2026)
- FanDuel Picks (SHUT DOWN): FanDuel's peer-to-peer fantasy pick'em launched April 30 2025 in five states, expanded to 17; sunset announced March 27 2026, final contests April 23, withdrawals through May 29 2026; FanDuel said it was reallocating resources to "areas where we see the greatest opportunity" — [SBC Americas](https://sbcamericas.com/2026/03/27/fanduel-picks-shutdown-may-2026/); [FanDuel](https://fanduel.com/about/news/fanduel-picks-platform-to-sunset); [Covers launch](https://www.covers.com/industry/fan-duel-picks-launches-peer-to-peer-dfs-contests-in-five-us-states-apr-30-2025); [Saturday Down South](https://www.saturdaydownsouth.com/news/dfs/fanduel-expands-peer-to-peer-dfs-product-to-17-states)
- Underdog (ACQUISITION PENDING): IG Group agreed July 30 2026 to buy Underdog for up to $1.3B (about $1.1B upfront); Underdog surrendered fantasy licenses in seven states (MD, MA, MI, MS, NJ, OH, PA) because those states would not let it offer CFTC-licensed prediction products alongside fantasy — [Covers](https://www.covers.com/industry/ig-group-to-buy-underdog-expand-us-prediction-market-push-july-30-2026); [Saturday Down South](https://www.saturdaydownsouth.com/news/betting/underdog-gives-up-daily-fantasy-sports-licenses-in-seven-states/); [SBC News](https://sbcnews.co.uk/sportsbook/2026/09/07/underdog-shuts-fantasy)
- Sporttrade (PIVOTED): licensed sports betting exchange closed its state-licensed US sportsbook operations (NJ May 25 2026; AZ, CO, IA, VA late June 2026) while awaiting CFTC DCM/DCO approval — [Legal Sports Report](https://www.legalsportsreport.com/263660/sporttrade-exits-betting-with-predictions-applications-pending/); [Gambling.com](https://www.gambling.com/us/news/sporttrade-exits-us-sports-betting-market-in-pivot-to-prediction-markets)
- Novig (ACTIVE): sweepstakes-style P2P exchange that raised a $75M Series B led by Pantera at a $500M valuation (Feb 2026) and relaunched nationwide in Aug 2026 on its CFTC-regulated Ludlow Exchange, excluding AZ, MI, NV — [Fortune](https://fortune.com/2026/02/18/sports-prediction-markets-novig-kalshi-polymarket-cftc-pantera-multicoin/); [DeFi Rate](https://defirate.com/news/sweeps-swaps-fliff-sweepstakes-pivot-prediction-markets/)
- ProphetX (ACTIVE): relaunched June 2026 as a federally regulated prediction market (49 states, excluding Nevada), raised $35M in July 2026 for a B2B strategy — [Axios](https://www.axios.com/pro/fintech-deals/2026/07/28/prophetx-35m-b2b-prediction-markets); [Covers](https://www.covers.com/industry/prophetx-raises-35m-to-scale-its-sports-prediction-market-platform-july-28-2026)
- Pred: P2P sports prediction exchange, $2.5M round led by Accel with Coinbase Ventures' Base Ecosystem Fund (Feb 2026) — [DL News (press release)](https://dlnews.com/external/pred-raises-dollar25m-to-build-the-fastest-trading-experience-in-sports-prediction/)
- Monkey Knife Fight (SHUT DOWN): DFS/prop game shut by owner Bally's — [Legal Sports Report](https://www.legalsportsreport.com/?p=104843)

### Inferences
- Legal-structure scoreboard: (a) state sportsbook license for P2P = dead (Wagr, Sporttrade exit); (b) fantasy/skill-contest law = works for pools and survivor (Splash) but is under pressure where operators also touch prediction markets (Underdog); (c) sweepstakes = collapsing; (d) CFTC event contracts = where all capital is going, but requires FCM/IB/DCM status or a partnership.
- A solo developer cannot legally hold or move stakes without one of these wrappers. The only solo-feasible versions are no-money-handling (WagerLab-style ledgers, settle offline) or building on top of a regulated venue's API/builder program.
- FanDuel abandoning P2P picks after less than a year is a strong signal that P2P pick'em liquidity is hard even with FanDuel's distribution.
- Pools (survivor, squares, pick'em) are the durable friend format: recurring seasonal demand, commissioner-led virality, and Splash has consolidated the main brands.

### Gaps
- StakeKings (sports staking), Bettle, Poolhost, Venmo-based settlement apps, FanDuel "Faceoff"-type features: nothing found in this session.
- BetOpenly's precise legal structure and current state count in late 2026: only founder/competitor statements, no regulator confirmation.
- ZenSports/KeyStar current operating status: unverified.
- Yahoo's use of Wagr tech after 2023: not found.
- A claim that 37 state attorneys general argued prediction-market operators cannot use federal oversight to bypass state law appeared in a search summary; I could not tie it to a specific source page.

## 6. Free-to-play prediction games, pick'em/streak games, second-screen and watch-party apps

### Takeaway
I could not verify the status of most named F2P vendors in this session, but the verified pattern is consistent: consumer second-screen/F2P apps repeatedly fail as standalone businesses (Buzzer, Playback, HQ Trivia, Jock MKT) and survive only as B2B features or inside larger platforms.

### Cited Findings
- Jock MKT (SHUT DOWN, merged into Splash): the transfer notice states that "due to fantasy licensing rules and regulations, Jock MKT games are no longer operational"; balances were transferred to Splash Sports after a 15-day withdrawal window, with Ohio users refunded by former parent Bid Ventures — [Jock MKT transfer page](https://jockmkttransfer.splashsports.com). Timing reported as 2024 (July 2024 in one source) — [YesPress, Splash](https://yespress.io/splash-sports)
- Playback (SHUT DOWN): sports livestream/watch-along platform; team and technology joined ESPN's product and technology group in March 2026 after the founders independently decided to shut the platform down — [Awful Announcing, acquisition](https://awfulannouncing.com/disney/sports-livestream-platform-playback-acquired-espn.html); [Awful Announcing, shutdown](https://awfulannouncing.com/streaming/sports-livestreaming-platform-playback-shutters.html)
- Buzzer (SHUT DOWN; date unverified): Gen Z short-form live sports app backed by $44M — [Front Office Sports](https://frontofficesports.com/buzzer-the-gen-z-sports-app-backed-by-44-million-shuts-down)
- HQ Trivia (SHUT DOWN 2020): live prize game shut after an acquisition fell through — [TechCrunch](https://techcrunch.com/2020/02/14/hq-trivia-shuts-down)
- TraceMe to Tally (2018): Russell Wilson's celebrity content app cut staff and pivoted to a free-to-play prediction game with leaderboard cash prizes — [GeekWire](https://www.geekwire.com/2018/russell-wilsons-traceme-celebrity-content-app-cuts-staff-closes-l-office-pivots-sports-prediction-game/)
- Fliff, which markets free-to-play prediction games, bought the software and staff of Mojo's sports trading division — [PlayUSA](https://www.playusa.com/news/sports-betting-software-mojo-fliff-acquisition/)
- Underdog and DraftKings continue to run pick'em formats at scale (DraftKings Pick6 in 30+ states), while FanDuel exited its version — [SBC Americas](https://sbcamericas.com/2026/03/27/fanduel-picks-shutdown-may-2026/)
- Splash's survivor/pick'em contests show paid pool formats scaling to multi-million-dollar prize pools — [Covers](https://www.covers.com/industry/splash-sports-partners-with-polymarket-to-expand-survivor-contests-june-18-2026)

### Inferences
- F2P prediction games monetize through sponsors or by acting as acquisition funnels for sportsbooks; with sportsbooks cutting acquisition spend and attention moving to prediction markets, the B2B buyer for F2P is weaker than in 2019-2022. (Inference; Bettor Capital's thesis in section 10 says operators are shifting spend from acquisition to retention.)
- Consumer second-screen apps die from the same cause each time: episodic usage tied to live games and no revenue engine, so they depend on acquisition by a media company.
- The durable F2P instance is a feature inside a big platform (ESPN, Yahoo, DraftKings, Underdog), not a startup.

### Gaps
- Chalkline, Playmaker (the F2P vendor), LiveLike, Low6, WinView, FanUp, Real app, Stadium Live, Sleeper's and Underdog's free games, ESPN Streak: two searches returned nothing usable on current status. Status for all of these is UNVERIFIED in these notes; the report writer should not assert anything about them from this file.
- No data found on F2P conversion rates or sponsor CPMs.

## 7. Novel formats that have been tried

### Takeaway
Nearly every "clever twist" on the list has been tried at least once. Athlete stock markets are the clearest repeated failure (five-plus attempts); bet-slip resale exists but is tiny and legally awkward; "funded bettor" prop firms are a 2026 novelty operating on prediction markets without clear regulatory footing. Hardware/companion formats (watch, Vision Pro, stream overlays, voice) show almost no dedicated startups.

### Cited Findings
Athlete stock markets
- Front Office Sports' review of the category: the model has repeatedly failed because of "an inability to reach large swaths of casual fans" — [Front Office Sports, Mar 2024](https://frontofficesports.com/article/bear-market-for-sacks-and-ints-the-difficult-road-of-sports-stock-markets/)
- ProTrade (2004) could not scale, became Citizen Sports and sold to Yahoo; Fantex sold athlete-income shares 2013-2016 and closed the next year; Vestible obtained SEC approval for an IPO tied to 1% of an NFL player's salary — [Front Office Sports](https://frontofficesports.com/article/bear-market-for-sacks-and-ints-the-difficult-road-of-sports-stock-markets/)
- Mojo (PIVOTED; consumer product SHUT DOWN): backed by Alex Rodriguez and Marc Lore with about $100M; laid off 20% of staff, refocused on DFS, closed its only sportsbook (New Jersey) in Dec 2023 after agreeing to sell technology assets; later sold its sports trading division to Fliff and moved to B2B pricing; by Nov 2025 was reported trading sports outcomes on Kalshi, an arrangement under NBA review — [Front Office Sports launch](https://frontofficesports.com/a-rod-and-lores-athlete-stock-market-launches-with-100m-in-funding); [Casino.org layoffs](https://www.casino.org/news/mojo-sports-exchange-lays-off-20-percent-workforce/); [Covers, Dec 16 2023](https://www.covers.com/industry/mojo-closing-nj-sportsbook-ahead-of-new-partnership-dec-16-2023); [PlayUSA](https://www.playusa.com/news/sports-betting-software-mojo-fliff-acquisition/); [Taipei Times, Nov 16 2025](https://www.taipeitimes.com/News/sport/archives/2025/11/16/2003847285/)
- PredictionStrike (ACTIVE as of a June 2026 profile; not confirmed from a primary source): raised $10M in fall 2023; about a dozen staff; registered users grew from 175,000 to 275,000+; $140M+ traded; operates in roughly 40 states under a game-of-skill/fantasy framing — [Front Office Sports](https://frontofficesports.com/article/bear-market-for-sacks-and-ints-the-difficult-road-of-sports-stock-markets/); [YesPress](https://yespress.io/predictionstrike); [Substack profile](https://shirinemarzouki.substack.com/p/prediction-strike-a-look-into-their)
- Jock MKT shut down citing fantasy licensing rules (see section 6) — [Jock MKT transfer page](https://jockmkttransfer.splashsports.com)
- Football Index (UK) collapsed after a market crash — [Front Office Sports](https://frontofficesports.com/football-index-shut-down-after-market-crash)

Secondary markets for bet slips
- PropSwap (ACTIVE): charges 10% to sellers and 3% to buyers per a critic; claimed fraud rate of 0.002%; signed a retail deal with Bally Bet at two Mississippi sportsbooks in March 2025 (first time under a state regulator); says it has market access in 20+ states; a public payout dispute arose because federal withholding on 300-to-1+ tickets reduced the buyer's payout — [Legal Sports Report](https://www.legalsportsreport.com/230697/propswap-payout-dispute-raises-regulatory-questions-amid-bally-bet-deal/); [SBC Americas](https://sbcamericas.com/2025/03/27/bally-bet-mississippi-deal-propswap/)
- WagerWire (UNVERIFIED current status): $3M seed in July 2022 led by Roger Ehrenberg; CB Insights lists $3.36M total and a Dec 2024 round with no amount; authorized in 16 states plus DC, Ontario and Puerto Rico; launched a DFS pick'em resale marketplace in 27 states with RealTime Fantasy Sports (Feb 2024); tech/media deal with Betr; no 2025-2026 news found — [SBC Americas 2022](https://sbcamericas.com/2022/07/11/wagerwire-completes-3m-funding-marketplace-growth/); [CB Insights](https://www.cbinsights.com/company/wagerwire); [iGamingBusiness licensing](https://igamingbusiness.com/strategy/wagerwire-announces-nine-affiliate-deals-and-us-licensing/); [SBC Americas 2024](https://sbcamericas.com/2024/02/08/realtime-fantasy-sports-deal-wagerwire/); [iGamingBusiness, Betr](https://igamingbusiness.com/strategy/wagerwire-strikes-tech-and-media-deal-with-betr/)

Betting on yourself / skill games
- Lucra moved from consumer P2P skill wagers to a B2B SDK for venues and brands and raised $20M from ARK in 2026 (see section 5) — [Whalesbook](https://www.whalesbook.com/news/English/startupsvc/Lucra-Sports-Raises-dollar20M-Series-B-Led-by-ARK-Invest-Eyes-B2B-Gamification/6a146a09b979113840ca5069)
- Players' Lounge (ACTIVE per App Store): head-to-head video game wagering for cash; raised $10.5M per a newsletter headline — [App Store](https://apps.apple.com/app/id1628903930); [Sharpr Substack](https://sharpr.substack.com/p/skill-based-betting-platform-players)
- Triumph (ACTIVE per listing): skill-based arcade games for real money, monetized by tournament entry fees — [Marlvel listing](https://marlvel.ai/api/llm/apps/games/triumph-play-for-cash)

Funded-bettor "prop firm" programs
- Funding Predicts: Delaware firm funding traders on Polymarket events including sports; cheapest plan $85 for a 10K challenge; 80-90% profit split; rule restricting trading to markets with at least $250 depth within 7 cents — [PropFirmMap review, July 2026](https://propfirmmap.com/blog/funding-predicts-review-2026-polymarket-prop-firm-pricing-payouts); [PropFirmMap profile](https://propfirmmap.com/firms/fundingpredicts)
- PropMarket: New York startup applying the prop-challenge model to Polymarket and Kalshi (simulated account first, then funded account plus profit split); PropFunded and Propr are listed as competitors — [Finance Magnates via TradingView](https://www.tradingview.com/news/financemagnates%3A8eb7af2b6094b%3A0-new-york-startup-propmarket-takes-prop-trading-model-into-prediction-markets/); [PropFirmMap](https://propfirmmap.com/blog/propmarket-review); [PropFirmMap comparison](https://propfirmmap.com/vs/propfunded-vs-propr)
- Prop-challenge economics in general: an analysis of 300,000+ accounts across 10 firms found 14% passed a challenge and 7% ever reached a payout; no ranked firm holds a CFTC FCM registration for its evaluation program (vendor blog) — [Track360](https://track360.io/blog/best-prop-trading-firms-2026-operator-trader-guide)
- On-chain prop firms are themselves a documented sub-category — [DeFiprime](https://defiprime.com/onchain-prop-firms)

Pooled/syndicate betting
- Sire is structured as a DAO that pools customer funds for AI agents to bet on Polymarket (see section 3) — [CO/AI](https://getcoai.com/news/ai-startups-chase-150b-sports-gambling-market-with-mixed-results/)

New market formats
- SpeedLabs raised a $6.5M seed (June 2026, led by Parlay Capital with Bullpen Capital) for AI-powered real-time "momentum markets" on live games — [Yogonet](https://www.yogonet.com/international/news/2026/06/02/122572-speedlabs-raises-65-million-seed-round-to-build-aipowered-live-sports-markets); [Pulse 2.0](https://pulse2.com/speedlabs/)
- Splash plus Polymarket: fantasy-contest/prediction-market hybrid survivor contest (see section 5) — [Covers](https://www.covers.com/industry/splash-sports-partners-with-polymarket-to-expand-survivor-contests-june-18-2026)
- Betr 2.0 bundles fantasy picks, sweepstakes sportsbook/casino, arcade and Polymarket contracts in one app — [Covers](https://www.covers.com/industry/betr-super-app-launches-with-prediction-integration-star-studded-promotion-sept-8-2026)

Devices and companions
- A search for Twitch overlays, Apple Watch/Live Activities bet companions and Vision Pro betting apps returned only generic AI-prediction apps that incidentally list visionOS compatibility (e.g., Predictive Play, OddsLab AI); no dedicated startup surfaced — [Predictive Play](https://apps.apple.com/us/app/id6748275790); [OddsLab AI](https://apps.apple.com/us/app/id6761976516)
- betsAI advertises a screenshot-scanning feature for bet slips ("Vision Pro" is its feature name, not the headset) — [App Store](https://apps.apple.com/app/id6756926912)

### Inferences
- Athlete stock markets fail for three compounding reasons visible in the record: regulatory ambiguity (securities vs. gambling vs. fantasy; Jock MKT cited licensing), no natural liquidity/price anchor (Football Index crash), and limited casual appeal (FOS). Prediction markets now offer tradable sports exposure with real regulation, which removes most of the reason to try again.
- Bet-slip resale is a real but niche need (mostly futures). Tax withholding, sportsbook cooperation and fraud make it structurally hard; sportsbook cash-out and exchange-style prediction markets (where positions are natively tradable) substitute for it.
- Prop-firm challenges are the newest import from retail trading. Their economics rely on most buyers failing the challenge, and their legal status is unsettled. This is a "selling the dream" format with reputational and regulatory risk.
- The absence of companion-device products is probably because they are features, not companies; however it also means a well-made Live Activities/watch companion for open positions is not yet a crowded niche (inference from absence of results, weak evidence).

### Gaps
- Fan tokens (e.g., Socios-style) in the US, bet insurance/hedging calculators as products, AR/in-venue betting, voice betting, sports-betting ETFs, "tail the pros" funds, StakeKings: not researched successfully in this session; no sourced findings.
- WagerWire's status in 2025-2026 and PropSwap's volumes: not found.
- PredictionStrike's status rests on one secondary 2026 profile; the App Store listing showed a 2023 copyright.
- Mojo's own stated reasons for abandoning the athlete-stock product: not found in a primary source.

## 8. Tools on top of prediction markets (Kalshi/Polymarket)

### Takeaway
Yes, this layer is crowded, and it crowded fast: directories count 80-170+ Polymarket tools, a16z-backed and YC-backed teams are building terminals and data APIs, and the exchanges themselves subsidize builders. Generic terminals, whale trackers, copy-trade bots and cross-venue arb bots are saturated; sports-bettor-facing products that bridge sportsbooks and prediction markets look less crowded.

### Cited Findings
- A January 2026 guide counts 170+ third-party tools across 19 categories in the Polymarket ecosystem; a separate directory lists 81 tools in 12 categories — [DeFiprime, Jan 11 2026](https://defiprime.com/definitive-guide-to-the-polymarket-ecosystem); [Polymart directory](https://polymart.app/)
- Named tools by type: terminals (Betmoar, Stand.trade, NexusTools, BullpenFi, Verso, TradeFox, Polymtrade); copy trading (OkBet, Predictify Bot, SOL Decoder, PolyCopy); analytics (Polysights, HashDive, PredictFolio, Polymarket Analytics, Parsec, Polyburg, Polywhaler); alerts (PolyAlertHub, Nevua Markets, PolySpyBot, PolyIntel, alerts.chat, YN Signals); arbitrage (ArbBets, EventArb, Matchr, PolyScalping) — [DeFiprime](https://defiprime.com/definitive-guide-to-the-polymarket-ecosystem)
- Traction/monetization examples: Betmoar reported nearly $110M cumulative volume (about 5% of Polymarket monthly activity per the guide); OkBet charges 1% per buy and sell; Polysights uses freemium tiers; Polymarket builder grants range from $100 to $75,000 per project plus weekly USDC volume rewards — [DeFiprime](https://defiprime.com/definitive-guide-to-the-polymarket-ecosystem)
- Kairos raised a $2.5M seed led by a16z crypto (announced Feb 3 2026) for a cross-venue terminal; named competitors are Verso, Sharpe Terminal, Converge, TRUEiGTECH and the exchanges' own pro offerings; the terminal category "has become genuinely competitive in the last six months" — [BlockEden, Apr 21 2026](https://blockeden.xyz/blog/2026/04/21/kairos-a16z-prediction-market-terminal-polymarket-kalshi/)
- Market size context: about $25.7B notional volume in March 2026 (about 13x March 2025); Kalshi $11.39B in March 2026, of which about $9.9B was sports event contracts — [BlockEden](https://blockeden.xyz/blog/2026/04/21/kairos-a16z-prediction-market-terminal-polymarket-kalshi/). SpeedLabs coverage says sports is roughly 90% of US prediction-market activity — [Yogonet](https://www.yogonet.com/international/news/2026/06/02/122572-speedlabs-raises-65-million-seed-round-to-build-aipowered-live-sports-markets)
- Bloomberg (Dec 3 2025): at least a dozen startups had sprung up in the prior year offering tools that help traders leverage bets or gain an edge on Kalshi/Polymarket — [Bloomberg](https://brp-prod-bcc.bloomberg.com/news/articles/2025-12-03/young-founders-rush-into-prediction-market-startups)
- YC-backed infrastructure: Valence (W26; unified orderbook/execution across Kalshi, Polymarket, Crypto.com plus backtesting), Dome (F25; unified read API), Oddpool (data; joining Kalshi per Sept 2026 reports), the entity (historical/live data for bots) — [YC: Valence](https://www.ycombinator.com/companies/valence); [YC: Dome](https://ycombinator.com/companies/dome); [Sacra interview, Dome](https://sacra.com/research/kurush-dubash-dome-unified-api-for-prediction-markets/); [CryptoRank, Oddpool M&A Sept 3 2026](https://cryptorank.io/insights/deals/oddpool-m-a-2026-09-03); [the entity](https://www.entityml.com/)
- Kalshi launched Builder Codes on Dec 1 2025 so developers can "permissionlessly monetize applications" on its liquidity, with more than $2M in builder grants; listed target app types include pro terminals, dashboards, AI agents and analytics — [Kalshi News](https://news.kalshi.com/p/kalshi-solana-tokenized-predictions)
- Polymarket Builders Program: order attribution, builder leaderboard, fee monetization on routed flow, grants; default tier limited to 100 relayed transactions/day, Verified tier 10,000/day by manual approval — [Polymarket docs: overview](https://docs.polymarket.com/builders/overview); [Polymarket docs: tiers](https://docs.polymarket.com/builders/tiers)
- Copy trading: Polymarket bots (PolyCop, PolyGun, Polycopy) and a Kalshi leaderboard-mirroring Telegram bot (Kreo); a Feb 2026 press release announced another Kalshi copy-trading bot — [Bot for Kalshi blog](https://www.botforkalshi.com/blog/best-prediction-market-bots); [Digital Journal PR](https://www.digitaljournal.com/pr/news/binary-news-network/kalshi-trading-bot-launches-advanced-1945303017.html)
- Arbitrage: cross-venue bots execute when combined cost falls below $1.00; guides say automation compresses mechanical spreads and windows close in seconds; fees can turn a 3% gross arb into 1-2% net or a loss — [pm.wiki](https://pm.wiki/uk/learn/polymarket-kalshi-arbitrage); [QuickNode guide](https://www.quicknode.com/builders-guide/best/top-10-polymarket-trading-bots); [DeFi Rate calculators](https://defirate.com/?p=1894)
- Sportsbook-versus-prediction-market arbitrage is offered as a developer endpoint by several odds APIs rather than (as far as found) as a dominant consumer app — [SportsGameOdds](https://sportsgameodds.com/use-cases/prediction-market-arbitrage-api); [SharpAPI](https://sharpapi.io/compare/best-sports-betting-apis)
- Sportsbook-world incumbents are extending into prediction markets: Pikkit syncs/tracks Novig and ProphetX and is partnering with ProphetX; Action Network has BetSync content for prediction markets; OddsJam has a "Prediction Insiders" product — [BetSmart](https://www.betsmart.co/tool-reviews/pikkit); [Casino.org](https://casino.org/news/prophetx-expands-b2b-prediction-market-push-with-pikkit-partnership); [Action Network](https://www.actionnetwork.com/education/action-network-betsync-prediction-markets-explained); [BettorEdge review](https://bettoredge.com/post/oddsjam-prediction-insiders-review)
- Regulatory overhang: some states are challenging federally regulated sports event contracts; Novig excludes AZ, MI, NV and ProphetX excludes NV — [DeFi Rate](https://defirate.com/news/sweeps-swaps-fliff-sweepstakes-pivot-prediction-markets/)

### Inferences
- Crowding is highest where the tool is venue-native and crypto-flavored (Polymarket terminals, whale/wallet trackers, Telegram copy bots, Poly-Kalshi arb). Speed-based arb is a losing game for a solo developer.
- The exchanges pay builders (grants, fee share via builder codes). That is the only place in the whole adjacent landscape where an indie can legally earn transaction-linked revenue without a license of their own. It is also platform risk: Oddpool being absorbed by Kalshi and "incumbents building downward" show the venue can absorb successful tools.
- The less-crowded seam is translation for mainstream sportsbook bettors: showing prediction-market prices in American odds with fees included, comparing them against sportsbook lines, tracking positions across books and exchanges, and state-by-state availability. Incumbent sportsbook tools (Pikkit, OddsJam, Action) are moving there, so the window is narrowing.

### Gaps
- No trade-level data on how many participants chase the same arb/copy signals; crowding evidence is tool counts and commentary.
- The statistic that sports is two-thirds of Kalshi spot trading and 40% of Polymarket appeared in a search summary without a pinned source.
- r/Kalshi sentiment on third-party tools: not retrieved.
- Whether a consumer-grade sportsbook-vs-Kalshi line shopping app has meaningful traction: not found.

## 9. Data and odds APIs available to an indie developer

### Takeaway
An indie can start for $0-$60/month with The Odds API (polling, limited props) and free exchange APIs (Kalshi, Polymarket), but real-time multi-book props and deep coverage jump to $300-$5,000+/month, and account-sync (SharpSports) has no public pricing.

### Cited Findings
- The Odds API: free 500 credits/month; $30/month for 20K credits; $59 for 100K; $119 for 5M; $249 for 15M; covers DraftKings, FanDuel, BetMGM, Caesars and others; moneyline/spreads/totals/futures, with player props and alternates only for selected US sports and books; historical odds included; Kalshi/Polymarket not mentioned on the pricing page — [The Odds API](https://the-odds-api.com/)
- The Odds API is REST polling only (no streaming) per a competitor comparison — [SharpAPI comparison](https://sharpapi.io/compare/real-time-odds-api)
- SportsGameOdds: public pricing roughly $99-$499/month, Pro at $299/month billed annually, free tier and 7-day trial, claims 85+ books — [SportsGameOdds](https://sportsgameodds.com/compare/opticodds); [SportsGameOdds comparison hub](https://sportsgameodds.com/compare)
- OddsBlaze: published pricing from $29 to $249/month, no free tier; WebSocket delivers raw odds only (per competitor pages) — [OddsPapi pricing comparison](https://oddspapi.io/blog/?p=2498); [SharpAPI comparison](https://sharpapi.io/compare/real-time-odds-api)
- OpticOdds: no public pricing; reported to start around $5,000/month (one source says per sport); 200+ books; enterprise focus — [SportsGameOdds blog](https://sportsgameodds.com/blog/optic-odds-vs-sports-game-odds); [Odds-API.io comparison](https://odds-api.io/compare/optic-odds)
- OddsJam API: pricing not published; community-reported around $5,000/month per sport; one page lists a $999/month top developer tier — [OddsPapi](https://oddspapi.io/blog/?p=2860); [SportsAPIs.dev](https://sportsapis.dev/apis/odds-jam)
- SportsDataIO: rough third-party range $100-$1,000+/month, bundled with stats/projections; no verified 2026 price sheet — [SportsAPIs.dev](https://sportsapis.dev/apis/sportsdata-io)
- Sportradar and most enterprise feeds quote by sales call ("4 of 5 vendors") — [OddsPapi](https://oddspapi.io/blog/?p=3926); [SharpAPI](https://sharpapi.io/compare/sportradar-alternative)
- Newer indie-priced entrants competing on price/streaming: SharpAPI, OddsPapi, Odds-API.io — [SharpAPI pricing](https://sharpapi.io/pricing); [OddsPapi](https://oddspapi.io/blog/?p=2926); [Odds-API.io](https://odds-api.io/blog/best-odds-apis-2026)
- Kalshi API: third-party guides say API access is free for verified (KYC'd) users and you pay only trading fees; Kalshi's Builder Codes and $2M+ grants pay developers — [AlphaScope guide](https://www.alphascope.app/blog/kalshi-api); [Allium](https://allium.so/blog/kalshi-api-what-kyc-and-fees-mean-for-access/); [Kalshi News](https://news.kalshi.com/p/kalshi-solana-tokenized-predictions)
- Polymarket API: public docs; Builders Program tiers (100 relayed transactions/day unverified; 10,000/day verified by approval), fee monetization and grants — [Polymarket docs](https://docs.polymarket.com/builders/tiers)
- Unified prediction-market data APIs: Dome (YC F25), Oddpool (paid tiers), Predexon — [YC: Dome](https://ycombinator.com/companies/dome); [Oddpool pricing](https://oddpool.com/pricing); [Predexon docs](https://docs.predexon.com/rate-limits)
- SharpSports: account-linking/bet-sync API; pricing not public — [SharpSports docs](https://docs.sharpsports.io/docs)

### Inferences
- Budget tiers for an indie: (1) $0-$60/month: The Odds API + Kalshi/Polymarket public APIs is enough for main-market line comparison, alerts and prediction-market tooling; (2) $100-$500/month: SportsGameOdds/OddsBlaze/SharpAPI-class feeds make prop tools possible; (3) $5K+/month: OpticOdds/OddsJam-class feeds are what the incumbents use, which is why indie +EV tools usually have slower or thinner data.
- Prediction-market data being free and officially supported (with builder revenue share) is a structural cost advantage over sportsbook-odds products, where data is scraped and resold at a markup.
- The number of new low-cost odds API vendors publishing SEO comparison pages is itself a sign that "sell picks-and-shovels data to indie builders" is getting crowded.

### Gaps
- Official Kalshi API fee schedule and rate limits were not fetched from Kalshi's own docs.
- SharpSports, Sportradar, OpticOdds actual quotes: not public.
- Terms-of-service restrictions on redistributing odds from each API (important for a commercial app): not reviewed.
- OddsBlaze and SportsGameOdds figures come largely from competitor comparison pages; confirm on vendor sites.

## 10. Recent venture funding and accelerator activity (2024-2026)

### Takeaway
Capital in 2025-2026 is overwhelmingly chasing sports prediction markets and their infrastructure (exchanges, terminals, data APIs), plus sweepstakes operators pivoting into them. Consumer tools (trackers, pick apps, social) raised small rounds; the big adjacent outcomes were acquisitions (OddsJam at up to $160M, Underdog at up to $1.3B).

### Cited Findings
- Novig: $75M Series B led by Pantera (Feb 2026) at a $500M valuation, after an $18M round in Sept 2025 (Forerunner, Perceptive, NFX); $105M+ raised in under a year — [Fortune](https://fortune.com/2026/02/18/sports-prediction-markets-novig-kalshi-polymarket-cftc-pantera-multicoin/); [Covers](https://www.covers.com/industry/novig-announces-funding-round-ahead-of-prediction-market-plans-feb-18-2026)
- ProphetX: $35M (July 2026) led by Parlay Capital and Data Point Capital with FDJ Ventures, Sharp Alpha and others; B2B prediction-market strategy — [Axios](https://www.axios.com/pro/fintech-deals/2026/07/28/prophetx-35m-b2b-prediction-markets); [Covers](https://www.covers.com/industry/prophetx-raises-35m-to-scale-its-sports-prediction-market-platform-july-28-2026)
- Onyx Odds: $20M Series A led by Payward (Kraken) at $220M valuation (June 2026) — [The Block](https://theblock.co/news/deals/2026-06-24-sports-betting-app-onyx-odds-raises-20-million-in-round-led-by-kraken-parent-payward-405997)
- SpeedLabs: $6.5M seed (June 2026) led by Parlay Capital with Bullpen Capital, TA Ventures — [Yogonet](https://www.yogonet.com/international/news/2026/06/02/122572-speedlabs-raises-65-million-seed-round-to-build-aipowered-live-sports-markets)
- Pred: $2.5M led by Accel with Coinbase Ventures' Base Ecosystem Fund (Feb 2026) — [DL News](https://dlnews.com/external/pred-raises-dollar25m-to-build-the-fastest-trading-experience-in-sports-prediction/)
- Kairos: $2.5M seed led by a16z crypto (Feb 2026) — [BlockEden](https://blockeden.xyz/blog/2026/04/21/kairos-a16z-prediction-market-terminal-polymarket-kalshi/)
- Y Combinator: Dome (F25), Valence (W26), Oddpool, the entity — all prediction-market data/execution infrastructure — [YC: Dome](https://ycombinator.com/companies/dome); [YC: Valence](https://www.ycombinator.com/companies/valence); [CoinGape on Oddpool](https://coingape.com/block-of-fame/pulse/how-y-combinator-startup-oddpool-is-set-to-power-kalshis-infrastructure-layer/)
- Polymarket: $2B investment from ICE at roughly a $9B valuation — [DeFiprime](https://defiprime.com/definitive-guide-to-the-polymarket-ecosystem)
- Exchange-funded ecosystem: Kalshi $2M+ builder grants; Polymarket builder grants of $100-$75,000 — [Kalshi News](https://news.kalshi.com/p/kalshi-solana-tokenized-predictions); [DeFiprime](https://defiprime.com/definitive-guide-to-the-polymarket-ecosystem)
- Kalshi and Polymarket founders are reported to be backing a new prediction-market-focused VC fund (headline only) — [The Wealth Advisor](https://www.thewealthadvisor.com/article/kalshi-polymarket-founders-back-new-prediction-market-vc-fund)
- Consumer/adjacent rounds: Splash Sports $14.5M Series B (Oct 2025); Lucra $10M (late 2024) and $20M Series B led by ARK (2026); Outlier about $10M Series A (Dec 2025); DubClub $7.5M Series A (Sept 2024) plus 2026 insider round; Rithmm $2.5M (May 2024) — [BusinessWire, Splash](https://www.businesswire.com/news/home/20251008204652/en/Splash-Sports-Raises-%2414.5M-Series-B-to-Redefine-the-Way-Fans-Compete); [Whalesbook, Lucra](https://www.whalesbook.com/news/English/startupsvc/Lucra-Sports-Raises-dollar20M-Series-B-Led-by-ARK-Invest-Eyes-B2B-Gamification/6a146a09b979113840ca5069); [SignalBase, Outlier](https://www.trysignalbase.com/news/funding/outlier-raises-107m-series-a-for-data-driven-sports-betting); [CB Insights, DubClub](https://www.cbinsights.com/company/dubclub/financials); [CB Insights, Rithmm](https://www.cbinsights.com/company/rithmm/financials)
- M&A: Gambling.com Group / OddsJam up to $160M (closed Jan 2025); IG Group / Underdog up to $1.3B (announced July 30 2026, pending); Splash absorbed Jock MKT; ESPN took Playback's team (Mar 2026); Fliff bought Mojo's trading division — [SBC News](https://sbcnews.co.uk/europe/uk/2025/01/06/gambling-com-ends-buy-of-oddsjam-for-160m/); [Covers](https://www.covers.com/industry/ig-group-to-buy-underdog-expand-us-prediction-market-push-july-30-2026); [Jock MKT](https://jockmkttransfer.splashsports.com); [Awful Announcing](https://awfulannouncing.com/disney/sports-livestream-platform-playback-acquired-espn.html); [PlayUSA](https://www.playusa.com/news/sports-betting-software-mojo-fliff-acquisition/)
- Specialist investors: Sharp Alpha (funds of $10M and $25M; a $150M non-dilutive user-acquisition financing vehicle announced Oct 2025; thesis spans betting, fantasy, gaming and prediction markets); Parlay Capital (pre-seed to Series A at the intersection of sports, wagering and data infrastructure; led SpeedLabs and co-led ProphetX); Bettor Capital (real-money gaming only, explicitly avoids B2C operators, believes operators are shifting spend from acquisition to retention/product) — [CasinoBeats](https://casinobeats.com/2025/10/09/sharp-alphas-lloyd-danzig-prediction-markets-launch-150m-fund/); [Casino.org](https://www.casino.org/news/sharp-alpha-unveils-new-150m-fund-targeting-online-betting/); [F4 Fund: Parlay Capital](https://f4.fund/firms/parlay-capital); [F4 Fund: Bettor Capital](https://f4.fund/firms/bettor-capital)
- Lucra's ARK-led round was pitched publicly as a rare non-AI deal ("when every VC only wants AI") — [Equity podcast listing](https://www.castfox.net/podcast/equity-55848/episode/how-lucra-raised-20m-as-an-esports-play-when-every-vc-only-wants-ai-2626796)
- A community-maintained "Prediction Market Startups Database" exists for tracking this wave — [Next Event Horizon Substack](https://nexteventhorizon.substack.com/p/introducing-the-prediction-market-startups-database)

### Inferences
- Hot themes, in order of capital: (1) CFTC-regulated sports prediction exchanges and brokers; (2) infrastructure on top of them (terminals, unified APIs, data); (3) sweepstakes/fantasy operators converting to prediction distribution; (4) B2B gamification/contest engines (Lucra, Splash's B2B arm); (5) small rounds for AI analytics.
- Cold themes: licensed P2P sportsbooks, athlete stock markets, standalone social betting networks, F2P second-screen apps.
- For a solo developer the relevant signal is not the VC rounds but the builder programs: exchanges are paying third parties to bring volume, which is a distribution-and-revenue path that did not exist in the sportsbook world.
- Regulatory risk is concentrated exactly where the capital is: state challenges to sports event contracts could change the opportunity set quickly.

### Gaps
- No funding news found for Aug-Nov 2026 beyond the Underdog and Oddpool items; the list is not exhaustive.
- No TechCrunch/Sportico/PitchBook totals for 2024-2026 betting-tech venture volume were retrieved.
- Accelerator activity outside YC (e.g., sports-betting-specific accelerators): not found.
- Pikkit's total funding is disputed ($4.4M vs about $9M).

## 11. Observed gaps: product ideas that appear untried or underserved (my inference, labeled as such)

### Takeaway
Everything in this section is inference from the evidence above, not a sourced claim that a gap exists. Absence of search results is weak evidence, and incumbents (especially Pikkit, OddsJam, Action Network) are moving quickly into prediction markets. The most plausible solo-developer openings are narrow utilities that avoid handling money, avoid selling picks, and ride the free prediction-market APIs and builder programs.

### Cited Findings
- Incumbent trackers and odds tools are already extending into prediction markets (Pikkit with Novig/ProphetX, Action BetSync, OddsJam "Prediction Insiders"), which bounds how long any bridge gap stays open — [BetSmart](https://www.betsmart.co/tool-reviews/pikkit); [Action Network](https://www.actionnetwork.com/education/action-network-betsync-prediction-markets-explained); [BettorEdge review](https://bettoredge.com/post/oddsjam-prediction-insiders-review)
- Exchanges pay third-party builders via fee sharing and grants (Kalshi Builder Codes with $2M+ grants; Polymarket builder tiers and $100-$75K grants) — [Kalshi News](https://news.kalshi.com/p/kalshi-solana-tokenized-predictions); [Polymarket docs](https://docs.polymarket.com/builders/tiers); [DeFiprime](https://defiprime.com/definitive-guide-to-the-polymarket-ecosystem)
- State availability of regulated sports prediction products is fragmented (Novig excludes AZ, MI, NV; ProphetX excludes NV; Underdog dropped fantasy in seven states; sweepstakes bans in CA, IN, ME and others) — [DeFi Rate](https://defirate.com/news/sweeps-swaps-fliff-sweepstakes-pivot-prediction-markets/); [Saturday Down South](https://www.saturdaydownsouth.com/news/betting/underdog-gives-up-daily-fantasy-sports-licenses-in-seven-states/)
- Fees materially change prediction-market value versus sportsbook lines (3% gross arb can become 1-2% net or negative) — [DeFi Rate calculators](https://defirate.com/?p=1894)
- Sync quality problems cluster on parlays, voided legs, cash-outs and smaller books — [BetSmart](https://www.betsmart.co/tool-reviews/pikkit)
- Paid-picks commerce is large but unverified and promotional (DubClub volumes; Whop communities) — [TechNexus](https://www.technexus.com/dubclub-makes-it-easier-for-sports-gamblers-to-find-and-follow-betting-experts/); [Whop reviews site](https://whopreviews.pages.dev/sports-picks)
- Frontier LLMs did not beat the market in KellyBench — [Decrypt](https://decrypt.co/364406/ai-beat-sports-betting-market-top-8-models?amp=1)
- Tax withholding created a real consumer dispute in bet-slip resale — [Legal Sports Report](https://www.legalsportsreport.com/230697/propswap-payout-dispute-raises-regulatory-questions-amid-bally-bet-deal/)
- Pools/survivor remain a growing, commissioner-led format consolidated under Splash — [YesPress](https://yespress.io/splash-sports)
- No dedicated startups surfaced for watch/Live Activities/stream-overlay companions — [App Store search sample: Predictive Play](https://apps.apple.com/us/app/id6748275790)

### Inferences
Saturated (avoid as a headline product):
- Generic bet tracker with sync; generic +EV/arbitrage screen; prop hit-rate research; AI pick generator/chatbot; Polymarket terminal, whale tracker, copy-trade bot, Poly-Kalshi arb bot; a new P2P exchange or sweepstakes sportsbook; athlete stock market; paid-picks marketplace.

Possibly underserved (candid, each with the main risk):
1. "True price" translator between sportsbooks and prediction markets for ordinary bettors: American odds, fee- and spread-adjusted, per state legality, with a "best place to make this exact bet" answer including Kalshi, Polymarket US, Novig, ProphetX and books. Cheap to build on free exchange APIs plus The Odds API; monetizable via builder codes/affiliate. Risk: OddsJam/Pikkit/Action ship it as a feature.
2. Cross-venue position and tax ledger: one view of sportsbook bets plus prediction-market positions, with realized P&L by venue type and exportable tax records (the two are plausibly reported and taxed differently; I did not research tax treatment). Risk: Pikkit; needs sync or imports.
3. State-by-state "what can I legally use here and what changed this month" tracker for bettors (sweeps bans, fantasy exits, exchange exclusions). Pure information product; SEO/affiliate monetization. Risk: affiliate media sites cover it piecemeal already.
4. Import without sync: a robust screenshot/email-receipt/CSV bet parser focused on the cases sync handles badly (SGPs, voided legs, cash-outs, small books, prediction-market fills), sold as an add-on or API to small trackers and Discord communities. Risk: accuracy burden; small market.
5. Capper verification as a neutral third party: a public, tamper-evident record service for Discord/Whop pick sellers (timestamped picks graded against closing lines), sold to buyers or to honest cappers as a badge. Risk: cappers with bad records will not opt in; Juice Reel/Pikkit verification exists inside their own walls; DubClub's "consumer marketplace" push may target this.
6. Personal discipline and bankroll coach rather than picks: AI over the user's own history that flags tilt, stake creep, chasing, bad-CLV bet types, and enforces user-set limits. Fits responsible-gambling tailwinds and avoids the "LLMs can't pick" problem. Risk: Pikkit AI already answers questions over history; willingness to pay is unproven.
7. Friend-group ledger for prediction-market and sportsbook action with no money handling: group leaderboards, shared slips, season-long standings, side-bet IOU tracking settled outside the app. Risk: WagerLab-type apps exist; low monetization; virality is hard (Juked, Buzzer).
8. Commissioner tooling for niche pools that Splash does not prioritize (non-NFL sports, custom rules, office/charity pools with no entry-fee handling, international events like the World Cup). Risk: seasonal usage; Splash/RunYourPool breadth is larger than I verified.
9. Live-game companion for open positions: Live Activities/lock-screen/watch widgets showing "what I need" across all open bets and exchange positions, with hedge/cash-out math against live prediction-market prices. Risk: it is a feature; requires live data costs; sportsbooks' own apps do Live Activities for their own bets (not verified here).
10. Hedge and exit calculator that uses prediction markets as the hedge leg for sportsbook futures/parlays (the function PropSwap/WagerWire serve via resale, without the resale). Risk: thin liquidity on long-tail markets; niche audience.
11. Small Kalshi-native consumer apps under Builder Codes aimed at sports fans rather than traders (e.g., a simple pick'em or bracket front-end that routes real orders). Risk: regulatory status of front-ends (introducing-broker questions; Onyx/Fliff/Rebet are registering as IB/FCM), platform dependence, state challenges.

Cross-cutting cautions for a solo developer:
- Anything that takes custody of money, matches wagers, or sells entry into prize contests needs a legal wrapper that the record shows is expensive and unstable.
- Anything that depends on scraping sportsbook accounts or odds inherits fragility and data cost.
- The window for sportsbook-to-prediction-market bridge tools is open now mainly because the market moved faster than incumbents; expect it to close.

### Gaps
- None of these gaps were validated with user research; Reddit and forum demand signals were not retrievable in this session.
- I did not verify whether specific small apps already do items 1, 2, 9 or 10; absence from my searches is not proof of absence.
- Legal questions I did not research: whether routing users to Kalshi/Polymarket via builder codes requires registration (IB/FCM) for the front-end developer; tax treatment differences between sportsbook wagers and event contracts; app-store policy on real-money prediction-market front-ends.
