/**
 * Cloudflare Worker
 *
 * This Worker exposes simple HTTP API endpoints for:
 *   - GET /api/health
 *   - GET /api/stock?ticker=AAPL
 *   - GET /api/fx?from=USD&to=EUR
 *
 * It is intentionally structured in a simple way so you can later add
 * MCP-style tools or more API routes without rewriting everything.
 *
 * Expected environment variables:
 *   - FMP_API_KEY
 *   - EXCHANGE_API_KEY
 */

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};

/**
 * Main request router.
 * This decides which endpoint the incoming request should use.
 */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Handle CORS preflight requests from browsers.
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  try {
    // Health check endpoint
    if (request.method === "GET" && pathname === "/api/health") {
      return jsonResponse({ status: "ok" });
    }

    // Stock endpoint
    if (request.method === "GET" && pathname === "/api/stock") {
      return handleStockRequest(url, env);
    }

    // FX endpoint
    if (request.method === "GET" && pathname === "/api/fx") {
      return handleFxRequest(url, env);
    }

    // Placeholder area for future MCP routes/tools
    // Example:
    // if (request.method === "POST" && pathname === "/mcp/tools/call") {
    //   return handleMcpToolCall(request, env);
    // }

    return jsonResponse(
      {
        error: "Not found",
        message: "The requested endpoint does not exist.",
      },
      404
    );
  } catch (error) {
    // Catch any unexpected error and return clean JSON
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
 * GET /api/stock?ticker=AAPL
 *
 * This fetches stock quote data from Financial Modeling Prep.
 */
async function handleStockRequest(url, env) {
  const ticker = url.searchParams.get("ticker");

  // Basic validation
  if (!ticker) {
    return jsonResponse(
      {
        error: "Missing required query parameter",
        message: 'Please provide a ticker, e.g. /api/stock?ticker=AAPL',
      },
      400
    );
  }

  if (!env.FMP_API_KEY) {
    return jsonResponse(
      {
        error: "Server configuration error",
        message: "FMP_API_KEY is not configured.",
      },
      500
    );
  }

  // Financial Modeling Prep quote endpoint
  const upstreamUrl =
    `https://financialmodelingprep.com/api/v3/quote/` +
    `${encodeURIComponent(ticker.toUpperCase())}?apikey=${encodeURIComponent(env.FMP_API_KEY)}`;

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

  // FMP quote endpoint usually returns an array
  if (!Array.isArray(data) || data.length === 0) {
    return jsonResponse(
      {
        error: "Stock not found",
        message: `No stock data found for ticker "${ticker}".`,
      },
      404
    );
  }

  const stock = data[0];

  // Return a clean, frontend-friendly JSON shape
  return jsonResponse({
    ok: true,
    data: {
      ticker: stock.symbol ?? ticker.toUpperCase(),
      name: stock.name ?? null,
      price: stock.price ?? null,
      change: stock.change ?? null,
      changePercent: stock.changesPercentage ?? null,
      dayLow: stock.dayLow ?? null,
      dayHigh: stock.dayHigh ?? null,
      yearLow: stock.yearLow ?? null,
      yearHigh: stock.yearHigh ?? null,
      exchange: stock.exchange ?? null,
      volume: stock.volume ?? null,
      previousClose: stock.previousClose ?? null,
      open: stock.open ?? null,
      timestamp: stock.timestamp ?? null,
      source: "Financial Modeling Prep",
    },
  });
}

/**
 * GET /api/fx?from=USD&to=EUR
 *
 * This fetches currency conversion data from exchangerate.host.
 *
 * Note:
 * Some exchangerate.host plans/products may expect an access key in a specific way.
 * This example uses `access_key` because that is a common API key pattern for this service.
 * If your provider/account expects a different parameter or header, adjust it here.
 */
async function handleFxRequest(url, env) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Validate required parameters
  if (!from || !to) {
    return jsonResponse(
      {
        error: "Missing required query parameters",
        message: 'Please provide both "from" and "to", e.g. /api/fx?from=USD&to=EUR',
      },
      400
    );
  }

  if (!env.EXCHANGE_API_KEY) {
    return jsonResponse(
      {
        error: "Server configuration error",
        message: "EXCHANGE_API_KEY is not configured.",
      },
      500
    );
  }

  // Build upstream request
  const upstreamUrl = new URL("https://api.exchangerate.host/convert");
  upstreamUrl.searchParams.set("from", from.toUpperCase());
  upstreamUrl.searchParams.set("to", to.toUpperCase());
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

  // Some APIs may return success flags or error objects
  if (data.success === false) {
    return jsonResponse(
      {
        error: "FX lookup failed",
        message: data.error?.info || "Currency conversion request failed.",
        details: data.error || null,
      },
      502
    );
  }

  // Return a clean JSON structure
  return jsonResponse({
    ok: true,
    data: {
      from: data.query?.from ?? from.toUpperCase(),
      to: data.query?.to ?? to.toUpperCase(),
      amount: data.query?.amount ?? 1,
      rate: data.info?.quote ?? data.result ?? null,
      result: data.result ?? null,
      date: data.date ?? null,
      source: "exchangerate.host",
    },
  });
}

/**
 * Handles browser preflight requests for CORS.
 * This is needed when your frontend is hosted on a different origin.
 */
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

/**
 * Helper to return JSON responses consistently.
 * This keeps all endpoints using the same JSON + CORS format.
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
 * CORS headers.
 *
 * For development, "*" is the easiest option.
 * For production, you may want to restrict this to your frontend domain.
 */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

/**
 * Future MCP expansion idea:
 *
 * Later, you can add functions like:
 *
 * async function handleMcpListTools() {}
 * async function handleMcpToolCall(request, env) {}
 *
 * And then route them inside handleRequest().
 *
 * This way your Worker can support both:
 *   - normal REST endpoints for your frontend
 *   - MCP-style endpoints/tool calls for AI integrations
 */
