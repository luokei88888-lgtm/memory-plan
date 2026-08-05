const COLLECTIONS = {
  USERS: 'users',
  CONVERSATIONS: 'conversations',
  STUDY_PLANS: 'study_plans',
  KNOWLEDGE_CARDS: 'knowledge_cards',
  REVIEW_LOGS: 'review_logs',
  MATERIALS: 'materials',
  AI_CALL_LOGS: 'ai_call_logs'
};

const SCENES = ['job', 'exam', 'skill', 'interest', 'language', 'reading'];

const CARD_STATUS = {
  ACTIVE: 'active',
  MASTERED: 'mastered',
  SUSPENDED: 'suspended'
};

/** draft → 待上传资料；pending_confirm → 待用户确认计划；active → 已确认可复习 */
const PLAN_STATUS = {
  DRAFT: 'draft',
  PENDING_CONFIRM: 'pending_confirm',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ARCHIVED: 'archived'
};

const DEFAULTS = {
  DAILY_QUOTA: 20,
  AD_REWARD_QUOTA: 5,
  MAX_AD_CLAIMS_PER_DAY: 5,
  /** 分享给好友每次奖励次数 */
  SHARE_REWARD_QUOTA: 3,
  /** 每天最多领取分享奖励次数 */
  MAX_SHARE_CLAIMS_PER_DAY: 3,
  /** 好友通过分享进入时，邀请人获得次数 */
  INVITE_REWARD_QUOTA: 5,
  /** 受邀新用户（或首次绑定邀请）欢迎次数 */
  INVITEE_WELCOME_QUOTA: 3,
  MAX_CONVERSATION_MESSAGES: 40,
  /** 每日最多生成计划次数（控 AI 成本 / 防刷；随 ENFORCE_QUOTA 生效） */
  MAX_PLAN_GEN_PER_DAY: 10,
  REVIEW_HOUR: 8,
  /** 上线前再改为 true：开启每日对话额度拦截 */
  ENFORCE_QUOTA: false,
  /** 内容安全：接口失败时是否硬拦截（false=仅拦 risky/review） */
  CONTENT_SAFE_STRICT: false,
  /** AI 调用日志保留天数（合规建议 ≥ 180） */
  AI_LOG_RETENTION_DAYS: 180,
  /** 日志中 prompt / response 最大字符，避免单文档过大 */
  AI_LOG_PROMPT_MAX: 8000,
  AI_LOG_RESPONSE_MAX: 16000,
  /** 定时清理：每批删除条数 / 单次运行上限 */
  AI_LOG_CLEANUP_BATCH: 100,
  AI_LOG_CLEANUP_MAX_PER_RUN: 1000,
  /** 计划周数：跟随用户周期，超出则钳制到区间 */
  MIN_PLAN_WEEKS: 1,
  MAX_PLAN_WEEKS: 24,
  /** 送给 AI 的资料文本上限（字符），过长会头/中/尾抽样 */
  MATERIAL_TEXT_LIMIT: 24000
};

const ERROR = {
  MISSING_PARAM: 'MISSING_PARAM',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_STATUS: 'INVALID_STATUS',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PLAN_LIMIT: 'PLAN_LIMIT',
  AD_LIMIT: 'AD_LIMIT',
  SHARE_LIMIT: 'SHARE_LIMIT',
  INVITE_INVALID: 'INVITE_INVALID',
  CONTENT_RISKY: 'CONTENT_RISKY',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  INTERNAL: 'INTERNAL'
};

module.exports = { COLLECTIONS, SCENES, CARD_STATUS, PLAN_STATUS, DEFAULTS, ERROR };
