const MAILER_URL = process.env.MAILER_URL || "http://172.17.0.1:8097";
const MAILER_API_KEY = process.env.MAILER_API_KEY || "";

export async function sendRaw({ to, subject, html, text }) {
  if (!MAILER_API_KEY) {
    console.warn("[mailer] MAILER_API_KEY not set; pretending email sent to", to);
    console.warn("[mailer] subject:", subject);
    console.warn("[mailer] body:\n", html);
    return { ok: true, dev: true };
  }
  const res = await fetch(`${MAILER_URL}/send-raw`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": MAILER_API_KEY,
    },
    body: JSON.stringify({ to, subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`mailer ${res.status}: ${body.slice(0, 200)}`);
  }
  return await res.json().catch(() => ({ ok: true }));
}

export async function sendActivation({ to, link }) {
  const subject = "激活你的 Wallshoot 账号";
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color:#d33;">Wallshoot — 激活账号</h2>
      <p>嗨，</p>
      <p>有人用这个邮箱注册了 Wallshoot（家用隔墙射击对战游戏）。点击下方链接激活账号，链接 24 小时内有效：</p>
      <p style="margin: 24px 0;">
        <a href="${link}" style="background:#d33;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          激活账号
        </a>
      </p>
      <p style="color:#888;font-size:13px;">如果不是你操作，忽略此邮件即可。链接：<br>${link}</p>
    </div>
  `;
  const text = `激活你的 Wallshoot 账号：${link}\n（24 小时内有效。非本人操作请忽略。）`;
  return sendRaw({ to, subject, html, text });
}
