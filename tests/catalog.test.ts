import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function importCsv(csv:string){
  const dir=mkdtempSync(join(tmpdir(),"walmart-import-check-"));
  const sql=join(dir,"products.sql");
  const result=spawnSync("python3",["scripts/importWalmartCsv.py","--csv",csv,"--fx-rate","1300","--round-krw","100","--output",sql,"--csv-output",join(dir,"products-import.csv")],{encoding:"utf-8"});
  assert.equal(result.status,0,result.stderr);
  return {dir,sql,report:JSON.parse(readFileSync(join(dir,"products.report.json"),"utf8"))};
}

describe("historical Walmart CSV importer",()=>{
  it("preserves scientific prices, JSON specs, raw names and parse errors",()=>{
    const output=importCsv("tests/fixtures/walmart-small.csv");
    try{
      const content=readFileSync(output.sql,"utf8");
      assert.equal(output.report.source_rows,2);
      assert.equal(output.report.processed,2);
      assert.equal(output.report.parse_and_missing_issues["parse_error:specifications"],1);
      assert.ok(content.includes("22.90"));
      assert.ok(content.includes("Gift & care"));
      assert.ok(content.includes("Example Item"));
      assert.ok(content.includes("on conflict (sku) do update"));
    }finally{rmSync(output.dir,{recursive:true,force:true});}
  });
  it("audits the supplied 1,000-row source when it is present locally",()=>{
    if(!existsSync("walmart-products.csv"))return;
    const output=importCsv("walmart-products.csv");
    try{
      assert.equal(output.report.source_rows,1000);
      assert.equal(output.report.processed,1000);
      assert.equal(output.report.excluded,0);
      assert.equal(output.report.root_categories.Clothing,594);
      assert.ok(output.report.profile_shortfalls.R2>0);
      assert.ok(!readFileSync(output.sql,"utf8").includes("RG2-001-01"));
    }finally{rmSync(output.dir,{recursive:true,force:true});}
  });
});
