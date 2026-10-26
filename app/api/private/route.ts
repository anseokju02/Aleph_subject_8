import {
  currentSession, database, json, readBody, reject, sameOrigin, writeAudit,
} from "@/lib/passkey-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!await currentSession(request)) {
      await writeAudit("private", "rejected", "세션 없는 직접 조회");
      return reject("로그인 후 비공개 자료를 볼 수 있습니다.", 401);
    }
    const db = database();
    const notes = await db.prepare(
      "SELECT id, title, body, updated_at FROM private_notes ORDER BY CASE id WHEN 'project' THEN 1 WHEN 'applications' THEN 2 ELSE 3 END",
    ).all<{ id: string; title: string; body: string; updated_at: number }>();
    const audit = await db.prepare(
      "SELECT kind, outcome, detail, created_at FROM audit_events ORDER BY id DESC LIMIT 24",
    ).all<{ kind: string; outcome: string; detail: string; created_at: number }>();
    return json({ notes: notes.results, audit: audit.results });
  } catch {
    return reject("비공개 자료를 읽지 못했습니다.", 500);
  }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return reject("같은 출처의 요청만 허용됩니다.", 403);
  try {
    if (!await currentSession(request)) return reject("로그인 후 수정할 수 있습니다.", 401);
    const data = await readBody(request);
    const id = data?.id;
    const body = data?.body;
    if (
      !["project", "applications", "reflection"].includes(String(id)) ||
      typeof body !== "string" ||
      body.length > 1000
    ) return reject("항목을 선택하고 1000자 이내로 작성해 주세요.", 400);
    const result = await database().prepare(
      "UPDATE private_notes SET body = ?, updated_at = ? WHERE id = ?",
    ).bind(body, Date.now(), id).run();
    if (!result.meta.changes) return reject("항목을 찾지 못했습니다.", 404);
    await writeAudit("private", "success", "비공개 메모 수정");
    return json({ ok: true });
  } catch {
    return reject("비공개 자료를 저장하지 못했습니다.", 500);
  }
}
