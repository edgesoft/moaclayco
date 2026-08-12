from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


OUTPUT_DIR = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "accounting"


def footer(canvas, document):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#5B6472"))
    canvas.drawString(20 * mm, 12 * mm, "Synthetic accounting fixture - no real customer data")
    canvas.drawRightString(190 * mm, 12 * mm, f"Page {document.page}")
    canvas.restoreState()


def table(data, widths):
    result = Table(data, colWidths=widths, repeatRows=1)
    result.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#173F35")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ALIGN", (-1, 1), (-1, -1), "RIGHT"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5D1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F7F5")]),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return result


def create_supplier_invoice(styles):
    target = OUTPUT_DIR / "supplier-invoice.pdf"
    document = SimpleDocTemplate(
        str(target),
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=22 * mm,
        title="Synthetic supplier invoice",
    )
    amount = ParagraphStyle("Amount", parent=styles["BodyText"], alignment=TA_RIGHT)
    story = [
        Paragraph("SUPPLIER INVOICE", styles["Title"]),
        Spacer(1, 4 * mm),
        Paragraph("Keramikmaterial Sverige AB<br/>Testgatan 10<br/>111 11 Stockholm", styles["BodyText"]),
        Spacer(1, 6 * mm),
        table(
            [
                ["Invoice number", "Invoice date", "Due date", "Payment status"],
                ["2026-100", "2026-07-15", "2026-08-14", "Paid from business bank"],
            ],
            [40 * mm, 38 * mm, 38 * mm, 54 * mm],
        ),
        Spacer(1, 8 * mm),
        table(
            [
                ["Description", "Quantity", "Unit price", "Amount"],
                ["Stoneware clay", "4", "200.00", "800.00"],
                ["Freight", "1", "200.00", "200.00"],
            ],
            [75 * mm, 25 * mm, 35 * mm, 35 * mm],
        ),
        Spacer(1, 7 * mm),
        Table(
            [
                ["Subtotal", Paragraph("1,000.00 SEK", amount)],
                ["VAT 25%", Paragraph("250.00 SEK", amount)],
                ["TOTAL", Paragraph("1,250.00 SEK", amount)],
            ],
            colWidths=[120 * mm, 50 * mm],
            style=TableStyle(
                [
                    ("FONTNAME", (0, 2), (-1, 2), "Helvetica-Bold"),
                    ("LINEABOVE", (0, 2), (-1, 2), 1, colors.HexColor("#173F35")),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            ),
        ),
        Spacer(1, 10 * mm),
        Paragraph("This invoice has been paid from Moa Clay Co's business bank account.", styles["BodyText"]),
    ]
    document.build(story, onFirstPage=footer, onLaterPages=footer)


def create_tax_account_statement(styles):
    target = OUTPUT_DIR / "tax-account-statement.pdf"
    document = SimpleDocTemplate(
        str(target),
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=22 * mm,
        title="Synthetic tax account statement",
    )
    heading = [
        Paragraph("TAX ACCOUNT STATEMENT", styles["Title"]),
        Paragraph("Synthetic sole proprietorship - accounting year 2026", styles["Heading2"]),
        Spacer(1, 5 * mm),
        Paragraph("Opening balance: 0.00 SEK", styles["BodyText"]),
        Spacer(1, 5 * mm),
    ]
    story = heading + [
        table(
            [
                ["Booking date", "Transaction", "Reference", "Amount"],
                ["2026-01-12", "Deposit from business bank", "PAY-001", "10,000.00"],
                ["2026-02-12", "Charged preliminary tax", "TAX-001", "-3,000.00"],
            ],
            [33 * mm, 72 * mm, 30 * mm, 35 * mm],
        ),
        Spacer(1, 5 * mm),
        Paragraph("Continued on next page", styles["Italic"]),
        PageBreak(),
        Paragraph("TAX ACCOUNT STATEMENT - CONTINUED", styles["Title"]),
        Spacer(1, 7 * mm),
        table(
            [
                ["Booking date", "Transaction", "Reference", "Amount"],
                ["2026-03-12", "VAT charged from tax account", "VAT-001", "-2,500.00"],
                ["2026-04-03", "Tax-free interest income", "INT-001", "25.00"],
            ],
            [33 * mm, 72 * mm, 30 * mm, 35 * mm],
        ),
        Spacer(1, 8 * mm),
        Paragraph("Closing balance: 4,525.00 SEK", styles["Heading2"]),
    ]
    document.build(story, onFirstPage=footer, onLaterPages=footer)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    styles["Title"].textColor = colors.HexColor("#173F35")
    create_supplier_invoice(styles)
    create_tax_account_statement(styles)


if __name__ == "__main__":
    main()
