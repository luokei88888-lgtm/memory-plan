const { SUBSCRIBE_TMPL_IDS } = require('./constants');
const api = require('./api');

/**
 * 请求订阅消息授权；用户同意后服务端标记 remindEnabled。
 */
function requestReviewRemind() {
  return new Promise((resolve, reject) => {
    if (!SUBSCRIBE_TMPL_IDS || !SUBSCRIBE_TMPL_IDS.length) {
      wx.showModal({
        title: '尚未配置模板',
        content: '请先在微信公众平台申请订阅消息模板，并填入 utils/constants.js 的 SUBSCRIBE_TMPL_IDS。开发联调可先开启本地提醒开关。',
        confirmText: '仍开启开关',
        success: (res) => {
          if (!res.confirm) {
            reject(new Error('cancel'));
            return;
          }
          api.setRemind(true).then(resolve).catch(reject);
        }
      });
      return;
    }

    wx.requestSubscribeMessage({
      tmplIds: SUBSCRIBE_TMPL_IDS,
      success: (res) => {
        const accepted = SUBSCRIBE_TMPL_IDS.some((id) => res[id] === 'accept');
        api
          .setRemind(accepted)
          .then((r) => resolve({ ...r, accepted }))
          .catch(reject);
      },
      fail: reject
    });
  });
}

module.exports = { requestReviewRemind };
