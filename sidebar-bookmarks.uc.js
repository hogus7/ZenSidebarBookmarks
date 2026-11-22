// ==UserScript==
// @name           Zen Sidebar Bookmark Tiles
// @description    Przenosi pasek zakładek do sidebara (pod wskaźnik workspace) jako kafelki, działa w Compact Mode
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

(() => {
  if (window.__zenSidebarBookmarkTilesLoaded) return;
  window.__zenSidebarBookmarkTilesLoaded = true;

  let rafPending = false;
  let openPopupCount = 0;

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
    // 1. Aktywny workspace (Zen stawia tam .zen-current-workspace-indicator nad sekcją przypiętych kart / separatorem Clear)
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

    // 2. Fallback dla starszych/innych układów Zen
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
  }

  function schedulePlacement() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(placeToolbar);
  }

  function bindPopupCompactModeGuard(toolbar) {
    const toolbox = document.getElementById("navigator-toolbox");
    if (!toolbar || !toolbox || toolbar.__zenPopupGuardBound) return;
    toolbar.__zenPopupGuardBound = true;

    toolbar.addEventListener("popupshown", (e) => {
      if (e.target?.localName !== "menupopup") return;
      openPopupCount++;
      toolbox.setAttribute("zen-bookmarks-popup-open", "true");
    });

    toolbar.addEventListener("popuphidden", (e) => {
      if (e.target?.localName !== "menupopup") return;
      openPopupCount = Math.max(0, openPopupCount - 1);
      if (openPopupCount === 0) {
        toolbox.removeAttribute("zen-bookmarks-popup-open");
      }
    });
  }

  function init() {
    const toolbar = document.getElementById("PersonalToolbar");
    const tabsContainer =
      document.getElementById("tabbrowser-arrowscrollbox") ||
      document.getElementById("tabbrowser-tabs");

    if (!toolbar || !tabsContainer) {
      setTimeout(init, 150);
      return;
    }

    placeToolbar();
    bindPopupCompactModeGuard(toolbar);

    // Reaguj na przełączanie workspace'ów i przeładowania UI
    const observer = new MutationObserver(() => schedulePlacement());
    observer.observe(tabsContainer, {
      attributes: true,
      attributeFilter: ["active"],
      childList: true,
      subtree: true,
    });

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
