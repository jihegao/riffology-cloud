var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../spikes/m0-release-completion/index.ts
import { DurableObject as DurableObject3 } from "cloudflare:workers";

// ../node_modules/@cloudflare/sandbox/dist/dist-B_eXrP83.js
var LogLevel;
(function(LogLevel$1) {
  LogLevel$1[LogLevel$1["DEBUG"] = 0] = "DEBUG";
  LogLevel$1[LogLevel$1["INFO"] = 1] = "INFO";
  LogLevel$1[LogLevel$1["WARN"] = 2] = "WARN";
  LogLevel$1[LogLevel$1["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
var COLORS = {
  reset: "\x1B[0m",
  debug: "\x1B[36m",
  info: "\x1B[32m",
  warn: "\x1B[33m",
  error: "\x1B[31m",
  dim: "\x1B[2m"
};
var CloudflareLogger = class CloudflareLogger2 {
  static {
    __name(this, "CloudflareLogger");
  }
  baseContext;
  minLevel;
  outputMode;
  /**
  * Create a new CloudflareLogger
  *
  * @param baseContext Base context included in all log entries
  * @param minLevel Minimum log level to output (default: INFO)
  * @param outputMode How log entries are formatted and emitted (default: 'structured')
  */
  constructor(baseContext, minLevel = LogLevel.INFO, outputMode = "structured") {
    this.baseContext = baseContext;
    this.minLevel = minLevel;
    this.outputMode = outputMode;
  }
  /**
  * Log debug-level message
  */
  debug(message, context) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const logData = this.buildLogData("debug", message, context);
      this.output(console.log, logData);
    }
  }
  /**
  * Log info-level message
  */
  info(message, context) {
    if (this.shouldLog(LogLevel.INFO)) {
      const logData = this.buildLogData("info", message, context);
      this.output(console.log, logData);
    }
  }
  /**
  * Log warning-level message
  */
  warn(message, context) {
    if (this.shouldLog(LogLevel.WARN)) {
      const logData = this.buildLogData("warn", message, context);
      this.output(console.warn, logData);
    }
  }
  /**
  * Log error-level message
  */
  error(message, error, context) {
    if (this.shouldLog(LogLevel.ERROR)) {
      const logData = this.buildLogData("error", message, context, error);
      this.output(console.error, logData);
    }
  }
  /**
  * Create a child logger with additional context
  */
  child(context) {
    return new CloudflareLogger2({
      ...this.baseContext,
      ...context
    }, this.minLevel, this.outputMode);
  }
  /**
  * Check if a log level should be output
  */
  shouldLog(level) {
    return level >= this.minLevel;
  }
  /**
  * Build log data object
  */
  buildLogData(level, message, context, error) {
    const logData = {
      level,
      message,
      ...this.baseContext,
      ...context,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (error) logData.error = {
      message: error.message,
      stack: error.stack,
      name: error.name
    };
    return logData;
  }
  /**
  * Output log data using the configured output mode
  */
  output(consoleFn, data) {
    switch (this.outputMode) {
      case "pretty":
        this.outputPretty(consoleFn, data);
        break;
      case "json-line":
        this.outputJsonLine(consoleFn, data);
        break;
      case "structured":
        this.outputStructured(consoleFn, data);
        break;
    }
  }
  /**
  * Output as JSON string (container stdout — parsed by Containers pipeline)
  */
  outputJsonLine(consoleFn, data) {
    consoleFn(JSON.stringify(data));
  }
  /**
  * Output as raw object (Workers/DOs — Workers Logs auto-indexes fields)
  */
  outputStructured(consoleFn, data) {
    consoleFn(data);
  }
  /**
  * Output as pretty-printed, colored text (development)
  *
  * Each log event is a single consoleFn() call so it appears as one entry
  * in the Cloudflare dashboard. Context is rendered inline as compact key=value pairs.
  *
  * Format: LEVEL [component] message trace=tr_... key=value key=value
  */
  outputPretty(consoleFn, data) {
    const { level, message: msg, timestamp, traceId, component, sandboxId, sessionId, processId, commandId, durationMs, serviceVersion, instanceId, error, ...rest } = data;
    const levelStr = String(level || "INFO").toUpperCase();
    const levelColor = this.getLevelColor(levelStr);
    const componentBadge = component ? `[${component}]` : "";
    let logLine = `${timestamp ? `${COLORS.dim}${new Date(timestamp).toISOString().substring(11, 23)}${COLORS.reset} ` : ""}${levelColor}${levelStr.padEnd(5)}${COLORS.reset} ${componentBadge} ${msg}`;
    const pairs = [];
    if (traceId) pairs.push(`trace=${String(traceId).substring(0, 12)}`);
    if (commandId) pairs.push(`cmd=${String(commandId).substring(0, 12)}`);
    if (sandboxId) pairs.push(`sandbox=${sandboxId}`);
    if (sessionId) pairs.push(`session=${String(sessionId).substring(0, 12)}`);
    if (processId) pairs.push(`proc=${processId}`);
    if (durationMs !== void 0) pairs.push(`dur=${durationMs}ms`);
    for (const [key, value] of Object.entries(rest)) {
      if (value === void 0 || value === null) continue;
      const v = typeof value === "object" ? JSON.stringify(value) : this.sanitizePrettyValue(String(value));
      pairs.push(`${key}=${v}`);
    }
    if (error && typeof error === "object") {
      const errorObj = error;
      if (errorObj.name) pairs.push(`err.name=${this.sanitizePrettyValue(errorObj.name)}`);
      if (errorObj.message) pairs.push(`err.msg=${this.sanitizePrettyValue(errorObj.message)}`);
      if (errorObj.stack) pairs.push(`err.stack=${this.sanitizePrettyValue(errorObj.stack)}`);
    }
    if (pairs.length > 0) logLine += ` ${COLORS.dim}${pairs.join(" ")}${COLORS.reset}`;
    consoleFn(logLine);
  }
  /**
  * Collapse newlines so a single consoleFn() call stays on one line.
  * Cloudflare's log pipeline splits on literal newlines, which fragments
  * stack traces and multi-line error messages into separate entries.
  */
  sanitizePrettyValue(value) {
    return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  }
  /**
  * Get ANSI color code for log level
  */
  getLevelColor(level) {
    switch (level.toLowerCase()) {
      case "debug":
        return COLORS.debug;
      case "info":
        return COLORS.info;
      case "warn":
        return COLORS.warn;
      case "error":
        return COLORS.error;
      default:
        return COLORS.reset;
    }
  }
};
var TraceContext = class TraceContext2 {
  static {
    __name(this, "TraceContext");
  }
  /**
  * HTTP header name for trace ID propagation
  */
  static TRACE_HEADER = "X-Trace-Id";
  /**
  * Generate a new trace ID
  *
  * Format: "tr_" + 16 random hex characters
  * Example: "tr_7f3a9b2c4e5d6f1a"
  *
  * @returns Newly generated trace ID
  */
  static generate() {
    return `tr_${crypto.randomUUID().replace(/-/g, "").substring(0, 16)}`;
  }
  /**
  * Extract trace ID from HTTP request headers
  *
  * @param headers Request headers
  * @returns Trace ID if present, null otherwise
  */
  static fromHeaders(headers) {
    return headers.get(TraceContext2.TRACE_HEADER);
  }
  /**
  * Create headers object with trace ID for outgoing requests
  *
  * @param traceId Trace ID to include
  * @returns Headers object with X-Trace-Id set
  */
  static toHeaders(traceId) {
    return { [TraceContext2.TRACE_HEADER]: traceId };
  }
  /**
  * Get the header name used for trace ID propagation
  *
  * @returns Header name ("X-Trace-Id")
  */
  static getHeaderName() {
    return TraceContext2.TRACE_HEADER;
  }
};
function createLogger(context) {
  const minLevel = getLogLevelFromEnv();
  const outputMode = getOutputMode(context.component);
  return new CloudflareLogger({
    ...context,
    traceId: context.traceId || TraceContext.generate(),
    component: context.component,
    serviceVersion: context.serviceVersion || getEnvVar("SANDBOX_VERSION") || void 0,
    instanceId: context.instanceId || getEnvVar("HOSTNAME") || getEnvVar("SANDBOX_INSTANCE_ID") || void 0
  }, minLevel, outputMode);
}
__name(createLogger, "createLogger");
function getLogLevelFromEnv() {
  switch ((getEnvVar("SANDBOX_LOG_LEVEL") || "info").toLowerCase()) {
    case "debug":
      return LogLevel.DEBUG;
    case "info":
      return LogLevel.INFO;
    case "warn":
      return LogLevel.WARN;
    case "error":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}
__name(getLogLevelFromEnv, "getLogLevelFromEnv");
function getOutputMode(component) {
  if (getEnvVar("SANDBOX_LOG_FORMAT")?.toLowerCase() === "pretty") return "pretty";
  if (component === "container" || component === "executor") return "json-line";
  return "structured";
}
__name(getOutputMode, "getOutputMode");
function getEnvVar(name) {
  if (typeof process !== "undefined" && process.env) return process.env[name];
  if (typeof Bun !== "undefined") {
    const bunEnv = Bun.env;
    if (bunEnv) return bunEnv[name];
  }
}
__name(getEnvVar, "getEnvVar");

// ../node_modules/@cloudflare/sandbox/dist/errors-CpkKPbWC.js
var ErrorCode = {
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  FILE_EXISTS: "FILE_EXISTS",
  IS_DIRECTORY: "IS_DIRECTORY",
  NOT_DIRECTORY: "NOT_DIRECTORY",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  NO_SPACE: "NO_SPACE",
  TOO_MANY_FILES: "TOO_MANY_FILES",
  RESOURCE_BUSY: "RESOURCE_BUSY",
  READ_ONLY: "READ_ONLY",
  NAME_TOO_LONG: "NAME_TOO_LONG",
  TOO_MANY_LINKS: "TOO_MANY_LINKS",
  FILESYSTEM_ERROR: "FILESYSTEM_ERROR",
  COMMAND_NOT_FOUND: "COMMAND_NOT_FOUND",
  COMMAND_PERMISSION_DENIED: "COMMAND_PERMISSION_DENIED",
  INVALID_COMMAND: "INVALID_COMMAND",
  COMMAND_EXECUTION_ERROR: "COMMAND_EXECUTION_ERROR",
  STREAM_START_ERROR: "STREAM_START_ERROR",
  PROCESS_NOT_FOUND: "PROCESS_NOT_FOUND",
  PROCESS_PERMISSION_DENIED: "PROCESS_PERMISSION_DENIED",
  PROCESS_ERROR: "PROCESS_ERROR",
  SESSION_ALREADY_EXISTS: "SESSION_ALREADY_EXISTS",
  SESSION_DESTROYED: "SESSION_DESTROYED",
  SESSION_TERMINATED: "SESSION_TERMINATED",
  PORT_ALREADY_EXPOSED: "PORT_ALREADY_EXPOSED",
  PORT_IN_USE: "PORT_IN_USE",
  PORT_NOT_EXPOSED: "PORT_NOT_EXPOSED",
  INVALID_PORT_NUMBER: "INVALID_PORT_NUMBER",
  INVALID_PORT: "INVALID_PORT",
  SERVICE_NOT_RESPONDING: "SERVICE_NOT_RESPONDING",
  PORT_OPERATION_ERROR: "PORT_OPERATION_ERROR",
  CUSTOM_DOMAIN_REQUIRED: "CUSTOM_DOMAIN_REQUIRED",
  GIT_REPOSITORY_NOT_FOUND: "GIT_REPOSITORY_NOT_FOUND",
  GIT_BRANCH_NOT_FOUND: "GIT_BRANCH_NOT_FOUND",
  GIT_AUTH_FAILED: "GIT_AUTH_FAILED",
  GIT_NETWORK_ERROR: "GIT_NETWORK_ERROR",
  INVALID_GIT_URL: "INVALID_GIT_URL",
  GIT_CLONE_FAILED: "GIT_CLONE_FAILED",
  GIT_CHECKOUT_FAILED: "GIT_CHECKOUT_FAILED",
  GIT_OPERATION_FAILED: "GIT_OPERATION_FAILED",
  BUCKET_MOUNT_ERROR: "BUCKET_MOUNT_ERROR",
  BUCKET_UNMOUNT_ERROR: "BUCKET_UNMOUNT_ERROR",
  S3FS_MOUNT_ERROR: "S3FS_MOUNT_ERROR",
  MISSING_CREDENTIALS: "MISSING_CREDENTIALS",
  INVALID_MOUNT_CONFIG: "INVALID_MOUNT_CONFIG",
  BACKUP_CREATE_FAILED: "BACKUP_CREATE_FAILED",
  BACKUP_RESTORE_FAILED: "BACKUP_RESTORE_FAILED",
  BACKUP_NOT_FOUND: "BACKUP_NOT_FOUND",
  BACKUP_EXPIRED: "BACKUP_EXPIRED",
  INVALID_BACKUP_CONFIG: "INVALID_BACKUP_CONFIG",
  INTERPRETER_NOT_READY: "INTERPRETER_NOT_READY",
  CONTEXT_NOT_FOUND: "CONTEXT_NOT_FOUND",
  CODE_EXECUTION_ERROR: "CODE_EXECUTION_ERROR",
  PYTHON_NOT_AVAILABLE: "PYTHON_NOT_AVAILABLE",
  JAVASCRIPT_NOT_AVAILABLE: "JAVASCRIPT_NOT_AVAILABLE",
  OPENCODE_STARTUP_FAILED: "OPENCODE_STARTUP_FAILED",
  PROCESS_READY_TIMEOUT: "PROCESS_READY_TIMEOUT",
  PROCESS_EXITED_BEFORE_READY: "PROCESS_EXITED_BEFORE_READY",
  WATCH_NOT_FOUND: "WATCH_NOT_FOUND",
  WATCH_START_ERROR: "WATCH_START_ERROR",
  WATCH_STOP_ERROR: "WATCH_STOP_ERROR",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INVALID_JSON_RESPONSE: "INVALID_JSON_RESPONSE",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  RPC_TRANSPORT_ERROR: "RPC_TRANSPORT_ERROR",
  CONTAINER_UNAVAILABLE: "CONTAINER_UNAVAILABLE",
  OPERATION_INTERRUPTED: "OPERATION_INTERRUPTED"
};
var ERROR_STATUS_MAP = {
  [ErrorCode.FILE_NOT_FOUND]: 404,
  [ErrorCode.COMMAND_NOT_FOUND]: 404,
  [ErrorCode.PROCESS_NOT_FOUND]: 404,
  [ErrorCode.PORT_NOT_EXPOSED]: 404,
  [ErrorCode.GIT_REPOSITORY_NOT_FOUND]: 404,
  [ErrorCode.GIT_BRANCH_NOT_FOUND]: 404,
  [ErrorCode.CONTEXT_NOT_FOUND]: 404,
  [ErrorCode.WATCH_NOT_FOUND]: 404,
  [ErrorCode.IS_DIRECTORY]: 400,
  [ErrorCode.NOT_DIRECTORY]: 400,
  [ErrorCode.INVALID_COMMAND]: 400,
  [ErrorCode.INVALID_PORT_NUMBER]: 400,
  [ErrorCode.INVALID_PORT]: 400,
  [ErrorCode.INVALID_GIT_URL]: 400,
  [ErrorCode.CUSTOM_DOMAIN_REQUIRED]: 400,
  [ErrorCode.INVALID_JSON_RESPONSE]: 400,
  [ErrorCode.NAME_TOO_LONG]: 400,
  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.MISSING_CREDENTIALS]: 400,
  [ErrorCode.INVALID_MOUNT_CONFIG]: 400,
  [ErrorCode.GIT_AUTH_FAILED]: 401,
  [ErrorCode.PERMISSION_DENIED]: 403,
  [ErrorCode.COMMAND_PERMISSION_DENIED]: 403,
  [ErrorCode.PROCESS_PERMISSION_DENIED]: 403,
  [ErrorCode.READ_ONLY]: 403,
  [ErrorCode.FILE_EXISTS]: 409,
  [ErrorCode.PORT_ALREADY_EXPOSED]: 409,
  [ErrorCode.PORT_IN_USE]: 409,
  [ErrorCode.RESOURCE_BUSY]: 409,
  [ErrorCode.SESSION_ALREADY_EXISTS]: 409,
  [ErrorCode.OPERATION_INTERRUPTED]: 409,
  [ErrorCode.SESSION_DESTROYED]: 410,
  [ErrorCode.SESSION_TERMINATED]: 410,
  [ErrorCode.FILE_TOO_LARGE]: 413,
  [ErrorCode.SERVICE_NOT_RESPONDING]: 502,
  [ErrorCode.GIT_NETWORK_ERROR]: 502,
  [ErrorCode.BACKUP_NOT_FOUND]: 404,
  [ErrorCode.BACKUP_EXPIRED]: 400,
  [ErrorCode.INVALID_BACKUP_CONFIG]: 400,
  [ErrorCode.BACKUP_CREATE_FAILED]: 500,
  [ErrorCode.BACKUP_RESTORE_FAILED]: 500,
  [ErrorCode.PYTHON_NOT_AVAILABLE]: 501,
  [ErrorCode.JAVASCRIPT_NOT_AVAILABLE]: 501,
  [ErrorCode.INTERPRETER_NOT_READY]: 503,
  [ErrorCode.OPENCODE_STARTUP_FAILED]: 503,
  [ErrorCode.RPC_TRANSPORT_ERROR]: 503,
  [ErrorCode.CONTAINER_UNAVAILABLE]: 503,
  [ErrorCode.PROCESS_READY_TIMEOUT]: 408,
  [ErrorCode.PROCESS_EXITED_BEFORE_READY]: 500,
  [ErrorCode.NO_SPACE]: 500,
  [ErrorCode.TOO_MANY_FILES]: 500,
  [ErrorCode.TOO_MANY_LINKS]: 500,
  [ErrorCode.FILESYSTEM_ERROR]: 500,
  [ErrorCode.COMMAND_EXECUTION_ERROR]: 500,
  [ErrorCode.STREAM_START_ERROR]: 500,
  [ErrorCode.PROCESS_ERROR]: 500,
  [ErrorCode.PORT_OPERATION_ERROR]: 500,
  [ErrorCode.GIT_CLONE_FAILED]: 500,
  [ErrorCode.GIT_CHECKOUT_FAILED]: 500,
  [ErrorCode.GIT_OPERATION_FAILED]: 500,
  [ErrorCode.CODE_EXECUTION_ERROR]: 500,
  [ErrorCode.BUCKET_MOUNT_ERROR]: 500,
  [ErrorCode.BUCKET_UNMOUNT_ERROR]: 500,
  [ErrorCode.S3FS_MOUNT_ERROR]: 500,
  [ErrorCode.WATCH_START_ERROR]: 500,
  [ErrorCode.WATCH_STOP_ERROR]: 500,
  [ErrorCode.UNKNOWN_ERROR]: 500,
  [ErrorCode.INTERNAL_ERROR]: 500
};
function getHttpStatus(code) {
  return ERROR_STATUS_MAP[code] || 500;
}
__name(getHttpStatus, "getHttpStatus");
function getSuggestion(code, context) {
  switch (code) {
    case ErrorCode.FILE_NOT_FOUND:
      return `Ensure the file exists at ${context.path} before attempting to access it`;
    case ErrorCode.FILE_EXISTS:
      return `File already exists at ${context.path}. Use a different path or delete the existing file first`;
    case ErrorCode.COMMAND_NOT_FOUND:
      return `Check that "${context.command}" is installed and available in the system PATH`;
    case ErrorCode.PROCESS_NOT_FOUND:
      return "Verify the process ID is correct and the process has not already exited";
    case ErrorCode.PORT_NOT_EXPOSED:
      return `Port ${context.port} is not currently available for this operation`;
    case ErrorCode.PORT_ALREADY_EXPOSED:
      return `Port ${context.port} already has preview URL authorization or activation state`;
    case ErrorCode.PORT_IN_USE:
      return `Port ${context.port} is already in use by another service. Choose a different port`;
    case ErrorCode.SESSION_ALREADY_EXISTS:
      return `Session "${context.sessionId}" already exists. Use a different session ID or reuse the existing session`;
    case ErrorCode.SESSION_DESTROYED:
      return `Session "${context.sessionId}" was destroyed. Create a new session to continue executing commands`;
    case ErrorCode.SESSION_TERMINATED:
      return `Session "${context.sessionId}" ended because its shell exited (exit code: ${context.exitCode ?? "unknown"}). Session-local state (env vars, cwd, shell functions) has been lost. Retry the call to start a fresh session, or call createSession() with the same id to recreate it explicitly`;
    case ErrorCode.INVALID_PORT:
      return `Port must be between 1 and 65535. Port ${context.port} is ${context.reason}`;
    case ErrorCode.GIT_REPOSITORY_NOT_FOUND:
      return "Verify the repository URL is correct and accessible";
    case ErrorCode.GIT_AUTH_FAILED:
      return "Check authentication credentials or use a public repository";
    case ErrorCode.GIT_BRANCH_NOT_FOUND:
      return `Branch "${context.branch}" does not exist in the repository. Check the branch name or use the default branch`;
    case ErrorCode.INTERPRETER_NOT_READY:
      return context.retryAfter ? `Code interpreter is starting up. Retry after ${context.retryAfter} seconds` : "Code interpreter is not ready. Please wait a moment and try again";
    case ErrorCode.CONTEXT_NOT_FOUND:
      return `Context "${context.contextId}" does not exist. Create a context first using createContext()`;
    case ErrorCode.VALIDATION_FAILED:
      return "Check the request parameters and ensure they match the required format";
    case ErrorCode.NO_SPACE:
      return "Not enough disk space available. Consider cleaning up temporary files or increasing storage";
    case ErrorCode.PERMISSION_DENIED:
      return "Operation not permitted. Check file/directory permissions";
    case ErrorCode.IS_DIRECTORY:
      return `Cannot perform this operation on a directory. Path ${context.path} is a directory`;
    case ErrorCode.NOT_DIRECTORY:
      return `Expected a directory but found a file at ${context.path}`;
    case ErrorCode.RESOURCE_BUSY:
      return "Resource is currently in use. Wait for the current operation to complete";
    case ErrorCode.READ_ONLY:
      return "Cannot modify a read-only resource";
    case ErrorCode.SERVICE_NOT_RESPONDING:
      return "Service is not responding. Check if the service is running and accessible";
    case ErrorCode.BACKUP_NOT_FOUND:
      return `Backup "${context.backupId}" does not exist. Verify the backup ID is correct`;
    case ErrorCode.BACKUP_EXPIRED:
      return `Backup "${context.backupId}" has expired. Create a new backup`;
    case ErrorCode.INVALID_BACKUP_CONFIG:
      return `Invalid backup configuration: ${context.reason}`;
    case ErrorCode.BACKUP_CREATE_FAILED:
      return "Backup creation failed. Check that the directory exists and you have sufficient disk space";
    case ErrorCode.BACKUP_RESTORE_FAILED:
      return "Backup restoration failed. The archive may be corrupted or the target directory may be in use";
    case ErrorCode.CONTAINER_UNAVAILABLE:
      return "The sandbox container is temporarily unavailable. Retry the same operation \u2014 it will succeed once the container is ready.";
    case ErrorCode.OPERATION_INTERRUPTED:
      return "The sandbox operation was interrupted by a runtime change. Retry only if the operation is idempotent, or verify sandbox state before retrying.";
    case ErrorCode.RPC_TRANSPORT_ERROR:
      switch (context.kind) {
        case "peer_closed":
          return "The container closed the WebSocket mid-call (likely a container restart, eviction, or crash). Retry the call \u2014 the SDK will open a fresh connection.";
        case "connection_failed":
          return "The WebSocket connection failed. Retry the call; if the failure persists, check container health and network connectivity.";
        case "upgrade_failed":
          return "The WebSocket upgrade was rejected by the container. Verify the container is running and reachable on the configured port.";
        case "invalid_frame":
          return "The container sent a frame the RPC transport cannot handle. This usually indicates a version mismatch between the SDK and the container image.";
        case "protocol_error":
          return "The peer sent a malformed RPC message (could not parse the wire format). This usually indicates a version mismatch between the SDK and the container image.";
        case "session_disposed":
          return "The RPC session was disposed while a call was in flight. Avoid reusing stubs after disconnect(); the next method call will reconnect automatically.";
        default:
          return "The RPC transport raised an error. Retry the call \u2014 the SDK will open a fresh connection.";
      }
    default:
      return;
  }
}
__name(getSuggestion, "getSuggestion");

// ../node_modules/@cloudflare/containers/dist/lib/helpers.js
function generateId(length = 9) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}
__name(generateId, "generateId");
function parseTimeExpression(timeExpression) {
  if (typeof timeExpression === "number") {
    return timeExpression;
  }
  if (typeof timeExpression === "string") {
    const match = timeExpression.match(/^(\d+)([smh])$/);
    if (!match) {
      throw new Error(`invalid time expression ${timeExpression}`);
    }
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 60 * 60;
      default:
        throw new Error(`unknown time unit ${unit}`);
    }
  }
  throw new Error(`invalid type for a time expression: ${typeof timeExpression}`);
}
__name(parseTimeExpression, "parseTimeExpression");

// ../node_modules/@cloudflare/containers/dist/lib/container.js
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
var NO_CONTAINER_INSTANCE_ERROR = "there is no container instance that can be provided to this durable object";
var RATE_LIMITED_ERROR = "you are requesting too many containers per second";
var RUNTIME_SIGNALLED_ERROR = "runtime signalled the container to exit:";
var UNEXPECTED_EXIT_ERROR = "container exited with unexpected exit code:";
var NOT_LISTENING_ERROR = "the container is not listening";
var CONTAINER_STATE_KEY = "__CF_CONTAINER_STATE";
var OUTBOUND_CONFIGURATION_KEY = "OUTBOUND_CONFIGURATION";
var MAX_ALARM_RETRIES = 3;
var PING_TIMEOUT_MS = 5e3;
var DEFAULT_SLEEP_AFTER = "10m";
var INSTANCE_POLL_INTERVAL_MS = 300;
var TIMEOUT_TO_GET_CONTAINER_MS = 8e3;
var TIMEOUT_TO_GET_PORTS_MS = 2e4;
var FALLBACK_PORT_TO_CHECK = 33;
var outboundHandlersRegistry = /* @__PURE__ */ new Map();
var defaultOutboundHandlerNameRegistry = /* @__PURE__ */ new Map();
var outboundByHostRegistry = /* @__PURE__ */ new Map();
var signalToNumbers = {
  SIGINT: 2,
  SIGTERM: 15,
  SIGKILL: 9
};
function isErrorOfType(e, matchingString) {
  const errorString = e instanceof Error ? e.message : String(e);
  return errorString.toLowerCase().includes(matchingString);
}
__name(isErrorOfType, "isErrorOfType");
var isNoInstanceError = /* @__PURE__ */ __name((error) => isErrorOfType(error, NO_CONTAINER_INSTANCE_ERROR), "isNoInstanceError");
var isRateLimitedError = /* @__PURE__ */ __name((error) => isErrorOfType(error, RATE_LIMITED_ERROR), "isRateLimitedError");
var isRuntimeSignalledError = /* @__PURE__ */ __name((error) => isErrorOfType(error, RUNTIME_SIGNALLED_ERROR), "isRuntimeSignalledError");
var isNotListeningError = /* @__PURE__ */ __name((error) => isErrorOfType(error, NOT_LISTENING_ERROR), "isNotListeningError");
var isContainerExitNonZeroError = /* @__PURE__ */ __name((error) => isErrorOfType(error, UNEXPECTED_EXIT_ERROR), "isContainerExitNonZeroError");
function getExitCodeFromError(error) {
  if (!(error instanceof Error)) {
    return null;
  }
  if (isRuntimeSignalledError(error)) {
    return +error.message.toLowerCase().slice(error.message.toLowerCase().indexOf(RUNTIME_SIGNALLED_ERROR) + RUNTIME_SIGNALLED_ERROR.length + 1);
  }
  if (isContainerExitNonZeroError(error)) {
    return +error.message.toLowerCase().slice(error.message.toLowerCase().indexOf(UNEXPECTED_EXIT_ERROR) + UNEXPECTED_EXIT_ERROR.length + 1);
  }
  return null;
}
__name(getExitCodeFromError, "getExitCodeFromError");
function addTimeoutSignal(existingSignal, timeoutMs) {
  const controller = new AbortController();
  if (existingSignal?.aborted) {
    controller.abort();
    return controller.signal;
  }
  existingSignal?.addEventListener("abort", () => controller.abort());
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener("abort", () => clearTimeout(timeoutId));
  return controller.signal;
}
__name(addTimeoutSignal, "addTimeoutSignal");
var ContainerState = class {
  static {
    __name(this, "ContainerState");
  }
  storage;
  status;
  constructor(storage) {
    this.storage = storage;
  }
  async setRunning() {
    await this.setStatusAndupdate("running");
  }
  async setHealthy() {
    await this.setStatusAndupdate("healthy");
  }
  async setStopping() {
    await this.setStatusAndupdate("stopping");
  }
  async setStopped() {
    await this.setStatusAndupdate("stopped");
  }
  async setStoppedIfUnchanged(previousState) {
    if (this.status !== previousState) {
      return;
    }
    await this.setStopped();
  }
  async setStoppedWithCode(exitCode) {
    this.status = { status: "stopped_with_code", lastChange: Date.now(), exitCode };
    await this.update();
  }
  async getState() {
    if (!this.status) {
      const state = await this.storage.get(CONTAINER_STATE_KEY);
      if (!state) {
        this.status = {
          status: "stopped",
          lastChange: Date.now()
        };
        await this.update();
      } else {
        this.status = state;
      }
    }
    return this.status;
  }
  async setStatusAndupdate(status) {
    this.status = { status, lastChange: Date.now() };
    await this.update();
  }
  async update() {
    if (!this.status)
      throw new Error("status should be init");
    await this.storage.put(CONTAINER_STATE_KEY, this.status);
  }
};
var Container = class extends DurableObject {
  static {
    __name(this, "Container");
  }
  static get outboundByHost() {
    return outboundByHostRegistry.get(this.name);
  }
  static set outboundByHost(handlers) {
    outboundByHostRegistry.set(this.name, handlers);
  }
  static get outboundHandlers() {
    return outboundHandlersRegistry.get(this.name);
  }
  static set outboundHandlers(handlers) {
    const existing = outboundHandlersRegistry.get(this.name) ?? {};
    outboundHandlersRegistry.set(this.name, { ...existing, ...handlers });
  }
  static get outbound() {
    const handlerName = defaultOutboundHandlerNameRegistry.get(this.name);
    if (!handlerName)
      return void 0;
    return outboundHandlersRegistry.get(this.name)?.[handlerName];
  }
  static set outbound(handler) {
    const key = "__outbound__";
    const existing = outboundHandlersRegistry.get(this.name) ?? {};
    outboundHandlersRegistry.set(this.name, { ...existing, [key]: handler });
    defaultOutboundHandlerNameRegistry.set(this.name, key);
  }
  static get outboundProxies() {
    return this.outboundHandlers;
  }
  static set outboundProxies(handlers) {
    this.outboundHandlers = handlers;
  }
  static get outboundProxy() {
    return this.outbound;
  }
  static set outboundProxy(handler) {
    this.outbound = handler;
  }
  // =========================
  //     Public Attributes
  // =========================
  // Default port for the container (undefined means no default port)
  defaultPort;
  // Required ports that should be checked for availability during container startup
  // Override this in your subclass to specify ports that must be ready
  requiredPorts;
  // Timeout after which the container will sleep if no activity
  // The signal sent to the container by default is a SIGTERM.
  // The container won't get a SIGKILL if this threshold is triggered.
  sleepAfter = DEFAULT_SLEEP_AFTER;
  // Container configuration properties
  // Set these properties directly in your container instance
  envVars = {};
  entrypoint;
  enableInternet = true;
  labels = {};
  // When true, outbound HTTPS traffic from the container will be intercepted.
  // The container must trust /etc/cloudflare/certs/cloudflare-containers-ca.crt
  interceptHttps = false;
  // Hosts that are allowed to access the internet, even when enableInternet is false.
  // Useful for allowing specific domains on a per-host basis.
  allowedHosts;
  // Hosts that are denied internet access, even when enableInternet is true.
  // Also blocks hosts from being handled by the catch-all outbound handler.
  deniedHosts;
  // pingEndpoint is the host and path value that the class will use to send a request to the container and check if the
  // instance is ready.
  //
  // The user does not have to implement this route by any means,
  // but it's still useful if you want to control the path that
  // the Container class uses to send HTTP requests to.
  pingEndpoint = "ping";
  applyOutboundInterceptionPromise = Promise.resolve();
  usingInterception = false;
  // =========================
  //     PUBLIC INTERFACE
  // =========================
  constructor(ctx, env, options) {
    super(ctx, env);
    if (ctx.container === void 0) {
      throw new Error("Containers have not been enabled for this Durable Object class. Have you correctly setup your Wrangler config? More info: https://developers.cloudflare.com/containers/get-started/#configuration");
    }
    this.state = new ContainerState(this.ctx.storage);
    const persistedOutboundConfiguration = this.restoreOutboundConfiguration();
    this.ctx.blockConcurrencyWhile(async () => {
      await this.scheduleNextAlarm();
      this.renewActivityTimeout();
      const ctor = this.constructor;
      if (persistedOutboundConfiguration !== void 0 || ctor.outboundByHost !== void 0 || ctor.outbound !== void 0 || ctor.outboundHandlers !== void 0 || this.effectiveAllowedHosts !== void 0 || this.effectiveDeniedHosts !== void 0) {
        this.usingInterception = true;
      }
      if (this.container.running) {
        this.applyOutboundInterceptionPromise = this.applyOutboundInterception();
      }
    });
    this.container = ctx.container;
    if (options) {
      if (options.defaultPort !== void 0)
        this.defaultPort = options.defaultPort;
      if (options.sleepAfter !== void 0)
        this.sleepAfter = options.sleepAfter;
      if (options.envVars !== void 0)
        this.envVars = options.envVars;
      if (options.entrypoint !== void 0)
        this.entrypoint = options.entrypoint;
      if (options.enableInternet !== void 0)
        this.enableInternet = options.enableInternet;
    }
    this.sql`
      CREATE TABLE IF NOT EXISTS container_schedules (
        id TEXT PRIMARY KEY NOT NULL DEFAULT (randomblob(9)),
        callback TEXT NOT NULL,
        payload TEXT,
        type TEXT NOT NULL CHECK(type IN ('scheduled', 'delayed')),
        time INTEGER NOT NULL,
        delayInSeconds INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `;
    if (this.container.running) {
      this.monitor = this.container.monitor();
      this.setupMonitorCallbacks();
    }
  }
  /**
   * Gets the current state of the container
   * @returns Promise<State>
   */
  async getState() {
    return { ...await this.state.getState() };
  }
  // ====================================
  //     OUTBOUND INTERCEPTION CONFIG
  // ====================================
  /**
   * Set the catch-all outbound handler to a named method from `outboundHandlers`.
   * Overrides the default `outbound` at runtime via ContainerProxy props.
   *
   * @param methodName - Name of a method defined in `static outboundHandlers`
   * @param params - Optional params passed to the handler as `ctx.params`
   * @throws Error if the method name is not found in `outboundHandlers`
   */
  async setOutboundHandler(methodName, ...paramsArg) {
    this.validateOutboundHandlerMethodName(methodName);
    this.outboundHandlerOverride = paramsArg.length === 0 ? { method: methodName } : { method: methodName, params: paramsArg[0] };
    await this.refreshOutboundInterception();
  }
  /**
   * Add or override a hostname-specific outbound handler at runtime,
   * referencing a named method from `outboundHandlers`.
   * Overrides any matching entry in `static outboundByHost` for this hostname.
   *
   * @param hostname - The hostname or ip:port to intercept (e.g. `'google.com'`)
   * @param methodName - Name of a method defined in `static outboundHandlers`
   * @param params - Optional params passed to the handler as `ctx.params`
   * @throws Error if the method name is not found in `outboundHandlers`
   */
  async setOutboundByHost(hostname, methodName, ...paramsArg) {
    this.validateOutboundHandlerMethodName(methodName);
    this.outboundByHostOverrides[hostname] = paramsArg.length === 0 ? { method: methodName } : { method: methodName, params: paramsArg[0] };
    await this.refreshOutboundInterception();
  }
  /**
   * Remove a runtime hostname override added via `setOutboundByHost`.
   * The default handler from `static outboundByHost` (if any) will be used again.
   *
   * @param hostname - The hostname or ip:port to stop overriding
   */
  async removeOutboundByHost(hostname) {
    delete this.outboundByHostOverrides[hostname];
    await this.refreshOutboundInterception();
  }
  /**
   * Replace all runtime hostname overrides at once.
   * Each value may be either a method name or an object with `method` and `params`.
   *
   * @param handlers - Record mapping hostnames to handler configs in `outboundHandlers`
   * @throws Error if any method name is not found in `outboundHandlers`
   */
  async setOutboundByHosts(handlers) {
    for (const handler of Object.values(handlers)) {
      const methodName = typeof handler === "string" ? handler : handler.method;
      this.validateOutboundHandlerMethodName(methodName);
    }
    this.outboundByHostOverrides = Object.fromEntries(Object.entries(handlers).map(([hostname, handler]) => [
      hostname,
      typeof handler === "string" ? { method: handler } : handler
    ]));
    await this.refreshOutboundInterception();
  }
  // ====================================
  //     ALLOWED / DENIED HOSTS CONFIG
  // ====================================
  /**
   * Replace all allowed hosts at runtime.
   * Allowed hosts get internet access even when `enableInternet` is false.
   *
   * @param hosts - Array of hostnames to allow (e.g. `['api.stripe.com', 'example.com']`)
   */
  async setAllowedHosts(hosts) {
    this.allowedHostsOverride = [...hosts];
    this.usingInterception = true;
    await this.refreshOutboundInterception();
  }
  /**
   * Replace all denied hosts at runtime.
   * Denied hosts are blocked unconditionally, even when `enableInternet` is true
   * or a catch-all outbound handler is set.
   *
   * @param hosts - Array of hostnames to deny (e.g. `['evil.com', 'blocked.org']`)
   */
  async setDeniedHosts(hosts) {
    this.deniedHostsOverride = [...hosts];
    this.usingInterception = true;
    await this.refreshOutboundInterception();
  }
  /**
   * Add a single hostname to the allowed hosts list at runtime.
   *
   * @param hostname - The hostname to allow (e.g. `'api.stripe.com'`)
   */
  async allowHost(hostname) {
    const effective = this.effectiveAllowedHosts ?? [];
    if (!effective.includes(hostname)) {
      this.allowedHostsOverride = [...effective, hostname];
    }
    this.usingInterception = true;
    await this.refreshOutboundInterception();
  }
  /**
   * Add a single hostname to the denied hosts list at runtime.
   *
   * @param hostname - The hostname to deny (e.g. `'evil.com'`)
   */
  async denyHost(hostname) {
    const effective = this.effectiveDeniedHosts ?? [];
    if (!effective.includes(hostname)) {
      this.deniedHostsOverride = [...effective, hostname];
    }
    this.usingInterception = true;
    await this.refreshOutboundInterception();
  }
  /**
   * Remove a hostname from the allowed hosts list.
   *
   * @param hostname - The hostname to remove from the allow list
   */
  async removeAllowedHost(hostname) {
    this.allowedHostsOverride = (this.effectiveAllowedHosts ?? []).filter((h) => h !== hostname);
    await this.refreshOutboundInterception();
  }
  /**
   * Remove a hostname from the denied hosts list.
   *
   * @param hostname - The hostname to remove from the deny list
   */
  async removeDeniedHost(hostname) {
    this.deniedHostsOverride = (this.effectiveDeniedHosts ?? []).filter((h) => h !== hostname);
    await this.refreshOutboundInterception();
  }
  // ==========================
  //     CONTAINER STARTING
  // ==========================
  /**
   * Start the container if it's not running and set up monitoring and lifecycle hooks,
   * without waiting for ports to be ready.
   *
   * It will automatically retry if the container fails to start, using the specified waitOptions
   *
   *
   * @example
   * await this.start({
   *   envVars: { DEBUG: 'true', NODE_ENV: 'development' },
   *   entrypoint: ['npm', 'run', 'dev'],
   *   enableInternet: false,
   *   labels: { tenant: 'acme', env: 'prod' },
   * });
   *
   * @param startOptions - Override `envVars`, `entrypoint`, `enableInternet` and `labels` on a per-instance basis
   * @param waitOptions - Optional wait configuration with abort signal for cancellation. Default ~8s timeout.
   * @returns A promise that resolves when the container start command has been issued
   * @throws Error if no container context is available or if all start attempts fail
   */
  async start(startOptions, waitOptions) {
    const portToCheck = waitOptions?.portToCheck ?? this.defaultPort ?? (this.requiredPorts ? this.requiredPorts[0] : FALLBACK_PORT_TO_CHECK);
    const pollInterval = waitOptions?.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    await this.startContainerIfNotRunning({
      signal: waitOptions?.signal,
      waitInterval: pollInterval,
      retries: waitOptions?.retries ?? Math.ceil(TIMEOUT_TO_GET_CONTAINER_MS / pollInterval),
      portToCheck
    }, startOptions);
    this.setupMonitorCallbacks();
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.onStart();
    });
  }
  async startAndWaitForPorts(portsOrArgs, cancellationOptions, startOptions) {
    let ports;
    let resolvedCancellationOptions;
    let resolvedStartOptions;
    if (typeof portsOrArgs === "object" && portsOrArgs !== null && !Array.isArray(portsOrArgs)) {
      ports = portsOrArgs.ports;
      resolvedCancellationOptions = portsOrArgs.cancellationOptions;
      resolvedStartOptions = portsOrArgs.startOptions;
    } else {
      ports = portsOrArgs;
      resolvedCancellationOptions = cancellationOptions;
      resolvedStartOptions = startOptions;
    }
    const portsToCheck = await this.getPortsToCheck(ports);
    await this.syncPendingStoppedEvents();
    resolvedCancellationOptions ??= {};
    const containerGetTimeout = resolvedCancellationOptions.instanceGetTimeoutMS ?? TIMEOUT_TO_GET_CONTAINER_MS;
    const pollInterval = resolvedCancellationOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    const containerGetRetries = Math.ceil(containerGetTimeout / pollInterval);
    const waitOptions = {
      signal: resolvedCancellationOptions.abort,
      retries: containerGetRetries,
      waitInterval: pollInterval,
      portToCheck: portsToCheck[0]
    };
    const triesUsed = await this.startContainerIfNotRunning(waitOptions, resolvedStartOptions);
    const totalPortReadyTries = Math.ceil((resolvedCancellationOptions.portReadyTimeoutMS ?? TIMEOUT_TO_GET_PORTS_MS) / pollInterval);
    let triesLeft = totalPortReadyTries - triesUsed;
    for (const port of portsToCheck) {
      triesLeft = await this.waitForPort({
        signal: resolvedCancellationOptions.abort,
        waitInterval: pollInterval,
        retries: triesLeft,
        portToCheck: port
      });
    }
    this.setupMonitorCallbacks();
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.state.setHealthy();
      await this.onStart();
    });
  }
  /**
   *
   * Waits for a specified port to be ready
   *
   * Returns the number of tries used to get the port, or throws if it couldn't get the port within the specified retry limits.
   *
   * @param waitOptions -
   * - `portToCheck`: The port number to check
   * - `abort`: Optional AbortSignal to cancel waiting
   * - `retries`: Number of retries before giving up (default: TRIES_TO_GET_PORTS)
   * - `waitInterval`: Interval between retries in milliseconds (default: INSTANCE_POLL_INTERVAL_MS)
   */
  async waitForPort(waitOptions) {
    const port = waitOptions.portToCheck;
    const tcpPort = this.container.getTcpPort(port);
    const abortedSignal = new Promise((res) => {
      waitOptions.signal?.addEventListener("abort", () => {
        res(true);
      });
    });
    const pollInterval = waitOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    const tries = waitOptions.retries ?? Math.ceil(TIMEOUT_TO_GET_PORTS_MS / pollInterval);
    for (let i = 0; i < tries; i++) {
      try {
        const combinedSignal = addTimeoutSignal(waitOptions.signal, PING_TIMEOUT_MS);
        await tcpPort.fetch(`http://${this.pingEndpoint}`, { signal: combinedSignal });
        break;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        if (!this.container.running) {
          try {
            await this.onError(new Error(`Container crashed while checking for ports, did you start the container and setup the entrypoint correctly?`));
          } catch {
          }
          throw e;
        }
        if (i === tries - 1) {
          try {
            await this.onError(`Failed to verify port ${port} is available after ${(i + 1) * pollInterval}ms, last error: ${errorMessage}`);
          } catch {
          }
          throw e;
        }
        await Promise.any([
          new Promise((resolve) => setTimeout(resolve, pollInterval)),
          abortedSignal
        ]);
        if (waitOptions.signal?.aborted) {
          throw new Error("Container request aborted.", { cause: e });
        }
      }
    }
    return tries;
  }
  // =======================
  //     LIFECYCLE HOOKS
  // =======================
  /**
   * Send a signal to the container.
   * @param signal - The signal to send to the container (default: 15 for SIGTERM)
   */
  async stop(signal = "SIGTERM") {
    if (this.container.running) {
      this.container.signal(typeof signal === "string" ? signalToNumbers[signal] : signal);
    }
    await this.syncPendingStoppedEvents();
  }
  /**
   * Destroys the container with a SIGKILL. Triggers onStop.
   */
  async destroy() {
    await this.container.destroy();
  }
  /**
   * Lifecycle method called when container starts successfully
   * Override this method in subclasses to handle container start events
   */
  onStart() {
  }
  /**
   * Lifecycle method called when container shuts down
   * Override this method in subclasses to handle Container stopped events
   * @param params - Object containing exitCode and reason for the stop
   */
  onStop(params) {
    void params;
  }
  /**
   * Lifecycle method called when the container is running, and the activity timeout
   * expiration (set by `sleepAfter`) has been reached.
   *
   * If you want to shutdown the container, you should call this.stop() here
   *
   * By default, this method calls `this.stop()`
   */
  async onActivityExpired() {
    console.log("Activity expired, signalling container to stop");
    if (!this.container.running) {
      return;
    }
    await this.stop();
  }
  /**
   * Error handler for container errors
   * Override this method in subclasses to handle container errors
   * @param error - The error that occurred
   * @returns Can return any value or throw the error
   */
  onError(error) {
    console.error("Container error:", error);
    throw error;
  }
  /**
   * Renew the container's activity timeout
   *
   * Call this method whenever there is activity on the container
   */
  renewActivityTimeout() {
    const timeoutInMs = parseTimeExpression(this.sleepAfter) * 1e3;
    this.sleepAfterMs = Date.now() + timeoutInMs;
  }
  /**
   * Decrement the inflight request counter.
   * When the counter transitions to 0, renew the activity timeout so the
   * inactivity window starts fresh from the moment the last request completes.
   */
  decrementInflight() {
    this.inflightRequests = Math.max(0, this.inflightRequests - 1);
    if (this.inflightRequests === 0) {
      this.renewActivityTimeout();
    }
  }
  // ==================
  //     SCHEDULING
  // ==================
  /**
   * Schedule a task to be executed in the future.
   *
   * We strongly recommend using this instead of the `alarm` handler.
   *
   * @template T Type of the payload data
   * @param when When to execute the task (Date object or number of seconds delay)
   * @param callback Name of the method to call
   * @param payload Data to pass to the callback
   * @returns Schedule object representing the scheduled task
   */
  async schedule(when, callback, payload) {
    const id = generateId(9);
    if (typeof callback !== "string") {
      throw new Error("Callback must be a string (method name)");
    }
    if (typeof this[callback] !== "function") {
      throw new Error(`this.${callback} is not a function`);
    }
    if (when instanceof Date) {
      const timestamp = Math.floor(when.getTime() / 1e3);
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'scheduled', ${timestamp})
      `;
      await this.scheduleNextAlarm();
      return {
        taskId: id,
        callback,
        payload,
        time: timestamp,
        type: "scheduled"
      };
    }
    if (typeof when === "number") {
      const time = Math.floor(Date.now() / 1e3 + when);
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, delayInSeconds, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'delayed', ${when}, ${time})
      `;
      await this.scheduleNextAlarm();
      return {
        taskId: id,
        callback,
        payload,
        delayInSeconds: when,
        time,
        type: "delayed"
      };
    }
    throw new Error("Invalid schedule type. 'when' must be a Date or number of seconds");
  }
  // ============
  //     HTTP
  // ============
  /**
   * Send a request to the container (HTTP or WebSocket) using standard fetch API signature
   *
   * This method handles HTTP requests to the container.
   *
   * WebSocket requests done outside the DO won't work until https://github.com/cloudflare/workerd/issues/2319 is addressed.
   * Until then, please use `switchPort` + `fetch()`.
   *
   * Method supports multiple signatures to match standard fetch API:
   * - containerFetch(request: Request, port?: number)
   * - containerFetch(url: string | URL, init?: RequestInit, port?: number)
   *
   * Starts the container if not already running, and waits for the target port to be ready.
   *
   * @returns A Response from the container
   */
  async containerFetch(requestOrUrl, portOrInit, portParam) {
    const { request, port } = this.requestAndPortFromContainerFetchArgs(requestOrUrl, portOrInit, portParam);
    const state = await this.state.getState();
    if (!this.container.running || state.status !== "healthy") {
      try {
        await this.startAndWaitForPorts(port, { abort: request.signal });
      } catch (e) {
        if (isNoInstanceError(e)) {
          return new Response("There is no Container instance available at this time.\nThis is likely because you have reached your max concurrent instance count (set in wrangler config) or are you currently provisioning the Container.\nIf you are deploying your Container for the first time, check your dashboard to see provisioning status, this may take a few minutes.", { status: 503 });
        }
        if (isRateLimitedError(e)) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 429 });
        }
        return new Response(`Failed to start container: ${e instanceof Error ? e.message : String(e)}`, {
          status: 500
        });
      }
    }
    const tcpPort = this.container.getTcpPort(port);
    const containerUrl = request.url.replace("https:", "http:");
    this.inflightRequests++;
    try {
      this.renewActivityTimeout();
      const res = await tcpPort.fetch(containerUrl, request);
      if (res.webSocket !== null) {
        const containerWs = res.webSocket;
        const [client, server] = Object.values(new WebSocketPair());
        let settled = false;
        const settleInflight = /* @__PURE__ */ __name(() => {
          if (!settled) {
            settled = true;
            this.decrementInflight();
          }
        }, "settleInflight");
        containerWs.accept();
        server.accept();
        server.addEventListener("message", async (event) => {
          this.renewActivityTimeout();
          try {
            const data = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
            containerWs.send(data);
          } catch {
            server.close(1011, "Failed to forward message to container");
          }
        });
        containerWs.addEventListener("message", async (event) => {
          this.renewActivityTimeout();
          try {
            const data = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
            server.send(data);
          } catch {
            containerWs.close(1011, "Failed to forward message to client");
          }
        });
        server.addEventListener("close", (event) => {
          settleInflight();
          const code = event.code === 1005 || event.code === 1006 ? 1e3 : event.code;
          containerWs.close(code, event.reason);
        });
        containerWs.addEventListener("close", (event) => {
          settleInflight();
          const code = event.code === 1005 || event.code === 1006 ? 1e3 : event.code;
          server.close(code, event.reason);
        });
        server.addEventListener("error", () => {
          settleInflight();
          containerWs.close(1011, "Client WebSocket error");
        });
        containerWs.addEventListener("error", () => {
          settleInflight();
          server.close(1011, "Container WebSocket error");
        });
        return new Response(null, { status: res.status, webSocket: client, headers: res.headers });
      }
      if (res.body !== null) {
        const { readable, writable } = new IdentityTransformStream();
        res.body?.pipeTo(writable).finally(() => {
          this.decrementInflight();
        });
        return new Response(readable, res);
      }
      this.decrementInflight();
      return res;
    } catch (e) {
      this.decrementInflight();
      if (!(e instanceof Error)) {
        throw e;
      }
      if (e.message.includes("Network connection lost.")) {
        return new Response("Container suddenly disconnected, try again", { status: 500 });
      }
      console.error(`Error proxying request to container ${this.ctx.id}:`, e);
      return new Response(`Error proxying request to container: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
    }
  }
  /**
   *
   * Fetch handler on the Container class.
   * By default this forwards all requests to the container by calling `containerFetch`.
   * Use `switchPort` to specify which port on the container to target, or this will use `defaultPort`.
   * @param request The request to handle
   */
  async fetch(request) {
    if (this.defaultPort === void 0 && !request.headers.has("cf-container-target-port")) {
      throw new Error("No port configured for this container. Set the `defaultPort` in your Container subclass, or specify a port with `container.fetch(switchPort(request, port))`.");
    }
    let portValue = this.defaultPort;
    if (request.headers.has("cf-container-target-port")) {
      const portFromHeaders = parseInt(request.headers.get("cf-container-target-port") ?? "");
      if (isNaN(portFromHeaders)) {
        throw new Error("port value from switchPort is not a number");
      } else {
        portValue = portFromHeaders;
      }
    }
    return await this.containerFetch(request, portValue);
  }
  // ===============================
  // ===============================
  //     PRIVATE METHODS & ATTRS
  // ===============================
  // ===============================
  // ==========================
  //     PRIVATE ATTRIBUTES
  // ==========================
  container;
  // onStopCalled will be true when we are in the middle of an onStop call
  onStopCalled = false;
  state;
  monitor;
  // Coalesces concurrent calls to startContainerIfNotRunning so we never
  // call `this.container.start()` twice. Without this guard, two requests
  // racing the readiness path can both pass the `if (this.container.running)`
  // early-return (each yielding the DO input gate at storage awaits) and
  // both reach the synchronous workerd `start()`, causing the second to
  // throw "start() cannot be called on a container that is already running."
  // See https://github.com/cloudflare/containers/issues/173.
  startInFlight;
  monitoredPromise;
  sleepAfterMs = 0;
  inflightRequests = 0;
  // Outbound interception runtime overrides (passed through ContainerProxy props)
  outboundByHostOverrides = {};
  outboundHandlerOverride;
  // Only set when the user calls setAllowedHosts/setDeniedHosts at runtime
  allowedHostsOverride;
  deniedHostsOverride;
  // The runtime does not expose a way to remove outbound interceptions yet, so
  // once we promote an instance to intercept-all we must keep using it.
  hasInterceptAllRegistration = false;
  // ==========================
  //     GENERAL HELPERS
  // ==========================
  /**
   * Validates that a method name exists in the outboundHandlers registry for this class.
   * @throws Error if the method name is not found
   */
  validateOutboundHandlerMethodName(methodName) {
    const handlers = outboundHandlersRegistry.get(this.constructor.name);
    if (!handlers || !(methodName in handlers)) {
      throw new Error(`Outbound handler method '${methodName}' not found in outboundHandlers for ${this.constructor.name}`);
    }
  }
  get effectiveAllowedHosts() {
    return this.allowedHostsOverride ?? this.allowedHosts;
  }
  get effectiveDeniedHosts() {
    return this.deniedHostsOverride ?? this.deniedHosts;
  }
  getOutboundConfiguration() {
    return {
      outboundByHostOverrides: Object.keys(this.outboundByHostOverrides).length > 0 ? this.outboundByHostOverrides : void 0,
      outboundHandlerOverride: this.outboundHandlerOverride,
      allowedHosts: this.effectiveAllowedHosts,
      deniedHosts: this.effectiveDeniedHosts,
      hasInterceptAllRegistration: this.hasInterceptAllRegistration || void 0
    };
  }
  persistOutboundConfiguration(configuration) {
    this.ctx.storage.kv.put(OUTBOUND_CONFIGURATION_KEY, {
      ...configuration,
      allowedHosts: this.allowedHostsOverride,
      deniedHosts: this.deniedHostsOverride
    });
  }
  restoreOutboundConfiguration() {
    const configuration = this.ctx.storage.kv.get(OUTBOUND_CONFIGURATION_KEY);
    if (!configuration) {
      return void 0;
    }
    this.outboundHandlerOverride = void 0;
    if (configuration.outboundHandlerOverride !== void 0) {
      try {
        this.validateOutboundHandlerMethodName(configuration.outboundHandlerOverride.method);
        this.outboundHandlerOverride = configuration.outboundHandlerOverride;
      } catch (error) {
        console.warn("Ignoring invalid persisted outbound handler override:", error);
      }
    }
    this.outboundByHostOverrides = {};
    for (const [hostname, override] of Object.entries(configuration.outboundByHostOverrides ?? {})) {
      try {
        this.validateOutboundHandlerMethodName(override.method);
        this.outboundByHostOverrides[hostname] = override;
      } catch (error) {
        console.warn(`Ignoring invalid persisted outbound override for ${hostname}:`, error);
      }
    }
    this.hasInterceptAllRegistration = configuration.hasInterceptAllRegistration === true;
    if (configuration.allowedHosts) {
      this.allowedHostsOverride = configuration.allowedHosts;
    }
    if (configuration.deniedHosts) {
      this.deniedHostsOverride = configuration.deniedHosts;
    }
    return this.getOutboundConfiguration();
  }
  /**
   * Returns true if a catch-all outbound HTTP interception is needed.
   * This is the case when a static `outbound` handler or a runtime
   * `outboundHandlerOverride` (catch-all) is configured.
   * When false, we only intercept specific hosts to avoid overhead.
   */
  needsCatchAllInterception() {
    const ctor = this.constructor;
    return ctor.outbound !== void 0 || this.outboundHandlerOverride !== void 0;
  }
  hasMutableOutboundConfiguration() {
    return Object.keys(this.outboundByHostOverrides).length > 0 || this.allowedHostsOverride !== void 0 || this.deniedHostsOverride !== void 0;
  }
  shouldInterceptAllOutbound() {
    return this.hasInterceptAllRegistration || this.needsCatchAllInterception() || this.effectiveAllowedHosts !== void 0 || this.effectiveDeniedHosts !== void 0 || this.hasMutableOutboundConfiguration();
  }
  getStaticOutboundByHostKeys() {
    const ctor = this.constructor;
    return ctor.outboundByHost ? Object.keys(ctor.outboundByHost) : [];
  }
  /**
   * Collects all hostnames that need per-host outbound interception.
   * This path is only used for the narrow optimized case where outbound
   * handling is static and host-specific.
   */
  getHostsToIntercept() {
    const hosts = /* @__PURE__ */ new Set();
    const ctor = this.constructor;
    if (ctor.outboundByHost) {
      for (const hostname of Object.keys(ctor.outboundByHost)) {
        hosts.add(hostname);
      }
    }
    for (const hostname of Object.keys(this.outboundByHostOverrides)) {
      hosts.add(hostname);
    }
    return [...hosts];
  }
  async refreshOutboundInterception() {
    if (!this.usingInterception) {
      return;
    }
    this.applyOutboundInterceptionPromise = this.applyOutboundInterception();
    await this.applyOutboundInterceptionPromise;
  }
  /**
   * Applies (or re-applies) outbound HTTP interception with the current
   * default registries + runtime overrides passed through ContainerProxy props.
   *
   * Uses per-host interception only for static host-specific outbound handlers.
   * As soon as the config needs to evaluate all hosts (catch-all outbound,
   * allow/deny lists, or runtime-mutated outbound config), we promote the
   * container to intercept-all and keep it there until the instance restarts.
   *
   * When `interceptHttps` is enabled, also applies HTTPS interception:
   * - Intercept-all mode: `interceptOutboundHttps('*', ...)` for all HTTPS traffic
   * - Per-host mode: `interceptOutboundHttps(host, ...)` for each known host
   */
  async applyOutboundInterception() {
    const ctx = this.ctx;
    if (ctx.exports === void 0) {
      throw new Error("ctx.exports is undefined, please try to update your compatibility date or export ContainerProxy from the containers package in your worker entrypoint");
    }
    if (ctx.exports.ContainerProxy === void 0) {
      throw new Error("ctx.exports.ContainerProxy is undefined, export ContainerProxy from the containers package in your worker entrypoint");
    }
    const interceptAll = this.shouldInterceptAllOutbound();
    if (interceptAll) {
      this.hasInterceptAllRegistration = interceptAll;
    }
    const outboundConfiguration = this.getOutboundConfiguration();
    this.persistOutboundConfiguration(outboundConfiguration);
    const hosts = this.getHostsToIntercept();
    const props = {
      enableInternet: this.enableInternet,
      containerId: this.ctx.id.toString(),
      className: this.constructor.name,
      outboundByHostOverrides: outboundConfiguration.outboundByHostOverrides,
      outboundHandlerOverride: outboundConfiguration.outboundHandlerOverride,
      allowedHosts: outboundConfiguration.allowedHosts,
      deniedHosts: outboundConfiguration.deniedHosts,
      interceptAll
    };
    const fetcher = ctx.exports.ContainerProxy({
      props
    });
    if (interceptAll) {
      for (const host of this.getStaticOutboundByHostKeys()) {
        await this.container.interceptOutboundHttp(host, fetcher);
        if (this.interceptHttps) {
          await this.container.interceptOutboundHttps(host, fetcher);
        }
      }
      if (this.interceptHttps) {
        await this.container.interceptOutboundHttps("*", fetcher);
      }
      await this.container.interceptAllOutboundHttp(fetcher);
    } else {
      for (const host of hosts) {
        await this.container.interceptOutboundHttp(host, fetcher);
        if (this.interceptHttps) {
          await this.container.interceptOutboundHttps(host, fetcher);
        }
      }
    }
  }
  /**
   * Execute SQL queries against the Container's database
   */
  sql(strings, ...values) {
    const query = strings.reduce((acc, str, i) => acc + str + (i < values.length ? "?" : ""), "");
    return [...this.ctx.storage.sql.exec(query, ...values)];
  }
  requestAndPortFromContainerFetchArgs(requestOrUrl, portOrInit, portParam) {
    let request;
    let port;
    if (requestOrUrl instanceof Request) {
      request = requestOrUrl;
      port = typeof portOrInit === "number" ? portOrInit : void 0;
    } else {
      const url = typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.toString();
      const init = typeof portOrInit === "number" ? {} : portOrInit || {};
      port = typeof portOrInit === "number" ? portOrInit : typeof portParam === "number" ? portParam : void 0;
      request = new Request(url, init);
    }
    port ??= this.defaultPort;
    if (port === void 0) {
      throw new Error("No port specified for container fetch. Set defaultPort or specify a port parameter.");
    }
    return { request, port };
  }
  /**
   *
   * The method prioritizes port sources in this order:
   * 1. Ports specified directly in the method call
   * 2. `requiredPorts` class property (if set)
   * 3. `defaultPort` (if neither of the above is specified)
   * 4. Falls back to port 33 if none of the above are set
   */
  async getPortsToCheck(overridePorts) {
    if (overridePorts !== void 0) {
      return Array.isArray(overridePorts) ? overridePorts : [overridePorts];
    }
    if (this.requiredPorts && this.requiredPorts.length > 0) {
      return [...this.requiredPorts];
    }
    return [this.defaultPort ?? FALLBACK_PORT_TO_CHECK];
  }
  // ===========================================
  //     CONTAINER INTERACTION & MONITORING
  // ===========================================
  /**
   * Tries to start a container if it's not already running
   * Returns the number of tries used
   */
  async startContainerIfNotRunning(waitOptions, options) {
    if (this.startInFlight) {
      return this.startInFlight;
    }
    if (this.container.running) {
      if (!this.monitor) {
        this.monitor = this.container.monitor();
      }
      return 0;
    }
    const startPromise = this.doStartContainer(waitOptions, options);
    this.startInFlight = startPromise;
    try {
      return await startPromise;
    } finally {
      if (this.startInFlight === startPromise) {
        this.startInFlight = void 0;
      }
    }
  }
  async doStartContainer(waitOptions, options) {
    const abortedSignal = new Promise((res) => {
      waitOptions.signal?.addEventListener("abort", () => {
        res(true);
      });
    });
    const pollInterval = waitOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    const totalTries = waitOptions.retries ?? Math.ceil(TIMEOUT_TO_GET_CONTAINER_MS / pollInterval);
    for (let tries = 0; tries < totalTries; tries++) {
      const envVars = options?.envVars ?? this.envVars;
      const entrypoint = options?.entrypoint ?? this.entrypoint;
      const enableInternet = options?.enableInternet ?? this.enableInternet;
      const labels = options?.labels ?? this.labels;
      const startConfig = {
        enableInternet
      };
      if (envVars && Object.keys(envVars).length > 0)
        startConfig.env = envVars;
      if (entrypoint)
        startConfig.entrypoint = entrypoint;
      if (labels && Object.keys(labels).length > 0)
        startConfig.labels = labels;
      this.renewActivityTimeout();
      const handleError = /* @__PURE__ */ __name(async () => {
        const err = await this.monitor?.catch((err2) => err2);
        if (typeof err === "number") {
          const toThrow = new Error(`Container exited before we could determine the container health, exit code: ${err}`);
          await this.state.setStoppedWithCode(err);
          this.monitor = void 0;
          try {
            await this.onError(toThrow);
          } catch {
          }
          throw toThrow;
        } else if (!isNoInstanceError(err)) {
          await this.state.setStopped();
          this.monitor = void 0;
          try {
            await this.onError(err);
          } catch {
          }
          throw err;
        }
      }, "handleError");
      if (tries > 0 && !this.container.running) {
        await handleError();
      }
      await this.scheduleNextAlarm();
      if (!this.container.running) {
        await this.refreshOutboundInterception();
        this.container.start(startConfig);
        this.monitor = this.container.monitor();
        await this.state.setRunning();
      } else {
        await this.scheduleNextAlarm();
      }
      this.renewActivityTimeout();
      const port = this.container.getTcpPort(waitOptions.portToCheck);
      try {
        const combinedSignal = addTimeoutSignal(waitOptions.signal, PING_TIMEOUT_MS);
        await port.fetch("http://containerstarthealthcheck", { signal: combinedSignal });
        return tries;
      } catch (error) {
        if (isNotListeningError(error) && this.container.running) {
          return tries;
        }
        if (!this.container.running && isNotListeningError(error)) {
          await handleError();
        }
        await Promise.any([
          new Promise((res) => setTimeout(res, waitOptions.waitInterval)),
          abortedSignal
        ]);
        if (waitOptions.signal?.aborted) {
          throw new Error("Aborted waiting for container to start as we received a cancellation signal", { cause: error });
        }
        if (totalTries === tries + 1) {
          if (error instanceof Error && error.message.includes("Network connection lost")) {
            this.ctx.abort();
          }
          await handleError();
          await this.state.setStopped();
          this.monitor = void 0;
          throw new Error(NO_CONTAINER_INSTANCE_ERROR, { cause: error });
        }
        continue;
      }
    }
    throw new Error(`Container did not start after ${totalTries * pollInterval}ms`);
  }
  setupMonitorCallbacks() {
    const monitor = this.monitor;
    if (!monitor || this.monitoredPromise === monitor) {
      return;
    }
    this.monitoredPromise = monitor;
    monitor.then(async () => {
      await this.ctx.blockConcurrencyWhile(async () => {
        if (this.monitor === monitor) {
          await this.state.setStoppedWithCode(0);
        }
      });
    }).catch(async (error) => {
      if (this.monitor !== monitor) {
        return;
      }
      if (isNoInstanceError(error)) {
        await this.ctx.blockConcurrencyWhile(async () => {
          if (this.monitor === monitor) {
            await this.state.setStopped();
          }
        });
        return;
      }
      const exitCode = getExitCodeFromError(error);
      if (exitCode !== null) {
        await this.ctx.blockConcurrencyWhile(async () => {
          if (this.monitor === monitor) {
            await this.state.setStoppedWithCode(exitCode);
          }
        });
        return;
      }
      await this.ctx.blockConcurrencyWhile(async () => {
        if (this.monitor === monitor) {
          await this.state.setStopped();
        }
      });
      if (this.monitor !== monitor) {
        return;
      }
      try {
        await this.onError(error);
      } catch {
      }
    }).finally(() => {
      if (this.monitor !== monitor) {
        return;
      }
      this.monitoredPromise = void 0;
      this.monitor = void 0;
      if (this.timeout) {
        if (this.resolve)
          this.resolve();
        clearTimeout(this.timeout);
      }
    });
  }
  deleteSchedules(name) {
    this.sql`DELETE FROM container_schedules WHERE callback = ${name}`;
  }
  // ============================
  //     ALARMS AND SCHEDULES
  // ============================
  /**
   * Method called when an alarm fires
   * Executes any scheduled tasks that are due
   */
  async alarm(alarmProps) {
    if (alarmProps !== void 0 && alarmProps.isRetry && alarmProps.retryCount > MAX_ALARM_RETRIES) {
      const scheduleCount = Number(this.sql`SELECT COUNT(*) as count FROM container_schedules`[0]?.count) || 0;
      const hasScheduledTasks = scheduleCount > 0;
      if (hasScheduledTasks || this.container.running) {
        await this.scheduleNextAlarm();
      }
      return;
    }
    const prevAlarm = Date.now();
    await this.ctx.storage.setAlarm(prevAlarm);
    await this.ctx.storage.sync();
    const result = this.sql`
         SELECT * FROM container_schedules;
       `;
    let minTime = Date.now() + 3 * 60 * 1e3;
    const now = Date.now() / 1e3;
    for (const row of result) {
      if (row.time > now) {
        continue;
      }
      const callback = this[row.callback];
      if (!callback || typeof callback !== "function") {
        console.error(`Callback ${row.callback} not found or is not a function`);
        continue;
      }
      const schedule = this.getSchedule(row.id);
      try {
        const payload = row.payload ? JSON.parse(row.payload) : void 0;
        await callback.call(this, payload, await schedule);
      } catch (e) {
        console.error(`Error executing scheduled callback "${row.callback}":`, e);
      }
      this.sql`DELETE FROM container_schedules WHERE id = ${row.id}`;
    }
    const resultForMinTime = this.sql`
         SELECT * FROM container_schedules;
       `;
    const minTimeFromSchedules = Math.min(...resultForMinTime.map((r) => r.time * 1e3));
    if (!this.container.running) {
      await this.syncPendingStoppedEvents();
      if (resultForMinTime.length == 0) {
        await this.ctx.storage.deleteAlarm();
      } else {
        await this.ctx.storage.setAlarm(minTimeFromSchedules);
      }
      return;
    }
    if (this.isActivityExpired()) {
      await this.onActivityExpired();
      this.renewActivityTimeout();
      return;
    }
    minTime = Math.min(minTimeFromSchedules, minTime, this.sleepAfterMs);
    const timeout = Math.max(0, minTime - Date.now());
    await new Promise((resolve) => {
      this.resolve = resolve;
      if (!this.container.running) {
        resolve();
        return;
      }
      this.timeout = setTimeout(() => {
        resolve();
      }, timeout);
    });
    await this.ctx.storage.setAlarm(Date.now());
  }
  timeout;
  resolve;
  // synchronises container state with the container source of truth to process events
  async syncPendingStoppedEvents() {
    const state = await this.state.getState();
    if (!this.container.running && (state.status === "healthy" || state.status === "running")) {
      await this.callOnStop({ exitCode: 0, reason: "exit" }, state);
      return;
    }
    if (!this.container.running && state.status === "stopped_with_code") {
      await this.callOnStop({ exitCode: state.exitCode ?? 0, reason: "exit" }, state);
      return;
    }
  }
  async callOnStop(onStopParams, stateBeforeOnStop) {
    if (this.onStopCalled) {
      return;
    }
    this.onStopCalled = true;
    const promise = this.onStop(onStopParams);
    if (promise instanceof Promise) {
      await promise.finally(() => {
        this.onStopCalled = false;
      });
    } else {
      this.onStopCalled = false;
    }
    await this.state.setStoppedIfUnchanged(stateBeforeOnStop);
  }
  /**
   * Schedule the next alarm based on upcoming tasks
   */
  async scheduleNextAlarm(ms = 1e3) {
    const nextTime = ms + Date.now();
    if (this.timeout) {
      if (this.resolve)
        this.resolve();
      clearTimeout(this.timeout);
    }
    await this.ctx.storage.setAlarm(nextTime);
    await this.ctx.storage.sync();
  }
  async listSchedules(name) {
    const result = this.sql`
      SELECT * FROM container_schedules WHERE callback = ${name} LIMIT 1
    `;
    if (!result || result.length === 0) {
      return [];
    }
    return result.map(this.toSchedule);
  }
  toSchedule(schedule) {
    let payload;
    try {
      payload = JSON.parse(schedule.payload);
    } catch (e) {
      console.error(`Error parsing payload for schedule ${schedule.id}:`, e);
      payload = void 0;
    }
    if (schedule.type === "delayed") {
      return {
        taskId: schedule.id,
        callback: schedule.callback,
        payload,
        type: "delayed",
        time: schedule.time,
        delayInSeconds: schedule.delayInSeconds
      };
    }
    return {
      taskId: schedule.id,
      callback: schedule.callback,
      payload,
      type: "scheduled",
      time: schedule.time
    };
  }
  /**
   * Get a scheduled task by ID
   * @template T Type of the payload data
   * @param id ID of the scheduled task
   * @returns The Schedule object or undefined if not found
   */
  async getSchedule(id) {
    const result = this.sql`
      SELECT * FROM container_schedules WHERE id = ${id} LIMIT 1
    `;
    if (!result || result.length === 0) {
      return void 0;
    }
    const schedule = result[0];
    return this.toSchedule(schedule);
  }
  isActivityExpired() {
    if (this.inflightRequests > 0) {
      this.renewActivityTimeout();
      return false;
    }
    return this.sleepAfterMs <= Date.now();
  }
};

// ../node_modules/@cloudflare/containers/dist/lib/utils.js
var singletonContainerId = "cf-singleton-container";
function getContainer(binding, name = singletonContainerId) {
  const objectId = binding.idFromName(name);
  return binding.get(objectId);
}
__name(getContainer, "getContainer");
function switchPort(request, port) {
  const headers = new Headers(request.headers);
  headers.set("cf-container-target-port", port.toString());
  return new Request(request, { headers });
}
__name(switchPort, "switchPort");

// ../node_modules/aws4fetch/dist/aws4fetch.esm.mjs
var encoder = new TextEncoder();
var HOST_SERVICES = {
  appstream2: "appstream",
  cloudhsmv2: "cloudhsm",
  email: "ses",
  marketplace: "aws-marketplace",
  mobile: "AWSMobileHubService",
  pinpoint: "mobiletargeting",
  queue: "sqs",
  "git-codecommit": "codecommit",
  "mturk-requester-sandbox": "mturk-requester",
  "personalize-runtime": "personalize"
};
var UNSIGNABLE_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "content-type",
  "content-length",
  "user-agent",
  "presigned-expires",
  "expect",
  "x-amzn-trace-id",
  "range",
  "connection"
]);
var AwsClient = class {
  static {
    __name(this, "AwsClient");
  }
  constructor({ accessKeyId, secretAccessKey, sessionToken, service, region, cache, retries, initRetryMs }) {
    if (accessKeyId == null) throw new TypeError("accessKeyId is a required option");
    if (secretAccessKey == null) throw new TypeError("secretAccessKey is a required option");
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    this.service = service;
    this.region = region;
    this.cache = cache || /* @__PURE__ */ new Map();
    this.retries = retries != null ? retries : 10;
    this.initRetryMs = initRetryMs || 50;
  }
  async sign(input, init) {
    if (input instanceof Request) {
      const { method, url, headers, body } = input;
      init = Object.assign({ method, url, headers }, init);
      if (init.body == null && headers.has("Content-Type")) {
        init.body = body != null && headers.has("X-Amz-Content-Sha256") ? body : await input.clone().arrayBuffer();
      }
      input = url;
    }
    const signer = new AwsV4Signer(Object.assign({ url: input.toString() }, init, this, init && init.aws));
    const signed = Object.assign({}, init, await signer.sign());
    delete signed.aws;
    try {
      return new Request(signed.url.toString(), signed);
    } catch (e) {
      if (e instanceof TypeError) {
        return new Request(signed.url.toString(), Object.assign({ duplex: "half" }, signed));
      }
      throw e;
    }
  }
  async fetch(input, init) {
    for (let i = 0; i <= this.retries; i++) {
      const fetched = fetch(await this.sign(input, init));
      if (i === this.retries) {
        return fetched;
      }
      const res = await fetched;
      if (res.status < 500 && res.status !== 429) {
        return res;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.random() * this.initRetryMs * Math.pow(2, i)));
    }
    throw new Error("An unknown error occurred, ensure retries is not negative");
  }
};
var AwsV4Signer = class {
  static {
    __name(this, "AwsV4Signer");
  }
  constructor({ method, url, headers, body, accessKeyId, secretAccessKey, sessionToken, service, region, cache, datetime, signQuery, appendSessionToken, allHeaders, singleEncode }) {
    if (url == null) throw new TypeError("url is a required option");
    if (accessKeyId == null) throw new TypeError("accessKeyId is a required option");
    if (secretAccessKey == null) throw new TypeError("secretAccessKey is a required option");
    this.method = method || (body ? "POST" : "GET");
    this.url = new URL(url);
    this.headers = new Headers(headers || {});
    this.body = body;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    let guessedService, guessedRegion;
    if (!service || !region) {
      [guessedService, guessedRegion] = guessServiceRegion(this.url, this.headers);
    }
    this.service = service || guessedService || "";
    this.region = region || guessedRegion || "us-east-1";
    this.cache = cache || /* @__PURE__ */ new Map();
    this.datetime = datetime || (/* @__PURE__ */ new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
    this.signQuery = signQuery;
    this.appendSessionToken = appendSessionToken || this.service === "iotdevicegateway";
    this.headers.delete("Host");
    if (this.service === "s3" && !this.signQuery && !this.headers.has("X-Amz-Content-Sha256")) {
      this.headers.set("X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD");
    }
    const params = this.signQuery ? this.url.searchParams : this.headers;
    params.set("X-Amz-Date", this.datetime);
    if (this.sessionToken && !this.appendSessionToken) {
      params.set("X-Amz-Security-Token", this.sessionToken);
    }
    this.signableHeaders = ["host", ...this.headers.keys()].filter((header) => allHeaders || !UNSIGNABLE_HEADERS.has(header)).sort();
    this.signedHeaders = this.signableHeaders.join(";");
    this.canonicalHeaders = this.signableHeaders.map((header) => header + ":" + (header === "host" ? this.url.host : (this.headers.get(header) || "").replace(/\s+/g, " "))).join("\n");
    this.credentialString = [this.datetime.slice(0, 8), this.region, this.service, "aws4_request"].join("/");
    if (this.signQuery) {
      if (this.service === "s3" && !params.has("X-Amz-Expires")) {
        params.set("X-Amz-Expires", "86400");
      }
      params.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
      params.set("X-Amz-Credential", this.accessKeyId + "/" + this.credentialString);
      params.set("X-Amz-SignedHeaders", this.signedHeaders);
    }
    if (this.service === "s3") {
      try {
        this.encodedPath = decodeURIComponent(this.url.pathname.replace(/\+/g, " "));
      } catch (e) {
        this.encodedPath = this.url.pathname;
      }
    } else {
      this.encodedPath = this.url.pathname.replace(/\/+/g, "/");
    }
    if (!singleEncode) {
      this.encodedPath = encodeURIComponent(this.encodedPath).replace(/%2F/g, "/");
    }
    this.encodedPath = encodeRfc3986(this.encodedPath);
    const seenKeys = /* @__PURE__ */ new Set();
    this.encodedSearch = [...this.url.searchParams].filter(([k]) => {
      if (!k) return false;
      if (this.service === "s3") {
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);
      }
      return true;
    }).map((pair) => pair.map((p) => encodeRfc3986(encodeURIComponent(p)))).sort(([k1, v1], [k2, v2]) => k1 < k2 ? -1 : k1 > k2 ? 1 : v1 < v2 ? -1 : v1 > v2 ? 1 : 0).map((pair) => pair.join("=")).join("&");
  }
  async sign() {
    if (this.signQuery) {
      this.url.searchParams.set("X-Amz-Signature", await this.signature());
      if (this.sessionToken && this.appendSessionToken) {
        this.url.searchParams.set("X-Amz-Security-Token", this.sessionToken);
      }
    } else {
      this.headers.set("Authorization", await this.authHeader());
    }
    return {
      method: this.method,
      url: this.url,
      headers: this.headers,
      body: this.body
    };
  }
  async authHeader() {
    return [
      "AWS4-HMAC-SHA256 Credential=" + this.accessKeyId + "/" + this.credentialString,
      "SignedHeaders=" + this.signedHeaders,
      "Signature=" + await this.signature()
    ].join(", ");
  }
  async signature() {
    const date = this.datetime.slice(0, 8);
    const cacheKey = [this.secretAccessKey, date, this.region, this.service].join();
    let kCredentials = this.cache.get(cacheKey);
    if (!kCredentials) {
      const kDate = await hmac("AWS4" + this.secretAccessKey, date);
      const kRegion = await hmac(kDate, this.region);
      const kService = await hmac(kRegion, this.service);
      kCredentials = await hmac(kService, "aws4_request");
      this.cache.set(cacheKey, kCredentials);
    }
    return buf2hex(await hmac(kCredentials, await this.stringToSign()));
  }
  async stringToSign() {
    return [
      "AWS4-HMAC-SHA256",
      this.datetime,
      this.credentialString,
      buf2hex(await hash(await this.canonicalString()))
    ].join("\n");
  }
  async canonicalString() {
    return [
      this.method.toUpperCase(),
      this.encodedPath,
      this.encodedSearch,
      this.canonicalHeaders + "\n",
      this.signedHeaders,
      await this.hexBodyHash()
    ].join("\n");
  }
  async hexBodyHash() {
    let hashHeader = this.headers.get("X-Amz-Content-Sha256") || (this.service === "s3" && this.signQuery ? "UNSIGNED-PAYLOAD" : null);
    if (hashHeader == null) {
      if (this.body && typeof this.body !== "string" && !("byteLength" in this.body)) {
        throw new Error("body must be a string, ArrayBuffer or ArrayBufferView, unless you include the X-Amz-Content-Sha256 header");
      }
      hashHeader = buf2hex(await hash(this.body || ""));
    }
    return hashHeader;
  }
};
async function hmac(key, string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder.encode(key) : key,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(string));
}
__name(hmac, "hmac");
async function hash(content) {
  return crypto.subtle.digest("SHA-256", typeof content === "string" ? encoder.encode(content) : content);
}
__name(hash, "hash");
var HEX_CHARS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];
function buf2hex(arrayBuffer) {
  const buffer = new Uint8Array(arrayBuffer);
  let out = "";
  for (let idx = 0; idx < buffer.length; idx++) {
    const n = buffer[idx];
    out += HEX_CHARS[n >>> 4 & 15];
    out += HEX_CHARS[n & 15];
  }
  return out;
}
__name(buf2hex, "buf2hex");
function encodeRfc3986(urlEncodedStr) {
  return urlEncodedStr.replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
__name(encodeRfc3986, "encodeRfc3986");
function guessServiceRegion(url, headers) {
  const { hostname, pathname } = url;
  if (hostname.endsWith(".on.aws")) {
    const match2 = hostname.match(/^[^.]{1,63}\.lambda-url\.([^.]{1,63})\.on\.aws$/);
    return match2 != null ? ["lambda", match2[1] || ""] : ["", ""];
  }
  if (hostname.endsWith(".r2.cloudflarestorage.com")) {
    return ["s3", "auto"];
  }
  if (hostname.endsWith(".backblazeb2.com")) {
    const match2 = hostname.match(/^(?:[^.]{1,63}\.)?s3\.([^.]{1,63})\.backblazeb2\.com$/);
    return match2 != null ? ["s3", match2[1] || ""] : ["", ""];
  }
  const match = hostname.replace("dualstack.", "").match(/([^.]{1,63})\.(?:([^.]{0,63})\.)?amazonaws\.com(?:\.cn)?$/);
  let service = match && match[1] || "";
  let region = match && match[2];
  if (region === "us-gov") {
    region = "us-gov-west-1";
  } else if (region === "s3" || region === "s3-accelerate") {
    region = "us-east-1";
    service = "s3";
  } else if (service === "iot") {
    if (hostname.startsWith("iot.")) {
      service = "execute-api";
    } else if (hostname.startsWith("data.jobs.iot.")) {
      service = "iot-jobs-data";
    } else {
      service = pathname === "/mqtt" ? "iotdevicegateway" : "iotdata";
    }
  } else if (service === "autoscaling") {
    const targetPrefix = (headers.get("X-Amz-Target") || "").split(".")[0];
    if (targetPrefix === "AnyScaleFrontendService") {
      service = "application-autoscaling";
    } else if (targetPrefix === "AnyScaleScalingPlannerFrontendService") {
      service = "autoscaling-plans";
    }
  } else if (region == null && service.startsWith("s3-")) {
    region = service.slice(3).replace(/^fips-|^external-1/, "");
    service = "s3";
  } else if (service.endsWith("-fips")) {
    service = service.slice(0, -5);
  } else if (region && /-\d$/.test(service) && !/-\d$/.test(region)) {
    [service, region] = [region, service];
  }
  return [HOST_SERVICES[service] || service, region || ""];
}
__name(guessServiceRegion, "guessServiceRegion");

// ../node_modules/capnweb/dist/index-workers.js
import * as cfw from "cloudflare:workers";
var WORKERS_MODULE_SYMBOL = /* @__PURE__ */ Symbol("workers-module");
globalThis[WORKERS_MODULE_SYMBOL] = cfw;
if (!Symbol.dispose) {
  Symbol.dispose = /* @__PURE__ */ Symbol.for("dispose");
}
if (!Symbol.asyncDispose) {
  Symbol.asyncDispose = /* @__PURE__ */ Symbol.for("asyncDispose");
}
if (!Promise.withResolvers) {
  Promise.withResolvers = function() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
var workersModule = globalThis[WORKERS_MODULE_SYMBOL];
var RpcTarget = workersModule ? workersModule.RpcTarget : class {
};
var AsyncFunction = (async function() {
}).constructor;
var BUFFER_PROTOTYPE = typeof Buffer !== "undefined" ? Buffer.prototype : void 0;
function typeForRpc(value) {
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return "primitive";
    case "undefined":
      return "undefined";
    case "object":
    case "function":
      break;
    case "bigint":
      return "bigint";
    default:
      return "unsupported";
  }
  if (value === null) {
    return "primitive";
  }
  let prototype = Object.getPrototypeOf(value);
  switch (prototype) {
    case Object.prototype:
      return "object";
    case Function.prototype:
    case AsyncFunction.prototype:
      return "function";
    case Array.prototype:
      return "array";
    case Date.prototype:
      return "date";
    case Uint8Array.prototype:
    case BUFFER_PROTOTYPE:
      return "bytes";
    case WritableStream.prototype:
      return "writable";
    case ReadableStream.prototype:
      return "readable";
    case Headers.prototype:
      return "headers";
    case Request.prototype:
      return "request";
    case Response.prototype:
      return "response";
    case Blob.prototype:
      return "blob";
    // TODO: All other structured clone types.
    case RpcStub.prototype:
      return "stub";
    case RpcPromise.prototype:
      return "rpc-promise";
    // TODO: Promise<T> or thenable
    default:
      if (workersModule) {
        if (prototype == workersModule.RpcStub.prototype || value instanceof workersModule.ServiceStub) {
          return "rpc-target";
        } else if (prototype == workersModule.RpcPromise.prototype || prototype == workersModule.RpcProperty.prototype) {
          return "rpc-thenable";
        }
      }
      if (value instanceof RpcTarget) {
        return "rpc-target";
      }
      if (value instanceof Error) {
        return "error";
      }
      return "unsupported";
  }
}
__name(typeForRpc, "typeForRpc");
function mapNotLoaded() {
  throw new Error("RPC map() implementation was not loaded.");
}
__name(mapNotLoaded, "mapNotLoaded");
var mapImpl = { applyMap: mapNotLoaded, sendMap: mapNotLoaded };
function streamNotLoaded() {
  throw new Error("Stream implementation was not loaded.");
}
__name(streamNotLoaded, "streamNotLoaded");
var streamImpl = {
  createWritableStreamHook: streamNotLoaded,
  createWritableStreamFromHook: streamNotLoaded,
  createReadableStreamHook: streamNotLoaded
};
var StubHook = class {
  static {
    __name(this, "StubHook");
  }
  // Like call(), but designed for streaming calls (e.g. WritableStream writes). Returns:
  // - promise: A Promise<void> for the completion of the call.
  // - size: If the call was remote, the byte size of the serialized message. For local calls,
  //   undefined is returned, indicating the caller should await the promise to serialize writes
  //   (no overlapping).
  stream(path2, args) {
    let hook = this.call(path2, args);
    let pulled = hook.pull();
    let promise;
    if (pulled instanceof Promise) {
      promise = pulled.then((p) => {
        p.dispose();
      });
    } else {
      pulled.dispose();
      promise = Promise.resolve();
    }
    return { promise };
  }
};
var ErrorStubHook = class extends StubHook {
  static {
    __name(this, "ErrorStubHook");
  }
  constructor(error) {
    super();
    this.error = error;
  }
  call(path2, args) {
    return this;
  }
  map(path2, captures, instructions) {
    return this;
  }
  get(path2) {
    return this;
  }
  dup() {
    return this;
  }
  pull() {
    return Promise.reject(this.error);
  }
  ignoreUnhandledRejections() {
  }
  dispose() {
  }
  onBroken(callback) {
    try {
      callback(this.error);
    } catch (err) {
      Promise.resolve(err);
    }
  }
};
var DISPOSED_HOOK = new ErrorStubHook(
  new Error("Attempted to use RPC stub after it has been disposed.")
);
var doCall = /* @__PURE__ */ __name((hook, path2, params) => {
  return hook.call(path2, params);
}, "doCall");
function withCallInterceptor(interceptor, callback) {
  let oldValue = doCall;
  doCall = interceptor;
  try {
    return callback();
  } finally {
    doCall = oldValue;
  }
}
__name(withCallInterceptor, "withCallInterceptor");
var RAW_STUB = /* @__PURE__ */ Symbol("realStub");
var PROXY_HANDLERS = {
  apply(target, thisArg, argumentsList) {
    let stub = target.raw;
    return new RpcPromise(doCall(
      stub.hook,
      stub.pathIfPromise || [],
      RpcPayload.fromAppParams(argumentsList)
    ), []);
  },
  get(target, prop, receiver) {
    let stub = target.raw;
    if (prop === RAW_STUB) {
      return stub;
    } else if (prop in RpcPromise.prototype) {
      return stub[prop];
    } else if (typeof prop === "string") {
      return new RpcPromise(
        stub.hook,
        stub.pathIfPromise ? [...stub.pathIfPromise, prop] : [prop]
      );
    } else if (prop === Symbol.dispose && (!stub.pathIfPromise || stub.pathIfPromise.length == 0)) {
      return () => {
        stub.hook.dispose();
        stub.hook = DISPOSED_HOOK;
      };
    } else {
      return void 0;
    }
  },
  has(target, prop) {
    let stub = target.raw;
    if (prop === RAW_STUB) {
      return true;
    } else if (prop in RpcPromise.prototype) {
      return prop in stub;
    } else if (typeof prop === "string") {
      return true;
    } else if (prop === Symbol.dispose && (!stub.pathIfPromise || stub.pathIfPromise.length == 0)) {
      return true;
    } else {
      return false;
    }
  },
  construct(target, args) {
    throw new Error("An RPC stub cannot be used as a constructor.");
  },
  defineProperty(target, property, attributes) {
    throw new Error("Can't define properties on RPC stubs.");
  },
  deleteProperty(target, p) {
    throw new Error("Can't delete properties on RPC stubs.");
  },
  getOwnPropertyDescriptor(target, p) {
    return void 0;
  },
  getPrototypeOf(target) {
    return Object.getPrototypeOf(target.raw);
  },
  isExtensible(target) {
    return false;
  },
  ownKeys(target) {
    return [];
  },
  preventExtensions(target) {
    return true;
  },
  set(target, p, newValue, receiver) {
    throw new Error("Can't assign properties on RPC stubs.");
  },
  setPrototypeOf(target, v) {
    throw new Error("Can't override prototype of RPC stubs.");
  }
};
var RpcStub = class _RpcStub extends RpcTarget {
  static {
    __name(this, "_RpcStub");
  }
  // Although `hook` and `path` are declared `public` here, they are effectively hidden by the
  // proxy.
  constructor(hook, pathIfPromise) {
    super();
    if (!(hook instanceof StubHook)) {
      let value = hook;
      if (value instanceof RpcTarget || value instanceof Function) {
        hook = TargetStubHook.create(value, void 0);
      } else {
        hook = new PayloadStubHook(RpcPayload.fromAppReturn(value));
      }
      if (pathIfPromise) {
        throw new TypeError("RpcStub constructor expected one argument, received two.");
      }
    }
    this.hook = hook;
    this.pathIfPromise = pathIfPromise;
    let func = /* @__PURE__ */ __name(() => {
    }, "func");
    func.raw = this;
    return new Proxy(func, PROXY_HANDLERS);
  }
  hook;
  pathIfPromise;
  dup() {
    let target = this[RAW_STUB];
    if (target.pathIfPromise) {
      return new _RpcStub(target.hook.get(target.pathIfPromise));
    } else {
      return new _RpcStub(target.hook.dup());
    }
  }
  onRpcBroken(callback) {
    this[RAW_STUB].hook.onBroken(callback);
  }
  map(func) {
    let { hook, pathIfPromise } = this[RAW_STUB];
    return mapImpl.sendMap(hook, pathIfPromise || [], func);
  }
  toString() {
    return "[object RpcStub]";
  }
};
var RpcPromise = class extends RpcStub {
  static {
    __name(this, "RpcPromise");
  }
  // TODO: Support passing target value or promise to constructor.
  constructor(hook, pathIfPromise) {
    super(hook, pathIfPromise);
  }
  then(onfulfilled, onrejected) {
    return pullPromise(this).then(...arguments);
  }
  catch(onrejected) {
    return pullPromise(this).catch(...arguments);
  }
  finally(onfinally) {
    return pullPromise(this).finally(...arguments);
  }
  toString() {
    return "[object RpcPromise]";
  }
};
function unwrapStubTakingOwnership(stub) {
  let { hook, pathIfPromise } = stub[RAW_STUB];
  if (pathIfPromise && pathIfPromise.length > 0) {
    return hook.get(pathIfPromise);
  } else {
    return hook;
  }
}
__name(unwrapStubTakingOwnership, "unwrapStubTakingOwnership");
function unwrapStubAndDup(stub) {
  let { hook, pathIfPromise } = stub[RAW_STUB];
  if (pathIfPromise) {
    return hook.get(pathIfPromise);
  } else {
    return hook.dup();
  }
}
__name(unwrapStubAndDup, "unwrapStubAndDup");
function unwrapStubNoProperties(stub) {
  let { hook, pathIfPromise } = stub[RAW_STUB];
  if (pathIfPromise && pathIfPromise.length > 0) {
    return void 0;
  }
  return hook;
}
__name(unwrapStubNoProperties, "unwrapStubNoProperties");
function unwrapStubOrParent(stub) {
  return stub[RAW_STUB].hook;
}
__name(unwrapStubOrParent, "unwrapStubOrParent");
function unwrapStubAndPath(stub) {
  return stub[RAW_STUB];
}
__name(unwrapStubAndPath, "unwrapStubAndPath");
async function pullPromise(promise) {
  let { hook, pathIfPromise } = promise[RAW_STUB];
  if (pathIfPromise.length > 0) {
    hook = hook.get(pathIfPromise);
  }
  let payload = await hook.pull();
  return payload.deliverResolve();
}
__name(pullPromise, "pullPromise");
var RpcPayload = class _RpcPayload {
  static {
    __name(this, "_RpcPayload");
  }
  // Private constructor; use factory functions above to construct.
  constructor(value, source, hooks, promises) {
    this.value = value;
    this.source = source;
    this.hooks = hooks;
    this.promises = promises;
  }
  // Create a payload from a value passed as params to an RPC from the app.
  //
  // The payload does NOT take ownership of any stubs in `value`, and but promises not to modify
  // `value`. If the payload is delivered locally, `value` will be deep-copied first, so as not
  // to have the sender and recipient end up sharing the same mutable object. `value` will not be
  // touched again after the call returns synchronously (returns a promise) -- by that point,
  // the value has either been copied or serialized to the wire.
  static fromAppParams(value) {
    return new _RpcPayload(value, "params");
  }
  // Create a payload from a value return from an RPC implementation by the app.
  //
  // Unlike fromAppParams(), in this case the payload takes ownership of all stubs in `value`, and
  // may hold onto `value` for an arbitrarily long time (e.g. to serve pipelined requests). It
  // will still avoid modifying `value` and will make a deep copy if it is delivered locally.
  static fromAppReturn(value) {
    return new _RpcPayload(value, "return");
  }
  // Combine an array of payloads into a single payload whose value is an array. Ownership of all
  // stubs is transferred from the inputs to the outputs, hence if the output is disposed, the
  // inputs should not be. (In case of exception, nothing is disposed, though.)
  static fromArray(array) {
    let hooks = [];
    let promises = [];
    let resultArray = [];
    for (let payload of array) {
      payload.ensureDeepCopied();
      for (let hook of payload.hooks) {
        hooks.push(hook);
      }
      for (let promise of payload.promises) {
        if (promise.parent === payload) {
          promise = {
            parent: resultArray,
            property: resultArray.length,
            promise: promise.promise
          };
        }
        promises.push(promise);
      }
      resultArray.push(payload.value);
    }
    return new _RpcPayload(resultArray, "owned", hooks, promises);
  }
  // Create a payload from a value parsed off the wire using Evaluator.evaluate().
  //
  // A payload is constructed with a null value and the given hooks and promises arrays. The value
  // is expected to be filled in by the evaluator, and the hooks and promises arrays are expected
  // to be extended with stubs found during parsing. (This weird usage model is necessary so that
  // if the root value turns out to be a promise, its `parent` in `promises` can be the payload
  // object itself.)
  //
  // When done, the payload takes ownership of the final value and all the stubs within. It may
  // modify the value in preparation for delivery, and may deliver the value directly to the app
  // without copying.
  static forEvaluate(hooks, promises) {
    return new _RpcPayload(null, "owned", hooks, promises);
  }
  // Deep-copy the given value, including dup()ing all stubs.
  //
  // If `value` is a function, it should be bound to `oldParent` as its `this`.
  //
  // If deep-copying from a branch of some other RpcPayload, it must be provided, to make sure
  // RpcTargets found within don't get duplicate stubs.
  static deepCopyFrom(value, oldParent, owner) {
    let result = new _RpcPayload(null, "owned", [], []);
    result.value = result.deepCopy(
      value,
      oldParent,
      "value",
      result,
      /*dupStubs=*/
      true,
      owner
    );
    return result;
  }
  // For `source === "return"` payloads only, this tracks any StubHooks created around RpcTargets
  // or WritableStreams found in the payload at the time that it is serialized (or deep-copied) for
  // return, so that we can make sure they are not disposed before the pipeline ends.
  //
  // This is initialized on first use.
  rpcTargets;
  // Get the StubHook representing the given RpcTarget found inside this payload.
  getHookForRpcTarget(target, parent, dupStubs = true) {
    if (this.source === "params") {
      if (dupStubs) {
        let dupable = target;
        if (typeof dupable.dup === "function") {
          target = dupable.dup();
        }
      }
      return TargetStubHook.create(target, parent);
    } else if (this.source === "return") {
      let hook = this.rpcTargets?.get(target);
      if (hook) {
        if (dupStubs) {
          return hook.dup();
        } else {
          this.rpcTargets?.delete(target);
          return hook;
        }
      } else {
        hook = TargetStubHook.create(target, parent);
        if (dupStubs) {
          if (!this.rpcTargets) {
            this.rpcTargets = /* @__PURE__ */ new Map();
          }
          this.rpcTargets.set(target, hook);
          return hook.dup();
        } else {
          return hook;
        }
      }
    } else {
      throw new Error("owned payload shouldn't contain raw RpcTargets");
    }
  }
  // Get the StubHook representing the given WritableStream found inside this payload.
  getHookForWritableStream(stream, parent, dupStubs = true) {
    if (this.source === "params") {
      return streamImpl.createWritableStreamHook(stream);
    } else if (this.source === "return") {
      let hook = this.rpcTargets?.get(stream);
      if (hook) {
        if (dupStubs) {
          return hook.dup();
        } else {
          this.rpcTargets?.delete(stream);
          return hook;
        }
      } else {
        hook = streamImpl.createWritableStreamHook(stream);
        if (dupStubs) {
          if (!this.rpcTargets) {
            this.rpcTargets = /* @__PURE__ */ new Map();
          }
          this.rpcTargets.set(stream, hook);
          return hook.dup();
        } else {
          return hook;
        }
      }
    } else {
      throw new Error("owned payload shouldn't contain raw WritableStreams");
    }
  }
  // Get the StubHook representing the given ReadableStream found inside this payload.
  getHookForReadableStream(stream, parent, dupStubs = true) {
    if (this.source === "params") {
      return streamImpl.createReadableStreamHook(stream);
    } else if (this.source === "return") {
      let hook = this.rpcTargets?.get(stream);
      if (hook) {
        if (dupStubs) {
          return hook.dup();
        } else {
          this.rpcTargets?.delete(stream);
          return hook;
        }
      } else {
        hook = streamImpl.createReadableStreamHook(stream);
        if (dupStubs) {
          if (!this.rpcTargets) {
            this.rpcTargets = /* @__PURE__ */ new Map();
          }
          this.rpcTargets.set(stream, hook);
          return hook.dup();
        } else {
          return hook;
        }
      }
    } else {
      throw new Error("owned payload shouldn't contain raw ReadableStreams");
    }
  }
  deepCopy(value, oldParent, property, parent, dupStubs, owner) {
    let kind = typeForRpc(value);
    switch (kind) {
      case "unsupported":
        return value;
      case "primitive":
      case "bigint":
      case "date":
      case "bytes":
      case "blob":
      case "error":
      case "undefined":
        return value;
      case "array": {
        let array = value;
        let len = array.length;
        let result = new Array(len);
        for (let i = 0; i < len; i++) {
          result[i] = this.deepCopy(array[i], array, i, result, dupStubs, owner);
        }
        return result;
      }
      case "object": {
        let result = {};
        let object = value;
        for (let i in object) {
          result[i] = this.deepCopy(object[i], object, i, result, dupStubs, owner);
        }
        return result;
      }
      case "stub":
      case "rpc-promise": {
        let stub = value;
        let hook;
        if (dupStubs) {
          hook = unwrapStubAndDup(stub);
        } else {
          hook = unwrapStubTakingOwnership(stub);
        }
        if (stub instanceof RpcPromise) {
          let promise = new RpcPromise(hook, []);
          this.promises.push({ parent, property, promise });
          return promise;
        } else {
          this.hooks.push(hook);
          return new RpcStub(hook);
        }
      }
      case "function":
      case "rpc-target": {
        let target = value;
        let hook;
        if (owner) {
          hook = owner.getHookForRpcTarget(target, oldParent, dupStubs);
        } else {
          hook = TargetStubHook.create(target, oldParent);
        }
        this.hooks.push(hook);
        return new RpcStub(hook);
      }
      case "rpc-thenable": {
        let target = value;
        let promise;
        if (owner) {
          promise = new RpcPromise(owner.getHookForRpcTarget(target, oldParent, dupStubs), []);
        } else {
          promise = new RpcPromise(TargetStubHook.create(target, oldParent), []);
        }
        this.promises.push({ parent, property, promise });
        return promise;
      }
      case "writable": {
        let stream = value;
        let hook;
        if (owner) {
          hook = owner.getHookForWritableStream(stream, oldParent, dupStubs);
        } else {
          hook = streamImpl.createWritableStreamHook(stream);
        }
        this.hooks.push(hook);
        return stream;
      }
      case "readable": {
        let stream = value;
        let hook;
        if (owner) {
          hook = owner.getHookForReadableStream(stream, oldParent, dupStubs);
        } else {
          hook = streamImpl.createReadableStreamHook(stream);
        }
        this.hooks.push(hook);
        return stream;
      }
      case "headers":
        return new Headers(value);
      case "request": {
        let req = value;
        if (req.body) {
          this.deepCopy(req.body, req, "body", req, dupStubs, owner);
        }
        return new Request(req);
      }
      case "response": {
        let resp = value;
        if (resp.body) {
          this.deepCopy(resp.body, resp, "body", resp, dupStubs, owner);
        }
        return new Response(resp.body, resp);
      }
      default:
        throw new Error("unreachable");
    }
  }
  // Ensures that if the value originally came from an unowned source, we have replaced it with a
  // deep copy.
  ensureDeepCopied() {
    if (this.source !== "owned") {
      let dupStubs = this.source === "params";
      this.hooks = [];
      this.promises = [];
      try {
        this.value = this.deepCopy(this.value, void 0, "value", this, dupStubs, this);
      } catch (err) {
        this.hooks = void 0;
        this.promises = void 0;
        throw err;
      }
      this.source = "owned";
      if (this.rpcTargets && this.rpcTargets.size > 0) {
        throw new Error("Not all rpcTargets were accounted for in deep-copy?");
      }
      this.rpcTargets = void 0;
    }
  }
  // Resolve all promises in this payload and then assign the final value into `parent[property]`.
  deliverTo(parent, property, promises) {
    this.ensureDeepCopied();
    if (this.value instanceof RpcPromise) {
      _RpcPayload.deliverRpcPromiseTo(this.value, parent, property, promises);
    } else {
      parent[property] = this.value;
      for (let record of this.promises) {
        _RpcPayload.deliverRpcPromiseTo(record.promise, record.parent, record.property, promises);
      }
    }
  }
  static deliverRpcPromiseTo(promise, parent, property, promises) {
    let hook = unwrapStubNoProperties(promise);
    if (!hook) {
      throw new Error("property promises should have been resolved earlier");
    }
    let inner = hook.pull();
    if (inner instanceof _RpcPayload) {
      inner.deliverTo(parent, property, promises);
    } else {
      promises.push(inner.then((payload) => {
        let subPromises = [];
        payload.deliverTo(parent, property, subPromises);
        if (subPromises.length > 0) {
          return Promise.all(subPromises);
        }
      }));
    }
  }
  // Call the given function with the payload as an argument. The call is made synchronously if
  // possible, in order to maintain e-order. However, if any RpcPromises exist in the payload,
  // they are awaited and substituted before calling the function. The result of the call is
  // wrapped into another payload.
  //
  // The payload is automatically disposed after the call completes. The caller should not call
  // dispose().
  async deliverCall(func, thisArg) {
    try {
      let promises = [];
      this.deliverTo(this, "value", promises);
      if (promises.length > 0) {
        await Promise.all(promises);
      }
      let result = Function.prototype.apply.call(func, thisArg, this.value);
      if (result instanceof RpcPromise) {
        return _RpcPayload.fromAppReturn(result);
      } else {
        return _RpcPayload.fromAppReturn(await result);
      }
    } finally {
      this.dispose();
    }
  }
  // Produce a promise for this payload for return to the application. Any RpcPromises in the
  // payload are awaited and substituted with their results first.
  //
  // The returned object will have a disposer which disposes the payload. The caller should not
  // separately dispose it.
  async deliverResolve() {
    try {
      let promises = [];
      this.deliverTo(this, "value", promises);
      if (promises.length > 0) {
        await Promise.all(promises);
      }
      let result = this.value;
      if (result instanceof Object) {
        if (!(Symbol.dispose in result)) {
          Object.defineProperty(result, Symbol.dispose, {
            // NOTE: Using `this.dispose.bind(this)` here causes Playwright's build of
            //   Chromium 140.0.7339.16 to fail when the object is assigned to a `using` variable,
            //   with the error:
            //       TypeError: Symbol(Symbol.dispose) is not a function
            //   I cannot reproduce this problem in Chrome 140.0.7339.127 nor in Node or workerd,
            //   so maybe it was a short-lived V8 bug or something. To be safe, though, we use
            //   `() => this.dispose()`, which seems to always work.
            value: /* @__PURE__ */ __name(() => this.dispose(), "value"),
            writable: true,
            enumerable: false,
            configurable: true
          });
        }
      }
      return result;
    } catch (err) {
      this.dispose();
      throw err;
    }
  }
  dispose() {
    if (this.source === "owned") {
      this.hooks.forEach((hook) => hook.dispose());
      this.promises.forEach((promise) => promise.promise[Symbol.dispose]());
    } else if (this.source === "return") {
      this.disposeImpl(this.value, void 0);
      if (this.rpcTargets && this.rpcTargets.size > 0) {
        throw new Error("Not all rpcTargets were accounted for in disposeImpl()?");
      }
    } else ;
    this.source = "owned";
    this.hooks = [];
    this.promises = [];
  }
  // Recursive dispose, called only when `source` is "return".
  disposeImpl(value, parent) {
    let kind = typeForRpc(value);
    switch (kind) {
      case "unsupported":
      case "primitive":
      case "bigint":
      case "bytes":
      case "blob":
      case "date":
      case "error":
      case "undefined":
        return;
      case "array": {
        let array = value;
        let len = array.length;
        for (let i = 0; i < len; i++) {
          this.disposeImpl(array[i], array);
        }
        return;
      }
      case "object": {
        let object = value;
        for (let i in object) {
          this.disposeImpl(object[i], object);
        }
        return;
      }
      case "stub":
      case "rpc-promise": {
        let stub = value;
        let hook = unwrapStubNoProperties(stub);
        if (hook) {
          hook.dispose();
        }
        return;
      }
      case "function":
      case "rpc-target": {
        let target = value;
        let hook = this.rpcTargets?.get(target);
        if (hook) {
          hook.dispose();
          this.rpcTargets.delete(target);
        } else {
          disposeRpcTarget(target);
        }
        return;
      }
      case "rpc-thenable":
        return;
      case "headers":
        return;
      case "request": {
        let req = value;
        if (req.body) this.disposeImpl(req.body, req);
        return;
      }
      case "response": {
        let resp = value;
        if (resp.body) this.disposeImpl(resp.body, resp);
        return;
      }
      case "writable": {
        let stream = value;
        let hook = this.rpcTargets?.get(stream);
        if (hook) {
          this.rpcTargets.delete(stream);
        } else {
          hook = streamImpl.createWritableStreamHook(stream);
        }
        hook.dispose();
        return;
      }
      case "readable": {
        let stream = value;
        let hook = this.rpcTargets?.get(stream);
        if (hook) {
          this.rpcTargets.delete(stream);
        } else {
          hook = streamImpl.createReadableStreamHook(stream);
        }
        hook.dispose();
        return;
      }
      default:
        return;
    }
  }
  // Ignore unhandled rejections in all promises in this payload -- that is, all promises that
  // *would* be awaited if this payload were to be delivered. See the similarly-named method of
  // StubHook for explanation.
  ignoreUnhandledRejections() {
    if (this.hooks) {
      this.hooks.forEach((hook) => {
        hook.ignoreUnhandledRejections();
      });
      this.promises.forEach(
        (promise) => unwrapStubOrParent(promise.promise).ignoreUnhandledRejections()
      );
    } else {
      this.ignoreUnhandledRejectionsImpl(this.value);
    }
  }
  ignoreUnhandledRejectionsImpl(value) {
    let kind = typeForRpc(value);
    switch (kind) {
      case "unsupported":
      case "primitive":
      case "bigint":
      case "bytes":
      case "blob":
      case "date":
      case "error":
      case "undefined":
      case "function":
      case "rpc-target":
      case "writable":
      case "readable":
      case "headers":
      case "request":
      case "response":
        return;
      case "array": {
        let array = value;
        let len = array.length;
        for (let i = 0; i < len; i++) {
          this.ignoreUnhandledRejectionsImpl(array[i]);
        }
        return;
      }
      case "object": {
        let object = value;
        for (let i in object) {
          this.ignoreUnhandledRejectionsImpl(object[i]);
        }
        return;
      }
      case "stub":
      case "rpc-promise":
        unwrapStubOrParent(value).ignoreUnhandledRejections();
        return;
      case "rpc-thenable":
        value.then((_) => {
        }, (_) => {
        });
        return;
      default:
        return;
    }
  }
};
function followPath(value, parent, path2, owner) {
  for (let i = 0; i < path2.length; i++) {
    parent = value;
    let part = path2[i];
    if (part in Object.prototype) {
      value = void 0;
      continue;
    }
    let kind = typeForRpc(value);
    switch (kind) {
      case "object":
      case "function":
        if (Object.hasOwn(value, part)) {
          value = value[part];
        } else {
          value = void 0;
        }
        break;
      case "array":
        if (Number.isInteger(part) && part >= 0) {
          value = value[part];
        } else {
          value = void 0;
        }
        break;
      case "rpc-target":
      case "rpc-thenable": {
        if (Object.hasOwn(value, part)) {
          throw new TypeError(
            `Attempted to access property '${part}', which is an instance property of the RpcTarget. To avoid leaking private internals, instance properties cannot be accessed over RPC. If you want to make this property available over RPC, define it as a method or getter on the class, instead of an instance property.`
          );
        } else {
          value = value[part];
        }
        owner = null;
        break;
      }
      case "stub":
      case "rpc-promise": {
        let { hook, pathIfPromise } = unwrapStubAndPath(value);
        return { hook, remainingPath: pathIfPromise ? pathIfPromise.concat(path2.slice(i)) : path2.slice(i) };
      }
      case "writable":
        value = void 0;
        break;
      case "readable":
        value = void 0;
        break;
      case "primitive":
      case "bigint":
      case "bytes":
      case "blob":
      case "date":
      case "error":
      case "headers":
      case "request":
      case "response":
        value = void 0;
        break;
      case "undefined":
        value = value[part];
        break;
      case "unsupported": {
        if (i === 0) {
          throw new TypeError(`RPC stub points at a non-serializable type.`);
        } else {
          let prefix = path2.slice(0, i).join(".");
          let remainder = path2.slice(0, i).join(".");
          throw new TypeError(
            `'${prefix}' is not a serializable type, so property ${remainder} cannot be accessed.`
          );
        }
      }
      default:
        throw new TypeError("unreachable");
    }
  }
  if (value instanceof RpcPromise) {
    let { hook, pathIfPromise } = unwrapStubAndPath(value);
    return { hook, remainingPath: pathIfPromise || [] };
  }
  return {
    value,
    parent,
    owner
  };
}
__name(followPath, "followPath");
var ValueStubHook = class extends StubHook {
  static {
    __name(this, "ValueStubHook");
  }
  call(path2, args) {
    try {
      let { value, owner } = this.getValue();
      let followResult = followPath(value, void 0, path2, owner);
      if (followResult.hook) {
        return followResult.hook.call(followResult.remainingPath, args);
      }
      if (typeof followResult.value != "function") {
        throw new TypeError(`'${path2.join(".")}' is not a function.`);
      }
      let promise = args.deliverCall(followResult.value, followResult.parent);
      return new PromiseStubHook(promise.then((payload) => {
        return new PayloadStubHook(payload);
      }));
    } catch (err) {
      return new ErrorStubHook(err);
    }
  }
  map(path2, captures, instructions) {
    try {
      let followResult;
      try {
        let { value, owner } = this.getValue();
        followResult = followPath(value, void 0, path2, owner);
        ;
      } catch (err) {
        for (let cap of captures) {
          cap.dispose();
        }
        throw err;
      }
      if (followResult.hook) {
        return followResult.hook.map(followResult.remainingPath, captures, instructions);
      }
      return mapImpl.applyMap(
        followResult.value,
        followResult.parent,
        followResult.owner,
        captures,
        instructions
      );
    } catch (err) {
      return new ErrorStubHook(err);
    }
  }
  get(path2) {
    try {
      let { value, owner } = this.getValue();
      if (path2.length === 0 && owner === null) {
        throw new Error("Can't dup an RpcTarget stub as a promise.");
      }
      let followResult = followPath(value, void 0, path2, owner);
      if (followResult.hook) {
        return followResult.hook.get(followResult.remainingPath);
      }
      return new PayloadStubHook(RpcPayload.deepCopyFrom(
        followResult.value,
        followResult.parent,
        followResult.owner
      ));
    } catch (err) {
      return new ErrorStubHook(err);
    }
  }
};
var PayloadStubHook = class _PayloadStubHook extends ValueStubHook {
  static {
    __name(this, "_PayloadStubHook");
  }
  constructor(payload) {
    super();
    this.payload = payload;
  }
  payload;
  // cleared when disposed
  getPayload() {
    if (this.payload) {
      return this.payload;
    } else {
      throw new Error("Attempted to use an RPC StubHook after it was disposed.");
    }
  }
  getValue() {
    let payload = this.getPayload();
    return { value: payload.value, owner: payload };
  }
  dup() {
    let thisPayload = this.getPayload();
    return new _PayloadStubHook(RpcPayload.deepCopyFrom(
      thisPayload.value,
      void 0,
      thisPayload
    ));
  }
  pull() {
    return this.getPayload();
  }
  ignoreUnhandledRejections() {
    if (this.payload) {
      this.payload.ignoreUnhandledRejections();
    }
  }
  dispose() {
    if (this.payload) {
      this.payload.dispose();
      this.payload = void 0;
    }
  }
  onBroken(callback) {
    if (this.payload) {
      if (this.payload.value instanceof RpcStub) {
        this.payload.value.onRpcBroken(callback);
      }
    }
  }
};
function disposeRpcTarget(target) {
  if (Symbol.dispose in target) {
    try {
      target[Symbol.dispose]();
    } catch (err) {
      Promise.reject(err);
    }
  }
}
__name(disposeRpcTarget, "disposeRpcTarget");
var TargetStubHook = class _TargetStubHook extends ValueStubHook {
  static {
    __name(this, "_TargetStubHook");
  }
  // Constructs a TargetStubHook that is not duplicated from an existing hook.
  //
  // If `value` is a function, `parent` is bound as its "this".
  static create(value, parent) {
    if (typeof value !== "function") {
      parent = void 0;
    }
    return new _TargetStubHook(value, parent);
  }
  constructor(target, parent, dupFrom) {
    super();
    this.target = target;
    this.parent = parent;
    if (dupFrom) {
      if (dupFrom.refcount) {
        this.refcount = dupFrom.refcount;
        ++this.refcount.count;
      }
    } else if (Symbol.dispose in target) {
      this.refcount = { count: 1 };
    }
  }
  target;
  // cleared when disposed
  parent;
  // `this` parameter when calling `target`
  refcount;
  // undefined if not needed (because target has no disposer)
  getTarget() {
    if (this.target) {
      return this.target;
    } else {
      throw new Error("Attempted to use an RPC StubHook after it was disposed.");
    }
  }
  getValue() {
    return { value: this.getTarget(), owner: null };
  }
  dup() {
    return new _TargetStubHook(this.getTarget(), this.parent, this);
  }
  pull() {
    let target = this.getTarget();
    if ("then" in target) {
      return Promise.resolve(target).then((resolution) => {
        return RpcPayload.fromAppReturn(resolution);
      });
    } else {
      return Promise.reject(new Error("Tried to resolve a non-promise stub."));
    }
  }
  ignoreUnhandledRejections() {
  }
  dispose() {
    if (this.target) {
      if (this.refcount) {
        if (--this.refcount.count == 0) {
          disposeRpcTarget(this.target);
        }
      }
      this.target = void 0;
    }
  }
  onBroken(callback) {
  }
};
var PromiseStubHook = class _PromiseStubHook extends StubHook {
  static {
    __name(this, "_PromiseStubHook");
  }
  promise;
  resolution;
  constructor(promise) {
    super();
    this.promise = promise.then((res) => {
      this.resolution = res;
      return res;
    });
  }
  call(path2, args) {
    args.ensureDeepCopied();
    return new _PromiseStubHook(this.promise.then((hook) => hook.call(path2, args)));
  }
  stream(path2, args) {
    args.ensureDeepCopied();
    let promise = this.promise.then((hook) => {
      let result = hook.stream(path2, args);
      return result.promise;
    });
    return { promise };
  }
  map(path2, captures, instructions) {
    return new _PromiseStubHook(this.promise.then(
      (hook) => hook.map(path2, captures, instructions),
      (err) => {
        for (let cap of captures) {
          cap.dispose();
        }
        throw err;
      }
    ));
  }
  get(path2) {
    return new _PromiseStubHook(this.promise.then((hook) => hook.get(path2)));
  }
  dup() {
    if (this.resolution) {
      return this.resolution.dup();
    } else {
      return new _PromiseStubHook(this.promise.then((hook) => hook.dup()));
    }
  }
  pull() {
    if (this.resolution) {
      return this.resolution.pull();
    } else {
      return this.promise.then((hook) => hook.pull());
    }
  }
  ignoreUnhandledRejections() {
    if (this.resolution) {
      this.resolution.ignoreUnhandledRejections();
    } else {
      this.promise.then((res) => {
        res.ignoreUnhandledRejections();
      }, (err) => {
      });
    }
  }
  dispose() {
    if (this.resolution) {
      this.resolution.dispose();
    } else {
      this.promise.then((hook) => {
        hook.dispose();
      }, (err) => {
      });
    }
  }
  onBroken(callback) {
    if (this.resolution) {
      this.resolution.onBroken(callback);
    } else {
      this.promise.then((hook) => {
        hook.onBroken(callback);
      }, callback);
    }
  }
};
var NullExporter = class {
  static {
    __name(this, "NullExporter");
  }
  exportStub(stub) {
    throw new Error("Cannot serialize RPC stubs without an RPC session.");
  }
  exportPromise(stub) {
    throw new Error("Cannot serialize RPC stubs without an RPC session.");
  }
  getImport(hook) {
    return void 0;
  }
  unexport(ids) {
  }
  createPipe(readable) {
    throw new Error("Cannot create pipes without an RPC session.");
  }
  onSendError(error) {
  }
};
var NULL_EXPORTER = new NullExporter();
async function streamToBlob(stream, type) {
  let b = await new Response(stream).blob();
  return b.type === type ? b : b.slice(0, b.size, type);
}
__name(streamToBlob, "streamToBlob");
var ERROR_TYPES = {
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
  AggregateError
  // TODO: DOMError? Others?
};
var Devaluator = class _Devaluator {
  static {
    __name(this, "_Devaluator");
  }
  constructor(exporter, source) {
    this.exporter = exporter;
    this.source = source;
  }
  // Devaluate the given value.
  // * value: The value to devaluate.
  // * parent: The value's parent object, which would be used as `this` if the value were called
  //     as a function.
  // * exporter: Callbacks to the RPC session for exporting capabilities found in this message.
  // * source: The RpcPayload which contains the value, and therefore owns stubs within.
  //
  // Returns: The devaluated value, ready to be JSON-serialized.
  static devaluate(value, parent, exporter = NULL_EXPORTER, source) {
    let devaluator = new _Devaluator(exporter, source);
    try {
      return devaluator.devaluateImpl(value, parent, 0);
    } catch (err) {
      if (devaluator.exports) {
        try {
          exporter.unexport(devaluator.exports);
        } catch (err2) {
        }
      }
      throw err;
    }
  }
  exports;
  devaluateImpl(value, parent, depth) {
    if (depth >= 64) {
      throw new Error(
        "Serialization exceeded maximum allowed depth. (Does the message contain cycles?)"
      );
    }
    let kind = typeForRpc(value);
    switch (kind) {
      case "unsupported": {
        let msg;
        try {
          msg = `Cannot serialize value: ${value}`;
        } catch (err) {
          msg = "Cannot serialize value: (couldn't stringify value)";
        }
        throw new TypeError(msg);
      }
      case "primitive":
        if (typeof value === "number" && !isFinite(value)) {
          if (value === Infinity) {
            return ["inf"];
          } else if (value === -Infinity) {
            return ["-inf"];
          } else {
            return ["nan"];
          }
        } else {
          return value;
        }
      case "object": {
        let object = value;
        let result = {};
        for (let key in object) {
          result[key] = this.devaluateImpl(object[key], object, depth + 1);
        }
        return result;
      }
      case "array": {
        let array = value;
        let len = array.length;
        let result = new Array(len);
        for (let i = 0; i < len; i++) {
          result[i] = this.devaluateImpl(array[i], array, depth + 1);
        }
        return [result];
      }
      case "bigint":
        return ["bigint", value.toString()];
      case "date": {
        const time = value.getTime();
        return ["date", Number.isNaN(time) ? null : time];
      }
      case "bytes": {
        let bytes = value;
        if (bytes.toBase64) {
          return ["bytes", bytes.toBase64({ omitPadding: true })];
        }
        let b64;
        if (typeof Buffer !== "undefined") {
          let buf = bytes instanceof Buffer ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          b64 = buf.toString("base64");
        } else {
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          b64 = btoa(binary);
        }
        return ["bytes", b64.replace(/=+$/, "")];
      }
      case "headers":
        return ["headers", [...value]];
      case "request": {
        let req = value;
        let init = {};
        if (req.method !== "GET") init.method = req.method;
        let headers = [...req.headers];
        if (headers.length > 0) {
          init.headers = headers;
        }
        if (req.body) {
          init.body = this.devaluateImpl(req.body, req, depth + 1);
          init.duplex = req.duplex || "half";
        } else if (req.body === void 0 && !["GET", "HEAD", "OPTIONS", "TRACE", "DELETE"].includes(req.method)) {
          let bodyPromise = req.arrayBuffer();
          let readable = new ReadableStream({
            async start(controller) {
              try {
                controller.enqueue(new Uint8Array(await bodyPromise));
                controller.close();
              } catch (err) {
                controller.error(err);
              }
            }
          });
          let hook = streamImpl.createReadableStreamHook(readable);
          let importId = this.exporter.createPipe(readable, hook);
          init.body = ["readable", importId];
          init.duplex = req.duplex || "half";
        }
        if (req.cache && req.cache !== "default") init.cache = req.cache;
        if (req.redirect !== "follow") init.redirect = req.redirect;
        if (req.integrity) init.integrity = req.integrity;
        if (req.mode && req.mode !== "cors") init.mode = req.mode;
        if (req.credentials && req.credentials !== "same-origin") {
          init.credentials = req.credentials;
        }
        if (req.referrer && req.referrer !== "about:client") init.referrer = req.referrer;
        if (req.referrerPolicy) init.referrerPolicy = req.referrerPolicy;
        if (req.keepalive) init.keepalive = req.keepalive;
        let cfReq = req;
        if (cfReq.cf) init.cf = cfReq.cf;
        if (cfReq.encodeResponseBody && cfReq.encodeResponseBody !== "automatic") {
          init.encodeResponseBody = cfReq.encodeResponseBody;
        }
        return ["request", req.url, init];
      }
      case "response": {
        let resp = value;
        let body = this.devaluateImpl(resp.body, resp, depth + 1);
        let init = {};
        if (resp.status !== 200) init.status = resp.status;
        if (resp.statusText) init.statusText = resp.statusText;
        let headers = [...resp.headers];
        if (headers.length > 0) {
          init.headers = headers;
        }
        let cfResp = resp;
        if (cfResp.cf) init.cf = cfResp.cf;
        if (cfResp.encodeBody && cfResp.encodeBody !== "automatic") {
          init.encodeBody = cfResp.encodeBody;
        }
        if (cfResp.webSocket) {
          throw new TypeError("Can't serialize a Response containing a webSocket.");
        }
        return ["response", body, init];
      }
      case "blob": {
        let blob = value;
        let readable = blob.stream();
        let hook = streamImpl.createReadableStreamHook(readable);
        let importId = this.exporter.createPipe(readable, hook);
        return ["blob", blob.type, ["readable", importId]];
      }
      case "error": {
        let e = value;
        let rewritten = this.exporter.onSendError(e);
        if (rewritten) {
          e = rewritten;
        }
        let anyE = e;
        let props;
        let captureProp = /* @__PURE__ */ __name((key, val) => {
          let exportsBefore = this.exports?.length ?? 0;
          try {
            let encoded = this.devaluateImpl(val, e, depth + 1);
            if (!props) props = {};
            props[key] = encoded;
          } catch (err) {
            if (this.exports && this.exports.length > exportsBefore) {
              let tail = this.exports.splice(exportsBefore);
              try {
                this.exporter.unexport(tail);
              } catch (err2) {
              }
            }
          }
        }, "captureProp");
        for (let key of Object.keys(e)) {
          if (key === "name" || key === "message" || key === "stack") continue;
          captureProp(key, anyE[key]);
        }
        if ("cause" in e) {
          captureProp("cause", anyE.cause);
        }
        if (e instanceof AggregateError) {
          captureProp("errors", e.errors);
        }
        let result = ["error", e.name, e.message];
        if (props) {
          result.push(rewritten && rewritten.stack ? rewritten.stack : null);
          result.push(props);
        } else if (rewritten && rewritten.stack) {
          result.push(rewritten.stack);
        }
        return result;
      }
      case "undefined":
        return ["undefined"];
      case "stub":
      case "rpc-promise": {
        if (!this.source) {
          throw new Error("Can't serialize RPC stubs in this context.");
        }
        let { hook, pathIfPromise } = unwrapStubAndPath(value);
        let importId = this.exporter.getImport(hook);
        if (importId !== void 0) {
          if (pathIfPromise) {
            if (pathIfPromise.length > 0) {
              return ["pipeline", importId, pathIfPromise];
            } else {
              return ["pipeline", importId];
            }
          } else {
            return ["import", importId];
          }
        }
        if (pathIfPromise) {
          hook = hook.get(pathIfPromise);
        } else {
          hook = hook.dup();
        }
        return this.devaluateHook(pathIfPromise ? "promise" : "export", hook);
      }
      case "function":
      case "rpc-target": {
        if (!this.source) {
          throw new Error("Can't serialize RPC stubs in this context.");
        }
        let hook = this.source.getHookForRpcTarget(value, parent);
        return this.devaluateHook("export", hook);
      }
      case "rpc-thenable": {
        if (!this.source) {
          throw new Error("Can't serialize RPC stubs in this context.");
        }
        let hook = this.source.getHookForRpcTarget(value, parent);
        return this.devaluateHook("promise", hook);
      }
      case "writable": {
        if (!this.source) {
          throw new Error("Can't serialize WritableStream in this context.");
        }
        let hook = this.source.getHookForWritableStream(value, parent);
        return this.devaluateHook("writable", hook);
      }
      case "readable": {
        if (!this.source) {
          throw new Error("Can't serialize ReadableStream in this context.");
        }
        let ws = value;
        let hook = this.source.getHookForReadableStream(ws, parent);
        let importId = this.exporter.createPipe(ws, hook);
        return ["readable", importId];
      }
      default:
        throw new Error("unreachable");
    }
  }
  devaluateHook(type, hook) {
    if (!this.exports) this.exports = [];
    let exportId = type === "promise" ? this.exporter.exportPromise(hook) : this.exporter.exportStub(hook);
    this.exports.push(exportId);
    return [type, exportId];
  }
};
var NullImporter = class {
  static {
    __name(this, "NullImporter");
  }
  importStub(idx) {
    throw new Error("Cannot deserialize RPC stubs without an RPC session.");
  }
  importPromise(idx) {
    throw new Error("Cannot deserialize RPC stubs without an RPC session.");
  }
  getExport(idx) {
    return void 0;
  }
  getPipeReadable(exportId) {
    throw new Error("Cannot retrieve pipe readable without an RPC session.");
  }
};
var NULL_IMPORTER = new NullImporter();
function fixBrokenRequestBody(request, body) {
  let promise = new Response(body).arrayBuffer().then((arrayBuffer) => {
    let bytes = new Uint8Array(arrayBuffer);
    let result = new Request(request, { body: bytes });
    return new PayloadStubHook(RpcPayload.fromAppReturn(result));
  });
  return new RpcPromise(new PromiseStubHook(promise), []);
}
__name(fixBrokenRequestBody, "fixBrokenRequestBody");
function streamToBlobPromise(stream, type) {
  let promise = streamToBlob(stream, type).then((blob) => {
    return new PayloadStubHook(RpcPayload.fromAppReturn(blob));
  });
  return new RpcPromise(new PromiseStubHook(promise), []);
}
__name(streamToBlobPromise, "streamToBlobPromise");
var Evaluator = class _Evaluator {
  static {
    __name(this, "_Evaluator");
  }
  constructor(importer) {
    this.importer = importer;
  }
  hooks = [];
  promises = [];
  evaluate(value) {
    let payload = RpcPayload.forEvaluate(this.hooks, this.promises);
    try {
      payload.value = this.evaluateImpl(value, payload, "value");
      return payload;
    } catch (err) {
      payload.dispose();
      throw err;
    }
  }
  // Evaluate the value without destroying it.
  evaluateCopy(value) {
    return this.evaluate(structuredClone(value));
  }
  evaluateImpl(value, parent, property) {
    if (value instanceof Array) {
      if (value.length == 1 && value[0] instanceof Array) {
        let result = value[0];
        for (let i = 0; i < result.length; i++) {
          result[i] = this.evaluateImpl(result[i], result, i);
        }
        return result;
      } else switch (value[0]) {
        case "bigint":
          if (typeof value[1] == "string") {
            return BigInt(value[1]);
          }
          break;
        case "date":
          if (value[1] === null) {
            return /* @__PURE__ */ new Date(NaN);
          }
          if (typeof value[1] == "number") {
            return new Date(value[1]);
          }
          break;
        case "bytes": {
          if (typeof value[1] == "string") {
            if (typeof Buffer !== "undefined") {
              return Buffer.from(value[1], "base64");
            } else if (Uint8Array.fromBase64) {
              return Uint8Array.fromBase64(value[1]);
            } else {
              let bs = atob(value[1]);
              let len = bs.length;
              let bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) {
                bytes[i] = bs.charCodeAt(i);
              }
              return bytes;
            }
          }
          break;
        }
        case "error":
          if (value.length >= 3 && typeof value[1] === "string" && typeof value[2] === "string") {
            let cls = ERROR_TYPES[value[1]] || Error;
            let result = cls === AggregateError ? new cls([], value[2]) : new cls(value[2]);
            if (typeof value[3] === "string") {
              result.stack = value[3];
            }
            if (value.length >= 5) {
              let props = value[4];
              if (!props || typeof props !== "object" || Array.isArray(props)) {
                break;
              }
              let anyResult = result;
              let propsObj = props;
              for (let key of Object.keys(propsObj)) {
                if (key === "name" || key === "message" || key === "stack") continue;
                anyResult[key] = this.evaluateImpl(propsObj[key], result, key);
              }
            }
            return result;
          }
          break;
        case "undefined":
          if (value.length === 1) {
            return void 0;
          }
          break;
        case "inf":
          return Infinity;
        case "-inf":
          return -Infinity;
        case "nan":
          return NaN;
        case "headers":
          if (value.length === 2 && value[1] instanceof Array) {
            return new Headers(value[1]);
          }
          break;
        case "request": {
          if (value.length !== 3 || typeof value[1] !== "string") break;
          let url = value[1];
          let init = value[2];
          if (typeof init !== "object" || init === null) break;
          if (init.body) {
            init.body = this.evaluateImpl(init.body, init, "body");
            if (init.body === null || typeof init.body === "string" || init.body instanceof Uint8Array || init.body instanceof ReadableStream) ;
            else {
              throw new TypeError("Request body must be of type ReadableStream.");
            }
          }
          if (init.signal) {
            init.signal = this.evaluateImpl(init.signal, init, "signal");
            if (!(init.signal instanceof AbortSignal)) {
              throw new TypeError("Request siganl must be of type AbortSignal.");
            }
          }
          if (init.headers && !(init.headers instanceof Array)) {
            throw new TypeError("Request headers must be serialized as an array of pairs.");
          }
          let result = new Request(url, init);
          if (init.body instanceof ReadableStream && result.body === void 0) {
            let promise = fixBrokenRequestBody(result, init.body);
            this.promises.push({ promise, parent, property });
            return promise;
          } else {
            return result;
          }
        }
        case "response": {
          if (value.length !== 3) break;
          let body = this.evaluateImpl(value[1], parent, property);
          if (body === null || typeof body === "string" || body instanceof Uint8Array || body instanceof ReadableStream) ;
          else {
            throw new TypeError("Response body must be of type ReadableStream.");
          }
          let init = value[2];
          if (typeof init !== "object" || init === null) break;
          if (init.webSocket) {
            throw new TypeError("Can't deserialize a Response containing a webSocket.");
          }
          if (init.headers && !(init.headers instanceof Array)) {
            throw new TypeError("Request headers must be serialized as an array of pairs.");
          }
          return new Response(body, init);
        }
        case "blob": {
          if (value.length !== 3 || typeof value[1] !== "string") break;
          let contentType = value[1];
          let content = this.evaluateImpl(value[2], parent, property);
          if (!(content instanceof ReadableStream)) {
            throw new TypeError("Blob content must be serialized as a ReadableStream.");
          }
          let promise = streamToBlobPromise(content, contentType);
          this.promises.push({ promise, parent, property });
          return promise;
        }
        case "import":
        case "pipeline": {
          if (value.length < 2 || value.length > 4) {
            break;
          }
          if (typeof value[1] != "number") {
            break;
          }
          let hook = this.importer.getExport(value[1]);
          if (!hook) {
            throw new Error(`no such entry on exports table: ${value[1]}`);
          }
          let isPromise = value[0] == "pipeline";
          let addStub = /* @__PURE__ */ __name((hook2) => {
            if (isPromise) {
              let promise = new RpcPromise(hook2, []);
              this.promises.push({ promise, parent, property });
              return promise;
            } else {
              this.hooks.push(hook2);
              return new RpcPromise(hook2, []);
            }
          }, "addStub");
          if (value.length == 2) {
            if (isPromise) {
              return addStub(hook.get([]));
            } else {
              return addStub(hook.dup());
            }
          }
          let path2 = value[2];
          if (!(path2 instanceof Array)) {
            break;
          }
          if (!path2.every(
            (part) => {
              return typeof part == "string" || typeof part == "number";
            }
          )) {
            break;
          }
          if (value.length == 3) {
            return addStub(hook.get(path2));
          }
          let args = value[3];
          if (!(args instanceof Array)) {
            break;
          }
          let subEval = new _Evaluator(this.importer);
          args = subEval.evaluate([args]);
          return addStub(hook.call(path2, args));
        }
        case "remap": {
          if (value.length !== 5 || typeof value[1] !== "number" || !(value[2] instanceof Array) || !(value[3] instanceof Array) || !(value[4] instanceof Array)) {
            break;
          }
          let hook = this.importer.getExport(value[1]);
          if (!hook) {
            throw new Error(`no such entry on exports table: ${value[1]}`);
          }
          let path2 = value[2];
          if (!path2.every(
            (part) => {
              return typeof part == "string" || typeof part == "number";
            }
          )) {
            break;
          }
          let captures = value[3].map((cap) => {
            if (!(cap instanceof Array) || cap.length !== 2 || cap[0] !== "import" && cap[0] !== "export" || typeof cap[1] !== "number") {
              throw new TypeError(`unknown map capture: ${JSON.stringify(cap)}`);
            }
            if (cap[0] === "export") {
              return this.importer.importStub(cap[1]);
            } else {
              let exp = this.importer.getExport(cap[1]);
              if (!exp) {
                throw new Error(`no such entry on exports table: ${cap[1]}`);
              }
              return exp.dup();
            }
          });
          let instructions = value[4];
          let resultHook = hook.map(path2, captures, instructions);
          let promise = new RpcPromise(resultHook, []);
          this.promises.push({ promise, parent, property });
          return promise;
        }
        case "export":
        case "promise":
          if (typeof value[1] == "number") {
            if (value[0] == "promise") {
              let hook = this.importer.importPromise(value[1]);
              let promise = new RpcPromise(hook, []);
              this.promises.push({ parent, property, promise });
              return promise;
            } else {
              let hook = this.importer.importStub(value[1]);
              this.hooks.push(hook);
              return new RpcStub(hook);
            }
          }
          break;
        case "writable":
          if (typeof value[1] == "number") {
            let hook = this.importer.importStub(value[1]);
            let stream = streamImpl.createWritableStreamFromHook(hook);
            this.hooks.push(hook);
            return stream;
          }
          break;
        case "readable":
          if (typeof value[1] == "number") {
            let stream = this.importer.getPipeReadable(value[1]);
            let hook = streamImpl.createReadableStreamHook(stream);
            this.hooks.push(hook);
            return stream;
          }
          break;
      }
      throw new TypeError(`unknown special value: ${JSON.stringify(value)}`);
    } else if (value instanceof Object) {
      let result = value;
      for (let key in result) {
        if (key in Object.prototype || key === "toJSON") {
          this.evaluateImpl(result[key], result, key);
          delete result[key];
        } else {
          result[key] = this.evaluateImpl(result[key], result, key);
        }
      }
      return result;
    } else {
      return value;
    }
  }
};
var currentMapBuilder;
var MapBuilder = class {
  static {
    __name(this, "MapBuilder");
  }
  context;
  captureMap = /* @__PURE__ */ new Map();
  instructions = [];
  constructor(subject, path2) {
    if (currentMapBuilder) {
      this.context = {
        parent: currentMapBuilder,
        captures: [],
        subject: currentMapBuilder.capture(subject),
        path: path2
      };
    } else {
      this.context = {
        parent: void 0,
        captures: [],
        subject,
        path: path2
      };
    }
    currentMapBuilder = this;
  }
  unregister() {
    currentMapBuilder = this.context.parent;
  }
  makeInput() {
    return new MapVariableHook(this, 0);
  }
  makeOutput(result) {
    let devalued;
    try {
      devalued = Devaluator.devaluate(result.value, void 0, this, result);
    } finally {
      result.dispose();
    }
    this.instructions.push(devalued);
    if (this.context.parent) {
      this.context.parent.instructions.push(
        [
          "remap",
          this.context.subject,
          this.context.path,
          this.context.captures.map((cap) => ["import", cap]),
          this.instructions
        ]
      );
      return new MapVariableHook(this.context.parent, this.context.parent.instructions.length);
    } else {
      return this.context.subject.map(this.context.path, this.context.captures, this.instructions);
    }
  }
  pushCall(hook, path2, params) {
    let devalued = Devaluator.devaluate(params.value, void 0, this, params);
    devalued = devalued[0];
    let subject = this.capture(hook.dup());
    this.instructions.push(["pipeline", subject, path2, devalued]);
    return new MapVariableHook(this, this.instructions.length);
  }
  pushGet(hook, path2) {
    let subject = this.capture(hook.dup());
    this.instructions.push(["pipeline", subject, path2]);
    return new MapVariableHook(this, this.instructions.length);
  }
  capture(hook) {
    if (hook instanceof MapVariableHook && hook.mapper === this) {
      return hook.idx;
    }
    let result = this.captureMap.get(hook);
    if (result === void 0) {
      if (this.context.parent) {
        let parentIdx = this.context.parent.capture(hook);
        this.context.captures.push(parentIdx);
      } else {
        this.context.captures.push(hook);
      }
      result = -this.context.captures.length;
      this.captureMap.set(hook, result);
    }
    return result;
  }
  // ---------------------------------------------------------------------------
  // implements Exporter
  exportStub(hook) {
    throw new Error(
      "Can't construct an RpcTarget or RPC callback inside a mapper function. Try creating a new RpcStub outside the callback first, then using it inside the callback."
    );
  }
  exportPromise(hook) {
    return this.exportStub(hook);
  }
  getImport(hook) {
    return this.capture(hook);
  }
  unexport(ids) {
  }
  createPipe(readable) {
    throw new Error("Cannot send ReadableStream inside a mapper function.");
  }
  onSendError(error) {
  }
};
mapImpl.sendMap = (hook, path2, func) => {
  let builder = new MapBuilder(hook, path2);
  let result;
  try {
    result = RpcPayload.fromAppReturn(withCallInterceptor(builder.pushCall.bind(builder), () => {
      return func(new RpcPromise(builder.makeInput(), []));
    }));
  } finally {
    builder.unregister();
  }
  if (result instanceof Promise) {
    result.catch((err) => {
    });
    throw new Error("RPC map() callbacks cannot be async.");
  }
  return new RpcPromise(builder.makeOutput(result), []);
};
function throwMapperBuilderUseError() {
  throw new Error(
    "Attempted to use an abstract placeholder from a mapper function. Please make sure your map function has no side effects."
  );
}
__name(throwMapperBuilderUseError, "throwMapperBuilderUseError");
var MapVariableHook = class extends StubHook {
  static {
    __name(this, "MapVariableHook");
  }
  constructor(mapper, idx) {
    super();
    this.mapper = mapper;
    this.idx = idx;
  }
  // We don't have anything we actually need to dispose, so dup() can just return the same hook.
  dup() {
    return this;
  }
  dispose() {
  }
  get(path2) {
    if (path2.length == 0) {
      return this;
    } else if (currentMapBuilder) {
      return currentMapBuilder.pushGet(this, path2);
    } else {
      throwMapperBuilderUseError();
    }
  }
  // Other methods should never be called.
  call(path2, args) {
    throwMapperBuilderUseError();
  }
  map(path2, captures, instructions) {
    throwMapperBuilderUseError();
  }
  pull() {
    throwMapperBuilderUseError();
  }
  ignoreUnhandledRejections() {
  }
  onBroken(callback) {
    throwMapperBuilderUseError();
  }
};
var MapApplicator = class {
  static {
    __name(this, "MapApplicator");
  }
  constructor(captures, input) {
    this.captures = captures;
    this.variables = [input];
  }
  variables;
  dispose() {
    for (let variable of this.variables) {
      variable.dispose();
    }
  }
  apply(instructions) {
    try {
      if (instructions.length < 1) {
        throw new Error("Invalid empty mapper function.");
      }
      for (let instruction of instructions.slice(0, -1)) {
        let payload = new Evaluator(this).evaluateCopy(instruction);
        if (payload.value instanceof RpcStub) {
          let hook = unwrapStubNoProperties(payload.value);
          if (hook) {
            this.variables.push(hook);
            continue;
          }
        }
        this.variables.push(new PayloadStubHook(payload));
      }
      return new Evaluator(this).evaluateCopy(instructions[instructions.length - 1]);
    } finally {
      for (let variable of this.variables) {
        variable.dispose();
      }
    }
  }
  importStub(idx) {
    throw new Error("A mapper function cannot refer to exports.");
  }
  importPromise(idx) {
    return this.importStub(idx);
  }
  getExport(idx) {
    if (idx < 0) {
      return this.captures[-idx - 1];
    } else {
      return this.variables[idx];
    }
  }
  getPipeReadable(exportId) {
    throw new Error("A mapper function cannot use pipe readables.");
  }
};
function applyMapToElement(input, parent, owner, captures, instructions) {
  let inputHook = new PayloadStubHook(RpcPayload.deepCopyFrom(input, parent, owner));
  let mapper = new MapApplicator(captures, inputHook);
  try {
    return mapper.apply(instructions);
  } finally {
    mapper.dispose();
  }
}
__name(applyMapToElement, "applyMapToElement");
mapImpl.applyMap = (input, parent, owner, captures, instructions) => {
  try {
    let result;
    if (input instanceof RpcPromise) {
      throw new Error("applyMap() can't be called on RpcPromise");
    } else if (input instanceof Array) {
      let payloads = [];
      try {
        for (let elem of input) {
          payloads.push(applyMapToElement(elem, input, owner, captures, instructions));
        }
      } catch (err) {
        for (let payload of payloads) {
          payload.dispose();
        }
        throw err;
      }
      result = RpcPayload.fromArray(payloads);
    } else if (input === null || input === void 0) {
      result = RpcPayload.fromAppReturn(input);
    } else {
      result = applyMapToElement(input, parent, owner, captures, instructions);
    }
    return new PayloadStubHook(result);
  } finally {
    for (let cap of captures) {
      cap.dispose();
    }
  }
};
var WritableStreamStubHook = class _WritableStreamStubHook extends StubHook {
  static {
    __name(this, "_WritableStreamStubHook");
  }
  state;
  // undefined when disposed
  // Creates a new WritableStreamStubHook that is not duplicated from an existing hook.
  static create(stream) {
    let writer = stream.getWriter();
    return new _WritableStreamStubHook({ refcount: 1, writer, closed: false });
  }
  constructor(state, dupFrom) {
    super();
    this.state = state;
    if (dupFrom) {
      ++state.refcount;
    }
  }
  getState() {
    if (this.state) {
      return this.state;
    } else {
      throw new Error("Attempted to use a WritableStreamStubHook after it was disposed.");
    }
  }
  call(path2, args) {
    try {
      let state = this.getState();
      if (path2.length !== 1 || typeof path2[0] !== "string") {
        throw new Error("WritableStream stub only supports direct method calls");
      }
      const method = path2[0];
      if (method !== "write" && method !== "close" && method !== "abort") {
        args.dispose();
        throw new Error(`Unknown WritableStream method: ${method}`);
      }
      if (method === "close" || method === "abort") {
        state.closed = true;
      }
      let func = state.writer[method];
      let promise = args.deliverCall(func, state.writer);
      return new PromiseStubHook(promise.then((payload) => new PayloadStubHook(payload)));
    } catch (err) {
      return new ErrorStubHook(err);
    }
  }
  map(path2, captures, instructions) {
    for (let cap of captures) {
      cap.dispose();
    }
    return new ErrorStubHook(new Error("Cannot use map() on a WritableStream"));
  }
  get(path2) {
    return new ErrorStubHook(new Error("Cannot access properties on a WritableStream stub"));
  }
  dup() {
    let state = this.getState();
    return new _WritableStreamStubHook(state, this);
  }
  pull() {
    return Promise.reject(new Error("Cannot pull a WritableStream stub"));
  }
  ignoreUnhandledRejections() {
  }
  dispose() {
    let state = this.state;
    this.state = void 0;
    if (state) {
      if (--state.refcount === 0) {
        if (!state.closed) {
          state.writer.abort(new Error("WritableStream RPC stub was disposed without calling close()")).catch(() => {
          });
        }
        state.writer.releaseLock();
      }
    }
  }
  onBroken(callback) {
  }
};
var INITIAL_WINDOW = 256 * 1024;
var MAX_WINDOW = 1024 * 1024 * 1024;
var MIN_WINDOW = 64 * 1024;
var STARTUP_GROWTH_FACTOR = 2;
var STEADY_GROWTH_FACTOR = 1.25;
var DECAY_FACTOR = 0.9;
var STARTUP_EXIT_ROUNDS = 3;
var FlowController = class {
  static {
    __name(this, "FlowController");
  }
  constructor(now) {
    this.now = now;
  }
  // The current window size in bytes. The sender blocks when bytesInFlight >= window.
  window = INITIAL_WINDOW;
  // Total bytes currently in flight (sent but not yet acked).
  bytesInFlight = 0;
  // Whether we're still in the startup phase.
  inStartupPhase = true;
  // ----- BDP estimation state (private) -----
  // Total bytes acked so far.
  delivered = 0;
  // Time of most recent ack.
  deliveredTime = 0;
  // Time when the very first ack was received.
  firstAckTime = 0;
  firstAckDelivered = 0;
  // Global minimum RTT observed (milliseconds).
  minRtt = Infinity;
  // For startup exit: count of consecutive RTT rounds where the window didn't meaningfully grow.
  roundsWithoutIncrease = 0;
  // Window size at the start of the current round, for startup exit detection.
  lastRoundWindow = 0;
  // Time when the current round started.
  roundStartTime = 0;
  // Called when a write of `size` bytes is about to be sent. Returns a token that must be
  // passed to onAck() when the ack arrives, and whether the sender should block (window full).
  onSend(size) {
    this.bytesInFlight += size;
    let token = {
      sentTime: this.now(),
      size,
      deliveredAtSend: this.delivered,
      deliveredTimeAtSend: this.deliveredTime,
      windowAtSend: this.window,
      windowFullAtSend: this.bytesInFlight >= this.window
    };
    return { token, shouldBlock: token.windowFullAtSend };
  }
  // Called when a previously-sent write fails. Restores bytesInFlight without updating
  // any BDP estimates.
  onError(token) {
    this.bytesInFlight -= token.size;
  }
  // Called when an ack is received for a previously-sent write. Updates BDP estimates and
  // the window. Returns whether a blocked sender should now unblock.
  onAck(token) {
    let ackTime = this.now();
    this.delivered += token.size;
    this.deliveredTime = ackTime;
    this.bytesInFlight -= token.size;
    let rtt = ackTime - token.sentTime;
    this.minRtt = Math.min(this.minRtt, rtt);
    if (this.firstAckTime === 0) {
      this.firstAckTime = ackTime;
      this.firstAckDelivered = this.delivered;
    } else {
      let baseTime;
      let baseDelivered;
      if (token.deliveredTimeAtSend === 0) {
        baseTime = this.firstAckTime;
        baseDelivered = this.firstAckDelivered;
      } else {
        baseTime = token.deliveredTimeAtSend;
        baseDelivered = token.deliveredAtSend;
      }
      let interval = ackTime - baseTime;
      let bytes = this.delivered - baseDelivered;
      let bandwidth = bytes / interval;
      let growthFactor = this.inStartupPhase ? STARTUP_GROWTH_FACTOR : STEADY_GROWTH_FACTOR;
      let newWindow = bandwidth * this.minRtt * growthFactor;
      newWindow = Math.min(newWindow, token.windowAtSend * growthFactor);
      if (token.windowFullAtSend) {
        newWindow = Math.max(newWindow, token.windowAtSend * DECAY_FACTOR);
      } else {
        newWindow = Math.max(newWindow, this.window);
      }
      this.window = Math.max(Math.min(newWindow, MAX_WINDOW), MIN_WINDOW);
      if (this.inStartupPhase && token.sentTime >= this.roundStartTime) {
        if (this.window > this.lastRoundWindow * STEADY_GROWTH_FACTOR) {
          this.roundsWithoutIncrease = 0;
        } else {
          if (++this.roundsWithoutIncrease >= STARTUP_EXIT_ROUNDS) {
            this.inStartupPhase = false;
          }
        }
        this.roundStartTime = ackTime;
        this.lastRoundWindow = this.window;
      }
    }
    return this.bytesInFlight < this.window;
  }
};
function createWritableStreamFromHook(hook) {
  let pendingError = void 0;
  let hookDisposed = false;
  let fc = new FlowController(() => performance.now());
  let windowResolve;
  let windowReject;
  const disposeHook = /* @__PURE__ */ __name(() => {
    if (!hookDisposed) {
      hookDisposed = true;
      hook.dispose();
    }
  }, "disposeHook");
  return new WritableStream({
    write(chunk, controller) {
      if (pendingError !== void 0) {
        throw pendingError;
      }
      const payload = RpcPayload.fromAppParams([chunk]);
      const { promise, size } = hook.stream(["write"], payload);
      if (size === void 0) {
        return promise.catch((err) => {
          if (pendingError === void 0) {
            pendingError = err;
          }
          throw err;
        });
      } else {
        let { token, shouldBlock } = fc.onSend(size);
        promise.then(() => {
          let hasCapacity = fc.onAck(token);
          if (hasCapacity && windowResolve) {
            windowResolve();
            windowResolve = void 0;
            windowReject = void 0;
          }
        }, (err) => {
          fc.onError(token);
          if (pendingError === void 0) {
            pendingError = err;
            controller.error(err);
            disposeHook();
          }
          if (windowReject) {
            windowReject(err);
            windowResolve = void 0;
            windowReject = void 0;
          }
        });
        if (shouldBlock) {
          return new Promise((resolve, reject) => {
            windowResolve = resolve;
            windowReject = reject;
          });
        }
      }
    },
    async close() {
      if (pendingError !== void 0) {
        disposeHook();
        throw pendingError;
      }
      const { promise } = hook.stream(["close"], RpcPayload.fromAppParams([]));
      try {
        await promise;
      } catch (err) {
        throw pendingError ?? err;
      } finally {
        disposeHook();
      }
    },
    abort(reason) {
      if (pendingError !== void 0) {
        return;
      }
      pendingError = reason ?? new Error("WritableStream was aborted");
      if (windowReject) {
        windowReject(pendingError);
        windowResolve = void 0;
        windowReject = void 0;
      }
      const { promise } = hook.stream(["abort"], RpcPayload.fromAppParams([reason]));
      promise.then(() => disposeHook(), () => disposeHook());
    }
  });
}
__name(createWritableStreamFromHook, "createWritableStreamFromHook");
var ReadableStreamStubHook = class _ReadableStreamStubHook extends StubHook {
  static {
    __name(this, "_ReadableStreamStubHook");
  }
  state;
  // undefined when disposed
  // Creates a new ReadableStreamStubHook.
  static create(stream) {
    return new _ReadableStreamStubHook({ refcount: 1, stream, canceled: false });
  }
  constructor(state, dupFrom) {
    super();
    this.state = state;
    if (dupFrom) {
      ++state.refcount;
    }
  }
  call(path2, args) {
    args.dispose();
    return new ErrorStubHook(new Error("Cannot call methods on a ReadableStream stub"));
  }
  map(path2, captures, instructions) {
    for (let cap of captures) {
      cap.dispose();
    }
    return new ErrorStubHook(new Error("Cannot use map() on a ReadableStream"));
  }
  get(path2) {
    return new ErrorStubHook(new Error("Cannot access properties on a ReadableStream stub"));
  }
  dup() {
    let state = this.state;
    if (!state) {
      throw new Error("Attempted to dup a ReadableStreamStubHook after it was disposed.");
    }
    return new _ReadableStreamStubHook(state, this);
  }
  pull() {
    return Promise.reject(new Error("Cannot pull a ReadableStream stub"));
  }
  ignoreUnhandledRejections() {
  }
  dispose() {
    let state = this.state;
    this.state = void 0;
    if (state) {
      if (--state.refcount === 0) {
        if (!state.canceled) {
          state.canceled = true;
          if (!state.stream.locked) {
            state.stream.cancel(
              new Error("ReadableStream RPC stub was disposed without being consumed")
            ).catch(() => {
            });
          }
        }
      }
    }
  }
  onBroken(callback) {
  }
};
streamImpl.createWritableStreamHook = WritableStreamStubHook.create;
streamImpl.createWritableStreamFromHook = createWritableStreamFromHook;
streamImpl.createReadableStreamHook = ReadableStreamStubHook.create;

// ../node_modules/@cloudflare/sandbox/dist/sandbox-D0rNqxlr.js
import { RpcTarget as RpcTarget$1, tracing } from "cloudflare:workers";
import path from "node:path/posix";
var SandboxError = class extends Error {
  static {
    __name(this, "SandboxError");
  }
  constructor(errorResponse, options) {
    super(errorResponse.message, options);
    this.errorResponse = errorResponse;
    this.name = "SandboxError";
  }
  get code() {
    return this.errorResponse.code;
  }
  get context() {
    return this.errorResponse.context;
  }
  get httpStatus() {
    return this.errorResponse.httpStatus;
  }
  get operation() {
    return this.errorResponse.operation;
  }
  get suggestion() {
    return this.errorResponse.suggestion;
  }
  get timestamp() {
    return this.errorResponse.timestamp;
  }
  get documentation() {
    return this.errorResponse.documentation;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      httpStatus: this.httpStatus,
      operation: this.operation,
      suggestion: this.suggestion,
      timestamp: this.timestamp,
      documentation: this.documentation,
      stack: this.stack
    };
  }
};
var OperationInterruptedError = class extends SandboxError {
  static {
    __name(this, "OperationInterruptedError");
  }
  constructor(errorResponse, options) {
    super(errorResponse, options);
    this.name = "OperationInterruptedError";
  }
  get reason() {
    return this.context.reason;
  }
};
var SUPERSEDED_ISOLATE_PATTERN = /reset because its code was updated|this script has been upgraded/i;
var CONNECTION_LOST_PATTERN = /network connection lost/i;
var DO_STORAGE_STARTUP_RESET_PATTERN = /internal error while starting up durable object storage caused object to be reset/i;
function errorMessageOf(error) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}
__name(errorMessageOf, "errorMessageOf");
function* selfAndCauses(error) {
  let current = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    yield current;
    current = typeof current === "object" ? current.cause : void 0;
  }
}
__name(selfAndCauses, "selfAndCauses");
function isErrorRetryable(error) {
  if (typeof error !== "object" || error === null) return false;
  const message = String(error);
  const typed = error;
  return typed.retryable === true && typed.overloaded !== true && !message.includes("Durable Object is overloaded");
}
__name(isErrorRetryable, "isErrorRetryable");
function isPlatformTransientError(error) {
  for (const candidate of selfAndCauses(error)) {
    const message = errorMessageOf(candidate);
    if (SUPERSEDED_ISOLATE_PATTERN.test(message)) return true;
    if (CONNECTION_LOST_PATTERN.test(message)) return true;
    if (DO_STORAGE_STARTUP_RESET_PATTERN.test(message)) return true;
    if (isErrorRetryable(candidate)) return true;
  }
  return false;
}
__name(isPlatformTransientError, "isPlatformTransientError");
var DISABLE_SESSION_TOKEN = "__DISABLE_SESSION__";
var SandboxSecurityError = class extends Error {
  static {
    __name(this, "SandboxSecurityError");
  }
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "SandboxSecurityError";
  }
};
function validatePort(port) {
  if (!Number.isInteger(port)) return false;
  if (port < 1024 || port > 65535) return false;
  if ([3e3].includes(port)) return false;
  return true;
}
__name(validatePort, "validatePort");
function sanitizeSandboxId(id) {
  if (!id || id.length > 63) throw new SandboxSecurityError("Sandbox ID must be 1-63 characters long.", "INVALID_SANDBOX_ID_LENGTH");
  if (id.startsWith("-") || id.endsWith("-")) throw new SandboxSecurityError("Sandbox ID cannot start or end with hyphens (DNS requirement).", "INVALID_SANDBOX_ID_HYPHENS");
  const reservedNames = [
    "www",
    "api",
    "admin",
    "root",
    "system",
    "cloudflare",
    "workers"
  ];
  const lowerCaseId = id.toLowerCase();
  if (reservedNames.includes(lowerCaseId)) throw new SandboxSecurityError(`Reserved sandbox ID '${id}' is not allowed.`, "RESERVED_SANDBOX_ID");
  return id;
}
__name(sanitizeSandboxId, "sanitizeSandboxId");
function isR2Bucket(value) {
  return typeof value === "object" && value !== null && "put" in value && typeof value.put === "function" && "get" in value && typeof value.get === "function" && "head" in value && typeof value.head === "function" && "delete" in value && typeof value.delete === "function" && "list" in value && typeof value.list === "function";
}
__name(isR2Bucket, "isR2Bucket");
async function proxyTerminal(stub, sessionId, request, options) {
  if (!sessionId || typeof sessionId !== "string") throw new Error("sessionId is required for terminal access");
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") throw new Error("terminal() requires a WebSocket upgrade request");
  const params = new URLSearchParams({ sessionId });
  if (options?.cols) params.set("cols", String(options.cols));
  if (options?.rows) params.set("rows", String(options.rows));
  if (options?.shell) params.set("shell", options.shell);
  const ptyUrl = `http://localhost/ws/pty?${params}`;
  const ptyRequest = new Request(ptyUrl, request);
  return stub.fetch(switchPort(ptyRequest, 3e3));
}
__name(proxyTerminal, "proxyTerminal");
var XML_NS = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"';
var XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';
function escapeXML(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
__name(escapeXML, "escapeXML");
function xmlResponse(body, status = 200) {
  return new Response(XML_DECL + body, {
    status,
    headers: { "Content-Type": "application/xml" }
  });
}
__name(xmlResponse, "xmlResponse");
function normalizeObjectKey(value) {
  return value.replace(/^\/+/, "");
}
__name(normalizeObjectKey, "normalizeObjectKey");
function decodeObjectKey(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
__name(decodeObjectKey, "decodeObjectKey");
function trimTrailingSlashes(s) {
  let end = s.length;
  while (end > 0 && s[end - 1] === "/") end--;
  return s.slice(0, end);
}
__name(trimTrailingSlashes, "trimTrailingSlashes");
function normalizeMountPrefix(prefix) {
  if (!prefix) return void 0;
  return trimTrailingSlashes(normalizeObjectKey(prefix)) || void 0;
}
__name(normalizeMountPrefix, "normalizeMountPrefix");
function parsePath(pathname) {
  const stripped = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  if (!stripped) return null;
  const slash = stripped.indexOf("/");
  if (slash === -1) return {
    bucket: stripped,
    key: ""
  };
  return {
    bucket: stripped.slice(0, slash),
    key: normalizeObjectKey(stripped.slice(slash + 1))
  };
}
__name(parsePath, "parsePath");
function resolveR2Bucket(env$1, name) {
  if (typeof env$1 !== "object" || env$1 === null) return null;
  const val = env$1[name];
  return isR2Bucket(val) ? val : null;
}
__name(resolveR2Bucket, "resolveR2Bucket");
function parseRange(header) {
  if (!header) return void 0;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return void 0;
  const start = m[1] ? parseInt(m[1], 10) : void 0;
  const end = m[2] ? parseInt(m[2], 10) : void 0;
  if (start === void 0 && end !== void 0) return { suffix: end };
  if (start !== void 0 && end !== void 0) return {
    offset: start,
    length: end - start + 1
  };
  if (start !== void 0) return { offset: start };
}
__name(parseRange, "parseRange");
function buildListObjectsV2Xml(bucketName, prefix, delimiter, maxKeys, result) {
  const contents = result.objects.map((obj) => `<Contents><Key>${escapeXML(obj.key)}</Key><LastModified>${obj.uploaded.toISOString()}</LastModified><ETag>${escapeXML(obj.httpEtag)}</ETag><Size>${obj.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join("");
  const commonPrefixes = result.delimitedPrefixes.map((p) => `<CommonPrefixes><Prefix>${escapeXML(p)}</Prefix></CommonPrefixes>`).join("");
  const nextToken = result.truncated && result.cursor ? `<NextContinuationToken>${escapeXML(result.cursor)}</NextContinuationToken>` : "";
  const keyCount = result.objects.length + result.delimitedPrefixes.length;
  return `<ListBucketResult ${XML_NS}><Name>${escapeXML(bucketName)}</Name><Prefix>${escapeXML(prefix)}</Prefix><KeyCount>${keyCount}</KeyCount><MaxKeys>${maxKeys}</MaxKeys>` + (delimiter ? `<Delimiter>${escapeXML(delimiter)}</Delimiter>` : "") + `<IsTruncated>${result.truncated}</IsTruncated>` + nextToken + contents + commonPrefixes + `</ListBucketResult>`;
}
__name(buildListObjectsV2Xml, "buildListObjectsV2Xml");
function buildLocationXml() {
  return `<LocationConstraint ${XML_NS}/>`;
}
__name(buildLocationXml, "buildLocationXml");
function buildInitiateMultipartUploadXml(bucketName, key, uploadId) {
  return `<InitiateMultipartUploadResult ${XML_NS}><Bucket>${escapeXML(bucketName)}</Bucket><Key>${escapeXML(key)}</Key><UploadId>${escapeXML(uploadId)}</UploadId></InitiateMultipartUploadResult>`;
}
__name(buildInitiateMultipartUploadXml, "buildInitiateMultipartUploadXml");
function buildCompleteMultipartUploadXml(bucketName, key, etag) {
  return `<CompleteMultipartUploadResult ${XML_NS}><Location>http://r2.internal/${escapeXML(bucketName)}/${escapeXML(key)}</Location><Bucket>${escapeXML(bucketName)}</Bucket><Key>${escapeXML(key)}</Key><ETag>${escapeXML(etag)}</ETag></CompleteMultipartUploadResult>`;
}
__name(buildCompleteMultipartUploadXml, "buildCompleteMultipartUploadXml");
function buildCopyObjectXml(etag, uploaded) {
  return `<CopyObjectResult ${XML_NS}><LastModified>${uploaded.toISOString()}</LastModified><ETag>${escapeXML(etag)}</ETag></CopyObjectResult>`;
}
__name(buildCopyObjectXml, "buildCopyObjectXml");
function extractXmlTagContent(segment, tagName) {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const start = segment.indexOf(openTag);
  if (start === -1) return null;
  const contentStart = start + openTag.length;
  const end = segment.indexOf(closeTag, contentStart);
  if (end === -1) return null;
  return segment.slice(contentStart, end);
}
__name(extractXmlTagContent, "extractXmlTagContent");
function parseCompleteMultipartUploadBody(body) {
  const parts = [];
  let pos = 0;
  while (pos < body.length) {
    const start = body.indexOf("<Part>", pos);
    if (start === -1) break;
    const end = body.indexOf("</Part>", start + 6);
    if (end === -1) break;
    const segment = body.slice(start, end + 7);
    pos = end + 7;
    const partNumberText = extractXmlTagContent(segment, "PartNumber");
    const etagText = extractXmlTagContent(segment, "ETag");
    const partNumber = partNumberText ? parseInt(partNumberText, 10) : NaN;
    if (Number.isFinite(partNumber) && etagText) parts.push({
      partNumber,
      etag: etagText.replace(/^"|"$/g, "")
    });
  }
  return parts;
}
__name(parseCompleteMultipartUploadBody, "parseCompleteMultipartUploadBody");
function buildResponseHeaders(obj) {
  const headers = new Headers();
  headers.set("ETag", obj.httpEtag);
  headers.set("Content-Length", String(obj.size));
  headers.set("Last-Modified", obj.uploaded.toUTCString());
  headers.set("Accept-Ranges", "bytes");
  if (obj.httpMetadata?.contentType) headers.set("Content-Type", obj.httpMetadata.contentType);
  if (obj.httpMetadata?.contentDisposition) headers.set("Content-Disposition", obj.httpMetadata.contentDisposition);
  if (obj.httpMetadata?.contentEncoding) headers.set("Content-Encoding", obj.httpMetadata.contentEncoding);
  if (obj.httpMetadata?.contentLanguage) headers.set("Content-Language", obj.httpMetadata.contentLanguage);
  if (obj.httpMetadata?.cacheControl) headers.set("Cache-Control", obj.httpMetadata.cacheControl);
  return headers;
}
__name(buildResponseHeaders, "buildResponseHeaders");
function buildContentRange(range, totalSize) {
  if ("suffix" in range) return `bytes ${Math.max(0, totalSize - range.suffix)}-${totalSize - 1}/${totalSize}`;
  const start = range.offset ?? 0;
  return `bytes ${start}-${range.length !== void 0 ? start + range.length - 1 : totalSize - 1}/${totalSize}`;
}
__name(buildContentRange, "buildContentRange");
function getRangeContentLength(range, totalSize) {
  if ("suffix" in range) return Math.min(range.suffix, totalSize);
  const start = range.offset ?? 0;
  if (start >= totalSize) return 0;
  const requestedLength = range.length !== void 0 ? range.length : totalSize - start;
  return Math.min(requestedLength, totalSize - start);
}
__name(getRangeContentLength, "getRangeContentLength");
function extractHttpMetadata(request) {
  const meta = {};
  const ct = request.headers.get("Content-Type");
  if (ct) meta.contentType = ct;
  const cd = request.headers.get("Content-Disposition");
  if (cd) meta.contentDisposition = cd;
  const ce = request.headers.get("Content-Encoding");
  if (ce) meta.contentEncoding = ce;
  const cl = request.headers.get("Content-Language");
  if (cl) meta.contentLanguage = cl;
  const cc = request.headers.get("Cache-Control");
  if (cc) meta.cacheControl = cc;
  return meta;
}
__name(extractHttpMetadata, "extractHttpMetadata");
function parseCopySource(header) {
  const sourcePath = header.split("?")[0] ?? "";
  if (!sourcePath) return null;
  const decoded = decodeURIComponent(sourcePath);
  const parsed = parsePath(decoded.startsWith("/") ? decoded : `/${decoded}`);
  return parsed ? {
    bucket: parsed.bucket,
    key: normalizeObjectKey(parsed.key)
  } : null;
}
__name(parseCopySource, "parseCopySource");
function normalizeStorageClass(storageClass) {
  if (storageClass === "Standard" || storageClass === "InfrequentAccess") return storageClass;
}
__name(normalizeStorageClass, "normalizeStorageClass");
async function putRequestBody(r2, key, request, options) {
  const contentLength = request.headers.get("Content-Length");
  const length = contentLength ? Number.parseInt(contentLength, 10) : NaN;
  if (!Number.isFinite(length) || length < 0) return new Response("Bad Request: missing or invalid Content-Length", { status: 400 });
  if (length === 0) return r2.put(key, new Uint8Array(0), options);
  if (!request.body) return new Response("Bad Request: missing request body", { status: 400 });
  const { readable, writable } = new FixedLengthStream(length);
  const pipe = request.body.pipeTo(writable);
  const result = await r2.put(key, readable, options);
  await pipe;
  return result;
}
__name(putRequestBody, "putRequestBody");
async function handleListObjects(r2, bucketName, url, mountPrefix) {
  const queryPrefix = normalizeObjectKey(url.searchParams.get("prefix") ?? "");
  const delimiter = url.searchParams.get("delimiter") ?? "";
  const maxKeys = Math.min(parseInt(url.searchParams.get("max-keys") ?? "1000", 10) || 1e3, 1e3);
  const continuationToken = url.searchParams.get("continuation-token") ?? void 0;
  const listOpts = {
    prefix: (mountPrefix ? `${mountPrefix}/${queryPrefix}` : queryPrefix) || void 0,
    delimiter: delimiter || void 0,
    limit: maxKeys,
    cursor: continuationToken
  };
  const result = await r2.list(listOpts);
  const stripKey = mountPrefix ? (k) => k.startsWith(`${mountPrefix}/`) ? k.slice(mountPrefix.length + 1) : k : (k) => k;
  return xmlResponse(buildListObjectsV2Xml(bucketName, queryPrefix, delimiter, maxKeys, {
    objects: result.objects.map((obj) => ({
      key: stripKey(obj.key),
      uploaded: obj.uploaded,
      httpEtag: obj.httpEtag,
      size: obj.size
    })),
    delimitedPrefixes: result.delimitedPrefixes.map(stripKey),
    truncated: result.truncated,
    cursor: result.truncated ? result.cursor : void 0
  }));
}
__name(handleListObjects, "handleListObjects");
async function handleHeadObject(r2, key) {
  const obj = await r2.head(key);
  if (!obj) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 200,
    headers: buildResponseHeaders(obj)
  });
}
__name(handleHeadObject, "handleHeadObject");
async function handleGetObject(r2, key, request) {
  const range = parseRange(request.headers.get("Range"));
  if (!range) {
    const obj = await r2.get(key);
    if (!obj) return new Response(null, { status: 404 });
    return new Response(obj.body, {
      status: 200,
      headers: buildResponseHeaders(obj)
    });
  }
  const [headObj, rangeObj] = await Promise.all([r2.head(key), r2.get(key, { range })]);
  if (!headObj || !rangeObj) return new Response(null, { status: 404 });
  const headers = buildResponseHeaders(rangeObj);
  headers.set("Content-Range", buildContentRange(range, headObj.size));
  headers.set("Content-Length", String(getRangeContentLength(range, headObj.size)));
  return new Response(rangeObj.body, {
    status: 206,
    headers
  });
}
__name(handleGetObject, "handleGetObject");
async function handlePutObject(r2, bucketName, key, request, env$1, buckets) {
  const copySourceHeader = request.headers.get("x-amz-copy-source");
  if (copySourceHeader) {
    const copySource = parseCopySource(copySourceHeader);
    if (!copySource || !copySource.key) return new Response("Bad Request: invalid x-amz-copy-source", { status: 400 });
    if (!Object.hasOwn(buckets, copySource.bucket)) return new Response(`Access to R2 bucket "${copySource.bucket}" is not permitted. Call mountBucket() with this bucket before accessing it.`, { status: 403 });
    const sourceParams = buckets[copySource.bucket];
    const sourceBucket = copySource.bucket === bucketName ? r2 : resolveR2Bucket(env$1, copySource.bucket);
    if (!sourceBucket) return new Response(`R2 binding "${copySource.bucket}" not found in Worker env. Ensure the binding name matches the bucket name passed to mountBucket().`, { status: 500 });
    const sourcePrefix = normalizeMountPrefix(sourceParams.prefix);
    const sourceKey = sourcePrefix ? `${sourcePrefix}/${copySource.key}` : copySource.key;
    const sourceObject = await sourceBucket.get(sourceKey);
    if (!sourceObject) return new Response(null, { status: 404 });
    const httpMetadata = request.headers.get("x-amz-metadata-directive")?.toUpperCase() === "REPLACE" ? extractHttpMetadata(request) : sourceObject.httpMetadata;
    const result$1 = await r2.put(key, sourceObject.body, {
      httpMetadata,
      customMetadata: sourceObject.customMetadata,
      storageClass: normalizeStorageClass(sourceObject.storageClass)
    });
    return xmlResponse(buildCopyObjectXml(result$1.httpEtag, result$1.uploaded));
  }
  const result = await putRequestBody(r2, key, request, { httpMetadata: extractHttpMetadata(request) });
  if (result instanceof Response) return result;
  const headers = new Headers();
  headers.set("ETag", result.httpEtag);
  return new Response(null, {
    status: 200,
    headers
  });
}
__name(handlePutObject, "handlePutObject");
async function handleDeleteObject(r2, key) {
  await r2.delete(key);
  return new Response(null, { status: 204 });
}
__name(handleDeleteObject, "handleDeleteObject");
async function handleCreateMultipartUpload(r2, bucketName, key, request) {
  const httpMetadata = extractHttpMetadata(request);
  return xmlResponse(buildInitiateMultipartUploadXml(bucketName, key, (await r2.createMultipartUpload(key, { httpMetadata })).uploadId));
}
__name(handleCreateMultipartUpload, "handleCreateMultipartUpload");
async function handleUploadPart(r2, key, url, request) {
  const uploadId = url.searchParams.get("uploadId") ?? "";
  const partNumber = parseInt(url.searchParams.get("partNumber") ?? "0", 10);
  if (!uploadId || !partNumber) return new Response("Bad Request: missing uploadId or partNumber", { status: 400 });
  if (!request.body) return new Response("Bad Request: missing request body", { status: 400 });
  const contentLength = request.headers.get("Content-Length");
  const partLength = contentLength ? Number.parseInt(contentLength, 10) : NaN;
  if (!Number.isFinite(partLength) || partLength < 0) return new Response("Bad Request: missing or invalid Content-Length", { status: 400 });
  const upload2 = r2.resumeMultipartUpload(key, uploadId);
  let part;
  if (partLength === 0) part = await upload2.uploadPart(partNumber, new Uint8Array(0));
  else {
    const { readable, writable } = new FixedLengthStream(partLength);
    const pipe = request.body.pipeTo(writable);
    part = await upload2.uploadPart(partNumber, readable);
    await pipe;
  }
  const headers = new Headers();
  headers.set("ETag", `"${part.etag}"`);
  return new Response(null, {
    status: 200,
    headers
  });
}
__name(handleUploadPart, "handleUploadPart");
async function handleCompleteMultipartUpload(r2, bucketName, key, url, request) {
  const uploadId = url.searchParams.get("uploadId") ?? "";
  if (!uploadId) return new Response("Bad Request: missing uploadId", { status: 400 });
  const r2Parts = parseCompleteMultipartUploadBody(await request.text()).map((p) => ({
    partNumber: p.partNumber,
    etag: p.etag
  }));
  return xmlResponse(buildCompleteMultipartUploadXml(bucketName, key, (await r2.resumeMultipartUpload(key, uploadId).complete(r2Parts)).httpEtag));
}
__name(handleCompleteMultipartUpload, "handleCompleteMultipartUpload");
async function handleAbortMultipartUpload(r2, key, url) {
  const uploadId = url.searchParams.get("uploadId") ?? "";
  if (!uploadId) return new Response("Bad Request: missing uploadId", { status: 400 });
  await r2.resumeMultipartUpload(key, uploadId).abort();
  return new Response(null, { status: 204 });
}
__name(handleAbortMultipartUpload, "handleAbortMultipartUpload");
var r2EgressHandler = /* @__PURE__ */ __name(async (request, env$1, ctx) => {
  const url = new URL(request.url);
  const parsed = parsePath(url.pathname);
  if (!parsed) return new Response("Bad Request: empty path", { status: 400 });
  const { bucket: bucketName, key: encodedKey } = parsed;
  const key = decodeObjectKey(encodedKey);
  if (!ctx.params?.buckets || !(bucketName in ctx.params.buckets)) return new Response(`Access to R2 bucket "${bucketName}" is not permitted. Call mountBucket() with this bucket before accessing it.`, { status: 403 });
  const bucketParams = ctx.params.buckets[bucketName];
  const mountPrefix = normalizeMountPrefix(bucketParams.prefix);
  const readOnly = bucketParams.readOnly ?? false;
  const r2 = resolveR2Bucket(env$1, bucketName);
  if (!r2) return new Response(`R2 binding "${bucketName}" not found in Worker env. Ensure the binding name matches the bucket name passed to mountBucket().`, { status: 500 });
  const { method } = request;
  if (!key) {
    if (method === "GET" && url.searchParams.has("location")) return xmlResponse(buildLocationXml());
    if (method === "GET" && url.searchParams.get("list-type") === "2") return handleListObjects(r2, bucketName, url, mountPrefix);
    if (method === "GET") return handleListObjects(r2, bucketName, url, mountPrefix);
    return new Response("Method Not Allowed", { status: 405 });
  }
  const fullKey = mountPrefix ? `${mountPrefix}/${key}` : key;
  if (readOnly && (method === "PUT" || method === "DELETE" || method === "POST" && (url.searchParams.has("uploads") || url.searchParams.has("uploadId")))) return new Response("Forbidden: bucket mount is read-only", { status: 403 });
  if (method === "POST" && url.searchParams.has("uploads")) return handleCreateMultipartUpload(r2, bucketName, fullKey, request);
  if (method === "POST" && url.searchParams.has("uploadId")) return handleCompleteMultipartUpload(r2, bucketName, fullKey, url, request);
  if (method === "PUT" && url.searchParams.has("partNumber") && url.searchParams.has("uploadId")) return handleUploadPart(r2, fullKey, url, request);
  if (method === "DELETE" && url.searchParams.has("uploadId")) return handleAbortMultipartUpload(r2, fullKey, url);
  switch (method) {
    case "HEAD":
      return handleHeadObject(r2, fullKey);
    case "GET":
      return handleGetObject(r2, fullKey, request);
    case "PUT":
      return handlePutObject(r2, bucketName, fullKey, request, env$1, ctx.params.buckets);
    case "DELETE":
      return handleDeleteObject(r2, fullKey);
    default:
      return new Response("Method Not Allowed", { status: 405 });
  }
}, "r2EgressHandler");
var PER_MOUNT_SUFFIX = ".s3-credential-proxy.internal";
var SELF_TEST_PATH = "/__sandbox_credential_proxy_self_test__";
var DIAGNOSTICS_PATH = "/__sandbox_credential_proxy_diagnostics__";
var DEFAULT_SLOW_REQUEST_MS = 1e3;
var ERROR_RESPONSE_BODY_LIMIT = 2048;
var MAX_DIAGNOSTIC_EVENTS = 500;
var DUMMY_AUTH_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "x-amz-date",
  "x-amz-content-sha256",
  "x-amz-security-token",
  "x-goog-date",
  "x-goog-content-sha256"
]);
var sigV4ClientCache = /* @__PURE__ */ new Map();
var directoryMarkerCache = /* @__PURE__ */ new Map();
var credentialProxyDiagnosticEvents = [];
var credentialProxyDiagnosticEventCount = 0;
function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(toHex, "toHex");
async function sha256Hex(data) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)));
}
__name(sha256Hex, "sha256Hex");
async function hmacSHA256(key, data) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}
__name(hmacSHA256, "hmacSHA256");
function detectS3Region(provider, endpoint) {
  if (provider === "r2") return "auto";
  try {
    const host = new URL(endpoint).hostname;
    const m = host.match(/s3[.-]([a-z0-9-]+)\.amazonaws\.com/);
    if (m && m[1] !== "amazonaws") return m[1];
    if (host === "s3.amazonaws.com") return "us-east-1";
  } catch {
  }
  return "auto";
}
__name(detectS3Region, "detectS3Region");
function buildCleanHeaders(original) {
  const clean = new Headers();
  for (const [k, v] of original) {
    const lower = k.toLowerCase();
    if (!DUMMY_AUTH_HEADERS.has(lower) && lower !== "host") clean.set(k, v);
  }
  const contentSHA256 = original.get("x-amz-content-sha256");
  if (contentSHA256 && isValidContentSHA256(contentSHA256)) clean.set("x-amz-content-sha256", contentSHA256);
  return clean;
}
__name(buildCleanHeaders, "buildCleanHeaders");
function isValidContentSHA256(value) {
  return value === "UNSIGNED-PAYLOAD" || /^[a-fA-F0-9]{64}$/.test(value);
}
__name(isValidContentSHA256, "isValidContentSHA256");
function getCredentialProxyDebugConfig(env$1) {
  const envRecord = env$1;
  const enabled = envRecord.SANDBOX_CREDENTIAL_PROXY_DEBUG === "true";
  const diagnosticsEndpointEnabled = envRecord.SANDBOX_CREDENTIAL_PROXY_DIAGNOSTICS_ENDPOINT === "true";
  const configuredSlowRequestMs = Number(envRecord.SANDBOX_CREDENTIAL_PROXY_SLOW_REQUEST_MS);
  return {
    diagnosticsEndpointEnabled,
    enabled,
    slowRequestMs: Number.isFinite(configuredSlowRequestMs) && configuredSlowRequestMs >= 0 ? configuredSlowRequestMs : DEFAULT_SLOW_REQUEST_MS
  };
}
__name(getCredentialProxyDebugConfig, "getCredentialProxyDebugConfig");
function recordCredentialProxyDiagnosticEvent(event) {
  credentialProxyDiagnosticEvents.push(event);
  credentialProxyDiagnosticEventCount++;
  while (credentialProxyDiagnosticEvents.length > MAX_DIAGNOSTIC_EVENTS) credentialProxyDiagnosticEvents.shift();
}
__name(recordCredentialProxyDiagnosticEvent, "recordCredentialProxyDiagnosticEvent");
function getCredentialProxyDiagnosticsResponse(url, containerId) {
  const since = Number(url.searchParams.get("since") ?? "0");
  const bufferStartCount = credentialProxyDiagnosticEventCount - credentialProxyDiagnosticEvents.length;
  const events = credentialProxyDiagnosticEvents.filter((event, index) => {
    if (event.containerId !== containerId) return false;
    return !Number.isFinite(since) || bufferStartCount + index >= since;
  });
  return Response.json({
    nextCursor: credentialProxyDiagnosticEventCount,
    events
  });
}
__name(getCredentialProxyDiagnosticsResponse, "getCredentialProxyDiagnosticsResponse");
async function withCredentialProxyDiagnostics(requestInfo, debugConfig, containerId, path$1, operation) {
  const started = Date.now();
  try {
    const response = await operation();
    const durationMs = Date.now() - started;
    if (debugConfig.enabled) recordCredentialProxyDiagnosticEvent({
      ...requestInfo,
      containerId,
      durationMs,
      ok: response.ok,
      path: path$1,
      status: response.status,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (debugConfig.enabled || durationMs >= debugConfig.slowRequestMs) console.info("sandbox.s3_credential_proxy.request", {
      ...requestInfo,
      durationMs,
      ok: response.ok,
      status: response.status,
      responseContentLength: response.headers.get("content-length")
    });
    if (!response.ok) {
      const responseForLog = response.clone();
      const requestInfoSnapshot = { ...requestInfo };
      responseForLog.text().then((body) => {
        console.warn("sandbox.s3_credential_proxy.upstream_error", {
          ...requestInfoSnapshot,
          durationMs,
          status: response.status,
          statusText: response.statusText,
          errorBody: body.slice(0, ERROR_RESPONSE_BODY_LIMIT)
        });
      }).catch(() => {
      });
    }
    return response;
  } catch (error) {
    const durationMs = Date.now() - started;
    console.warn("sandbox.s3_credential_proxy.request_error", {
      ...requestInfo,
      durationMs,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
__name(withCredentialProxyDiagnostics, "withCredentialProxyDiagnostics");
function getSigV4Client(mountId, endpoint, provider, credentials, region) {
  const cached = sigV4ClientCache.get(mountId);
  if (cached && cached.accessKeyId === credentials.accessKeyId && cached.secretAccessKey === credentials.secretAccessKey && cached.endpoint === endpoint && cached.provider === provider && cached.region === region) return cached.client;
  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    service: "s3",
    region,
    retries: 0
  });
  sigV4ClientCache.set(mountId, {
    client,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    endpoint,
    provider,
    region
  });
  return client;
}
__name(getSigV4Client, "getSigV4Client");
function encodeCanonicalQueryPart(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
__name(encodeCanonicalQueryPart, "encodeCanonicalQueryPart");
function getCanonicalURI(url) {
  return url.pathname.split("/").map((segment) => segment.split(/(%[0-9A-Fa-f]{2})/g).map((part) => /^%[0-9A-Fa-f]{2}$/.test(part) ? part.toUpperCase() : encodeCanonicalQueryPart(part)).join("")).join("/");
}
__name(getCanonicalURI, "getCanonicalURI");
function getCanonicalQueryString(url) {
  const query = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  if (!query) return "";
  return query.split("&").map((part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) return [part, ""];
    return [part.slice(0, separatorIndex), part.slice(separatorIndex + 1)];
  }).map(([key, value]) => [encodeCanonicalQueryPart(decodeURIEncodedQueryPart(key)), encodeCanonicalQueryPart(decodeURIEncodedQueryPart(value))]).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
    return 0;
  }).map(([key, value]) => `${key}=${value}`).join("&");
}
__name(getCanonicalQueryString, "getCanonicalQueryString");
function decodeURIEncodedQueryPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
__name(decodeURIEncodedQueryPart, "decodeURIEncodedQueryPart");
function getSigV4PayloadHash(headers) {
  const existingHash = headers.get("x-amz-content-sha256");
  if (existingHash && existingHash !== "UNSIGNED-PAYLOAD") return {
    hash: existingHash,
    mode: "signed"
  };
  return {
    hash: "UNSIGNED-PAYLOAD",
    mode: "unsigned"
  };
}
__name(getSigV4PayloadHash, "getSigV4PayloadHash");
function isZeroLengthDirectoryMarkerPUT(request, realPath) {
  return request.method.toUpperCase() === "PUT" && request.headers.get("content-length") === "0" && realPath.endsWith("/");
}
__name(isZeroLengthDirectoryMarkerPUT, "isZeroLengthDirectoryMarkerPUT");
function isDirectoryMarkerHEAD(request) {
  return request.method.toUpperCase() === "HEAD";
}
__name(isDirectoryMarkerHEAD, "isDirectoryMarkerHEAD");
function getDirectoryMarkerCacheKey(mountId, realPath) {
  return `${mountId}:${realPath.replace(/\/+$/, "")}`;
}
__name(getDirectoryMarkerCacheKey, "getDirectoryMarkerCacheKey");
function getDirectoryMarkerResponseHeaders(request) {
  const headers = [
    ["Accept-Ranges", "bytes"],
    ["Content-Length", "0"],
    ["ETag", '"d41d8cd98f00b204e9800998ecf8427e"'],
    ["Last-Modified", (/* @__PURE__ */ new Date()).toUTCString()]
  ];
  const contentType = request.headers.get("content-type");
  if (contentType) headers.push(["Content-Type", contentType]);
  for (const [name, value] of request.headers) if (name.toLowerCase().startsWith("x-amz-meta-")) headers.push([name, value]);
  return headers;
}
__name(getDirectoryMarkerResponseHeaders, "getDirectoryMarkerResponseHeaders");
function normalizePrefix(prefix) {
  if (!prefix) return void 0;
  return prefix.replace(/^\/+/, "").replace(/\/+$/, "");
}
__name(normalizePrefix, "normalizePrefix");
function getObjectKeyForPath(realPath, bucket) {
  const pathSegments = realPath.split("/").filter(Boolean);
  if (pathSegments[0] !== bucket) return null;
  return pathSegments.slice(1).join("/");
}
__name(getObjectKeyForPath, "getObjectKeyForPath");
function isObjectKeyWithinPrefix(objectKey, prefix) {
  const normalizedPrefix = normalizePrefix(prefix);
  if (!normalizedPrefix) return true;
  return objectKey === normalizedPrefix || objectKey.startsWith(`${normalizedPrefix}/`);
}
__name(isObjectKeyWithinPrefix, "isObjectKeyWithinPrefix");
function parseCopySourceHeader(value) {
  const encodedPath = value.split("?", 1)[0];
  if (!encodedPath) return null;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  const path$1 = decodedPath.startsWith("/") ? decodedPath.slice(1) : decodedPath;
  const separatorIndex = path$1.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === path$1.length - 1) return null;
  return {
    bucket: path$1.slice(0, separatorIndex),
    objectKey: path$1.slice(separatorIndex + 1)
  };
}
__name(parseCopySourceHeader, "parseCopySourceHeader");
function validateCopySourceWithinMountScope(headers, bucket, prefix) {
  const copySources = [["x-amz-copy-source", headers.get("x-amz-copy-source")], ["x-goog-copy-source", headers.get("x-goog-copy-source")]].filter((entry) => entry[1] !== null);
  if (copySources.length > 1) return new Response("Bad Request: multiple copy source headers", { status: 400 });
  if (copySources.length === 0) return null;
  const [headerName, value] = copySources[0];
  const copySource = parseCopySourceHeader(value);
  if (!copySource) return new Response(`Bad Request: invalid ${headerName}`, { status: 400 });
  if (copySource.bucket !== bucket || !isObjectKeyWithinPrefix(copySource.objectKey, prefix)) return new Response("Forbidden: copy source is outside mounted scope", { status: 403 });
  return null;
}
__name(validateCopySourceWithinMountScope, "validateCopySourceWithinMountScope");
function isRequestWithinMountScope(realPath, url, bucket, prefix) {
  const objectKey = getObjectKeyForPath(realPath, bucket);
  if (objectKey === null) return false;
  const requestedPrefix = url.searchParams.get("prefix");
  if (objectKey !== "" && !isObjectKeyWithinPrefix(objectKey, prefix)) return false;
  if (objectKey === "" && normalizePrefix(prefix) !== void 0 && url.search !== "" && requestedPrefix === null) return false;
  if (requestedPrefix !== null) return isObjectKeyWithinPrefix(requestedPrefix, prefix);
  return true;
}
__name(isRequestWithinMountScope, "isRequestWithinMountScope");
function isBucketRootProbe(request, realPath, url, bucket) {
  const method = request.method.toUpperCase();
  return (method === "GET" || method === "HEAD") && url.search === "" && getObjectKeyForPath(realPath, bucket) === "";
}
__name(isBucketRootProbe, "isBucketRootProbe");
function deleteDirectoryMarkerCacheEntry(mountId, realPath) {
  directoryMarkerCache.delete(getDirectoryMarkerCacheKey(mountId, realPath));
}
__name(deleteDirectoryMarkerCacheEntry, "deleteDirectoryMarkerCacheEntry");
function getContentLength(request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) return null;
  const parsed = Number(contentLength);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}
__name(getContentLength, "getContentLength");
function getSigV4ForwardInit(request) {
  const contentLength = getContentLength(request);
  if (contentLength === 0) return { body: new Uint8Array(0) };
  if (contentLength === null || request.body === null) return {};
  const { readable, writable } = new FixedLengthStream(contentLength);
  request.body.pipeTo(writable).catch((error) => {
    writable.abort(error).catch(() => {
    });
  });
  return { body: readable };
}
__name(getSigV4ForwardInit, "getSigV4ForwardInit");
function getGCSHeaders(request) {
  const headers = new Headers();
  for (const [k, v] of request.headers) {
    const lower = k.toLowerCase();
    if (DUMMY_AUTH_HEADERS.has(lower) || lower === "host" || lower === "content-length" || lower === "expect") continue;
    if (lower.startsWith("x-amz-meta-")) {
      headers.set(`x-goog-meta-${lower.slice(11)}`, v);
      continue;
    }
    if (lower.startsWith("x-amz-")) continue;
    headers.set(k, v);
  }
  return headers;
}
__name(getGCSHeaders, "getGCSHeaders");
async function signAndForwardSigV4(request, mountId, endpoint, provider, credentials, requestInfo) {
  const signingStarted = Date.now();
  const region = detectS3Region(provider, endpoint);
  const payload = getSigV4PayloadHash(request.headers);
  const client = getSigV4Client(mountId, endpoint, provider, credentials, region);
  requestInfo.payloadHashMode = payload.mode;
  requestInfo.clientSetupMs = Date.now() - signingStarted;
  const upstreamStarted = Date.now();
  const forwardInit = getSigV4ForwardInit(request);
  requestInfo.bodyPresent = forwardInit?.body !== void 0 || request.body !== null;
  const response = await client.fetch(request, forwardInit);
  requestInfo.upstreamMs = Date.now() - upstreamStarted;
  return response;
}
__name(signAndForwardSigV4, "signAndForwardSigV4");
async function signAndForwardGCS(request, credentials, requestInfo) {
  const url = new URL(request.url);
  const gcsHeaders = getGCSHeaders(request);
  const dateStr = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:-]/g, "").replace(/\.\d+Z$/, "")}Z`;
  const dateOnly = dateStr.slice(0, 8);
  const location = "auto";
  const service = "storage";
  const credentialScope = `${dateOnly}/${location}/${service}/goog4_request`;
  const bodyHash = "UNSIGNED-PAYLOAD";
  const headerEntries = [
    ["host", url.host],
    ["x-goog-content-sha256", bodyHash],
    ["x-goog-date", dateStr]
  ];
  for (const [k, v] of gcsHeaders) headerEntries.push([k.toLowerCase(), v.trim()]);
  headerEntries.sort((a, b) => a[0].localeCompare(b[0]));
  const signedHeaders = headerEntries.map(([k]) => k).join(";");
  const canonicalHeaders = headerEntries.map(([k, v]) => `${k}:${v}
`).join("");
  const stringToSign = [
    "GOOG4-HMAC-SHA256",
    dateStr,
    credentialScope,
    await sha256Hex([
      request.method,
      getCanonicalURI(url),
      getCanonicalQueryString(url),
      canonicalHeaders,
      signedHeaders,
      bodyHash
    ].join("\n"))
  ].join("\n");
  const signature = toHex(await hmacSHA256(await hmacSHA256(await hmacSHA256(await hmacSHA256(await hmacSHA256(new TextEncoder().encode(`GOOG4${credentials.secretAccessKey}`), dateOnly), location), service), "goog4_request"), stringToSign));
  const authorization = `GOOG4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const newHeaders = new Headers(gcsHeaders);
  newHeaders.set("x-goog-date", dateStr);
  newHeaders.set("x-goog-content-sha256", bodyHash);
  newHeaders.set("Authorization", authorization);
  const gcsBody = getContentLength(request) === 0 ? new Uint8Array(0) : request.body;
  const upstreamStarted = Date.now();
  const response = await fetch(new Request(request.url, {
    method: request.method,
    headers: newHeaders,
    body: gcsBody
  }));
  requestInfo.upstreamMs = Date.now() - upstreamStarted;
  return response;
}
__name(signAndForwardGCS, "signAndForwardGCS");
var s3CredentialProxyHandler = /* @__PURE__ */ __name(async (request, env$1, ctx) => {
  const url = new URL(request.url);
  if (url.pathname === SELF_TEST_PATH) return new Response("OK", { status: 200 });
  const debugConfig = getCredentialProxyDebugConfig(env$1);
  if (url.pathname === DIAGNOSTICS_PATH) {
    if (!debugConfig.enabled || !debugConfig.diagnosticsEndpointEnabled) return new Response("Not Found", { status: 404 });
    return getCredentialProxyDiagnosticsResponse(url, ctx.containerId);
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const hostname = url.hostname;
  let mountId;
  let realPath;
  if (hostname.endsWith(PER_MOUNT_SUFFIX)) {
    mountId = hostname.slice(0, -29);
    realPath = url.pathname;
  } else {
    mountId = segments[0] ?? null;
    realPath = mountId ? url.pathname.slice(`/${mountId}`.length) || "/" : "/";
  }
  if (!mountId) return new Response("Bad Request: missing mount ID", { status: 400 });
  const mount = ctx.params?.mounts[mountId];
  if (!mount) return new Response(`Forbidden: unknown mount ID "${mountId}"`, { status: 403 });
  if (mount.readOnly) {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") return new Response("Forbidden: bucket mount is read-only", { status: 403 });
  }
  const realUrl = new URL(realPath + (url.search || ""), mount.endpoint);
  if (isBucketRootProbe(request, realPath, url, mount.bucket)) return new Response(null, { status: 200 });
  if (!isRequestWithinMountScope(realPath, url, mount.bucket, mount.prefix)) return new Response("Forbidden: request is outside mounted bucket scope", { status: 403 });
  const copySourceError = validateCopySourceWithinMountScope(request.headers, mount.bucket, mount.prefix);
  if (copySourceError) return copySourceError;
  const cleanHeaders = buildCleanHeaders(request.headers);
  const cleanRequest = new Request(realUrl.toString(), {
    method: request.method,
    headers: cleanHeaders,
    body: request.body
  });
  const requestInfo = {
    authStrategy: mount.authStrategy,
    bucket: mount.bucket,
    contentLength: request.headers.get("content-length"),
    method: request.method,
    mountId,
    query: [...url.searchParams.keys()].sort()
  };
  if (isZeroLengthDirectoryMarkerPUT(cleanRequest, realPath)) {
    const responseHeaders = getDirectoryMarkerResponseHeaders(cleanRequest);
    requestInfo.bodyPresent = request.body !== null;
    if (mount.authStrategy === "s3-sigv4") requestInfo.payloadHashMode = getSigV4PayloadHash(cleanRequest.headers).mode;
    return withCredentialProxyDiagnostics(requestInfo, debugConfig, ctx.containerId, realPath, async () => {
      const response = mount.authStrategy === "gcs" ? await signAndForwardGCS(cleanRequest, mount.credentials, requestInfo) : await signAndForwardSigV4(cleanRequest, mountId, mount.endpoint, mount.provider, mount.credentials, requestInfo);
      if (response.ok) directoryMarkerCache.set(getDirectoryMarkerCacheKey(mountId, realPath), responseHeaders);
      return response;
    });
  }
  if (isDirectoryMarkerHEAD(cleanRequest)) {
    const responseHeaders = directoryMarkerCache.get(getDirectoryMarkerCacheKey(mountId, realPath));
    if (responseHeaders) {
      requestInfo.bodyPresent = false;
      if (mount.authStrategy === "s3-sigv4") requestInfo.payloadHashMode = getSigV4PayloadHash(cleanRequest.headers).mode;
      return withCredentialProxyDiagnostics(requestInfo, debugConfig, ctx.containerId, realPath, () => Promise.resolve(new Response(null, {
        status: 200,
        headers: responseHeaders
      })));
    }
  }
  if (cleanRequest.method.toUpperCase() !== "HEAD") deleteDirectoryMarkerCacheEntry(mountId, realPath);
  if (mount.authStrategy === "gcs") return withCredentialProxyDiagnostics(requestInfo, debugConfig, ctx.containerId, realPath, () => signAndForwardGCS(cleanRequest, mount.credentials, requestInfo));
  return withCredentialProxyDiagnostics(requestInfo, debugConfig, ctx.containerId, realPath, () => signAndForwardSigV4(cleanRequest, mountId, mount.endpoint, mount.provider, mount.credentials, requestInfo));
}, "s3CredentialProxyHandler");
var CONTAINER_PROXY_CLASS_NAME = "ContainerProxy";
var ContainerProxyOutboundTarget = class extends Container {
  static {
    __name(this, "ContainerProxyOutboundTarget");
  }
};
Object.defineProperty(ContainerProxyOutboundTarget, "name", { value: CONTAINER_PROXY_CLASS_NAME });
ContainerProxyOutboundTarget.outboundHandlers = {
  r2EgressMount: r2EgressHandler,
  s3CredentialProxyMount: s3CredentialProxyHandler
};
var sandboxConfigurationCache = /* @__PURE__ */ new WeakMap();
var R2_DEFAULT_S3FS_OPTIONS = {
  stat_cache_expire: "60",
  enable_noobj_cache: true,
  multipart_size: "5"
};
var R2_DEFAULT_S3FS_OPTION_ENTRIES = Object.entries(R2_DEFAULT_S3FS_OPTIONS).map(([key, value]) => value === true ? key : `${key}=${value}`);
var BACKUP_MULTIPART_MIN_SIZE = 10 * 1024 * 1024;
var BACKUP_MULTIPART_MIN_PART_SIZE = 5 * 1024 * 1024;
var BACKUP_DOWNLOAD_PARALLEL_MIN_SIZE = 10 * 1024 * 1024;
function getNamespaceConfigurationCache(namespace) {
  const existing = sandboxConfigurationCache.get(namespace);
  if (existing) return existing;
  const created = /* @__PURE__ */ new Map();
  sandboxConfigurationCache.set(namespace, created);
  return created;
}
__name(getNamespaceConfigurationCache, "getNamespaceConfigurationCache");
function sameContainerTimeouts(left, right) {
  return left?.instanceGetTimeoutMS === right?.instanceGetTimeoutMS && left?.portReadyTimeoutMS === right?.portReadyTimeoutMS && left?.waitIntervalMS === right?.waitIntervalMS;
}
__name(sameContainerTimeouts, "sameContainerTimeouts");
function sameLabels(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  for (const [key, value] of leftEntries) if (right[key] !== value) return false;
  return true;
}
__name(sameLabels, "sameLabels");
function cloneLabels(labels) {
  return { ...labels };
}
__name(cloneLabels, "cloneLabels");
function buildSandboxConfiguration(effectiveId, options, cached) {
  const configuration = {};
  if (cached?.sandboxName !== effectiveId || cached.normalizeId !== options?.normalizeId) configuration.sandboxName = {
    name: effectiveId,
    normalizeId: options?.normalizeId
  };
  if (options?.sleepAfter !== void 0 && cached?.sleepAfter !== options.sleepAfter) configuration.sleepAfter = options.sleepAfter;
  if (options?.keepAlive !== void 0 && cached?.keepAlive !== options.keepAlive) configuration.keepAlive = options.keepAlive;
  if (options?.containerTimeouts && !sameContainerTimeouts(cached?.containerTimeouts, options.containerTimeouts)) configuration.containerTimeouts = options.containerTimeouts;
  if (options?.transport !== void 0 && cached?.transport !== options.transport) configuration.transport = options.transport;
  if (options?.labels !== void 0 && !sameLabels(cached?.labels, options.labels)) configuration.labels = cloneLabels(options.labels);
  return configuration;
}
__name(buildSandboxConfiguration, "buildSandboxConfiguration");
function hasSandboxConfiguration(configuration) {
  return configuration.sandboxName !== void 0 || configuration.sleepAfter !== void 0 || configuration.keepAlive !== void 0 || configuration.containerTimeouts !== void 0 || configuration.transport !== void 0 || configuration.labels !== void 0;
}
__name(hasSandboxConfiguration, "hasSandboxConfiguration");
function mergeSandboxConfiguration(cached, configuration) {
  return {
    ...cached,
    ...configuration.sandboxName && {
      sandboxName: configuration.sandboxName.name,
      normalizeId: configuration.sandboxName.normalizeId
    },
    ...configuration.sleepAfter !== void 0 && { sleepAfter: configuration.sleepAfter },
    ...configuration.keepAlive !== void 0 && { keepAlive: configuration.keepAlive },
    ...configuration.containerTimeouts !== void 0 && { containerTimeouts: configuration.containerTimeouts },
    ...configuration.transport !== void 0 && { transport: configuration.transport },
    ...configuration.labels !== void 0 && { labels: cloneLabels(configuration.labels) }
  };
}
__name(mergeSandboxConfiguration, "mergeSandboxConfiguration");
function applySandboxConfiguration(stub, configuration) {
  if (stub.configure) return stub.configure(configuration);
  const operations = [];
  if (configuration.sandboxName) operations.push(stub.setSandboxName?.(configuration.sandboxName.name, configuration.sandboxName.normalizeId) ?? Promise.resolve());
  if (configuration.sleepAfter !== void 0) operations.push(stub.setSleepAfter?.(configuration.sleepAfter) ?? Promise.resolve());
  if (configuration.keepAlive !== void 0) operations.push(stub.setKeepAlive?.(configuration.keepAlive) ?? Promise.resolve());
  if (configuration.containerTimeouts !== void 0) operations.push(stub.setContainerTimeouts?.(configuration.containerTimeouts) ?? Promise.resolve());
  if (configuration.transport !== void 0) operations.push(stub.setTransport?.(configuration.transport) ?? Promise.resolve());
  if (configuration.labels !== void 0) operations.push(stub.setLabels?.(configuration.labels) ?? Promise.resolve());
  return Promise.all(operations).then(() => void 0);
}
__name(applySandboxConfiguration, "applySandboxConfiguration");
function createPlatformInterruptedError(error, operation) {
  if (!isPlatformTransientError(error)) return null;
  const context = {
    reason: "runtime_replaced",
    operation,
    phase: "durable_object_call",
    admitted: "unknown",
    retryable: false
  };
  return new OperationInterruptedError({
    code: ErrorCode.OPERATION_INTERRUPTED,
    message: `Sandbox operation ${operation} was interrupted while the platform was updating the sandbox runtime`,
    context,
    httpStatus: getHttpStatus(ErrorCode.OPERATION_INTERRUPTED),
    suggestion: getSuggestion(ErrorCode.OPERATION_INTERRUPTED, context),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  }, { cause: error });
}
__name(createPlatformInterruptedError, "createPlatformInterruptedError");
function translatePlatformInterruption(error, operation) {
  throw createPlatformInterruptedError(error, operation) ?? error;
}
__name(translatePlatformInterruption, "translatePlatformInterruption");
function withSandboxOperationContext(operation, fn) {
  return (...args) => {
    try {
      const result = fn(...args);
      if (result != null && typeof result.then === "function") return result.catch((error) => translatePlatformInterruption(error, operation));
      return result;
    } catch (error) {
      translatePlatformInterruption(error, operation);
    }
  };
}
__name(withSandboxOperationContext, "withSandboxOperationContext");
function getSandbox(ns, id, options) {
  const sanitizedId = sanitizeSandboxId(id);
  const effectiveId = options?.normalizeId ? sanitizedId.toLowerCase() : sanitizedId;
  const hasUppercase = /[A-Z]/.test(sanitizedId);
  if (!options?.normalizeId && hasUppercase) createLogger({ component: "sandbox-do" }).warn(`Sandbox ID "${sanitizedId}" contains uppercase letters, which causes issues with preview URLs (hostnames are case-insensitive). normalizeId will default to true in a future version to prevent this. Use lowercase IDs or pass { normalizeId: true } to prepare.`);
  const stub = getContainer(ns, effectiveId);
  const namespaceCache = getNamespaceConfigurationCache(ns);
  const cachedConfiguration = namespaceCache.get(effectiveId);
  const configuration = buildSandboxConfiguration(effectiveId, options, cachedConfiguration);
  if (hasSandboxConfiguration(configuration)) {
    const nextConfiguration = mergeSandboxConfiguration(cachedConfiguration, configuration);
    namespaceCache.set(effectiveId, nextConfiguration);
    applySandboxConfiguration(stub, configuration).catch(() => {
      if (cachedConfiguration) {
        namespaceCache.set(effectiveId, cachedConfiguration);
        return;
      }
      namespaceCache.delete(effectiveId);
    });
  }
  const defaultSessionId = `sandbox-${effectiveId}`;
  const useDefaultSession = options?.enableDefaultSession !== false;
  const enhancedMethods = {
    fetch: /* @__PURE__ */ __name((request) => stub.fetch(request), "fetch"),
    exec: /* @__PURE__ */ __name((command, execOptions) => useDefaultSession ? stub.exec(command, execOptions) : stub.execWithSessionToken(command, DISABLE_SESSION_TOKEN, execOptions), "exec"),
    startProcess: /* @__PURE__ */ __name((command, processOptions) => useDefaultSession || processOptions?.sessionId !== void 0 ? stub.startProcess(command, processOptions) : stub.startProcess(command, {
      ...processOptions,
      sessionId: DISABLE_SESSION_TOKEN
    }), "startProcess"),
    listProcesses: /* @__PURE__ */ __name((sessionId) => useDefaultSession || sessionId !== void 0 ? stub.listProcesses(sessionId) : stub.listProcesses(DISABLE_SESSION_TOKEN), "listProcesses"),
    getProcess: /* @__PURE__ */ __name((id$1, sessionId) => useDefaultSession || sessionId !== void 0 ? stub.getProcess(id$1, sessionId) : stub.getProcess(id$1, DISABLE_SESSION_TOKEN), "getProcess"),
    execStream: /* @__PURE__ */ __name((command, streamOptions) => {
      if (useDefaultSession || streamOptions?.sessionId !== void 0) return stub.execStream(command, streamOptions);
      return stub.execStreamWithSessionToken(command, DISABLE_SESSION_TOKEN, streamOptions);
    }, "execStream"),
    writeFile: /* @__PURE__ */ __name((path$1, content, fileOptions = {}) => useDefaultSession || fileOptions.sessionId !== void 0 ? stub.writeFile(path$1, content, fileOptions) : stub.writeFile(path$1, content, {
      ...fileOptions,
      sessionId: DISABLE_SESSION_TOKEN
    }), "writeFile"),
    readFile: /* @__PURE__ */ __name((path$1, fileOptions = {}) => {
      const options$1 = useDefaultSession || fileOptions.sessionId !== void 0 ? fileOptions : {
        ...fileOptions,
        sessionId: DISABLE_SESSION_TOKEN
      };
      if (options$1.encoding === "none") return stub.readFile(path$1, options$1);
      return stub.readFile(path$1, options$1);
    }, "readFile"),
    readFileStream: /* @__PURE__ */ __name((path$1, fileOptions = {}) => useDefaultSession || fileOptions.sessionId !== void 0 ? stub.readFileStream(path$1, fileOptions) : stub.readFileStream(path$1, { sessionId: DISABLE_SESSION_TOKEN }), "readFileStream"),
    mkdir: /* @__PURE__ */ __name((path$1, mkdirOptions = {}) => useDefaultSession || mkdirOptions.sessionId !== void 0 ? stub.mkdir(path$1, mkdirOptions) : stub.mkdir(path$1, {
      ...mkdirOptions,
      sessionId: DISABLE_SESSION_TOKEN
    }), "mkdir"),
    deleteFile: /* @__PURE__ */ __name((path$1) => useDefaultSession ? stub.deleteFile(path$1) : stub.deleteFile(path$1, DISABLE_SESSION_TOKEN), "deleteFile"),
    renameFile: /* @__PURE__ */ __name((oldPath, newPath) => useDefaultSession ? stub.renameFile(oldPath, newPath) : stub.renameFile(oldPath, newPath, DISABLE_SESSION_TOKEN), "renameFile"),
    moveFile: /* @__PURE__ */ __name((sourcePath, destinationPath) => useDefaultSession ? stub.moveFile(sourcePath, destinationPath) : stub.moveFile(sourcePath, destinationPath, DISABLE_SESSION_TOKEN), "moveFile"),
    listFiles: /* @__PURE__ */ __name((path$1, listOptions) => useDefaultSession || listOptions?.sessionId !== void 0 ? stub.listFiles(path$1, listOptions) : stub.listFiles(path$1, {
      ...listOptions,
      sessionId: DISABLE_SESSION_TOKEN
    }), "listFiles"),
    exists: /* @__PURE__ */ __name((path$1, sessionId) => useDefaultSession || sessionId !== void 0 ? stub.exists(path$1, sessionId) : stub.exists(path$1, DISABLE_SESSION_TOKEN), "exists"),
    gitCheckout: /* @__PURE__ */ __name((repoUrl, gitOptions) => useDefaultSession || gitOptions?.sessionId !== void 0 ? stub.gitCheckout(repoUrl, gitOptions) : stub.gitCheckout(repoUrl, {
      ...gitOptions,
      sessionId: DISABLE_SESSION_TOKEN
    }), "gitCheckout"),
    createSession: /* @__PURE__ */ __name(async (opts) => {
      return enhanceSession(stub, await stub.createSession(opts));
    }, "createSession"),
    getSession: /* @__PURE__ */ __name(async (sessionId) => {
      return enhanceSession(stub, await stub.getSession(sessionId));
    }, "getSession"),
    watch: /* @__PURE__ */ __name((path$1, options$1 = {}) => useDefaultSession || options$1.sessionId !== void 0 ? stub.watch(path$1, options$1) : stub.watch(path$1, {
      ...options$1,
      sessionId: DISABLE_SESSION_TOKEN
    }), "watch"),
    checkChanges: /* @__PURE__ */ __name((path$1, options$1 = {}) => useDefaultSession || options$1.sessionId !== void 0 ? stub.checkChanges(path$1, options$1) : stub.checkChanges(path$1, {
      ...options$1,
      sessionId: DISABLE_SESSION_TOKEN
    }), "checkChanges"),
    terminal: /* @__PURE__ */ __name((request, opts) => proxyTerminal(stub, defaultSessionId, request, opts), "terminal"),
    wsConnect: connect(stub),
    tunnels: new Proxy({}, { get: /* @__PURE__ */ __name((_, method) => {
      if (typeof method !== "string" || method === "then") return void 0;
      return withSandboxOperationContext(`sandbox.tunnels.${method}`, (...args) => stub.callTunnels(method, args));
    }, "get") })
  };
  return new Proxy(stub, { get(target, prop) {
    if (typeof prop === "string" && prop in enhancedMethods) {
      const method = enhancedMethods[prop];
      if (typeof method === "function") return withSandboxOperationContext(`sandbox.${prop}`, method);
      return method;
    }
    return target[prop];
  } });
}
__name(getSandbox, "getSandbox");
function enhanceSession(stub, rpcSession) {
  return {
    ...rpcSession,
    terminal: /* @__PURE__ */ __name((request, opts) => proxyTerminal(stub, rpcSession.id, request, opts), "terminal")
  };
}
__name(enhanceSession, "enhanceSession");
function connect(stub) {
  return async (request, port) => {
    if (!validatePort(port)) throw new SandboxSecurityError(`Invalid port number: ${port}. Must be 1024-65535, excluding 3000 (sandbox control plane).`);
    const portSwitchedRequest = switchPort(request, port);
    return await stub.fetch(portSwitchedRequest);
  };
}
__name(connect, "connect");

// ../spikes/m0-release-completion/native-fault.ts
import { DurableObject as DurableObject2 } from "cloudflare:workers";

// ../spikes/m0-recovery/bounded-effect.ts
var EffectDeadlineError = class extends Error {
  static {
    __name(this, "EffectDeadlineError");
  }
  constructor() {
    super("effect-outcome-unknown");
  }
};
async function waitForEffect(actual, milliseconds) {
  let timer;
  try {
    return await Promise.race([actual, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new EffectDeadlineError()), Math.max(1, milliseconds));
    })]);
  } finally {
    clearTimeout(timer);
  }
}
__name(waitForEffect, "waitForEffect");

// ../spikes/m0-release-completion/native-fault.ts
var KEY = "m0:release-completion:native-fault";
function parseNativeMonitorError(error) {
  const match = error instanceof Error ? /^container exited with unexpected exit code:[ \t]*(\d+)$/i.exec(error.message) : null;
  const code = match ? Number(match[1]) : NaN;
  return match?.[0] === error?.message && Number.isSafeInteger(code) && code >= 0 && code <= 255 ? { outcome: "unexpected-exit", exitCode: code } : { outcome: "unrecognized-error", exitCode: null };
}
__name(parseNativeMonitorError, "parseNativeMonitorError");
var NativeFault = class extends DurableObject2 {
  static {
    __name(this, "NativeFault");
  }
  // Only offline test subclasses shorten these values; there is no RPC setter,
  // request parameter or environment option for changing production deadlines.
  deadlineMs = 2e4;
  cleanupMs = 5e3;
  #owner = crypto.randomUUID();
  #monitor = null;
  #cleanup = null;
  #readinessController = null;
  #ledger() {
    return this.ctx.storage.kv.get(KEY) ?? { intent: null, result: null, closed: false, cleanup: "pending", cleanupAttempts: 0 };
  }
  #running() {
    try {
      return this.ctx.container?.running ?? null;
    } catch {
      return null;
    }
  }
  report() {
    const ledger = this.#ledger(), ownerLost = !!ledger.intent && !ledger.result && ledger.intent.owner !== this.#owner;
    return structuredClone({
      ...ledger,
      schemaVersion: 1,
      probe: "native-entrypoint-exit-42",
      phase: ledger.result || ledger.closed ? "terminal" : ownerLost ? "owner-lost" : ledger.intent ? "running" : "idle",
      nativeRunning: this.#running(),
      ownerLost,
      businessDispatches: 0,
      modelDispatches: 0
    });
  }
  #result(reason, monitor = null, readiness = { port: 3e3, status: "not-probed" }) {
    return {
      outcome: reason === "exit-42" ? "confirmed" : "unconfirmed",
      reason,
      expectedExitCode: 42,
      exitCode: monitor?.exitCode ?? null,
      monitor,
      nativeRunning: this.#running(),
      readiness,
      recordedAt: Date.now()
    };
  }
  async #saveResult(result) {
    this.ctx.storage.transactionSync(() => {
      const row = this.#ledger();
      if (!row.result) this.ctx.storage.kv.put(KEY, { ...row, result, closed: true });
    });
    await this.ctx.storage.sync();
  }
  async #probePort(signal, deadlineAt) {
    try {
      const native = this.ctx.container;
      const response = await waitForEffect(native.getTcpPort(3e3).fetch("http://native-fault-readiness/", { signal }), Math.max(1, deadlineAt - Date.now()));
      void response.body?.cancel().catch(() => {
      });
      return { port: 3e3, status: "response" };
    } catch (error) {
      return { port: 3e3, status: error instanceof EffectDeadlineError || signal.aborted ? "unconfirmed" : "rejected" };
    }
  }
  async run() {
    const prior = this.#ledger();
    if (prior.intent || prior.closed) return this.report();
    const startedAt = Date.now(), intent = { owner: this.#owner, startedAt, deadlineAt: startedAt + this.deadlineMs, startReturned: false, monitorAttached: false };
    this.ctx.storage.transactionSync(() => {
      const row = this.#ledger();
      if (row.intent || row.closed) throw Error("native-fault-never-replay");
      this.ctx.storage.kv.put(KEY, { ...row, intent });
    });
    await this.ctx.storage.sync();
    if (this.#ledger().closed) return this.report();
    let candidate;
    if (Date.now() >= intent.deadlineAt) candidate = this.#result("deadline");
    else if (!this.ctx.container || this.#running() !== false) candidate = this.#result("not-fresh");
    else {
      try {
        const native = this.ctx.container;
        native.start({ entrypoint: ["/bin/sh", "-c", "exit 42"], enableInternet: false, env: {} });
        const actual = native.monitor().then(
          () => ({ outcome: "resolved", exitCode: null, observedAt: Date.now() }),
          (error) => ({ ...parseNativeMonitorError(error), observedAt: Date.now() })
        );
        this.#monitor = actual;
        this.ctx.waitUntil(actual.then(() => {
        }));
        const row = this.#ledger();
        this.ctx.storage.kv.put(KEY, { ...row, intent: { ...intent, startReturned: true, monitorAttached: true } });
        await this.ctx.storage.sync();
        if (this.#ledger().closed) return this.report();
        const controller = new AbortController();
        this.#readinessController = controller;
        const readiness = this.#probePort(controller.signal, intent.deadlineAt);
        const [monitor, port] = await waitForEffect(Promise.all([actual, readiness]), Math.max(1, intent.deadlineAt - Date.now()));
        const reason = Date.now() >= intent.deadlineAt ? "deadline" : monitor.outcome === "resolved" ? "normal-resolution" : monitor.outcome === "unrecognized-error" ? "unknown-monitor-error" : monitor.exitCode !== 42 ? "other-exit" : port.status === "response" || port.status === "unconfirmed" || this.#running() !== false ? "unknown-monitor-error" : "exit-42";
        candidate = this.#result(reason, monitor, port);
      } catch (error) {
        candidate = this.#result(error instanceof EffectDeadlineError ? "deadline" : "start-error");
      } finally {
        this.#readinessController?.abort();
        this.#readinessController = null;
      }
    }
    await this.#saveResult(candidate);
    return this.cleanup();
  }
  async cleanup() {
    if (this.#cleanup) return this.#cleanup;
    const task = this.#clean();
    this.#cleanup = task;
    try {
      return await task;
    } finally {
      if (this.#cleanup === task) this.#cleanup = null;
    }
  }
  async #clean() {
    let row = this.#ledger();
    if (row.cleanup === "confirmed") return this.report();
    if (!row.result) await this.#saveResult(this.#result(row.intent && row.intent.owner !== this.#owner ? "owner-lost" : "cancelled"));
    else await this.ctx.storage.sync();
    row = this.#ledger();
    if (row.cleanupAttempts >= 2) return this.report();
    this.ctx.storage.kv.put(KEY, { ...row, closed: true, cleanup: "unconfirmed", cleanupAttempts: row.cleanupAttempts + 1 });
    await this.ctx.storage.sync();
    this.#readinessController?.abort();
    let confirmed = false;
    try {
      if (this.ctx.container) {
        const actual = this.ctx.container.destroy();
        this.ctx.waitUntil(actual.catch(() => {
        }));
        await waitForEffect(actual, this.cleanupMs);
        confirmed = this.#running() === false;
      }
    } catch {
    }
    const latest = this.#ledger();
    this.ctx.storage.kv.put(KEY, { ...latest, cleanup: confirmed ? "confirmed" : "unconfirmed" });
    await this.ctx.storage.sync();
    return this.report();
  }
};

// ../spikes/m0-release-completion/index.ts
import runtimeSource from "./d1044af518667f5d385f39150b07bddc6704dbd1-release-probe.mjs";

// ../spikes/m0-pi-live/pipeline.ts
var FixedPipeline = class {
  static {
    __name(this, "FixedPipeline");
  }
  actual = null;
  busy = false;
  operationMs = 45e3;
  ctx;
  steps;
  cleanupOperations;
  constructor(ctx, steps, cleanupOperations) {
    this.ctx = ctx;
    this.steps = steps;
    this.cleanupOperations = cleanupOperations;
  }
  state() {
    return this.ctx.storage.kv.get("pipeline") ?? null;
  }
  set(patch) {
    const old = this.state();
    if (!old) throw Error("uninitialized");
    const next = { ...old, ...patch };
    if (next.step !== old.step || next.phase !== old.phase) next.events = [...old.events, { step: next.step, phase: next.phase, at: Date.now() }];
    if (next.events.length > 64) throw Error("event-limit");
    this.ctx.storage.kv.put("pipeline", next);
    return next;
  }
  async accept() {
    if (this.state()) throw Error("already-used");
    const now = Date.now();
    this.ctx.storage.kv.put("pipeline", { step: 0, stepStarted: false, startedAt: now, deadline: now + 42e4, closed: false, phase: "queued", operation: null, error: null, cleanup: "pending", events: [] });
    await this.ctx.storage.sync();
    await this.ctx.storage.setAlarm(Date.now() + 100);
  }
  async close() {
    if (!this.state()) {
      const now = Date.now();
      this.ctx.storage.kv.put("pipeline", { step: 0, stepStarted: false, startedAt: now, deadline: now, closed: true, phase: "failed", operation: null, error: "closed-before-accept", cleanup: "confirmed", events: [] });
    } else this.set({ closed: true });
    await this.ctx.storage.sync();
    if (!this.actual && !this.state().operation && this.state().cleanup !== "confirmed") await this.ctx.storage.setAlarm(Date.now() + 100);
  }
  async effect(operation, invoke, cleanup = false) {
    const s = this.state();
    if (this.actual || s.operation || !cleanup && (s.closed || Date.now() >= s.deadline)) throw Error("effect-denied");
    this.set({ operation });
    await this.ctx.storage.sync();
    if (!cleanup && (this.state().closed || Date.now() >= s.deadline)) {
      this.set({ operation: null });
      await this.ctx.storage.sync();
      throw Error("effect-fenced");
    }
    let timedOut = false;
    let pending;
    try {
      pending = Promise.resolve(invoke());
    } catch (error) {
      pending = Promise.reject(error);
    }
    const actual = pending.finally(async () => {
      this.set({ operation: null });
      if (timedOut) this.set({ phase: "failed", closed: true, error: "effect-outcome-unknown", cleanup: "pending" });
      await this.ctx.storage.sync();
      if (this.actual === actual) this.actual = null;
      if (timedOut) await this.ctx.storage.setAlarm(Date.now() + 100);
    });
    this.actual = actual;
    this.ctx.waitUntil(actual.catch(() => {
    }));
    try {
      return await waitForEffect(actual, cleanup ? 2e4 : Math.min(this.operationMs, s.deadline - Date.now()));
    } catch (error) {
      if (error instanceof EffectDeadlineError) {
        timedOut = true;
        this.set({ phase: "failed", closed: true, error: "effect-outcome-unknown", cleanup: "unconfirmed" });
        await this.ctx.storage.sync();
      }
      throw error;
    }
  }
  async clean() {
    if (this.actual || this.state().operation) return;
    this.set({ closed: true, phase: "cleaning" });
    let confirmed = true;
    for (let i = 0; i < this.cleanupOperations.length; i++) {
      if (this.ctx.storage.kv.get(`cleaned/${i}`)) continue;
      try {
        if (await this.cleanupOperations[i]()) {
          this.ctx.storage.kv.put(`cleaned/${i}`, true);
          await this.ctx.storage.sync();
        } else confirmed = false;
      } catch {
        confirmed = false;
        if (this.actual || this.state().operation) break;
      }
    }
    confirmed = confirmed && this.cleanupOperations.every((_, i) => this.ctx.storage.kv.get(`cleaned/${i}`) === true);
    this.set({ cleanup: confirmed ? "confirmed" : "unconfirmed", phase: confirmed && !this.state().error && this.state().step === this.steps.length ? "completed" : "failed" });
    await this.ctx.storage.sync();
  }
  async alarm() {
    if (this.busy) return;
    this.busy = true;
    try {
      const s = this.state();
      if (!s || s.cleanup === "confirmed") return;
      if (s.operation) {
        if (!this.actual) {
          this.set({ closed: true, phase: "failed", cleanup: "unconfirmed", error: "interrupted-rpc-needs-independent-reconciliation" });
          await this.ctx.storage.sync();
        }
        return;
      }
      if (s.closed || Date.now() >= s.deadline) {
        if (!s.closed) this.set({ closed: true, error: "run-deadline" });
        await this.clean();
        return;
      }
      if (s.stepStarted) throw Error("interrupted-step-never-replayed");
      if (s.step === this.steps.length) {
        await this.clean();
        return;
      }
      this.set({ stepStarted: true, phase: "running" });
      await this.ctx.storage.sync();
      if (this.state().closed || Date.now() >= s.deadline) throw Error("step-fenced");
      await this.steps[s.step]();
      if (this.state().closed) throw Error("step-closed");
      this.set({ step: s.step + 1, stepStarted: false });
      await this.ctx.storage.sync();
      await this.ctx.storage.setAlarm(Date.now() + 100);
    } catch {
      this.set({ closed: true, phase: "failed", error: this.state().error ?? "fixed-step-failed" });
      await this.ctx.storage.sync();
      if (!this.actual && !this.state().operation) await this.clean();
    } finally {
      this.busy = false;
    }
  }
};

// ../spikes/m0-storage/adapters.ts
var R2Blobs = class {
  static {
    __name(this, "R2Blobs");
  }
  bucket;
  prefix;
  putCount = 0;
  failOnPut = 0;
  constructor(bucket, prefix) {
    this.bucket = bucket;
    this.prefix = prefix;
  }
  async putIfAbsent(key, bytes) {
    if (++this.putCount === this.failOnPut) throw new Error("injected-upload-interruption");
    await this.bucket.put(`${this.prefix}/${key}`, bytes, { onlyIf: { etagDoesNotMatch: "*" } });
  }
  async get(key) {
    const value = await this.bucket.get(`${this.prefix}/${key}`);
    if (value && value.size > 32 * 1024 * 1024) throw new Error("checkpoint-object-too-large");
    return value ? new Uint8Array(await value.arrayBuffer()) : null;
  }
};
function currentCheckpoint(storage) {
  return storage.kv.get("current") ?? null;
}
__name(currentCheckpoint, "currentCheckpoint");
async function commitCheckpoint(storage, input, commitMetadata) {
  const receipt = storage.transactionSync(() => {
    const generation = storage.kv.get("generation") ?? 1;
    if (generation !== input.generation) throw new Error("stale-generation");
    const current = currentCheckpoint(storage);
    if (current?.revision === input.revision) {
      if (current.generation !== input.generation) throw new Error("revision-generation-conflict");
      if (storage.kv.get("current-parent") !== input.parent) throw new Error("parent-conflict");
      commitMetadata?.(current);
      return current;
    }
    if ((current?.revision ?? null) !== input.parent) throw new Error("parent-conflict");
    const sequence = (current?.sequence ?? 0) + 1;
    const value = { revision: input.revision, generation, sequence };
    storage.kv.put("current", value);
    storage.kv.put("current-parent", input.parent);
    storage.kv.put(`events/${sequence.toString().padStart(8, "0")}`, value);
    commitMetadata?.(value);
    return value;
  });
  await storage.sync();
  return receipt;
}
__name(commitCheckpoint, "commitCheckpoint");

// ../spikes/m0-storage/checkpoint.ts
var encoder2 = new TextEncoder();
var decoder = new TextDecoder("utf-8", { fatal: true });
var digestPattern = /^[a-f0-9]{64}$/;
async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))), (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
function pathAllowed(path2) {
  return typeof path2 === "string" && path2.length <= 512 && path2.normalize("NFC") === path2 && !/[\\\u0000-\u001f\u007f]/.test(path2) && path2.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}
__name(pathAllowed, "pathAllowed");
function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length > 1e3) throw new Error("invalid file count");
  const paths = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (!entry || !pathAllowed(entry.path) || !["file", "directory"].includes(entry.kind)) throw new Error("invalid path or entry kind");
    if (!Number.isInteger(entry.mode) || ![384, 420, 448, 493].includes(entry.mode)) throw new Error("unsupported permissions");
    if (paths.has(entry.path)) throw new Error("duplicate path");
    paths.set(entry.path, entry.kind);
  }
  for (const path2 of paths.keys()) {
    const parts = path2.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (paths.get(parts.slice(0, i).join("/")) !== "directory") throw new Error("missing directory or file ancestor");
    }
  }
}
__name(validateEntries, "validateEntries");
function validateHeader(generation, parent) {
  if (!Number.isSafeInteger(generation) || generation < 1 || parent !== null && !digestPattern.test(parent)) throw new Error("invalid generation or parent");
}
__name(validateHeader, "validateHeader");
function blobKey(digest2) {
  if (!digestPattern.test(digest2)) throw new Error("invalid digest");
  return `blobs/${digest2}`;
}
__name(blobKey, "blobKey");
async function verifiedGet(blobs, key, digest2) {
  const bytes = await blobs.get(key);
  if (!bytes || await sha256(bytes) !== digest2) throw new Error("missing or corrupt checkpoint object");
  return bytes;
}
__name(verifiedGet, "verifiedGet");
async function upload(blobs, bytes) {
  const digest2 = await sha256(bytes);
  const key = blobKey(digest2);
  await blobs.putIfAbsent(key, bytes);
  await verifiedGet(blobs, key, digest2);
  return digest2;
}
__name(upload, "upload");
async function saveCheckpoint(input) {
  const { generation, parent, blobs, authority } = input;
  validateHeader(generation, parent);
  validateEntries(input.entries);
  const session = Uint8Array.from(input.session);
  const entries = input.entries.map((e) => e.kind === "file" ? { ...e, bytes: Uint8Array.from(e.bytes) } : { ...e });
  const total = entries.reduce((sum, e) => sum + (e.kind === "file" ? e.bytes.byteLength : 0), session.byteLength);
  if (total > 32 * 1024 * 1024) throw new Error("M0 checkpoint size limit exceeded");
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const files = [];
  for (const entry of entries) {
    files.push(entry.kind === "directory" ? { path: entry.path, kind: entry.kind, mode: entry.mode } : { path: entry.path, kind: entry.kind, mode: entry.mode, digest: await upload(blobs, entry.bytes), size: entry.bytes.byteLength });
  }
  const manifest = { schema_version: 1, generation, parent, files, session: { digest: await upload(blobs, session), size: session.byteLength } };
  const bytes = encoder2.encode(JSON.stringify(manifest));
  const revision = await sha256(bytes);
  const key = `manifests/${revision}`;
  await blobs.putIfAbsent(key, bytes);
  await verifiedGet(blobs, key, revision);
  return authority.commit({ revision, generation, parent });
}
__name(saveCheckpoint, "saveCheckpoint");
async function restoreCheckpoint(blobs, revision) {
  if (!digestPattern.test(revision)) throw new Error("invalid revision");
  const bytes = await verifiedGet(blobs, `manifests/${revision}`, revision);
  if (bytes.byteLength > 1024 * 1024) throw new Error("manifest too large");
  const manifest = JSON.parse(decoder.decode(bytes));
  if (!manifest || manifest.schema_version !== 1) throw new Error("unsupported checkpoint format");
  validateHeader(manifest.generation, manifest.parent);
  validateEntries(manifest.files);
  if (!manifest.session || !Number.isSafeInteger(manifest.session.size) || manifest.session.size < 0) throw new Error("invalid session metadata");
  let total = manifest.session.size;
  for (const file of manifest.files) {
    if (file.kind === "file") {
      if (!Number.isSafeInteger(file.size) || file.size < 0 || !digestPattern.test(file.digest ?? "")) throw new Error("invalid file metadata");
      total += file.size;
    } else if (file.digest !== void 0 || file.size !== void 0) throw new Error("invalid directory metadata");
  }
  if (total > 32 * 1024 * 1024) throw new Error("M0 checkpoint size limit exceeded");
  const session = await verifiedGet(blobs, blobKey(manifest.session.digest), manifest.session.digest);
  if (session.byteLength !== manifest.session.size) throw new Error("session size mismatch");
  const entries = [];
  for (const file of manifest.files) {
    if (file.kind === "directory") entries.push({ path: file.path, kind: file.kind, mode: file.mode });
    else {
      const content = await verifiedGet(blobs, blobKey(file.digest), file.digest);
      if (content.byteLength !== file.size) throw new Error("file size mismatch");
      entries.push({ path: file.path, kind: file.kind, mode: file.mode, bytes: content });
    }
  }
  return { manifest, entries, session };
}
__name(restoreCheckpoint, "restoreCheckpoint");

// ../spikes/m0-release/cloud-policy.ts
function admitCounter(value) {
  if (!value || typeof value !== "object") throw Error("runtime-response");
  const v = value;
  if (v.protocol !== "m0-v1" || v.format !== 1 || !Number.isSafeInteger(v.counter) || v.counter < 0 || !Number.isSafeInteger(v.pid) || v.pid < 1) throw Error("runtime-incompatible");
}
__name(admitCounter, "admitCounter");

// ../spikes/m0-cloud/auth.ts
var encoder3 = new TextEncoder();
async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder3.encode(value)));
}
__name(digest, "digest");
async function hasProbeAuthorization(request, secret) {
  if (!secret || secret.length < 32 || secret.length > 1024) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length > 1031) return false;
  const [actual, expected] = await Promise.all([digest(header.slice(7)), digest(secret)]);
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= actual[i] ^ expected[i];
  return mismatch === 0;
}
__name(hasProbeAuthorization, "hasProbeAuthorization");

// ../spikes/m0-model-proxy/policy.ts
var HISTORICAL_PROFILE = Object.freeze({ provider: "opencode-go", model: "deepseek-v4-flash", upstreamOrigin: "https://opencode.ai", upstreamPath: "/zen/go/v1/chat/completions" });
var GO_LIVE_BUDGET = Object.freeze({
  id: "go-flash-context-20260906",
  origin: "https://riffology-m0-model-proxy-go-live-staging.jihe-gao.workers.dev",
  runId: "go-live-g0-20260906",
  inputTokens: 1048576,
  outputTokens: 256,
  maxDispatches: 2,
  reservationMicrousd: 461712,
  maxRunMicrousd: 923424,
  inputMicrousdPerMillion: 44e4,
  outputMicrousdPerMillion: 132e4,
  verifiedAtMs: Date.parse("2026-09-06T00:00:00Z"),
  expiresAtMs: Date.parse("2026-09-07T00:00:00Z")
});
var ProxyRejected = class extends Error {
  static {
    __name(this, "ProxyRejected");
  }
  status;
  constructor(code, status = 400) {
    super(code);
    this.status = status;
  }
};
var encoder4 = new TextEncoder();
function untilAbort(promise, signal) {
  if (signal.aborted) {
    void promise.catch(() => {
    });
    return Promise.reject(new ProxyRejected("request-aborted", 499));
  }
  return new Promise((resolve, reject) => {
    const abort = /* @__PURE__ */ __name(() => {
      signal.removeEventListener("abort", abort);
      reject(new ProxyRejected("request-aborted", 499));
    }, "abort");
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}
__name(untilAbort, "untilAbort");

// ../spikes/m0-release-completion/index.ts
var RUN = "release-completion-20260906";
var ORIGIN = "https://riffology-m0-release-completion-staging.jihe-gao.workers.dev";
var SOURCE_PREFIX = "m0-release/release-g0-v3-20260906";
var SOURCE_REVISION = "518090fb384338b9e63ddbdf091ea03f2ce2198d347b8e509c165947dc4753a7";
var SOURCE_STATE_SHA = "fe44e2085de9f5c29980f1a6c8a84a8c340131a8fefc9135a265d2667bde7b5c";
var SOURCE = "/workspace/release-probe.mjs";
var INPUT = "/workspace/release-input.json";
var ROOT = "/workspace/m0-release";
var enc = new TextEncoder();
var dec = new TextDecoder("utf-8", { fatal: true });
var CompletionHost = class extends DurableObject3 {
  static {
    __name(this, "CompletionHost");
  }
  pipeline;
  constructor(ctx, env) {
    super(ctx, env);
    this.pipeline = new FixedPipeline(ctx, [() => this.fault(), () => this.restore(), () => this.increment(), () => this.save()], [() => this.cleanFault(), () => this.destroy()]);
  }
  get(k) {
    return this.ctx.storage.kv.get(k);
  }
  put(k, v) {
    this.ctx.storage.kv.put(k, v);
  }
  sandbox() {
    return getSandbox(this.env.RevertedSandbox, `m0-${RUN}-restore`, { normalizeId: true, enableDefaultSession: false, keepAlive: false, sleepAfter: "60s" });
  }
  faultStub() {
    return this.env.FAULT.getByName(`m0-${RUN}-fault`);
  }
  async accept() {
    await this.pipeline.accept();
    return this.report();
  }
  async cleanup() {
    await this.pipeline.close();
    return this.report();
  }
  alarm() {
    return this.pipeline.alarm();
  }
  report() {
    return {
      runId: RUN,
      environment: "cloudflare-vm",
      state: this.pipeline.state(),
      fault: this.get("fault") ?? null,
      restored: this.get("restored") ?? null,
      commands: this.get("commands") ?? [],
      checkpoint: this.get("checkpoint") ?? null,
      sourceSha256: this.get("runtime-source") ?? null,
      faultCleanup: this.get("fault-cleanup") ?? null,
      restoreDestroyed: this.get("restore-destroyed") === true,
      modelDispatches: 0
    };
  }
  async fault() {
    this.put("fault-allocated", true);
    await this.ctx.storage.sync();
    const r = await this.pipeline.effect("native-fault", () => this.faultStub().run());
    this.put("fault", r);
    await this.ctx.storage.sync();
    if (!await this.cleanFault()) throw Error("fault-cleanup-unconfirmed");
    const result = r.result;
    if (result?.outcome !== "confirmed" || result.reason !== "exit-42" || result.exitCode !== 42 || result.monitor?.outcome !== "unexpected-exit" || result.monitor.exitCode !== 42 || result.nativeRunning !== false || result.readiness.status !== "rejected" || !r.intent?.startReturned || !r.intent.monitorAttached || r.businessDispatches !== 0) throw Error("startup-exit-unconfirmed");
  }
  async cleanFault() {
    if (!this.get("fault-allocated")) return true;
    if (this.get("fault-cleaned")) return true;
    const r = await this.pipeline.effect("native-fault-cleanup", () => this.faultStub().cleanup(), true);
    this.put("fault-cleanup", r);
    await this.ctx.storage.sync();
    if (r.cleanup !== "confirmed") return false;
    this.put("fault-cleaned", true);
    await this.ctx.storage.sync();
    return true;
  }
  async write(path2, text) {
    this.put("restore-allocated", true);
    await this.ctx.storage.sync();
    const r = await this.pipeline.effect("restore/write", () => this.sandbox().writeFile(path2, text));
    if (!r.success) throw Error("write-failed");
  }
  async command(command, requestId, restore) {
    await this.write(INPUT, JSON.stringify({ directory: ROOT, command, requestId, ...restore ? { restore } : {} }));
    const r = await this.pipeline.effect(`restore/${command}`, () => this.sandbox().exec(`node ${SOURCE} < ${INPUT}`, { timeout: 1e4 }));
    if (!r.success || r.exitCode !== 0 || r.stdout.length > 16384) throw Error("child-failed");
    const result = JSON.parse(r.stdout);
    admitCounter(result);
    if (result.command !== command || result.requestId !== requestId || !["completed", "observed"].includes(result.status)) throw Error("child-correlation");
    this.put("commands", [...this.get("commands") ?? [], result]);
    await this.ctx.storage.sync();
    return result;
  }
  async restore() {
    const saved = await this.pipeline.effect("source/restore", () => restoreCheckpoint(new R2Blobs(this.env.CHECKPOINTS, SOURCE_PREFIX), SOURCE_REVISION));
    const hash2 = await sha256(saved.session), state = JSON.parse(dec.decode(saved.session));
    if (hash2 !== SOURCE_STATE_SHA || saved.entries.length !== 0 || saved.manifest.generation !== 1 || state.schema !== 1 || state.counter !== 2 || Object.keys(state).length !== 2) throw Error("source-checkpoint");
    this.put("restored", { prefix: SOURCE_PREFIX, revision: SOURCE_REVISION, stateSha256: hash2, counter: state.counter });
    await this.ctx.storage.sync();
    await this.write(SOURCE, runtimeSource);
    this.put("runtime-source", await sha256(enc.encode(runtimeSource)));
    const initialized = await this.command("initialize", "completion-initialize", state);
    if (initialized.counter !== 2) throw Error("restore-counter");
  }
  async increment() {
    const changed = await this.command("increment", "completion-increment");
    if (changed.counter !== 3 || changed.replayed !== false) throw Error("increment-counter");
    const read = await this.command("read", "completion-read-state");
    if (read.counter !== 3) throw Error("read-counter");
  }
  async save() {
    const bytes = enc.encode(JSON.stringify({ schema: 1, counter: 3 })), prefix = `m0-release-completion/${RUN}`;
    const receipt = await this.pipeline.effect("new/checkpoint", () => saveCheckpoint({ entries: [], session: bytes, generation: 1, parent: null, blobs: new R2Blobs(this.env.CHECKPOINTS, prefix), authority: {
      current: /* @__PURE__ */ __name(async () => currentCheckpoint(this.ctx.storage), "current"),
      commit: /* @__PURE__ */ __name((input) => commitCheckpoint(this.ctx.storage, input), "commit")
    } }));
    this.put("checkpoint", { ...receipt, prefix, stateSha256: await sha256(bytes), counter: 3, sourceRevision: SOURCE_REVISION });
    await this.ctx.storage.sync();
  }
  async destroy() {
    if (!this.get("restore-allocated") || this.get("restore-destroyed")) return true;
    await this.pipeline.effect("restore/destroy", () => this.sandbox().destroy(), true);
    this.put("restore-destroyed", true);
    await this.ctx.storage.sync();
    return true;
  }
};
var index_default = { async fetch(request, env) {
  const json = /* @__PURE__ */ __name((v, status = 200) => Response.json(v, { status, headers: { "cache-control": "no-store", "x-riffology-m0-mode": "release-completion" } }), "json");
  if (!await hasProbeAuthorization(request, env.M0_PROBE_TOKEN)) return json({ error: "operator-required" }, 401);
  const url = new URL(request.url), action = url.pathname.split("/").at(-1);
  if (url.origin !== ORIGIN || url.search || url.hash || !["accept", "report", "cleanup"].includes(action) || url.pathname !== `/probe/${RUN}/${action}`) return json({ error: "route-denied" }, 404);
  if (request.method !== (action === "report" ? "GET" : "POST")) return json({ error: "method-denied" }, 405);
  if (request.body) {
    const reader = request.body.getReader(), ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 1e3);
    try {
      let ended = false;
      for (let i = 0; i < 16; i++) {
        const p = await untilAbort(reader.read(), ctrl.signal);
        if (p.done) {
          ended = true;
          break;
        }
        if (p.value.length) return json({ error: "empty-body-required" }, 400);
      }
      if (!ended) return json({ error: "empty-body-required" }, 400);
    } catch {
      return json({ error: "empty-body-required" }, 400);
    } finally {
      clearTimeout(timer);
      void reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
  }
  try {
    const host = env.HOST.getByName(RUN);
    return json(action === "report" ? await host.report() : action === "accept" ? await host.accept() : await host.cleanup(), action === "accept" ? 202 : 200);
  } catch {
    return json({ error: "operation-unconfirmed", next: "read report; never replay accept" }, 409);
  }
} };
export {
  CompletionHost,
  NativeFault,
  ORIGIN,
  RUN,
  SOURCE_PREFIX,
  SOURCE_REVISION,
  SOURCE_STATE_SHA,
  index_default as default
};
/*! Bundled license information:

aws4fetch/dist/aws4fetch.esm.mjs:
  (**
   * @license MIT <https://opensource.org/licenses/MIT>
   * @copyright Michael Hart 2024
   *)
*/
//# sourceMappingURL=index.js.map
