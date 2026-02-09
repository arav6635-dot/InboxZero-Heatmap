exports.handler = async function handler() {
  const payload = {
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleApiKey: process.env.GOOGLE_API_KEY || "",
  };

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: `window.APP_CONFIG = ${JSON.stringify(payload)};`,
  };
};
