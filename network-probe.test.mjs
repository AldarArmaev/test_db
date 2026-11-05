import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { bounded, record, socketCheck } from './network-probe.mjs';
test('deadline bounds an operation that never settles', async () => {
  await assert.rejects(bounded(() => new Promise(() => {}), 10), { code: 'TIMEOUT' });
});
test('logs distinguish successful HTTP responses from transport errors and hide private exceptions', async () => {
  const logs = []; const log = value => logs.push(value);
  await record({ stage: 'https' }, async () => ({ status: 302 }), log);
  await record({ stage: 'tcp_443' }, async () => { throw Object.assign(new Error('PRIVATE_TOKEN'), { code: 'ECONNREFUSED' }); }, log);
  await record({ stage: 'tls' }, async () => { throw Object.assign(new Error('PRIVATE_TOKEN'), { code: 'PRIVATE_TOKEN:http://secret' }); }, log);
  assert.equal(logs[0].ok, true); assert.equal(logs[0].status, 302);
  assert.equal(logs[1].code, 'ECONNREFUSED'); assert.equal(logs[2].code, 'NETWORK_ERROR');
  assert.ok(!JSON.stringify(logs).includes('PRIVATE_TOKEN'));
});
test('sockets are closed on success, network error and timeout', async () => {
  for (const event of ['connect', 'error', 'timeout']) {
    const socket = new EventEmitter(); let destroyed = false; socket.destroy = () => { destroyed = true; };
    const factory = () => { if (event !== 'timeout') queueMicrotask(() => socket.emit(event, event === 'error' ? Object.assign(new Error(), { code: 'ENETUNREACH' }) : undefined)); return socket; };
    const pending = socketCheck(factory, 'connect', {}, 10, () => { assert.equal(destroyed, false); return { connected: true }; });
    if (event === 'connect') assert.deepEqual(await pending, { connected: true });
    else await assert.rejects(pending, { code: event === 'error' ? 'ENETUNREACH' : 'TIMEOUT' });
    assert.equal(destroyed, true);
  }
});
