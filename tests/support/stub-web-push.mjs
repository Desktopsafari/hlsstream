// Stands in for the web-push package during tests: records each notification
// instead of sending it. Set globalThis.__pushFail.set(endpoint, statusCode)
// to make a send to that endpoint fail with that status (410 = gone, 500 ...).
globalThis.__pushes ??= [];
globalThis.__pushFail ??= new Map();

export async function sendNotification(subscription, payload, options) {
  // Yield like a network call, so overlapping runs interleave.
  await new Promise((r) => setImmediate(r));
  const status = globalThis.__pushFail.get(subscription.endpoint);
  if (status) {
    const err = new Error(`Received unexpected response code ${status}`);
    err.statusCode = status;
    throw err;
  }
  globalThis.__pushes.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), options });
  return { statusCode: 201, body: "", headers: {} };
}

export function generateVAPIDKeys() {
  return { publicKey: "test-public-key", privateKey: "test-private-key" };
}

export default { sendNotification, generateVAPIDKeys };
