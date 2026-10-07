const test = require("node:test");
const assert = require("node:assert/strict");
const { computerName, pairingLink, printPairing } = require("./mobile-pairing.cjs");

const token = "ab".repeat(32);

test("pairing link encodes the address and computer name and keeps the token as is", () => {
  const link = pairingLink({ address: "https://host.example", token, name: "Victor's MacBook Pro & Co" });
  assert.equal(link, `milagre://pair?address=https%3A%2F%2Fhost.example&token=${token}&name=Victor's%20MacBook%20Pro%20%26%20Co`);
  const parsed = new URL(link);
  assert.equal(parsed.searchParams.get("address"), "https://host.example");
  assert.equal(parsed.searchParams.get("token"), token);
  assert.equal(parsed.searchParams.get("name"), "Victor's MacBook Pro & Co");
  assert.equal(new URL(pairingLink({ address: "http://127.0.0.1:8787", token, name: "Mac" })).searchParams.get("address"), "http://127.0.0.1:8787");
});

test("pairing link rejects a bad token or address", () => {
  for (const bad of ["", "abc", "g".repeat(64), "a".repeat(63), "a".repeat(65), undefined]) {
    assert.throws(() => pairingLink({ address: "http://127.0.0.1:8787", token: bad, name: "Mac" }), /token/);
  }
  for (const bad of ["ftp://host", "javascript:alert(1)", "milagre-local://pair", "not a url", ""]) {
    assert.throws(() => pairingLink({ address: bad, token, name: "Mac" }), /address/);
  }
});

test("computer name uses ComputerName on macOS and falls back to the hostname without .local", () => {
  assert.equal(computerName({ platform: "darwin", run: () => "Victor MacBook\n", hostname: () => "x.local" }), "Victor MacBook");
  assert.equal(
    computerName({
      platform: "darwin",
      run: () => {
        throw new Error("not set");
      },
      hostname: () => "victor-mac.local",
    }),
    "victor-mac",
  );
  assert.equal(computerName({ platform: "darwin", run: () => "  \n", hostname: () => "box" }), "box");
  assert.equal(
    computerName({
      platform: "linux",
      run: () => {
        throw new Error("unused");
      },
      hostname: () => "box.local",
    }),
    "box",
  );
});

test("printing shows the QR unless disabled, always the link and the warning", () => {
  for (const qr of [true, false]) {
    const lines = [];
    const link = printPairing({
      address: "http://127.0.0.1:8787",
      token,
      name: "Mac",
      qr,
      log: (line) => lines.push(line),
      renderQr: (text, done) => done(`QR(${text})`),
    });
    const out = lines.join("\n");
    assert.ok(out.includes("Scan with the Milagre app to pair:"));
    assert.ok(out.includes(`Pairing link: ${link}`));
    assert.match(out, /do not share/i);
    assert.equal(out.includes(`QR(${link})`), qr);
  }
});

test("a Cloudflare Access token rides in the link only with an HTTPS address", () => {
  const access = { id: `${"c".repeat(32)}.access`, secret: "Secret_with-mixed".padEnd(43, "z") };
  const parsed = new URL(pairingLink({ address: "https://mac.example.cloud", token, name: "Mac", access }));
  assert.equal(parsed.searchParams.get("cfId"), access.id);
  assert.equal(parsed.searchParams.get("cfSecret"), access.secret);
  assert.throws(() => pairingLink({ address: "http://127.0.0.1:8797", token, name: "Mac", access }), /HTTPS/);
  assert.throws(() => pairingLink({ address: "https://mac.example.cloud", token, name: "Mac", access: { id: "nope", secret: access.secret } }), /\.access/);
});
