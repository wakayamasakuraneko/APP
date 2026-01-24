/**
 * FF検査結果に基づいてアプリのテーマカラーを切り替える
 * @param {string} res - 検査結果（"陰性(-)", "陽性(FIV+)" など）
 */
function applyFFResultTheme(res) {
  // テーマクラスを一旦すべて削除（オレンジに戻す準備）
  document.body.classList.remove("theme-fiv", "theme-felv", "theme-both", "theme-negative");

  // 結果に応じてクラスを付与
  if (res.includes("陽性")) {
    if (res.includes("FIV") && res.includes("FeLV")) {
      document.body.classList.add("theme-both");
    } else if (res.includes("FeLV")) {
      document.body.classList.add("theme-felv");
    } else if (res.includes("FIV")) {
      document.body.classList.add("theme-fiv");
    }
  } else if (res.includes("陰性")) {
    // 陰性のときに青色（theme-negative）にする
    document.body.classList.add("theme-negative");
  }
}
