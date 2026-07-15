#!/usr/bin/env node
const http = require("http");
const url = require("url");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const CLIENT_ID = "01K6PE3530090FNWZQA4293N0H";
const CLIENT_SECRET = "a67f7a235a3b481ba02bd22b1f3993a7f0b3ed2b828c109faf29f7e185fd2a85";
const REDIRECT_URI = "http://localhost:3000/auth/kick/callback";
const TOKEN_FILE = path.join(__dirname, "..", "kick_token_data.json");
const ENV_FILE = path.join(__dirname, "..", ".env");

const codeVerifier = crypto.randomBytes(32).toString("base64url");
const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

// Updated scopes with moderation
const scopes = "user:read channel:read channel:write chat:write events:subscribe moderation:chat_message:manage";

const authUrl = "https://id.kick.com/oauth/authorize?" +
  "client_id=" + CLIENT_ID +
  "&redirect_uri=" + encodeURIComponent(REDIRECT_URI) +
  "&response_type=code" +
  "&scope=" + encodeURIComponent(scopes) +
  "&code_challenge=" + codeChallenge +
  "&code_challenge_method=S256" +
  "&state=kick-reauth-" + Date.now();

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  
  if (parsed.pathname === "/auth/kick/callback") {
    const code = parsed.query.code;
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h1>Error</h1><p>No code received.</p>");
      return;
    }
    try {
      console.log("Exchanging code for token...");
      const response = await axios.post("https://id.kick.com/oauth/token",
        new url.URLSearchParams({
          client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
          code, grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI, code_verifier: codeVerifier
        }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      
      const { access_token, refresh_token, scope, expires_in } = response.data;
      const tokenData = {
        access_token,
        refresh_token,
        expires_at: Date.now() + (expires_in * 1000),
        scope: scope.split(" ")
      };
      
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
      
      let envContent = fs.readFileSync(ENV_FILE, "utf-8");
      envContent = envContent.replace(/KICK_TOKEN=.*/, "KICK_TOKEN=" + access_token);
      fs.writeFileSync(ENV_FILE, envContent);
      
      console.log("SUCCESS: Token saved with scopes: " + scope);
      console.log("Has moderation:chat_message:manage: " + scope.includes("moderation:chat_message:manage"));
      
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body style=font-family:sans-serif;text-align:center;padding-top:100px;background:#1a1a2e;color:#eee>" +
        "<h1 style=color:#53fc18>Token Saved!</h1><p>Scopes: " + scope + "</p>" +
        "<p style=color:" + (scope.includes("moderation") ? "#53fc18" : "#ff4444") + ">" +
        (scope.includes("moderation:chat_message:manage") ? "✅ Moderation scope included!" : "❌ Moderation scope MISSING") + "</p>" +
        "<p>You can close this window.</p></body></html>");
      
      setTimeout(() => { server.close(); process.exit(0); }, 2000);
    } catch(e) {
      console.error("ERROR:", e.response?.data || e.message);
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end("<h1>Error</h1><p>" + (e.response?.data?.error || e.message) + "</p>");
    }
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Ready</h1><p>Complete authorization in browser...</p>");
  }
});

server.listen(3000, () => {
  console.log("AUTH_URL:" + authUrl);
  spawn("brave-browser", [authUrl], {
    stdio: "ignore", detached: true,
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ":0" }
  }).unref();
  console.log("Server on port 3000. Waiting...");
});

setTimeout(() => { console.log("TIMEOUT"); server.close(); process.exit(1); }, 120000);
