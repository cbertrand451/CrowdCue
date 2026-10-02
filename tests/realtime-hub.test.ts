import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import type { WebSocket } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { RealtimeHub } from '../src/server/realtime/hub.js';
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  send = vi.fn((_data: string, callback: (error?: Error) => void) =>
    callback(),
  );
  ping = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.emit('close');
  });
  terminate = vi.fn(() => this.emit('close'));
}
const party = '11111111-1111-4111-8111-111111111111';
const connection = () => {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async () => ({})),
    release: vi.fn(),
  });
  return client;
};
afterEach(() => {
  vi.useRealTimers();
});
it('reauthorizes live sockets and terminates clients that miss heartbeats', async () => {
  vi.useFakeTimers();
  const client = connection();
  const pool = {
    connect: vi.fn(async () => client as unknown as PoolClient),
  } as unknown as Pool;
  const hub = new RealtimeHub(pool);
  await hub.start();
  const revoked = new Socket();
  const idle = new Socket();
  const authorize = vi.fn(async () => {
    throw Error('Session expired');
  });
  hub.add(revoked as unknown as WebSocket, party, 'ip1', authorize);
  hub.add(idle as unknown as WebSocket, party, 'ip2', async () => party);
  await vi.advanceTimersByTimeAsync(30000);
  expect(authorize).toHaveBeenCalledOnce();
  expect(revoked.close).toHaveBeenCalledWith(1008, 'Access expired');
  expect(idle.ping).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30000);
  expect(idle.terminate).toHaveBeenCalledOnce();
  await hub.stop();
  expect(client.release).toHaveBeenCalledWith(true);
});
it('reconnects a failed database listener and resynchronizes connected rooms', async () => {
  vi.useFakeTimers();
  const first = connection();
  const second = connection();
  const connect = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  const hub = new RealtimeHub({ connect } as unknown as Pool);
  await hub.start();
  const socket = new Socket();
  hub.add(socket as unknown as WebSocket, party, 'ip', async () => party);
  first.emit('error', Error('Connection lost'));
  expect(first.release).toHaveBeenCalledWith(true);
  await vi.advanceTimersByTimeAsync(2100);
  expect(second.query).toHaveBeenCalledWith('LISTEN crowdcue_party_changes');
  expect(socket.send).toHaveBeenLastCalledWith(
    '{"type":"changed"}',
    expect.any(Function),
  );
  second.emit('notification', {
    channel: 'crowdcue_party_changes',
    payload: 'malformed',
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(socket.send).toHaveBeenCalledTimes(2);
  await hub.stop();
  expect(second.release).toHaveBeenCalledWith(true);
});
it('closes slow sockets rather than retaining an unbounded message backlog', async () => {
  vi.useFakeTimers();
  const client = connection();
  const hub = new RealtimeHub({
    connect: async () => client,
  } as unknown as Pool);
  await hub.start();
  const socket = new Socket();
  socket.bufferedAmount = 65537;
  hub.add(socket as unknown as WebSocket, party, 'ip', async () => party);
  expect(socket.close).toHaveBeenCalledWith(1013, 'Connection is too slow');
  await hub.stop();
});
