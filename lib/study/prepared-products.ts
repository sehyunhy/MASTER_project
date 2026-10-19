import { supabaseAdmin } from "@/lib/supabase/server";
import type { StudyProduct } from "@/lib/study/agent";

export const PREPARED_DATASET_VERSION = "walmart-csv-2024-08-study-nine-v1";

const SOURCE_IDS = [
  "3440558193", "2010024322", "1093743201", "1097677016", "973604797",
  "3511393855", "10308385", "36995775", "14123516",
].map(id => `walmart-csv:${id}`);

export type PreparedStudyProduct = StudyProduct & {
  dataset_version: string; profile_codes: string[]; image_url: string;
  price_original_usd: number; fx_rule: string; source_url: string; reviewed: boolean;
};

// Only the nine source rows inserted by study-prepared-nine.sql may enter this pool.
export async function preparedProducts(db: ReturnType<typeof supabaseAdmin>, budget: number,
  profileCode?: string): Promise<PreparedStudyProduct[]> {
  const { data, error } = await db.from("study_products").select("*")
    .eq("dataset_version", PREPARED_DATASET_VERSION)
    .in("source_product_id", SOURCE_IDS).eq("reviewed", true)
    .order("source_product_id");
  if (error) throw error;
  const rows = (data ?? []) as PreparedStudyProduct[];
  if (rows.length !== SOURCE_IDS.length ||
    new Set(rows.map(row => row.source_product_id)).size !== SOURCE_IDS.length)
    throw new Error("PREPARED_CATALOG_INCOMPLETE");
  const available = rows.filter(row => row.price_krw <= budget &&
    (!profileCode || row.profile_codes.includes(profileCode)));
  if (available.length < 3) throw new Error("PREPARED_PROFILE_POOL_INCOMPLETE");
  return available;
}
