# Roadmap

What exists today is the compliance core: the pay arithmetic, the rules, and
WH-347 output. That is the defensible part and the part that is hardest to get
right, so it was built first. Everything below turns it into a product.

## Next

**Wage determination lookup.** Rates are entered by hand per project today.
SAM.gov publishes determinations free, searchable by contract and by county and
construction type. Fetching and caching them removes the most tedious and most
error-prone setup step, and a stale-determination check ("your contract locked
to NY20260012, which was superseded in June") is a rule nobody else offers.

**The official fillable PDF.** `render_text` is readable but it is not the
government's form. Filling the DOL's fillable WH-347 needs the PDF as an overlay
target and a field map. `build_payload()` already returns exactly the data that
mapping consumes.

**State portal adapters.** This is the moat, and it is unglamorous on purpose.
California's DIR eCPR wants XML. LCPtracker wants its own CSV. Individual
agencies have their own forms. Each adapter is a small, well-tested translation
from `build_payload()`. The library of them is what a competitor cannot clone in
a weekend, and it grows one customer request at a time.

**Payroll system import.** QuickBooks, Gusto, ADP, and Foundation all export
payroll registers. Mapping their exports directly removes the hand-entry step
entirely and is what makes the weekly habit stick.

## Later

**Multi-week projects.** Payroll numbering is sequential per contract, gaps get
noticed on audit, and the final payroll must be marked final. Tracking a
project's payroll series makes "you skipped number 14" a check we can run.

**Fringe annualization.** Contributions to a plan that also covers private work
have to be annualized before they can be credited against Davis-Bacon fringes.
Getting this wrong is a common and expensive finding. It needs data we do not
collect yet.

**Amended payrolls.** Corrections have their own conventions and a paper trail
worth keeping.

## Deliberately not doing

**Running payroll.** Calculating and paying wages means tax tables, filings, and
liability of a different order. WageProof reads what payroll produced and checks
it. Staying on this side of the line keeps the product small enough to be
automated and cheap enough to sell to a four-person sub.

**Legal advice.** Findings cite the regulation and explain the arithmetic. They
do not tell anyone what their contract requires.
