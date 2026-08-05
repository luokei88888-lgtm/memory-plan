const { inferWeekCount, clampWeekCount } = require('./planDuration');
const { DEFAULTS } = require('./constants');

const WEEK_THEMES = [
  { theme: '打基础', topics: ['核心概念入门', '关键术语梳理', '基础练习'] },
  { theme: '深化理解', topics: ['常见场景应用', '易错点辨析', '小项目/作业'] },
  { theme: '综合巩固', topics: ['综合题练习', '薄弱点回看', '模拟测评'] },
  { theme: '查漏补缺', topics: ['错题复盘', '高频考点速记', '考前总复习'] },
  { theme: '进阶拓展', topics: ['进阶专题', '实战案例', '错题二次复盘'] },
  { theme: '实战冲刺', topics: ['模拟测评', '薄弱点攻坚', '节奏调整'] }
];

/** 无 AI_API_KEY 或 AI 异常时的兜底演示计划（周数跟随用户表述） */
function buildMockPlan(userMessage) {
  const goal = userMessage || '通用学习提升';
  const minW = DEFAULTS.MIN_PLAN_WEEKS || 1;
  const maxW = DEFAULTS.MAX_PLAN_WEEKS || 24;
  const weekCount = clampWeekCount(inferWeekCount(goal, 4), minW, maxW);

  const weeks = [];
  for (let i = 0; i < weekCount; i += 1) {
    const tpl = WEEK_THEMES[Math.min(i, WEEK_THEMES.length - 1)];
    weeks.push({
      week: i + 1,
      theme: weekCount <= WEEK_THEMES.length ? tpl.theme : `第${i + 1}周学习`,
      topics: tpl.topics.slice()
    });
  }

  return {
    title: '定制学习计划',
    goal,
    scene: 'skill',
    weeks,
    cards: [
      {
        topic: '核心概念',
        question: '用自己的话解释本主题最核心的 3 个概念是什么？',
        answer: '先写出定义，再各举一个生活/工作中的例子，最后说明三者关系。'
      },
      {
        topic: '学习方法',
        question: '面对新知识点，推荐的「输入-输出」步骤是什么？',
        answer: '先快速浏览结构 → 精读难点 → 用费曼技巧讲给别人听 → 做题检验 → 按遗忘曲线复习。'
      },
      {
        topic: '复习节奏',
        question: '艾宾浩斯复习一般建议在哪些时间点回看？',
        answer: '常见参考：第 1、2、4、7、15、30 天；实际应按回忆质量动态调整间隔。'
      },
      {
        topic: '目标拆解',
        question: '如何把一个大目标拆成可执行的周计划？',
        answer: '明确截止时间 → 列出必备知识点 → 按难度排序 → 每周 3-5 个主题 → 预留缓冲与复习日。'
      },
      {
        topic: '主动回忆',
        question: '为什么主动回忆比反复阅读更有效？',
        answer: '主动提取会强化检索路径；答不出来正好暴露薄弱点，便于针对性复习。'
      }
    ]
  };
}

/**
 * 基于资料文本的兜底周计划（不出卡），供无 AI Key / 解析失败时使用。
 */
function buildMockPlanFromMaterial(userMessage, materialText) {
  const base = buildMockPlan(userMessage);
  const lines = String(materialText || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6)
    .slice(0, 24);

  if (lines.length && base.weeks && base.weeks.length) {
    const perWeek = Math.max(1, Math.ceil(lines.length / base.weeks.length));
    base.weeks = base.weeks.map((w, i) => {
      const slice = lines.slice(i * perWeek, i * perWeek + perWeek);
      const topics = slice.length
        ? slice.map((s) => s.slice(0, 28) + (s.length > 28 ? '…' : ''))
        : w.topics;
      return {
        week: w.week,
        theme: w.theme,
        topics: topics.slice(0, 5)
      };
    });
  }

  delete base.cards;
  return base;
}

module.exports = { buildMockPlan, buildMockPlanFromMaterial };
