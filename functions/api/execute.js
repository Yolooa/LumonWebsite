import {
  ApiError,
  errorResponse,
  json,
  readJson,
  requireMethod,
  requireUser
} from "./_shared.js";

const WANDBOX_LANGUAGES = {
  python: "Python",
  c: "C",
  cpp: "C++",
  java: "Java",
  go: "Go",
  rust: "Rust",
  csharp: "C#",
  php: "PHP",
  ruby: "Ruby",
  shell: "Bash shell",
  sqlite: "SQL"
};

const PISTON_RUNTIMES = {
  python: ["python", "main.py"],
  c: ["c", "main.c"],
  cpp: ["c++", "main.cpp"],
  java: ["java", "Main.java"],
  go: ["go", "main.go"],
  rust: ["rust", "main.rs"],
  csharp: ["csharp", "Program.cs"],
  php: ["php", "main.php"],
  ruby: ["ruby", "main.rb"],
  shell: ["bash", "main.sh"],
  sqlite: ["sqlite3", "main.sql"]
};

let compilerCache = null;

async function fetchJson(url, options = {}, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(data.message || `运行服务返回 ${response.status}`, 502, "RUNNER_ERROR");
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function pickCompiler(list, language) {
  const target = WANDBOX_LANGUAGES[language];
  if (!target) return null;
  return list
    .filter((item) => String(item.language || "").toLowerCase() === target.toLowerCase())
    .sort((left, right) => String(right.version || "").localeCompare(
      String(left.version || ""),
      undefined,
      { numeric: true }
    ))[0] || null;
}

async function runWandbox(env, language, content, stdin) {
  const baseUrl = String(env.WANDBOX_API_URL || "https://wandbox.org/api").replace(/\/+$/, "");
  if (!compilerCache || Date.now() - compilerCache.time > 3600000) {
    compilerCache = {
      time: Date.now(),
      list: await fetchJson(`${baseUrl}/list.json`, {}, 15000)
    };
  }
  const compiler = pickCompiler(compilerCache.list, language);
  if (!compiler) {
    throw new ApiError(
      `Wandbox 没有找到 ${WANDBOX_LANGUAGES[language] || language} 编译器`,
      502,
      "COMPILER_NOT_AVAILABLE"
    );
  }
  let data;
  try {
    data = await fetchJson(`${baseUrl}/compile.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        compiler: compiler.name,
        code: content,
        stdin,
        "compiler-option-raw": "",
        "runtime-option-raw": ""
      })
    });
  } catch (error) {
    throw new ApiError(
      `无法连接 Wandbox：${error.message || error}`,
      502,
      "WANDBOX_UNREACHABLE"
    );
  }
  return {
    success: true,
    provider: "wandbox",
    language,
    version: `${compiler.name} / ${compiler.version || ""}`.trim(),
    compileOutput: String(data.compiler_error || data.compiler_output || ""),
    compileCode: data.compiler_error ? 1 : 0,
    stdout: String(data.program_output || ""),
    stderr: String(data.program_error || ""),
    output: String(data.program_output || ""),
    exitCode: Number(data.status ?? 0),
    signal: ""
  };
}

async function runPiston(env, language, content, stdin) {
  const runtime = PISTON_RUNTIMES[language];
  if (!runtime) throw new ApiError("Piston 不支持该语言", 400, "UNSUPPORTED_LANGUAGE");
  const baseUrl = String(env.PISTON_API_URL || "https://emkc.org/api/v2/piston").replace(/\/+$/, "");
  let data;
  try {
    data = await fetchJson(`${baseUrl}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        language: runtime[0],
        version: "*",
        files: [{ name: runtime[1], content }],
        stdin,
        compile_timeout: 10000,
        run_timeout: 5000,
        compile_memory_limit: 256000000,
        run_memory_limit: 128000000
      })
    });
  } catch (error) {
    throw new ApiError(
      `无法连接 Piston：${error.message || error}`,
      502,
      "PISTON_UNREACHABLE"
    );
  }
  const compile = data.compile || {};
  const run = data.run || {};
  return {
    success: true,
    provider: "piston",
    language,
    version: data.version || run.version || "",
    compileOutput: String(compile.output || compile.stderr || ""),
    compileCode: Number(compile.code ?? 0),
    stdout: String(run.stdout || ""),
    stderr: String(run.stderr || ""),
    output: String(run.output || ""),
    exitCode: Number(run.code ?? 0),
    signal: String(run.signal || "")
  };
}

export async function onRequest(context) {
  try {
    requireMethod(context.request, "POST");
    await requireUser(context);
    const body = await readJson(context.request);
    const language = String(body.language || "");
    const provider = ["auto", "local", "wandbox"].includes(body.provider)
      ? body.provider
      : "auto";
    const content = String(body.content || "");
    const stdin = String(body.stdin || "").slice(0, 16000);
    if (!WANDBOX_LANGUAGES[language]) {
      throw new ApiError("暂不支持这个运行语言", 400, "UNSUPPORTED_LANGUAGE");
    }
    if (!content.trim()) throw new ApiError("代码不能为空", 400, "EMPTY_CODE");
    if (content.length > 120000) {
      throw new ApiError("代码超过 120000 字符限制", 413, "CODE_TOO_LARGE");
    }
    if (provider === "local") {
      throw new ApiError(
        "Cloudflare 线上环境没有本地编译器，请选择 Wandbox 或自动模式",
        400,
        "LOCAL_RUNNER_UNAVAILABLE"
      );
    }

    try {
      return json(await runWandbox(context.env, language, content, stdin));
    } catch (wandboxError) {
      if (provider === "wandbox") throw wandboxError;
      try {
        return json(await runPiston(context.env, language, content, stdin));
      } catch (pistonError) {
        throw new ApiError(
          `${wandboxError.message || wandboxError}；${pistonError.message || pistonError}`,
          502,
          "REMOTE_RUNNER_UNREACHABLE"
        );
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return errorResponse(new ApiError("代码运行超时", 504, "RUNNER_TIMEOUT"));
    }
    return errorResponse(error);
  }
}
