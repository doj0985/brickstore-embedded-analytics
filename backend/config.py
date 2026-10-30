"""Centralised configuration. Read once at import; fail fast on missing values.

Required values raise RuntimeError at import time so a misconfigured deploy
never reaches a state where it accepts traffic.
"""

import os


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


DEBUG = bool(os.environ.get("FLASK_DEBUG"))

# Genie Agent Mode (SSE Responses) and the "viz" chart attachment API are both
# enabled on the workspace and requested unconditionally. If either preview were
# disabled again, the API returns FEATURE_DISABLED, which the routes raise as
# FeatureDisabledError and surface cleanly (the client just hides the chart).

DATABRICKS_HOST = _required("DATABRICKS_HOST")
DATABRICKS_CLIENT_ID = _required("DATABRICKS_CLIENT_ID")
DATABRICKS_CLIENT_SECRET = _required("DATABRICKS_CLIENT_SECRET")
DATABRICKS_WORKSPACE_ID = _required("DATABRICKS_WORKSPACE_ID")
DATABRICKS_DASHBOARD_ID = _required("DATABRICKS_DASHBOARD_ID")

# Lakebase (autoscale Postgres) backing the Genie chat history. The app connects
# AS its own service principal (DATABRICKS_CLIENT_ID) using short-lived OAuth
# tokens minted at connect time — no static DB password. LAKEBASE_HOST has no
# default: set it to your endpoint's host (app.yaml does this when deployed).
LAKEBASE_ENDPOINT = os.environ.get(
    "LAKEBASE_ENDPOINT",
    "projects/aibi-embedding-chat/branches/production/endpoints/primary",
)
LAKEBASE_HOST = os.environ.get(
    "LAKEBASE_HOST",
    "",
)
LAKEBASE_DATABASE = os.environ.get("LAKEBASE_DATABASE", "databricks_postgres")
LAKEBASE_SCHEMA = os.environ.get("LAKEBASE_SCHEMA", "genie_chat")

# Session/JWT signing keys. These only need to be *stable* — the same value
# across all gunicorn workers and across restarts — so Flask sessions and
# issued JWTs stay valid. A built-in default keeps the app zero-config; set the
# matching env var to override (e.g. to rotate or pull from a secret scope).
#
# DEMO ONLY: the defaults below are public, throwaway values that exist so the
# demo runs with zero setup. They are not Databricks credentials. Anything beyond
# a demo must set FLASK_SECRET_KEY / JWT_SECRET_KEY (see .env.example) instead.
_DEFAULT_FLASK_SECRET_KEY = "c7cd4f68466a0e4ba606bd8e30404b681060ad5377719f57bb15d4474d433fc1"
_DEFAULT_JWT_SECRET_KEY = "1cd8d4176b38abb7cb007cab4ddc79d069f3d0d0000c7930393440c12f001f0b"

FLASK_SECRET_KEY = os.environ.get("FLASK_SECRET_KEY") or _DEFAULT_FLASK_SECRET_KEY
JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY") or _DEFAULT_JWT_SECRET_KEY

# The app's JWT travels in a custom header, NOT the standard Authorization
# header. The Databricks Apps front-door OAuth proxy reserves Authorization for
# its own session auth and does not forward it to the app, so a JWT sent there
# never arrives and every authenticated call 401s. A custom header passes
# through untouched.
JWT_HEADER_NAME = os.environ.get("JWT_HEADER_NAME", "X-JWT-Authorization")

# CORS origins for the dev API surface. The deployed Databricks App serves the
# React build from the same origin, so CORS is only needed locally.
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
