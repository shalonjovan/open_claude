export class SandboxManager {
  static isSupportedPlatform() { return true }
  static isEnabled() { return false }
  static checkDependencies() { return { errors: [], warnings: [] } }
  static getFsReadConfig() { return {} }
  static getFsWriteConfig() { return {} }
  static getNetworkRestrictionConfig() { return {} }
  static getIgnoreViolations() { return undefined }
  static getAllowUnixSockets() { return undefined }
  static getAllowLocalBinding() { return undefined }
  static getEnableWeakerNestedSandbox() { return undefined }
  static getProxyPort() { return undefined }
  static getSocksProxyPort() { return undefined }
  static getLinuxHttpSocketPath() { return undefined }
  static getLinuxSocksSocketPath() { return undefined }
  static waitForNetworkInitialization() { return Promise.resolve(true) }
  static getSandboxViolationStore() { return new SandboxViolationStore() }
  static annotateStderrWithSandboxFailures(_command, stderr) { return stderr }
  static cleanupAfterCommand() {}
  static initialize() { return Promise.resolve() }
  static updateConfig() {}
  static reset() { return Promise.resolve() }
  static wrapWithSandbox(command) { return command }
  constructor() {}
  async init() {}
  async destroy() {}
  async runCommand() {}
  async runScript() {}
  async readFile() {}
  async writeFile() {}
  on() {}
  getConfig() { return null }
}
export class SandboxViolationStore {
  getViolations() { return [] }
  clear() {}
}
export const SandboxRuntimeConfigSchema = {};
export default {};
