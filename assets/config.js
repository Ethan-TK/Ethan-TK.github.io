/* ============================================================
   SITE SETTINGS – edit these before going live
   ============================================================ */
window.ARS_CONFIG = {
  contactEmail: "hello@agenticreadiness.ai",   // rating requests and enterprise enquiries (placeholder)
  mediaEmail:   "media@agenticreadiness.ai",   // press enquiries (placeholder)
  // Your own fetch service for the readiness checker (see /worker in the repo).
  // Leave empty to use the public fallback service.
  checkerEndpoint: "",
  // How much each pillar counts in the free quick-check score (any positive numbers; they are normalised).
  // Technical Access leads because nothing else matters if AI assistants are locked out.
  // These are NOT the business-type weights of the full rating, which are provisional and unpublished.
  quickWeights: { p1: 30, p2: 25, p4: 25, p5: 20 }
};
