"""Build the additive, reproducible study catalog from a Walmart CSV snapshot.

Usage: python3 scripts/build_walmart_catalog_sql.py /path/to/walmart-products.csv
The output is supabase/study-walmart-catalog.sql. Existing curated rows are kept.
"""

import csv
import html
import json
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "supabase" / "study-walmart-catalog.sql"
COLUMNS = "(source_product_id,dataset_version,profile_codes,name_original,name_ko,description_original,image_url,category,price_original_usd,price_krw,fx_rule,source_url,reviewed)"


def quoted(value: str) -> str:
    return "'" + value.replace("\x00", "").replace("'", "''") + "'"


def clean(value: str, limit: int) -> str:
    value = html.unescape(re.sub(r"<[^>]+>", " ", value or ""))
    return re.sub(r"\s+", " ", value).strip()[:limit]


def valid_url(value: str, domain: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and (host == domain or host.endswith("." + domain))


def main_image(value: str) -> str:
    try:
        decoded = json.loads(value)
    except (TypeError, ValueError):
        decoded = value
    if isinstance(decoded, list):
        decoded = decoded[0] if decoded else ""
    return decoded if isinstance(decoded, str) and valid_url(decoded, "walmartimages.com") else ""


def build(path: Path) -> tuple[list[str], int]:
    values: list[str] = []
    seen: set[str] = set()
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = csv.DictReader(handle)
        for row in rows:
            if row.get("currency") != "USD":
                continue
            try:
                usd = Decimal(row.get("final_price", ""))
                krw = int((usd * Decimal(1350) / Decimal(100)).quantize(0, rounding=ROUND_HALF_UP) * 100)
            except (InvalidOperation, ValueError):
                continue
            product_id = (row.get("product_id") or "").strip()
            name = clean(row.get("product_name") or "", 500)
            description = clean(row.get("description") or "", 4000)
            image = main_image(row.get("main_image") or "")
            source = (row.get("url") or "").strip()
            if not (0 < krw <= 50000 and usd > 0 and product_id and name and description and image
                    and valid_url(source, "walmart.com") and product_id not in seen):
                continue
            seen.add(product_id)
            category = clean(row.get("category_name") or row.get("root_category_name") or "", 200) or "상품 종류 미기록"
            parts = [quoted(product_id), quoted("walmart-2024-08-import-v1"),
                     "array['R1','R2','R3','R4']", quoted(name), quoted(name),
                     quoted(description), quoted(image), quoted(category), str(usd), str(krw),
                     quoted("fixed-1350-round-100"), quoted(source), "true"]
            values.append("  (" + ",".join(parts) + ")")
    statements = []
    for start in range(0, len(values), 100):
        statements.append("insert into public.study_products " + COLUMNS + " values\n"
                          + ",\n".join(values[start:start + 100])
                          + "\non conflict (source_product_id) do nothing;")
    return statements, len(values)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/build_walmart_catalog_sql.py /path/to/walmart-products.csv")
    statements, count = build(Path(sys.argv[1]))
    if not count:
        raise SystemExit("No complete USD product rows within the 50,000 KRW study limit")
    OUTPUT.write_text("-- Additive snapshot import. Does not replace curated rows or any trial data.\n"
                      "-- `reviewed=true` here means required source fields and fixed study budget passed\n"
                      "-- automated checks. It does not mean a researcher manually approved each item.\n"
                      "-- Historical Walmart CSV prices, not live checkout prices.\n"
                      "begin;\n" + "\n\n".join(statements) + "\ncommit;\n", encoding="utf-8")
    print(f"Prepared {count} eligible product rows in {OUTPUT}")
