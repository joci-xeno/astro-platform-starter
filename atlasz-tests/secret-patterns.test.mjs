import test from "node:test";
import assert from "node:assert/strict";
import { scrub, containsSecret } from "../atlasz-addons/secret-patterns.mjs";

const A = (c, n) => c.repeat(n);
test("credential formats found by independent verification are redacted (built by concatenation: no literal secrets in this file)", () => {
  const bad = ["glpat-" + A("A", 22), "ya29." + A("a", 30), "whsec_" + A("a1", 10), "hf_" + A("a", 34), "pypi-" + A("A", 40), "dckr_pat_" + A("a", 25), "dop_v1_" + A("a", 64), "shpat_" + A("a", 32), "SK" + A("a1", 16),
    "123456789:" + A("A", 35), "AccountKey=" + A("A", 44) + "==", "aws_secret_access_key = abcd1234", "pw=zzzz9999", "pwd: abc", "pass=abc12", "--password hunter2", "curl -u alice:pw https://x", "sshpass -p hunter2 ssh x",
    "Cookie: session=abc123", "sessionid=abcd1234", "-----BEGIN PGP PRIVATE KEY BLOCK-----\nabc", "ｓｋ－" + A("A", 20), 'password: "my secret phrase"', "Authorization: Bearer abc123def456", "Bearer abcdefghijklmnop"];
  for (const b of bad) { const r = scrub(b); assert.notEqual(r, b, b.slice(0, 30)); assert.ok(!/hunter2|zzzz9999|my secret|abc123def456|AAAAAAAA/.test(r), "value gone: " + b.slice(0, 30)); }
  for (const b of bad.slice(0, 11)) assert.equal(containsSecret(b), true, "format credential: " + b.slice(0, 30));
});
test("ordinary prose is not redacted and hidden characters are left alone when nothing is found", () => {
  for (const g of ["We use Bearer authentication and basic infrastructure; Basic requirements apply", "This is bypass and a compass, the pass is open", "Passenger list", "Use a token of appreciation", "The password policy is strict", "sk-learn is a library", "\u{1F468}‍\u{1F469}‍\u{1F467} family"]) assert.equal(scrub(g), g, g);
  assert.equal(containsSecret("password: hunter2222"), false, "NAME=value is redaction-only, never a refusal rule");
});

test("round-3 formats: Authorization schemes, more provider keys and webhooks, assignment operators and CLI forms, Hungarian/German names, URL-encoding and look-alike letters", () => {
  const A2 = (c, n) => c.repeat(n);
  const bad = ["Authorization: Token abcdef0123456789abcdef", "Authorization: ApiKey abcdef0123456789abcdef", "Authorization: Digest abcdef0123456789", "Authorization: Basic dXNlcnBhc3N3b3Jk", "gsk_" + A2("a", 32), "xai-" + A2("a", 32), "secret_" + A2("a", 36), "ntn_" + A2("a", 36), "lin_api_" + A2("a", 36), "dapi" + A2("a1", 20),
    "r8_" + A2("a", 32), "pplx-" + A2("a", 32), "HRKU-" + A2("a", 32), "hvs." + A2("a", 24), "GOCSPX-" + A2("a", 24), "PMAK-" + A2("a1", 20), "key-" + A2("a1", 16), "sq0atp-" + A2("a", 24), "https://discord.com/api/webhooks/123456/" + A2("a", 30), "https://" + A2("a", 32) + "@o1.ingest.sentry.io/12",
    "redis://:hunter2pass@host:6379", "&sig=" + A2("a", 30), "X-Amz-Signature=" + A2("a", 40), 'password => "hunter2x"', 'password := "hunter2x"', "my password is hunter2hunter2", "jelszó: titok1234", "jelszo=titok1234", "passwort=geheim1234", "curl --user bob:pw12345 x", "curl -ubob:pw12345 x", "mysql -pSecret123 db",
    "docker login -u a -p hunter2x", "wget --ftp-password hunter2x", "pаssword=hunter2hunter2", "password%3Dhunter2hunter2"];
  for (const b of bad) { const r = scrub(b); assert.notEqual(r, b, b.slice(0, 40)); assert.ok(!/hunter2|titok1234|geheim1234|dXNlcnBhc3N3b3Jk|abcdef0123456789|Secret123|pw12345|aaaaaaaaaaaaaaaa/.test(r), "value gone: " + b.slice(0, 40) + " => " + r); }
  for (const g of ["Use the --token flag to pass credentials", "cookie: chocolate chip recipe needs butter", "git commit -u origin:main", "sk-learn-contrib-packages-are-great", "the secret garden is a book", "token of appreciation"]) assert.equal(scrub(g), g, g);
});
