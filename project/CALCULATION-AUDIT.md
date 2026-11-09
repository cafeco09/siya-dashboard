# Calculation corrections — 2 November 2026

Reviewed source commit: cf5a6642ad9fe74dee9a79fd0037360334457937.

## Household gaps

“Largest absolute gap first” and “Smallest absolute gap first” sort by the magnitude of the within-survey percentage-point difference. The plotted values, signed difference and subtraction order remain unchanged. Country-name ordering and ordinary country-value charts keep their existing behaviour. For example, Palestine's approximately −8.99-point rural/urban numeracy difference precedes Thailand's approximately +7.98-point difference in descending gap-size order.

## Missing Sudan estimates

Six Population contributions records (labour participation and employment, 2023–2025) have no reported source rate and no calculated count. Their status is now “No source observation; count not calculated”. The rate, count and contribution stay null. No zero or substitute estimate has been inserted.

## Morocco: geographic coverage, not a forced numerical replacement

The World Bank API reproduces all 24 stored observations for 2018–2025 across SP.POP.TOTL, NY.GDP.MKTP.CD and NY.GDP.PCAP.CD. Its source update is 8 October 2026. The GDP-per-capita country-series metadata explicitly states **“Data cover Western Sahara.”** The population country-series metadata identifies UN World Population Prospects as its source. A denominator with matching geographical coverage has not been independently verified.

In 2023, reported GDP is US$146,036,093,666.762; reported population is 37,712,505; reported GDP per capita is US$3,813.72607421875. Dividing the first two gives approximately US$3,872.35. That division is a diagnostic, not a replacement for the published per-capita indicator.

The dashboard therefore preserves every source-reported numerical value, labels GDP per capita as reported, exposes the reconciliation on Snapshot, Work and the country profile, and qualifies GDP scatter comparisons. Relevant Morocco evidence records also carry the geographic note. `public/calculation-audit.json` retains the API request, raw observations, metadata notes and per-year diagnostic values. The warning is computed from the displayed inputs and requires a discrepancy greater than 0.1%; it does not infer a cause from numerical differences alone.

Metadata endpoints:

- https://api.worldbank.org/v2/sources/2/country/MAR/series/NY.GDP.PCAP.CD/metadata?format=json
- https://api.worldbank.org/v2/sources/2/country/MAR/series/SP.POP.TOTL/metadata?format=json

No outreach email was sent and no private mail data were accessed. Frozen V1 code is unchanged.

## Validation

Run `npm test` for the existing tests plus `calculations.test.mjs`, then `npm run check` for build/runtime integrity. New checks exercise real negative-gap ordering, missing Sudan status/null preservation, raw World Bank source preservation, Morocco reconciliation and missing-value behaviour, all same-year population totals and every insecurity-score total.


## World female population share (2 November 2026)

The Population chart now uses country female population divided by **world**
female population for the same year, multiplied by 100. The worldwide denominator
is WDI SP.POP.TOTL.FE.IN for WLD, not the sum of the 28 selected countries.
`public/world-female-population.json` preserves the retrieved 2018–2025 records,
source URL, source update date and retrieval date. Missing or invalid denominators
produce unavailable shares; no other year is substituted. Group filters do not
change the denominator. Existing outcome contribution tables remain explicitly
labelled as using the combined total population of the 28 dashboard countries.


## Workforce denominator (2 November 2026)

The primary workforce charts, snapshot, profile and default GDP scatter now use
World Bank SL.TLF.TOTL.FE.ZS: women in the labour force divided by women and men
in the labour force, multiplied by 100. This is the existing source field at
column 6 of Workforce GDP, not a recalculation of the female participation rate.
The annual chart uses the same measure in every year. Missing observations remain
unavailable. Published participation and employment rates remain separately
labelled with their original female-population denominators. SIYA distinguishes
generic workforce/share requests from explicit participation requests. The frozen
V1 and V4 sources and original dataset remain unchanged. Earlier exploratory
GDP/violence correlations using participation are not estimates for this share.
