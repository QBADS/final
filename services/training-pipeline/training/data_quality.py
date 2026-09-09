"""
"2. Data Quality & Labeling: deduplication - missing-data checks - label
verification - class-balance analysis - PII / privacy controls"
(QBADS_Training_Learning_Architecture.pdf, Section 02). Feeds Gate 1 in
gates.py ("Is this training dataset trustworthy?").
"""

import hashlib
from dataclasses import dataclass, field

import numpy as np

from .data_acquisition import TrainingRecord

VALID_CATEGORIES = {
    "confirmed_fraud",
    "confirmed_legitimate",
    "false_positive",
    "false_negative",
    "suspicious_reviewed",
    "synthetic_fraud",
    "adversarial",
    # Section 03's remaining three categories - see data_acquisition.py's
    # `_generate_new_fraud_pattern_records` / `_generate_cross_institution_records`
    # / `_generate_temporal_behaviour_records` for how each is made genuinely
    # distinct rather than a relabeled copy of one of the seven above.
    "new_fraud_pattern",
    "cross_institution",
    "temporal_behaviour",
}

# Below this share, the minority class is thin enough that a model can hit
# high accuracy by mostly ignoring it - flagged, not auto-failed, since
# fraud detection is inherently imbalanced and some imbalance is expected.
MIN_MINORITY_CLASS_SHARE = 0.15


@dataclass
class QualityReport:
    total_records: int
    duplicates_removed: int
    missing_data_records: int
    invalid_label_records: int
    class_balance: dict
    minority_class_share: float
    pii_fields_detected: list
    passed: bool
    reasons: list = field(default_factory=list)
    # Section 03's ten documented dataset categories - present with a real
    # (possibly zero) count each, so a caller can see at a glance whether
    # all ten are actually represented rather than counting non-zero keys.
    category_counts: dict = field(default_factory=dict)
    categories_present: int = 0
    categories_missing: list = field(default_factory=list)


def _record_hash(r: TrainingRecord) -> str:
    payload = f"{r.institution_id}|{r.timestamp.isoformat()}|{r.raw_features.round(6).tobytes()}"
    return hashlib.sha256(payload.encode()).hexdigest()


# Fields a real institution feed might carry that must never reach a
# training dataset. Synthetic records never populate these, but the check
# runs against the actual record shape rather than assuming that - a schema
# check is only meaningful if it looks at what's really there.
DISALLOWED_PII_FIELDS = {"name", "email", "ssn", "account_number", "phone", "address"}


def run_quality_checks(records: list[TrainingRecord]) -> tuple[list[TrainingRecord], QualityReport]:
    reasons: list[str] = []

    # Deduplication
    seen: set[str] = set()
    deduped: list[TrainingRecord] = []
    for r in records:
        h = _record_hash(r)
        if h in seen:
            continue
        seen.add(h)
        deduped.append(r)
    duplicates_removed = len(records) - len(deduped)

    # Missing-data checks. TrainingRecord holds a numpy array, so equality
    # comparisons (`r in missing`) would try to evaluate an array's truth
    # value and raise - filter by record_id instead.
    missing = [r for r in deduped if not np.all(np.isfinite(r.raw_features))]
    missing_ids = {r.record_id for r in missing}
    clean = [r for r in deduped if r.record_id not in missing_ids]
    if missing:
        reasons.append(f"{len(missing)} records had non-finite raw features and were dropped")

    # Label verification
    invalid_label = [r for r in clean if r.label not in (0, 1) or r.category not in VALID_CATEGORIES]
    invalid_ids = {r.record_id for r in invalid_label}
    clean = [r for r in clean if r.record_id not in invalid_ids]
    if invalid_label:
        reasons.append(f"{len(invalid_label)} records had an invalid label/category and were dropped")

    # Class-balance analysis
    labels = np.array([r.label for r in clean])
    fraud_share = float(labels.mean()) if len(labels) else 0.0
    minority_share = min(fraud_share, 1 - fraud_share)
    class_balance = {
        "legitimate": int((labels == 0).sum()),
        "fraud": int((labels == 1).sum()),
        "fraudSharePct": round(fraud_share * 100, 2),
    }
    if minority_share < MIN_MINORITY_CLASS_SHARE:
        reasons.append(f"minority class share {minority_share:.1%} below {MIN_MINORITY_CLASS_SHARE:.0%} threshold")

    # PII / privacy controls
    pii_found: list[str] = []
    for r in clean:
        pii_found.extend(f for f in r.context.keys() if f.lower() in DISALLOWED_PII_FIELDS)
    pii_found = sorted(set(pii_found))
    if pii_found:
        reasons.append(f"disallowed PII-shaped fields present: {pii_found}")

    # Category coverage - report every one of the ten documented categories
    # (Section 03) with its real count, zero included, rather than only the
    # ones that happen to be non-empty.
    category_counts = {cat: 0 for cat in sorted(VALID_CATEGORIES)}
    for r in clean:
        if r.category in category_counts:
            category_counts[r.category] += 1
    categories_missing = sorted(cat for cat, count in category_counts.items() if count == 0)
    categories_present = len(VALID_CATEGORIES) - len(categories_missing)
    if categories_missing:
        reasons.append(f"dataset categories with zero records: {categories_missing}")

    passed = not invalid_label and not pii_found and minority_share >= MIN_MINORITY_CLASS_SHARE

    report = QualityReport(
        total_records=len(records),
        duplicates_removed=duplicates_removed,
        missing_data_records=len(missing),
        invalid_label_records=len(invalid_label),
        class_balance=class_balance,
        minority_class_share=round(minority_share, 4),
        pii_fields_detected=pii_found,
        passed=passed,
        reasons=reasons,
        category_counts=category_counts,
        categories_present=categories_present,
        categories_missing=categories_missing,
    )
    return clean, report
