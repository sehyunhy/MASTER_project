type Environment = Record<string,string|undefined>;

function exactOrSuffixed(environment:Environment, names:string[], allowPublic=false) {
  for(const name of names)if(environment[name])return environment[name];
  const keys=Object.keys(environment);
  for(const suffix of names){
    const found=keys.find(key=>key.endsWith("_"+suffix)&&(allowPublic||!key.startsWith("NEXT_PUBLIC_"))&&Boolean(environment[key]));
    if(found)return environment[found];
  }
  return undefined;
}

export function supabaseServerEnvironment(environment:Environment=process.env) {
  const url=exactOrSuffixed(environment,["SUPABASE_URL","NEXT_PUBLIC_SUPABASE_URL"],true);
  const key=exactOrSuffixed(environment,["SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY"]);
  return {url,key};
}

export function supabaseServerSecret(environment:Environment=process.env) {
  return exactOrSuffixed(environment,["SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY"]);
}
