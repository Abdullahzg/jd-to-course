# Matching pipeline A/B/C/D, measured 2026-08-09

Same posting (TikTok AI Product Manager, content ecosystem), same six extracted
parts of the job, same 139 course catalog. Two algorithms crossed with two
models. Cost and wall clock from the endpoint's own accounting.

| cell | courses returned | parts covered | wall | cost | verdict |
|---|---|---|---|---|---|
| one call, whole catalog + Haiku | 8 | 4 of 6 | 31s | $0.035 | shipped |
| one call, whole catalog + Sonnet | 5 | 2 of 6 | 55s | $0.104 | over strict |
| funnel (triage, batches) + Haiku | 21 | 5 of 6 | 70s | $0.096 | sprawl |
| funnel (triage, batches) + Sonnet | 6 | 3 of 6 | 89s | $0.266 | slow, dear |

## What the numbers mean

The funnel read courses in batches of eight, so no call ever saw two candidate
courses side by side. On Haiku it returned 21 courses for a product manager
posting, including operations research electives and biomedical deep learning,
each individually defensible and collectively absurd. The whole catalog fits in
one Haiku call with room to spare, and judging everything at once returned 8
courses with distinct, comparative reasons at a third of the cost and less than
half the wall clock.

Sonnet did not buy quality here, on either algorithm. It was stricter to a
fault: on the one call design it left "building product tools and pipelines"
with no claimant at all while charging three times Haiku's price. The refuter
pass also runs on the overridden model, which is why its refusal counts rise
with Sonnet.

## The flaw the test found in the shipped design

One call + Haiku covered 4 of 6 parts; the funnel covered 5, because it kept
Internet Technology, Economics and Policy for "coordinating across policy and
engineering teams" and the one call read dropped it. Strictness bought focus
and paid coverage. Fixed in the prompt: a part of the job with no candidate now
asks for the closest genuine preparation at strength "tangential" rather than
going silently uncovered, and the refuter still gets the final word.
