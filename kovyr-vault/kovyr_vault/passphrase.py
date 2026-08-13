"""Minimum standards for a new vault passphrase.

This passphrase is the only thing between an attacker and the client's
files, and there is no recovery: if it is weak the vault is weak, and if
it is forgotten the data is gone. So the bar has to be real, and the
rules have to be ones a dental office manager will actually follow rather
than work around.

Deliberately NO composition rules — no "must contain an uppercase letter,
a digit and a symbol". NIST SP 800-63B advises against them precisely
because they produce predictable results: told to add a capital, a digit
and a symbol, people write `Password1!`, which is weaker than four random
words and far harder to remember. Length and a denylist of known-bad
choices do more for real security than a symbol requirement ever did.

What is enforced instead:
  * a genuine minimum length,
  * enough distinct characters that the length isn't padding,
  * not a known-common password, a keyboard run, or a counting sequence,
  * not the client's own name or ours, which is the first thing anyone
    guessing would type.

Applied when a vault is created, never when one is unlocked: an existing
vault made under looser rules must always still open.
"""

from __future__ import annotations

import re

MIN_LENGTH = 12
MIN_DISTINCT = 6

# The handful that show up at the top of every breach analysis, plus the
# ones this product invites specifically. Not a substitute for a full
# breach corpus — it is the cheap catch for the guesses made in the first
# ten seconds, which is where a targeted attempt actually starts.
COMMON = frozenset("""
password passw0rd letmein welcome monkey dragon sunshine princess
qwerty qwertyuiop asdfgh asdfghjkl zxcvbn zxcvbnm 1q2w3e4r 1qaz2wsx
iloveyou admin administrator root login master superman batman
football baseball basketball trustno1 whatever freedom starwars
abc123 123abc password123 changeme secret access shadow ninja
kovyr kovyrvault vault myvault encrypted dentaloffice lawoffice
""".split())

_KEYBOARD_ROWS = ("qwertyuiop", "asdfghjkl", "zxcvbnm",
                  "1234567890", "!@#$%^&*()")

# Substituting @ for a fools nobody but an exact-match denylist, so undo
# it before comparing. Applied only after trailing decoration is removed,
# or `password123` would normalise to `passwordi2e` and slip through.
_LEET = str.maketrans({"@": "a", "4": "a", "0": "o", "1": "i", "!": "i",
                       "3": "e", "$": "s", "5": "s", "7": "t", "8": "b"})


def _core(phrase: str) -> str:
    """The bare guess underneath the decoration.

    `Password123!`, `P@ssword12345` and `password` are one guess wearing
    three hats, so all three have to collapse to the same string.
    """
    text = phrase.lower().strip()
    text = re.sub(r"[^a-z]+$", "", text)      # trailing digits/symbols
    text = text.translate(_LEET)
    return re.sub(r"[^a-z]", "", text)


def _unrepeat(text: str) -> str:
    """The unit a string is built from, if it is one thing repeated —
    `passwordpassword` is not twice as strong as `password`."""
    size = len(text)
    for unit in range(1, size // 2 + 1):
        if size % unit == 0 and text[:unit] * (size // unit) == text:
            return text[:unit]
    return text


def _longest_sequence(text: str) -> int:
    """Longest stretch of consecutive characters, either direction."""
    best = run = 1
    for a, b in zip(text, text[1:]):
        run = run + 1 if ord(b) - ord(a) in (1, -1) else 1
        best = max(best, run)
    return best


def _longest_row_stretch(text: str) -> int:
    """Longest stretch drawn unbroken from a single keyboard row."""
    best = 0
    for row in _KEYBOARD_ROWS:
        stretch = row + row[::-1]
        for start in range(len(text)):
            for end in range(start + best + 1, len(text) + 1):
                if text[start:end] in stretch:
                    best = end - start
                else:
                    break
    return best


def _is_run(phrase: str) -> bool:
    """Mostly a counting or alphabet sequence. Measured as a share of the
    phrase rather than all-or-nothing, so `123456789012345` — which wraps
    at 9 and breaks a strict check — is still caught."""
    text = phrase.lower()
    return (len(text) >= 4
            and _longest_sequence(text) >= max(6, len(text) * 0.6))


def _is_keyboard_walk(phrase: str) -> bool:
    text = phrase.lower()
    reach = _longest_row_stretch(text)
    return reach >= 6 and reach >= len(text) * 0.4


# Normalised the same way a candidate will be, so entries carrying digits
# (`1q2w3e4r`, `abc123`) still match once the candidate is stripped.
_COMMON_CORE = frozenset(_core(word) for word in COMMON) - {""}


def problems(phrase: str, client_name: str | None = None) -> list[str]:
    """Plain-English reasons this passphrase can't be used.

    An empty list means it is acceptable. Messages are written to be read
    by the client choosing the passphrase, not by an operator.
    """
    issues: list[str] = []
    if not phrase:
        return ["Enter a passphrase."]

    if len(phrase) < MIN_LENGTH:
        issues.append(
            f"Use at least {MIN_LENGTH} characters. Four unrelated words "
            "in a row is easy to remember and very hard to guess.")

    if len(set(phrase)) < MIN_DISTINCT and len(phrase) >= MIN_LENGTH:
        issues.append(
            "Too much repetition — this is far easier to guess than its "
            "length suggests. Use more different characters.")

    core = _core(phrase)
    if (core in _COMMON_CORE or _unrepeat(core) in _COMMON_CORE
            or phrase.lower().strip() in COMMON):
        issues.append(
            "This is one of the most commonly guessed passwords in the "
            "world. Please choose something else.")

    if _is_run(phrase):
        issues.append(
            "This is a straight sequence like 123456 or abcdef — one of "
            "the first things anyone guessing would try.")
    elif _is_keyboard_walk(phrase):
        issues.append(
            "This is a run of keys straight off the keyboard, which is "
            "guessed as quickly as a common word.")

    if "kovyr" in core:
        issues.append(
            "Don't build the passphrase around “Kovyr” — anyone "
            "who knows what software you run would start there.")

    if client_name:
        name = re.sub(r"[^a-z0-9]", "", client_name.lower())
        if len(name) >= 4 and name in core:
            issues.append(
                f"Don't build the passphrase around “{client_name}"
                "” — your own name is the first guess anyone makes.")

    return issues


def acceptable(phrase: str, client_name: str | None = None) -> bool:
    return not problems(phrase, client_name)


HINT = ("At least 12 characters. Four unrelated words — like "
        "“harbor-cactus-velvet-9” — beats a short complicated "
        "one, and you will actually remember it.")
