import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { anthropicModel, shortResponseOptions } from "@/lib/agent/model";
import type { StudyProfile, StudyProduct } from "@/lib/study/agent";

// Only these shop hosts can be fetched by the server. A model-supplied URL is
// never fetched until its host and protocol have passed this check.
const shopDomains = ["walmart.com", "target.com", "amazon.com"];
const fixedUsdToKrw = 1350;
const maxPageBytes = 4_000_000;

export type LiveStudyProduct = StudyProduct & {
  dataset_version: string; profile_codes: string[]; image_url: string;
  price_original_usd: number; fx_rule: string; source_url: string; reviewed: true;
};

function shopUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!shopDomains.some(domain => host === domain || host.endsWith(`.${domain}`))) return null;
    const path=url.pathname.toLowerCase();
    const productPath=host.endsWith("walmart.com") ? path.startsWith("/ip/")
      : host.endsWith("target.com") ? path.startsWith("/p/")
      : /\/(?:dp|gp\/product)\//.test(path);
    if (!productPath) return null;
    url.hash = "";
    url.search = "";
    return url;
  } catch { return null; }
}

function searchResultUrls(content: unknown): string[] {
  const urls: string[] = [];
  if (!Array.isArray(content)) return urls;
  for (const block of content) {
    if (!block || typeof block !== "object" || (block as {type?: string}).type !== "web_search_tool_result") continue;
    const results = (block as {content?: unknown}).content;
    if (results && typeof results === "object" && !Array.isArray(results)
      && (results as {type?:string}).type === "web_search_tool_result_error")
      throw new Error(`LIVE_WEB_SEARCH_ERROR:${String((results as {error_code?:unknown}).error_code ?? "unknown")}`);
    if (!Array.isArray(results)) continue;
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const url = (result as {url?: unknown}).url;
      if (typeof url === "string" && shopUrl(url)) urls.push(url);
    }
  }
  return [...new Set(urls)].slice(0,8);
}

function plain(value: unknown, limit = 4000): string {
  return typeof value === "string" ? value.replace(/<[^>]*>/g," ")
    .replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&#x27;/g,"'")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim().slice(0,limit) : "";
}

function productNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(productNodes);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const type = object["@type"];
  const types = Array.isArray(type) ? type : [type];
  const own = types.some(item => typeof item === "string" && (item === "Product" || item.endsWith("/Product"))) ? [object] : [];
  return [...own, ...productNodes(object["@graph"])];
}

function offerPrice(product: Record<string, unknown>): number | null {
  const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
  for (const candidate of offers) {
    if (!candidate || typeof candidate !== "object") continue;
    const offer = candidate as Record<string, unknown>;
    const nested = offer.priceSpecification && typeof offer.priceSpecification === "object"
      ? offer.priceSpecification as Record<string, unknown> : null;
    if (String(offer.availability ?? "").toLowerCase().includes("outofstock")) continue;
    const currency = String(offer.priceCurrency ?? nested?.priceCurrency ?? "");
    if (currency.toUpperCase() !== "USD") continue;
    const raw = offer.price ?? nested?.price;
    const price = Number(typeof raw === "string" ? raw.replace(/[$,]/g,"") : raw);
    if (Number.isFinite(price) && price > 0) return price;
  }
  return null;
}

function imageUrl(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  const raw = typeof first === "string" ? first : first && typeof first === "object"
    ? (first as Record<string,unknown>).url : null;
  if (typeof raw !== "string") return "";
  try { const url = new URL(raw); return url.protocol === "https:" ? url.href : ""; }
  catch { return ""; }
}

async function readPage(initial: URL): Promise<{url:URL;html:string} | null> {
  let url=initial;
  for (let redirects=0;redirects<3;redirects++) {
    const response = await fetch(url.href, { redirect:"manual", cache:"no-store",
      headers:{ "accept":"text/html", "user-agent":"Mozilla/5.0 (compatible; GiftStudyProductVerifier/1.0)" },
      signal:AbortSignal.timeout(9000) });
    if (response.status>=300 && response.status<400) {
      const location=response.headers.get("location");
      if (!location) return null;
      const next=shopUrl(new URL(location,url).href);
      if (!next) return null;
      url=next;continue;
    }
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html") || !response.body) return null;
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    let html="", size=0;
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>maxPageBytes) { await reader.cancel(); return null; }
      html+=decoder.decode(value,{stream:true});
    }
    return {url,html:html+decoder.decode()};
  }
  return null;
}

function productMeta(html:string): Record<string,string> {
  const meta:Record<string,string>={};
  for (const tag of html.match(/<meta\b[^>]*>/gi)??[]) {
    const attrs:Record<string,string>={};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi)) attrs[match[1].toLowerCase()]=match[3];
    const key=attrs.property??attrs.name;
    if (key && attrs.content) meta[key.toLowerCase()]=attrs.content;
  }
  return meta;
}

async function verifyProductPage(rawUrl: string, budgetKrw: number): Promise<LiveStudyProduct | null> {
  const url=shopUrl(rawUrl);
  if (!url) return null;
  let page: {url:URL;html:string} | null;
  try { page=await readPage(url); }
  catch { return null; }
  if (!page) return null;
  const scripts=[...page.html.matchAll(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)];
  const candidates:Record<string,unknown>[]=[];
  for (const script of scripts) {
    let json: unknown;
    try { json=JSON.parse(script[1]); } catch { continue; }
    candidates.push(...productNodes(json));
  }
  const meta=productMeta(page.html);
  if (meta["product:price:amount"] && meta["product:price:currency"]?.toUpperCase()==="USD") {
    candidates.push({name:meta["og:title"],description:meta["og:description"],image:meta["og:image"],
      category:"상품 종류 미기록",offers:{price:meta["product:price:amount"],priceCurrency:"USD"}});
  }
  for (const product of candidates) {
      const name=plain(product.name,500);
      const description=plain(product.description);
      const image=imageUrl(product.image);
      const usd=offerPrice(product);
      if (!name || !image || usd===null) continue;
      const priceKrw=Math.round(usd*fixedUsdToKrw/100)*100;
      if (priceKrw<100 || priceKrw>Math.min(budgetKrw,50000)) continue;
      // A product ID identifies the verified facts shown to participants. If a
      // seller changes the price, image or description, a later search must
      // create a new row instead of altering an approved recipient stimulus.
      const identity=createHash("sha256").update(JSON.stringify({url:page.url.href,name,description,image,usd,
        category:plain(product.category,200)})).digest("hex").slice(0,24);
      return {
        source_product_id:`web:${identity}`, dataset_version:`live-web-${new Date().toISOString()}`,
        profile_codes:["R1","R2","R3","R4"], name_original:name, name_ko:name,
        description_original:description || name, image_url:image,
        category:plain(product.category,200) || "상품 종류 미기록",
        price_original_usd:Math.round(usd*100)/100, price_krw:priceKrw,
        fx_rule:"fixed-1350-round-100", source_url:page.url.href, reviewed:true,
      };
  }
  return null;
}

export async function searchLiveProducts(input: {
  request: string; profile: StudyProfile; excludedIds: string[]; minimum?: number;
}): Promise<{products: LiveStudyProduct[]; model: string; responseId: string; responseIds:string[]; latencyMs: number; urlsSeen: number}> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY_MISSING");
  const model=anthropicModel();
  const began=performance.now();
  const client=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,timeout:25_000,maxRetries:0});
  const system="Search real shopping product pages for the Korean user's requested gift direction. Use web_search. Prefer exact product pages with a current USD price, not category or search pages. Do not invent products or prices. The application will independently read and validate source pages; your prose is not used as product data.";
  const webTool={type:"web_search_20250305" as const,name:"web_search" as const,max_uses:3,allowed_domains:shopDomains};
  const minimum=Math.min(3,Math.max(1,input.minimum??1));
  const products=new Map<string,LiveStudyProduct>();
  const searchedUrls=new Set<string>();
  const responseIds:string[]=[];
  for (let attempt=0;attempt<2 && products.size<minimum;attempt++) {
    const userMessage={role:"user" as const,content:JSON.stringify({request:input.request,
      recipient:{interests:input.profile.hobbies,recent_interest:input.profile.recent_interest,
        preference:input.profile.preference,dislike:input.profile.dislike},
      maximum_study_budget_krw:input.profile.gift_budget,
      note:"Search exact product pages on Walmart, Target or Amazon. Search in English as needed."
        +(attempt?" Previous results did not yield enough verifiable product pages; try different product pages and retailer search terms.":"")})};
    let response=await client.messages.create({model,max_tokens:800,...shortResponseOptions(model),
      system,messages:[userMessage],tools:[webTool]});
    responseIds.push(response.id);
    const blocks=[...response.content];
    if (response.stop_reason==="pause_turn" && !searchResultUrls(blocks).length) {
      response=await client.messages.create({model,max_tokens:800,...shortResponseOptions(model),
        system,messages:[userMessage,{role:"assistant",content:response.content}],tools:[webTool]});
      responseIds.push(response.id);
      blocks.push(...response.content);
    }
    if (!blocks.some(block=>block.type==="server_tool_use" && block.name==="web_search"))
      throw new Error("LIVE_WEB_SEARCH_NOT_RUN");
    const urls=searchResultUrls(blocks).filter(url=>!searchedUrls.has(url));
    urls.forEach(url=>searchedUrls.add(url));
    const checked=await Promise.all(urls.map(url=>verifyProductPage(url,input.profile.gift_budget)));
    for (const item of checked) if (item && !input.excludedIds.includes(item.source_product_id))
      products.set(item.source_product_id,item);
  }
  return {products:[...products.values()].slice(0,5),model,responseId:responseIds.at(-1)??"",
    responseIds,latencyMs:Math.round(performance.now()-began),urlsSeen:searchedUrls.size};
}
