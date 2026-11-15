const MANIFEST = {
  id: 'tapo',
  name: 'TP-Link Tapo',
  description: 'Local control of Tapo plugs and bulbs over the KLAP protocol.',
  category: 'lighting',
  icon: 'lightbulb',
  configSchema: [ /* identical to integration.json */ ],
  domains: ['light', 'switch', 'sensor'],
  supportsDiscovery: false,
  builtin: false,
  auth: { supported: true, mode: 'credentials', label: 'Sign in' },
};

class TapoIntegration {
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.connected = false;
  }

  get manifest() { return MANIFEST; }

  async setup(ctx) {
    this.ctx = ctx;
    this.host = String(ctx.config.host ?? '');
    this.username = String(ctx.config.username ?? '');
    this.password = String(ctx.config.password ?? '');
    await this.connect();
    await this.poll();                                    // first state push
    const seconds = Math.max(5, Number(ctx.config.poll_seconds) || 10);
    this.timer = setInterval(() => void this.poll(), seconds * 1000);
    this.timer.unref?.();
  }

  async teardown() {
    clearInterval(this.timer);
    this.connected = false;
  }

  // --- publish entities + state -------------------------------------------
  async poll() {
    try {
      const info = await this.request('get_device_info');   // { device_on, brightness, model }
      // importDevice is idempotent: it reuses the same entity ids every call.
      const device = this.ctx.registry.importDevice(this.instanceId, MANIFEST.id, {
        id: this.host,                                    // stable → device id "tapo:<host>"
        name: `Tapo ${this.host}`,
        manufacturer: 'TP-Link',
        model: info.model,
        address: this.host,
        entities: [{ domain: 'light', name: `Tapo ${this.host}`, capabilities: ['turn_on', 'turn_off', 'brightness'] }],
      });
      this.ctx.states.set(device.entities[0], info.device_on ? 'on' : 'off', {
        brightness: Math.round(((info.brightness ?? 0) / 100) * 255),
      });
      this.connected = true;
    } catch (error) {
      this.connected = false;
      this.ctx.log.warn(`Tapo poll failed: ${error.message}`);
    }
  }

  // --- optional hooks ------------------------------------------------------
  async discover() { return []; }        // return DiscoveredDevice[] to enable "Scan for devices"

  async authenticate() {                 // used by the Account panel when auth.supported
    try { await this.connect(); return { ok: true, message: `Connected to ${this.host}` }; }
    catch (error) { return { ok: false, message: error.message }; }
  }

  async callService(entityId, domain, service, data) {
    if (service === 'turn_on') await this.request('set_device_info', { device_on: true });
    else if (service === 'turn_off') await this.request('set_device_info', { device_on: false });
    else if (service === 'turn_on' && data.brightness) { /* … */ }
    else throw new Error(`${entityId} does not support "${service}"`);
    await this.poll();
  }

  isConnected() { return this.connected; }
  statusMessage() { return this.connected ? undefined : 'Not connected to the device'; }

  // --- the device itself (reimplement in JS) -------------------------------
  async connect() { /* KLAP v2 handshake, keep the session cookie */ }
  async request(method, params) { /* POST /app/request?seq=n, encrypted body */ }
}

export default {
  manifest: MANIFEST,
  create: (instanceId) => new TapoIntegration(instanceId),
};
