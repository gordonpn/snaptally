(() => {
  try {
    const style = localStorage.getItem("snaptally_theme_style");
    if (style === "flat") {
      document.documentElement.setAttribute("data-theme-style", "flat");
    } else {
      document.documentElement.removeAttribute("data-theme-style");
    }
    const scheme = localStorage.getItem("snaptally_color_scheme");
    if (scheme === "light" || scheme === "dark") {
      document.documentElement.setAttribute("data-theme", scheme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    const lightColor = style === "flat" ? "#f8fafc" : "#e0e5ec";
    const darkColor = style === "flat" ? "#0f172a" : "#1e232a";
    const metaLight = document.querySelector('meta[name="theme-color"][media*="light"]');
    const metaDark = document.querySelector('meta[name="theme-color"][media*="dark"]');
    if (scheme === "light") {
      metaLight?.setAttribute("content", lightColor);
      metaDark?.setAttribute("content", lightColor);
    } else if (scheme === "dark") {
      metaDark?.setAttribute("content", darkColor);
      metaLight?.setAttribute("content", darkColor);
    } else {
      metaLight?.setAttribute("content", lightColor);
      metaDark?.setAttribute("content", darkColor);
    }
  } catch (_) {}
})();
