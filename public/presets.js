// SubLedger · 软件订阅管家 - 预设模板与基础配置

window.SUBLEDGER_CONFIG = {
  CATEGORIES: [
    { id: 'ai', name: 'AI 与大模型', color: '#059669', bg: 'rgba(5, 150, 105, 0.11)' },
    { id: 'game', name: '游戏与月卡', color: '#7C3AED', bg: 'rgba(124, 58, 237, 0.11)' },
    { id: 'dev', name: '开发与技术', color: '#2563EB', bg: 'rgba(37, 99, 235, 0.11)' },
    { id: 'productivity', name: '效率与办公', color: '#4F46E5', bg: 'rgba(79, 70, 229, 0.11)' },
    { id: 'cloud', name: '网络与云存储', color: '#0284C7', bg: 'rgba(2, 132, 199, 0.11)' },
    { id: 'media', name: '影音与娱乐', color: '#E11D48', bg: 'rgba(225, 29, 72, 0.11)' },
    { id: 'design', name: '设计与创意', color: '#DB2777', bg: 'rgba(219, 39, 119, 0.11)' },
    { id: 'lifestyle', name: '运动与生活', color: '#D97706', bg: 'rgba(217, 119, 6, 0.11)' },
    { id: 'other', name: '其他服务', color: '#64748B', bg: 'rgba(100, 116, 139, 0.11)' }
  ],

  // 默认基准汇率（启动后会自动从实时汇率接口拉取最新市场中间价并定期更新）
  DEFAULT_RATES: {
    CNY: { code: 'CNY', symbol: '¥', name: '人民币', rate: 1.00 },
    USD: { code: 'USD', symbol: '$', name: '美元', rate: 6.6792 },
    PHP: { code: 'PHP', symbol: '₱', name: '菲律宾比索', rate: 0.1046 },
    HKD: { code: 'HKD', symbol: 'HK$', name: '港币', rate: 0.8513 },
    JPY: { code: 'JPY', symbol: 'JP¥', name: '日元', rate: 0.0418 },
    EUR: { code: 'EUR', symbol: '€', name: '欧元', rate: 7.3469 },
    GBP: { code: 'GBP', symbol: '£', name: '英镑', rate: 8.8054 },
    TWD: { code: 'TWD', symbol: 'NT$', name: '新台币', rate: 0.2028 },
    SGD: { code: 'SGD', symbol: 'S$', name: '新加坡元', rate: 5.1842 },
    TRY: { code: 'TRY', symbol: '₺', name: '土耳其里拉', rate: 0.1330 },
    INR: { code: 'INR', symbol: '₹', name: '印度卢比', rate: 0.0708 }
  },

  CYCLES: [
    { id: 'monthly', label: '按月订阅', short: '月' },
    { id: 'yearly', label: '按年订阅', short: '年' },
    { id: 'biennial', label: '按两年 (720天)', short: '2年' },
    { id: 'quarterly', label: '按季订阅', short: '季' },
    { id: 'semiannual', label: '按半年订阅', short: '半年' },
    { id: 'weekly', label: '按周订阅', short: '周' },
    { id: 'oneoff', label: '单次消费 (均摊到月)', short: '单次' },
    { id: 'lifetime', label: '永久买断授权', short: '买断' }
  ],

  DAILY_CATEGORIES: [
    { id: 'dining', name: '餐饮美食', color: '#F59E0B' },
    { id: 'shopping', name: '购物消费', color: '#EC4899' },
    { id: 'transport', name: '交通出行', color: '#0EA5E9' },
    { id: 'living', name: '居家生活缴费', color: '#10B981' },
    { id: 'entertainment', name: '线下文娱休闲', color: '#8B5CF6' },
    { id: 'medical', name: '医疗与人情', color: '#EF4444' },
    { id: 'other', name: '其他日常开销', color: '#64748B' }
  ],

  PAYMENT_METHODS: [
    '支付宝自动扣款',
    '微信免密支付',
    '银联 UnionPay',
    'Apple App Store',
    'Google Play',
    'Visa / MasterCard',
    'PayPal',
    'Stripe 信用卡',
    '虚拟信用卡'
  ],

  PRESETS: [
    { name: 'ChatGPT Pro', brandKey: 'chatgpt', icon: 'GPT', color: '#10A37F', category: 'ai', price: 200, currency: 'USD', cycle: 'monthly', payment: 'Visa / MasterCard', url: 'https://chatgpt.com' },
    { name: '谷歌 Ultra', brandKey: 'google', icon: 'G', color: '#4285F4', category: 'ai', price: 200, currency: 'USD', cycle: 'monthly', payment: 'Google Play', url: 'https://one.google.com' },
    { name: 'Grok Premium', brandKey: 'grok', icon: 'GK', color: '#09090B', category: 'ai', price: 30, currency: 'USD', cycle: 'monthly', payment: 'Stripe 信用卡', url: 'https://grok.com' },
    { name: 'VeeeVPN VIP', brandKey: 'veee', icon: 'VE', color: '#2282F6', category: 'cloud', price: 73.99, currency: 'USD', cycle: 'biennial', payment: '银联 UnionPay', url: '' },
    { name: '明日方舟 (大小月卡)', brandKey: 'arknights', icon: '方舟', color: '#18181B', category: 'game', price: 198, currency: 'CNY', cycle: 'monthly', payment: '支付宝自动扣款', url: 'https://ak.hypergryph.com' },
    { name: '明日方舟：终末地 (大小月卡)', brandKey: 'endfield', icon: '终末地', color: '#18181B', category: 'game', price: 98, currency: 'CNY', cycle: 'monthly', payment: '支付宝自动扣款', url: 'https://endfield.hypergryph.com' },
    { name: '哔哩哔哩大会员', brandKey: 'bilibili', icon: 'B站', color: '#FB7299', category: 'media', price: 148, currency: 'CNY', cycle: 'yearly', payment: '支付宝自动扣款', url: 'https://big.bilibili.com' },
    { name: 'QQ音乐豪华绿钻', brandKey: 'qqmusic', icon: 'QQ音', color: '#12B770', category: 'media', price: 168, currency: 'CNY', cycle: 'yearly', payment: '微信免密支付', url: 'https://y.qq.com' },
    { name: 'Keep 会员', brandKey: 'keep', icon: 'KP', color: '#2B2438', category: 'lifestyle', price: 198, currency: 'CNY', cycle: 'yearly', payment: '微信免密支付', url: 'https://www.gotokeep.com' },
    { name: '腾讯会议专业版', brandKey: 'tencentmeeting', icon: '会议', color: '#0052D9', category: 'productivity', price: 288, currency: 'CNY', cycle: 'yearly', payment: '微信免密支付', url: 'https://meeting.tencent.com' },
    { name: '百度网盘 SVIP', brandKey: 'baidu', icon: '网盘', color: '#06A7FF', category: 'cloud', price: 198, currency: 'CNY', cycle: 'yearly', payment: '支付宝自动扣款', url: 'https://pan.baidu.com' },
    { name: 'Claude Pro', brandKey: 'claude', icon: 'CL', color: '#D97757', category: 'ai', price: 20, currency: 'USD', cycle: 'monthly', payment: 'Stripe 信用卡', url: 'https://claude.ai' },
    { name: 'Cursor Pro', brandKey: 'cursor', icon: 'CU', color: '#141414', category: 'dev', price: 20, currency: 'USD', cycle: 'monthly', payment: 'Stripe 信用卡', url: 'https://cursor.com' },
    { name: '网易云音乐黑胶VIP', brandKey: 'netease', icon: '云音', color: '#E60026', category: 'media', price: 158, currency: 'CNY', cycle: 'yearly', payment: '支付宝自动扣款', url: 'https://music.163.com' },
    { name: '阿里云盘 SVIP', brandKey: 'alipan', icon: '阿里', color: '#5C6CFF', category: 'cloud', price: 168, currency: 'CNY', cycle: 'yearly', payment: '支付宝自动扣款', url: 'https://www.alipan.com' },
    { name: 'WPS 超级会员', brandKey: 'wps', icon: 'WPS', color: '#E1251B', category: 'productivity', price: 148, currency: 'CNY', cycle: 'yearly', payment: '微信免密支付', url: 'https://vip.wps.cn' },
    { name: 'iCloud+ 200GB', brandKey: 'icloud', icon: 'iC', color: '#007AFF', category: 'cloud', price: 21, currency: 'CNY', cycle: 'monthly', payment: 'Apple App Store', url: 'https://www.icloud.com' },
    { name: 'GitHub Copilot', brandKey: 'copilot', icon: 'GH', color: '#161B22', category: 'dev', price: 100, currency: 'USD', cycle: 'yearly', payment: 'PayPal', url: 'https://github.com/settings/billing' },
    { name: 'Spotify Premium', brandKey: 'spotify', icon: 'SP', color: '#1DB954', category: 'media', price: 68, currency: 'HKD', cycle: 'monthly', payment: 'PayPal', url: 'https://www.spotify.com/account' },
    { name: 'YouTube Premium', brandKey: 'youtube', icon: 'YT', color: '#FF0000', category: 'media', price: 78, currency: 'HKD', cycle: 'monthly', payment: 'Visa / MasterCard', url: 'https://www.youtube.com/paid_memberships' }
  ],

  createDemoSubscriptions: function () {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    function offsetDays(days) {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    function offsetMonths(months, dayOverride) {
      const targetMonth = today.getMonth() + months;
      const temp = new Date(today.getFullYear(), targetMonth, 1);
      const maxDay = new Date(temp.getFullYear(), temp.getMonth() + 1, 0).getDate();
      const d = Math.min(dayOverride || today.getDate(), maxDay);
      const y = temp.getFullYear();
      const m = String(temp.getMonth() + 1).padStart(2, '0');
      return `${y}-${m}-${String(d).padStart(2, '0')}`;
    }

    return [
      {
        id: 'demo-1',
        name: 'ChatGPT Plus',
        brandKey: 'chatgpt',
        icon: 'GPT',
        color: '#10A37F',
        category: 'ai',
        price: 20,
        regularPrice: null,
        currency: 'USD',
        cycle: 'monthly',
        splitCount: 1,
        status: 'active',
        autoRenew: true,
        nextBillDate: offsetDays(5),
        startDate: offsetMonths(-8),
        payment: 'Visa / MasterCard',
        account: '美区账号',
        url: 'https://chatgpt.com',
        note: '主力 AI 助手，日常编码与写作高频使用'
      },
      {
        id: 'demo-2',
        name: 'Cursor Pro',
        brandKey: 'cursor',
        icon: 'CU',
        color: '#141414',
        category: 'dev',
        price: 20,
        regularPrice: null,
        currency: 'USD',
        cycle: 'monthly',
        splitCount: 1,
        status: 'trial',
        autoRenew: true,
        nextBillDate: offsetDays(2),
        startDate: offsetDays(-12),
        payment: 'Stripe 信用卡',
        account: 'GitHub 登录',
        url: 'https://cursor.com',
        note: '14 天免费试用中，到期前评估是否保留'
      },
      {
        id: 'demo-3',
        name: '哔哩哔哩大会员',
        brandKey: 'bilibili',
        icon: 'B站',
        color: '#FB7299',
        category: 'media',
        price: 108,
        regularPrice: null,
        currency: 'CNY',
        cycle: 'yearly',
        splitCount: 1,
        status: 'active',
        autoRenew: false,
        nextBillDate: offsetDays(23),
        startDate: offsetMonths(-11),
        payment: '支付宝自动扣款',
        account: '大促活动价',
        url: 'https://big.bilibili.com',
        note: '已关闭自动续费防原价扣款'
      }
    ];
  }
};
