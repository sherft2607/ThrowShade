// Loads app/data.js in a sandboxed `window` and dumps the seed arrays as JSON,
// so the Python seed script never has to hand-parse the JS.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dataJsPath = path.join(__dirname, "..", "..", "app", "data.js");
const source = fs.readFileSync(dataJsPath, "utf8");

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const out = {
  buildings: sandbox.window.TS_BUILDINGS || [],
  users: sandbox.window.TS_SEED_USERS || [],
  visits: sandbox.window.TS_SEED_VISITS || [],
  likes: sandbox.window.TS_SEED_LIKES || {},
  lists: sandbox.window.TS_SEED_LISTS || [],
  want: sandbox.window.TS_SEED_WANT || [],
};

const outPath = path.join(__dirname, "..", "seed_data.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Wrote ${outPath}`);
