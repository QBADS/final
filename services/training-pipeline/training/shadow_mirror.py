"""
"8. Champion, Challengers and the Promotion Path" - real shadow/canary
traffic mirroring (QBADS_Training_Learning_Architecture.pdf, Section 08).

promotion.py's `_shadow_canary_recheck` re-evaluates a challenger on the
validation split and a random subset - useful as a stress test, but it
never touches real traffic. This module is the genuine mirroring mechanism
that sits alongside it:

  1. Real traffic source - `services/quantum-pipeline` doesn't log/expose
     recent inference inputs anywhere (checked: `app/main.py`'s `/infer`
     takes a request and returns a response, nothing is retained beyond
     `feedback_log`, which stores post-hoc verdicts, not the original
     8-dim vectors; `/feedback`'s schema confirms this - see
     `app/schemas.py`). So this instead mirrors using Middleware's
     `GET /api/dashboard/transactions` when Middleware is running on
     :4000 - genuinely real, submitted transactions, not synthetic data.
     Middleware doesn't expose the exact 8-dim quantum-encoded vector it
     derived for each transaction either (`vectorStandardization.ts`'s
     output isn't persisted/returned), so `_vector_from_transaction` below
     builds a vector from each transaction's own real numeric fields using
     a fixed encoding. What matters for a mirroring/agreement check is that
     both models score the *identical* input, not that the encoding
     reproduces Middleware's internal one exactly.
  2. Fallback - when Middleware is unreachable or has no transactions yet
     (e.g. a freshly booted sandbox with nothing submitted), this falls
     back to the existing validation-split-based recheck, clearly labeled
     as a fallback in the returned report rather than silently swapped in.
  3. Scoring - both the frozen champion (loaded from its registry artifact
     via recalibration/model_loader.py's `load_frozen_model` - already
     built for exactly this: reconstruct a read-only predict_proba from a
     registry artifact without ever calling `.fit()`) and the challenger
     (already in memory this cycle) score every mirrored record directly,
     in-process - real inference, just not through the live HTTP API,
     which the task explicitly allows.
  4. Comparison - agreement rate (fraction where both models' binary
     decisions match) and score drift (mean/max absolute probability
     difference) between champion and challenger.

This is additional to `_shadow_canary_recheck` in promotion.py, not a
replacement - that recheck remains a valid stress test regardless of
whether real traffic exists yet.
"""

import logging
from dataclasses import dataclass, field

import numpy as np
import requests

from .config import settings
from .dataset_builder import DatasetBundle
from .models import TrainedCandidate

logger = logging.getLogger("training-pipeline.shadow_mirror")

# A fixed subset of Middleware's real transaction fields
# (services/middleware/src/domainTypes.ts's RawTransactionInput), chosen to
# mirror the highest-signal "core" fields vectorStandardization.ts itself
# never PCA-reduces (amount, crossBorderFlag, newDeviceFlag, mfaUsed,
# merchantCategory-adjacent risk) plus behavioural/device signals - eight
# real numeric/boolean fields for an 8-dim vector, each with a documented,
# fixed scaling range into [0, 1] before the pi angle-encoding scale used
# throughout this pipeline (feature_engineering.py does the same [0, pi]
# scaling for the synthetic path).
_FIELD_SCALES = {
    "amount": 5000.0,
    "transactionVelocity1h": 20.0,
    "distanceFromHomeKm": 2000.0,
    "merchantRiskScore": 100.0,  # already 0-100
    "chargebackHistory": 10.0,
}


def _vector_from_transaction(tx: dict) -> np.ndarray | None:
    """Builds an 8-dim [0, pi]-scaled vector from one real Middleware
    transaction's own fields. Returns None if the row doesn't look like a
    real transaction record (defensive - a malformed/partial row from an
    unexpected Middleware version shouldn't crash a shadow-mirror pass)."""
    try:
        amount = min(float(tx["amount"]), _FIELD_SCALES["amount"]) / _FIELD_SCALES["amount"]
        cross_border = 1.0 if tx["crossBorderFlag"] else 0.0
        new_device = 1.0 if tx["newDeviceFlag"] else 0.0
        mfa_absent = 0.0 if tx["mfaUsed"] else 1.0
        velocity = min(float(tx["transactionVelocity1h"]), _FIELD_SCALES["transactionVelocity1h"]) / _FIELD_SCALES["transactionVelocity1h"]
        device_distrust = 1.0 - (float(tx["deviceTrustScore"]) / 100.0)  # inverted: higher = riskier
        merchant_risk = float(tx["merchantRiskScore"]) / _FIELD_SCALES["merchantRiskScore"]
        chargebacks = min(float(tx["chargebackHistory"]), _FIELD_SCALES["chargebackHistory"]) / _FIELD_SCALES["chargebackHistory"]
    except (KeyError, TypeError, ValueError):
        return None

    raw = np.array([amount, cross_border, new_device, mfa_absent, velocity, device_distrust, merchant_risk, chargebacks])
    raw = np.clip(raw, 0.0, 1.0)
    if settings.feature_dimension != len(raw):
        # Defensive resize if FEATURE_DIMENSION is ever reconfigured away
        # from 8 - truncate or zero-pad rather than silently mis-shaping.
        resized = np.zeros(settings.feature_dimension)
        resized[: min(len(raw), settings.feature_dimension)] = raw[: settings.feature_dimension]
        raw = resized
    return raw * np.pi


def _dashboard_token() -> str | None:
    """Middleware's dashboard API requires a real bearer token
    (dashboardAuth.ts) - logs in as a real (read-only, exec-admin role)
    dashboard user via the same POST /api/dashboard/auth/login route the
    actual dashboard UI uses, rather than bypassing auth."""
    url = f"{settings.middleware_url}/api/dashboard/auth/login"
    try:
        res = requests.post(
            url,
            json={"username": settings.middleware_dashboard_username, "password": settings.middleware_dashboard_password},
            timeout=5,
        )
        res.raise_for_status()
        return res.json()["token"]
    except (requests.RequestException, KeyError, ValueError) as err:
        logger.info("shadow mirror: could not authenticate to middleware dashboard API at %s (%s) - will fall back", url, err)
        return None


def _fetch_real_transactions(limit: int) -> list[dict] | None:
    token = _dashboard_token()
    if token is None:
        return None
    url = f"{settings.middleware_url}/api/dashboard/transactions"
    try:
        res = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=5)
        res.raise_for_status()
        rows = res.json()
    except requests.RequestException as err:
        logger.info("shadow mirror: middleware not reachable at %s (%s) - will fall back", url, err)
        return None
    if not rows:
        logger.info("shadow mirror: middleware reachable but has no real transactions yet - will fall back")
        return None
    return rows[:limit]


@dataclass
class ShadowMirrorReport:
    source: str  # "live_middleware_transactions" | "validation_split_fallback" | "unavailable"
    sample_count: int
    agreement_rate: float  # 1.0 = champion and challenger always agree on the binary decision
    mean_score_drift: float
    max_score_drift: float
    champion_flagged_rate: float
    challenger_flagged_rate: float
    details: dict = field(default_factory=dict)


def _real_traffic_vectors() -> np.ndarray | None:
    rows = _fetch_real_transactions(settings.shadow_mirror_window)
    if not rows:
        return None
    vectors = []
    for row in rows:
        tx = row.get("tx", row)  # dashboard rows are {tx, decision, institutionName}
        v = _vector_from_transaction(tx)
        if v is not None:
            vectors.append(v)
    if not vectors:
        logger.info("shadow mirror: fetched %d real transactions but none had the expected fields - will fall back", len(rows))
        return None
    return np.stack(vectors)


def mirror_and_compare(
    champion_entry: dict | None,
    challenger: TrainedCandidate,
    bundle: DatasetBundle,
) -> ShadowMirrorReport:
    """The real mirroring step: score genuinely real traffic (or the
    documented validation-split fallback) with both the frozen champion and
    the challenger, and report agreement/drift between them."""
    x = _real_traffic_vectors()
    if x is not None:
        source = "live_middleware_transactions"
        logger.info("shadow mirror: mirroring %d real Middleware transactions to %s", len(x), challenger.model_type)
    else:
        if len(bundle.validation.y) == 0:
            logger.info("shadow mirror: no real traffic available (middleware unreachable/empty) and no validation split - skipping")
            return ShadowMirrorReport(
                source="unavailable", sample_count=0, agreement_rate=1.0, mean_score_drift=0.0, max_score_drift=0.0,
                champion_flagged_rate=0.0, challenger_flagged_rate=0.0,
                details={"note": "no real traffic and no validation split to fall back to"},
            )
        x = bundle.validation.x
        source = "validation_split_fallback"
        logger.info(
            "shadow mirror: no real Middleware traffic available - falling back to validation-split mirroring (%d records)",
            len(x),
        )

    challenger_proba = challenger.predict_proba_fn(x)
    challenger_pred = (challenger_proba >= 0.5).astype(int)

    if champion_entry is None:
        logger.info("shadow mirror: no incumbent champion registered yet - nothing to mirror the challenger against")
        return ShadowMirrorReport(
            source=source, sample_count=int(len(x)), agreement_rate=1.0, mean_score_drift=0.0, max_score_drift=0.0,
            champion_flagged_rate=0.0, challenger_flagged_rate=float(challenger_pred.mean()),
            details={"note": "no incumbent champion - first-ever promotion, nothing to compare against"},
        )

    from .recalibration.model_loader import load_frozen_model

    champion_predict = load_frozen_model(champion_entry)
    champion_proba = champion_predict(x)
    champion_pred = (champion_proba >= 0.5).astype(int)

    agreement_rate = float((champion_pred == challenger_pred).mean())
    drift = np.abs(champion_proba - challenger_proba)

    report = ShadowMirrorReport(
        source=source,
        sample_count=int(len(x)),
        agreement_rate=agreement_rate,
        mean_score_drift=float(drift.mean()),
        max_score_drift=float(drift.max()),
        champion_flagged_rate=float(champion_pred.mean()),
        challenger_flagged_rate=float(challenger_pred.mean()),
        details={"championVersion": champion_entry["version"], "challengerModelType": challenger.model_type},
    )
    logger.info(
        "shadow mirror [%s, n=%d]: agreement=%.3f meanDrift=%.4f championFlagRate=%.3f challengerFlagRate=%.3f",
        report.source, report.sample_count, report.agreement_rate, report.mean_score_drift,
        report.champion_flagged_rate, report.challenger_flagged_rate,
    )
    return report
