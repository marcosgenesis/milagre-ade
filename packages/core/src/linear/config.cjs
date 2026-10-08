// The "Milagre" OAuth app in Linear (Settings › API › OAuth applications). PKCE, so no secret ships with the app.
const BUILT_IN_CLIENT_ID = "";

module.exports = {
  CLIENT_ID: process.env.MILAGRE_LINEAR_CLIENT_ID || BUILT_IN_CLIENT_ID,
  // Tests point this at a local mock of Linear.
  API_BASE: process.env.MILAGRE_LINEAR_API || "https://api.linear.app",
  // Registered as the app's callback URL, so it can't move.
  CALLBACK_PORT: 47615,
};
