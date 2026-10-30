import logging
import os

from .http import session

logger = logging.getLogger(__name__)

DATABRICKS_TOKEN_TIMEOUT_SECONDS = 10


def get_dashboard_embedding_oauth_token(external_data, external_viewer_id):
    databricks_host = os.environ['DATABRICKS_HOST']
    databricks_client_id = os.environ['DATABRICKS_CLIENT_ID']
    databricks_client_secret = os.environ['DATABRICKS_CLIENT_SECRET']
    dashboard_id = os.environ['DATABRICKS_DASHBOARD_ID']

    # The OAuth scope limits what the token can do. The custom_claim is passed
    # through to the dashboard's SQL queries for Row-Level Security.
    oauth_scopes = "dashboards.query-execution dashboards.lakeview-embedded:read sql.redash-config:read settings:read"
    custom_claim = f'urn:aibi:external_data:{external_data}:{external_viewer_id}:{dashboard_id}'

    token_url = f"https://{databricks_host}/oidc/v1/token"
    payload = {
        "grant_type": "client_credentials",
        "client_id": databricks_client_id,
        "client_secret": databricks_client_secret,
        "scope": oauth_scopes,
        "custom_claim": custom_claim,
    }

    response = session.post(token_url, data=payload, timeout=DATABRICKS_TOKEN_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()["access_token"]
