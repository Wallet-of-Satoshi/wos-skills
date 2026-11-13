// Made-up values shared by the tests. None of them belongs to a real wallet or server.

export const TOKEN = `wosbot_${'a'.repeat(40)}`;
export const WALLET = `02${'1'.repeat(64)}`;
export const OTHER_WALLET = `03${'2'.repeat(64)}`;

/** A v1 viewer key of sixteen zero bytes, which is the phrase "abandon abandon ... about". */
export const ZERO_VIEWER_KEY = `v1:${'A'.repeat(22)}`;

export const CONNECTION_STRING = `https://bot.example.com/mcp/${TOKEN}#viewer=${ZERO_VIEWER_KEY}&wallet=${WALLET}`;
