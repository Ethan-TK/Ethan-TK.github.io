/* Agentic Readiness quick check
   Runs in the visitor's browser. Fetches the site's home page, robots.txt, llms.txt and sitemap
   through a fetch service (browsers can't read other websites directly), then scores the four
   pillars that can be checked automatically. Brand Command needs the full AI test. */
(function(){
  "use strict";
  var CFG = window.ARS_CONFIG || {};
  var ENDPOINT = CFG.checkerEndpoint || "";              // your own Cloudflare Worker (recommended)
  // Public fetch services, tried in order when no endpoint of your own is set.
  // r.jina.ai (direct mode) returns the raw page plus its real HTTP status; allorigins is a last resort.
  var JINA = "https://r.jina.ai/";
  var ALLORIGINS = "https://api.allorigins.win/raw?url=";
  var TIMEOUT = 20000;

  /* ---------------- fetching ---------------- */
  function withTimeout(p, ms){
    return Promise.race([p, new Promise(function(_, rej){ setTimeout(function(){ rej(new Error("timeout")); }, ms); })]);
  }
  function decodeEntities(t){ var d = document.createElement("textarea"); d.innerHTML = t; return d.value; }
  // Jina returns plain-text files (robots.txt, llms.txt) wrapped in the browser's text viewer; unwrap them.
  function unwrapText(html){
    var m = /^\s*<html><head>(?:<meta[^>]*>)*<\/head><body><pre[^>]*>([\s\S]*)<\/pre><\/body><\/html>\s*$/i.exec(html || "");
    return m ? { text: decodeEntities(m[1]), plain: true } : { text: html || "", plain: false };
  }
  function viaEndpoint(url){
    return fetch(ENDPOINT + (ENDPOINT.indexOf("?") > -1 ? "&" : "?") + "url=" + encodeURIComponent(url))
      .then(function(r){ return r.json(); })
      .then(function(j){ return { ok: j.status >= 200 && j.status < 300, status: j.status || 0, url: j.url || url, type: j.contentType || "", text: j.body || "", robotsHeader: j.xRobotsTag || "" }; });
  }
  function viaJina(url){
    return fetch(JINA + url, { headers: { "Accept": "application/json", "X-Return-Format": "html", "X-Engine": "direct", "X-No-Cache": "true" } })
      .then(function(r){ return r.json().then(function(j){ return { r: r, j: j }; }); })
      .then(function(o){
        var j = o.j || {}, d = j.data;
        if (!d){
          var msg = j.readableMessage || j.message || "";
          if (/resolve|ENOTFOUND|could not be resolved/i.test(msg)) return { ok:false, status:0, url:url, type:"", text:"", error:"dns" };
          throw new Error("jina " + o.r.status);
        }
        var code = d.httpStatus || 0; if (!code) throw new Error("jina no status");
        var u = unwrapText(d.html);
        return { ok: code >= 200 && code < 300, status: code, url: d.finalUrl || d.url || url, type: u.plain ? "text/plain" : "", text: u.text, robotsHeader: "" };
      });
  }
  function viaAllOrigins(url){
    return fetch(ALLORIGINS + encodeURIComponent(url)).then(function(r){
      return r.text().then(function(t){ return { ok: r.ok, status: r.status, url: url, type: r.headers.get("content-type") || "", text: t, robotsHeader: "" }; });
    });
  }
  function attempt(fn, url){ return withTimeout(fn(url), TIMEOUT); }
  function fetchText(url){
    var chain = ENDPOINT ? [viaEndpoint, viaJina, viaAllOrigins] : [viaJina, viaAllOrigins];
    var i = 0, lastErr = null;
    function next(){
      if (i >= chain.length) return Promise.resolve({ ok:false, status:0, url:url, type:"", text:"", error: lastErr ? (lastErr.message || String(lastErr)) : "unreachable" });
      var fn = chain[i++];
      return attempt(fn, url).catch(function(e){ lastErr = e; return next(); });
    }
    return next();
  }
  function looksHtml(t){ return /^\s*(<!doctype|<html|<head|<body|<\?xml[^>]*>\s*<html)/i.test(t || ""); }

  /* ---------------- robots.txt ---------------- */
  var BOTS = [
    { ua:"OAI-SearchBot",   who:"ChatGPT search",                 w:2 },
    { ua:"ChatGPT-User",    who:"ChatGPT, fetching for a user",   w:2 },
    { ua:"GPTBot",          who:"OpenAI model training",          w:1 },
    { ua:"ClaudeBot",       who:"Anthropic (Claude)",             w:1 },
    { ua:"PerplexityBot",   who:"Perplexity search",              w:2 },
    { ua:"Google-Extended", who:"Google Gemini training",         w:1 },
    { ua:"Bingbot",         who:"Bing and Microsoft Copilot",     w:2 },
    { ua:"Applebot-Extended", who:"Apple Intelligence training",  w:1 },
    { ua:"CCBot",           who:"Common Crawl (used to train many models)", w:1 }
  ];
  function parseRobots(txt){
    var groups = [], cur = null, lastWasUA = false, sitemaps = [];
    (txt || "").split(/\r?\n/).forEach(function(raw){
      var line = raw.replace(/#.*$/, "").trim(); if (!line) return;
      var m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) return;
      var k = m[1].toLowerCase(), v = m[2].trim();
      if (k === "user-agent"){
        if (!cur || !lastWasUA){ cur = { agents: [], rules: [] }; groups.push(cur); }
        cur.agents.push(v.toLowerCase()); lastWasUA = true;
      } else if (k === "allow" || k === "disallow"){
        if (cur) cur.rules.push({ allow: k === "allow", path: v }); lastWasUA = false;
      } else if (k === "sitemap"){ sitemaps.push(v); lastWasUA = false; }
      else { lastWasUA = false; }
    });
    return { groups: groups, sitemaps: sitemaps };
  }
  function rootAllowed(robots, ua){
    var token = ua.toLowerCase(), group = null;
    robots.groups.forEach(function(g){ if (!group && g.agents.some(function(a){ return a !== "*" && token.indexOf(a) === 0; })) group = g; });
    if (!group) robots.groups.forEach(function(g){ if (!group && g.agents.indexOf("*") > -1) group = g; });
    if (!group) return { allowed: true, explicit: false };
    var best = null;
    group.rules.forEach(function(r){
      var p = r.path;
      if (p === "") return;                                   // "Disallow:" with no path blocks nothing
      var matches = p === "/" || p === "/*" || p === "*" || p === "/$";
      if (!matches) return;
      var len = p.replace(/[*$]/g, "").length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { len: len, allow: r.allow };
    });
    return { allowed: best ? best.allow : true, explicit: group.agents.indexOf("*") === -1 };
  }

  /* ---------------- structured data ---------------- */
  function collectJsonLd(doc){
    var items = [], invalid = 0;
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(function(s){
      try {
        var data = JSON.parse(s.textContent.trim());
        (function walk(n){
          if (Array.isArray(n)) return n.forEach(walk);
          if (n && typeof n === "object"){
            if (n["@graph"]) walk(n["@graph"]);
            if (n["@type"]) items.push(n);
            Object.keys(n).forEach(function(k){ if (k !== "@graph" && n[k] && typeof n[k] === "object") walk(n[k]); });
          }
        })(data);
      } catch(e){ invalid++; }
    });
    return { items: items, invalid: invalid, blocks: doc.querySelectorAll('script[type="application/ld+json"]').length };
  }
  function types(it){ var t = it["@type"]; return (Array.isArray(t) ? t : [t]).map(String); }
  var ORG_RE = /^(Organization|Corporation|LocalBusiness|NGO|EducationalOrganization|GovernmentOrganization|MedicalOrganization|.*Store|Restaurant|.*Service|Hotel|Dentist|Physician|Attorney|LegalService|AccountingService|FinancialService|InsuranceAgency|RealEstateAgent|AutoDealer|HomeAndConstructionBusiness|.*Business|Airline|BankOrCreditUnion|TravelAgency|Brand|OnlineStore)$/;

  /* ---------------- scoring helpers ---------------- */
  function check(name, status, finding, fix, weight){ return { name:name, status:status, finding:finding, fix:fix || "", weight:weight }; }
  var CREDIT = { pass:1, part:.5, fail:0 };
  function pillarScore(checks){
    var tot = 0, got = 0;
    checks.forEach(function(c){ if (c.status === "na") return; tot += c.weight; got += c.weight * CREDIT[c.status]; });
    return tot ? Math.round(got / tot * 100) : null;
  }
  function band(s){ return s >= 80 ? "Leading" : s >= 60 ? "Visible" : s >= 40 ? "Emerging" : s >= 20 ? "Low visibility" : "Invisible"; }
  function words(t){ return (t.match(/[A-Za-zÀ-ÿĀ-ž0-9][\w'’-]*/g) || []).length; }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]; }); }

  /* ---------------- analysis ---------------- */
  function analyse(origin, home, robotsRes, llmsRes, sitemapRes){
    var doc = new DOMParser().parseFromString(home.text, "text/html");
    var finalUrl = home.url || origin;
    var P = { p1:[], p2:[], p4:[], p5:[] }, BLOCK = [];

    /* P1 Technical Access */
    var https = /^https:/i.test(finalUrl);
    if (!https) BLOCK.push({ cap: 40, title: "The site isn’t served over HTTPS", why: "Many crawlers and agents skip or distrust sites that load over plain HTTP." });
    P.p1.push(check("Secure connection (HTTPS)", https ? "pass" : "fail",
      https ? "The site loads over HTTPS." : "The site loads over plain HTTP.",
      "Serve every page over HTTPS. Many crawlers and agents treat insecure sites as lower quality.", 15));

    var robotsOk = robotsRes.ok && !looksHtml(robotsRes.text);
    var robots = parseRobots(robotsOk ? robotsRes.text : "");
    P.p1.push(check("robots.txt", robotsOk ? "pass" : "part",
      robotsOk ? "Found at /robots.txt." : "No robots.txt was found, so crawlers fall back to their defaults.",
      robotsOk ? "" : "Publish a robots.txt that states your rules for AI crawlers explicitly.", 10));

    var botRows = BOTS.map(function(b){ var r = rootAllowed(robots, b.ua); return { ua:b.ua, who:b.who, w:b.w, allowed:r.allowed, explicit:r.explicit }; });
    var wTot = 0, wOk = 0; botRows.forEach(function(b){ wTot += b.w; if (b.allowed) wOk += b.w; });
    var share = wOk / wTot, blocked = botRows.filter(function(b){ return !b.allowed; });
    var searchBlocked = blocked.filter(function(b){ return b.w === 2; });
    P.p1.push(check("AI crawler access", share === 1 ? "pass" : searchBlocked.length ? "fail" : "part",
      share === 1 ? "All " + BOTS.length + " AI crawlers we check can reach your home page."
        : "Blocked: " + blocked.map(function(b){ return b.ua + " (" + b.who + ")"; }).join(", ") + ".",
      share === 1 ? "" : searchBlocked.length
        ? "Search and user-request crawlers decide whether assistants can cite you today. Unblock them unless you have a specific reason not to."
        : "Blocking training crawlers is a legitimate choice, but it reduces how well models know you over time.", 45));
    P.p1.botRows = botRows;
    var searchBots = botRows.filter(function(b){ return b.w === 2; });
    var allSearchBlocked = searchBots.every(function(b){ return !b.allowed; });
    var everyBotBlocked = botRows.every(function(b){ return !b.allowed; });
    if (everyBotBlocked) BLOCK.push({ cap: 15, title: "robots.txt blocks every AI crawler", why: "Every AI crawler we check is turned away, so assistants can’t read, cite or recommend the site at all." });
    else if (allSearchBlocked) BLOCK.push({ cap: 20, title: "Every AI search crawler is blocked", why: "ChatGPT search, ChatGPT user requests, Perplexity and Bing are all blocked, so assistants can’t fetch the site to answer questions about it." });
    else if (searchBlocked.length >= 2) BLOCK.push({ cap: 40, title: "Several AI search crawlers are blocked", why: searchBlocked.map(function(b){ return b.ua; }).join(", ") + " can’t reach the site, which removes it from those assistants’ answers." });

    var robotsMeta = (doc.querySelector('meta[name="robots"]') || {}).content || "";
    var headerRobots = home.robotsHeader || "";
    var noindex = /noindex|none/i.test(robotsMeta + " " + headerRobots);
    if (noindex) BLOCK.push({ cap: 30, title: "The home page tells crawlers not to index it", why: "A noindex instruction (" + (robotsMeta || headerRobots).trim() + ") asks search engines and AI crawlers to leave the page out." });
    P.p1.push(check("Indexing allowed", noindex ? "fail" : "pass",
      noindex ? "The home page asks crawlers not to index it (" + esc((robotsMeta || headerRobots).trim()) + ")." : "Nothing on the home page blocks indexing.",
      noindex ? "Remove noindex from pages you want AI assistants to find." : "", 15));

    var smDeclared = robots.sitemaps.length > 0;
    var smFound = sitemapRes && sitemapRes.ok && /<(urlset|sitemapindex)/i.test(sitemapRes.text);
    P.p1.push(check("XML sitemap", smDeclared || smFound ? "pass" : "fail",
      smDeclared ? "Declared in robots.txt." : smFound ? "Found at /sitemap.xml." : "No sitemap found in robots.txt or at /sitemap.xml.",
      smDeclared || smFound ? "" : "Publish an XML sitemap and reference it from robots.txt so crawlers find every page.", 15));

    /* P2 Content Extractability */
    var body = doc.body ? doc.body.cloneNode(true) : doc.createElement("body");
    body.querySelectorAll("script,style,noscript,template,svg,iframe").forEach(function(n){ n.remove(); });
    var text = (body.textContent || "").replace(/\s+/g, " ").trim(), wc = words(text);
    var appShell = !!doc.querySelector("#root:empty,#__next:empty,#app:empty,[data-reactroot]:empty");
    if (wc < 30) BLOCK.push({ cap: 20, title: "The page has almost no text without JavaScript", why: (wc ? "Only " + wc + " words are" : "No words are") + " in the HTML. Most AI crawlers don’t run JavaScript, so to them the page is effectively blank." });
    else if (wc < 80) BLOCK.push({ cap: 35, title: "Most of the page text needs JavaScript", why: "Only " + wc + " words are in the HTML. Most AI crawlers don’t run JavaScript, so they see very little of the page." });
    P.p2.push(check("Readable without JavaScript", wc >= 250 ? "pass" : wc >= 80 ? "part" : "fail",
      wc + " words of text are in the page’s HTML before any JavaScript runs." + (wc < 80 && appShell ? " The page looks like a JavaScript app shell." : ""),
      wc >= 250 ? "" : "Many AI crawlers don’t run JavaScript. Render your main content on the server so it’s in the HTML.", 30));

    var title = (doc.querySelector("title") || {}).textContent || ""; title = title.trim();
    P.p2.push(check("Page title", title.length >= 10 && title.length <= 70 ? "pass" : title ? "part" : "fail",
      title ? "“" + esc(title) + "” (" + title.length + " characters)." : "No title tag.",
      title.length >= 10 && title.length <= 70 ? "" : "Write a clear title of 10–70 characters that names who you are and what you do.", 10));

    var desc = ((doc.querySelector('meta[name="description"]') || {}).content || "").trim();
    P.p2.push(check("Meta description", desc.length >= 50 && desc.length <= 170 ? "pass" : desc ? "part" : "fail",
      desc ? desc.length + " characters." : "No meta description.",
      desc.length >= 50 && desc.length <= 170 ? "" : "Add a 50–170 character description. Assistants often reuse it when summarising you.", 10));

    var h1 = doc.querySelectorAll("h1").length, h2 = doc.querySelectorAll("h2").length;
    P.p2.push(check("Heading structure", h1 === 1 && h2 >= 2 ? "pass" : h1 >= 1 ? "part" : "fail",
      h1 + " main heading (H1), " + h2 + " section headings (H2).",
      h1 === 1 && h2 >= 2 ? "" : "Use one H1 and clear H2 section headings, so content splits into answerable chunks.", 15));

    var lang = (doc.documentElement.getAttribute("lang") || "").trim();
    P.p2.push(check("Language declared", lang ? "pass" : "fail", lang ? "lang=\"" + esc(lang) + "\"." : "No lang attribute on the page.",
      lang ? "" : "Add a lang attribute (for example lang=\"en-NZ\") to the html element.", 5));

    var llmsOk = llmsRes.ok && !looksHtml(llmsRes.text) && llmsRes.text.trim().length > 20;
    P.p2.push(check("llms.txt summary", llmsOk ? "pass" : "fail",
      llmsOk ? "Found at /llms.txt." : "No llms.txt file.",
      llmsOk ? "" : "Publish /llms.txt: a short plain-text guide to your business and key pages, written for AI tools.", 15));

    var imgs = Array.prototype.slice.call(doc.querySelectorAll("img"));
    var withAlt = imgs.filter(function(i){ return i.hasAttribute("alt"); }).length;
    P.p2.push(imgs.length ? check("Image descriptions", withAlt / imgs.length >= .9 ? "pass" : withAlt / imgs.length >= .5 ? "part" : "fail",
      withAlt + " of " + imgs.length + " images have alt text.",
      withAlt / imgs.length >= .9 ? "" : "Describe meaningful images with alt text so their content is readable.", 10)
      : check("Image descriptions", "na", "No images in the home page HTML.", "", 10));

    var canon = doc.querySelector('link[rel="canonical"]');
    P.p2.push(check("Canonical URL", canon ? "pass" : "part", canon ? "Declared." : "No canonical link.",
      canon ? "" : "Add a canonical link so duplicates don’t split how you’re understood.", 5));

    /* P4 Data Liquidity */
    var ld = collectJsonLd(doc), all = ld.items, typeList = [];
    all.forEach(function(it){ types(it).forEach(function(t){ if (typeList.indexOf(t) === -1) typeList.push(t); }); });
    var micro = doc.querySelectorAll("[itemtype]").length;
    P.p4.push(check("Structured data present", ld.blocks && !ld.invalid ? "pass" : ld.blocks || micro ? "part" : "fail",
      ld.blocks ? ld.blocks + " JSON-LD block" + (ld.blocks > 1 ? "s" : "") + (ld.invalid ? ", " + ld.invalid + " with errors" : "") + ". Types: " + (typeList.slice(0, 10).join(", ") || "none") + "."
        : micro ? "Microdata found, but no JSON-LD." : "No structured data found.",
      ld.blocks && !ld.invalid ? "" : ld.invalid ? "Fix the JSON-LD errors; invalid blocks are ignored." : "Add schema.org JSON-LD describing your organisation, offers and pages.", 25));

    var org = all.filter(function(it){ return types(it).some(function(t){ return ORG_RE.test(t); }); })[0];
    var orgProps = org ? ["name","url","logo","sameAs","address","telephone","contactPoint"].filter(function(k){ return org[k]; }) : [];
    P.p4.push(check("Organisation details", org && orgProps.length >= 4 ? "pass" : org ? "part" : "fail",
      org ? types(org)[0] + " with " + (orgProps.join(", ") || "no key properties") + "." : "No Organization or LocalBusiness schema.",
      org && orgProps.length >= 4 ? "" : "Describe your business with Organization or LocalBusiness schema: name, url, logo, address, phone and sameAs links to your profiles.", 30));

    var og = ["og:title","og:description","og:image"].filter(function(p){ return doc.querySelector('meta[property="' + p + '"]'); });
    P.p4.push(check("Open Graph tags", og.length === 3 ? "pass" : og.length ? "part" : "fail",
      og.length + " of 3 core tags (title, description, image).",
      og.length === 3 ? "" : "Add og:title, og:description and og:image so links to you are summarised correctly.", 10));

    var rich = typeList.filter(function(t){ return /^(Product|Offer|AggregateOffer|Service|FAQPage|BreadcrumbList|HowTo|Event|Menu|Course|SoftwareApplication|Review|AggregateRating)$/.test(t); });
    P.p4.push(check("Offers and answers described", rich.length >= 2 ? "pass" : rich.length ? "part" : "fail",
      rich.length ? "Found: " + rich.join(", ") + "." : "No product, service, FAQ or breadcrumb schema on the home page.",
      rich.length >= 2 ? "" : "Mark up what you sell (Product, Service, Offer) and common questions (FAQPage) so agents can compare you.", 20));

    var contactInSchema = all.some(function(it){ return it.telephone || it.email || it.contactPoint || it.address; });
    P.p4.push(check("Contact details machine-readable", contactInSchema ? "pass" : "fail",
      contactInSchema ? "Phone, email or address is in structured data." : "No phone, email or address in structured data.",
      contactInSchema ? "" : "Put contact details in schema, not just in page text, so agents can use them reliably.", 15));

    /* P5 Transaction Readiness */
    var actRe = /(add to (cart|bag)|buy|checkout|basket|cart|shop now|book|booking|reserve|appointment|schedule|get a quote|quote|enquir|inquir|contact|order|subscribe|sign up|get started|start free|free trial|demo)/i;
    var actions = Array.prototype.slice.call(doc.querySelectorAll("a[href],button")).filter(function(a){
      return actRe.test((a.textContent || "") + " " + (a.getAttribute("href") || "") + " " + (a.getAttribute("aria-label") || ""));
    });
    P.p5.push(check("Clear next step", actions.length >= 2 ? "pass" : actions.length ? "part" : "fail",
      actions.length ? actions.length + " links or buttons to buy, book, enquire or start." : "No buy, book, quote or contact actions found on the home page.",
      actions.length >= 2 ? "" : "Give agents an obvious path: clearly labelled links to book, buy, get a quote or contact you.", 35));

    var tel = doc.querySelectorAll('a[href^="tel:"]').length, mail = doc.querySelectorAll('a[href^="mailto:"]').length, forms = doc.querySelectorAll("form").length;
    var contactWays = (tel ? 1 : 0) + (mail ? 1 : 0) + (forms ? 1 : 0);
    P.p5.push(check("Ways to get in touch", contactWays >= 2 ? "pass" : contactWays ? "part" : "fail",
      [tel ? "phone link" : "", mail ? "email link" : "", forms ? forms + " form" + (forms > 1 ? "s" : "") : ""].filter(Boolean).join(", ") || "No phone link, email link or form on the home page.",
      contactWays >= 2 ? "" : "Offer at least two direct routes, such as a tel: link and a simple enquiry form.", 20));

    var priceText = /(NZ\$|A\$|AU\$|US\$|\$|£|€)\s?\d/.test(text) || /\d\s?(NZD|AUD|USD|GBP|EUR)\b/.test(text);
    P.p5.push(check("Prices visible", priceText ? "pass" : "part",
      priceText ? "Prices appear in the page text." : "No prices found on the home page.",
      priceText ? "" : "Where you can, publish prices or ranges. Agents compare options on cost and skip those they can’t price.", 15));

    var offerPrice = all.some(function(it){ var o = it.offers || (types(it).indexOf("Offer") > -1 ? it : null); if (!o) return false; o = Array.isArray(o) ? o[0] : o; return o && (o.price || o.lowPrice) && o.priceCurrency; });
    P.p5.push(check("Prices in structured data", offerPrice ? "pass" : "fail",
      offerPrice ? "Offer with price and currency found." : "No Offer with price and currency in structured data.",
      offerPrice ? "" : "Add Offer schema with price and priceCurrency to products or services.", 15));

    var schemaActions = all.filter(function(it){ return it.potentialAction; }).map(function(it){ var a = it.potentialAction; a = Array.isArray(a) ? a : [a]; return a.map(function(x){ return x && x["@type"]; }).join(", "); });
    var transactional = schemaActions.some(function(s){ return /(Order|Reserve|Buy|Schedule|Quote|Communicate|Contact)Action/.test(s); });
    P.p5.push(check("Actions described for agents", transactional ? "pass" : schemaActions.length ? "part" : "fail",
      schemaActions.length ? "Schema actions: " + schemaActions.join("; ") + "." : "No schema.org actions found.",
      transactional ? "" : "Describe what can be done on your site with potentialAction (for example ReserveAction or OrderAction).", 15));

    var scores = { p1: pillarScore(P.p1), p2: pillarScore(P.p2), p4: pillarScore(P.p4), p5: pillarScore(P.p5) };
    var W = CFG.quickWeights || { p1: 30, p2: 25, p4: 25, p5: 20 };
    var wsum = W.p1 + W.p2 + W.p4 + W.p5;
    var base = Math.round((scores.p1 * W.p1 + scores.p2 * W.p2 + scores.p4 * W.p4 + scores.p5 * W.p5) / wsum);
    // A critical blocker caps the score: one of these makes a site close to invisible whatever else is right.
    var cap = BLOCK.reduce(function(m, b){ return Math.min(m, b.cap); }, 100);
    BLOCK.sort(function(a, b){ return a.cap - b.cap; });
    var overall = Math.min(base, cap);
    return { url: finalUrl, origin: origin, checks: P, scores: scores, base: base, blockers: BLOCK, capped: overall < base, overall: overall, band: band(overall), when: new Date() };
  }

  /* ---------------- UI ---------------- */
  var NAMES = { p1:"Technical Access", p2:"Content Extractability", p3:"Brand Command", p4:"Data Liquidity", p5:"Transaction Readiness" };
  var LINKS = { p1:"/pillars/technical-access/", p2:"/pillars/content-extractability/", p3:"/pillars/brand-command/", p4:"/pillars/data-liquidity/", p5:"/pillars/transaction-readiness/" };
  var STATUS = { pass:"Pass", part:"Partly", fail:"Missing", na:"Not applicable" };
  var root = document.getElementById("checker"); if (!root) return;
  var form = document.getElementById("check-form"), input = document.getElementById("check-url"), btn = form.querySelector("button");
  var progress = document.getElementById("check-progress"), out = document.getElementById("check-report"), errBox = document.getElementById("check-error");

  function normalise(v){
    v = (v || "").trim(); if (!v) return null;
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    try { var u = new URL(v); if (!/\./.test(u.hostname) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) return null; return u.origin; }
    catch(e){ return null; }
  }
  function step(i, cls){ var li = progress.children[i]; if (li) li.className = cls; }
  function meter(v){ return '<span class="meter" aria-hidden="true"><i data-w="' + (v == null ? 0 : v) + '"></i></span>'; }

  function render(r){
    var host = r.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    var pins = ["p1","p2","p3","p4","p5"].map(function(k){
      if (k === "p3") return '<div class="sp-row na"><a href="' + LINKS[k] + '">P3 ' + NAMES[k] + '</a><b>Full test</b>' + meter(0) + '</div>';
      return '<div class="sp-row"><a href="#' + k + '">' + k.toUpperCase() + " " + NAMES[k] + "</a><b>" + r.scores[k] + "</b>" + meter(r.scores[k]) + "</div>";
    }).join("");
    var blocks = ["p1","p2","p4","p5"].map(function(k){
      var list = r.checks[k].map(function(c){
        return '<li><span class="status st-' + c.status + '">' + STATUS[c.status] + '</span><div><h3>' + c.name + "</h3><p>" + c.finding + "</p>" + (c.fix && c.status !== "pass" ? '<p class="fix"><b>What to do:</b> ' + c.fix + "</p>" : "") + "</div></li>";
      }).join("");
      var bots = "";
      if (k === "p1"){
        bots = '<li><span class="status st-na">Detail</span><div><h3>Crawler by crawler</h3><div class="table-wrap mt-s"><table class="t"><thead><tr><th scope="col">Crawler</th><th scope="col">Used for</th><th scope="col">Home page</th></tr></thead><tbody>' +
          r.checks.p1.botRows.map(function(b){ return "<tr><th scope=\"row\">" + b.ua + "</th><td>" + b.who + "</td><td>" + (b.allowed ? '<span class="yes">Allowed</span>' : '<span class="blk">Blocked</span>') + "</td></tr>"; }).join("") +
          "</tbody></table></div></div></li>";
      }
      return '<section class="pillar-block" id="' + k + '" aria-labelledby="' + k + '-h"><div class="pb-head"><h2 id="' + k + '-h">' + k.toUpperCase() + " " + NAMES[k] + '</h2><span class="pscore">' + r.scores[k] + ' <span class="small">/ 100</span></span></div><ul class="checks">' + list + bots + "</ul></section>";
    }).join("");
    var crit = r.blockers.length ? '<div class="critical" role="alert"><h2>' + (r.blockers.length > 1 ? "Critical problems are holding this score down" : "A critical problem is holding this score down") + '</h2><ul>' +
      r.blockers.map(function(b){ return "<li><strong>" + esc(b.title) + ".</strong> " + esc(b.why) + "</li>"; }).join("") + "</ul>" +
      (r.capped ? "<p>The score is limited to " + Math.min.apply(null, r.blockers.map(function(b){ return b.cap; })) + ". Without these it would be " + r.base + ". Fix them first: nothing else on the site can help while assistants can’t read it.</p>" : "") + "</div>" : "";
    out.innerHTML = crit +
      '<div class="summary"><div class="sum-score"><p class="small m0">Quick check for</p><p class="site mt-xxs">' + esc(host) + '</p>' +
      '<p class="big">' + r.overall + ' <small>/ 100</small></p><p class="bandname m0">' + r.band + '</p>' +
      '<div class="pointer-ramp"><div class="ramp" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><span class="pin"></span></div>' +
      '<div class="ramp-labels" aria-hidden="true"><span>0</span><span></span><span></span><span></span><span>100</span></div>' +
      '<p class="small mt-1 mb0">Weighted combination of the four pillars we can check automatically; Technical Access counts most. Checked ' + r.when.toLocaleString(document.documentElement.lang === "en" ? undefined : document.documentElement.lang, { day:"numeric", month:"long", year:"numeric", hour:"numeric", minute:"2-digit" }) + ".</p></div>" +
      '<div class="sum-pillars">' + pins + "</div></div>" +
      '<div class="report-actions"><button class="btn secondary" type="button" id="copy-sum">Copy summary</button><button class="btn secondary" type="button" id="print-rep">Print or save as PDF</button><a class="btn ghost" href="/get-rated/?website=' + encodeURIComponent(host) + '">Get the full rating</a></div>' +
      '<div class="bc-block"><div><h2>P3 Brand Command needs the full test</h2><p>Whether ChatGPT, Gemini and Perplexity actually name you can’t be read from your website. The full rating asks AI assistants 19 customer questions, five times each, with web search on and off.</p></div><a class="btn" href="/get-rated/?website=' + encodeURIComponent(host) + '">Get the full rating</a></div>' +
      blocks;
    Array.prototype.forEach.call(out.querySelectorAll("[data-w]"), function(i){ i.style.width = i.getAttribute("data-w") + "%"; });
    requestAnimationFrame(function(){ var pin = out.querySelector(".pin"); if (pin) pin.style.left = Math.max(1, Math.min(99, r.overall)) + "%"; });
    document.getElementById("print-rep").addEventListener("click", function(){ window.print(); });
    document.getElementById("copy-sum").addEventListener("click", function(e){
      var lines = ["Agentic Readiness quick check: " + host, "Score " + r.overall + "/100 (" + r.band + ")"];
      r.blockers.forEach(function(b){ lines.push("Critical: " + b.title); });
      ["p1","p2","p4","p5"].forEach(function(k){ lines.push(NAMES[k] + ": " + r.scores[k]); });
      lines.push("Brand Command: needs the full AI test", location.href);
      var b = e.currentTarget;
      (navigator.clipboard ? navigator.clipboard.writeText(lines.join("\n")) : Promise.reject()).then(function(){ b.textContent = "Copied"; }, function(){ b.textContent = "Couldn’t copy"; });
      setTimeout(function(){ b.textContent = "Copy summary"; }, 2000);
    });
    out.hidden = false;
    var h = document.getElementById("report-h"); if (h){ h.textContent = "Results for " + host; }
    out.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  function fail(title, detail){
    errBox.innerHTML = "<strong>" + title + "</strong><p>" + detail + "</p>"; errBox.hidden = false;
  }

  function run(origin){
    errBox.hidden = true; out.hidden = true; out.innerHTML = "";
    btn.disabled = true; btn.textContent = "Checking…";
    progress.hidden = false;
    Array.prototype.forEach.call(progress.children, function(li){ li.className = ""; });
    history.replaceState(null, "", "?url=" + encodeURIComponent(origin.replace(/^https:\/\//, "")));
    step(0, "run");
    function loadHome(o){
      return fetchText(o + "/").then(function(h){
        // a bare domain that doesn't resolve often works with www.
        if (!h.ok && !h.status && !/^https?:\/\/www\./i.test(o)){
          var alt = o.replace(/^(https?:\/\/)/i, "$1www.");
          return fetchText(alt + "/").then(function(h2){ if (h2.ok){ origin = alt; return h2; } return h; });
        }
        return h;
      });
    }
    loadHome(origin).then(function(home){
      if (home.ok && home.url){ try { var fu = new URL(home.url); if (fu.hostname) origin = fu.protocol + "//" + fu.hostname; } catch(e){} }
      if (!home.ok || !home.text){
        step(0, "bad");
        var host = esc(origin.replace(/^https?:\/\//, "")), why;
        if (home.status === 401 || home.status === 403 || home.status === 429 || home.status === 503){
          why = "It answered with status " + home.status + ", which means it turned away an automated visitor. That matters: AI assistants and agents fetch pages the same way, so they may be blocked too. Check your firewall or bot-protection settings (for example Cloudflare’s bot rules) and allow the AI crawlers you want.";
          fail(host + " blocks automated visitors", why);
        } else if (home.status){
          fail("We couldn’t load " + host, "The home page returned status " + home.status + ". Check the address and try again.");
        } else if (home.error === "dns"){
          fail("We couldn’t find " + host, "That domain doesn’t resolve. Check the spelling and try again.");
        } else {
          fail("We couldn’t load " + host, (home.error === "timeout" ? "The site took too long to respond." : "The site couldn’t be reached, or our fetch service is busy.") + " Wait a moment and try again.");
        }
        throw "stop";
      }
      step(0, "done"); step(1, "run");
      return Promise.all([fetchText(origin + "/robots.txt"), fetchText(origin + "/llms.txt")]).then(function(rs){
        step(1, "done"); step(2, "run");
        var robots = parseRobots(rs[0].ok && !looksHtml(rs[0].text) ? rs[0].text : "");
        var sm = robots.sitemaps.length ? Promise.resolve(null) : fetchText(origin + "/sitemap.xml");
        return sm.then(function(smr){ step(2, "done"); step(3, "run"); return [home, rs[0], rs[1], smr]; });
      });
    }).then(function(a){
      var r = analyse(origin, a[0], a[1], a[2], a[3]);
      step(3, "done");
      render(r);
    }).catch(function(e){
      if (e !== "stop"){ fail("Something went wrong running the check", "Please try again in a moment. (" + esc(e && e.message || e) + ")"); }
    }).then(function(){ btn.disabled = false; btn.textContent = "Run check"; });
  }

  form.addEventListener("submit", function(e){
    e.preventDefault();
    var o = normalise(input.value);
    if (!o){ input.setAttribute("aria-invalid", "true"); fail("Enter a website address", "For example " + (document.documentElement.dataset.site || "yourbusiness.com") + "."); input.focus(); return; }
    input.removeAttribute("aria-invalid");
    run(o);
  });
  var q = new URLSearchParams(location.search).get("url");
  if (q){ input.value = q; var o = normalise(q); if (o) run(o); }

  window.ARS_ANALYSE = analyse; // exposed for testing
})();
