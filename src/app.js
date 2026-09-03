/* Site behaviour. No external dependencies, no network calls. */

(function () {
  "use strict";

  /* The control copies the text content of the element it names, which is the
     same node the reader is looking at. There is no second copy of the value
     held anywhere for the two to drift apart, and if the element is missing the
     control does nothing rather than putting a stale string on the clipboard.

     While no address is published the build emits no control at all, so this
     never binds. */
  function wireCopy() {
    var buttons = document.querySelectorAll("[data-copy]");

    Array.prototype.forEach.call(buttons, function (button) {
      var source = document.getElementById(button.getAttribute("data-copy"));
      var live = document.querySelector("[data-copy-live]");

      if (!source) {
        button.disabled = true;
        return;
      }

      button.addEventListener("click", function () {
        var text = source.textContent.trim();
        if (!text) return;

        function done(ok) {
          if (live) live.textContent = ok ? "Address copied." : "Copy failed.";
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () {
              done(true);
            },
            function () {
              done(false);
            },
          );
          return;
        }
        done(false);
      });
    });
  }

  function init() {
    wireCopy();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
