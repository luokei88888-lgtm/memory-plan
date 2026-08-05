const { COLLECTIONS, DEFAULTS } = require('./constants');

/**
 * 追加一轮对话（用户消息 + AI 回复），并限制历史长度，避免文档无限增长。
 * 新会话则创建。
 */
async function appendMessages(db, { userId, conversationId, userMessage, aiReply }) {
  const now = new Date();
  const newPair = [
    { role: 'user', content: userMessage, createdAt: now },
    { role: 'assistant', content: aiReply, createdAt: now }
  ];

  if (conversationId) {
    const docRef = db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId);
    const existing = await docRef.get().catch(() => null);
    const doc = existing && existing.data;
    // 归属校验：只有本人会话才可追加，防止越权覆盖他人会话
    if (doc && doc.userId === userId) {
      const prev = doc.messages || [];
      const merged = prev.concat(newPair).slice(-DEFAULTS.MAX_CONVERSATION_MESSAGES);
      await docRef.update({ data: { messages: merged, updatedAt: now } });
      return conversationId;
    }
    // 不存在或非本人：退回新建，避免写入他人文档
  }

  const addRes = await db.collection(COLLECTIONS.CONVERSATIONS).add({
    data: {
      userId,
      title: userMessage.slice(0, 20) || '新对话',
      messages: newPair,
      createdAt: now,
      updatedAt: now
    }
  });
  return addRes._id;
}

module.exports = { appendMessages };
