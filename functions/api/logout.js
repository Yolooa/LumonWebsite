import {
  errorResponse,
  json,
  logoutCookie,
  requireMethod
} from "./_shared.js";

export async function onRequest(context) {
  try {
    requireMethod(context.request, "POST");
    return json(
      { success: true },
      200,
      { "Set-Cookie": logoutCookie() }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
