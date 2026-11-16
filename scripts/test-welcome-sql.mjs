import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';

const container = 'headstails-welcome-qa';
const label = 'welcome-isolated-tests';
const run = (args, input) => execFileSync('docker', args, { input, encoding:'utf8', stdio:['pipe','pipe','pipe'] }).trim();
let created = false, passed = 0;
const sqlArgs = ['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'];
const sql = text => run(sqlArgs, text);
const concurrent = text => new Promise((resolve,reject) => {
  const child = execFile('docker',sqlArgs,{encoding:'utf8'},(error,out,err)=>error?reject(new Error(err)):resolve(out.trim()));
  child.stdin.end(text);
});
async function test(name, fn) { await fn(); passed++; console.log('PASS '+name); }
try {
  // Never reuse, stop or alter the user's Supabase stack or another test container.
  const exists = run(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']);
  assert.equal(exists,'','A previous dedicated fixture exists; inspect it before reuse');
  run(['run','-d','--rm','--name',container,'--label',`headstails.purpose=${label}`,'-e','POSTGRES_PASSWORD=welcome_disposable_test_only','postgres:17-alpine']); created = true;
  for(let n=0;n<30;n++) {
    try { sql('select 1;'); break; } catch { if(n===29) throw new Error('Disposable PostgreSQL did not start'); await new Promise(r=>setTimeout(r,400)); }
  }
  sql('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;');
  const migration = fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_site_welcome_visits.sql'));
  assert.ok(migration); sql(fs.readFileSync(`supabase/migrations/${migration}`,'utf8'));
  const digest = 'ab'.repeat(32), call = `set role service_role; select public.claim_site_welcome_visit('${digest}');`;
  await test('first IP claim is true; every later browser with the same digest is false', () => {
    assert.match(sql(call),/t$/); assert.match(sql(call),/f$/); assert.equal(sql('select count(*) from public.site_welcome_visits;'),'1');
  });
  await test('simultaneous first requests produce exactly one introduction', async () => {
    const key = 'cd'.repeat(32);
    const results = await Promise.all(Array.from({length:12},()=>concurrent(`set role service_role; select public.claim_site_welcome_visit('${key}');`)));
    assert.equal(results.filter(x=>/t$/.test(x)).length,1); assert.equal(results.filter(x=>/f$/.test(x)).length,11);
  });
  await test('raw IPs and invalid fingerprints cannot be persisted', () => {
    assert.throws(()=>sql("set role service_role; select public.claim_site_welcome_visit('203.0.113.9');"));
    assert.equal(sql("select count(*) from information_schema.columns where table_schema='public' and table_name='site_welcome_visits';"),'2');
  });
  await test('public browser roles cannot read or write preferences or execute the claim function', () => {
    for(const role of ['anon','authenticated']) {
      assert.throws(()=>sql(`set role ${role}; select * from public.site_welcome_visits;`));
      assert.throws(()=>sql(`set role ${role}; select public.claim_site_welcome_visit('${'ef'.repeat(32)}');`));
    }
  });
  await test('RLS stays enabled, function uses caller privileges, and no PUBLIC execute grant exists', () => {
    assert.equal(sql("select relrowsecurity from pg_class where oid='public.site_welcome_visits'::regclass;"),'t');
    assert.equal(sql("select prosecdef from pg_proc where oid='public.claim_site_welcome_visit(text)'::regprocedure;"),'f');
    assert.equal(sql("select count(*) from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='public.claim_site_welcome_visit(text)'::regprocedure and a.grantee=0;"),'0');
  });
  fs.mkdirSync('artifacts/welcome',{recursive:true});
  fs.writeFileSync('artifacts/welcome/sql-results.json',JSON.stringify({passed,failed:0,concurrentRequests:12,productionDatabaseTouched:false},null,2));
  console.log(`${passed} PostgreSQL checks passed; production database untouched`);
} finally {
  if(created) {
    assert.equal(run(['inspect','-f','{{index .Config.Labels "headstails.purpose"}}',container]),label);
    run(['stop',container]);
  }
}
