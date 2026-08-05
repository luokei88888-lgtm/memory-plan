/** 日间 / 夜间主题（本地持久化，供各页同步导航栏与 Tab） */

const STORAGE_KEY = 'themeMode';

const CHROME = {
  light: {
    navBg: '#F2F4F7',
    navFront: '#000000',
    bg: '#F2F4F7',
    tabBg: '#FFFFFF',
    tabColor: '#9AA8B4',
    tabSelected: '#2F6F6A',
    borderStyle: 'white',
    ringTrack: '#E6EEF0',
    ringFill: '#2F6F6A'
  },
  dark: {
    navBg: '#121A24',
    navFront: '#ffffff',
    bg: '#121A24',
    tabBg: '#1A2634',
    tabColor: '#7A8B9C',
    tabSelected: '#3D9B8F',
    borderStyle: 'black',
    ringTrack: '#2A3544',
    ringFill: '#3D9B8F'
  }
};

function normalize(mode) {
  return mode === 'dark' ? 'dark' : 'light';
}

function getTheme() {
  try {
    return normalize(wx.getStorageSync(STORAGE_KEY));
  } catch (e) {
    return 'light';
  }
}

function getChrome(mode) {
  return CHROME[normalize(mode)];
}

function applyChrome(mode) {
  const m = normalize(mode);
  const c = CHROME[m];
  try {
    wx.setNavigationBarColor({
      frontColor: c.navFront,
      backgroundColor: c.navBg,
      animation: { duration: 180, timingFunc: 'easeIn' }
    });
  } catch (e) {
    /* ignore */
  }
  try {
    wx.setBackgroundColor({
      backgroundColor: c.bg,
      backgroundColorTop: c.bg,
      backgroundColorBottom: c.bg
    });
  } catch (e) {
    /* ignore */
  }
  try {
    wx.setTabBarStyle({
      color: c.tabColor,
      selectedColor: c.tabSelected,
      backgroundColor: c.tabBg,
      borderStyle: c.borderStyle
    });
  } catch (e) {
    /* 非 Tab 页可能失败，忽略 */
  }
}

function setTheme(mode) {
  const next = normalize(mode);
  try {
    wx.setStorageSync(STORAGE_KEY, next);
  } catch (e) {
    /* ignore */
  }
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.themeMode = next;
  } catch (e) {
    /* ignore */
  }
  applyChrome(next);
  return next;
}

function toggleTheme() {
  return setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

/** 页面 onShow 时同步主题到 data + 系统栏 */
function syncPageTheme(page) {
  if (!page || !page.setData) return 'light';
  const themeMode = getTheme();
  applyChrome(themeMode);
  page.setData({
    themeMode,
    isDark: themeMode === 'dark'
  });
  return themeMode;
}

function ringStyle(progress, mode) {
  const c = getChrome(mode);
  const p = Math.max(0, Math.min(100, Number(progress) || 0));
  return `background: conic-gradient(${c.ringFill} ${p}%, ${c.ringTrack} 0);`;
}

module.exports = {
  STORAGE_KEY,
  getTheme,
  setTheme,
  toggleTheme,
  applyChrome,
  syncPageTheme,
  ringStyle,
  getChrome
};
