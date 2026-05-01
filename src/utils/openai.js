const OPENAI_KEY = 'openai_api_key';

export function getOpenAIKey() {
  return localStorage.getItem(OPENAI_KEY) || '';
}

export function setOpenAIKey(key) {
  localStorage.setItem(OPENAI_KEY, key);
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
