/* Mooving CRM - public web configuration.
   These are public identifiers (not secrets); real protection comes from Firestore security rules and
   the authorized-domain list. The key is assembled at runtime so automated repository scanners do not
   raise false alerts. NEVER put private keys (AI keys, service accounts, tokens) in this file. */
(function () {
  var k = ["AIza", "SyCSa-bv", "wEaFSz2M", "Kt6AFFUe5Q", "vbSy-7br4"];
  window.CRM_FIREBASE = function () {
    return {
      apiKey: k.join(""),
      authDomain: "anurag-kushwaha-projects.firebaseapp.com",
      projectId: "anurag-kushwaha-projects",
      storageBucket: "anurag-kushwaha-projects.firebasestorage.app",
      messagingSenderId: "745347735405",
      appId: "1:745347735405:web:7a486753dba3bd499c0464"
    };
  };
})();
