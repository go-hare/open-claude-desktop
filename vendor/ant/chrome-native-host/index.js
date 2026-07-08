const { appendFile, chmod, mkdir, readdir, rmdir, stat, unlink } = require('node:fs/promises');
const { createServer } = require('node:net');
const { homedir, platform, tmpdir, userInfo } = require('node:os');
const { join } = require('node:path');

const VERSION = '1.0.0';
const MAX_MESSAGE_SIZE = 1024 * 1024;
const LOG_FILE = process.env.USER_TYPE === 'ant' ? join(homedir(), '.claude', 'debug', 'chrome-native-host.txt') : undefined;

function stringify(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function log(message, ...args) {
  if (LOG_FILE) {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + JSON.stringify(args) : '';
    appendFile(LOG_FILE, '[' + timestamp + '] [Claude Chrome Native Host] ' + message + formattedArgs + '\n').catch(() => {});
  }
  if (process.env.CLAUDE_CHROME_NATIVE_HOST_DEBUG) console.error('[Claude Chrome Native Host] ' + message, ...args);
}

function getUsername() {
  try { return userInfo().username || 'default'; }
  catch { return process.env.USER || process.env.USERNAME || 'default'; }
}

function getSocketName() {
  return 'claude-mcp-browser-bridge-' + getUsername();
}

function getSocketDir() {
  return '/tmp/claude-mcp-browser-bridge-' + getUsername();
}

function getSecureSocketPath() {
  if (platform() === 'win32') return '\\\\.\\pipe\\' + getSocketName();
  return join(getSocketDir(), process.pid + '.sock');
}

function getAllSocketPaths() {
  if (platform() === 'win32') return [getSecureSocketPath()];
  const paths = [];
  try {
    for (const file of require('node:fs').readdirSync(getSocketDir())) {
      if (file.endsWith('.sock')) paths.push(join(getSocketDir(), file));
    }
  } catch {}
  const legacyName = 'claude-mcp-browser-bridge-' + getUsername();
  const legacyTmpdir = join(tmpdir(), legacyName);
  const legacyTmp = '/tmp/' + legacyName;
  if (!paths.includes(legacyTmpdir)) paths.push(legacyTmpdir);
  if (legacyTmpdir !== legacyTmp && !paths.includes(legacyTmp)) paths.push(legacyTmp);
  return paths;
}

function createChromeMessageFrame(message) {
  const bytes = Buffer.from(stringify(message), 'utf8');
  if (bytes.length > MAX_MESSAGE_SIZE) throw new Error('Chrome native message too large: ' + bytes.length);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

function sendChromeMessage(message) {
  process.stdout.write(createChromeMessageFrame(message));
}

class ChromeNativeHost {
  constructor() {
    this.mcpClients = new Map();
    this.nextClientId = 1;
    this.server = null;
    this.running = false;
    this.socketPath = null;
  }

  async start() {
    if (this.running) return;
    this.socketPath = getSecureSocketPath();
    if (platform() !== 'win32') {
      const socketDir = getSocketDir();
      try {
        const dirStats = await stat(socketDir);
        if (!dirStats.isDirectory()) await unlink(socketDir);
      } catch {}
      await mkdir(socketDir, { recursive: true, mode: 0o700 });
      await chmod(socketDir, 0o700).catch(() => {});
      try {
        for (const file of await readdir(socketDir)) {
          if (!file.endsWith('.sock')) continue;
          const pid = Number.parseInt(file.replace('.sock', ''), 10);
          if (Number.isNaN(pid)) continue;
          try { process.kill(pid, 0); }
          catch { await unlink(join(socketDir, file)).catch(() => {}); }
        }
      } catch {}
    }
    this.server = createServer(socket => this.handleMcpClient(socket));
    await new Promise((resolve, reject) => {
      this.server.listen(this.socketPath, () => { this.running = true; resolve(); });
      this.server.on('error', reject);
    });
    if (platform() !== 'win32') await chmod(this.socketPath, 0o600).catch(() => {});
  }

  async stop() {
    if (!this.running) return;
    for (const client of this.mcpClients.values()) client.socket.destroy();
    this.mcpClients.clear();
    if (this.server) await new Promise(resolve => this.server.close(resolve));
    this.server = null;
    if (platform() !== 'win32' && this.socketPath) {
      await unlink(this.socketPath).catch(() => {});
      try {
        const remaining = await readdir(getSocketDir());
        if (remaining.length === 0) await rmdir(getSocketDir());
      } catch {}
    }
    this.running = false;
  }

  async isRunning() { return this.running; }
  async getClientCount() { return this.mcpClients.size; }

  async handleMessage(messageJson) {
    let message;
    try { message = JSON.parse(messageJson); }
    catch {
      sendChromeMessage({ type: 'error', error: 'Invalid message format' });
      return;
    }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      sendChromeMessage({ type: 'error', error: 'Invalid message format' });
      return;
    }
    switch (message.type) {
      case 'ping':
        sendChromeMessage({ type: 'pong', timestamp: Date.now() });
        break;
      case 'get_status':
        sendChromeMessage({ type: 'status_response', native_host_version: VERSION });
        break;
      case 'tool_response':
      case 'notification': {
        const { type, ...data } = message;
        const frame = createChromeMessageFrame(data);
        for (const client of this.mcpClients.values()) client.socket.write(frame);
        break;
      }
      default:
        sendChromeMessage({ type: 'error', error: 'Unknown message type: ' + message.type });
    }
  }

  handleMcpClient(socket) {
    const clientId = this.nextClientId++;
    const client = { id: clientId, socket, buffer: Buffer.alloc(0) };
    this.mcpClients.set(clientId, client);
    sendChromeMessage({ type: 'mcp_connected' });
    socket.on('data', data => {
      client.buffer = Buffer.concat([client.buffer, data]);
      while (client.buffer.length >= 4) {
        const length = client.buffer.readUInt32LE(0);
        if (length === 0 || length > MAX_MESSAGE_SIZE) { socket.destroy(); return; }
        if (client.buffer.length < 4 + length) break;
        const messageBytes = client.buffer.subarray(4, 4 + length);
        client.buffer = client.buffer.subarray(4 + length);
        try {
          const request = JSON.parse(messageBytes.toString('utf8'));
          sendChromeMessage({ type: 'tool_request', method: request.method, params: request.params });
        } catch (error) { log('Failed to parse tool request', error); }
      }
    });
    socket.on('close', () => {
      this.mcpClients.delete(clientId);
      sendChromeMessage({ type: 'mcp_disconnected' });
    });
  }
}

class ChromeMessageReader {
  constructor(input = process.stdin) {
    this.input = input;
    this.buffer = Buffer.alloc(0);
    this.pendingResolve = null;
    this.closed = false;
    input.on('data', chunk => { this.buffer = Buffer.concat([this.buffer, chunk]); this.tryProcessMessage(); });
    input.on('end', () => this.closePending());
    input.on('error', () => this.closePending());
  }
  closePending() { this.closed = true; if (this.pendingResolve) { this.pendingResolve(null); this.pendingResolve = null; } }
  tryProcessMessage() {
    if (!this.pendingResolve || this.buffer.length < 4) return;
    const length = this.buffer.readUInt32LE(0);
    if (length === 0 || length > MAX_MESSAGE_SIZE) { this.closePending(); return; }
    if (this.buffer.length < 4 + length) return;
    const bytes = this.buffer.subarray(4, 4 + length);
    this.buffer = this.buffer.subarray(4 + length);
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve(bytes.toString('utf8'));
  }
  async read() {
    if (this.closed) return null;
    if (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > 0 && length <= MAX_MESSAGE_SIZE && this.buffer.length >= 4 + length) {
        const bytes = this.buffer.subarray(4, 4 + length);
        this.buffer = this.buffer.subarray(4 + length);
        return bytes.toString('utf8');
      }
    }
    return new Promise(resolve => { this.pendingResolve = resolve; this.tryProcessMessage(); });
  }
}

async function runChromeNativeHost() {
  const host = new ChromeNativeHost();
  const reader = new ChromeMessageReader();
  await host.start();
  try {
    while (true) {
      const message = await reader.read();
      if (message === null) break;
      await host.handleMessage(message);
    }
  } finally {
    await host.stop();
  }
}

module.exports = {
  VERSION,
  MAX_MESSAGE_SIZE,
  ChromeNativeHost,
  ChromeMessageReader,
  createChromeMessageFrame,
  sendChromeMessage,
  runChromeNativeHost,
  getSocketDir,
  getSecureSocketPath,
  getAllSocketPaths,
};
