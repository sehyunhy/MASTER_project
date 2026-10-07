#!/usr/bin/env python3
"""Offline, repeatable CSV -> Supabase SQL. No network or secret is required.

Run with a researcher-approved fixed USD/KRW rate. The CSV is a historical
snapshot; imported experiment prices are explicitly derived, never live prices.
"""
import argparse
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import html
import json
from pathlib import Path
import re
from collections import Counter
from hashlib import sha256

VERSION = "walmart-2024-08-v1"
# Exact source IDs, selected after reviewing original titles and categories.
# This list is deliberately small: the CSV has insufficient suitable items for
# several research profiles. Do not fill the gaps with unrelated merchandise.
REVIEWED = {
    "1226247035": ("R1", "전해질 음료 분말", ["운동", "음료", "electrolyte"], "운동 후 음료를 찾는 상황과 관련된 원본 상품입니다."),
    "299112609": ("R1", "블랙체리 워터 인핸서", ["음료", "휴대", "water flavoring"], "물을 마시는 습관과 관련된 원본 상품입니다."),
    "306465658": ("R2", "인디언 몬순 디카페인 원두커피", ["커피", "원두", "coffee"], "집에서 커피를 즐기는 관심사와 관련된 원본 상품입니다."),
    "973604797": ("R3", "8×10인치 사진 액자", ["사진", "기록", "picture frame"], "사진을 보관하고 전시하는 관심사와 관련된 원본 상품입니다."),
    "10308385": ("R4", "올드베이 클래식 시즈닝", ["요리", "시즈닝", "seasoning"], "집에서 요리하는 상황과 관련된 원본 상품입니다."),
    "36995775": ("R4", "대시 오리지널 시즈닝", ["요리", "시즈닝", "seasoning"], "집에서 요리하는 상황과 관련된 원본 상품입니다."),
    "5464020385": ("R4", "쿠진아트 스모키 메이플 베이컨 시즈닝", ["요리", "시즈닝", "seasoning"], "집에서 요리하는 상황과 관련된 원본 상품입니다."),
    "864008591": ("R4", "네이비 블루 테이블 러너", ["식탁", "홈 라이프", "table runner"], "식탁을 꾸미는 관심사와 관련된 원본 상품입니다."),
}

def quoted(value):
    if value is None:
        return "NULL"
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return "'" + str(value).replace("'", "''") + "'"

def json_value(value, default, issues, field):
    if not value:
        issues.append("missing:" + field)
        return default
    try:
        parsed = json.loads(value)
        if isinstance(parsed, type(default)):
            return parsed
        issues.append("parse_error:" + field)
        return default
    except (json.JSONDecodeError, TypeError):
        issues.append("parse_error:" + field)
        return default

def clean_description(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value or ""))).strip()

def normalize(row, rate, rounding):
    issues = []
    source_id = row.get("product_id", "").strip()
    sku = row.get("sku", "").strip()
    title = html.unescape(row.get("product_name", "").strip())
    if not source_id or not sku or not title:
        return None, ["missing:required_id_or_name"]
    raw_price = row.get("final_price", "").strip()
    try:
        usd = Decimal(raw_price)
        if not usd.is_finite() or usd < 0:
            raise InvalidOperation()
        usd = usd.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return None, ["parse_error:final_price"]
    if row.get("currency") != "USD":
        return None, ["unsupported:currency"]
    krw = int((usd * rate / rounding).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * rounding)
    image = row.get("main_image", "").strip().strip('"').strip("'")
    if image and not image.startswith("https://"):
        issues.append("parse_error:main_image")
        image = None
    image_urls = json_value(row.get("image_urls"), [], issues, "image_urls")
    specs = json_value(row.get("specifications"), [], issues, "specifications")
    categories = json_value(row.get("categories"), [], issues, "categories")
    reviewed = REVIEWED.get(source_id)
    profile_codes = [reviewed[0]] if reviewed else []
    tags = reviewed[2] if reviewed else []
    # A reviewed item still needs a valid historical price and source image.
    eligible = bool(reviewed and image and title and krw <= 50000)
    original_description = row.get("description", "")
    display_description = clean_description(original_description)
    if not original_description:
        issues.append("missing:description")
    data = {
        "sku": "WM-" + source_id, "source_product_id": source_id,
        "product_name": reviewed[1] if reviewed else title,
        "product_name_original": title, "product_name_ko": reviewed[1] if reviewed else None,
        "brand": row.get("brand") or None, "category": row.get("category_name") or row.get("root_category_name") or "Uncategorized",
        "price": krw, "currency": "KRW", "price_original": str(usd), "currency_original": "USD",
        "price_experiment": krw, "currency_experiment": "KRW", "fx_rate_version": f"fixed-{rate}-round-{rounding}",
        "description": display_description or title,
        "description_original": original_description, "description_ko": None,
        "image_url": image, "image_source": "walmart_csv",
        "image_urls": image_urls, "specifications": specs, "categories": categories,
        "search_tags_ko": tags, "fit_tags": tags, "profile_codes": profile_codes,
        "use_cases": [reviewed[3]] if reviewed else [], "strengths": [], "limitations": [], "care_requirements": None,
        "source": "user_provided_walmart_csv", "source_type": "walmart_csv_snapshot",
        "source_url": row.get("url") or None, "source_timestamp": None,
        "source_timestamp_raw": row.get("timestamp") or None,
        "dataset_version": VERSION, "version": VERSION, "is_mock": False, "is_active": True,
        "experiment_eligible": eligible, "review_status": "reviewed" if reviewed else "unreviewed",
        "raw_record": row, "import_issues": issues,
    }
    return data, issues

def statement(data):
    columns = list(data)
    json_columns = {"image_urls", "specifications", "categories", "raw_record"}
    array_columns = {"search_tags_ko", "fit_tags", "profile_codes", "use_cases", "strengths", "limitations", "import_issues"}
    values = []
    for key in columns:
        value = data[key]
        if isinstance(value, bool):
            values.append("true" if value else "false")
        elif key in json_columns:
            values.append(quoted(value) + "::jsonb")
        elif key in array_columns:
            values.append("ARRAY[" + ",".join(quoted(item) for item in value) + "]::text[]")
        elif key in {"price", "price_experiment", "price_original"}:
            values.append(str(value))
        else:
            values.append(quoted(value))
    update = ",".join(f"{key}=excluded.{key}" for key in columns if key != "sku")
    return f"insert into public.product_catalog ({','.join(columns)}) values ({','.join(values)}) on conflict (sku) do update set {update};\n"

def csv_value(key, value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if key in {"image_urls", "specifications", "categories", "raw_record"}:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if key in {"search_tags_ko", "fit_tags", "profile_codes", "use_cases", "strengths", "limitations", "import_issues"}:
        return "{" + ",".join('"' + str(item).replace("\\", "\\\\").replace('"', '\\"') + '"' for item in value) + "}"
    return str(value)

def stimulus_snapshot(item):
    return {
        "source_product_id": item["source_product_id"], "sku": item["sku"],
        "product_name": item["product_name"], "product_name_original": item["product_name_original"],
        "brand": item["brand"], "category": item["category"], "price": item["price"],
        "currency": "KRW", "price_original": item["price_original"], "currency_original": "USD",
        "fx_rate_version": item["fx_rate_version"], "description": item["description"],
        "description_original": item["description_original"], "image_url": item["image_url"],
        "specifications": item["specifications"], "source_url": item["source_url"],
        "source_timestamp": item["source_timestamp_raw"], "dataset_version": VERSION,
        "use_cases": item["use_cases"], "strengths": [], "limitations": [],
        "care_requirements": None, "fit_reason": item["use_cases"][0],
        "source_type": "walmart_csv_snapshot", "is_mock": False,
    }

def stimulus_statement(profile, items):
    candidates = [stimulus_snapshot(item) for item in items[:3]]
    product_ids = [item["source_product_id"] for item in items[:3]]
    scenario_id = "gift-scenario-" + profile
    stimulus_id = scenario_id + "-v1"
    transcript = {
        "criteria_dropdown": "선택해서 입력하기 · 카테고리: " + items[0]["category"] + " · 관심사: " + ", ".join(items[0]["search_tags_ko"][:2]),
        "criteria_category": items[0]["category"],
        "criteria_priority": "일상에서 사용",
        "criteria_giver": "상대의 관심사를 고려해 선물 후보를 살펴보고 싶어요.",
        "criteria_agent": "제공된 기준과 기록된 상품 정보로 후보를 확인하겠습니다.",
        "request_candidates": "이 기준으로 선물 후보를 찾아주세요.",
        "candidate_agent": "기록된 상품에서 세 후보를 구성했습니다.",
        "request_comparison": "세 후보를 같은 기준으로 비교해주세요.",
        "comparison_agent": "표에 표시된 원본 상품 정보와 실험용 고정 가격을 비교했습니다. 기록에 없는 특성은 정보 없음으로 표시합니다.",
        "giver_decision": "첫 번째 후보로 할게요.",
        "agent_decision": "표시된 후보 중 첫 번째 후보를 최종 선물로 결정했습니다.",
    }
    digest = sha256(json.dumps(candidates, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return ("insert into public.recipient_stimuli (id,scenario_id,profile_code,version,source_kind,source_note,"
            "candidate_snapshots,final_source_product_id,transcript,candidate_set_hash,review_status) values ("
            + ",".join([quoted(stimulus_id),quoted(scenario_id),quoted(profile),"1",quoted("researcher_scripted"),
                        quoted("연구자가 구성한 시나리오; 2024-08 사용자 제공 CSV 스냅샷"),
                        quoted(candidates)+"::jsonb",quoted(product_ids[0]),quoted(transcript)+"::jsonb",quoted(digest),quoted("pending")])
            + ") on conflict (id) do nothing;\n")

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--csv", default="walmart-products.csv")
    p.add_argument("--fx-rate", required=True, type=Decimal, help="Researcher-approved KRW per USD")
    p.add_argument("--round-krw", required=True, type=Decimal, help="Researcher-approved rounding increment")
    p.add_argument("--output", default="supabase/seed-walmart-products.sql")
    p.add_argument("--csv-output", default="supabase/seed-walmart-products-import.csv", help="Normalized CSV for Supabase Table Editor")
    p.add_argument("--batch-size",type=int,default=100,help="Rows per SQL Editor batch")
    args = p.parse_args()
    if args.fx_rate <= 0 or args.round_krw <= 0 or args.round_krw != args.round_krw.to_integral_value() or args.batch_size<=0:
        p.error("FX rate and integer KRW rounding increment must be positive")
    with open(args.csv, newline="", encoding="utf-8-sig") as source:
        rows = list(csv.DictReader(source))
    seen = set()
    good = []
    issue_counts = Counter()
    excluded = Counter()
    categories = Counter()
    eligible_profiles = Counter()
    for row in rows:
        source_id = row.get("product_id", "")
        if source_id in seen:
            excluded["duplicate_product_id"] += 1
            continue
        seen.add(source_id)
        data, issues = normalize(row, args.fx_rate, args.round_krw)
        issue_counts.update(issues)
        if data is None:
            excluded.update(issues)
            continue
        good.append(data)
        categories[row.get("root_category_name") or "Unknown"] += 1
        if data["experiment_eligible"]:
            eligible_profiles.update(data["profile_codes"])
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    csv_output = Path(args.csv_output)
    csv_output.parent.mkdir(parents=True, exist_ok=True)
    if good:
        columns = [name for name in good[0] if name != "source_timestamp"]
        with csv_output.open("w", newline="", encoding="utf-8-sig") as dest:
            writer = csv.writer(dest)
            writer.writerow(columns)
            for data in good:
                writer.writerow([csv_value(name, data[name]) for name in columns])
    with output.open("w", encoding="utf-8") as dest:
        dest.write("-- Generated from the user-provided August 2024 CSV. Historical reference prices.\n")
        dest.write(f"-- Fixed study conversion: 1 USD = {args.fx_rate} KRW; round to nearest {args.round_krw} KRW.\n")
        dest.write("begin;\n")
        for data in good:
            dest.write(statement(data))
        dest.write("commit;\n")
    batch_dir=output.with_name(output.stem+"-batches")
    batch_dir.mkdir(exist_ok=True)
    for old in batch_dir.glob("batch-*.sql"):
        old.unlink()
    for index in range(0,len(good),args.batch_size):
        batch=batch_dir/f"batch-{index//args.batch_size+1:02d}.sql"
        with batch.open("w",encoding="utf-8") as dest:
            dest.write(f"-- Historical CSV rows {index+1} to {min(index+args.batch_size,len(good))}; apply in order.\nbegin;\n")
            for data in good[index:index+args.batch_size]:
                dest.write(statement(data))
            dest.write("commit;\n")
    stimulus_path=output.with_name("seed-walmart-stimuli.sql")
    with stimulus_path.open("w",encoding="utf-8") as dest:
        dest.write("-- Review each candidate and transcript before approving; pending rows cannot be shown.\nbegin;\n")
        for profile in ("R1","R2","R3","R4"):
            matches=[item for item in good if item["experiment_eligible"] and profile in item["profile_codes"]]
            if len(matches)>=3:
                dest.write(stimulus_statement(profile,matches))
        dest.write("commit;\n")
    report = {"source_rows":len(rows),"processed":len(good),"excluded":sum(excluded.values()),
              "exclusion_reasons":dict(excluded),"parse_and_missing_issues":dict(issue_counts),
              "root_categories":dict(categories),"eligible_by_profile":dict(eligible_profiles),
              "profile_shortfalls":{code:max(0,3-eligible_profiles[code]) for code in ("R1","R2","R3","R4")},
              "dataset_version":VERSION,"source_claim":"user-provided CSV; no official or live-price claim"}
    report_path=output.with_suffix(".report.json")
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"sql":str(output),"csv_import":str(csv_output),"batch_directory":str(batch_dir),"batch_count":(len(good)+args.batch_size-1)//args.batch_size,"stimuli_sql":str(stimulus_path),"report":str(report_path),**report},ensure_ascii=False,indent=2))

if __name__ == "__main__":
    main()
