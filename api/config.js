module.exports = (req, res) => {
  const payload = {
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleApiKey: process.env.GOOGLE_API_KEY || "",
  };

  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(`window.APP_CONFIG = ${JSON.stringify(payload)};`);
};
