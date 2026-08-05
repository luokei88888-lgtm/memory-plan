const { AD_UNIT_ID } = require('./constants');
const api = require('./api');

/**
 * 播放激励视频广告，完整看完后向服务端领取额度。
 * 未配置 AD_UNIT_ID 时，开发阶段直接走领取（便于联调）。
 */
function watchAdForQuota() {
  return new Promise((resolve, reject) => {
    const finish = () => {
      api
        .claimAdReward()
        .then(resolve)
        .catch(reject);
    };

    if (!AD_UNIT_ID) {
      wx.showModal({
        title: '尚未配置广告位',
        content: '当前未填写 AD_UNIT_ID。开发联调将直接发放次数；上线前请在 utils/constants.js 配置广告位。',
        confirmText: '直接领取',
        success: (res) => {
          if (res.confirm) finish();
          else reject(new Error('cancel'));
        }
      });
      return;
    }

    if (!wx.createRewardedVideoAd) {
      reject(new Error('当前基础库不支持激励视频广告'));
      return;
    }

    const ad = wx.createRewardedVideoAd({ adUnitId: AD_UNIT_ID });
    ad.onError((err) => {
      console.error('[ad] error', err);
      reject(err);
    });

    const onClose = (res) => {
      ad.offClose(onClose);
      if (res && res.isEnded) finish();
      else reject(new Error('ad_not_ended'));
    };
    ad.onClose(onClose);

    ad.show().catch(() => {
      ad.load()
        .then(() => ad.show())
        .catch(reject);
    });
  });
}

module.exports = { watchAdForQuota };
