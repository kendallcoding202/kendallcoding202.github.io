# Market notes

Recorded so the reasoning behind the product is not lost, and so the
assumptions can be checked later against what actually happens.

## Who this is for

A subcontractor with four to forty field employees on federally funded work.
They file a WH-347 every week for every covered contract. They have a bookkeeper
or an owner's spouse doing it in Excel, and they are terrified of an audit
because they know the spreadsheet is guesswork.

They are not the customer the existing tools are built for.

## The competitive picture

Scanned before building, in August 2026.

**Construction ERPs** — Foundation, Sage 300 CRE, Viewpoint Vista. These
generate WH-347 from payroll data they already hold. Excellent if you own one.
A four-person electrical sub does not own one and will not buy one.

**Agency-side compliance platforms** — LCPtracker, B2Gnow/eComply. These are
sold to the awarding agency, not the contractor. The contractor is a data-entry
user of someone else's system, which is why they are hated.

**Dedicated products** — Certified Payroll Pro, Points North, Passport
Workforce, CEM (on Dynamics). Certified Payroll Pro already does SAM.gov lookups
and 50-state forms, so that ground is occupied.

**The gap.** All of the above generate the form. None of them lead with
*checking the payroll before it is filed*. Generating a WH-347 from bad data
produces a correct-looking form containing a false certification — which is the
actual risk the contractor is afraid of, and the thing they cannot self-diagnose.
That is the wedge, and it is why the compliance engine was built before the PDF.

## Why this survived the filter

The idea was picked over several alternatives that were rejected as
commoditized. The test applied: *can this be described as "upload a document, an
LLM reads it, out comes a report"?* If yes, it has six competitors already and
one of them is free.

This one survives because:

1. **A weekly deadline.** Engagement is structural, not something to nag for.
2. **A penalty behind it.** Withheld contract payments, and debarment for
   repeat failures. The cost of getting it wrong dwarfs the subscription.
3. **Accumulating state.** Payroll series, project history, worker records. A
   customer who leaves mid-contract loses their paper trail.
4. **A format library as moat.** Every state and agency wants the same facts
   shaped differently. That collection is boring, slow to build, and cannot be
   generated from a prompt.

## Acquisition

Search intent is real and specific: *certified payroll software*, *WH-347*,
*how to fill out certified payroll*, *Davis-Bacon compliance*, *prevailing wage
subcontractor*. B2B construction clicks are not cheap, but against a recurring
subscription the economics work in a way they never did for a one-off consumer
purchase.

The free tool that should anchor the funnel is a **WH-347 checker**: paste a
payroll, get the findings, see the dollar figure at risk. It demonstrates the
product's whole value in one screen and needs no account. The paid tier is
saving projects, the payroll series, and the state formats.

**Open question worth answering with real data:** whether these contractors
search at all, or whether they find software through their general contractor,
their bookkeeper, or their trade association. If it is the latter, paid search
is the wrong channel regardless of how good the product is. Worth testing with a
small budget before committing to it.
