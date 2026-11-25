import { GoogleGenAI } from '@google/genai';

const SYSTEM_INSTRUCTION = `你是一个专业的软件与会员订阅账单截图识别助手。请从用户上传的订阅页面、会员中心、支付账单或 App Store 截图中提取结构化订阅信息，并严格只输出 JSON 对象（不要输出任何额外解释）。

JSON 字段规范如下：
{
  "name": "软件或会员服务名称，例如 ChatGPT Pro、谷歌 Ultra、哔哩哔哩大会员、QQ音乐豪华绿钻、Keep 会员、腾讯会议、百度网盘 SVIP",
  "category": "只能从以下枚举中选一个: ai | game | dev | productivity | cloud | media | design | lifestyle | other",
  "price": 数字类型（当前实付或页面标示的套餐价格；若截图中完全未出现价格数字，填 null）,
  "regularPrice": 数字类型或 null（仅当截图明确体现了首期特惠价且后续恢复更高原价时填入原价数字，否则填 null）,
  "currency": "只能从以下币种代码中选一个: CNY | USD | PHP | HKD | JPY | EUR | GBP | TWD | SGD | TRY | INR（注意 ₱ 为 PHP，¥/元通常为 CNY，US$/$ 通常为 USD，HK$ 为 HKD，₺ 为 TRY，₹ 为 INR）",
  "cycle": "只能从以下周期枚举中选一个: monthly | yearly | biennial | quarterly | semiannual | weekly | lifetime（例如 /月 为 monthly，360天/年度/年卡/包年 为 yearly，720天/两年 为 biennial，90天/季卡 为 quarterly，买断 为 lifetime）",
  "status": "只能从以下状态枚举中选一个: active | trial | paused（含免费试用字样选 trial，已退订/已过期选 paused，其余选 active）",
  "autoRenew": 布尔值 true 或 false（若明确写了已关闭自动续费或仅单次卡到期停用则为 false，否则为 true）,
  "nextBillDate": "YYYY-MM-DD 格式字符串或空字符串（提取下次扣款日、有效期至、到期时间，例如 27年12月22日 -> 2027-12-22）",
  "startDate": "YYYY-MM-DD 格式字符串或空字符串（仅当图中明确出现开通日/购买日/扣款日时提取）",
  "payment": "支付渠道字符串（如 支付宝自动扣款、微信免密支付、Apple App Store、Google Play、Visa / MasterCard，未体现则填空字符串）",
  "account": "区服或账号标识（例如看到 ₱ 菲律宾比索可填 菲律宾区，看到账号名/手机号脱敏号可简写，否则填空字符串）",
  "note": "简短备注（如套餐档位 Pro 200、含增值税、联合会员等信息，控制在 25 字以内）"
}`;

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: '请求格式无效' }, { status: 400 });
  }

  const { imageBase64, mimeType, today } = body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return Response.json({ error: '未收到有效的截图数据' }, { status: 400 });
  }

  // 限制单张 base64 体积（约 4MB 以内）
  if (imageBase64.length > 5_500_000) {
    return Response.json({ error: '图片体积过大，请压缩后重试' }, { status: 413 });
  }

  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GEMINI_BASE_URL) {
    return Response.json(
      { error: '未配置 AI 识图密钥。本地运行请在终端执行：subledger config --gemini-key <你的_GEMINI_API_KEY>' },
      { status: 503 }
    );
  }

  const ai = new GoogleGenAI(
    process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY } : {}
  );
  const userPrompt = `当前参考日期为 ${today || '2026-11-16'}（如果截图中的年份写成两位数如“27年12月22日”，对应 2027-12-22；若只有月日如“12月12日续费”，结合当前日期推断合理的年份）。请识别这张订阅截图并返回 JSON。`;

  const modelsToTry = ['gemini-flash-latest', 'gemini-3.8-flash'];
  let lastErr = null;

  for (const modelName of modelsToTry) {
    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: imageBase64
                }
              },
              { text: `${SYSTEM_INSTRUCTION}\n\n${userPrompt}` }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      });

      const rawText = (result.text || '').trim();
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = JSON.parse(cleaned);
      return Response.json({ ok: true, data: parsed, model: modelName });
    } catch (err) {
      lastErr = err;
    }
  }

  return Response.json(
    { error: `识图解析失败：${lastErr?.message || String(lastErr)}` },
    { status: 500 }
  );
};

export const config = {
  path: '/api/parse-screenshot',
  method: 'POST',
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
