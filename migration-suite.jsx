import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";

const CONN = { IDLE: 0, BUSY: 1, OK: 2, FAIL: 3 };
const TABS = {
  ALM_EXPORT: "alm_export",
  IMPORT_TC: "import_tc",
  IMPORT_DEF: "import_def",
  LOG: "activity_log",
};
const ALM_ENTITIES = [
  { id: "tests", label: "Test Plan", icon: "\u2611", apiPath: "tests", fields: ["id","name","subtype-id","owner","status","priority","description","creation-time","user-template-01","user-template-02","user-template-03"] },
  { id: "test-instances", label: "Test Lab", icon: "\u25B6", apiPath: "test-instances", fields: ["id","test-id","cycle-id","status","exec-date","exec-time","actual-tester","host-name"] },
  { id: "defects", label: "Defects", icon: "\u26A0", apiPath: "defects", fields: ["id","name","severity","priority","status","owner","description","creation-time","closing-date","detected-by","assigned-to"] },
  { id: "requirements", label: "Requirements", icon: "\u2B50", apiPath: "requirements", fields: ["id","name","type-id","author","priority","description","creation-time","father-id","req-priority","req-reviewed"] },
  { id: "test-sets", label: "Test Sets", icon: "\u{1F4C1}", apiPath: "test-sets", fields: ["id","name","subtype-id","status","description","open-date","close-date"] },
  { id: "runs", label: "Test Runs", icon: "\u23F1", apiPath: "runs", fields: ["id","name","test-id","testcycl-id","status","execution-date","execution-time","duration","host","os-name"] },
];

function sanitize(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.length > 32000) return s.slice(0, 32000);
  return s;
}

function escapeXml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

function chunkArray(arr, sz) {
  const r = [];
  for (let i = 0; i < arr.length; i += sz) r.push(arr.slice(i, i + sz));
  return r;
}

function validateUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch { return false; }
}

function validateToken(t) {
  return typeof t === "string" && t.length >= 8 && t.length <= 4096 && !/[<>"';\s]/.test(t);
}

function validateProjectId(p) {
  return /^\d{1,15}$/.test(String(p));
}

function parseAlmXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const entities = doc.querySelectorAll("Entity");
  const results = [];
  entities.forEach(ent => {
    const obj = {};
    ent.querySelectorAll("Field").forEach(f => {
      const name = f.getAttribute("Name");
      const valEl = f.querySelector("Value");
      if (name && valEl) obj[name] = sanitize(valEl.textContent);
    });
    results.push(obj);
  });
  return results;
}

export default function MigrationSuite() {
  const [theme, setTheme] = useState(() => {
    try {
      const stored = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
      return stored ? "dark" : "light";
    } catch { return "dark"; }
  });
  const [activeTab, setActiveTab] = useState(TABS.ALM_EXPORT);

  const [almUrl, setAlmUrl] = useState("");
  const [almUser, setAlmUser] = useState("");
  const [almPass, setAlmPass] = useState("");
  const [almDomain, setAlmDomain] = useState("");
  const [almProject, setAlmProject] = useState("");
  const [almConn, setAlmConn] = useState(CONN.IDLE);
  const [almError, setAlmError] = useState("");
  const [almCookies, setAlmCookies] = useState(null);
  const [almSelectedEntity, setAlmSelectedEntity] = useState("tests");
  const [almExportData, setAlmExportData] = useState([]);
  const [almExportProgress, setAlmExportProgress] = useState({ done: 0, total: 0, status: "idle" });
  const [almIncludeAttachments, setAlmIncludeAttachments] = useState(true);
  const [almPageSize, setAlmPageSize] = useState(100);
  const [almQueryFilter, setAlmQueryFilter] = useState("");

  const [qtUrl, setQtUrl] = useState("");
  const [qtToken, setQtToken] = useState("");
  const [qtProjectId, setQtProjectId] = useState("");
  const [qtConn, setQtConn] = useState(CONN.IDLE);
  const [qtError, setQtError] = useState("");
  const [qtProjects, setQtProjects] = useState([]);
  const [qtModules, setQtModules] = useState([]);
  const [qtTargetModule, setQtTargetModule] = useState("");
  const [qtTcFields, setQtTcFields] = useState([]);
  const [qtDefFields, setQtDefFields] = useState([]);

  const [fileName, setFileName] = useState("");
  const [excelHeaders, setExcelHeaders] = useState([]);
  const [excelRows, setExcelRows] = useState([]);
  const [excelPreview, setExcelPreview] = useState([]);
  const [tcMappings, setTcMappings] = useState({});
  const [tcCustomNames, setTcCustomNames] = useState({});
  const [defFileName, setDefFileName] = useState("");
  const [defHeaders, setDefHeaders] = useState([]);
  const [defRows, setDefRows] = useState([]);
  const [defPreview, setDefPreview] = useState([]);
  const [defMappings, setDefMappings] = useState({});
  const [defCustomNames, setDefCustomNames] = useState({});

  const [stepMode, setStepMode] = useState("separate");
  const [stepDelim, setStepDelim] = useState("\\n");
  const [batchSize, setBatchSize] = useState(10);
  const [dryRun, setDryRun] = useState(true);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, failed: 0, status: "idle" });

  const [logs, setLogs] = useState([]);
  const logEndRef = useRef(null);
  const fileRefTc = useRef(null);
  const fileRefDef = useRef(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const addLog = useCallback((level, msg) => {
    setLogs(p => [...p.slice(-499), { ts: new Date().toLocaleTimeString(), level, msg, id: Date.now() + Math.random() }]);
  }, []);

  const t = useMemo(() => {
    const dark = {
      bg: "#0c1018", bg2: "#121a28", bg3: "#1b2538", bg4: "#243048",
      accent: "#4f8ff7", accent2: "#7bb3ff", green: "#34d399", red: "#f87171",
      orange: "#fbbf24", text: "#d1d9e6", text2: "#8b9ab5", text3: "#5c6f8a",
      border: "#1e2d44", border2: "#2a3d58", cardBg: "#131d2e", shadow: "rgba(0,0,0,0.4)",
    };
    const light = {
      bg: "#f0f2f5", bg2: "#ffffff", bg3: "#e8ecf1", bg4: "#d5dce6",
      accent: "#2563eb", accent2: "#1d4ed8", green: "#059669", red: "#dc2626",
      orange: "#d97706", text: "#1e293b", text2: "#475569", text3: "#94a3b8",
      border: "#e2e8f0", border2: "#cbd5e1", cardBg: "#ffffff", shadow: "rgba(0,0,0,0.08)",
    };
    return theme === "dark" ? dark : light;
  }, [theme]);

  // ── ALM API ──
  const almApiCall = useCallback(async (method, path, body, isAuth) => {
    if (!validateUrl(almUrl)) throw new Error("Invalid server URL format");
    const base = almUrl.replace(/\/+$/, "");
    const url = `${base}${path}`;
    const opts = { method, credentials: "include", headers: {} };
    if (isAuth) {
      opts.headers["Authorization"] = "Basic " + btoa(almUser + ":" + almPass);
    }
    if (body) { opts.headers["Content-Type"] = "application/xml"; opts.body = body; }
    opts.headers["Accept"] = "application/xml";
    const res = await fetch(url, opts);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${sanitize(txt).slice(0, 200)}`);
    }
    return res;
  }, [almUrl, almUser, almPass]);

  const connectAlm = useCallback(async () => {
    setAlmConn(CONN.BUSY); setAlmError("");
    try {
      if (!validateUrl(almUrl)) throw new Error("Enter a valid URL (http/https)");
      if (!almUser || !almDomain || !almProject) throw new Error("All fields are required");
      await almApiCall("POST", "/qcbin/authentication-point/authenticate", null, true);
      await almApiCall("POST", "/qcbin/rest/site-session", null, false);
      setAlmConn(CONN.OK);
      addLog("success", `Connected to server. Domain: ${sanitize(almDomain)}, Project: ${sanitize(almProject)}`);
    } catch (e) {
      setAlmConn(CONN.FAIL);
      setAlmError(e.message);
      addLog("error", `Connection failed: ${e.message}`);
    }
  }, [almUrl, almUser, almPass, almDomain, almProject, almApiCall, addLog]);

  const exportFromAlm = useCallback(async () => {
    if (almConn !== CONN.OK) { addLog("error", "Not connected to server"); return; }
    const entity = ALM_ENTITIES.find(e => e.id === almSelectedEntity);
    if (!entity) return;
    setAlmExportProgress({ done: 0, total: 0, status: "running" });
    setAlmExportData([]);
    addLog("info", `Starting export: ${entity.label}...`);

    try {
      let allItems = [];
      let startIdx = 1;
      let hasMore = true;
      const pageSize = Math.min(Math.max(Number(almPageSize) || 100, 10), 2000);
      const basePath = `/qcbin/rest/domains/${encodeURIComponent(almDomain)}/projects/${encodeURIComponent(almProject)}/${entity.apiPath}`;

      while (hasMore) {
        let queryPath = `${basePath}?page-size=${pageSize}&start-index=${startIdx}`;
        if (almQueryFilter.trim()) {
          queryPath += `&query={${encodeURIComponent(almQueryFilter.trim())}}`;
        }
        const res = await almApiCall("GET", queryPath);
        const xmlText = await res.text();
        const items = parseAlmXml(xmlText);
        const totalMatch = xmlText.match(/TotalResults="(\d+)"/);
        const totalResults = totalMatch ? parseInt(totalMatch[1], 10) : items.length;
        setAlmExportProgress({ done: allItems.length + items.length, total: totalResults, status: "running" });
        allItems = allItems.concat(items);
        addLog("info", `Fetched ${allItems.length} / ${totalResults} ${entity.label}`);
        hasMore = allItems.length < totalResults && items.length > 0;
        startIdx += pageSize;
      }

      if (almIncludeAttachments && allItems.length > 0) {
        addLog("info", "Fetching evidences/attachments...");
        let attachCount = 0;
        for (let i = 0; i < allItems.length; i++) {
          const itemId = allItems[i].id;
          if (!itemId) continue;
          try {
            const attPath = `${basePath}/${encodeURIComponent(itemId)}/attachments`;
            const attRes = await almApiCall("GET", attPath);
            const attXml = await attRes.text();
            const attachments = parseAlmXml(attXml);
            if (attachments.length > 0) {
              allItems[i].__attachments = attachments.map(a => ({
                name: sanitize(a.name || ""),
                type: sanitize(a["file-type"] || a.type || ""),
                size: sanitize(a["file-size"] || ""),
                description: sanitize(a.description || ""),
              }));
              attachCount += attachments.length;
            }
          } catch { /* skip attachment errors silently */ }
          if (i % 20 === 0) {
            setAlmExportProgress(p => ({ ...p, done: allItems.length, status: `attachments: ${i+1}/${allItems.length}` }));
          }
        }
        addLog("info", `Found ${attachCount} attachment(s) across ${allItems.length} items`);
      }

      setAlmExportData(allItems);
      setAlmExportProgress({ done: allItems.length, total: allItems.length, status: "done" });
      addLog("success", `Export complete: ${allItems.length} ${entity.label} record(s)`);
    } catch (e) {
      setAlmExportProgress(p => ({ ...p, status: "error" }));
      addLog("error", `Export failed: ${e.message}`);
    }
  }, [almConn, almSelectedEntity, almDomain, almProject, almApiCall, almIncludeAttachments, almPageSize, almQueryFilter, addLog]);

  const downloadAlmExport = useCallback(() => {
    if (almExportData.length === 0) return;
    const entity = ALM_ENTITIES.find(e => e.id === almSelectedEntity);
    const allKeys = new Set();
    almExportData.forEach(item => {
      Object.keys(item).forEach(k => { if (k !== "__attachments") allKeys.add(k); });
    });
    const headers = [...allKeys];
    if (almIncludeAttachments) {
      headers.push("Attachment Names", "Attachment Types", "Attachment Sizes");
    }
    const wsData = [headers];
    almExportData.forEach(item => {
      const row = headers.map(h => {
        if (h === "Attachment Names") return (item.__attachments || []).map(a => a.name).join("; ");
        if (h === "Attachment Types") return (item.__attachments || []).map(a => a.type).join("; ");
        if (h === "Attachment Sizes") return (item.__attachments || []).map(a => a.size).join("; ");
        return sanitize(item[h]);
      });
      wsData.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, entity?.label || "Export");
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `alm_export_${entity?.id || "data"}_${dateStr}.xlsx`);
    addLog("success", "Excel file downloaded");
  }, [almExportData, almSelectedEntity, almIncludeAttachments, addLog]);

  // ── qTest API ──
  const qtApiCall = useCallback(async (method, path, body) => {
    if (!validateUrl(qtUrl)) throw new Error("Invalid qTest URL");
    if (!validateToken(qtToken)) throw new Error("Invalid API token format");
    const base = qtUrl.replace(/\/+$/, "");
    const url = `${base}/api/v3${path}`;
    const opts = {
      method,
      headers: { "Authorization": `Bearer ${qtToken}`, "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`${res.status}: ${sanitize(txt).slice(0, 300)}`);
    }
    return res.json();
  }, [qtUrl, qtToken]);

  const connectQt = useCallback(async () => {
    setQtConn(CONN.BUSY); setQtError("");
    try {
      if (!validateUrl(qtUrl)) throw new Error("Enter a valid URL");
      if (!validateToken(qtToken)) throw new Error("Token looks invalid (check length/characters)");
      const projs = await qtApiCall("GET", "/projects");
      setQtProjects(Array.isArray(projs) ? projs : []);
      setQtConn(CONN.OK);
      addLog("success", `Connected to qTest. ${projs.length} project(s) found.`);
    } catch (e) {
      setQtConn(CONN.FAIL); setQtError(e.message);
      addLog("error", `qTest connection failed: ${e.message}`);
    }
  }, [qtUrl, qtToken, qtApiCall, addLog]);

  const loadQtProject = useCallback(async (pid) => {
    setQtProjectId(pid);
    if (!pid || !validateProjectId(pid)) return;
    try {
      const [mods, tcFields, defFields] = await Promise.all([
        qtApiCall("GET", `/projects/${pid}/modules`),
        qtApiCall("GET", `/projects/${pid}/settings/test-cases/fields`),
        qtApiCall("GET", `/projects/${pid}/settings/defects/fields`),
      ]);
      const flatMods = flattenMods(Array.isArray(mods) ? mods : []);
      setQtModules(flatMods);
      setQtTcFields(Array.isArray(tcFields) ? tcFields : []);
      setQtDefFields(Array.isArray(defFields) ? defFields : []);
      addLog("info", `Loaded ${tcFields.length} TC fields, ${defFields.length} defect fields, ${flatMods.length} modules`);
    } catch (e) {
      addLog("error", `Project load failed: ${e.message}`);
    }
  }, [qtApiCall, addLog]);

  function flattenMods(mods, depth = 0) {
    let flat = [];
    for (const m of (mods || [])) {
      flat.push({ id: m.id, name: sanitize(m.name), depth });
      if (Array.isArray(m.children)) flat = flat.concat(flattenMods(m.children, depth + 1));
    }
    return flat;
  }

  // ── Excel parsing ──
  function handleExcelFile(e, type) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { addLog("error", "File too large (max 100 MB)"); return; }
    const validExts = [".xlsx", ".xls", ".csv"];
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!validExts.includes(ext)) { addLog("error", "Unsupported file type. Use .xlsx, .xls, or .csv"); return; }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (json.length === 0) { addLog("warn", "Sheet is empty"); return; }
        const hdrs = Object.keys(json[0]).map(h => sanitize(h));
        const safeRows = json.map(row => {
          const sr = {};
          hdrs.forEach(h => { sr[h] = sanitize(row[h]); });
          return sr;
        });

        if (type === "tc") {
          setFileName(file.name);
          setExcelHeaders(hdrs);
          setExcelRows(safeRows);
          setExcelPreview(safeRows.slice(0, 6));
          setTcMappings(autoMapTc(hdrs));
        } else {
          setDefFileName(file.name);
          setDefHeaders(hdrs);
          setDefRows(safeRows);
          setDefPreview(safeRows.slice(0, 6));
          setDefMappings(autoMapDef(hdrs));
        }
        addLog("info", `Loaded "${sanitize(file.name)}": ${safeRows.length} rows, ${hdrs.length} columns`);
      } catch (err) {
        addLog("error", `Parse error: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function autoMapTc(hdrs) {
    const m = {};
    hdrs.forEach(h => {
      const low = h.toLowerCase().trim();
      if (low.includes("test name") || low === "name" || low === "test case name" || low === "subject") m[h] = "name";
      else if (low === "description" || low.includes("test description")) m[h] = "description";
      else if (low.includes("precondition") || low.includes("pre-condition")) m[h] = "precondition";
      else if (low.includes("step description") || low.includes("step action") || low === "step name") m[h] = "test_steps.description";
      else if (low.includes("expected result") || low.includes("expected output")) m[h] = "test_steps.expected";
      else if (low === "status") m[h] = "properties.Status";
      else if (low === "priority") m[h] = "properties.Priority";
      else if (low === "type") m[h] = "properties.Type";
      else m[h] = "__skip__";
    });
    return m;
  }

  function autoMapDef(hdrs) {
    const m = {};
    hdrs.forEach(h => {
      const low = h.toLowerCase().trim();
      if (low === "name" || low === "summary" || low === "defect name" || low === "defect summary") m[h] = "summary";
      else if (low === "description" || low.includes("defect description")) m[h] = "description";
      else if (low === "severity") m[h] = "properties.Severity";
      else if (low === "priority") m[h] = "properties.Priority";
      else if (low === "status") m[h] = "properties.Status";
      else if (low === "type" || low === "defect type") m[h] = "properties.Type";
      else if (low.includes("assigned") || low === "owner") m[h] = "properties.Assigned To";
      else if (low.includes("detected") || low.includes("reported")) m[h] = "properties.Reported By";
      else m[h] = "__skip__";
    });
    return m;
  }

  const QTEST_TC_TARGETS = [
    { label: "Name (required)", value: "name" },
    { label: "Description", value: "description" },
    { label: "Precondition", value: "precondition" },
    { label: "Status", value: "properties.Status" },
    { label: "Priority", value: "properties.Priority" },
    { label: "Type", value: "properties.Type" },
    { label: "Assigned To", value: "properties.Assigned To" },
    { label: "Test Step \u2014 Description", value: "test_steps.description" },
    { label: "Test Step \u2014 Expected", value: "test_steps.expected" },
    { label: "\u2014 Skip \u2014", value: "__skip__" },
    { label: "\u2014 Custom Field \u2014", value: "__custom__" },
  ];

  const QTEST_DEF_TARGETS = [
    { label: "Summary (required)", value: "summary" },
    { label: "Description", value: "description" },
    { label: "Severity", value: "properties.Severity" },
    { label: "Priority", value: "properties.Priority" },
    { label: "Status", value: "properties.Status" },
    { label: "Type", value: "properties.Type" },
    { label: "Assigned To", value: "properties.Assigned To" },
    { label: "Reported By", value: "properties.Reported By" },
    { label: "Fixed Version", value: "properties.Fixed Version" },
    { label: "\u2014 Skip \u2014", value: "__skip__" },
    { label: "\u2014 Custom Field \u2014", value: "__custom__" },
  ];

  function buildTcPayloads() {
    const nameCol = Object.entries(tcMappings).find(([, v]) => v === "name")?.[0];
    if (!nameCol) throw new Error("Map at least one column to 'Name'");
    const grouped = new Map();
    excelRows.forEach(row => {
      const n = String(row[nameCol] || "").trim();
      if (!n) return;
      if (!grouped.has(n)) grouped.set(n, []);
      grouped.get(n).push(row);
    });
    const payloads = [];
    for (const [tcName, rows] of grouped) {
      const first = rows[0];
      const p = { name: tcName, properties: [], test_steps: [] };
      if (qtTargetModule) p.parent_id = Number(qtTargetModule);
      for (const [col, target] of Object.entries(tcMappings)) {
        if (["__skip__", "__custom__", "name", "test_steps.description", "test_steps.expected"].includes(target)) continue;
        const val = String(first[col] || "").trim();
        if (!val) continue;
        if (target === "description") p.description = val;
        else if (target === "precondition") p.precondition = val;
        else if (target.startsWith("properties.")) {
          const fn = target.replace("properties.", "");
          const fd = qtTcFields.find(f => f.label === fn);
          if (fd) {
            let fv = val;
            if (Array.isArray(fd.allowed_values)) {
              const match = fd.allowed_values.find(av => String(av.label || "").toLowerCase() === val.toLowerCase());
              if (match) fv = String(match.value);
            }
            p.properties.push({ field_id: fd.id, field_value: fv });
          }
        }
      }
      for (const [col, target] of Object.entries(tcMappings)) {
        if (target !== "__custom__") continue;
        const cfn = tcCustomNames[col];
        if (!cfn) continue;
        const val = String(first[col] || "").trim();
        const fd = qtTcFields.find(f => f.label === cfn);
        if (fd) {
          let fv = val;
          if (Array.isArray(fd.allowed_values)) {
            const match = fd.allowed_values.find(av => String(av.label || "").toLowerCase() === val.toLowerCase());
            if (match) fv = String(match.value);
          }
          p.properties.push({ field_id: fd.id, field_value: fv });
        }
      }
      const sdCol = Object.entries(tcMappings).find(([, v]) => v === "test_steps.description")?.[0];
      const seCol = Object.entries(tcMappings).find(([, v]) => v === "test_steps.expected")?.[0];
      if (sdCol) {
        if (stepMode === "separate") {
          rows.forEach((r, i) => {
            const d = String(r[sdCol] || "").trim();
            if (d) p.test_steps.push({ description: d, expected: seCol ? String(r[seCol] || "").trim() : "", order: i });
          });
        } else {
          const delim = stepDelim === "\\n" ? "\n" : stepDelim;
          const parts = String(first[sdCol] || "").split(delim).map(s => s.trim()).filter(Boolean);
          const expRaw = seCol ? String(first[seCol] || "") : "";
          const expParts = expRaw.split(delim).map(s => s.trim());
          parts.forEach((d, i) => { p.test_steps.push({ description: d, expected: expParts[i] || "", order: i }); });
        }
      }
      payloads.push(p);
    }
    return payloads;
  }

  function buildDefPayloads() {
    const sumCol = Object.entries(defMappings).find(([, v]) => v === "summary")?.[0];
    if (!sumCol) throw new Error("Map at least one column to 'Summary'");
    return defRows.map(row => {
      const name = String(row[sumCol] || "").trim();
      if (!name) return null;
      const p = { properties: [] };
      for (const [col, target] of Object.entries(defMappings)) {
        if (["__skip__", "__custom__", "summary"].includes(target)) continue;
        const val = String(row[col] || "").trim();
        if (!val) continue;
        if (target === "description") {
          const descField = qtDefFields.find(f => f.label === "Description");
          if (descField) p.properties.push({ field_id: descField.id, field_value: val });
        } else if (target.startsWith("properties.")) {
          const fn = target.replace("properties.", "");
          const fd = qtDefFields.find(f => f.label === fn);
          if (fd) {
            let fv = val;
            if (Array.isArray(fd.allowed_values)) {
              const match = fd.allowed_values.find(av => String(av.label || "").toLowerCase() === val.toLowerCase());
              if (match) fv = String(match.value);
            }
            p.properties.push({ field_id: fd.id, field_value: fv });
          }
        }
      }
      for (const [col, target] of Object.entries(defMappings)) {
        if (target !== "__custom__") continue;
        const cfn = defCustomNames[col];
        if (!cfn) continue;
        const val = String(row[col] || "").trim();
        const fd = qtDefFields.find(f => f.label === cfn);
        if (fd) {
          let fv = val;
          if (Array.isArray(fd.allowed_values)) {
            const match = fd.allowed_values.find(av => String(av.label || "").toLowerCase() === val.toLowerCase());
            if (match) fv = String(match.value);
          }
          p.properties.push({ field_id: fd.id, field_value: fv });
        }
      }
      const summaryField = qtDefFields.find(f => f.label === "Summary");
      if (summaryField) p.properties.push({ field_id: summaryField.id, field_value: name });
      return p;
    }).filter(Boolean);
  }

  async function runImport(type) {
    setImportProgress({ done: 0, total: 0, failed: 0, status: "running" });
    try {
      const payloads = type === "tc" ? buildTcPayloads() : buildDefPayloads();
      const total = payloads.length;
      if (total === 0) { addLog("warn", "No valid records to import"); setImportProgress({ done: 0, total: 0, failed: 0, status: "idle" }); return; }
      addLog("info", `Prepared ${total} ${type === "tc" ? "test case" : "defect"}(s)`);
      if (dryRun) {
        addLog("info", "\uD83D\uDD12 DRY RUN \u2014 validating payloads, no API calls");
        payloads.forEach((p, i) => {
          const label = type === "tc" ? p.name : (p.properties.find(pr => pr.field_value)?.field_value || `#${i+1}`);
          const pCount = p.properties?.length || 0;
          const sCount = p.test_steps?.length || 0;
          addLog("dry", `[${i+1}/${total}] ${sanitize(label)} \u2014 ${pCount} field(s)${type === "tc" ? `, ${sCount} step(s)` : ""}`);
        });
        setImportProgress({ done: total, total, failed: 0, status: "done" });
        addLog("success", `Dry run complete. ${total} record(s) validated.`);
        return;
      }
      if (!validateProjectId(qtProjectId)) throw new Error("Select a qTest project first");
      let done = 0, failed = 0;
      const endpoint = type === "tc" ? `/projects/${qtProjectId}/test-cases` : `/projects/${qtProjectId}/defects`;
      const batches = chunkArray(payloads, Math.min(Math.max(batchSize, 1), 50));
      for (const batch of batches) {
        const results = await Promise.allSettled(batch.map(p => qtApiCall("POST", endpoint, p)));
        results.forEach((r, i) => {
          done++;
          const label = type === "tc" ? batch[i].name : `Defect #${done}`;
          if (r.status === "fulfilled") {
            addLog("success", `\u2713 ${sanitize(label)} \u2192 ${r.value.pid || r.value.id}`);
          } else {
            failed++;
            addLog("error", `\u2717 ${sanitize(label)}: ${r.reason?.message || "Unknown error"}`);
          }
          setImportProgress({ done, total, failed, status: "running" });
        });
        if (batches.length > 1) await new Promise(r => setTimeout(r, 350));
      }
      setImportProgress({ done, total, failed, status: "done" });
      addLog("success", `Import done: ${done - failed} ok, ${failed} failed of ${total}`);
    } catch (e) {
      addLog("error", `Import aborted: ${e.message}`);
      setImportProgress(p => ({ ...p, status: "error" }));
    }
  }

  const tcHasName = Object.values(tcMappings).includes("name");
  const defHasSummary = Object.values(defMappings).includes("summary");
  const tcMappedCount = Object.values(tcMappings).filter(v => v !== "__skip__").length;
  const defMappedCount = Object.values(defMappings).filter(v => v !== "__skip__").length;

  // ── Styles ──
  const S = useMemo(() => ({
    wrap: { fontFamily: "'DM Sans', 'Nunito Sans', system-ui, sans-serif", background: t.bg, color: t.text, minHeight: "100vh" },
    header: { padding: "20px 28px", background: theme === "dark" ? "linear-gradient(135deg, #0f1929 0%, #162240 100%)" : "linear-gradient(135deg, #e0e7ff 0%, #f0f4ff 100%)", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" },
    h1: { margin: 0, fontSize: 21, fontWeight: 700, color: theme === "dark" ? "#fff" : "#111827", letterSpacing: -0.3 },
    subtitle: { margin: "3px 0 0", fontSize: 12, color: t.text2 },
    body: { padding: "16px 28px", maxWidth: 1280 },
    card: { background: t.cardBg, border: `1px solid ${t.border}`, borderRadius: 10, padding: "18px 20px", marginBottom: 14, boxShadow: `0 1px 3px ${t.shadow}` },
    cardTitle: { margin: "0 0 14px", fontSize: 13, fontWeight: 700, color: t.accent2, textTransform: "uppercase", letterSpacing: 0.6, display: "flex", alignItems: "center", gap: 8 },
    row: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
    input: { background: t.bg3, border: `1px solid ${t.border2}`, color: t.text, borderRadius: 6, padding: "7px 12px", fontSize: 13, outline: "none" },
    select: { background: t.bg3, border: `1px solid ${t.border2}`, color: t.text, borderRadius: 6, padding: "7px 12px", fontSize: 13, cursor: "pointer", outline: "none" },
    btn: { padding: "7px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" },
    stepNum: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: t.accent, color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0 },
    connDot: (s) => ({ width: 8, height: 8, borderRadius: "50%", display: "inline-block", marginRight: 5, background: s === CONN.OK ? t.green : s === CONN.FAIL ? t.red : t.text3, boxShadow: s === CONN.OK ? `0 0 6px ${t.green}` : "none" }),
    badge: (c) => ({ display: "inline-block", padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: c + "22", color: c }),
    table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
    th: { textAlign: "left", padding: "7px 8px", color: t.text2, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${t.border2}`, whiteSpace: "nowrap" },
    td: { padding: "6px 8px", borderBottom: `1px solid ${t.border}`, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 },
    progressBar: { height: 5, background: t.bg3, borderRadius: 3, overflow: "hidden", margin: "6px 0" },
    progressFill: (pct) => ({ height: "100%", width: `${pct}%`, background: t.accent, borderRadius: 3, transition: "width 0.3s" }),
    mapRow: { display: "grid", gridTemplateColumns: "1fr 20px 1fr auto", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${t.border}` },
    logPanel: { background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: 10, maxHeight: 280, overflowY: "auto", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 11.5, lineHeight: 1.7 },
    statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 14 },
    statCard: { background: t.bg3, borderRadius: 8, padding: 12, textAlign: "center" },
    statNum: { fontSize: 26, fontWeight: 700, color: theme === "dark" ? "#fff" : t.text },
    statLbl: { fontSize: 10, color: t.text3, textTransform: "uppercase", marginTop: 2 },
    tabBar: { display: "flex", gap: 2, marginBottom: 14, borderBottom: `2px solid ${t.border}`, paddingBottom: 0 },
    tab: (active) => ({ padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: active ? t.accent2 : t.text3, borderBottom: active ? `2px solid ${t.accent}` : "2px solid transparent", marginBottom: -2, transition: "all 0.15s", background: "transparent", border: "none", borderBottomWidth: 2, borderBottomStyle: "solid", borderBottomColor: active ? t.accent : "transparent" }),
    themeBtn: { background: t.bg3, border: `1px solid ${t.border2}`, color: t.text2, borderRadius: 20, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 },
  }), [t, theme]);

  const logColor = { info: t.text2, success: t.green, error: t.red, dry: t.orange, warn: t.orange };

  function renderMappingSection(headers, mappings, setMap, customNames, setCustom, targets, fields, requiredKey, requiredLabel) {
    const mappedCount = Object.values(mappings).filter(v => v !== "__skip__").length;
    const hasRequired = Object.values(mappings).includes(requiredKey);
    return (
      <div style={S.card}>
        <h3 style={S.cardTitle}>Field Mapping
          <span style={S.badge(t.green)}>{mappedCount} mapped</span>
          {!hasRequired && <span style={S.badge(t.red)}>\u26A0 {requiredLabel} required</span>}
        </h3>
        <div style={{ ...S.mapRow, borderBottom: `1px solid ${t.border2}`, paddingBottom: 4, marginBottom: 2 }}>
          <span style={{ fontSize: 10, color: t.text3, fontWeight: 700, textTransform: "uppercase" }}>Excel Column</span>
          <span />
          <span style={{ fontSize: 10, color: t.text3, fontWeight: 700, textTransform: "uppercase" }}>qTest Field</span>
          <span />
        </div>
        {headers.map(h => (
          <div style={S.mapRow} key={h}>
            <span style={{ fontSize: 13, color: theme === "dark" ? "#fff" : t.text, fontWeight: 500 }}>{h}</span>
            <span style={{ color: t.text3, textAlign: "center" }}>\u2192</span>
            <select style={S.select} value={mappings[h] || "__skip__"} onChange={e => setMap(p => ({ ...p, [h]: e.target.value }))}>
              {targets.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              {fields.filter(f => !targets.some(sf => sf.label.replace(/ \(required\)/, "") === f.label)).map(f => (
                <option key={f.id} value={`properties.${f.label}`}>Field: {f.label}</option>
              ))}
            </select>
            <span>
              {mappings[h] === "__custom__" && (
                <input style={{ ...S.input, width: 150 }} placeholder="Custom field name" value={customNames[h] || ""} onChange={e => setCustom(p => ({ ...p, [h]: e.target.value }))} />
              )}
              {mappings[h] === requiredKey && <span style={S.badge(t.green)}>req</span>}
            </span>
          </div>
        ))}
      </div>
    );
  }

  function renderPreviewTable(headers, previewRows) {
    if (headers.length === 0) return null;
    return (
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <div style={{ fontSize: 11, color: t.text2, marginBottom: 6 }}>Preview (first rows):</div>
        <table style={S.table}>
          <thead><tr>{headers.map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {previewRows.map((row, i) => (
              <tr key={i}>{headers.map(h => <td key={h} style={S.td} title={String(row[h] || "")}>{String(row[h] || "")}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>Migration Suite</h1>
          <p style={S.subtitle}>Export from source system (all tabs) \u2192 Import test cases & defects into qTest</p>
        </div>
        <button style={S.themeBtn} onClick={() => setTheme(th => th === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "\u2600\uFE0F Light" : "\uD83C\uDF19 Dark"}
        </button>
      </div>

      <div style={S.body}>
        <div style={S.tabBar}>
          {[
            { id: TABS.ALM_EXPORT, label: "\uD83D\uDCE4 Export from Source" },
            { id: TABS.IMPORT_TC, label: "\uD83D\uDCE5 Import Test Cases" },
            { id: TABS.IMPORT_DEF, label: "\uD83D\uDC1B Import Defects" },
            { id: TABS.LOG, label: "\uD83D\uDCCB Activity Log" },
          ].map(tab => (
            <button key={tab.id} style={S.tab(activeTab === tab.id)} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
          ))}
        </div>

        {/* ══════ TAB: ALM EXPORT ══════ */}
        {activeTab === TABS.ALM_EXPORT && (
          <>
            <div style={S.card}>
              <h3 style={S.cardTitle}><span style={S.stepNum}>1</span> Source System Connection</h3>
              <div style={{ ...S.row, marginBottom: 10 }}>
                <input style={{ ...S.input, flex: 2, minWidth: 220 }} placeholder="Server URL (e.g. https://alm.company.com)" value={almUrl} onChange={e => setAlmUrl(e.target.value)} />
                <input style={{ ...S.input, flex: 1 }} placeholder="Username" value={almUser} onChange={e => setAlmUser(e.target.value)} />
                <input style={{ ...S.input, flex: 1 }} placeholder="Password" type="password" value={almPass} onChange={e => setAlmPass(e.target.value)} />
              </div>
              <div style={{ ...S.row, marginBottom: 10 }}>
                <input style={{ ...S.input, flex: 1 }} placeholder="Domain" value={almDomain} onChange={e => setAlmDomain(e.target.value)} />
                <input style={{ ...S.input, flex: 1 }} placeholder="Project Name" value={almProject} onChange={e => setAlmProject(e.target.value)} />
                <button style={{ ...S.btn, background: t.accent, color: "#fff" }} onClick={connectAlm} disabled={almConn === CONN.BUSY}>
                  {almConn === CONN.BUSY ? "Connecting\u2026" : "Connect"}
                </button>
                <span><span style={S.connDot(almConn)} /><span style={{ fontSize: 12, color: t.text2 }}>{almConn === CONN.OK ? "Connected" : almConn === CONN.FAIL ? "Failed" : almConn === CONN.BUSY ? "Testing\u2026" : "Disconnected"}</span></span>
              </div>
              {almError && <div style={{ color: t.red, fontSize: 12 }}>{almError}</div>}
            </div>

            <div style={S.card}>
              <h3 style={S.cardTitle}><span style={S.stepNum}>2</span> Select Entity & Export</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {ALM_ENTITIES.map(ent => (
                  <button key={ent.id} onClick={() => setAlmSelectedEntity(ent.id)}
                    style={{ ...S.btn, background: almSelectedEntity === ent.id ? t.accent : t.bg3, color: almSelectedEntity === ent.id ? "#fff" : t.text2, border: `1px solid ${almSelectedEntity === ent.id ? t.accent : t.border2}` }}>
                    {ent.icon} {ent.label}
                  </button>
                ))}
              </div>
              <div style={{ ...S.row, marginBottom: 10 }}>
                <input style={{ ...S.input, flex: 2 }} placeholder="Filter query (optional, e.g. status['Open'])" value={almQueryFilter} onChange={e => setAlmQueryFilter(e.target.value)} />
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5, color: t.text2, cursor: "pointer" }}>
                  <input type="checkbox" checked={almIncludeAttachments} onChange={e => setAlmIncludeAttachments(e.target.checked)} /> Include evidences/attachments
                </label>
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5, color: t.text2 }}>
                  Page size: <input type="number" style={{ ...S.input, width: 65 }} min={10} max={2000} value={almPageSize} onChange={e => setAlmPageSize(e.target.value)} />
                </label>
              </div>
              <div style={S.row}>
                <button style={{ ...S.btn, background: t.accent, color: "#fff" }} onClick={exportFromAlm} disabled={almConn !== CONN.OK || almExportProgress.status === "running"}>
                  {almExportProgress.status === "running" ? "Exporting\u2026" : `Export ${ALM_ENTITIES.find(e => e.id === almSelectedEntity)?.label || ""}`}
                </button>
                {almExportData.length > 0 && (
                  <button style={{ ...S.btn, background: t.green, color: "#fff" }} onClick={downloadAlmExport}>
                    \u2B07 Download as Excel ({almExportData.length} records)
                  </button>
                )}
              </div>
              {almExportProgress.total > 0 && (
                <>
                  <div style={S.progressBar}>
                    <div style={S.progressFill(almExportProgress.total ? (almExportProgress.done / almExportProgress.total * 100) : 0)} />
                  </div>
                  <div style={{ fontSize: 11, color: t.text3 }}>{almExportProgress.done} / {almExportProgress.total} \u2014 {almExportProgress.status}</div>
                </>
              )}
              {almExportData.length > 0 && (
                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  <div style={{ fontSize: 11, color: t.text2, marginBottom: 6 }}>Preview (first 5):</div>
                  <table style={S.table}>
                    <thead>
                      <tr>{Object.keys(almExportData[0]).filter(k => k !== "__attachments").slice(0, 10).map(k => <th key={k} style={S.th}>{k}</th>)}
                        {almIncludeAttachments && <th style={S.th}>Attachments</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {almExportData.slice(0, 5).map((item, i) => (
                        <tr key={i}>
                          {Object.keys(almExportData[0]).filter(k => k !== "__attachments").slice(0, 10).map(k => (
                            <td key={k} style={S.td} title={String(item[k] || "")}>{String(item[k] || "")}</td>
                          ))}
                          {almIncludeAttachments && (
                            <td style={S.td}>{(item.__attachments || []).map(a => a.name).join(", ") || "\u2014"}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══════ TAB: IMPORT TEST CASES ══════ */}
        {activeTab === TABS.IMPORT_TC && (
          <>
            <div style={S.card}>
              <h3 style={S.cardTitle}><span style={S.stepNum}>1</span> qTest Connection</h3>
              <div style={{ ...S.row, marginBottom: 10 }}>
                <input style={{ ...S.input, flex: 2, minWidth: 220 }} placeholder="qTest URL (e.g. https://yourco.qtestnet.com)" value={qtUrl} onChange={e => setQtUrl(e.target.value)} />
                <input style={{ ...S.input, flex: 2 }} placeholder="API Bearer Token" type="password" value={qtToken} onChange={e => setQtToken(e.target.value)} />
                <button style={{ ...S.btn, background: t.accent, color: "#fff" }} onClick={connectQt} disabled={qtConn === CONN.BUSY}>
                  {qtConn === CONN.BUSY ? "Connecting\u2026" : "Connect"}
                </button>
                <span><span style={S.connDot(qtConn)} /><span style={{ fontSize: 12, color: t.text2 }}>{qtConn === CONN.OK ? "Connected" : qtConn === CONN.FAIL ? "Failed" : "Not connected"}</span></span>
              </div>
              {qtError && <div style={{ color: t.red, fontSize: 12 }}>{qtError}</div>}
              {qtConn === CONN.OK && (
                <div style={S.row}>
                  <select style={{ ...S.select, flex: 1 }} value={qtProjectId} onChange={e => loadQtProject(e.target.value)}>
                    <option value="">\u2014 Select Project \u2014</option>
                    {qtProjects.map(p => <option key={p.id} value={p.id}>{sanitize(p.name)} (ID: {p.id})</option>)}
                  </select>
                  <select style={{ ...S.select, flex: 1 }} value={qtTargetModule} onChange={e => setQtTargetModule(e.target.value)}>
                    <option value="">\u2014 Target Module (optional) \u2014</option>
                    {qtModules.map(m => <option key={m.id} value={m.id}>{"\u2502 ".repeat(m.depth)}{m.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div style={S.card}>
              <h3 style={S.cardTitle}><span style={S.stepNum}>2</span> Upload Test Case Excel</h3>
              <div style={S.row}>
                <button style={{ ...S.btn, background: "transparent", color: t.text2, border: `1px solid ${t.border2}` }} onClick={() => fileRefTc.current?.click()}>
                  {fileName || "Choose .xlsx / .xls / .csv\u2026"}
                </button>
                <input ref={fileRefTc} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={e => handleExcelFile(e, "tc")} />
                {fileName && <span style={S.badge(t.accent)}>{excelRows.length} rows \u00B7 {excelHeaders.length} cols</span>}
              </div>
              {renderPreviewTable(excelHeaders, excelPreview)}
            </div>

            {excelHeaders.length > 0 && (
              <>
                {renderMappingSection(excelHeaders, tcMappings, setTcMappings, tcCustomNames, setTcCustomNames, QTEST_TC_TARGETS, qtTcFields, "name", "Name mapping")}

                <div style={S.card}>
                  <h3 style={S.cardTitle}><span style={S.stepNum}>4</span> Import Options</h3>
                  <div style={{ ...S.row, marginBottom: 12, gap: 16 }}>
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5, color: t.text2 }}>
                      Steps: <select style={S.select} value={stepMode} onChange={e => setStepMode(e.target.value)}>
                        <option value="merged">Single cell (split by delimiter)</option>
                        <option value="separate">Each row = one step</option>
                      </select>
                    </label>
                    {stepMode === "merged" && (
                      <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5, color: t.text2 }}>
                        Delimiter: <input style={{ ...S.input, width: 50 }} value={stepDelim} onChange={e => setStepDelim(e.target.value)} />
                      </label>
                    )}
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5, color: t.text2 }}>
                      Batch: <input type="number" style={{ ...S.input, width: 55 }} min={1} max={50} value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} />
                    </label>
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 7, cursor: "pointer", color: t.text2 }}>
                      <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
                      <span style={{ color: dryRun ? t.orange : t.text2 }}>Dry Run</span>
                    </label>
                  </div>
                  <div style={S.statsGrid}>
                    <div style={S.statCard}><div style={S.statNum}>{excelRows.length}</div><div style={S.statLbl}>Excel Rows</div></div>
                    <div style={S.statCard}><div style={{ ...S.statNum, color: t.accent2 }}>{(() => { try { return buildTcPayloads().length; } catch { return "\u2014"; } })()}</div><div style={S.statLbl}>Test Cases</div></div>
                    <div style={S.statCard}><div style={{ ...S.statNum, color: t.green }}>{tcMappedCount}</div><div style={S.statLbl}>Mapped</div></div>
                    <div style={S.statCard}><div style={{ ...S.statNum, color: importProgress.failed ? t.red : t.text3 }}>{importProgress.failed}</div><div style={S.statLbl}>Failed</div></div>
                  </div>
                  {importProgress.status === "running" && (
                    <div style={S.progressBar}><div style={S.progressFill(importProgress.total ? importProgress.done / importProgress.total * 100 : 0)} /></div>
                  )}
                  <div style={S.row}>
                    <button style={{ ...S.btn, background: t.orange, color: "#000" }} disabled={!tcHasName || excelRows.length === 0 || importProgress.status === "running"} onClick={() => { setDryRun(true); runImport("tc"); }}>
                      \uD83D\uDD0D Validate
                    </button>
                    <button style={{ ...S.btn, background: t.green, color: "#fff" }} disabled={!tcHasName || excelRows.length === 0 || !qtProjectId || importProgress.status === "running"} onClick={() => { setDryRun(false); runImport("tc"); }}>
                      \uD83D\uDE80 Import Test Cases
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ══════ TAB: IMPORT DEFECTS ══════ */}
        {activeTab === TABS.IMPORT_DEF && (
          <>
            <div style={S.card}>
              <h3 style={S.cardTitle}><span style={S.stepNum}>1</span> qTest Connection</h3>
              <div style={{ ...S.row, marginBottom: 10 }}>
                <input style={{ ...S.input, flex: 2, minWidth: 220 }} placeholder="qTest URL" value={qtUrl} onChange={e => setQtUrl(e.target.value)} />
                <input style={{ ...S.input, flex: 2 }} placeholder="API Bearer Token" type="password" value={qtToken} onChange={e => setQtToken(e.target.value)} />
                <button style={{ ...S.btn, background: t.accent, color: "#fff" }} onClick={connectQt} disabled={qtConn === CONN.BUSY}>
                  {qtConn === CONN.BUSY ? "Connecting\u2026" : "Connect"}
                </button>
                <span><span style={S.connDot(qtConn)} /><span style={{ fontSize: 12, color: t.text2 }}>{qtConn === CONN.OK ? "Connected" : qtConn === CONN.FAIL ? "Failed" : "Not connected"}</span></span>
              </div>
              {qtError && <div style={{ color: t.red, fontSize: 12 }}>{qtError}</div>}
              {qtConn === CONN.OK && (
                <div style={S.row}>
                  <select style={{ ...S.select, flex: 1 }} value={qtProjectId} onChange={e => loadQtProject(e.target.value)}>
                    <option value="">\u2014 Select Project \u2014</option>
                    {qtProjects.map(p => <option key={p.id} value={p.id}>{sanitize(p.name)} (ID: {p.id})</option>)}
                  </select>
                </div>
              )}
            </div>

            <div style={S.card}>
              <h3 style={S.cardTitle}><span style={S.stepNum}>2</span> Upload Defect Excel</h3>
              <div style={S.row}>
                <button style={{ ...S.btn, background: "transparent", color: t.text2, border: `1px solid ${t.border2}` }} onClick={() => fileRefDef.current?.click()}>
                  {defFileName || "Choose .xlsx / .xls / .csv\u2026"}
                </button>
                <input ref={fileRefDef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={e => handleExcelFile(e, "def")} />
                {defFileName && <span style={S.badge(t.accent)}>{defRows.length} rows \u00B7 {defHeaders.length} cols</span>}
              </div>
              {renderPreviewTable(defHeaders, defPreview)}
            </div>

            {defHeaders.length > 0 && (
              <>
                {renderMappingSection(defHeaders, defMappings, setDefMappings, defCustomNames, setDefCustomNames, QTEST_DEF_TARGETS, qtDefFields, "summary", "Summary mapping")}

                <div style={S.card}>
                  <h3 style={S.cardTitle}><span style={S.stepNum}>4</span> Import Options</h3>
                  <div style={{ ...S.row, marginBottom: 12, gap: 16 }}>
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5, color: t.text2 }}>
                      Batch: <input type="number" style={{ ...S.input, width: 55 }} min={1} max={50} value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} />
                    </label>
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 7, cursor: "pointer", color: t.text2 }}>
                      <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
                      <span style={{ color: dryRun ? t.orange : t.text2 }}>Dry Run</span>
                    </label>
                  </div>
                  <div style={S.statsGrid}>
                    <div style={S.statCard}><div style={S.statNum}>{defRows.length}</div><div style={S.statLbl}>Excel Rows</div></div>
                    <div style={S.statCard}><div style={{ ...S.statNum, color: t.accent2 }}>{(() => { try { return buildDefPayloads().length; } catch { return "\u2014"; } })()}</div><div style={S.statLbl}>Defects</div></div>
                    <div style={S.statCard}><div style={{ ...S.statNum, color: t.green }}>{defMappedCount}</div><div style={S.statLbl}>Mapped</div></div>
                    <div style={S.statCard}><div style={{ ...S.statNum, color: importProgress.failed ? t.red : t.text3 }}>{importProgress.failed}</div><div style={S.statLbl}>Failed</div></div>
                  </div>
                  {importProgress.status === "running" && (
                    <div style={S.progressBar}><div style={S.progressFill(importProgress.total ? importProgress.done / importProgress.total * 100 : 0)} /></div>
                  )}
                  <div style={S.row}>
                    <button style={{ ...S.btn, background: t.orange, color: "#000" }} disabled={!defHasSummary || defRows.length === 0 || importProgress.status === "running"} onClick={() => { setDryRun(true); runImport("def"); }}>
                      \uD83D\uDD0D Validate
                    </button>
                    <button style={{ ...S.btn, background: t.green, color: "#fff" }} disabled={!defHasSummary || defRows.length === 0 || !qtProjectId || importProgress.status === "running"} onClick={() => { setDryRun(false); runImport("def"); }}>
                      \uD83D\uDE80 Import Defects
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ══════ TAB: ACTIVITY LOG ══════ */}
        {activeTab === TABS.LOG && (
          <div style={S.card}>
            <h3 style={S.cardTitle}>Activity Log <span style={S.badge(t.text3)}>{logs.length} entries</span>
              {logs.length > 0 && (
                <button style={{ ...S.btn, background: t.bg3, color: t.text3, fontSize: 11, marginLeft: "auto" }} onClick={() => setLogs([])}>Clear</button>
              )}
            </h3>
            <div style={S.logPanel}>
              {logs.length === 0 && <div style={{ color: t.text3 }}>No activity yet.</div>}
              {logs.map(l => (
                <div key={l.id} style={{ color: logColor[l.level] || t.text2 }}>
                  <span style={{ color: t.text3, marginRight: 8 }}>{l.ts}</span>{l.msg}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* Inline log (visible on all tabs) */}
        {activeTab !== TABS.LOG && logs.length > 0 && (
          <div style={{ ...S.card, background: t.bg, borderColor: t.border }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: t.text3, fontWeight: 600, textTransform: "uppercase" }}>Recent Log</span>
              <button style={{ ...S.btn, background: "transparent", color: t.accent, fontSize: 11, padding: "3px 8px" }} onClick={() => setActiveTab(TABS.LOG)}>View All</button>
            </div>
            <div style={{ ...S.logPanel, maxHeight: 120 }}>
              {logs.slice(-8).map(l => (
                <div key={l.id} style={{ color: logColor[l.level] || t.text2 }}>
                  <span style={{ color: t.text3, marginRight: 8 }}>{l.ts}</span>{l.msg}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info footer */}
        <div style={{ ...S.card, background: t.bg, borderColor: t.border, marginTop: 8 }}>
          <div style={{ fontSize: 11, color: t.text3, lineHeight: 1.8 }}>
            <strong style={{ color: t.text2 }}>Export:</strong> Connects to the source system REST API. Supports Test Plan, Test Lab, Defects, Requirements, Test Sets, and Test Runs. Evidences/attachments are fetched per-item and included in the Excel export.<br />
            <strong style={{ color: t.text2 }}>Import Test Cases:</strong> Reads Excel, maps columns to qTest fields (auto-maps common names). Creates via <code style={{ background: t.bg3, padding: "1px 4px", borderRadius: 3 }}>POST /api/v3/projects/:id/test-cases</code>. Supports step grouping (row-per-step or delimiter-split).<br />
            <strong style={{ color: t.text2 }}>Import Defects:</strong> Same flow for defects via <code style={{ background: t.bg3, padding: "1px 4px", borderRadius: 3 }}>POST /api/v3/projects/:id/defects</code>. Maps severity, priority, status, type, and custom fields.<br />
            <strong style={{ color: t.text2 }}>Security:</strong> All inputs sanitized. URLs validated. Tokens never logged. No eval/innerHTML. No external storage. Data stays in-memory during session only.
          </div>
        </div>
      </div>
    </div>
  );
}
