// ==UserScript==
// @name           Zen Sidebar Bookmark Tiles
// @description    Przenosi pasek zakładek do sidebara jako kafelki, MMB w tle, LMB w nowej karcie, Compact Mode + ustawienia
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

(() => {
  if (window.__zenSidebarBookmarkTilesLoaded) return;
  window.__zenSidebarBookmarkTilesLoaded = true;

  const PREF_PREFIX = "mod.sidebar_bookmarks.";
  const PREF_CONFIG = [
    { key: "tile_height", label: "Wysokość kafelków", def: "36px" },
    { key: "tile_width", label: "Szerokość bazowa kafelka", def: "52px" },
    { key: "icon_size", label: "Rozmiar ikon", def: "16px" },
    { key: "tile_gap", label: "Odstęp między kafelkami", def: "6px" },
    { key: "sidebar_padding", label: "Padding od krawędzi sidebara", def: "8px" },
    { key: "tile_radius", label: "Zaokrąglenie rogów", def: "9px" },
  ];

  let rafPending = false;
  let gapPending = false;
  let openPopupCount = 0;

  function getPlacesModules() {
    let pUtils = window.PlacesUtils || globalThis.PlacesUtils;
    let pUIUtils = window.PlacesUIUtils || globalThis.PlacesUIUtils;
    try {
      if (!pUtils) {
        ({ PlacesUtils: pUtils } = ChromeUtils.importESModule(
          "resource://gre/modules/PlacesUtils.sys.mjs"
        ));
      }
    } catch {}
    try {
      if (!pUIUtils) {
        ({ PlacesUIUtils: pUIUtils } = ChromeUtils.importESModule(
          "resource:///modules/PlacesUIUtils.sys.mjs"
        ));
      }
    } catch {}
    return { PlacesUtils: pUtils, PlacesUIUtils: pUIUtils };
  }

  function syncPreferences() {
    const rootStyle = document.documentElement.style;
    for (const { key } of PREF_CONFIG) {
      const prefName = PREF_PREFIX + key;
      const cssVar = `--mod-sidebar_bookmarks-${key}`;
      try {
        const val = Services.prefs.getStringPref(prefName, "").trim();
        if (val) {
          rootStyle.setProperty(cssVar, val);
        } else {
          rootStyle.removeProperty(cssVar);
        }
      } catch {
        rootStyle.removeProperty(cssVar);
      }
    }
  }

  function ensureBookmarksReady(toolbar) {
    if (!toolbar) return;
    if (toolbar.collapsed) {
      if (typeof window.setToolbarVisibility === "function") {
        window.setToolbarVisibility(toolbar, true);
      } else {
        toolbar.collapsed = false;
        toolbar.removeAttribute("collapsed");
      }
    }
  }

  function findInsertAnchor() {
    const activeWs =
      document.querySelector('zen-workspace[active="true"]') ||
      document.querySelector("zen-workspace");

    if (activeWs) {
      const indicator = activeWs.querySelector(".zen-current-workspace-indicator");
      if (indicator) return { type: "after", el: indicator };

      const pinnedSection = activeWs.querySelector(
        ".zen-workspace-pinned-tabs-section, .pinned-tabs-container-separator"
      );
      if (pinnedSection) return { type: "before", el: pinnedSection };
    }

    const globalIndicator = document.querySelector(
      ".zen-current-workspace-indicator, #zen-current-workspace-indicator"
    );
    if (globalIndicator) return { type: "after", el: globalIndicator };

    const tabsWrapper =
      document.getElementById("zen-tabs-wrapper") ||
      document.getElementById("tabbrowser-tabs");
    if (tabsWrapper) return { type: "prepend", el: tabsWrapper };

    return null;
  }

  function resetCompactGapFix(toolbox) {
    if (!toolbox) return;
    toolbox.removeAttribute("zen-sb-gap-fixed");
    toolbox.style.removeProperty("--zen-sb-box-fix");
    toolbox.style.removeProperty("--zen-sb-title-fix");
    toolbox.style.removeProperty("--zen-sb-target-top");
  }

  function fixCompactTopGap() {
    gapPending = false;
    const root = document.documentElement;
    const toolbox = document.getElementById("navigator-toolbox");
    if (!toolbox) return;

    const isCompact = root.getAttribute("zen-compact-mode") === "true";
    const isSingle = root.getAttribute("zen-single-toolbar") === "true";
    if (!isCompact || isSingle) {
      resetCompactGapFix(toolbox);
      return;
    }

    if (getComputedStyle(toolbox).position === "static") {
      resetCompactGapFix(toolbox);
      return;
    }

    const navbar =
      document.getElementById("zen-appcontent-navbar-wrapper") ||
      document.getElementById("nav-bar");
    if (!navbar) {
      resetCompactGapFix(toolbox);
      return;
    }

    const navRect = navbar.getBoundingClientRect();
    if (navRect.height < 10 || navRect.bottom < 10) {
      resetCompactGapFix(toolbox);
      return;
    }

    const targetTop = Math.round(navRect.bottom + 4);
    toolbox.style.setProperty("--zen-sb-target-top", `${targetTop}px`);

    const titlebar = document.getElementById("titlebar") || toolbox;
    const boxRect = toolbox.getBoundingClientRect();
    const curBoxFix = parseFloat(toolbox.style.getPropertyValue("--zen-sb-box-fix")) || 0;
    const curTitleFix = parseFloat(toolbox.style.getPropertyValue("--zen-sb-title-fix")) || 0;

    const boxExcess = Math.round(boxRect.top - targetTop);
    if (Math.abs(boxExcess) > 2) {
      const nextBoxFix = Math.max(0, Math.min(100, curBoxFix + boxExcess));
      toolbox.style.setProperty("--zen-sb-box-fix", `${nextBoxFix}px`);
    }

    const updatedBoxRect = toolbox.getBoundingClientRect();
    const updatedTitleRect = titlebar.getBoundingClientRect();
    const titleExcess = Math.round(updatedTitleRect.top - targetTop);

    if (Math.abs(titleExcess) > 2 && updatedBoxRect.top <= targetTop + 4) {
      const nextTitleFix = Math.max(0, Math.min(100, curTitleFix + titleExcess));
      toolbox.style.setProperty("--zen-sb-title-fix", `${nextTitleFix}px`);
    }

    toolbox.setAttribute("zen-sb-gap-fixed", "true");
  }

  function scheduleGapFix() {
    if (gapPending) return;
    gapPending = true;
    requestAnimationFrame(fixCompactTopGap);
  }

  function placeToolbar() {
    rafPending = false;
    if (document.documentElement.hasAttribute("customizing")) return;

    const toolbar = document.getElementById("PersonalToolbar");
    if (!toolbar) return;

    ensureBookmarksReady(toolbar);

    const anchor = findInsertAnchor();
    if (!anchor || !anchor.el) return;

    if (anchor.type === "after" && anchor.el.nextElementSibling !== toolbar) {
      anchor.el.after(toolbar);
    } else if (anchor.type === "before" && anchor.el.previousElementSibling !== toolbar) {
      anchor.el.before(toolbar);
    } else if (anchor.type === "prepend" && anchor.el.firstElementChild !== toolbar) {
      anchor.el.prepend(toolbar);
    }

    toolbar.classList.add("zen-sidebar-bookmark-tiles");
    scheduleGapFix();
  }

  function schedulePlacement() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(placeToolbar);
  }

  function findBookmarkButtonFromEvent(e) {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [e.target];
    for (const el of path) {
      if (
        el?.nodeType === 1 &&
        el.matches?.("toolbarbutton.bookmark-item, menuitem.bookmark-item")
      ) {
        if (el.closest("#PersonalToolbar")) return el;
      }
    }
    return null;
  }

  function isUriBookmark(btn, node, PlacesUtils) {
    if (!btn || !node) return false;
    if (btn.getAttribute("container") === "true") return false;
    if (PlacesUtils && PlacesUtils.nodeIsContainer(node)) return false;
    const isUri = PlacesUtils ? PlacesUtils.nodeIsURI(node) : Boolean(node.uri);
    if (!isUri || !node.uri) return false;
    if (node.uri.startsWith("javascript:") || node.uri.startsWith("place:")) return false;
    return true;
  }

  function openBookmarkInNewTab(uri, inBackground) {
    try {
      if (window.gBrowser?.addTrustedTab) {
        window.gBrowser.addTrustedTab(uri, { inBackground: Boolean(inBackground) });
        return;
      }
    } catch {}

    try {
      if (typeof window.openTrustedLinkIn === "function") {
        window.openTrustedLinkIn(uri, "tab", {
          inBackground: Boolean(inBackground),
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        return;
      }
    } catch {}

    if (window.gBrowser?.loadOneTab) {
      window.gBrowser.loadOneTab(uri, {
        inBackground: Boolean(inBackground),
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    }
  }

  function closeContainingMenu(btn) {
    let popup = btn?.closest?.("menupopup");
    while (popup) {
      const parentPopup = popup.parentElement?.closest?.("menupopup");
      if (typeof popup.hidePopup === "function") popup.hidePopup();
      popup = parentPopup;
    }
  }

  // MMB -> zawsze nowa karta w tle | LMB -> zawsze nowa karta (zostawia bieżącą kartę nietkniętą)
  function bindBookmarkClicks() {
    if (window.__zenBookmarkClicksBound) return;
    window.__zenBookmarkClicksBound = true;

    let mmbPressedBtn = null;
    let lastHandledBtn = null;
    let lastHandledAt = 0;

    function markHandled(btn) {
      lastHandledBtn = btn;
      lastHandledAt = Date.now();
    }

    function wasJustHandled(btn) {
      return lastHandledBtn === btn && Date.now() - lastHandledAt < 400;
    }

    window.addEventListener(
      "mousedown",
      (e) => {
        if (e.button !== 1) return;
        const btn = findBookmarkButtonFromEvent(e);
        if (!btn) {
          mmbPressedBtn = null;
          return;
        }
        mmbPressedBtn = btn;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );

    const handleMmbRelease = (e) => {
      if (e.button !== 1) return;
      const btn = findBookmarkButtonFromEvent(e);
      if (!btn || btn !== mmbPressedBtn) {
        if (e.type === "auxclick") mmbPressedBtn = null;
        return;
      }

      mmbPressedBtn = null;
      e.preventDefault();
      e.stopPropagation();

      if (wasJustHandled(btn)) return;
      markHandled(btn);

      const node = btn._placesNode || btn.node;
      if (!node) return;

      const { PlacesUtils, PlacesUIUtils } = getPlacesModules();
      if (isUriBookmark(btn, node, PlacesUtils)) {
        openBookmarkInNewTab(node.uri, true);
        closeContainingMenu(btn);
      } else if (PlacesUtils?.nodeIsContainer(node) && PlacesUIUtils?.openNodeWithEvent) {
        PlacesUIUtils.openNodeWithEvent(node, e);
      }
    };

    window.addEventListener("mouseup", handleMmbRelease, true);
    window.addEventListener("auxclick", handleMmbRelease, true);

    window.addEventListener(
      "click",
      (e) => {
        if (e.button !== 0) return;
        const btn = findBookmarkButtonFromEvent(e);
        if (!btn) return;

        const node = btn._placesNode || btn.node;
        const { PlacesUtils } = getPlacesModules();
        if (!isUriBookmark(btn, node, PlacesUtils)) return;

        e.preventDefault();
        e.stopPropagation();

        if (wasJustHandled(btn)) return;
        markHandled(btn);

        const inBg = Boolean(e.ctrlKey || e.metaKey);
        openBookmarkInNewTab(node.uri, inBg);
        closeContainingMenu(btn);
      },
      true
    );

    window.addEventListener(
      "command",
      (e) => {
        const btn = findBookmarkButtonFromEvent(e);
        if (!btn) return;

        const node = btn._placesNode || btn.node;
        const { PlacesUtils } = getPlacesModules();
        if (!isUriBookmark(btn, node, PlacesUtils)) return;

        e.preventDefault();
        e.stopPropagation();

        if (wasJustHandled(btn)) return;
        markHandled(btn);

        openBookmarkInNewTab(node.uri, false);
        closeContainingMenu(btn);
      },
      true
    );
  }

  function bindPopupCompactModeGuard(toolbar) {
    const toolbox = document.getElementById("navigator-toolbox");
    if (!toolbar || !toolbox || toolbar.__zenPopupGuardBound) return;
    toolbar.__zenPopupGuardBound = true;

    const onShown = (e) => {
      if (
        e.target?.localName !== "menupopup" &&
        e.target?.id !== "zen-sb-tiles-settings-panel"
      ) {
        return;
      }
      openPopupCount++;
      toolbox.setAttribute("zen-bookmarks-popup-open", "true");
    };

    const onHidden = (e) => {
      if (
        e.target?.localName !== "menupopup" &&
        e.target?.id !== "zen-sb-tiles-settings-panel"
      ) {
        return;
      }
      openPopupCount = Math.max(0, openPopupCount - 1);
      if (openPopupCount === 0) {
        toolbox.removeAttribute("zen-bookmarks-popup-open");
      }
    };

    toolbar.addEventListener("popupshown", onShown);
    toolbar.addEventListener("popuphidden", onHidden);

    const panel = document.getElementById("zen-sb-tiles-settings-panel");
    if (panel) {
      panel.addEventListener("popupshown", onShown);
      panel.addEventListener("popuphidden", onHidden);
    }
  }

  function openSettingsPanel() {
    const toolbar = document.getElementById("PersonalToolbar");
    if (!toolbar) return;

    const XHTML = "http://www.w3.org/1999/xhtml";
    let panel = document.getElementById("zen-sb-tiles-settings-panel");

    if (!panel) {
      panel = document.createXULElement("panel");
      panel.id = "zen-sb-tiles-settings-panel";
      panel.setAttribute("type", "arrow");
      panel.setAttribute("noautofocus", "false");

      const container = document.createElementNS(XHTML, "div");
      container.style.cssText =
        "padding: 12px 14px; min-width: 270px; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px;";

      const title = document.createElementNS(XHTML, "div");
      title.textContent = "Ustawienia kafelków zakładek";
      title.style.cssText = "font-weight: 600; font-size: 13.5px; margin-bottom: 2px;";
      container.appendChild(title);

      const inputs = {};
      for (const item of PREF_CONFIG) {
        const row = document.createElementNS(XHTML, "div");
        row.style.cssText =
          "display: flex; align-items: center; justify-content: space-between; gap: 10px;";

        const lbl = document.createElementNS(XHTML, "label");
        lbl.textContent = item.label;
        lbl.style.cssText = "opacity: 0.9;";

        const inp = document.createElementNS(XHTML, "input");
        inp.type = "text";
        inp.placeholder = item.def;
        inp.style.cssText =
          "width: 72px; padding: 4px 7px; border-radius: 6px; border: 1px solid rgba(128,128,128,0.35); background: rgba(128,128,128,0.12); color: inherit; font-size: 12px;";
        inp.addEventListener("input", () => {
          const val = inp.value.trim();
          Services.prefs.setStringPref(PREF_PREFIX + item.key, val || item.def);
        });

        inputs[item.key] = inp;
        row.appendChild(lbl);
        row.appendChild(inp);
        container.appendChild(row);
      }

      const btnRow = document.createElementNS(XHTML, "div");
      btnRow.style.cssText =
        "display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;";

      const resetBtn = document.createElementNS(XHTML, "button");
      resetBtn.textContent = "Domyślne";
      resetBtn.style.cssText =
        "padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(128,128,128,0.3); background: transparent; color: inherit; cursor: pointer;";
      resetBtn.addEventListener("click", () => {
        for (const item of PREF_CONFIG) {
          Services.prefs.setStringPref(PREF_PREFIX + item.key, item.def);
          inputs[item.key].value = item.def;
        }
      });

      const closeBtn = document.createElementNS(XHTML, "button");
      closeBtn.textContent = "Gotowe";
      closeBtn.style.cssText =
        "padding: 5px 12px; border-radius: 6px; border: none; background: rgba(128,128,128,0.28); color: inherit; font-weight: 600; cursor: pointer;";
      closeBtn.addEventListener("click", () => panel.hidePopup());

      btnRow.appendChild(resetBtn);
      btnRow.appendChild(closeBtn);
      container.appendChild(btnRow);
      panel.appendChild(container);
      panel._inputs = inputs;

      (document.getElementById("mainPopupSet") || document.documentElement).appendChild(panel);
      bindPopupCompactModeGuard(toolbar);
    }

    for (const item of PREF_CONFIG) {
      panel._inputs[item.key].value = Services.prefs.getStringPref(
        PREF_PREFIX + item.key,
        item.def
      );
    }

    panel.openPopup(toolbar, "after_start", 0, 4, false, false);
  }

  function bindContextMenuSettings() {
    const placesContext = document.getElementById("placesContext");
    if (!placesContext || placesContext.__zenTileSettingsBound) return;
    placesContext.__zenTileSettingsBound = true;

    placesContext.addEventListener("popupshowing", (e) => {
      if (e.target !== placesContext) return;
      const toolbar = document.getElementById("PersonalToolbar");
      const trigger = placesContext.triggerNode || document.popupNode;
      const inSidebarBookmarks = Boolean(toolbar && trigger && toolbar.contains(trigger));

      let sep = document.getElementById("zen-sb-tiles-settings-sep");
      let item = document.getElementById("zen-sb-tiles-settings-item");

      if (!item) {
        sep = document.createXULElement("menuseparator");
        sep.id = "zen-sb-tiles-settings-sep";
        item = document.createXULElement("menuitem");
        item.id = "zen-sb-tiles-settings-item";
        item.setAttribute("label", "Ustawienia kafelków zakładek...");
        item.addEventListener("command", openSettingsPanel);
        placesContext.appendChild(sep);
        placesContext.appendChild(item);
      }

      sep.hidden = !inSidebarBookmarks;
      item.hidden = !inSidebarBookmarks;
    });
  }

  function init() {
    const toolbar = document.getElementById("PersonalToolbar");
    const toolbox = document.getElementById("navigator-toolbox");
    const tabsContainer =
      document.getElementById("tabbrowser-arrowscrollbox") ||
      document.getElementById("tabbrowser-tabs");

    if (!toolbar || !toolbox || !tabsContainer) {
      setTimeout(init, 150);
      return;
    }

    syncPreferences();
    placeToolbar();
    bindBookmarkClicks();
    bindPopupCompactModeGuard(toolbar);
    bindContextMenuSettings();

    setTimeout(scheduleGapFix, 150);
    setTimeout(scheduleGapFix, 500);

    Services.prefs.addObserver(PREF_PREFIX, syncPreferences);
    window.addEventListener(
      "unload",
      () => Services.prefs.removeObserver(PREF_PREFIX, syncPreferences),
      { once: true }
    );

    const observer = new MutationObserver(() => schedulePlacement());
    observer.observe(tabsContainer, {
      attributes: true,
      attributeFilter: ["active"],
      childList: true,
      subtree: true,
    });

    const rootObserver = new MutationObserver(() => scheduleGapFix());
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["zen-compact-mode", "zen-single-toolbar"],
    });

    const toolboxObserver = new MutationObserver(() => scheduleGapFix());
    toolboxObserver.observe(toolbox, {
      attributes: true,
      attributeFilter: ["zen-has-hover", "zen-has-implicit-hover"],
    });

    window.addEventListener("resize", scheduleGapFix);
    window.addEventListener("ZenWorkspaces:Select", schedulePlacement);
    window.addEventListener("ZenWorkspaces:Change", schedulePlacement);
    window.addEventListener("aftercustomization", schedulePlacement);
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
