import type { StudyProduct } from "@/lib/study/agent";

export function rankedCatalog(products: StudyProduct[], terms: string[], limit = 30): StudyProduct[] {
  const phrases=[...new Set(terms.map(term=>term.toLowerCase().replace(/[^a-z0-9\s-]/g," ").replace(/\s+/g," ").trim())
    .filter(term=>term.length>=3))];
  const ranked=products.map(product=>{
    const name=product.name_original.toLowerCase();
    const category=product.category.toLowerCase();
    const description=product.description_original.toLowerCase();
    const score=phrases.reduce((total,term)=>total+
      (name.includes(term)?12:0)+(category.includes(term)?8:0)+(description.includes(term)?2:0),0);
    return {product,score};
  }).filter(item=>item.score>0);
  ranked.sort((a,b)=>b.score-a.score||a.product.source_product_id.localeCompare(b.product.source_product_id));
  return ranked.slice(0,limit).map(item=>item.product);
}
