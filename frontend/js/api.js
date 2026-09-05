/* VocaVoid1 — API client for the VV backend (same-origin). English errors. */
const VV = (function () {
  async function req(method, path, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    const r = await fetch(path, opt);
    let data = null;
    const ct = r.headers.get("Content-Type") || "";
    if (ct.indexOf("application/json") !== -1) {
      try { data = await r.json(); } catch (e) { data = null; }
    }
    if (!r.ok) {
      const msg = (data && (data.error || data.message)) || ("HTTP " + r.status);
      throw new Error(msg);
    }
    return data;
  }

  return {
    health: () => req("GET", "/vv/api/v1/health"),
    listProjects: () => req("GET", "/vv/api/v1/projects"),
    createProject: (name) => req("POST", "/vv/api/v1/projects", { name: name || "" }),
    getProject: (id) => req("GET", "/vv/api/v1/projects/" + id),
    saveProject: (id, data) => req("PUT", "/vv/api/v1/projects/" + id, data),
    deleteProject: (id) => req("DELETE", "/vv/api/v1/projects/" + id),
    listVoicebanks: () => req("GET", "/vv/api/v1/voicebanks"),
    registerVoicebank: (path) => req("POST", "/vv/api/v1/voicebanks/register", { path: path }),
    synth: (id, opts) => req("POST", "/vv/api/v1/projects/" + id + "/synth", opts || {}),
  };
})();
