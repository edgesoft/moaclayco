#!/usr/bin/env python3
"""Read-only SG Woods accounting export from MongoDB and S3."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import sys
import unicodedata
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote, urlparse


TOOL_VERSION = "1.2.0"
DOMAIN = "sgwoods"
COLLECTION = "verifications"
BALANCE_TOLERANCE = Decimal("0.01")

ACCOUNT_NAMES = {
    1510: "Kundfordringar",
    1580: "Fordran på Stripe",
    1910: "Kassa",
    1930: "Bank",
    2012: "Avräkning för skatter och avgifter",
    2013: "Eget uttag",
    2018: "Egen insättning",
    2050: "Skattekontotransaktioner",
    2440: "Leverantörsskulder",
    2611: "Utgående moms på varor och frakt",
    2640: "Ingående moms",
    2650: "Momsskuld",
    2999: "Överföringskonto för UB/IB",
    3001: "Försäljning av varor",
    3740: "Öres- och kronutjämning",
    4000: "Material/Varukostnader",
    5410: "Förbrukningsinventarier",
    6570: "Kostnader för betalningsförmedling",
    6990: "Övriga externa kostnader",
    8313: "Ränteintäkter bank",
}


class ExportError(RuntimeError):
    pass


def parse_iso_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"Invalid date {value!r}; expected YYYY-MM-DD"
        ) from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a read-only SG Woods general-ledger export."
    )
    parser.add_argument("--from", dest="from_date", type=parse_iso_date, required=True)
    parser.add_argument("--to", dest="to_date", type=parse_iso_date, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--fixture",
        type=Path,
        help="Read local JSON instead of contacting MongoDB or AWS.",
    )
    parser.add_argument(
        "--skip-files",
        action="store_true",
        help="Create the attachment index without downloading S3 files.",
    )
    parser.add_argument(
        "--skip-pdf",
        action="store_true",
        help="Skip the human-readable PDF report.",
    )
    parser.add_argument(
        "--confirm-production-read",
        action="store_true",
        help="Required when EXPORT_SOURCE_LABEL=production.",
    )
    parser.add_argument(
        "--fail-on-warning",
        action="store_true",
        help="Finish the bundle but return exit code 2 if validation warnings exist.",
    )
    args = parser.parse_args()

    if args.from_date > args.to_date:
        parser.error("--from must be earlier than or equal to --to")
    if args.output.expanduser().resolve() == Path("/"):
        parser.error("--output cannot be the filesystem root")
    return args


def utc_start(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


def as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, date):
        result = datetime.combine(value, time.min)
    elif isinstance(value, str):
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        raise ValueError(f"Unsupported date value: {value!r}")
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result.astimezone(timezone.utc)


def as_decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    if isinstance(value, bool):
        raise InvalidOperation("Boolean is not a monetary value")
    if hasattr(value, "to_decimal"):
        value = value.to_decimal()
    result = Decimal(str(value))
    if not result.is_finite():
        raise InvalidOperation("Non-finite monetary value")
    return result


def money(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.01")), "f").replace(".", ",")


def money_pdf(value: Decimal) -> str:
    raw = f"{value.quantize(Decimal('0.01')):,.2f}"
    return raw.replace(",", " ").replace(".", ",")


def clean_text(value: Any) -> str:
    text = "" if value is None else str(value)
    return (
        text.replace("\u2010", "-")
        .replace("\u2011", "-")
        .replace("\u2012", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\r", " ")
        .replace("\n", " ")
        .strip()
    )


def json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "to_decimal"):
        return str(value.to_decimal())
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def source_label(args: argparse.Namespace) -> str:
    if args.fixture:
        return "fixture"
    label = os.environ.get("EXPORT_SOURCE_LABEL", "").strip().lower()
    if label not in {"stage", "production"}:
        raise ExportError("EXPORT_SOURCE_LABEL must be stage or production")
    if label == "production" and not args.confirm_production_read:
        raise ExportError(
            "Production reads require the --confirm-production-read flag"
        )
    return label


def load_fixture(
    path: Path, from_date: date, to_date: date
) -> tuple[list[dict[str, Any]], set[int]]:
    try:
        records = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ExportError(f"Could not read fixture file: {path}") from exc
    if not isinstance(records, list):
        raise ExportError("Fixture root must be a JSON array")
    start = utc_start(from_date)
    end = utc_start(to_date + timedelta(days=1))
    domain_records = [record for record in records if record.get("domain") == DOMAIN]
    selected = [
        record
        for record in domain_records
        if start <= as_datetime(record.get("verificationDate")) < end
    ]
    known_numbers = {
        int(record.get("verificationNumber", 0)) for record in domain_records
    }
    return selected, known_numbers


def require_environment(names: Iterable[str]) -> dict[str, str]:
    values = {name: os.environ.get(name, "").strip() for name in names}
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise ExportError(f"Missing environment variables: {', '.join(missing)}")
    return values


def load_mongo(
    from_date: date, to_date: date
) -> tuple[list[dict[str, Any]], str, set[int]]:
    values = require_environment(["MONGODB_URL"])
    try:
        from pymongo import MongoClient
        from pymongo.read_concern import ReadConcern
    except ImportError as exc:
        raise ExportError("pymongo is not installed; run the exporter in Docker") from exc

    query = {
        "domain": DOMAIN,
        "verificationDate": {
            "$gte": utc_start(from_date),
            "$lt": utc_start(to_date + timedelta(days=1)),
        },
    }
    client = MongoClient(
        values["MONGODB_URL"],
        appname="sgwoods-readonly-accounting-export",
        tz_aware=True,
        retryWrites=False,
        maxPoolSize=2,
        serverSelectionTimeoutMS=15000,
        connectTimeoutMS=15000,
    )
    try:
        configured_database = os.environ.get("MONGODB_DATABASE", "").strip()
        try:
            database = client.get_database(configured_database or None)
        except Exception as exc:
            raise ExportError(
                "Set MONGODB_DATABASE or include the database name in MONGODB_URL"
            ) from exc
        collection = database.get_collection(
            COLLECTION, read_concern=ReadConcern("majority")
        )
        cursor = (
            collection.find(query)
            .sort([("verificationDate", 1), ("verificationNumber", 1), ("_id", 1)])
            .batch_size(500)
        )
        known_numbers = {
            int(number)
            for number in collection.distinct("verificationNumber", {"domain": DOMAIN})
        }
        return list(cursor), database.name, known_numbers
    except ExportError:
        raise
    except Exception as exc:
        raise ExportError(
            "MongoDB read failed; verify the URL, database, network access and read role"
        ) from exc
    finally:
        client.close()


def sorted_verifications(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        records,
        key=lambda item: (
            as_datetime(item.get("verificationDate")),
            int(item.get("verificationNumber", 0)),
            str(item.get("_id", "")),
        ),
    )


def validation(
    records: list[dict[str, Any]], known_numbers: set[int] | None = None
) -> tuple[list[str], dict[str, Any]]:
    warnings: list[str] = []
    numbers: list[int] = []
    total_debit = Decimal("0")
    total_credit = Decimal("0")
    entry_count = 0
    file_count = 0

    for record in records:
        number = int(record.get("verificationNumber", 0))
        numbers.append(number)
        entries = record.get("journalEntries") or []
        files = record.get("files") or []
        file_count += len(files)
        if not entries:
            warnings.append(f"A{number}: no journal entries")
            continue
        debit = Decimal("0")
        credit = Decimal("0")
        for index, entry in enumerate(entries, start=1):
            try:
                entry_debit = as_decimal(entry.get("debit", 0))
                entry_credit = as_decimal(entry.get("credit", 0))
            except (InvalidOperation, ValueError) as exc:
                warnings.append(f"A{number}, row {index}: invalid monetary value")
                continue
            if entry_debit < 0 or entry_credit < 0:
                warnings.append(f"A{number}, row {index}: negative debit or credit")
            debit += entry_debit
            credit += entry_credit
            entry_count += 1
        total_debit += debit
        total_credit += credit
        if abs(debit - credit) > BALANCE_TOLERANCE:
            warnings.append(
                f"A{number}: unbalanced by {money(abs(debit - credit))} SEK"
            )

    duplicate_numbers = sorted(
        number for number, count in Counter(numbers).items() if count > 1
    )
    if duplicate_numbers:
        warnings.append(
            "Duplicate verification numbers: "
            + ", ".join(f"A{number}" for number in duplicate_numbers)
        )
    unique_numbers = sorted(set(numbers))
    if unique_numbers:
        present = known_numbers if known_numbers is not None else set(unique_numbers)
        missing = [
            number
            for number in range(unique_numbers[0], unique_numbers[-1] + 1)
            if number not in present
        ]
        if missing:
            warnings.append(
                "Verification numbers missing from the source: "
                + ", ".join(f"A{number}" for number in missing)
            )

    stats = {
        "verification_count": len(records),
        "journal_entry_count": entry_count,
        "attachment_reference_count": file_count,
        "total_debit_sek": money(total_debit),
        "total_credit_sek": money(total_credit),
        "difference_sek": money(total_debit - total_credit),
        "first_verification_number": unique_numbers[0] if unique_numbers else None,
        "last_verification_number": unique_numbers[-1] if unique_numbers else None,
    }
    if not records:
        warnings.append("No SG Woods verifications found in the selected period")
    return warnings, stats


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(json_value(payload), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_csv(path: Path, headers: list[str], rows: Iterable[list[Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream, delimiter=";", lineterminator="\n")
        writer.writerow(headers)
        writer.writerows(rows)


def journal_rows(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for record in records:
        number = int(record.get("verificationNumber", 0))
        verification_date = as_datetime(record.get("verificationDate")).date()
        description = clean_text(record.get("description"))
        file_count = len(record.get("files") or [])
        for index, entry in enumerate(record.get("journalEntries") or [], start=1):
            rows.append(
                {
                    "account": int(entry.get("account", 0)),
                    "date": verification_date,
                    "number": number,
                    "row": index,
                    "description": description,
                    "debit": as_decimal(entry.get("debit", 0)),
                    "credit": as_decimal(entry.get("credit", 0)),
                    "file_count": file_count,
                }
            )
    return sorted(
        rows,
        key=lambda row: (row["account"], row["date"], row["number"], row["row"]),
    )


def create_csv_reports(root: Path, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = journal_rows(records)
    balances: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    ledger_rows: list[list[Any]] = []
    for row in rows:
        account = row["account"]
        balances[account] += row["debit"] - row["credit"]
        ledger_rows.append(
            [
                account,
                ACCOUNT_NAMES.get(account, "Okänt konto"),
                row["date"].isoformat(),
                f"A{row['number']}",
                row["description"],
                money(row["debit"]),
                money(row["credit"]),
                money(balances[account]),
                row["file_count"],
            ]
        )
    write_csv(
        root / "reports" / "huvudbok.csv",
        [
            "Konto",
            "Kontonamn",
            "Datum",
            "Verifikation",
            "Beskrivning",
            "Debet (SEK)",
            "Kredit (SEK)",
            "Periodsaldo (SEK)",
            "Antal underlag",
        ],
        ledger_rows,
    )

    verification_rows: list[list[Any]] = []
    for record in records:
        entries = record.get("journalEntries") or []
        debit = sum((as_decimal(entry.get("debit", 0)) for entry in entries), Decimal("0"))
        credit = sum((as_decimal(entry.get("credit", 0)) for entry in entries), Decimal("0"))
        verification_rows.append(
            [
                f"A{int(record.get('verificationNumber', 0))}",
                as_datetime(record.get("verificationDate")).date().isoformat(),
                clean_text(record.get("description")),
                money(debit),
                money(credit),
                "Ja" if abs(debit - credit) <= BALANCE_TOLERANCE else "Nej",
                len(entries),
                len(record.get("files") or []),
            ]
        )
    write_csv(
        root / "reports" / "verifikationslista.csv",
        [
            "Verifikation",
            "Datum",
            "Beskrivning",
            "Debet (SEK)",
            "Kredit (SEK)",
            "Balanserad",
            "Antal konteringsrader",
            "Antal underlag",
        ],
        verification_rows,
    )
    return rows


def parse_s3_reference(value: str, configured_bucket: str) -> tuple[str, str]:
    parsed = urlparse(value)
    if parsed.scheme == "s3":
        bucket = parsed.netloc
        key = unquote(parsed.path.lstrip("/"))
    elif parsed.scheme in {"http", "https"}:
        host = parsed.netloc.split(":", 1)[0].lower()
        path_parts = unquote(parsed.path.lstrip("/")).split("/", 1)
        if host.startswith(configured_bucket.lower() + ".s3"):
            bucket = configured_bucket
            key = unquote(parsed.path.lstrip("/"))
        elif host == "s3.amazonaws.com" or host.startswith("s3.") or host.startswith("s3-"):
            if len(path_parts) != 2:
                raise ValueError("S3 path-style URL has no object key")
            bucket, key = path_parts
        else:
            raise ValueError("URL is not a recognized S3 object URL")
    else:
        raise ValueError("Attachment path must be an S3 or HTTPS URL")
    if bucket != configured_bucket:
        raise ValueError(f"Attachment references unexpected bucket {bucket!r}")
    if not key or key.endswith("/"):
        raise ValueError("Attachment has no S3 object key")
    return bucket, key


def storage_scope() -> tuple[str, str, str]:
    values = require_environment(
        ["AWS_REGION", "AWS_S3_BUCKET_NAME", "AWS_VERIFICATIONS_PATH"]
    )
    bucket = values["AWS_S3_BUCKET_NAME"]
    prefix = values["AWS_VERIFICATIONS_PATH"].strip("/")
    region = values["AWS_REGION"]
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket):
        raise ExportError(
            "AWS_S3_BUCKET_NAME is invalid; use only the bucket name without comments or a URL"
        )
    if (
        not prefix
        or prefix in {".", ".."}
        or "//" in prefix
        or "\\" in prefix
        or any(part in {".", ".."} for part in prefix.split("/"))
        or any(character.isspace() for character in prefix)
    ):
        raise ExportError(
            "AWS_VERIFICATIONS_PATH is invalid; use a clean S3 prefix without comments"
        )
    return bucket, prefix, region


def ensure_s3_prefix(key: str, configured_prefix: str) -> None:
    if not key.startswith(configured_prefix + "/"):
        raise ValueError(
            f"Attachment is outside configured verification prefix {configured_prefix!r}"
        )


def safe_filename(value: str, fallback: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", ascii_name).strip("._")
    return cleaned[:180] or fallback


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_attachments(
    root: Path,
    records: list[dict[str, Any]],
    skip_files: bool,
    fixture_mode: bool,
) -> tuple[list[dict[str, Any]], list[str]]:
    references: list[tuple[dict[str, Any], int, dict[str, Any]]] = []
    for record in records:
        for index, file_record in enumerate(record.get("files") or [], start=1):
            references.append((record, index, file_record))

    results: list[dict[str, Any]] = []
    warnings: list[str] = []
    if skip_files or not references:
        for record, index, file_record in references:
            results.append(
                {
                    "verification": f"A{int(record.get('verificationNumber', 0))}",
                    "index": index,
                    "label": clean_text(file_record.get("name")),
                    "source_url": file_record.get("path", ""),
                    "local_file": "",
                    "status": "skipped",
                    "sha256": "",
                    "size_bytes": None,
                }
            )
        return results, warnings

    if fixture_mode:
        raise ExportError("Fixture mode cannot download attachments; add --skip-files")

    values = require_environment(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"])
    bucket_scope, prefix_scope, region_scope = storage_scope()
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise ExportError("boto3 is not installed; run the exporter in Docker") from exc

    client = boto3.client(
        "s3",
        region_name=region_scope,
        config=Config(retries={"max_attempts": 5, "mode": "standard"}),
    )
    for record, index, file_record in references:
        number = int(record.get("verificationNumber", 0))
        source_url = str(file_record.get("path", ""))
        label = clean_text(file_record.get("name"))
        result = {
            "verification": f"A{number}",
            "index": index,
            "label": label,
            "source_url": source_url,
            "local_file": "",
            "status": "error",
            "sha256": "",
            "size_bytes": None,
        }
        try:
            bucket, key = parse_s3_reference(source_url, bucket_scope)
            ensure_s3_prefix(key, prefix_scope)
            original_name = Path(key).name
            filename = safe_filename(original_name, f"attachment-{index}")
            relative = Path("attachments") / f"A{number:06d}" / f"{index:02d}-{filename}"
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            response = client.get_object(Bucket=bucket, Key=key)
            expected_size = int(response.get("ContentLength", 0))
            written = 0
            with target.open("xb") as stream:
                body = response["Body"]
                for chunk in body.iter_chunks(chunk_size=1024 * 1024):
                    if chunk:
                        stream.write(chunk)
                        written += len(chunk)
            if expected_size and written != expected_size:
                target.unlink(missing_ok=True)
                raise IOError(
                    f"downloaded {written} bytes but S3 reported {expected_size}"
                )
            result.update(
                {
                    "local_file": relative.as_posix(),
                    "status": "downloaded",
                    "sha256": sha256_file(target),
                    "size_bytes": written,
                }
            )
        except Exception as exc:
            error_code = (
                getattr(exc, "response", {}).get("Error", {}).get("Code", "")
            )
            if error_code in {"NoSuchKey", "404", "NotFound"}:
                warning = (
                    f"A{number}, underlag {index}: filen saknas i S3 och kunde inte hämtas"
                )
            else:
                warning = (
                    f"A{number}, underlag {index}: hämtningen misslyckades "
                    f"({type(exc).__name__})"
                )
            warnings.append(warning)
            result["error"] = warning
        results.append(result)
    return results, warnings


def write_attachment_index(root: Path, results: list[dict[str, Any]]) -> None:
    rows = [
        [
            item["verification"],
            item["index"],
            item["label"],
            item["source_url"],
            item["local_file"],
            item["status"],
            item["sha256"],
            item["size_bytes"] if item["size_bytes"] is not None else "",
        ]
        for item in results
    ]
    write_csv(
        root / "reports" / "bilageindex.csv",
        [
            "Verifikation",
            "Index",
            "Benämning",
            "Källadress",
            "Lokal fil",
            "Status",
            "SHA-256",
            "Storlek (bytes)",
        ],
        rows,
    )


def create_pdf(
    path: Path,
    rows: list[dict[str, Any]],
    from_date: date,
    to_date: date,
    source: str,
) -> None:
    try:
        from reportlab.lib import colors
        from reportlab.graphics import renderPDF
        from reportlab.lib.enums import TA_LEFT, TA_RIGHT
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            BaseDocTemplate,
            Frame,
            KeepTogether,
            LongTable,
            PageBreak,
            PageTemplate,
            Paragraph,
            Spacer,
            Table,
            TableStyle,
        )
        from svglib.svglib import svg2rlg
        from xml.sax.saxutils import escape
    except ImportError as exc:
        raise ExportError(
            "PDF dependencies are not installed; run the exporter in Docker"
        ) from exc

    script_path = Path(__file__).resolve()
    repository_logo = (
        script_path.parents[2] / "public" / "sgwoods.svg"
        if len(script_path.parents) > 2
        else Path("/__sgwoods_logo_not_found__")
    )
    logo_candidates = [
        Path(os.environ.get("SGWOODS_LOGO_PATH", "")),
        Path.cwd() / "public" / "sgwoods.svg",
        repository_logo,
    ]
    logo_path = next(
        (candidate for candidate in logo_candidates if str(candidate) and candidate.is_file()),
        None,
    )
    if logo_path is None:
        raise ExportError(
            "SG Woods logo not found; set SGWOODS_LOGO_PATH to public/sgwoods.svg"
        )
    logo = svg2rlg(str(logo_path))
    if logo is None or not logo.width or not logo.height:
        raise ExportError(f"Could not render SG Woods logo: {logo_path}")

    path.parent.mkdir(parents=True, exist_ok=True)
    page_size = landscape(A4)
    page_width, page_height = page_size
    page_margin = 15 * mm
    content_width = page_width - (2 * page_margin)
    gutter = 4 * mm
    four_up_width = (content_width - (3 * gutter)) / 4
    forest = colors.HexColor("#052E16")
    green = colors.HexColor("#166534")
    ink = colors.HexColor("#16231B")
    muted = colors.HexColor("#66736B")
    warm = colors.HexColor("#C9A66B")
    cream = colors.HexColor("#F7F3EA")
    pale_green = colors.HexColor("#EEF5F0")
    pale_line = colors.HexColor("#D9E4DC")
    zebra = colors.HexColor("#F7FAF8")

    doc = BaseDocTemplate(
        str(path),
        pagesize=page_size,
        leftMargin=page_margin,
        rightMargin=page_margin,
        topMargin=32 * mm,
        bottomMargin=18 * mm,
        title=f"Huvudbok - SG Woods - {from_date.isoformat()} till {to_date.isoformat()}",
        author="SG Woods read-only accounting export",
        subject="Huvudbok och kontospecifikation",
    )
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="AccountTitle",
            parent=styles["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=19,
            leading=22,
            textColor=forest,
            spaceAfter=1.5 * mm,
        )
    )
    styles.add(
        ParagraphStyle(
            name="AccountEyebrow",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.5,
            leading=9,
            textColor=green,
            spaceAfter=1.5 * mm,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SmallBody",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=9.2,
            textColor=ink,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SmallLeft",
            parent=styles["SmallBody"],
            alignment=TA_LEFT,
        )
    )
    styles.add(
        ParagraphStyle(
            name="MetricValue",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=12,
            textColor=forest,
            alignment=TA_RIGHT,
        )
    )
    styles.add(
        ParagraphStyle(
            name="MetricLabel",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=6.5,
            leading=8,
            textColor=muted,
            alignment=TA_LEFT,
        )
    )

    logo_target = 13 * mm
    logo_scale = min(logo_target / logo.width, logo_target / logo.height)
    logo_width = logo.width * logo_scale
    logo_height = logo.height * logo_scale

    def draw_logo(canvas: Any) -> None:
        canvas.saveState()
        canvas.translate(
            page_width - page_margin - logo_width,
            page_height - 5 * mm - logo_height,
        )
        canvas.scale(logo_scale, logo_scale)
        renderPDF.draw(logo, canvas, 0, 0)
        canvas.restoreState()

    def on_page(canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#F6F8F6"))
        canvas.rect(0, page_height - 28 * mm, page_width, 28 * mm, fill=1, stroke=0)
        canvas.setFillColor(forest)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawString(page_margin, page_height - 10.5 * mm, "SG WOODS")
        canvas.setFillColor(muted)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(page_margin, page_height - 15 * mm, "HUVUDBOK / KONTOSPECIFIKATION")
        canvas.setStrokeColor(warm)
        canvas.setLineWidth(1.1)
        canvas.line(
            page_margin,
            page_height - 24 * mm,
            page_width - page_margin,
            page_height - 24 * mm,
        )
        draw_logo(canvas)

        canvas.setStrokeColor(pale_line)
        canvas.setLineWidth(0.5)
        canvas.line(page_margin, 13 * mm, page_width - page_margin, 13 * mm)
        canvas.setFont("Helvetica", 6.8)
        canvas.setFillColor(muted)
        canvas.drawString(
            page_margin,
            7.8 * mm,
            f"{from_date.isoformat()} - {to_date.isoformat()}  |  KÄLLA: {source.upper()}  |  SKRIVSKYDDAD EXPORT",
        )
        page_label = f"{document.page:02d}"
        canvas.setFillColor(forest)
        canvas.roundRect(page_width - 27 * mm, 5.2 * mm, 12 * mm, 6.5 * mm, 3.25 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 7)
        canvas.drawCentredString(page_width - 21 * mm, 7.3 * mm, page_label)
        canvas.restoreState()

    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
        id="ledger",
    )
    doc.addPageTemplates([PageTemplate(id="ledger", frames=[frame], onPage=on_page)])

    def account_metric(value: str, label: str, width: float) -> Table:
        result = Table(
            [[Paragraph(label.upper(), styles["MetricLabel"]), Paragraph(value, styles["MetricValue"])]],
            colWidths=[width * 0.42, width * 0.58],
            rowHeights=[11 * mm],
        )
        result.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), pale_green),
                    ("BOX", (0, 0), (-1, -1), 0.4, pale_line),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ]
            )
        )
        return result

    def four_up(items: list[Table]) -> Table:
        cells: list[Any] = []
        widths: list[float] = []
        for item_index, item in enumerate(items):
            if item_index:
                cells.append("")
                widths.append(gutter)
            cells.append(item)
            widths.append(four_up_width)
        result = Table([cells], colWidths=widths, hAlign="LEFT")
        result.setStyle(
            TableStyle(
                [
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        return result

    story: list[Any] = []
    grouped: defaultdict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row["account"]].append(row)

    for account_index, account in enumerate(sorted(grouped)):
        account_rows = grouped[account]
        total_debit = sum((row["debit"] for row in account_rows), Decimal("0"))
        total_credit = sum((row["credit"] for row in account_rows), Decimal("0"))
        closing_balance = total_debit - total_credit
        if account_index:
            story.append(PageBreak())
        account_header = KeepTogether(
            [
                Paragraph("KONTOSPECIFIKATION", styles["AccountEyebrow"]),
                Paragraph(
                    f"{account} &nbsp; <font color='#4F6F5D'>{escape(ACCOUNT_NAMES.get(account, 'Okänt konto'))}</font>",
                    styles["AccountTitle"],
                ),
                Spacer(1, 2 * mm),
                four_up(
                    [
                        account_metric(f"{money_pdf(total_debit)} SEK", "Debet", four_up_width),
                        account_metric(f"{money_pdf(total_credit)} SEK", "Kredit", four_up_width),
                        account_metric(f"{money_pdf(closing_balance)} SEK", "Periodsaldo", four_up_width),
                        account_metric(str(len(account_rows)), "Rader", four_up_width),
                    ]
                ),
                Spacer(1, 4 * mm),
            ]
        )
        story.append(account_header)
        account_name = ACCOUNT_NAMES.get(account, "Okänt konto")
        table_rows: list[list[Any]] = [
            [
                Paragraph(
                    f"<b>KONTO {account}</b> &nbsp;&nbsp; {escape(account_name)}",
                    styles["SmallLeft"],
                ),
                "",
                "",
                "",
                "",
                "",
            ],
            ["DATUM", "VER.", "BESKRIVNING", "DEBET", "KREDIT", "PERIODSALDO"],
        ]
        running = Decimal("0")
        for row in account_rows:
            running += row["debit"] - row["credit"]
            table_rows.append(
                [
                    row["date"].isoformat(),
                    f"A{row['number']}",
                    Paragraph(escape(row["description"]), styles["SmallLeft"]),
                    money_pdf(row["debit"]) if row["debit"] else "-",
                    money_pdf(row["credit"]) if row["credit"] else "-",
                    money_pdf(running),
                ]
            )
        table_rows.append(
            [
                "",
                "",
                "SUMMA / UTGÅENDE PERIODSALDO",
                money_pdf(total_debit),
                money_pdf(total_credit),
                money_pdf(running),
            ]
        )
        table = LongTable(
            table_rows,
            repeatRows=2,
            colWidths=[24 * mm, 17 * mm, 134 * mm, 29 * mm, 29 * mm, 34 * mm],
            hAlign="LEFT",
        )
        table.setStyle(
            TableStyle(
                [
                    ("SPAN", (0, 0), (-1, 0)),
                    ("BACKGROUND", (0, 0), (-1, 0), pale_green),
                    ("TEXTCOLOR", (0, 0), (-1, 0), forest),
                    ("LINEABOVE", (0, 0), (-1, 0), 0.8, green),
                    ("BACKGROUND", (0, 1), (-1, 1), forest),
                    ("TEXTCOLOR", (0, 1), (-1, 1), colors.white),
                    ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
                    ("FONTNAME", (0, 2), (-1, -2), "Helvetica"),
                    ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                    ("TEXTCOLOR", (0, 2), (-1, -1), ink),
                    ("BACKGROUND", (0, -1), (-1, -1), cream),
                    ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                    ("FONTSIZE", (0, 1), (-1, 1), 6.8),
                    ("ALIGN", (3, 1), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("VALIGN", (3, 1), (-1, -1), "MIDDLE"),
                    ("ROWBACKGROUNDS", (0, 2), (-1, -2), [colors.white, zebra]),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.3, pale_line),
                    ("LINEABOVE", (0, -1), (-1, -1), 0.8, warm),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 3.5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
                    ("TOPPADDING", (0, 0), (-1, 1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, 1), 5),
                    ("TOPPADDING", (0, -1), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, -1), (-1, -1), 5),
                ]
            )
        )
        story.append(table)

    doc.build(story)


def artifact_inventory(root: Path, excluded: set[str]) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = path.relative_to(root).as_posix()
        if relative in excluded:
            continue
        artifacts.append(
            {
                "path": relative,
                "size_bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    return artifacts


def write_readme(
    root: Path,
    from_date: date,
    to_date: date,
    source: str,
    stats: dict[str, Any],
    warnings: list[str],
) -> None:
    lines = [
        "SG Woods accounting export",
        "==========================",
        "",
        f"Source label: {source}",
        f"Domain filter: {DOMAIN}",
        f"Period: {from_date.isoformat()} through {to_date.isoformat()} (inclusive)",
        f"Verifications: {stats['verification_count']}",
        f"Journal entries: {stats['journal_entry_count']}",
        f"Attachment references: {stats['attachment_reference_count']}",
        f"Validation warnings: {len(warnings)}",
        "",
        "The source system was accessed using read-only operations. See manifest.json",
        "for validation details and SHA256SUMS for integrity checks.",
        "",
        "Periodsaldo in huvudbok.csv and huvudbok.pdf starts at zero for the selected",
        "period. A booked incoming-balance verification is included when it falls",
        "inside the selected period.",
        "",
    ]
    (root / "README.txt").write_text("\n".join(lines), encoding="utf-8")


def finalize_bundle(
    root: Path,
    from_date: date,
    to_date: date,
    source: str,
    stats: dict[str, Any],
    warnings: list[str],
    attachments: list[dict[str, Any]],
    database_name: str,
    s3_scope: dict[str, str] | None,
) -> None:
    write_readme(root, from_date, to_date, source, stats, warnings)
    attachment_status = Counter(item["status"] for item in attachments)
    manifest = {
        "format": "sgwoods-accounting-export-v1",
        "tool_version": TOOL_VERSION,
        "created_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source_label": source,
        "source": {
            "database": database_name,
            "collection": COLLECTION,
            "filter": {
                "domain": DOMAIN,
                "verificationDate_gte": from_date.isoformat(),
                "verificationDate_lte": to_date.isoformat(),
            },
            "access_mode": "read-only",
            "s3_scope": s3_scope,
        },
        "statistics": stats,
        "attachment_status": dict(sorted(attachment_status.items())),
        "validation": {
            "status": "ok" if not warnings else "warnings",
            "warning_count": len(warnings),
            "warnings": warnings,
        },
    }
    manifest["artifacts"] = artifact_inventory(root, {"manifest.json", "SHA256SUMS"})
    write_json(root / "manifest.json", manifest)
    checksummed = artifact_inventory(root, {"SHA256SUMS"})
    (root / "SHA256SUMS").write_text(
        "".join(f"{item['sha256']}  {item['path']}\n" for item in checksummed),
        encoding="utf-8",
    )


def run(args: argparse.Namespace) -> tuple[Path, list[str]]:
    output = args.output.expanduser().resolve()
    if output.exists():
        raise ExportError(f"Output path already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_name(f".{output.name}.partial-{uuid.uuid4().hex[:8]}")
    partial.mkdir(mode=0o700)

    try:
        source = source_label(args)
        if args.fixture:
            records, known_numbers = load_fixture(
                args.fixture, args.from_date, args.to_date
            )
            database_name = "fixture"
            configured_s3_scope = None
        else:
            bucket, prefix, region = storage_scope()
            configured_s3_scope = {
                "bucket": bucket,
                "verification_prefix": prefix,
                "region": region,
            }
            records, database_name, known_numbers = load_mongo(
                args.from_date, args.to_date
            )
        records = sorted_verifications(records)
        warnings, stats = validation(records, known_numbers)

        write_json(partial / "source" / "verifications.json", records)
        ledger_rows = create_csv_reports(partial, records)
        attachments, attachment_warnings = download_attachments(
            partial,
            records,
            args.skip_files,
            fixture_mode=bool(args.fixture),
        )
        warnings.extend(attachment_warnings)
        write_attachment_index(partial, attachments)

        if not args.skip_pdf:
            create_pdf(
                partial / "reports" / "huvudbok.pdf",
                ledger_rows,
                args.from_date,
                args.to_date,
                source,
            )

        finalize_bundle(
            partial,
            args.from_date,
            args.to_date,
            source,
            stats,
            warnings,
            attachments,
            database_name,
            configured_s3_scope,
        )
        partial.rename(output)
        return output, warnings
    except Exception:
        shutil.rmtree(partial, ignore_errors=True)
        raise


def main() -> int:
    args = parse_args()
    try:
        output, warnings = run(args)
    except ExportError as exc:
        print(f"Export failed: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Export failed: {type(exc).__name__}: {clean_text(exc)}", file=sys.stderr)
        return 1

    print(f"Export complete: {output}")
    print(f"Validation warnings: {len(warnings)}")
    if warnings:
        for warning in warnings:
            print(f"WARNING: {warning}")
    if warnings and args.fail_on_warning:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
