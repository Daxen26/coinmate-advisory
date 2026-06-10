// Uploads your OKX keys from ../okx-keys.json to Cloudflare as ENCRYPTED Worker secrets.
// You run this (via "Set Cloud Keys.bat"); the keys are read from your local file and piped
// straight into Cloudflare — they never print to screen and never touch the repo or the page.
const fs = require('fs');
const { execSync } = require('child_process');
let k;
try { k = JSON.parse(fs.readFileSync(__dirname + '/../okx-keys.json', 'utf8')); }
catch (e) { console.error('Could not read okx-keys.json next to the app. Make sure it exists.'); process.exit(1); }
const items = [['OKX_API_KEY', k.apiKey], ['OKX_SECRET_KEY', k.secretKey], ['OKX_PASSPHRASE', k.passphrase]];
for (const [name, val] of items) {
  if (!val || /your-okx/.test(String(val))) { console.error('Missing value for ' + name + ' in okx-keys.json'); process.exit(1); }
  process.stdout.write('Setting ' + name + ' ... ');
  execSync('npx --yes wrangler secret put ' + name, { input: String(val), stdio: ['pipe', 'inherit', 'inherit'] });
}
console.log('\nAll three OKX secrets are set in Cloudflare.');
