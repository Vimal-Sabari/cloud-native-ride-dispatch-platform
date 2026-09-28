import {
  APIGatewayAuthorizerResult,
  APIGatewayTokenAuthorizerEvent,
} from "aws-lambda";
import { verifyToken } from "./jwt-utils";

/**
 * Custom Lambda TOKEN Authorizer for API Gateway.
 *
 * Architecture Note on Design Choices:
 * 1. Type: TOKEN authorizer is chosen over REQUEST authorizer because our security
 *    model solely depends on the Authorization header bearer token rather than path/query params.
 * 2. Failure Handling: We explicitly throw new Error("Unauthorized") upon verification
 *    failure rather than returning an IAM policy with Effect="Deny". API Gateway maps a thrown
 *    "Unauthorized" error string directly to an HTTP 401 response. Returning an explicit Deny
 *    policy produces an HTTP 403 Forbidden instead, which is semantically incorrect when a
 *    caller provides an invalid, missing, or expired authentication token.
 */
function generatePolicy(
  principalId: string,
  effect: "Allow" | "Deny",
  resource: string,
  context?: Record<string, string>
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: effect,
          Resource: resource || "*",
        },
      ],
    },
    context,
  };
}

export async function handler(
  event: APIGatewayTokenAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> {
  const shouldDenyOnUnauthorized = process.env.DENY_UNAUTHORIZED === "true";
  const rawToken = event.authorizationToken;

  if (!rawToken || typeof rawToken !== "string") {
    if (shouldDenyOnUnauthorized) {
      return generatePolicy("unauthorized", "Deny", event.methodArn || "*");
    }
    throw new Error("Unauthorized");
  }

  // Strip optional 'Bearer ' prefix (case-insensitive)
  const token = rawToken.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    if (shouldDenyOnUnauthorized) {
      return generatePolicy("unauthorized", "Deny", event.methodArn || "*");
    }
    throw new Error("Unauthorized");
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    if (shouldDenyOnUnauthorized) {
      return generatePolicy("unauthorized", "Deny", event.methodArn || "*");
    }
    // API Gateway requires throwing "Unauthorized" to trigger a 401 response
    throw new Error("Unauthorized");
  }

  return generatePolicy(decoded.sub, "Allow", event.methodArn, {
    sub: String(decoded.sub),
    role: String(decoded.role),
  });
}
