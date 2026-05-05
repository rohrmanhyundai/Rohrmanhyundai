const OPENAI_KEY = 'openai_api_key';

// Analyze a PDF's raw text and return a structured form definition (JSON)
export async function analyzeReviewForm(pdfText) {
  const key = getOpenAIKey();
  if (!key) throw new Error('No OpenAI API key set. Go to Admin Settings → OpenAI Settings.');

  const prompt = `You are an expert at analyzing HR/performance review forms. I will give you raw text extracted from a PDF performance review form. Analyze the structure and return a JSON form definition to build an interactive digital version.

Return ONLY valid JSON with NO markdown fences, NO explanation — just the raw JSON object.

Use this exact structure:
{
  "title": "Form title",
  "sections": [
    {
      "id": "s1",
      "title": "Section title",
      "description": "Optional instructions for this section",
      "fields": [
        {
          "id": "f1",
          "type": "radio",
          "label": "Question or label text",
          "options": ["Option A", "Option B", "Option C"]
        },
        {
          "id": "f2",
          "type": "rating_table",
          "label": "Rate each area below",
          "maxRating": 5,
          "items": [
            { "id": "f2_1", "label": "Item name", "hasComment": false }
          ]
        },
        {
          "id": "f3",
          "type": "yes_no_sometimes",
          "label": "Statement to evaluate"
        },
        {
          "id": "f4",
          "type": "yes_no",
          "label": "Yes or no question"
        },
        {
          "id": "f5",
          "type": "textarea",
          "label": "Open-ended question",
          "placeholder": "Your answer here...",
          "rows": 4
        },
        {
          "id": "f6",
          "type": "text",
          "label": "Short answer field"
        }
      ]
    }
  ]
}

Field type rules:
- "radio": Exactly one option chosen from a list (skill level, classification, etc.)
- "rating_table": A table of items each rated 1-N with circles/boxes (e.g. rate each skill area 1-5)
- "yes_no_sometimes": Three-way choice: Yes / No / Sometimes
- "yes_no": Two-way choice: Yes / No
- "textarea": Multi-line free text answer (anything asking them to "explain", "describe", "list", "how do you...")
- "text": Single short text input

Rules:
- Skip header info fields (name, date, reviewer, employee ID — these are auto-filled)
- Skip page numbers, form titles, copyright text
- Group logically related fields in one section
- Every checkbox □ or rating □1□2□3□4□5 in the original becomes a proper field
- Capture every question and rating area — be thorough

PDF TEXT:
${pdfText.slice(0, 8000)}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI error ${res.status}`);
  }

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content || '';

  // Strip any markdown fences if present
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try {
    return JSON.parse(content);
  } catch {
    throw new Error('AI could not parse the form structure. Make sure your OpenAI key is valid and try again.');
  }
}

export function getOpenAIKey() {
  return localStorage.getItem(OPENAI_KEY) || '';
}

export function setOpenAIKey(key) {
  localStorage.setItem(OPENAI_KEY, key);
}

export async function generateTechCoaching({ techName, weeklyEntries, wip, awaiting, goalHrs }) {
  const key = getOpenAIKey();
  if (!key) throw new Error('No OpenAI API key set. Go to Admin Settings → OpenAI Settings.');

  const fmt = (n, d = 1) => (n === null || n === undefined || n === '' ? '—' : Number(n).toFixed(d));
  const pct = (v) => (v === null || v === undefined || v === '' ? '—' : (Number(v) * 100).toFixed(1) + '%');

  // Build a compact recent-weeks table (most recent first, up to 13 weeks)
  const recent = (weeklyEntries || []).slice(0, 13);
  const weekTbl = recent.map(w => {
    const range = w.weekStart && w.weekEnd ? `${w.weekStart}→${w.weekEnd}` : (w.label || w.date || '');
    const ros   = w.total_ro != null ? `${w.total_ro} ROs` : '';
    return `  ${range}  total=${fmt(w.total)}  goal=${fmt(w.goal)}  pct=${pct(w.goal_pct)}  pacing=${fmt(w.pacing)}  ${ros}  [Sat ${fmt(w.sat)}h/${w.sat_ro ?? '?'}ro · Mon ${fmt(w.mon)}h/${w.mon_ro ?? '?'}ro · Tue ${fmt(w.tue)}h/${w.tue_ro ?? '?'}ro · Wed ${fmt(w.wed)}h/${w.wed_ro ?? '?'}ro · Thu ${fmt(w.thu)}h/${w.thu_ro ?? '?'}ro · Fri ${fmt(w.fri)}h/${w.fri_ro ?? '?'}ro]`;
  }).join('\n');

  const wipLines = (wip || []).map(j => {
    const age = j.roDate ? Math.floor((Date.now() - new Date(j.roDate + 'T00:00:00').getTime()) / 86400000) : '?';
    const tags = [j.highPriority ? 'HIGH-PRIORITY' : '', j.partsArrived === true ? 'parts arrived' : (j.partsArrived === false ? 'parts pending' : ''), j.etaParts ? `parts ETA ${j.etaParts}` : ''].filter(Boolean).join(', ');
    return `  RO ${j.ro || '?'} (${age}d old) — ${j.jobDesc || ''} ${tags ? `[${tags}]` : ''} ${j.notes ? `note: ${j.notes}` : ''}`;
  }).join('\n');

  const awaitingForTech = (awaiting || []).map(j => {
    const age = j.roDate ? Math.floor((Date.now() - new Date(j.roDate + 'T00:00:00').getTime()) / 86400000) : '?';
    return `  RO ${j.ro || '?'} (${age}d old) — ${j.jobDesc || ''}${j.highPriority ? ' [HIGH-PRIORITY]' : ''}`;
  }).join('\n');

  const prompt = `You are a seasoned automotive service-department manager coaching a technician at a Hyundai dealership. The tech's name is ${techName}.

Your job: review their recent performance numbers and open work, then write a constructive weekly coaching report. Be **direct and metrics-focused, but also supportive** — when calling out a weak area, frame it with positive coaching and a clear, specific action they can take. Acknowledge improvements they have already made. Don't be vague — point to specific days, weeks, or open ROs from the data below.

WEEKLY GOAL HOURS: ${goalHrs ?? 'unknown'}

RECENT WEEKLY PERFORMANCE (most recent first; "h" = flagged hours, "ro" = repair orders billed):
${weekTbl || '  (no data)'}

CURRENT WORK IN PROGRESS (open ROs assigned to this tech):
${wipLines || '  (none)'}

JOBS AWAITING ASSIGNMENT (shared queue; tech may pick these up):
${awaitingForTech || '  (none)'}

Output the report in this Markdown structure exactly. Sprinkle a tasteful emoji or two inside bullet points where it adds energy (e.g. ⚡ 🔥 💪 ⏱️ 🛠️ 📈 ✨ 👏 🚗 🧰), but do not overdo it — at most one emoji per bullet, and keep the headings exactly as written below.

## Summary
A 2-3 sentence overview tying together how their last week, last 6 weeks, and last 3 months are trending. Lead with the strongest positive observation.

## What's Working
- 3-5 specific bullet points calling out strengths or improvements you can see in the numbers (cite week dates, days of week, or RO counts).

## Where to Focus
- 3-5 specific bullets on weak areas. For each one: what the data shows, why it matters, and a positive next step. Avoid generic advice — reference specific days, hours, or ROs.

## Action Items for This Week
1. Concrete action #1 (referencing specific WIP or scheduling)
2. Concrete action #2
3. Concrete action #3

## WIP Watchlist
- Brief callout of any WIP that's aging, parts-pending, or high-priority that the tech should push on this week. If nothing notable, write "Nothing critical — keep moving."

Keep the entire report under 450 words. Use the tech's first name once or twice, but don't overdo it.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 900,
      temperature: 0.5,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI error ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function generateReviewReport({ techName, techAnswers, managerAnswers, questions }) {
  const key = getOpenAIKey();
  if (!key) throw new Error('No OpenAI API key set. Go to Admin Settings > OpenAI Key.');

  const questionList = questions.map((q, i) => `Q${i + 1}: ${q.question}`).join('\n');

  const techSection = questions.map((q, i) =>
    `Q${i + 1}: ${q.question}\nTech Answer: ${techAnswers[i] || '(no answer)'}`
  ).join('\n\n');

  const managerSection = questions.map((q, i) =>
    `Q${i + 1}: ${q.question}\nManager Answer/Rating: ${managerAnswers[i] || '(no response)'}`
  ).join('\n\n');

  const prompt = `You are an expert automotive dealership HR consultant. You have received a performance review for a service technician named ${techName}. Both the technician completed a self-evaluation and the manager completed an independent evaluation. Please write a professional, detailed, and constructive performance review report based on both perspectives.

The report should:
- Start with an executive summary
- Compare and contrast the tech's self-assessment vs the manager's assessment for each area
- Highlight strengths with specific examples from the answers
- Identify areas for growth with constructive, actionable recommendations
- End with an overall professional assessment and suggested goals
- Be written in a professional HR tone, suitable to share with both the employee and management
- Be detailed and thorough (aim for a comprehensive report)

TECHNICIAN SELF-EVALUATION:
${techSection}

MANAGER EVALUATION:
${managerSection}

Please write the full professional performance review report now.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI error ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}
