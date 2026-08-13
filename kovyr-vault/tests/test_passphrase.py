"""Tests for new-vault passphrase requirements.

Two things matter here and they pull against each other: the bar has to be
high enough that a weak passphrase can't protect a client's records, and
low enough that a dental office manager complies instead of writing it on
a sticky note. So the tests check both that bad choices are refused AND
that genuinely good, memorable ones sail through.
"""

from kovyr_vault import passphrase


# ---------- what must be refused ----------

def test_short_passphrases_are_refused():
    for phrase in ("abc", "hunter2", "dentist1", "elevenchar"):
        assert passphrase.problems(phrase), phrase
        assert not passphrase.acceptable(phrase), phrase


def test_empty_is_refused():
    assert passphrase.problems("") == ["Enter a passphrase."]


def test_common_passwords_are_refused_even_when_long_enough():
    for phrase in ("passwordpassword", "qwertyuiopqwerty", "letmein12345"):
        assert not passphrase.acceptable(phrase), phrase


def test_decoration_does_not_rescue_a_common_password():
    """`Password123!` is `password` wearing a hat. Both have to fail."""
    for phrase in ("Password123!", "password1234", "P@ssword12345"):
        assert not passphrase.acceptable(phrase), phrase


def test_length_padded_with_repetition_is_refused():
    for phrase in ("aaaaaaaaaaaaaaa", "abababababababab", "xyxyxyxyxyxyxy"):
        assert not passphrase.acceptable(phrase), phrase


def test_counting_and_alphabet_runs_are_refused():
    for phrase in ("123456789012345", "abcdefghijklmno", "onmlkjihgfedcba"):
        assert not passphrase.acceptable(phrase), phrase


def test_keyboard_walks_are_refused():
    for phrase in ("qwertyuiopqwer", "asdfghjklasdfg"):
        assert not passphrase.acceptable(phrase), phrase


def test_our_own_name_is_refused():
    """Anyone who knows what software the practice runs starts here."""
    for phrase in ("kovyrvault2024", "MyKovyrVaultPass"):
        problems = passphrase.problems(phrase)
        assert problems, phrase
        assert any("Kovyr" in p for p in problems), phrase


def test_the_clients_own_name_is_refused():
    problems = passphrase.problems("brightsmiledental99",
                                   client_name="Bright Smile Dental")
    assert any("Bright Smile Dental" in p for p in problems)


def test_short_client_names_do_not_over_reject():
    """A two- or three-letter practice name would otherwise match inside
    almost any passphrase and make the rule unusable."""
    assert passphrase.acceptable("harbor-cactus-velvet-9", client_name="A&B")


# ---------- what must be accepted ----------

GOOD = [
    "harbor-cactus-velvet-9",        # the style we actually recommend
    "correct horse battery staple",  # spaces allowed
    "Tuesday!Rainboots#Ledger",
    "myfavouritecafeisonelmstreet",  # long, all lowercase, no symbols
    "7 red foxes crossed the bridge",
]


def test_good_passphrases_are_accepted():
    for phrase in GOOD:
        assert passphrase.problems(phrase) == [], (phrase,
                                                  passphrase.problems(phrase))


def test_no_composition_rules():
    """NIST SP 800-63B advises against forcing an uppercase/digit/symbol
    mix — it produces `Password1!`. A long all-lowercase passphrase with
    no digits must be accepted, or we have quietly reintroduced the rule.
    """
    assert passphrase.acceptable("thistlewoodbarnowlmarigold")


def test_messages_are_written_for_the_client():
    """These strings appear in the vault-creation dialog a client reads,
    so they have to say what to do, not just what is wrong."""
    problems = passphrase.problems("short")
    assert problems and "12 characters" in problems[0]
    assert "four unrelated words" in problems[0].lower()


# ---------- the rule only applies to new vaults ----------

def test_existing_weak_passphrases_still_unlock(tmp_path):
    """Enforcement belongs at creation only. A vault made before these
    rules existed must never become unopenable because of them."""
    from kovyr_vault.vault import Vault
    weak = "abc"
    assert not passphrase.acceptable(weak)
    vault = Vault.create(tmp_path / "v", weak)
    target = tmp_path / "f.txt"
    target.write_bytes(b"still mine")
    vault.add_file(target, "f.txt")

    reopened = Vault.open(tmp_path / "v", weak)
    assert reopened.read_file("f.txt") == b"still mine"
