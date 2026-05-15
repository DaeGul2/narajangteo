// 실험실 — 기준 페이지(템플릿) + 지시문 + 선택한 DB 컨텍스트로 GPT 호출

import pool from './db.js';

const SCOPE_QUERIES = {
  employees: `
    SELECT id, name, position, birth_date, final_edu, school, major,
           grad_year, grad_month, external_join_date, real_join_date
    FROM bid_employees WHERE active = 1 ORDER BY id`,
  educations: `
    SELECT employee_id, degree, school, major, graduated_at, thesis
    FROM bid_employee_educations ORDER BY employee_id, sort_order, id`,
  careers: `
    SELECT employee_id, org_name, start_date, end_date, position, duty
    FROM bid_employee_careers ORDER BY employee_id, sort_order, id`,
  certifications: `
    SELECT employee_id, name, acquired_at, issuer, cert_number
    FROM bid_employee_certifications ORDER BY employee_id, sort_order, id`,
  projects: `
    SELECT id, name, agency, start_date, end_date, contract_amount, description
    FROM bid_projects ORDER BY COALESCE(start_date, '0000-00-00') DESC, id DESC`,
  employee_projects: `
    SELECT employee_id, project_id, role, company_at_time, participation_rate
    FROM bid_employee_projects`,
};

async function buildDbContext(scopes) {
  const ctx = {};
  for (const key of scopes || []) {
    const sql = SCOPE_QUERIES[key];
    if (!sql) continue;
    const [rows] = await pool.query(sql);
    ctx[key] = rows;
  }
  return ctx;
}

const SYSTEM = (
  '당신은 입찰 제안서/사업 문서를 작성하는 전문가입니다. ' +
  '사용자가 제공한 "기준 페이지(템플릿)"의 형식·구성·표현 톤·구조를 그대로 유지하면서, ' +
  '사용자의 지시사항을 따르고, 제공된 DB 데이터를 사실관계로 활용합니다. ' +
  '추측 금지 — DB나 지시사항에 명시되지 않은 값은 비워두거나 그 사실을 명시합니다.'
);

export async function generateFromTemplate({ template, instruction, scopes }) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  if (!key) throw new Error('OPENAI_API_KEY 미설정');
  if (!template || !template.trim()) throw new Error('기준 페이지(템플릿) 비어 있음');
  if (!instruction || !instruction.trim()) throw new Error('지시사항 비어 있음');

  const dbCtx = await buildDbContext(scopes || []);
  const dbJson = JSON.stringify(dbCtx, null, 2);

  const userMsg = `[기준 페이지 (템플릿)]
${template.slice(0, 12000)}

[DB 데이터]
\`\`\`json
${dbJson.slice(0, 30000)}
\`\`\`

[지시사항]
${instruction}

위 [기준 페이지]의 형식·구성·말투·표 구조를 충실히 유지하면서, [지시사항]대로 새 내용을 작성하세요.
DB 데이터를 적절히 활용하되, 없는 정보는 추측하지 마세요.
출력은 결과 본문만 — 설명·코드블록·머리말 금지.`;

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: key });
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
  });
  return resp.choices?.[0]?.message?.content || '';
}
