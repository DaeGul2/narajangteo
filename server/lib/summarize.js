// OpenAI GPT 호출로 입찰공고 핵심 정보 추출 (마크다운)

const SYSTEM = (
  '당신은 한국 정부·공공기관의 채용대행 용역 입찰공고를 분석해 ' +
  '핵심 정보를 정확히 추출하는 전문가입니다. ' +
  '추측 금지 — 본문에 명시되거나 명확히 유도되는 정보만 적습니다.'
);

function buildPrompt(text, bidNo, bidName) {
  const main = (bidNo || '').split('-')[0] || '';
  const ord = bidNo && bidNo.includes('-') ? bidNo.split('-')[1] : '000';
  const truncated = (text || '').slice(0, 18000);
  return `다음은 g2b 나라장터 채용대행 용역 입찰공고 문서에서 추출한 텍스트입니다.
공고번호: ${bidNo}
공고명: ${bidName}

여기서 아래 항목을 추출하여 **정확히 아래 마크다운 형식 그대로만** 출력하세요.

[규칙]
1. 본문에 명시되지 않은 항목은 \`미상\` 으로 표기
2. **간접 참조 처리**: "제안서 제출기간은 입찰서 접수기간과 동일", "위와 같음", "별도 통보" 같은 식으로
   적힌 경우, 본문에서 해당 기간을 찾아 그대로 적용. (예: 입찰서 일정만 명시되어 있고
   제안서가 "입찰서와 동일"이면 두 항목 모두 같은 날짜 시각을 적기.)
3. **금액**: 부가세 포함/미포함 명시. 추정가격·배정예산·사업금액 중 본문 표현 그대로
4. **채용규모**: 기간(예: 착수일로부터 N일) / 인원(직군별 분류 있으면 함께)
5. **담당자**: 부서명(전화번호) 형식. 여러 명이면 첫 1~2명만
6. **평가정보**: 평가일자, 발표시간, 질의응답시간 등 본문에 있는 만큼만
7. 출력에 \`\`\`마크다운\`\`\` 같은 코드블록 표시 금지 — 텍스트만

[출력 형식]

${main} - ${ord}
- 업체명: <발주기관명>
- 공고명: <공고명>
- 채용규모: <기간 / 인원>
- 담당자: <부서명(전화번호)>
- 제출기간
  ㅇ 입찰서 - <날짜시각 (제출방법)>
  ㅇ 제안서 - <날짜시각 (제출방법)>
- 가격: <금액>
- 평가정보: <평가일자, 발표/질의응답 시간>

[입찰공고 본문]
${truncated}
`;
}

export async function summarize(text, bidNo, bidName) {
  const header = bidName ? `${bidNo} (${bidName})` : bidNo;
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  if (!key) {
    return `# ${header}\n\n⚠️ OPENAI_API_KEY 미설정 — \`server/.env\` 에 키 추가 필요.\n\`.env.example\` 참고.`;
  }
  if (!text || !text.trim()) {
    return `# ${header}\n\n⚠️ 추출된 본문 텍스트가 없어 요약 불가.`;
  }
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: key });
    const resp = await client.chat.completions.create({
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildPrompt(text, bidNo, bidName) },
      ],
    });
    return resp.choices?.[0]?.message?.content || '';
  } catch (e) {
    return `# ${header}\n\n⚠️ GPT 호출 실패: ${e.name || 'Error'}: ${e.message}`;
  }
}
