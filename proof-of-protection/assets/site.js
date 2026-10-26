/* Kovyr Proof: optional enhancements only. The page works fully without this file.
 *
 * Every "email us" button is a link to #contact by default (that is how it
 * behaves without JavaScript). This script turns each one into a mailto link
 * with a helpful subject and body.
 *
 * The address is NOT written here. It is read from the single #contact-email
 * link in index.html, so changing that one link changes every button.
 */
(function () {
  "use strict";

  var source = document.getElementById("contact-email");
  if (!source) return;

  var CONTACT_EMAIL = (source.getAttribute("href") || "")
    .replace(/^mailto:/i, "")
    .split("?")[0];
  if (!CONTACT_EMAIL) return;

  var MESSAGES = {
    "proof-check": {
      subject: "Founding pilot: WISP + Proof",
      body:
        "Hi,\n\nI'd like to join the founding pilot, starting with:\n" +
        "[ ] WISP ($897)\n[ ] WISP + Monitoring ($1,497 first year)\n[ ] Monitoring ($99/mo, we already have a WISP)\n\n" +
        "Firm name:\nHow many people:\n" +
        "Email (Microsoft 365 / Google / other):\n" +
        "Computers (Windows / Mac / both):\n" +
        "Good days and times to talk:\n\nThanks,\n"
    },
    pilot: {
      subject: "Founding pilot",
      body:
        "Hi,\n\nI'm interested in the founding pilot.\n\n" +
        "Firm name:\nHow many people:\n" +
        "What prompted me to get in touch:\n\nThanks,\n"
    },
    call: {
      subject: "Free 20-minute call",
      body:
        "Hi,\n\nI'd be happy to talk for 20 minutes about how our office handles security today.\n\n" +
        "Firm name:\nGood days and times to talk:\n\nThanks,\n"
    },
    question: {
      subject: "A question",
      body: ""
    }
  };

  function mailto(kind) {
    var m = MESSAGES[kind] || MESSAGES.question;
    var query = "subject=" + encodeURIComponent(m.subject);
    if (m.body) query += "&body=" + encodeURIComponent(m.body);
    return "mailto:" + CONTACT_EMAIL + "?" + query;
  }

  var links = document.querySelectorAll("a[data-mail]");
  for (var i = 0; i < links.length; i++) {
    links[i].setAttribute("href", mailto(links[i].getAttribute("data-mail")));
  }

  // "Copy address" helps people whose browser has no mail app set up.
  var copyBtn = document.querySelector("[data-copy-email]");
  if (copyBtn && navigator.clipboard && window.isSecureContext) {
    copyBtn.hidden = false;
    var label = copyBtn.textContent;
    var timer;
    copyBtn.addEventListener("click", function () {
      navigator.clipboard.writeText(CONTACT_EMAIL).then(
        function () {
          copyBtn.textContent = "Copied";
          clearTimeout(timer);
          timer = setTimeout(function () { copyBtn.textContent = label; }, 2000);
        },
        function () {
          copyBtn.textContent = "Select and copy the address";
        }
      );
    });
  }
})();
