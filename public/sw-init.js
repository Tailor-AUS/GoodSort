// Register once. Check for a new SW on focus, not every 30s.
// One reload path only — a 30s update + triple reload hung local Next.
if ("serviceWorker" in navigator) {
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
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
