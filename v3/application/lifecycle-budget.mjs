export class PhoneLifecycleBudget {
  #openDevices = new Set();
  open(deviceId) { this.#openDevices.add(deviceId); }
  close(deviceId) { this.#openDevices.delete(deviceId); }
  clear() { this.#openDevices.clear(); }
  inspect() { return Object.freeze({ openDeviceCount: this.#openDevices.size, activeTimers: 0, activePollers: 0, backgroundAppWork: 0 }); }
}
