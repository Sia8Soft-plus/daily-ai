const DEFAULT_REMOTE_URL='https://www.ai4indus.com/daily-ai-dsa';
function remoteUrl(){return (process.env.DAILY_AI_REMOTE_URL||DEFAULT_REMOTE_URL).replace(/\/+$/,'');}
module.exports={DEFAULT_REMOTE_URL,remoteUrl};
