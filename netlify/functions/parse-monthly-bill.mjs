import { GoogleGenAI } from '@google/genai';

const SYSTEM_PROMPT = `你是一个专业的个人月度账单（微信支付月账单、支付宝月账单、信用卡账单或日常消费小票）视觉解析助手。
请从用户上传的截图中提取消费总额与分类构成，并严格只返回合法的 JSON 对象（不要包含 Markdown 代码块符号）。

JSON 字段规范：
{
  "source": "只能选一个: alipay | wechat | card | other（看到蓝色支付宝/花呗界面选 alipay，绿色微信支付选 wechat，银行/信用卡选 card，其余选 other）",
  "sourceLabel": "账单来源名称，例如 支付宝账单、微信支付账单、信用卡账单 或 具体商户消费",
  "month": "YYYY-MM 格式字符串（若图中写 11月，结合参考月份输出如 2026-11；若未体现则使用参考月份）",
  "totalAmount": 数字（总支出金额，单位人民币元；若图中只有若干分类金额，请相加得出总额）,
  "categories": [
    {
      "type": "只能选一个: dining | shopping | transport | living | entertainment | medical | other",
      "name": "原图分类名或归纳名，如 餐饮美食、服饰美容/网购、交通出行、生活日用、文娱充值、医疗健康、其他消费",
      "amount": 数字（该分类金额，保留两位小数以内）
    }
  ],
  "detectedMerchants": ["如果截图中明确出现了软件会员或游戏充值商户名（如 Apple/苹果、鹰角网络、腾讯充值、哔哩哔哩、百度网盘），提取出关键词数组，否则返回 []"],
  "note": "25字以内的账单摘要（如 支付宝11月消费统计）"
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

  const { imageBase64, mimeType, targetMonth } = body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return Response.json({ error: '未收到有效的账单截图' }, { status: 400 });
  }

  if (imageBase64.length > 5_500_000) {
    return Response.json({ error: '图片体积过大，请重试' }, { status: 413 });
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
  const userText = `当前选中的账本月份为 ${targetMonth || '2026-11'}。请提取这张日常/月度账单截图中的支出总额与各分类明细。注意只提取“支出”部分，忽略“收入”或“不计入收支/理财转入”。`;

  const modelsToTry = ['gemini-3.8-flash', 'gemini-flash-latest'];
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
              { text: `${SYSTEM_PROMPT}\n\n${userText}` }
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
    { error: `月账单识别失败：${lastErr?.message || String(lastErr)}` },
    { status: 500 }
  );
};

export const config = {
  path: '/api/parse-monthly-bill',
  method: 'POST',
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
