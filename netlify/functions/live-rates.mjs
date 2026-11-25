const TARGET_CURRENCIES = ['USD', 'PHP', 'HKD', 'JPY', 'EUR', 'GBP', 'TWD', 'SGD', 'TRY', 'INR'];

export default async (req) => {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const endpoints = [
    'https://open.er-api.com/v6/latest/CNY',
    'https://api.exchangerate-api.com/v4/latest/CNY'
  ];

  let lastErr = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rawRates = data.rates || {};
      const computed = { CNY: 1 };

      for (const code of TARGET_CURRENCIES) {
        const perCny = Number(rawRates[code]);
        if (perCny > 0) {
          // 1 外币 = ? CNY
          computed[code] = Number((1 / perCny).toFixed(4));
        }
      }

      return Response.json(
        {
          ok: true,
          base: 'CNY',
          updatedAtUtc: data.time_last_update_utc || data.date || new Date().toUTCString(),
          fetchedAt: new Date().toISOString(),
          rates: computed
        },
        {
          headers: {
            'Netlify-CDN-Cache-Control': 'public, durable, max-age=7200, stale-while-revalidate=86400',
            'Cache-Control': 'public, max-age=600'
          }
        }
      );
    } catch (err) {
      lastErr = err;
    }
  }

  return Response.json(
    { ok: false, error: `实时汇率拉取失败：${lastErr?.message || String(lastErr)}` },
    { status: 502 }
  );
};

export const config = {
  path: '/api/rates',
  method: 'GET'
};
