# Brickstore: multi-tenant embedded analytics on Databricks

Brickstore is a fictional B2B marketplace where independent brick sellers sell to
buyers. This project gives every seller a private analytics portal inside the
Brickstore web app: an embedded AI/BI dashboard plus Genie (chat and Agent Mode)
for plain-English questions. The sellers are not Databricks users, and each one
sees only its own store.

It started from the Databricks embedded-analytics demo (see [License](#license)).
The app expects the seller data to already be in Unity Catalog: governed gold
tables and metric views with a per-seller row filter, an AI/BI dashboard, and a
Genie space built on them.

## The business problem

**Brickstore's problem is not a lack of data. It is getting that data to its
sellers in a form they can act on.**

Brickstore is a B2B marketplace. It holds rich data about every seller's store:
orders, returns, reviews, and fulfillment. The sellers are not Databricks users;
they are Brickstore's customers, and they expect answers inside the Brickstore
app. That is hard to build well:

- A custom analytics feature means a BI layer, a charting interface, a
  natural-language interface, and per-seller security, all built and maintained
  by the product team.
- Isolation is the risky part. One filter missed in application code shows one
  seller another seller's data.
- Even with charts, sellers cannot ask their own follow-up questions. They see
  that a number moved and have to guess why.

**What embedding AI/BI and Genie changes for Brickstore**

| | Outcome for Brickstore | How this build delivers it |
|---|---|---|
| Faster to market | The product team embeds analytics instead of building it. | One dashboard and one Genie space serve every seller. Adding a seller needs a service principal, a tenant mapping, and a login, but no new dashboard or Genie space. |
| A stickier platform | Sellers get answers and root causes, not just charts, so they come back. Seller retention is the KPI to watch. | Genie Agent Mode runs multi-step research on a seller's own data, and AI reads the review text to tag defect themes. |
| Governed by default | Security stays in the data layer instead of being scattered through app code. | Unity Catalog governs the tables. A row filter tied to a per-seller service principal scopes Genie, and the dashboard scopes by the embedding token's company claim. |

These are the design goals. This repo demonstrates the mechanism, not measured
business results.

### What a seller sees in the demo

Apex has a record Q4 2025 (about $256K in gross sales) while its return rate
jumps from roughly 6% to 14.6% and refunds reach about $59K against a usual ~$7K.
Asked why, Genie's agent traces it to one product, Castle Fortress 1200, with a
28.1% return rate and about $65.6K in refunds, and the reviews say "missing
pieces". The seller can act on that: fix the supplier or pause the listing. All
data is synthetic.

## How each seller is kept separate

Two mechanisms, one shared dashboard and one shared Genie space:

- **Dashboard:** the app mints an embedding token whose external-value claim is
  the viewer's company. Every dashboard query filters on that claim.
- **Genie:** the app calls Genie as a per-tenant service principal. A Unity
  Catalog row filter (`rls_company`) then limits what that principal can read.
  Asking "What is our total GMV?" returns $938,223.67 for Apex and $417,500.57
  for Synergy from the same space.

The app's own login token travels in an `X-JWT-Authorization` header, because the
Databricks Apps proxy reserves the standard `Authorization` header.

## Architecture

```
 brickstore_gold (tables, metric views, row filter per tenant)
        |                         |
   AI/BI dashboard           Genie space ---- chat API / Agent Mode (SSE)
        \                         /
         Flask + React app  (Databricks Apps)  ---- Lakebase (history, research traces)
                |
        seller logs in -> sees only their own store
```

## Run it

Local development:

```
cp .env.example .env                       # fill in the values
pip install -r requirements.txt
python app.py                              # backend on :5000
cd frontend && npm install && npm start    # frontend on :3000, proxies /api to :5000
```

Demo logins: `carl@apex.com` (Apex) and `robyn@synergy.com` (Synergy), password
`Demo1234!`.

Deploy to Databricks Apps. First replace the `<...>` placeholders in `app.yaml`
with your dashboard ID, Genie space ID, tenant service principal client IDs, and
Lakebase host. Tenant client secrets come from a secret scope via `valueFrom`,
never from the repo:

```
cd frontend && npm run build
databricks sync . <workspace-path>
databricks apps deploy <app-name> --source-code-path <workspace-path>
```

## Things to know

- The data is synthetic.
- Genie Agent Mode and chart download are newer Databricks features. The app
  requests both; if a workspace does not have them, charts are simply hidden and
  Agent Mode returns a clear error.
- This is a reference build, not a click-and-deploy product. Add production
  security and error handling before real use.

## Learn more

- [Databricks AI/BI](https://www.databricks.com/product/ai-bi)
- [Dashboard embedding](https://docs.databricks.com/aws/en/dashboards/embed)
- [Genie API](https://docs.databricks.com/api/workspace/genie)

## License

&copy; 2025 Databricks, Inc. All rights reserved. The source in this project is provided subject to the Databricks License [https://databricks.com/db-license-source].  All included or referenced third party libraries are subject to the licenses set forth below.

| library | description | license | source |
|----------------------------------------|-------------------------|------------|-----------------------------------------------------|
| **Flask** | Lightweight WSGI web application framework | BSD 3-Clause | https://github.com/pallets/flask |
| **Flask-SQLAlchemy** | Extension for Flask that adds support for SQLAlchemy | MIT | https://github.com/pallets/flask-sqlalchemy |
| **SQLAlchemy** | SQL toolkit and ORM | MIT | https://github.com/sqlalchemy/sqlalchemy |
| **psycopg** | PostgreSQL database adapter | LGPL-3.0 | https://github.com/psycopg/psycopg |
| **gunicorn** | Python WSGI HTTP server | MIT | https://github.com/benoitc/gunicorn |
| **requests** | Library for making HTTP requests | Apache 2.0 | https://github.com/psf/requests |
| **databricks-sdk** | Databricks SDK for Python | Apache 2.0 | https://github.com/databricks/databricks-sdk-py |
| **Flask-JWT-Extended** | Extension for handling JSON Web Tokens in Flask | MIT | https://github.com/vimalloc/flask-jwt-extended |
| **Flask-CORS** | Extension for handling Cross-Origin Resource Sharing in Flask | MIT | https://github.com/corydolphin/flask-cors |
| **Flask-Limiter** | Rate limiting for Flask | MIT | https://github.com/alisaifee/flask-limiter |
| **python-dotenv** | Library for loading environment variables from .env files | MIT | https://github.com/theskumar/python-dotenv |
| **axios** | Promise based HTTP client for the browser and node.js | MIT | https://github.com/axios/axios |
| **@emotion/react** | Library for building robust, customizable, and performant UI components with React | MIT | https://github.com/emotion-js/emotion |
| **@emotion/styled** | Library for building robust, customizable, and performant UI components with React | MIT | https://github.com/emotion-js/emotion |
| **@fontsource/roboto** | Font package for Roboto | Apache-2.0 | https://github.com/fontsource/fontsource |
| **@mui/icons-material** | Material Design icons for React | MIT | https://github.com/mui-org/material-ui |
| **@mui/material** | Material Design components for React | MIT | https://github.com/mui-org/material-ui |
| **react** | JavaScript library for building user interfaces | MIT | https://github.com/facebook/react |
| **react-dom** | React package for working with the DOM | MIT | https://github.com/facebook/react |
| **react-markdown** | Render markdown as React components | MIT | https://github.com/remarkjs/react-markdown |
| **remark-gfm** | GitHub Flavored Markdown support for remark | MIT | https://github.com/remarkjs/remark-gfm |
| **react-router-dom** | DOM bindings for React Router | MIT | https://github.com/remix-run/react-router |
| **react-scripts** | Scripts and configuration used by Create React App | MIT | https://github.com/facebook/create-react-app |
| **cra-template** | Template for Create React App | MIT | https://github.com/facebook/create-react-app |
| **@databricks/aibi-client** | Databricks AI & BI Client | MIT | https://github.com/databricks/aibi-client |
---

Databricks support doesn't cover this content. For questions or bugs, please open a github issue and the team will help on a best effort basis.
