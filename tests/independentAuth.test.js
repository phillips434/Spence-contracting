const assert = require("assert"),
  fs = require("fs"),
  vm = require("vm");
const {
  passwordHash,
  passwordMatches,
  trustedOrigin,
  userForSession,
} = require("../lib/authApi");
describe("independent authentication security", function () {
  it("salts passwords and rejects wrong passwords", async () => {
    const a = await passwordHash("a secure test password"),
      b = await passwordHash("a secure test password");
    assert.notEqual(a, b);
    assert(await passwordMatches("a secure test password", a));
    assert(!(await passwordMatches("wrong password", a)));
    assert(!(await passwordMatches("x", null)));
  });
  it("enforces password limits", async () => {
    await assert.rejects(passwordHash("short"));
    await assert.rejects(passwordHash("a".repeat(257)));
  });
  it("rejects cross-origin changes", () => {
    const old = process.env.CD_APP_ORIGIN;
    process.env.CD_APP_ORIGIN = "https://app.example";
    try {
      let status,
        next = false;
      const res = {
        status: (n) => {
          status = n;
          return res;
        },
        json: () => {},
      };
      trustedOrigin({ get: () => "https://attacker.example" }, res, () => {
        next = true;
      });
      assert.equal(status, 403);
      assert.equal(next, false);
      trustedOrigin({ get: () => "https://app.example" }, res, () => {
        next = true;
      });
      assert.equal(next, true);
    } finally {
      if (old === undefined) delete process.env.CD_APP_ORIGIN;
      else process.env.CD_APP_ORIGIN = old;
    }
  });
  it("ignores bearer tokens and requires the secure session cookie", async () => {
    assert.equal(
      await userForSession({
        headers: { authorization: "Bearer legacy-token" },
      }),
      null,
    );
    assert.equal(
      await userForSession({
        headers: { cookie: "__Host-cd_session=invalid" },
      }),
      null,
    );
  });
  it("has no Firebase runtime scripts or remote authentication endpoints", () => {
    for (const path of [
      "public/index.html",
      "public/auth-client.js",
      "lib/authApi.js",
      "lib/dataApi.js",
    ]) {
      const text = fs.readFileSync(require.resolve("../" + path), "utf8");
      assert(
        !/gstatic\.com\/firebase|firebase\.initializeApp|firebase\.auth\(|identitytoolkit\.googleapis|securetoken\.googleapis|signInAnonymously/.test(
          text,
        ),
        path,
      );
    }
  });
  it("browser sends same-origin credentials without tokens in local storage", async () => {
    let options;
    const listeners = {};
    const c = {
      window: {},
      fetch: async (url, o) => {
        options = o;
        return { ok: true, json: async () => ({ ok: true, user: null }) };
      },
      document: { addEventListener: (name, fn) => (listeners[name] = fn) },
      console,
      Promise,
    };
    vm.runInNewContext(
      fs.readFileSync(require.resolve("../public/auth-client.js"), "utf8"),
      c,
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(c.window.cdAuth.currentUser, null);
  });
});
