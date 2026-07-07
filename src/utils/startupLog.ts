// Minimal startup logger that writes to file (bypasses Ink console patch)
const LOG = "/tmp/opencode/trace.log"
let enabled = true
try {
  const { appendFileSync } = await import("node:fs")
  export function trace(msg: string) {
    if (!enabled) return
    try { appendFileSync(LOG, `[${Date.now()}] ${msg}\n`) } catch {}
  }
  export function traceDisable() { enabled = false }
  trace("=== trace module loaded ===")
} catch {
  export function trace(_msg: string) {}
  export function traceDisable() {}
}
