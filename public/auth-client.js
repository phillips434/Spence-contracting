(function () {
  var listeners = [],
    user = null,
    ready = false;
  function notify(next) {
    user = next;
    ready = true;
    listeners.forEach(function (fn) {
      fn(user);
    });
  }
  function request(path, body) {
    return fetch("/api/auth/" + path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || "Account request failed");
        return j;
      });
    });
  }
  window.cdAuth = {
    invalidateSession: function () {
      if (user) notify(null);
    },
    get currentUser() {
      return user;
    },
    onAuthStateChanged: function (fn) {
      listeners.push(fn);
      if (ready)
        Promise.resolve().then(function () {
          fn(user);
        });
      return function () {
        listeners = listeners.filter(function (x) {
          return x !== fn;
        });
      };
    },
    signInWithEmailAndPassword: function (email, password) {
      return request("login", { email: email, password: password }).then(
        function (j) {
          notify(j.user);
          return { user: j.user };
        },
      );
    },
    register: function (body) {
      return request("signup", body);
    },
    sendPasswordResetEmail: function (email) {
      return request("reset", { email: email });
    },
    signOut: function () {
      return request("logout", {}).then(function () {
        notify(null);
      });
    },
  };
  request("session")
    .then(function (j) {
      notify(j.user);
    })
    .catch(function (e) {
      ready = true;
      notify(null);
      console.error("Account session unavailable");
    });
  document.addEventListener("DOMContentLoaded", function () {
    var token = new URLSearchParams(location.search).get("accountToken");
    if (!token) return;
    // Remove the secret from browser history before any subsequent navigation.
    history.replaceState(null, "", location.pathname);
    var dialog = document.createElement("dialog");
    dialog.style.cssText =
      "max-width:360px;border:0;border-radius:16px;padding:24px;font-family:Arial";
    dialog.innerHTML =
      '<h2>Complete account setup</h2><p>For a password setup link, enter a new password. For signup verification, leave this blank.</p><form><input type="password" autocomplete="new-password" placeholder="New password (12+ characters)" style="width:100%;box-sizing:border-box;padding:12px"><button style="margin-top:12px;padding:12px">Continue</button><p role="alert"></p></form>';
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector("form").onsubmit = function (event) {
      event.preventDefault();
      var button = dialog.querySelector("button");
      button.disabled = true;
      request("complete", {
        token: token,
        password: dialog.querySelector("input").value,
      })
        .then(function (j) {
          dialog.close();
          dialog.remove();
          notify(j.user);
        })
        .catch(function (e) {
          dialog.querySelector("[role=alert]").textContent = e.message;
          button.disabled = false;
        });
    };
  });
})();
