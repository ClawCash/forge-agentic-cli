// Where the merchant app keeps the viewer's light or dark choice.
export const THEME_KEY = "402reviews-app-theme"

// Sets the theme before first paint so there is no flash: a saved choice,
// then the system setting.
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`
