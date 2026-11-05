import dns from 'node:dns';
import { Resolver } from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const lookup = promisify(dns.lookup);
const timeoutMs = 5000;
export function bounded(operation, ms = timeoutMs) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(), { code: 'TIMEOUT' })), ms); });
  return Promise.race([Promise.resolve().then(operation), deadline]).finally(() => clearTimeout(timer));
}
export async function record(meta, operation, log = value => console.log(JSON.stringify(value))) {
  const start = Date.now();
  try { const result = await bounded(operation); log({ event: 'NETWORK_PROBE', ...meta, ok: true, ms: Date.now() - start, ...result }); return result; }
  catch (error) {
    const candidate = error?.code ?? error?.cause?.code;
    const code = typeof candidate === 'string' && /^[A-Z0-9_]{1,60}$/.test(candidate) ? candidate : 'NETWORK_ERROR';
    log({ event: 'NETWORK_PROBE', ...meta, ok: false, ms: Date.now() - start, code }); return undefined;
  }
}
export function socketCheck(factory, successEvent, options, ms = timeoutMs - 100, inspect = () => ({})) {
  return new Promise((resolve, reject) => {
    const socket = factory(options);
    const timer = setTimeout(() => finish(Object.assign(new Error(), { code: 'TIMEOUT' })), ms);
    let done = false;
    const finish = (error) => { if (done) return; done = true; clearTimeout(timer); let result; if (!error) { try { result = inspect(socket); } catch (caught) { error = caught; } } socket.destroy(); if (error) reject(error); else resolve(result); };
    socket.once(successEvent, () => finish()); socket.once('error', error => finish(error));
  });
}
function request(host, family) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: host, port: 443, path: '/', family, agent: false, rejectUnauthorized: true }, response => {
      clearTimeout(timer); resolve({ status: response.statusCode }); response.destroy(); req.destroy();
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error(), { code: 'TIMEOUT' })), timeoutMs - 100);
    req.once('error', error => { clearTimeout(timer); reject(error); });
  });
}
export async function runNetworkProbe(log = value => console.log(JSON.stringify(value))) {
  log({ event: 'NETWORK_PROBE_START', note: 'No tokens, environment values, response bodies or redirects are used' });
  await Promise.all(['api.telegram.org', 'core.telegram.org', 'example.com'].map(async host => {
    const result = await record({ host, stage: 'system_dns' }, async () => ({ addresses: await lookup(host, { all: true }) }), log);
    const addresses = result?.addresses ?? [];
    await Promise.all([4, 6].map(async family => {
      await record({ host, stage: 'https', family }, () => request(host, family), log);
      const address = addresses.find(item => item.family === family)?.address;
      if (!address) return;
      // Connect to the resolved IP directly, retaining hostname/SNI and certificate validation.
      await record({ host, address, family, stage: 'tcp_443' }, () => socketCheck(net.createConnection, 'connect', { host: address, port: 443, family }), log);
      await record({ host, address, family, stage: 'tls' }, () => socketCheck(tls.connect, 'secureConnect', { host: address, port: 443, family, servername: host, rejectUnauthorized: true }, timeoutMs - 100, socket => ({ protocol: socket.getProtocol(), authorized: socket.authorized })), log);
    }));
  }));
  await Promise.all(['1.1.1.1', '8.8.8.8'].map(async server => {
    const resolver = new Resolver({ timeout: 2000, tries: 1 }); resolver.setServers([server]);
    try { await record({ host: 'api.telegram.org', stage: 'public_dns_ipv4', resolver: server }, async () => ({ addresses: await resolver.resolve4('api.telegram.org') }), log); }
    finally { resolver.cancel(); }
  }));
  log({ event: 'NETWORK_PROBE_DONE' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runNetworkProbe();
