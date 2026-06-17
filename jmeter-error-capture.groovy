// ============================================================================
// JMeter JSR223 PostProcessor — Error Detail Capture (with Trace ID)
// ============================================================================
// Place this in your Test Plan under the sampler(s) you want to monitor.
// It logs ONLY failed requests to a CSV file with clean, structured columns.
//
// Output: error-details.csv
// Columns: Timestamp, ThreadName, Label, ResponseCode, ResponseMessage,
//          Elapsed(ms), URL, TraceId, RequestBody, ResponseBody
//
// Trace ID extraction:
//   Searches response HEADERS first, then request HEADERS, then response BODY
//   for common trace ID patterns used by Spring Cloud Sleuth, OpenTelemetry,
//   AWS X-Ray, Zipkin, Jaeger, Datadog, custom correlation IDs, etc.
// ============================================================================

import java.text.SimpleDateFormat
import java.util.regex.Pattern

// ── Configuration ────────────────────────────────────────────────────────────
def ERROR_LOG_FILE = "error-details.csv"      // Output file name
def MAX_BODY_CHARS = 500                       // Max chars for request/response body
def LOG_DIR        = ""                        // Leave empty for JMeter bin/ dir

// Trace ID header names to check (case-insensitive, checked in order)
// Add your custom header name here if your service uses a non-standard one
def TRACE_HEADERS = [
    "X-B3-TraceId",            // Zipkin / Spring Cloud Sleuth
    "X-Trace-Id",              // Common custom
    "X-Request-Id",            // Common custom / nginx
    "X-Correlation-Id",        // Correlation pattern
    "traceparent",             // W3C Trace Context / OpenTelemetry
    "X-Amzn-Trace-Id",        // AWS X-Ray
    "uber-trace-id",           // Jaeger
    "x-datadog-trace-id",     // Datadog
    "X-Cloud-Trace-Context",  // Google Cloud
    "Request-Id",              // Azure / ASP.NET
    "x-ms-request-id",        // Azure Storage
]

// Regex patterns to extract trace ID from response body (JSON, XML, plain text)
def TRACE_BODY_PATTERNS = [
    ~/(?i)["']?(?:trace[_-]?id|traceid|x-trace-id|correlationid|correlation[_-]?id|request[_-]?id)["']?\s*[:=]\s*["']?([a-f0-9-]{8,64})["']?/,
    ~/(?i)<(?:trace[_-]?id|traceid|correlationid|requestid)>([^<]+)<\//,
    ~/(?i)traceparent["']?\s*[:=]\s*["']?00-([a-f0-9]{32})-/,
]
// ─────────────────────────────────────────────────────────────────────────────

// Skip successful requests
if (prev.isSuccessful()) {
    return
}

// ── Build file path and write header ─────────────────────────────────────────
def filePath = LOG_DIR ? "${LOG_DIR}${ERROR_LOG_FILE}" : ERROR_LOG_FILE
def logFile  = new File(filePath)

if (!logFile.exists() || logFile.length() == 0) {
    logFile.text = "Timestamp,ThreadName,Label,ResponseCode,ResponseMessage,Elapsed(ms),URL,TraceId,RequestBody,ResponseBody\n"
}

// ── Extract standard fields ──────────────────────────────────────────────────
def timestamp    = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS").format(new Date(prev.getTimeStamp()))
def threadName   = prev.getThreadName() ?: ""
def label        = prev.getSampleLabel() ?: ""
def responseCode = prev.getResponseCode() ?: ""
def responseMsg  = prev.getResponseMessage() ?: ""
def elapsed      = prev.getTime()
def url          = prev.getUrlAsString() ?: ""

// ── Extract Trace ID ─────────────────────────────────────────────────────────
def traceId = ""

// Step 1: Check response headers (most reliable)
try {
    def responseHeaders = prev.getResponseHeaders() ?: ""
    for (headerName in TRACE_HEADERS) {
        def pattern = Pattern.compile(
            "(?i)^${Pattern.quote(headerName)}:\\s*(.+)\$",
            Pattern.MULTILINE
        )
        def matcher = pattern.matcher(responseHeaders)
        if (matcher.find()) {
            traceId = matcher.group(1).trim()
            // W3C traceparent: "00-<traceId>-<spanId>-<flags>"
            if (headerName.equalsIgnoreCase("traceparent") && traceId.contains("-")) {
                def parts = traceId.split("-")
                if (parts.length >= 2) traceId = parts[1]
            }
            // Jaeger: "<traceId>:<spanId>:<parentId>:<flags>"
            if (headerName.equalsIgnoreCase("uber-trace-id") && traceId.contains(":")) {
                traceId = traceId.split(":")[0]
            }
            // AWS X-Ray: "Root=1-xxx-yyy;Self=1-zzz"
            if (headerName.equalsIgnoreCase("X-Amzn-Trace-Id") && traceId.contains("Root=")) {
                def rootMatch = (traceId =~ /Root=([^;]+)/)
                if (rootMatch.find()) traceId = rootMatch.group(1)
            }
            break
        }
    }
} catch (Exception e) { /* continue */ }

// Step 2: Check request headers (frameworks often propagate trace ID in request)
if (!traceId) {
    try {
        def requestHeaders = prev.getRequestHeaders() ?: ""
        for (headerName in TRACE_HEADERS) {
            def pattern = Pattern.compile(
                "(?i)^${Pattern.quote(headerName)}:\\s*(.+)\$",
                Pattern.MULTILINE
            )
            def matcher = pattern.matcher(requestHeaders)
            if (matcher.find()) {
                traceId = matcher.group(1).trim()
                if (headerName.equalsIgnoreCase("traceparent") && traceId.contains("-")) {
                    def parts = traceId.split("-")
                    if (parts.length >= 2) traceId = parts[1]
                }
                break
            }
        }
    } catch (Exception e) { /* continue */ }
}

// Step 3: Search response body (for APIs that return traceId in JSON/XML error responses)
if (!traceId) {
    try {
        def body = prev.getResponseDataAsString() ?: ""
        def searchArea = body.length() > 2000 ? body.substring(0, 2000) : body
        for (pat in TRACE_BODY_PATTERNS) {
            def matcher = pat.matcher(searchArea)
            if (matcher.find()) {
                traceId = matcher.group(1).trim()
                break
            }
        }
    } catch (Exception e) { /* continue without trace ID */ }
}

// ── Extract request body (from sampler data, not response) ───────────────────
def requestBody = ""
try {
    def samplerData = prev.getSamplerData()
    if (samplerData) {
        def bodyStart = samplerData.indexOf("\n\n")
        if (bodyStart > 0 && bodyStart < samplerData.length() - 2) {
            requestBody = samplerData.substring(bodyStart + 2).trim()
        } else if (!samplerData.matches("(?s)^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\\s.*")) {
            requestBody = samplerData.trim()
        }
    }
} catch (Exception e) {
    requestBody = ""
}

// ── Extract response body ────────────────────────────────────────────────────
def responseBody = ""
try {
    responseBody = (prev.getResponseDataAsString() ?: "").trim()
} catch (Exception e) {
    responseBody = ""
}

// ── Truncate bodies to prevent huge files ────────────────────────────────────
if (requestBody.length() > MAX_BODY_CHARS) {
    requestBody = requestBody.substring(0, MAX_BODY_CHARS) + "...[truncated]"
}
if (responseBody.length() > MAX_BODY_CHARS) {
    responseBody = responseBody.substring(0, MAX_BODY_CHARS) + "...[truncated]"
}

// ── CSV-safe escaping ────────────────────────────────────────────────────────
def csvEscape = { String val ->
    if (!val) return ""
    val = val.replaceAll("\\r?\\n", " ").replaceAll("\"", "\"\"")
    if (val.contains(",") || val.contains("\"") || val.contains("|")) {
        return "\"${val}\""
    }
    return val
}

// ── Append row to CSV ────────────────────────────────────────────────────────
def line = [
    timestamp,
    csvEscape(threadName),
    csvEscape(label),
    responseCode,
    csvEscape(responseMsg),
    elapsed,
    csvEscape(url),
    csvEscape(traceId),
    csvEscape(requestBody),
    csvEscape(responseBody)
].join(",")

logFile.append(line + "\n")
