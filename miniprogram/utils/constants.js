module.exports = {
  PLAN_STATUS: {
    DRAFT: 'draft',
    PENDING_CONFIRM: 'pending_confirm',
    ACTIVE: 'active',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    ARCHIVED: 'archived'
  },
  PLAN_STATUS_LABEL: {
    draft: '待上传资料',
    pending_confirm: '待确认',
    active: '进行中',
    paused: '已暂停',
    completed: '已完成',
    archived: '已归档'
  },
  SCENES: [
    {
      id: 'job',
      title: '求职面试',
      desc: '针对岗位模拟沟通和计划',
      icon: 'search',
      tone: 'teal',
      prompt: '我想准备找工作面试，请根据我的情况帮我制定学习计划。'
    },
    {
      id: 'exam',
      title: '考试备考',
      desc: '按考试时间制定复习节奏',
      icon: 'grid',
      tone: 'gold',
      prompt: '我想备考一门证书考试，请帮我制定学习与复习计划。'
    },
    {
      id: 'skill',
      title: '技能提升',
      desc: '拆解学习路径与练习计划',
      icon: 'star',
      tone: 'slate',
      prompt: '我想系统提升一项专业技能，请帮我制定学习计划。'
    },
    {
      id: 'interest',
      title: '兴趣学习',
      desc: '轻松规划兴趣主题学习',
      icon: 'heart',
      tone: 'rose',
      prompt: '我想学习一个兴趣主题，请帮我制定轻松可执行的学习计划。'
    },
    {
      id: 'language',
      title: '语言学习',
      desc: '词汇语法与听说练习节奏',
      icon: 'lang',
      tone: 'sage',
      prompt: '我想系统学习一门语言，请根据我的基础帮我制定词汇、语法与复习计划。'
    },
    {
      id: 'reading',
      title: '阅读积累',
      desc: '拆书笔记与定期复盘',
      icon: 'book',
      tone: 'clay',
      prompt: '我想通过阅读积累知识，请帮我制定拆书、笔记与复习计划。'
    }
  ],
  EBBINGHAUS_HINT: [1, 2, 4, 7, 15, 30],

  /** 与云函数 DEFAULTS 对齐，仅用于前端文案展示 */
  SHARE_REWARD_QUOTA: 3,
  MAX_SHARE_CLAIMS_PER_DAY: 3,

  /** 微信公众平台 → 流量主 → 激励式视频广告位 ID，填后才可看广告领次数 */
  AD_UNIT_ID: '',

  /**
   * 订阅消息模板 ID（可多个）。
   * 申请路径：公众平台 → 功能 → 订阅消息 → 公共模板库
   * 建议选用含「温馨提示 / 复习内容 / 时间」类字段的学习提醒模板，并与 sendRemind 云函数字段对齐。
   */
  SUBSCRIBE_TMPL_IDS: [],

  /** AI 生成内容显式标识（合规展示） */
  AI_DISCLAIMER: '本内容由 AI 生成，仅供学习参考。'
};
