// nodemailer SMTP (메일플러그) — isbr-card-system 패턴 차용
// 수신자는 배열로 받음 (DB recipients 테이블에서 가져옴)

import 'dotenv/config';
import nodemailer from 'nodemailer';

let _tr = null;
function transporter() {
  if (_tr) return _tr;
  _tr = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.mailplug.co.kr',
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  return _tr;
}

/**
 * @param {Object} opts
 * @param {string} opts.subject
 * @param {string} [opts.html] - 없으면 text 로부터 자동 변환
 * @param {string} [opts.text] - HTML 미설정 시 사용
 * @param {Array<{filename: string, content: Buffer|string}>} [opts.attachments]
 * @param {Array<string|{email: string, name?: string}>} opts.to - 수신자 배열 (필수)
 */
export async function sendReport({ subject, html, text, attachments, to }) {
  if (!process.env.EMAIL_USER) throw new Error('EMAIL_USER 환경변수 누락');
  if (!to || !to.length) throw new Error('수신자(to) 없음');

  // to 정규화
  const recipients = to.map(r => {
    if (typeof r === 'string') return r;
    if (r.name) return `"${r.name}" <${r.email}>`;
    return r.email;
  }).join(', ');

  console.log('to : ', recipients);

  // html 없으면 text 를 isbr-card-system 패턴으로 wrap
  const htmlFinal = html || `
    <div style="font-family: Pretendard, sans-serif; font-size: 14px; white-space: pre-line; line-height: 1.6;">
      ${(text || subject).replace(/\n/g, '<br/>')}
    </div>
  `;

  try {
    const info = await transporter().sendMail({
      from: `"g2b 채용 크롤러" <${process.env.EMAIL_USER}>`,
      to: recipients,
      subject,
      text: text || subject,  // 백업용
      html: htmlFinal,
      attachments,
    });
    return info;
  } catch (err) {
    console.error('❌ Email send error:', err);
    throw err;
  }
}
