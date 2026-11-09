# Public project source

This directory contains the dashboard, Node.js backend, outreach implementation and integration tests. The private Frontier implementation, its architecture documents and model evaluation records are intentionally excluded. No private repository commits or history are imported.

## Run

Use Node.js 22–24. Run `npm ci` and `npm start` here. The dashboard is served from `public/`. SIYA model requests, `npm run check` and the full integration suite require the separately supplied private `frontier/` dependency; they do not work as a complete standalone model from this public checkout. Do not publish that dependency.

The authority directory retains public authority metadata but recipient email fields are blank in this public copy. Configure and verify recipients privately before enabling outreach. Credentials and database records are not included; configure secrets through server environment variables. Do not upload `.env` files.

The repository-root `index.html` remains the self-contained GitHub Pages dashboard. This source snapshot does not change the live private deployment.

No software licence is granted by publication. Source datasets retain their publishers' terms.
