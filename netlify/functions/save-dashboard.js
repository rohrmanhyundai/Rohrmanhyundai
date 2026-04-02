const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_PATH = process.env.GITHUB_PATH || "data.json";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Missing GitHub environment variables." }) };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    if (!payload.data) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing data payload." }) };
    }

    const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_PATH)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;

    const getRes = await fetch(getUrl, {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "rohrman-dashboard-save-function"
      }
    });

    let sha = null;
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha || null;
    } else if (getRes.status !== 404) {
      const text = await getRes.text();
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: `Failed to read existing file: ${text}` }) };
    }

    const content = Buffer.from(JSON.stringify(payload, null, 2), "utf8").toString("base64");

    const putRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_PATH)}`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "rohrman-dashboard-save-function"
      },
      body: JSON.stringify({
        message: `Update dashboard data ${new Date().toISOString()}`,
        content,
        branch: GITHUB_BRANCH,
        sha
      })
    });

    const putJson = await putRes.json();
    if (!putRes.ok) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: putJson.message || "GitHub update failed", details: putJson }) };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, commit: putJson.commit?.sha || null, contentPath: putJson.content?.path || GITHUB_PATH })
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message || "Unknown save error" }) };
  }
};