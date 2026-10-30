import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { inspectControl, captureDiagnostic, validateDiagnostic } from "./playground/diagnostics.js";
import { createPlaygroundServer } from "./playground/server.mjs";

function control(type = "text", tagName = "INPUT") {
  const doc = { hasFocus: () => true };
  const owner = { tagName, type, disabled: false, readOnly: false, isConnected: true,
    selectionStart: 0, selectionEnd: 4, selectionDirection: "forward", ownerDocument: doc,
    getAttribute: () => null, closest: () => null, matches: () => false };
  doc.activeElement = owner;
  for (const name of ["value", "textContent", "innerText"]) Object.defineProperty(owner, name, {
    get() { throw new Error("Diagnostic must not read content: " + name); },
  });
  return owner;
}
function denySelection(owner) {
  for (const name of ["selectionStart", "selectionEnd", "selectionDirection"]) Object.defineProperty(owner, name, {
    get() { throw new Error("Excluded field selection must not be read"); }, configurable: true,
  });
  return owner;
}

test("native diagnostics read selection metadata but never contents", () => {
  for (const type of ["text", "search"]) {
    const result = inspectControl(control(type));
    assert.equal(result.status, "diagnostic-only"); assert.equal(result.productionRecognized, false);
    assert.deepEqual(result.selection, { start: 0, end: 4, direction: "forward" });
  }
  const result = inspectControl(control("textarea", "TEXTAREA"));
  assert.equal(result.productionRecognized, true); assert.equal(result.status, "diagnostic-only");
});

test("password and autocomplete-sensitive fields are excluded before selection access", () => {
  const password = denySelection(control("password"));
  assert.equal(inspectControl(password).status, "excluded");
  for (const autocomplete of ["one-time-code", "new-password", "current-password", "cc-number", "section-pay cc-csc"]) {
    const owner = denySelection(control()); owner.getAttribute = () => autocomplete;
    assert.equal(inspectControl(owner).status, "excluded");
    assert.equal(captureDiagnostic(owner, 0), null);
  }
  const sensitive = denySelection(control()); sensitive.closest = selector => selector === "[data-sensitive]" ? {} : null;
  assert.equal(inspectControl(sensitive).status, "excluded");
});

test("unsupported and conservatively excluded types do not access selection", () => {
  for (const type of ["url", "tel", "email", "number", "date", "file", "hidden", "button"]) {
    const result = inspectControl(denySelection(control(type)));
    assert.equal(result.status, ["url", "tel"].includes(type) ? "excluded" : "unsupported");
    assert.equal(result.selection, undefined);
  }
  assert.equal(inspectControl({ tagName: "DIV", isContentEditable: true }).status, "unsupported");
  assert.equal(inspectControl(null).status, "unsupported");
});

test("readonly, disabled, fieldset-disabled, hidden and inert targets are excluded", () => {
  for (const property of ["readOnly", "disabled"]) {
    const owner = denySelection(control()); owner[property] = true;
    assert.equal(inspectControl(owner).status, "excluded");
  }
  const fieldset = denySelection(control()); fieldset.matches = () => true;
  assert.equal(inspectControl(fieldset).status, "excluded");
  const hidden = denySelection(control()); hidden.closest = selector => selector.includes("[hidden]") ? {} : null;
  assert.equal(inspectControl(hidden).status, "excluded");
});

test("unavailable or throwing selection APIs are reported without a fallback text read", () => {
  const owner = control(); owner.selectionStart = null;
  assert.equal(inspectControl(owner).status, "unsupported");
  const throwing = denySelection(control()); assert.equal(inspectControl(throwing).status, "unsupported");
});

test("diagnostic snapshots are immutable and validate revision, focus, caret, eligibility and composition", () => {
  const owner = control(); const snapshot = captureDiagnostic(owner, 3);
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.selection));
  assert.equal(validateDiagnostic(snapshot, 3), true);
  assert.equal(validateDiagnostic(snapshot, 4), false);
  assert.equal(validateDiagnostic(snapshot, 3, true), false);
  assert.equal(captureDiagnostic(owner, 3, true), null);
  owner.selectionStart = 1; assert.equal(validateDiagnostic(snapshot, 3), false); owner.selectionStart = 0;
  owner.selectionDirection = "backward"; assert.equal(validateDiagnostic(snapshot, 3), false); owner.selectionDirection = "forward";
  owner.ownerDocument.activeElement = {}; assert.equal(validateDiagnostic(snapshot, 3), false);
  owner.ownerDocument.activeElement = owner; owner.ownerDocument.hasFocus = () => false;
  assert.equal(validateDiagnostic(snapshot, 3), false); owner.ownerDocument.hasFocus = () => true;
  owner.isConnected = false; assert.equal(validateDiagnostic(snapshot, 3), false); owner.isConnected = true;
  owner.type = "password"; assert.equal(validateDiagnostic(snapshot, 3), false);
  assert.equal(validateDiagnostic(null, 3), false);
});

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: pathname, agent: false, ...options }, res => {
      let body = ""; res.setEncoding("utf8"); res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject); req.end();
  });
}

test("local server serves the playground and its exact module graph", async t => {
  const server = createPlaygroundServer(); t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port;
  for (const [route, mime] of [["/", "text/html"], ["/playground.css", "text/css"],
    ["/playground.js", "text/javascript"], ["/diagnostics.js", "text/javascript"],
    ["/src/content/editors/nativeControl.js", "text/javascript"], ["/src/shared/suggestionRequest.js", "text/javascript"]]) {
    const response = await request(port, route);
    assert.equal(response.status, 200, route); assert.ok(response.body.length > 0);
    assert.ok(response.headers["content-type"].startsWith(mime));
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.headers["content-security-policy"], /connect-src 'none'/);
  }
  assert.equal((await request(port, "/", { method: "HEAD" })).body, "");
});

test("local server rejects non-loopback Host, writes, traversal and non-fixture files", async t => {
  const server = createPlaygroundServer(); t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const port = server.address().port;
  for (const route of ["/README.md", "/server.mjs", "/backend/.env", "/../../backend/.env", "/%2e%2e%2fbackend/.env",
    "/src/content/selectionManager.js", "/node_modules/esbuild/package.json"]) {
    assert.equal((await request(port, route)).status, 404, route);
  }
  assert.equal((await request(port, "/", { headers: { Host: "attacker.test" } })).status, 403);
  assert.equal((await request(port, "/", { method: "POST" })).status, 405);
  assert.equal((await request(port, "/%ZZ")).status, 400);
});

test("fixture markup has unique IDs, paired labels, module controls and no external assets", async () => {
  const html = await readFile(new URL("./playground/index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const label of [...html.matchAll(/aria-labelledby="([^"]+)"/g)]) assert.ok(ids.includes(label[1]));
  for (const expected of ["textarea-a", "textarea-b", "input-text", "input-search", "input-password", "input-otp",
    "editable-plain", "editable-nested", "editable-inner", "dynamic-editors", "textarea-scroll", "capture"]) assert.ok(ids.includes(expected));
  assert.ok(html.includes('type="module" src="/playground.js"'));
  assert.equal(/(?:src|href)="https?:/.test(html), false);
});
