// Register once. Check for a new SW on focus, not every 30s.
// Only reload on controllerchange when a previous SW already controlled the page
// (never force-reload a cold visitor's first session).
if ("serviceWorker" in navigator) {
  var hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register("/sw.js").then(function (reg) {
    function check() { reg.update().catch(function () {}); }
    check();
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") check();
    });
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
  }).catch(function () {});

  var refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
