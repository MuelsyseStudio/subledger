import { GoogleGenAI } from '@google/genai';

const BASE_SCHEMA_PROMPT = `你是一位兼具幽默感、网感与敏锐洞察力的「数字订阅账单鉴赏家」。请根据用户当前的真实软件与会员订阅清单、月度总开销和分类结构，为用户生成一份专属的「订阅者人格画像与账单点评」。

请严格只输出合法的 JSON 对象（不要输出 Markdown 代码块标记或额外说明），JSON 结构如下：
{
  "badgeEmoji": "1个最契合用户气质的 Emoji，如 🚀、🧠、🎮、⚡、👑",
  "personaTitle": "极具记忆点的专属称号（8~15字，例如：硅基算力赞助商 · 罗德岛驻场博士）",
  "mbtiStyleTag": "一句话订阅性格定位（8~16字，例如：顶配尝鲜派 · 跨区省钱鬼才）",
  "tags": ["个性化标签1(4-7字)", "标签2", "标签3", "标签4"],
  "summary": "90~140字的核心人物画像评语。必须紧密结合用户实际订阅的具体软件/游戏名称、区服操作（如菲律宾区、首月特惠、两年长周期等）和生活习惯展开，有画面感、有细节，拒绝空话套话。",
  "dimensions": [
    { "name": "维度1名称(4-5字，如前沿探索力/生产力指数)", "score": 0到100的整数, "comment": "15字以内的简短佐证" },
    { "name": "维度2名称(如省钱精明度/薅羊毛段位)", "score": 0到100的整数, "comment": "15字以内的简短佐证" },
    { "name": "维度3名称(如精神愉悦度/生活平衡感)", "score": 0到100的整数, "comment": "15字以内的简短佐证" }
  ],
  "highlight": "35~60字，点出账单里最聪明、最有反差感或最有趣的一个细节操作。",
  "savingTip": "35~65字，给出1条真正接地气、针对这份具体账单的回血或防反薅建议（如功能重叠评估、优惠恢复原价提醒等）。"
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

  const { items, summaryStats, mode = 'insight' } = body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: '请先添加至少 1 项订阅后再生成 AI 点评' }, { status: 400 });
  }

  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GEMINI_BASE_URL) {
    return Response.json(
      { error: '未配置 AI 点评密钥。本地运行请在终端执行：subledger config --gemini-key <你的_GEMINI_API_KEY>' },
      { status: 503 }
    );
  }

  const tonePrompt = mode === 'roast'
    ? `【点评风格：🔥 毒舌锐评 / 幽默吐槽模式】
请用脱口秀般风趣犀利、有网感、懂科技又懂二次元/数字生活老玩家的口吻来吐槽这份账单（比如调侃算力过剩、一边省钱跨区一边豪掷千金、精神食粮与赛博打工的反差萌等），好玩扎心但保持友善讨喜！`
    : `【点评风格：✨ 深度画像 / 温暖洞察模式】
请用懂行、敏锐又温暖的数字生活买手与私人财务顾问口吻，精准勾勒出这位订阅者的工作生活状态、审美偏好与消费智慧，既提供情绪价值又给出专业干货建议。`;

  const userPayloadText = `用户当前订阅汇总：
- 生效周期订阅数：${summaryStats?.activeCount ?? items.length} 项
- 折合月均总开销：¥${summaryStats?.monthlyTotal ?? '0'} / 月（年化约 ¥${summaryStats?.yearlyTotal ?? '0'} / 年）
- 订阅明细列表：
${items.map((it, i) => `${i + 1}. 【${it.name}】分类:${it.category} | 账单:${it.spec} | 折合月均:¥${it.monthlyCny} | 标签:${it.region || '常规'} | 备注:${it.note || '无'}`).join('\n')}`;

  const ai = new GoogleGenAI(
    process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY } : {}
  );
  const modelsToTry = ['gemini-3.8-flash', 'gemini-flash-latest'];
  let lastErr = null;

  for (const modelName of modelsToTry) {
    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents: `${BASE_SCHEMA_PROMPT}\n\n${tonePrompt}\n\n${userPayloadText}`,
        config: {
          responseMimeType: 'application/json',
          temperature: mode === 'roast' ? 0.85 : 0.7
        }
      });

      const rawText = (result.text || '').trim();
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = JSON.parse(cleaned);
      return Response.json({
        ok: true,
        mode,
        generatedAt: new Date().toISOString(),
        review: parsed
      });
    } catch (err) {
      lastErr = err;
    }
  }

  return Response.json(
    { error: `AI 点评生成失败：${lastErr?.message || String(lastErr)}` },
    { status: 500 }
  );
};

export const config = {
  path: '/api/ai-review',
  method: 'POST',
  rateLimit: {
    windowLimit: 15,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
