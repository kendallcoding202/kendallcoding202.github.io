"""Brand-dependent constants, kept in one place (mirrors engine/brand).

Only these values change on a rename. After changing them, regenerate the
Go demo data and test vectors, then run ``python3 -I sync_schema.py``.
"""

NAME = "Kovyr"
PRODUCT = "Kovyr Proof"
ATTESTATION_BASE = "https://kovyr.com/attestation/"
PREDICATE_POSTURE = ATTESTATION_BASE + "posture/v1"
PREDICATE_ENROLLMENT = ATTESTATION_BASE + "enrollment/v1"
