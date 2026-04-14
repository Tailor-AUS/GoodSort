// Service worker registration + aggressive auto-update
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then(function (reg) {
    // Check for updates immediately, then every 30 seconds
    reg.update();
    setInterval(function () { reg.update(); }, 30000);

    // If a new SW is waiting, tell it to activate immediately
    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    reg.addEventListener("updatefound", function () {
      var newSW = reg.installing;
      if (newSW) {
        newSW.addEventListener("statechange", function () {
          if (newSW.state === "activated") {
            window.location.reload();
          }
        });
      }
    });
  }).catch(function () {});

  navigator.serviceWorker.addEventListener("message", function (e) {
    if (e.data && e.data.type === "SW_UPDATED") {
      window.location.reload();
    }
  });

  var refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!refreshing) { refreshing = true; window.location.reload(); }
  });
}
