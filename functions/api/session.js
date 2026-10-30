import {
  errorResponse,
  json,
  requireMethod,
  requireUser
} from "./_shared.js";

export async function onRequest(context) {
  try {
    requireMethod(context.request, "GET");
    const { user } = await requireUser(context);
    return json({ success: true, user });
  } catch (error) {
    return errorResponse(error);
  }
}
