"""Tests for reading text out of the formats clients actually store data in.

The load-bearing test here is `test_scanned_pdf_is_unread_not_clean`. Every
other test is about finding more; that one is about not lying when we find
nothing.
"""

import io
import zipfile

from pypdf import PdfWriter

from kovyr_vault import extract, sensitive

# 4111 1111 1111 1111 — the standard test card; passes Luhn.
CARD = "4111111111111111"
SSN = "123-45-6789"


# ---------- fixture builders (real files, not mocks) ----------

def _zip(parts: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        for name, body in parts.items():
            z.writestr(name, body)
    return buf.getvalue()


def make_docx(*paragraphs: str) -> bytes:
    runs = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    return _zip({"word/document.xml":
                 '<?xml version="1.0"?><w:document xmlns:w="http://'
                 'schemas.openxmlformats.org/wordprocessingml/2006/main">'
                 f"<w:body>{runs}</w:body></w:document>"})


def make_xlsx(*cells: str) -> bytes:
    items = "".join(f"<si><t>{c}</t></si>" for c in cells)
    return _zip({"xl/sharedStrings.xml":
                 '<?xml version="1.0"?><sst xmlns="http://schemas.'
                 f'openxmlformats.org/spreadsheetml/2006/main">{items}</sst>'})


def make_pptx(*lines: str) -> bytes:
    body = "".join(f"<a:p><a:r><a:t>{t}</a:t></a:r></a:p>" for t in lines)
    return _zip({"ppt/slides/slide1.xml":
                 '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.'
                 'openxmlformats.org/drawingml/2006/main" xmlns:p="http://'
                 'schemas.openxmlformats.org/presentationml/2006/main">'
                 f"<p:cSld>{body}</p:cSld></p:sld>"})


def make_text_pdf(body: str) -> bytes:
    """A minimal but genuinely valid PDF carrying a real text layer."""
    stream = f"BT /F1 12 Tf 72 720 Td ({body}) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents "
        b"4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += (b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objs) + 1, xref))
    return bytes(out)


def write_scanned_pdf(path):
    """A PDF with a page but no text layer — what a scanner produces."""
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    with open(path, "wb") as fh:
        writer.write(fh)


# ---------- the formats clients actually use ----------

def test_finds_ssn_in_word_document(tmp_path):
    doc = tmp_path / "intake.docx"
    doc.write_bytes(make_docx("Patient record", f"SSN: {SSN}"))
    text, reason = extract.extract(doc)
    assert reason == extract.OK
    assert sensitive.count_ssns(text) == 1


def test_finds_card_in_spreadsheet(tmp_path):
    book = tmp_path / "billing.xlsx"
    book.write_bytes(make_xlsx("Customer", CARD))
    text, reason = extract.extract(book)
    assert reason == extract.OK
    assert sensitive.count_cards(text) == 1


def test_finds_ssn_in_presentation(tmp_path):
    deck = tmp_path / "deck.pptx"
    deck.write_bytes(make_pptx("Example record", SSN))
    text, reason = extract.extract(deck)
    assert reason == extract.OK
    assert sensitive.count_ssns(text) == 1


def test_finds_ssn_in_pdf_with_text_layer(tmp_path):
    pdf = tmp_path / "return.pdf"
    pdf.write_bytes(make_text_pdf(f"Taxpayer SSN {SSN}"))
    text, reason = extract.extract(pdf)
    assert reason == extract.OK
    assert sensitive.count_ssns(text) == 1


def test_macro_enabled_variants_are_read(tmp_path):
    doc = tmp_path / "form.docm"
    doc.write_bytes(make_docx(f"SSN {SSN}"))
    assert extract.extract(doc)[1] == extract.OK


# ---------- the honesty guarantees ----------

def test_scanned_pdf_is_unread_not_clean(tmp_path):
    """THE critical case. A scan of paper has no text layer. Returning ""
    would let the scan record it as read-and-clean — a false all-clear over
    exactly the documents where a dental or legal office keeps SSNs."""
    pdf = tmp_path / "signed-intake.pdf"
    write_scanned_pdf(pdf)
    text, reason = extract.extract(pdf)
    assert text is None                      # never "" — that reads as clean
    assert reason == extract.NO_TEXT_LAYER

    readable, finding, reason = sensitive._scan_one(pdf)
    assert readable is False and finding is None


def test_encrypted_pdf_is_refused_not_guessed(tmp_path):
    pdf = tmp_path / "locked.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.encrypt("a-password-we-do-not-have")
    with open(pdf, "wb") as fh:
        writer.write(fh)
    assert extract.extract(pdf) == (None, extract.ENCRYPTED)


def test_legacy_and_binary_formats_are_unread(tmp_path):
    legacy = tmp_path / "old.doc"
    legacy.write_bytes(b"\xd0\xcf\x11\xe0\x00\x00 legacy OLE compound file")
    image = tmp_path / "scan.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x00")
    for path in (legacy, image):
        text, reason = extract.extract(path)
        assert text is None, path
        assert reason == extract.UNSUPPORTED, path


def test_adjacent_cells_do_not_fuse_into_a_false_card(tmp_path):
    """Two harmless numbers in neighbouring cells concatenate into a
    Luhn-valid 16-digit string. Joining extracted runs with a newline is
    what stops that, so pin it."""
    assert sensitive.luhn_valid("4111" + "111111111111")   # would match
    book = tmp_path / "sheet.xlsx"
    book.write_bytes(make_xlsx("4111", "111111111111"))
    text, _ = extract.extract(book)
    assert sensitive.count_cards(text) == 0


def test_malformed_document_does_not_crash_the_scan(tmp_path):
    truncated = tmp_path / "corrupt.docx"
    truncated.write_bytes(b"PK\x03\x04 truncated garbage")
    broken_pdf = tmp_path / "corrupt.pdf"
    broken_pdf.write_bytes(b"%PDF-1.4\nnot really a pdf")
    for path in (truncated, broken_pdf):
        text, reason = extract.extract(path)
        assert text is None
        assert reason in (extract.ERROR, extract.NO_TEXT_LAYER)


def test_plain_text_still_works(tmp_path):
    note = tmp_path / "notes.txt"
    note.write_text(f"client ssn {SSN}")
    text, reason = extract.extract(note)
    assert reason == extract.OK and sensitive.count_ssns(text) == 1


# ---------- end to end through the scan ----------

def test_scan_reports_office_findings_and_counts_scanned_pdfs(tmp_path):
    (tmp_path / "intake.docx").write_bytes(make_docx(f"SSN {SSN}"))
    (tmp_path / "billing.xlsx").write_bytes(make_xlsx(CARD))
    (tmp_path / "return.pdf").write_bytes(make_text_pdf(f"SSN {SSN}"))
    write_scanned_pdf(tmp_path / "signed-form.pdf")
    (tmp_path / "clean.txt").write_text("nothing of interest here")

    report = sensitive.scan_paths([tmp_path])
    summary = sensitive.summarize(report)

    assert summary["files"] == 3          # docx, xlsx, pdf-with-text
    assert summary["ssns"] == 2
    assert summary["cards"] == 1
    assert report.image_pdfs == 1
    assert report.skipped == 1            # only the scanned PDF

    note = sensitive.coverage_note(report.read, report.skipped,
                                   report.image_pdfs)
    assert "scan of paper" in note
    assert "checking by hand" in note or "by hand" in note


def test_coverage_note_stays_quiet_when_nothing_was_skipped():
    assert sensitive.coverage_note(12, 0) == "Looked inside 12 files."
