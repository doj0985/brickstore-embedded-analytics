"""Shared HTTP client for outgoing Databricks API calls.

Centralising the session here gives us connection pooling and a single retry
policy so transient 5xx / network errors don't surface as user-visible failures.
"""

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

_retry = Retry(
    total=3,
    backoff_factor=0.5,
    status_forcelist=(500, 502, 503, 504),
    allowed_methods=("GET", "POST"),
    raise_on_status=False,
)
_adapter = HTTPAdapter(max_retries=_retry, pool_connections=10, pool_maxsize=20)

session = requests.Session()
session.mount("https://", _adapter)
session.mount("http://", _adapter)
