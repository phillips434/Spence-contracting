const {
  randomBytes,
  randomUUID,
  createHash,
  scrypt: rawScrypt,
  timingSafeEqual,
} = require("node:crypto");
const { promisify } = require("node:util");
const { getPool } = require("../db/postgres");
const { transact } = require("./documentStore");
const { saveSelf, ownInvitation } = require("./identityApi");
const scrypt = promisify(rawScrypt);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const DAY = 86400000;
async function passwordHash(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    throw new Error("Use a password between 12 and 256 characters.");
  const salt = randomBytes(16).toString("hex");
  return (
    "scrypt$" + salt + "$" + (await scrypt(password, salt, 64)).toString("hex")
  );
}
async function passwordMatches(password, stored) {
  if (typeof password !== "string" || password.length > 256) return false;
  const [scheme, salt, key] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const candidate = await scrypt(password, salt, 64),
    expected = Buffer.from(key, "hex");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}
function appOrigin() {
  const value = process.env.CD_APP_ORIGIN;
  if (!value || !/^https:\/\//.test(value))
    throw new Error("Authentication origin is not configured");
  return new URL(value).origin;
}
function mailConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD &&
    process.env.AUTH_EMAIL_FROM &&
    process.env.CD_APP_ORIGIN
  );
}
async function sendAccountEmail(email, token, purpose) {
  if (!mailConfigured())
    throw new Error("Account email delivery is not configured");
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = require("nodemailer").createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  const link = appOrigin() + "/?accountToken=" + encodeURIComponent(token);
  await transport.sendMail({
    from: process.env.AUTH_EMAIL_FROM,
    to: email,
    subject:
      purpose === "signup"
        ? "Verify your Contractor Desk account"
        : "Set your Contractor Desk password",
    text:
      "Open this link to " +
      (purpose === "signup" ? "verify your account" : "set your password") +
      ":\n" +
      link +
      "\n\nThis link expires in one hour. If you did not request it, ignore this email.",
  });
}
function sessionToken(req) {
  const cookies = String(req.headers.cookie || "").split(";");
  const entry = cookies.find((x) => x.trim().startsWith("__Host-cd_session="));
  return entry ? entry.trim().slice("__Host-cd_session=".length) : "";
}
function setCookie(res, token, maxAge = 14 * DAY) {
  res.cookie("__Host-cd_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}
async function userForSession(req) {
  const token = sessionToken(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const r = await getPool().query(
    "select a.uid,a.email,a.created_at from auth_sessions s join auth_accounts a on a.uid=s.uid where s.token_hash=$1 and s.expires_at>now()",
    [hash(token)],
  );
  const u = r.rows[0];
  return u
    ? {
        uid: u.uid,
        email: u.email,
        createdAt: new Date(u.created_at).getTime(),
      }
    : null;
}
async function requireAppUser(req, res, next) {
  try {
    const user = await userForSession(req);
    if (!user)
      return res
        .status(401)
        .json({ ok: false, error: "Authentication required" });
    req.cdUser = user;
    next();
  } catch (e) {
    res.status(503).json({ ok: false, error: "Session unavailable" });
  }
}
async function createSession(res, uid) {
  const token = randomBytes(32).toString("hex");
  await getPool().query(
    "insert into auth_sessions(token_hash,uid,expires_at) values($1,$2,$3)",
    [hash(token), uid, new Date(Date.now() + 14 * DAY)],
  );
  setCookie(res, token);
}
async function rateLimit(req, res, next) {
  try {
    const key = hash("auth:" + req.ip);
    const r = await getPool().query(
      `insert into auth_rate_limits(key,attempts) values($1,1) on conflict(key) do update set attempts=case when auth_rate_limits.window_start<now()-interval '15 minutes' then 1 else auth_rate_limits.attempts+1 end,window_start=case when auth_rate_limits.window_start<now()-interval '15 minutes' then now() else auth_rate_limits.window_start end returning attempts`,
      [key],
    );
    if (r.rows[0].attempts > 30)
      return res
        .status(429)
        .json({
          ok: false,
          error: "Too many attempts. Try again in 15 minutes.",
        });
    next();
  } catch (e) {
    res.status(503).json({ ok: false, error: "Authentication unavailable" });
  }
}
function trustedOrigin(req, res, next) {
  try {
    if (req.get("origin") !== appOrigin())
      return res
        .status(403)
        .json({ ok: false, error: "Untrusted request origin" });
    next();
  } catch (e) {
    res
      .status(503)
      .json({ ok: false, error: "Authentication is not configured" });
  }
}
async function issueEmailToken(email, purpose, payload = {}) {
  const token = randomBytes(32).toString("hex");
  await getPool().query(
    "insert into auth_email_tokens(token_hash,email,purpose,payload,expires_at) values($1,$2,$3,$4::jsonb,$5)",
    [
      hash(token),
      email,
      purpose,
      JSON.stringify(payload),
      new Date(Date.now() + 3600000),
    ],
  );
  try {
    await sendAccountEmail(email, token, purpose);
  } catch (e) {
    await getPool().query("delete from auth_email_tokens where token_hash=$1", [
      hash(token),
    ]);
    throw e;
  }
}
function installAuthRoutes(app) {
  app.use("/api/auth", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/auth/session", async (req, res) => {
    try {
      res.json({ ok: true, user: await userForSession(req) });
    } catch (e) {
      res.status(503).json({ ok: false, error: "Session unavailable" });
    }
  });
  app.use("/api/auth", trustedOrigin, rateLimit);
  app.post("/api/auth/login", async (req, res) => {
    try {
      const r = await getPool().query(
        "select uid,email,password_hash,created_at from auth_accounts where lower(email)=$1",
        [normalize(req.body.email)],
      );
      const a = r.rows[0];
      const dummy =
        "scrypt$00000000000000000000000000000000$" + "00".repeat(64);
      const valid = await passwordMatches(
        req.body.password,
        a ? a.password_hash : dummy,
      );
      if (!a || !valid)
        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Unable to sign in. Check your details, or use Set / reset password to activate an existing account.",
          });
      await createSession(res, a.uid);
      res.json({
        ok: true,
        user: {
          uid: a.uid,
          email: a.email,
          createdAt: new Date(a.created_at).getTime(),
        },
      });
    } catch (e) {
      res.status(503).json({ ok: false, error: "Sign-in unavailable" });
    }
  });
  app.post("/api/auth/logout", async (req, res) => {
    try {
      await getPool().query("delete from auth_sessions where token_hash=$1", [
        hash(sessionToken(req)),
      ]);
      setCookie(res, "", 0);
      res.json({ ok: true });
    } catch (e) {
      res.status(503).json({ ok: false, error: "Sign-out unavailable" });
    }
  });
  app.post("/api/auth/signup", async (req, res) => {
    try {
      if (!mailConfigured())
        return res
          .status(503)
          .json({
            ok: false,
            error: "Account email delivery is not configured",
          });
      const email = normalize(req.body.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Enter a valid email.");
      if (
        !req.body.agreedToTerms ||
        !String(req.body.name || "").trim() ||
        !String(req.body.company || "").trim()
      )
        throw new Error("Name, company and agreement are required.");
      const p = await passwordHash(req.body.password);
      const exists = await getPool().query(
        "select 1 from users where lower(email)=$1 union all select 1 from auth_accounts where lower(email)=$1",
        [email],
      );
      if (!exists.rowCount)
        await issueEmailToken(email, "signup", {
          passwordHash: p,
          name: String(req.body.name).slice(0, 150),
          company: String(req.body.company).slice(0, 200),
          agreedAt: Date.now(),
        });
      res.json({
        ok: true,
        message:
          "Check your email to verify your account. Existing users should use Set / reset password.",
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });
  app.post("/api/auth/reset", async (req, res) => {
    try {
      if (!mailConfigured())
        return res
          .status(503)
          .json({
            ok: false,
            error: "Account email delivery is not configured",
          });
      const email = normalize(req.body.email);
      const r = await getPool().query(
        "select firebase_uid as uid from users where lower(email)=$1 union select uid from auth_accounts where lower(email)=$1",
        [email],
      );
      if (r.rows.length === 1)
        await issueEmailToken(email, "reset", { uid: r.rows[0].uid });
      res.json({
        ok: true,
        message:
          "If your account exists, a password setup link has been emailed.",
      });
    } catch (e) {
      res
        .status(503)
        .json({
          ok: false,
          error: "Unable to send account email. Try again later.",
        });
    }
  });
  app.post("/api/auth/complete", async (req, res) => {
    try {
      const token = String(req.body.token || "");
      if (!/^[a-f0-9]{64}$/.test(token))
        throw new Error("Invalid account link");
      const preview = (
        await getPool().query(
          "select purpose from auth_email_tokens where token_hash=$1 and expires_at>now()",
          [hash(token)],
        )
      ).rows[0];
      if (!preview) throw new Error("Account link expired or already used");
      const newHash =
        preview.purpose === "reset"
          ? await passwordHash(req.body.password)
          : null;
      const user = await transact(async (client) => {
        const row = (
          await client.query(
            "select * from auth_email_tokens where token_hash=$1 and expires_at>now() for update",
            [hash(token)],
          )
        ).rows[0];
        if (!row) throw new Error("Account link expired or already used");
        const uid =
          row.purpose === "signup" ? "cd_" + randomUUID() : row.payload.uid;
        if (row.purpose === "signup") {
          const existing = await client.query(
            "select 1 from users where lower(email)=$1 union all select 1 from auth_accounts where lower(email)=$1",
            [row.email],
          );
          if (existing.rowCount)
            throw new Error("Account already exists. Use password reset.");
        }
        await client.query(
          "insert into auth_accounts(uid,email,password_hash) values($1,$2,$3) on conflict(uid) do update set password_hash=excluded.password_hash",
          [
            uid,
            row.email,
            row.purpose === "signup" ? row.payload.passwordHash : newHash,
          ],
        );
        if (row.purpose === "signup") {
          const verifiedUser = { uid, email: row.email, createdAt: Date.now() };
          const reqForIdentity = { cdUser: verifiedUser };
          const invitation = await ownInvitation(reqForIdentity, client);
          await saveSelf(
            reqForIdentity,
            {
              name: row.payload.name,
              company: row.payload.company,
              email: row.email,
              agreedToTerms: true,
              agreedAt: row.payload.agreedAt,
              plan: invitation ? "team" : "trial",
              ...(invitation ? { ownerUid: invitation.legacy_owner_uid } : {}),
            },
            client,
          );
          await require('./signupAlerts').queueSignupAlert(client, {
            uid, email: row.email, name: row.payload.name, company: row.payload.company,
          }, !!invitation);
        }
        await client.query("delete from auth_sessions where uid=$1", [uid]);
        await client.query("delete from auth_email_tokens where email=$1", [
          row.email,
        ]);
        return {
          uid,
          email: row.email,
          createdAt: Date.now(),
          signup: row.purpose === "signup",
          profile: row.payload,
        };
      });

      await createSession(res, user.uid);
      res.json({
        ok: true,
        user: { uid: user.uid, email: user.email, createdAt: user.createdAt },
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });
}
module.exports = {
  installAuthRoutes,
  requireAppUser,
  passwordHash,
  passwordMatches,
  hash,
  normalize,
  userForSession,
  trustedOrigin,
  mailConfigured,
};
