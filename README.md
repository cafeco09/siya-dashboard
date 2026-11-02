# Her Education, In Context · SIYA Dashboard

A public dashboard by Anshul Dixit, connecting girls’ education with women’s work, safety and population.

- **Dashboard:** https://cafeco09.github.io/siya-dashboard/
- **Live SIYA and outreach:** https://her-education-dashboard.onrender.com/#agent
- **Ann-On-Ally:** https://cafeco09.github.io/ann-on-ally/

## What is published here

The static dashboard, its public source data, charts, definitions and calculation notes. The self-contained index.html embeds the public datasets in gzip form and restores downloadable JSON/CSV files in the browser; it uses the browser’s DecompressionStream API. GitHub Pages serves this repository’s main branch at the root. No build or provider key is required.

The live SIYA engine and outreach approval, sending and tracking service run separately. This repository contains no authority recipient directory, private email records, credentials or backend implementation. The Agent Outreach chapter links to the live workspace.

## Measures

Women’s workforce share uses World Bank SL.TLF.TOTL.FE.ZS: women in the labour force divided by the total labour force of both sexes, multiplied by 100. The female-population chart divides a country’s female population by the same-year world female population. Original participation and employment measures retain their own denominators.

Education records can cover different ages, sexes, years and geographic areas. The combined violence and insecurity index is not a victim count or prevalence percentage. Missing values remain unavailable. Country associations do not establish causes.

## Sources and reuse

Source URLs and qualifications are retained in the downloadable datasets and the dashboard’s Evidence chapter. Source data retain their respective publishers’ terms. No software licence is granted by this publication.

## Local preview

Run `python3 -m http.server 8000` in this directory and open http://localhost:8000/.
