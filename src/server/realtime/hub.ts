import type { Pool, PoolClient } from 'pg';
import type { WebSocket } from 'ws';

const channel = 'crowdcue_party_changes';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
interface Connection {
  socket: WebSocket;
  party: string;
  ip: string;
  authorize: () => Promise<string>;
  alive: boolean;
  checking: boolean;
}
/** Sockets receive invalidations only, never personalized snapshots or private identifiers. */
export class RealtimeHub {
  private connections = new Set<Connection>();
  private listener?: PoolClient;
  private stopped = false;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private batch?: ReturnType<typeof setTimeout>;
  private pending = new Set<string>();
  private connecting?: Promise<void>;
  constructor(
    private readonly pool: Pool,
    private readonly onError: () => void = () => {},
  ) {}
  async start() {
    this.stopped = false;
    this.heartbeat = setInterval(() => this.checkConnections(), 30000);
    this.heartbeat.unref();
    await this.connect();
  }
  private async connect() {
    this.connecting = (async () => {
      let client: PoolClient | undefined;
      try {
        client = await this.pool.connect();
        if (this.stopped) {
          client.release();
          return;
        }
        this.listener = client;
        client.on('error', this.disconnected);
        client.on('end', this.disconnected);
        client.on('notification', (message) => {
          if (
            message.channel === channel &&
            message.payload &&
            uuid.test(message.payload)
          )
            this.changed(message.payload);
        });
        await client.query(`LISTEN ${channel}`);
        // A listener reconnect may have missed notifications: refresh every connected room.
        for (const connection of this.connections)
          this.changed(connection.party);
      } catch {
        this.onError();
        if (client && this.listener === client) this.disconnected();
        else this.scheduleRetry();
      }
    })();
    await this.connecting;
  }
  private scheduleRetry() {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.connect();
    }, 2000);
    this.retry.unref();
  }
  private disconnected = () => {
    const client = this.listener;
    if (!client) return;
    this.listener = undefined;
    client.removeListener('error', this.disconnected);
    client.removeListener('end', this.disconnected);
    client.release(true);
    this.scheduleRetry();
  };
  add(
    socket: WebSocket,
    party: string,
    ip: string,
    authorize: () => Promise<string>,
  ) {
    if (
      this.stopped ||
      this.connections.size >= 1000 ||
      [...this.connections].filter((c) => c.ip === ip).length >= 300 ||
      [...this.connections].filter((c) => c.party === party).length >= 300
    ) {
      socket.close(1013, 'Try again later');
      return;
    }
    const connection: Connection = {
      socket,
      party,
      ip,
      authorize,
      alive: true,
      checking: false,
    };
    this.connections.add(connection);
    socket.on('close', () => this.connections.delete(connection));
    socket.on('error', () => {
      this.connections.delete(connection);
      socket.terminate();
    });
    socket.on('pong', () => {
      connection.alive = true;
    });
    // This is a read-only stream. Clients cannot choose rooms or issue commands.
    socket.on('message', () => socket.close(1008, 'Read-only connection'));
    this.send(connection, 'ready');
  }
  private send(connection: Connection, type: 'ready' | 'changed') {
    const socket = connection.socket;
    if (socket.readyState !== 1) return;
    if (socket.bufferedAmount > 65536) {
      socket.close(1013, 'Connection is too slow');
      return;
    }
    socket.send(JSON.stringify({ type }), (error) => {
      if (error) socket.terminate();
    });
  }
  changed(party: string) {
    if (this.stopped) return;
    this.pending.add(party);
    if (this.batch) return;
    this.batch = setTimeout(() => {
      this.batch = undefined;
      const pending = this.pending;
      this.pending = new Set();
      for (const connection of this.connections)
        if (pending.has(connection.party)) this.send(connection, 'changed');
    }, 100);
    this.batch.unref();
  }
  private checkConnections() {
    for (const connection of this.connections) {
      if (!connection.alive) {
        connection.socket.terminate();
        continue;
      }
      if (connection.checking) continue;
      connection.alive = false;
      connection.socket.ping();
      connection.checking = true;
      void connection
        .authorize()
        .then((party) => {
          if (party !== connection.party)
            connection.socket.close(1008, 'Access expired');
        })
        .catch(() => connection.socket.close(1008, 'Access expired'))
        .finally(() => {
          connection.checking = false;
        });
    }
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.batch);
    clearInterval(this.heartbeat);
    for (const connection of this.connections) connection.socket.terminate();
    this.connections.clear();
    await this.connecting;
    const client = this.listener;
    this.listener = undefined;
    if (client) {
      client.removeListener('error', this.disconnected);
      client.removeListener('end', this.disconnected);
      client.release(true);
    }
  }
}
