# Data provenance

Every document here is synthetic. All of it was written by hand for this repo on 2026-10-30. Supplier and customer names, addresses, organisation numbers, invoice numbers, bank giro numbers and amounts are invented. Any match with a real company or number is a coincidence. No emails appear in the documents.

Dataset version: `invoices-v1` (16 documents).

## Files

- `docs/INV-001.txt` to `docs/INV-016.txt`: plain-text invoice-like documents in Swedish, English and Danish.
- `gold.json`: hand labels for nine fields per document (`supplier`, `invoice_number`, `invoice_date`, `due_date`, `currency`, `net`, `vat`, `total`, `org_number`). Each value has the exact `quote` it was read from and a character `span: [start, end]` into the file. A field with no reliable value has `value: null` and a `reason`. `expected_findings` lists errors that are on the paper itself.
- `scripts/add-spans.ts` (in the repo root) recomputes the spans from the quotes and fails if a quote is not an exact, unique substring.

## Labelling rules

- `org_number` is the supplier's Swedish organisation number only. Foreign registration numbers (CVR, Y-tunnus, EIN, UK VAT) and the customer's org. no are not it, so those documents have `null`.
- A date like `03/04/2026` where nothing decides day or month is `null` (ambiguous). `09/14/2026` is not ambiguous (14 cannot be a month).
- `kr` alone is `null` for currency: it can be SEK, NOK or DKK.
- A due date is only labelled when it is written. "30 dagar netto" is not a due date.
- Amounts are labelled as written, even when they do not add up (INV-005). The validator is expected to flag that.

## What each document tests

| Doc | Case |
| --- | --- |
| INV-001 | complete, Swedish |
| INV-002 | English, EUR, written-out dates, reverse charge VAT 0, customer org. no as a distractor |
| INV-003 | no due date, only payment terms |
| INV-004 | UK supplier, no Swedish org. no |
| INV-005 | net + vat does not equal total |
| INV-006 | ambiguous dates 03/04/2026 and 03/05/2026 |
| INV-007 | due date before invoice date |
| INV-008 | reverse charge, buyer's VAT number as a distractor |
| INV-009 | order confirmation with no invoice number |
| INV-010 | currency only "kr", dotted dates |
| INV-011 | two labels per line, subtotal and discount distractors |
| INV-012 | US dates, USD, subtotal line |
| INV-013 | credit note with negative amounts |
| INV-014 | partly illegible scan, six fields missing |
| INV-015 | held-out: Danish labels and dashed dates |
| INV-016 | held-out: invoice number without a label, net under "Summa" |

INV-015 and INV-016 were written after the fixture reading rules in `src/model/heuristics.ts` were frozen and were not used to tune them. The other fourteen were written alongside the rules, so the fixture score on them is close to perfect by construction.
