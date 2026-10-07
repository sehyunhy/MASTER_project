import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { supabaseServerEnvironment } from "../lib/supabase/env";

describe("Supabase Marketplace environment lookup",()=>{
  it("accepts project-ref-prefixed server variables without using a public secret",()=>{
    const result=supabaseServerEnvironment({
      NEXT_PUBLIC_emcodxlxesrrpiaspvdk_SUPABASE_URL:"https://project.supabase.co",
      emcodxlxesrrpiaspvdk_SUPABASE_SERVICE_ROLE_KEY:"server-secret",
      NEXT_PUBLIC_emcodxlxesrrpiaspvdk_SUPABASE_SECRET_KEY:"must-not-be-used",
    });
    assert.deepEqual(result,{url:"https://project.supabase.co",key:"server-secret"});
  });

  it("prefers the explicit unprefixed local variables",()=>{
    const result=supabaseServerEnvironment({
      SUPABASE_URL:"https://local.supabase.co",
      SUPABASE_SECRET_KEY:"local-secret",
      emcodxlxesrrpiaspvdk_SUPABASE_URL:"https://other.supabase.co",
    });
    assert.deepEqual(result,{url:"https://local.supabase.co",key:"local-secret"});
  });
});
