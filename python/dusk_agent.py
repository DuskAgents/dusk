"""DUSK agent client for Python 3.9+.

    pip install cryptography

    from dusk_agent import Dusk
    dusk = Dusk(os.environ["DUSK_AGENT_KEY"])
    r = dusk.spend("0.0025", "api.vendor.dev/search", request="lithium supply 2026")
    if r["ok"]:
        ...  # pay the seller from your agent wallet

Only the grant id and token are sent to DUSK. The sealing key stays here:
the seller, request and note are sealed with AES-GCM before they leave.
"""
import base64
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.request

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

DEFAULT_URL = "https://duskdot.fun"


def host_of(seller: str) -> str:
    """Seller host, normalized the same way the vault builds the allowlist."""
    return str(seller).strip().lower().split("://")[-1].split("/")[0]


def _unb64(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4))


class Dusk:
    def __init__(self, agent_key: str, url: str = DEFAULT_URL, timeout: float = 15):
        parts = str(agent_key or "").split(".")
        if len(parts) != 3 or not all(parts):
            raise ValueError("Agent key must look like <grantId>.<token>.<sealingKey>")
        self.grant_id, token, sealing = parts
        self._auth = f"Bearer {self.grant_id}.{token}"
        self._key = _unb64(sealing)
        self.base = url.rstrip("/")
        self.timeout = timeout

    # AES-GCM, 12-byte IV prepended. DUSK only ever stores the ciphertext.
    def seal(self, data: dict) -> str:
        iv = os.urandom(12)
        ct = AESGCM(self._key).encrypt(iv, json.dumps(data, separators=(",", ":")).encode(), None)
        return base64.b64encode(iv + ct).decode()

    def open(self, sealed: str) -> dict:
        raw = _unb64(sealed)
        return json.loads(AESGCM(self._key).decrypt(raw[:12], raw[12:], None))

    # HMAC-SHA256(sealingKey, host): lets DUSK check a private allowlist without learning the seller.
    def tag_of(self, seller: str) -> str:
        return hmac.new(self._key, host_of(seller).encode(), hashlib.sha256).hexdigest()

    def _call(self, path: str, body: dict = None) -> dict:
        req = urllib.request.Request(
            self.base + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"authorization": self._auth, "content-type": "application/json", "user-agent": "dusk-agent-python/2.0"},
            method="GET" if body is None else "POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read())
            except Exception:
                return {"ok": False, "error": f"HTTP {e.code}"}

    def limits(self) -> dict:
        return self._call("/api/agent")

    def check(self, amount, seller: str = "") -> dict:
        """Dry run: same checks as spend, nothing is spent or recorded."""
        return self._call("/api/check", {"amount": str(amount), "tag": self.tag_of(seller) if seller else ""})

    def status(self, request_id: str) -> dict:
        """Status of a payment waiting for the owner: pending, approved, declined or expired."""
        return self._call(f"/api/spend/{request_id}")

    def wait(self, request_id: str, timeout: float = 1800, every: float = 5) -> dict:
        """Poll until the owner decides. Pay only when status == 'approved'."""
        import time
        end = time.time() + timeout
        while True:
            r = self.status(request_id)
            if not r.get("ok") or r.get("status") != "pending" or time.time() > end:
                return r
            time.sleep(every)

    def spend(self, amount, seller: str, request: str = "", note: str = "") -> dict:
        """Ask DUSK before paying. Pay the seller only when the result has ok == True."""
        sealed = self.seal({"seller": seller, "request": request, "note": note})
        return self._call("/api/spend", {"amount": str(amount), "sealed": sealed, "tag": self.tag_of(seller)})
