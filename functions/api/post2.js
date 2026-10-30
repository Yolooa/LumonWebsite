function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8"
    }
  });
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function onRequestGet({ env }) {
  if (!env.DB2) {
    return json({
      error: "D1 binding DB2 is not configured"
    }, 500);
  }

  const result = await env.DB2.prepare(`
    SELECT
      posts.id,
      posts.user_id,
      posts.content,
      posts.media_url,
      posts.reply_to_id,
      posts.repost_of_id,
      posts.created_at,
      users.username,
      users.display_name,
      users.avatar_url
    FROM posts
    LEFT JOIN users ON users.id = posts.user_id
    ORDER BY posts.created_at DESC
    LIMIT 100
  `).all();

  return json({
    posts: result.results || []
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB2) {
    return json({
      error: "D1 binding DB2 is not configured"
    }, 500);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      error: "Invalid JSON body"
    }, 400);
  }

  const content = String(body.content || "").trim();

  if (!content) {
    return json({
      error: "Post content is required"
    }, 400);
  }

  if (content.length > 280) {
    return json({
      error: "Post content must be 280 characters or less"
    }, 400);
  }

  const postId = createId("post2");
  const userId = body.user_id || "local-rina2";
  const createdAt = Math.floor(Date.now() / 1000);

  await env.DB2.prepare(`
    INSERT INTO posts (
      id,
      user_id,
      content,
      media_url,
      reply_to_id,
      repost_of_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    postId,
    userId,
    content,
    body.media_url || null,
    body.reply_to_id || null,
    body.repost_of_id || null,
    createdAt
  ).run();

  return json({
    post: {
      id: postId,
      user_id: userId,
      content,
      media_url: body.media_url || null,
      reply_to_id: body.reply_to_id || null,
      repost_of_id: body.repost_of_id || null,
      created_at: createdAt
    }
  }, 201);
}