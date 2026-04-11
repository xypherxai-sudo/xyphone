// Run once to generate VAPID keys:
//   node generate-vapid-keys.js
// Then copy the output into server.js

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\n✅ VAPID Keys generiert!\n');
console.log('Füge diese in server.js ein:\n');
console.log(`const VAPID_PUBLIC_KEY  = '${keys.publicKey}';`);
console.log(`const VAPID_PRIVATE_KEY = '${keys.privateKey}';\n`);
console.log('Und diese in dashboard.html:\n');
console.log(`const VAPID_PUBLIC_KEY = '${keys.publicKey}';\n`);
