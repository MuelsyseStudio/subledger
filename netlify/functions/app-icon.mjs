export default async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) {
    return Response.json({ error: '缺少搜索词 q' }, { status: 400 });
  }

  for (const country of ['cn', 'us']) {
    try {
      const api = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=${country}&entity=software&limit=3`;
      const res = await fetch(api);
      if (!res.ok) continue;
      const data = await res.json();
      const first = data.results?.[0];
      if (first?.artworkUrl100) {
        const imgRes = await fetch(first.artworkUrl100);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const ct = imgRes.headers.get('content-type') || 'image/jpeg';
          return Response.json(
            {
              ok: true,
              trackName: first.trackName,
              dataUri: `data:${ct};base64,${buf.toString('base64')}`
            },
            {
              headers: {
                'Netlify-CDN-Cache-Control': 'public, durable, max-age=86400, stale-while-revalidate=604800'
              }
            }
          );
        }
      }
    } catch {
      // Try next region
    }
  }

  return Response.json({ ok: false, error: '未在应用商店找到对应软件图标' }, { status: 404 });
};

export const config = {
  path: '/api/app-icon',
  method: 'GET',
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
