/* ============================================================
   SETTINGS – change before going live
   ============================================================ */
var CONFIG = window.ARS_CONFIG || { contactEmail:"hello@agenticreadiness.ai", mediaEmail:"media@agenticreadiness.ai" };

(function(){
  var root = document.documentElement;
  var CITY = root.dataset.city || "Auckland";
  var SITE = root.dataset.site || "yourbusiness.com";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function $(s, c){ return (c || document).querySelector(s); }
  function $$(s, c){ return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  var yr = $("#yr"); if (yr) yr.textContent = new Date().getFullYear();
  $$('[data-email="media"]').forEach(function(a){ a.href = "mailto:" + CONFIG.mediaEmail; a.textContent = CONFIG.mediaEmail; });
  $$('[data-email="contact"]').forEach(function(a){ a.href = "mailto:" + CONFIG.contactEmail; a.textContent = CONFIG.contactEmail; });

  /* menu on small screens */
  var mb = $(".menu-btn"), nav = $("#site-nav");
  if (mb && nav){
    mb.addEventListener("click", function(){
      var open = nav.classList.toggle("open");
      mb.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape" && nav.classList.contains("open")){ nav.classList.remove("open"); mb.setAttribute("aria-expanded","false"); mb.focus(); } });
  }

  /* five answers to one question (sample data) */
  var ans = $("#answers");
  if (ans){
    var F = "<b>Harbourline Accounting</b>";
    var A = {
      on: [
        "For a new business in {c}, start with a firm that offers fixed monthly packages. "+F+" is often recommended for start-ups, and Kauri Ledger Co. suits you if you need payroll too.",
        "A few well-reviewed options in {c}: Northshore Tax Partners for straightforward returns, or Kauri Ledger Co. for bookkeeping plus advice. Check they support your accounting software.",
        "Look for a firm used to new businesses. "+F+" publishes clear start-up pricing, and Northshore Tax Partners is another option. Ask about help registering for GST.",
        "I’d shortlist Kauri Ledger Co. and Meridian &amp; Hale. Both handle company set-up, GST and year-end accounts for small businesses in {c}.",
        F+" and Northshore Tax Partners both come up often for start-ups in {c}. Compare their fixed-fee packages and how quickly they reply."
      ],
      off: [
        "I can’t check current listings, but look for a chartered accountant who offers fixed fees for new businesses, and ask local business networks for referrals.",
        "Kauri Ledger Co. is a well-established name in {c}. Otherwise, choose a firm experienced with start-ups and the accounting software you use.",
        "Firms people mention for small businesses in {c} include Kauri Ledger Co. and "+F+". Confirm their fees before you commit.",
        "Without searching, I’d start with your bank’s small-business referrals and a directory of chartered accountants near you.",
        "Northshore Tax Partners and Kauri Ledger Co. are commonly suggested. Look for someone who will explain GST clearly and on time."
      ]
    };
    var NOTE = {
      on: "With web search on, the AI found Harbourline in most answers. Switch search off to see what it remembers without looking.",
      off: "From memory, Harbourline comes up once. The AI can find it, but doesn’t yet know it."
    };
    var renderAns = function(mode){
      var n = 0;
      ans.innerHTML = A[mode].map(function(t, i){
        var hit = t.indexOf("<b>") > -1; if (hit) n++;
        return '<article class="answer ' + (hit ? "hit" : "") + '"><header><span>Answer ' + (i+1) + '</span><span class="tag">' + (hit ? "Named" : "Not named") + "</span></header><p>" + t.replace(/\{c\}/g, CITY) + "</p></article>";
      }).join("");
      $("#ans-count").textContent = "Named in " + n + " of 5";
      $("#ans-note").textContent = NOTE[mode];
    };
    var ab = $$("#ask .seg button");
    ab.forEach(function(b){ b.addEventListener("click", function(){
      ab.forEach(function(x){ x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      renderAns(b.dataset.mode);
    }); });
    renderAns("on");
  }

  /* full test: 19 questions x 5 runs (sample data, seeded) */
  var panel = $("#full-test");
  if (panel){
    var STAGES = [
      { name:"Discovery", hint:"“Where do I start?”", n:6, on:.5, off:.17 },
      { name:"Evaluation", hint:"“Tell me about…”", n:7, on:.94, off:.66 },
      { name:"Transaction", hint:"“Best [service] in [place]”", n:6, on:.6, off:.2 }
    ];
    var stagesEl = $("#stages"), seed = 20261019, mode = "on", res = {};
    var rng = function(s){ return function(){ s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
    var gen = function(m, s){
      var r = rng(s);
      return STAGES.map(function(st){
        var rows = [];
        for (var i = 0; i < st.n; i++){
          var p = Math.min(st[m] * (.82 + .36 * r()), .99), row = [];
          for (var k = 0; k < 5; k++) row.push(r() < p);
          rows.push(row);
        }
        return rows;
      });
    };
    var total = function(x){ return x.reduce(function(a, st){ return a + st.reduce(function(b, row){ return b + row.filter(Boolean).length; }, 0); }, 0); };
    var compute = function(){ res.on = gen("on", seed); res.off = gen("off", seed + 7); };
    var render = function(){
      panel.classList.toggle("mode-off", mode === "off");
      stagesEl.innerHTML = STAGES.map(function(st, si){
        return '<div class="stage"><h4>' + st.name + ' <span>' + st.hint + "</span></h4>" +
          res[mode][si].map(function(row){
            var hits = row.filter(Boolean).length;
            return '<div class="mrow">' + row.map(function(h){ return '<span class="sq' + (h ? " hit" : "") + '"></span>'; }).join("") + "<em>" + hits + " of 5</em></div>";
          }).join("") + "</div>";
      }).join("");
      var on = total(res.on), off = total(res.off), t = total(res[mode]);
      $("#t-count").textContent = t + " of 95";
      $("#t-mode").textContent = mode === "on" ? "with web search" : "from memory";
      $("#t-prob").textContent = (t / 95).toFixed(2);
      var ratio = off ? on / off : Infinity;
      $("#t-ratio").textContent = isFinite(ratio) ? ratio.toFixed(2) : "∞";
      $("#t-note").textContent = ratio <= 1.5 ? "strong: known from memory" : ratio <= 3 ? "moderate: partly relies on search" : "weak: mostly found by search";
    };
    var tb = $$(".seg button", panel);
    tb.forEach(function(b){ b.addEventListener("click", function(){
      mode = b.dataset.mode;
      tb.forEach(function(x){ x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      render();
    }); });
    $("#rerun").addEventListener("click", function(){ seed = Math.floor(Math.random() * 2147483000) + 1; compute(); render(); });
    compute(); render();
  }

  /* ratio examples */
  $$("[data-pair]").forEach(function(el){
    var p = el.dataset.pair.split("|"), out = "";
    p[0].split("").forEach(function(c){ out += '<i class="' + (c === "1" ? "on" : "") + '"></i>'; });
    p[1].split("").forEach(function(c){ out += '<i class="' + (c === "1" ? "mem" : "") + '"></i>'; });
    el.innerHTML = out;
  });

  /* forms: open the visitor's email app with the details filled in (no server needed) */
  function wireForm(id, subject, required, to){
    var f = document.getElementById(id); if (!f) return;
    var msg = $(".form-msg", f);
    f.addEventListener("submit", function(e){
      e.preventDefault();
      msg.className = "form-msg";
      var el = f.elements, missing = [];
      required.forEach(function(n){ var i = el.namedItem(n); var bad = !i.value.trim(); i.setAttribute("aria-invalid", bad ? "true" : "false"); if (bad) missing.push(i); });
      if (missing.length){ msg.textContent = "Fill in the highlighted fields so we can reply."; msg.classList.add("err"); missing[0].focus(); return; }
      var email = el.namedItem("email");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())){ email.setAttribute("aria-invalid","true"); msg.textContent = "Check your email address. It should look like name@company.com."; msg.classList.add("err"); email.focus(); return; }
      var lines = [];
      Array.prototype.forEach.call(el, function(i){ if (i.name && i.value.trim()) lines.push((i.dataset.label || i.name) + ": " + i.value.trim()); });
      lines.push("Site: " + location.hostname);
      var site = el.namedItem("website") ? el.namedItem("website").value.trim() : (el.namedItem("company") ? el.namedItem("company").value.trim() : "");
      location.href = "mailto:" + CONFIG[to] + "?subject=" + encodeURIComponent(subject + (site ? ": " + site : "")) + "&body=" + encodeURIComponent(lines.join("\n"));
      msg.textContent = "Your email app should open with your message ready to send.";
    });
  }
  var gw = new URLSearchParams(location.search).get("website"); if (gw && document.getElementById("f-site")) document.getElementById("f-site").value = gw;
  wireForm("score-form", "Rating request", ["name","email","website"], "contactEmail");
  wireForm("enterprise-form", "Enterprise enquiry", ["name","email","company"], "contactEmail");

  /* copy citation */
  $$(".cite button").forEach(function(b){
    b.addEventListener("click", function(){
      var t = b.parentNode.querySelector("q").textContent;
      var done = function(){ b.textContent = "Copied"; setTimeout(function(){ b.textContent = "Copy citation"; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, function(){ b.textContent = "Select the text to copy"; });
      else b.textContent = "Select the text to copy";
    });
  });
})();
