/**
 * Simple MCP Server over HTTP using a Cloudflare Worker
 *
 * This Worker provides:
 *   - GET  /api/health
 *   - GET  /mcp/tools/list
 *   - POST /mcp/tools/call
 *
 * Supported tools:
 *   - get_us_stock_quote
 *   - get_company_profile
 *   - get_fx_rate
 *   - convert_currency
 *
 * --------------------------------------------------------
 * WHERE TO PUT API KEYS
 * --------------------------------------------------------
 * In Cloudflare Workers, API keys should be stored as environment variables.
 *
 * You will add:
 *   - FMP_API_KEY
 *   - EXCHANGE_API_KEY
 *
 * in your Wrangler config or as secrets.
 *
 * Example with wrangler.jsonc:
 *
 * {
 *   "name": "us-stock-currency-mcp",
 *   "main": "src/index.js",
 *   "compatibility_date": "2026-05-16",
 *   "vars": {
 *     "FMP_API_KEY": "your_fmp_api_key_here",
 *     "EXCHANGE_API_KEY": "your_exchange_api_key_here"
 *   }
 * }
 *
 * Or using Wrangler secrets:
 *   wrangler secret put FMP_API_KEY
 *   wrangler secret put EXCHANGE_API_KEY
 *
 * Using secrets is better for production.
 */

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};

/**
 * Main router
 * This decides what to do based on the URL and HTTP method.
 */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Browsers send OPTIONS requests before some cross-origin requests.
  // This is called a CORS preflight request.
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  try {
    // Simple health check
    if (request.method === "GET" && pathname === "/api/health") {
      return jsonResponse({ status: "ok" });
    }

    // Return the list of available MCP tools
    if (request.method === "GET" && pathname === "/mcp/tools/list") {
      return jsonResponse({
        ok: true,
        tools: getToolDefinitions(),
      });
    }

    // Call one MCP tool by name
    if (request.method === "POST" && pathname === "/mcp/tools/call") {
      return handleToolCall(request, env);
    }

    // Unknown route
    return jsonResponse(
      {
        error: "Not found",
        message: "This endpoint does not exist.",
      },
      404
    );
  } catch (error) {
    return jsonResponse(
      {
        error: "Internal server error",
        message: error.message || "Something went wrong.",
      },
      500
    );
  }
}

/**
 * This handles POST /mcp/tools/call
 *
 * Expected request body:
 * {
 *   "name": "get_us_stock_quote",
 *   "arguments": {
 *     "ticker": "AAPL"
 *   }
 * }
 */
async function handleToolCall(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      {
        error: "Invalid JSON",
        message: "Request body must be valid JSON.",
      },
      400
    );
  }

  const toolName = body?.name;
  const args = body?.arguments || {};

  if (!toolName) {
    return jsonResponse(
      {
        error: "Missing tool name",
        message: 'Request body must include "name".',
      },
      400
    );
  }

  switch (toolName) {
    case "get_us_stock_quote":
      return callGetUsStockQuote(args, env);

    case "get_company_profile":
      return callGetCompanyProfile(args, env);

    case "get_fx_rate":
      return callGetFxRate(args, env);

    case "convert_currency":
      return callConvertCurrency(args, env);

    default:
      return jsonResponse(
        {
          error: "Unknown tool",
          message: `Tool "${toolName}" is not supported.`,
        },
        400
      );
  }
}

/**
 * MCP tool definitions
 *
 * These definitions explain:
 * - the tool name
 * - what it does
 * - what input it expects
 */
function getToolDefinitions() {
  return [
    {
      name: "get_us_stock_quote",
      description: "Get a basic stock quote for a U.S. stock ticker.",
      inputSchema: {
        type: "object",
        properties: {
          ticker: {
            type: "string",
            description: "U.S. stock ticker symbol, for example AAPL",
          },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      sampleOutput: {
        ok: true,
        data: {
          ticker: "AAPL",
          name: "Apple Inc.",
          price: 192.53,
          change: 1.24,
          changePercent: 0.65,
          exchange: "NASDAQ",
        },
      },
    },
    {
      name: "get_company_profile",
      description: "Get company profile information for a U.S. stock ticker.",
      inputSchema: {
        type: "object",
        properties: {
          ticker: {
            type: "string",
            description: "U.S. stock ticker symbol, for example MSFT",
          },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      sampleOutput: {
        ok: true,
        data: {
          ticker: "MSFT",
          companyName: "Microsoft Corporation",
          sector: "Technology",
          industry: "Software - Infrastructure",
          website: "https://www.microsoft.com",
        },
      },
    },
    {
      name: "get_fx_rate",
      description: "Get the exchange rate between two currencies.",
      inputSchema: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "Base currency code, for example USD",
          },
          to: {
            type: "string",
            description: "Target currency code, for example EUR",
          },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
      sampleOutput: {
        ok: true,
        data: {
          from: "USD",
          to: "EUR",
          rate: 0.92,
          date: "2026-05-16",
        },
      },
    },
    {
      name: "convert_currency",
      description: "Convert an amount from one currency to another.",
      inputSchema: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "Base currency code, for example USD",
          },
          to: {
            type: "string",
            description: "Target currency code, for example EUR",
          },
          amount: {
            type: "number",
            description: "Amount to convert",
          },
        },
        required: ["from", "to", "amount"],
        additionalProperties: false,
      },
      sampleOutput: {
        ok: true,
        data: {
          from: "USD",
          to: "EUR",
          amount: 100,
          rate: 0.92,
          result: 92,
        },
      },
    },
  ];
}

/**
 * Tool: get_us_stock_quote
 */
async function callGetUsStockQuote(args, env) {
  const ticker = String(args?.ticker || "").trim().toUpperCase();

  if (!ticker) {
    return jsonResponse(
      {
        error: "Invalid arguments",
        message: 'The "ticker" argument is required.',
      },
      400
    );
  }

  if (!env.FMP_API_KEY) {
    return jsonResponse(
      {
        error: "Server configuration error",
        message: "FMP_API_KEY is missing. Add it in Wrangler config or secrets.",
      },
      500
    );
  }

  const upstreamUrl =
    `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(ticker)}` +
    `?apikey=${encodeURIComponent(env.FMP_API_KEY)}`;

  const response = await fetch(upstreamUrl);

  if (!response.ok) {
    return jsonResponse(
      {
        error: "Upstream API error",
        message: `Financial Modeling Prep returned status ${response.status}.`,
      },
      502
    );
  }

  const data = await response.json();

  if (!Array.isArray(data) || data.length === 0) {
    return jsonResponse(
      {
        error: "Not found",
        message: `No stock quote found for ticker "${ticker}".`,
      },
      404
    );
  }

  const stock = data[0];

  return jsonResponse({
    ok: true,
    tool: "get_us_stock_quote",
    data: {
      ticker: stock.symbol ?? ticker,
      name: stock.name ?? null,
      price: stock.price ?? null,
      change: stock.change ?? null,
      changePercent: stock.changesPercentage ?? null,
      dayLow: stock.dayLow ?? null,
      dayHigh: stock.dayHigh ?? null,
      exchange: stock.exchange ?? null,
      volume: stock.volume ?? null,
      source: "Financial Modeling Prep",
    },
  });
}

/**
 * Tool: get_company_profile
 */
async function callGetCompanyProfile(args, env) {
  const ticker = String(args?.ticker || "").trim().toUpperCase();

  if (!ticker) {
    return jsonResponse(
      {
        error: "Invalid arguments",
        message: 'The "ticker" argument is required.',
      },
      400
    );
  }

  if (!env.FMP_API_KEY) {
    return jsonResponse(
      {
        error: "Server configuration error",
        message: "FMP_API_KEY is missing. Add it in Wrangler config or secrets.",
      },
      500
    );
  }

  const upstreamUrl =
    `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(ticker)}` +
    `?apikey=${encodeURIComponent(env.FMP_API_KEY)}`;

  const response = await fetch(upstreamUrl);

  if (!response.ok) {
    return jsonResponse(
      {
        error: "Upstream API error",
        message: `Financial Modeling Prep returned status ${response.status}.`,
      },
      502
    );
  }

  const data = await response.json();

  if (!Array.isArray(data) || data.length === 0) {
    return jsonResponse(
      {
        error: "Not found",
        message: `No company profile found for ticker "${ticker}".`,
      },
      404
    );
  }

  const company = data[0];

  return jsonResponse({
    ok: true,
    tool: "get_company_profile",
    data: {
      ticker: company.symbol ?? ticker,
      companyName: company.companyName ?? null,
      sector: company.sector ?? null,
      industry: company.industry ?? null,
      website: company.website ?? null,
      description: company.description ?? null,
      ceo: company.ceo ?? null,
      country: company.country ?? null,
      exchange: company.exchangeShortName ?? company.exchange ?? null,
      source: "Financial Modeling Prep",
    },
  });
}

/**
 * Tool: get_fx_rate
 *
 * This gets the rate for 1 unit of the "from" currency.
 * Example: 1 USD -> EUR
 */
async function callGetFxRate(args, env) {
  const from = String(args?.from || "").trim().toUpperCase();
  const to = String(args?.to || "").trim().toUpperCase();

  if (!from || !to) {
    return jsonResponse(
      {
        error: "Invalid arguments",
        message: 'Both "from" and "to" are required.',
      },
      400
    );
  }

  if (!env.EXCHANGE_API_KEY) {
    return jsonResponse(
      {
        error: "Server configuration error",
        message: "EXCHANGE_API_KEY is missing. Add it in Wrangler config or secrets.",
      },
      500
    );
  }

  const upstreamUrl = new URL("https://api.exchangerate.host/convert");
  upstreamUrl.searchParams.set("from", from);
  upstreamUrl.searchParams.set("to", to);
  upstreamUrl.searchParams.set("amount", "1");
  upstreamUrl.searchParams.set("access_key", env.EXCHANGE_API_KEY);

  const response = await fetch(upstreamUrl.toString());

  if (!response.ok) {
    return jsonResponse(
      {
        error: "Upstream API error",
        message: `exchangerate.host returned status ${response.status}.`,
      },
      502
    );
  }

  const data = await response.json();

  if (data.success === false) {
    return jsonResponse(
      {
        error: "FX request failed",
        message: data.error?.info || "Could not get FX rate.",
        details: data.error || null,
      },
      502
    );
  }

  let rate = null;

  // If result is for amount=1, it can be used as the rate.
  if (typeof data.result === "number") {
    rate = data.result;
  }

  return jsonResponse({
    ok: true,
    tool: "get_fx_rate",
    data: {
      from: data.query?.from ?? from,
      to: data.query?.to ?? to,
      amount: data.query?.amount ?? 1,
      rate,
      date: data.date ?? null,
      source: "exchangerate.host",
    },
  });
}

/**
 * Tool: convert_currency
 *
 * This converts a custom amount.
 * Example: 100 USD -> EUR
 */
async function callConvertCurrency(args, env) {
  const from = String(args?.from || "").trim().toUpperCase();
  const to = String(args?.to || "").trim().toUpperCase();
  const amount = Number(args?.amount);

  if (!from || !to || Number.isNaN(amount)) {
    return jsonResponse(
      {
        error: "Invalid arguments",
        message: 'Arguments "from", "to", and numeric "amount" are required.',
      },
      400
    );
  }

  if (!env.EXCHANGE_API_KEY) {
    return jsonResponse(
      {
        error: "Server configuration error",
        message: "EXCHANGE_API_KEY is missing. Add it in Wrangler config or secrets.",
      },
      500
    );
  }

  const upstreamUrl = new URL("https://api.exchangerate.host/convert");
  upstreamUrl.searchParams.set("from", from);
  upstreamUrl.searchParams.set("to", to);
  upstreamUrl.searchParams.set("amount", String(amount));
  upstreamUrl.searchParams.set("access_key", env.EXCHANGE_API_KEY);

  const response = await fetch(upstreamUrl.toString());

  if (!response.ok) {
    return jsonResponse(
      {
        error: "Upstream API error",
        message: `exchangerate.host returned status ${response.status}.`,
      },
      502
    );
  }

  const data = await response.json();

  if (data.success === false) {
    return jsonResponse(
      {
        error: "Currency conversion failed",
        message: data.error?.info || "Could not convert currency.",
        details: data.error || null,
      },
      502
    );
  }

  // For amount=custom, result is the converted amount
  // To estimate the rate, we divide result by amount if possible
  const result = typeof data.result === "number" ? data.result : null;
  const rate =
    result !== null && amount !== 0
      ? result / amount
      : null;

  return jsonResponse({
    ok: true,
    tool: "convert_currency",
    data: {
      from: data.query?.from ?? from,
      to: data.query?.to ?? to,
      amount: data.query?.amount ?? amount,
      rate,
      result,
      date: data.date ?? null,
      source: "exchangerate.host",
    },
  });
}

/**
 * Handle CORS preflight
 */
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

/**
 * Standard JSON response helper
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

/**
 * Simple CORS headers
 *
 * For development, "*" is easiest.
 * In production, you can replace "*" with your frontend domain.
 */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
