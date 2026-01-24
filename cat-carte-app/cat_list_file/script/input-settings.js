/**
 * 全ての入力欄に一括で「予測オフ」等の属性を付与する設定
 */
document.addEventListener("DOMContentLoaded", () => {
    // textタイプのinputとtextareaをすべて取得
    const inputs = document.querySelectorAll('input[type="text"], textarea');

    inputs.forEach(el => {
        el.setAttribute('autocomplete', 'off');   // 自動補完オフ
        el.setAttribute('autocorrect', 'off');    // 自動修正オフ（iOS/Android）
        el.setAttribute('autocapitalize', 'off'); // 自動大文字化オフ
        el.setAttribute('spellcheck', 'false');   // スペルチェックオフ
    });
});