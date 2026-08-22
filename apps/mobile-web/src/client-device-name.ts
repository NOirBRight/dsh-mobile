export interface NativeDeviceIdentityBridge {
  getName(): Promise<{ name: string }>
}

function sanitize(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64)
}

/** Resolve the Host-facing Client Device Name without coupling it to a Host Profile or endpoint. */
export async function resolveClientDeviceName(bridge: NativeDeviceIdentityBridge | null): Promise<string> {
  if (bridge !== null) {
    try {
      const name = sanitize((await bridge.getName()).name)
      if (name !== '') return name
    } catch {
      // A product label is safer than accidentally substituting Host or endpoint metadata.
    }
  }
  return 'Android device'
}
