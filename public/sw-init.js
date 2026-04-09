// Service worker registration + auto-update
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then(function (reg) {
    setInterval(function () { reg.update(); }, 60000);
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
