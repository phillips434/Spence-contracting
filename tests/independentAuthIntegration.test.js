const { execFileSync } = require("node:child_process");
describe("independent authentication database integration", function () {
  this.timeout(30000);
  it("preserves company identities while enforcing account verification and sessions", () => {
    execFileSync(
      process.execPath,
      [require.resolve("./fixtures/independent-auth-integration.js")],
      { timeout: 25000, stdio: "pipe" },
    );
  });
});
