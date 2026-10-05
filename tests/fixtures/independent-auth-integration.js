const assert = require("assert"),
  fs = require("fs"),
  path = require("path");
const { PGlite } = require("@electric-sql/pglite");
(async () => {
  const db = new PGlite();
  const client = {
    query: async (sql, args) => {
      const r = await db.query(sql, args);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
    release() {},
  };
  const pool = { query: client.query, connect: async () => client };
  require("../../db/postgres").getPool = () => pool;
  // Run the actual application schema in an isolated PostgreSQL engine.
  for (const file of fs
    .readdirSync(path.join(__dirname, "../../db/migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort())
    await db.exec(
      fs
        .readFileSync(path.join(__dirname, "../../db/migrations", file), "utf8")
        .replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""),
    );
  process.env.CD_APP_ORIGIN = "https://app.example";
  process.env.SMTP_HOST = "smtp.example";
  process.env.SMTP_USER = "fixture";
  process.env.SMTP_PASSWORD = "fixture";
  process.env.AUTH_EMAIL_FROM = "fixture@example.invalid";
  const emails = [];
  require("nodemailer").createTransport = () => ({
    sendMail: async (mail) => emails.push(mail),
  });
  const app = require("../../server").app;
  const nativeFetch=global.fetch;let providerCalls=0;
  process.env.OPENAI_API_KEY='fixture-key';process.env.ANTHROPIC_KEY='fixture-key';
  global.fetch=async(url,options)=>{
    providerCalls++;
    if(String(url)==='https://api.openai.com/v1/chat/completions')return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'OK'}}]})};
    if(String(url)==='https://api.anthropic.com/v1/messages')return {ok:true,status:200,text:async()=>JSON.stringify({content:[{text:JSON.stringify({workCompleted:'Fixture daily log'})}]})};
    throw Error('Unexpected provider network request');
  };
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  async function request(route, body, cookie, extra = {}) {
    const response = await nativeFetch(origin + route, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: process.env.CD_APP_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie"),
    };
  }
  function token() {
    return new URL(emails.at(-1).text.split("\n")[1]).searchParams.get(
      "accountToken",
    );
  }
  try {
    let r = await request("/api/auth/signup", {
      email: "new@example.invalid",
      password: "test secure password",
      name: "Test Owner",
      company: "Test Company",
      agreedToTerms: true,
    });
    assert.equal(r.status, 200);
    assert.equal(
      (await db.query("select * from users")).rows.length,
      0,
      "unverified signup has no company access",
    );
    const signupToken = token();
    r = await request("/api/auth/complete", { token: signupToken });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert(r.cookie.includes("HttpOnly"));
    assert(r.cookie.includes("Secure"));
    assert(r.cookie.includes("SameSite=Lax"));
    const cookie = r.cookie.split(";")[0],
      uid = r.body.user.uid;
    assert.equal((await db.query("select * from companies")).rows.length, 1);
    assert.equal(
      (await db.query("select * from company_memberships")).rows.length,
      1,
    );
    assert.equal(
      (await request("/api/data/session", null, cookie)).status,
      200,
    );
    assert.equal(
      (await request("/api/auth/complete", { token: signupToken })).status,
      400,
      "one-time token cannot be replayed",
    );
    assert.equal(
      (
        await request("/api/auth/login", {
          email: "new@example.invalid",
          password: "incorrect password",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request(
          "/api/auth/login",
          { email: "new@example.invalid", password: "test secure password" },
          null,
          { Origin: "https://attacker.example" },
        )
      ).status,
      403,
    );
    const company = (await db.query("select id from companies")).rows[0].id;
    await db.query(
      "insert into team_invites(company_id,legacy_id,legacy_payload) values($1,$2,$3::jsonb)",
      [
        company,
        "invited@example.invalid",
        JSON.stringify({ ownerUid: uid, status: "pending", role: "office" }),
      ],
    );
    await request("/api/auth/signup", {
      email: "invited@example.invalid",
      password: "another secure password",
      name: "Invited User",
      company: "Test Company",
      agreedToTerms: true,
    });
    r = await request("/api/auth/complete", { token: token() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const memberCookie = r.cookie.split(";")[0];
    assert.equal(
      (await db.query("select * from companies")).rows.length,
      1,
      "invited signup never creates another company",
    );
    const access = await request("/api/data/session", null, memberCookie);
    assert.equal(access.body.session.role, "office");
    assert.equal(access.body.session.companyId, company);
    // Simulate an existing migrated account without any Firebase access.
    await db.query(
      "insert into users(firebase_uid,email,legacy_payload) values('legacy-owner','legacy@example.invalid','{}')",
    );
    const u = (
      await db.query("select id from users where firebase_uid='legacy-owner'")
    ).rows[0].id;
    await db.query(
      "insert into company_memberships(company_id,user_id,role,status) values($1,$2,'field','active')",
      [company, u],
    );
    await request("/api/auth/reset", { email: "legacy@example.invalid" });
    const resetToken = token();
    r = await request("/api/auth/complete", {
      token: resetToken,
      password: "new independent password",
    });
    assert.equal(r.status, 200);
    assert.equal(
      r.body.user.uid,
      "legacy-owner",
      "existing identity preserved",
    );
    const legacyCookie = r.cookie.split(";")[0];
    assert.equal(
      (await request("/api/data/session", null, legacyCookie)).body.session
        .companyId,
      company,
    );
    await db.query(
      "update company_memberships set status='revoked' where user_id=$1",
      [u],
    );
    assert.equal(
      (await request("/api/data/session", null, legacyCookie)).status,
      403,
    );
    for(const route of ['/api/estimate','/api/daily-log']){
      const before=providerCalls;
      assert.equal((await request(route,{messages:[{role:'user',content:'ping'}],workCompleted:'Fixture work'},memberCookie)).status,200);
      assert.equal(providerCalls,before+1);
      assert.equal((await request(route,{},null)).status,401);
      assert.equal((await request(route,{},legacyCookie)).status,403);
      assert.equal((await request(route,{},memberCookie,{Origin:'https://attacker.example'})).status,403);
      assert.equal(providerCalls,before+1,'rejected requests never reach paid provider');
    }
    await require('../../lib/documentStore').transact(client=>require('../../lib/documentStore').saveProjectDocument(client,company,{id:'patch-fixture',client:'Fixture project',choices:[{item:'Original'}],notes:'Original notes'}));
    const {patchRecord}=require('../../lib/recordPatch');
    await patchRecord('projects',company,'patch-fixture',{notes:'Office update'},{notes:{exists:true,value:'Original notes'}});
    const merged=await patchRecord('projects',company,'patch-fixture',{choices:[{item:'Field update'}]},{choices:{exists:true,value:[{item:'Original'}]}});
    assert.equal(merged.notes,'Office update','unrelated teammate edits survive');
    await assert.rejects(patchRecord('projects',company,'patch-fixture',{choices:[{item:'Stale edit'}]},{choices:{exists:true,value:[{item:'Original'}]}}),/Another person changed choices/);
    const retained=(await db.query("select legacy_payload from projects where legacy_id='patch-fixture'")).rows[0].legacy_payload;
    assert.equal(retained.choices[0].item,'Field update','stale selection never overwrites newer value');
    await assert.rejects(patchRecord('projects','00000000-0000-0000-0000-000000000000','patch-fixture',{notes:'Other company'}),/Record not found/);
    await request("/api/auth/reset", { email: "new@example.invalid" });
    r = await request("/api/auth/complete", {
      token: token(),
      password: "replacement secure password",
    });
    assert.equal(r.status, 200);
    assert.equal(
      (await request("/api/data/session", null, cookie)).status,
      401,
      "password reset revokes old sessions",
    );
    const refreshed = r.cookie.split(";")[0];
    assert.equal(
      (await request("/api/auth/logout", {}, refreshed)).status,
      200,
    );
    assert.equal(
      (await request("/api/data/session", null, refreshed)).status,
      401,
    );
    assert.equal(
      (
        await request("/api/data/projects", null, null, {
          Authorization: "Bearer old-firebase-token",
        })
      ).status,
      401,
    );
    assert.equal((await db.query("select * from companies")).rows.length, 1);
    console.log(
      "Independent auth database integration passed: verified signup, invited membership, legacy password setup, session revocation, CSRF and one-time tokens.",
    );
  } finally {
    global.fetch=nativeFetch;
    await new Promise((r) => server.close(r));
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
